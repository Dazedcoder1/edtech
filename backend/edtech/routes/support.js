/**
 * Support tickets.
 *
 * Two audiences share these routes:
 *   - a student sees only their own tickets;
 *   - an educator sees every ticket, and is the one who replies.
 *
 * Rather than branching inside each handler on req.user.role, visibility is
 * expressed once in `visibleTicketSql` and reused. The rule then cannot drift
 * between the list route and the detail route, which is exactly the kind of
 * mismatch that leaks one student's messages to another.
 */
import express from "express";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";
import { notifyUsers, notifyEducators } from "../utils/notify.js";

const router = express.Router();

const CATEGORIES = ["payment", "access", "video", "content", "quiz", "other"];
const STATUSES = ["open", "answered", "closed"];

/**
 * A SQL fragment restricting tickets to those the caller may see, plus the
 * parameter it needs. Educators are unrestricted; everyone else is limited to
 * their own rows.
 */
function visibleTicketSql(user, paramIndex) {
    return user.role === "educator" ? "TRUE" : `t.user_id = $${paramIndex}`;
}

/**
 * GET /api/support/tickets
 *
 * The list. Carries a reply count and the time of the last message so the UI
 * can show activity without fetching every thread.
 */
router.get("/tickets", authMiddleware, async (req, res) => {
    try {
        const isEducator = req.user.role === "educator";
        const params = isEducator ? [] : [req.user.id];

        const { rows } = await pool.query(
            `SELECT t.id,
                    t.subject,
                    t.category,
                    t.status,
                    t.course_id,
                    t.created_at,
                    t.updated_at,
                    c.title AS course_title,
                    u.name  AS student_name,
                    u.email AS student_email,
                    (SELECT COUNT(*)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
                    (SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS last_message_at
               FROM support_tickets t
               JOIN users u ON u.id = t.user_id
               LEFT JOIN courses c ON c.id = t.course_id
              WHERE ${visibleTicketSql(req.user, 1)}
              ORDER BY
                    -- Open tickets first, so an educator opening the panel sees
                    -- what still needs an answer rather than the newest closed one.
                    CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
                    t.updated_at DESC
              LIMIT 200`,
            params
        );

        res.json({ tickets: rows });
    } catch (err) {
        console.error("GET /support/tickets:", err);
        res.status(500).json({ error: "Could not load tickets" });
    }
});

/** GET /api/support/tickets/:id — one thread with all its messages. */
router.get("/tickets/:id", authMiddleware, async (req, res) => {
    try {
        const isEducator = req.user.role === "educator";
        const params = isEducator ? [req.params.id] : [req.params.id, req.user.id];

        const { rows } = await pool.query(
            `SELECT t.id, t.subject, t.category, t.status, t.course_id,
                    t.created_at, t.updated_at, t.user_id,
                    c.title AS course_title,
                    u.name  AS student_name,
                    u.email AS student_email
               FROM support_tickets t
               JOIN users u ON u.id = t.user_id
               LEFT JOIN courses c ON c.id = t.course_id
              WHERE t.id = $1 AND ${visibleTicketSql(req.user, 2)}`,
            params
        );

        if (rows.length === 0) return res.status(404).json({ error: "Ticket not found" });

        const { rows: messages } = await pool.query(
            `SELECT m.id, m.body, m.created_at, m.user_id,
                    u.name AS author_name,
                    u.role AS author_role
               FROM support_ticket_messages m
               LEFT JOIN users u ON u.id = m.user_id
              WHERE m.ticket_id = $1
              ORDER BY m.created_at ASC`,
            [req.params.id]
        );

        res.json({ ticket: rows[0], messages });
    } catch (err) {
        console.error("GET /support/tickets/:id:", err);
        res.status(500).json({ error: "Could not load the ticket" });
    }
});

/**
 * POST /api/support/tickets
 *
 * Open a ticket. The ticket row and its first message are written in one
 * transaction — a ticket with no message is a blank row in the educator's
 * queue that nobody can act on.
 */
router.post("/tickets", authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
        const { subject, message, category, courseId } = req.body;

        if (!subject || !subject.trim()) return res.status(400).json({ error: "A subject is required" });
        if (!message || !message.trim()) return res.status(400).json({ error: "A message is required" });

        const cat = CATEGORIES.includes(category) ? category : "other";

        await client.query("BEGIN");

        const { rows } = await client.query(
            `INSERT INTO support_tickets (user_id, subject, category, course_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id, subject, category, status, created_at`,
            [req.user.id, subject.trim().slice(0, 255), cat, courseId || null]
        );

        await client.query(
            `INSERT INTO support_ticket_messages (ticket_id, user_id, body)
             VALUES ($1, $2, $3)`,
            [rows[0].id, req.user.id, message.trim()]
        );

        await client.query("COMMIT");

        // After COMMIT, never inside it: notifyEducators uses its own pool
        // connection, so calling it mid-transaction would neither see the
        // ticket nor roll back with it.
        await notifyEducators({
            type: "ticket",
            title: `New support ticket from ${req.user.name || "a student"}`,
            body: subject.trim().slice(0, 255),
            actorId: req.user.id,
            link: `/support/${rows[0].id}`,
        });

        res.status(201).json({ success: true, ticket: rows[0] });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("POST /support/tickets:", err);
        res.status(500).json({ error: "Could not open the ticket" });
    } finally {
        client.release();
    }
});

/**
 * POST /api/support/tickets/:id/reply
 *
 * Either party adds a message. An educator's reply moves the ticket to
 * 'answered'; a student's reply moves it back to 'open' so it returns to the
 * top of the queue rather than looking handled.
 */
router.post("/tickets/:id/reply", authMiddleware, async (req, res) => {
    try {
        const { body } = req.body;
        if (!body || !body.trim()) return res.status(400).json({ error: "A message is required" });

        const isEducator = req.user.role === "educator";
        const params = isEducator ? [req.params.id] : [req.params.id, req.user.id];

        const { rows } = await pool.query(
            `SELECT t.id, t.user_id, t.subject, t.status
               FROM support_tickets t
              WHERE t.id = $1 AND ${visibleTicketSql(req.user, 2)}`,
            params
        );
        if (rows.length === 0) return res.status(404).json({ error: "Ticket not found" });

        const ticket = rows[0];
        if (ticket.status === "closed") {
            return res.status(409).json({ error: "This ticket is closed. Open a new one to continue." });
        }

        await pool.query(
            `INSERT INTO support_ticket_messages (ticket_id, user_id, body)
             VALUES ($1, $2, $3)`,
            [ticket.id, req.user.id, body.trim()]
        );

        await pool.query(
            `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1`,
            [ticket.id, isEducator ? "answered" : "open"]
        );

        if (isEducator) {
            await notifyUsers([ticket.user_id], {
                type: "ticket_reply",
                title: "Support replied to your ticket",
                body: ticket.subject,
                actorId: req.user.id,
                link: `/support/${ticket.id}`,
            });
        } else {
            await notifyEducators({
                type: "ticket_reply",
                title: `${req.user.name || "A student"} replied to a ticket`,
                body: ticket.subject,
                actorId: req.user.id,
                link: `/support/${ticket.id}`,
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("POST /support/tickets/:id/reply:", err);
        res.status(500).json({ error: "Could not send the reply" });
    }
});

/**
 * PATCH /api/support/tickets/:id/status
 *
 * Educators close and reopen. Students may close their own ticket — the case
 * where they solved it themselves — but may not mark it 'answered', which
 * would hide it from the queue without anyone having replied.
 */
router.patch("/tickets/:id/status", authMiddleware, async (req, res) => {
    try {
        const { status } = req.body;
        if (!STATUSES.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
        }

        const isEducator = req.user.role === "educator";
        if (!isEducator && status === "answered") {
            return res.status(403).json({ error: "Only support staff can mark a ticket answered" });
        }

        const params = isEducator ? [req.params.id, status] : [req.params.id, status, req.user.id];
        const { rows } = await pool.query(
            `UPDATE support_tickets t
                SET status = $2, updated_at = NOW()
              WHERE t.id = $1 AND ${isEducator ? "TRUE" : "t.user_id = $3"}
              RETURNING t.id, t.user_id, t.subject, t.status`,
            params
        );

        if (rows.length === 0) return res.status(404).json({ error: "Ticket not found" });

        if (isEducator && status === "closed") {
            await notifyUsers([rows[0].user_id], {
                type: "ticket",
                title: "Your support ticket was closed",
                body: rows[0].subject,
                actorId: req.user.id,
                link: `/support/${rows[0].id}`,
            });
        }

        res.json({ success: true, ticket: rows[0] });
    } catch (err) {
        console.error("PATCH /support/tickets/:id/status:", err);
        res.status(500).json({ error: "Could not update the ticket" });
    }
});

export default router;
