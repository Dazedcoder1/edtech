import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import {
    PAYU_MERCHANT_KEY,
    PAYU_ENDPOINT,
    PAYU_MODE,
    PUBLIC_BASE_URL,
    payuConfigured,
    requestHash,
    responseHash,
    hashesMatch,
    formatAmount,
    newTxnId,
    sanitiseText,
} from "../utils/payu.js";
import pool from "../config/database.js";
import { expiryFrom, activeEnrolmentSql } from "../utils/enrollmentAccess.js";
import { notifyCourseOwner } from "../utils/notify.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const razorpayConfigured = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);

export const PAYMENT_PROVIDER = (() => {
    const forced = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
    if (forced === "payu" || forced === "razorpay") return forced;
    if (payuConfigured) return "payu";
    if (razorpayConfigured) return "razorpay";
    return "none";
})();

export const paymentsConfigured = PAYMENT_PROVIDER !== "none";

if (!paymentsConfigured) {
    console.warn(
        "⚠️  No payment provider is configured.\n" +
        "   Set PAYU_MERCHANT_KEY + PAYU_MERCHANT_SALT, or\n" +
        "   RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET, in backend/edtech/.env.\n" +
        "   Paid enrolment is disabled; free courses are unaffected."
    );
} else if (PAYMENT_PROVIDER === "payu") {
    console.log(`💳 Payments: PayU (${PAYU_MODE} mode), callbacks to ${PUBLIC_BASE_URL}`);
    if (PAYU_MODE !== "live") {
        console.log("   Test mode — no real money moves. Set PAYU_MODE=live when ready.");
    }
    if (/localhost|127\.0\.0\.1/.test(PUBLIC_BASE_URL)) {
        console.warn(
            "⚠️  PUBLIC_BASE_URL points at localhost. PayU redirects the customer's\n" +
            "   browser there after payment, so this only works while you are testing\n" +
            "   on this machine. Set it to your public URL before taking real payments."
        );
    }
} else {
    console.log("💳 Payments: Razorpay");
}

const razorpayInstance = razorpayConfigured
    ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
    : null;

function requirePayments(req, res, next) {
    if (!paymentsConfigured) {
        return res.status(503).json({
            error: "Online payment is not available right now. Please contact your teacher.",
        });
    }
    next();
}

// Route 1: Create Razorpay Order
router.post("/create-order", authMiddleware, async (req, res) => {
    const { courseId } = req.body;
    const userId = req.user.id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const existingEnrollment = await client.query(`
            SELECT status, expires_at FROM enrollments
            WHERE user_id = $1 AND course_id = $2 AND ${activeEnrolmentSql('')}
        `, [userId, courseId]);

        if (existingEnrollment.rows.length > 0) {
            const { expires_at: existingExpiry } = existingEnrollment.rows[0];
            return res.status(400).json({
                error: existingExpiry
                    ? `You already have access to this course until ${new Date(existingExpiry).toLocaleDateString()}.`
                    : "You already have lifetime access to this course.",
            });
        }

        const course = await client.query(`
            SELECT price, title, access_duration_months, access_duration_minutes FROM courses WHERE id = $1
        `, [courseId]);

        if (course.rows.length === 0) {
            return res.status(404).json({ error: "Course not found" });
        }

        const courseData = course.rows[0];
        if (parseFloat(courseData.price) === 0) {
            const expiresAt = expiryFrom({
                months: courseData.access_duration_months,
                minutes: courseData.access_duration_minutes,
            });

            await client.query(`
                INSERT INTO enrollments (user_id, course_id, payment_status, status, enrolled_at, amount_paid, expires_at)
                VALUES ($1, $2, 'completed', 'active', NOW(), 0, $3)
                ON CONFLICT (user_id, course_id)
                DO UPDATE SET
                    status = 'active',
                    payment_status = 'completed',
                    enrolled_at = NOW(),
                    expires_at = EXCLUDED.expires_at,
                    updated_at = NOW()
            `, [userId, courseId, expiresAt]);

            await client.query('COMMIT');

            await notifyCourseOwner(courseId, {
                type: "enrolment",
                title: `${req.user.name || "A student"} enrolled`,
                body: courseData.title,
                actorId: userId,
                link: `/analytics`,
            });

            return res.json({
                success: true,
                isFree: true,
                message: "Successfully enrolled in free course"
            });
        }

        // ── Fix: include amount and provider so stale orders can be detected ──
        const pendingOrder = await client.query(`
            SELECT order_id, amount, provider
            FROM payment_orders
            WHERE user_id = $1
              AND course_id = $2
              AND status = 'created'
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId, courseId]);

        if (!paymentsConfigured) {
            await client.query('ROLLBACK');
            return res.status(503).json({
                error: "Online payment is not available right now. Please contact your teacher.",
            });
        }

        if (PAYMENT_PROVIDER === "payu") {
            // ── Fix: only reuse a PayU order whose amount still matches ──
            const existingOrder = pendingOrder.rows[0];

            const canReuseOrder =
                existingOrder &&
                existingOrder.provider === "payu" &&
                formatAmount(existingOrder.amount) ===
                    formatAmount(courseData.price);

            let txnid;

            if (canReuseOrder) {
                txnid = existingOrder.order_id;
            } else {
                // Retire an old PayU order only when its amount is stale.
                if (
                    existingOrder &&
                    existingOrder.provider === "payu" &&
                    formatAmount(existingOrder.amount) !==
                        formatAmount(courseData.price)
                ) {
                    await client.query(`
                        UPDATE payment_orders
                        SET status = 'failed',
                            error_message = 'Superseded after course price change',
                            updated_at = NOW()
                        WHERE order_id = $1
                          AND status = 'created'
                    `, [existingOrder.order_id]);
                }

                txnid = newTxnId();

                await client.query(`
                    INSERT INTO payment_orders
                        (order_id, user_id, course_id, amount, status, provider)
                    VALUES ($1, $2, $3, $4, 'created', 'payu')
                `, [txnid, userId, courseId, courseData.price]);
            }

            await client.query(`
                INSERT INTO enrollments (user_id, course_id, payment_status, status)
                VALUES ($1, $2, 'pending', 'pending')
                ON CONFLICT (user_id, course_id)
                DO UPDATE SET payment_status = 'pending', updated_at = NOW()
            `, [userId, courseId]);

            const buyer = await client.query(
                `SELECT name, email, phone FROM users WHERE id = $1`, [userId]
            );
            const me = buyer.rows[0] || {};

            const fields = {
                key: PAYU_MERCHANT_KEY,
                txnid,
                amount: formatAmount(courseData.price),
                productinfo: sanitiseText(courseData.title, "Course"),
                firstname: sanitiseText((me.name || "").split(" ")[0], "Student"),
                email: me.email || "",
                phone: (me.phone || "").replace(/\D/g, "").slice(-10),
                surl: `${PUBLIC_BASE_URL}/api/payments/payu/callback`,
                furl: `${PUBLIC_BASE_URL}/api/payments/payu/callback`,
                udf1: courseId,
            };
            fields.hash = requestHash(fields);

            await client.query('COMMIT');

            return res.json({
                success: true,
                provider: "payu",
                action: PAYU_ENDPOINT,
                fields,
                amount: courseData.price,
                currency: "INR",
                courseTitle: courseData.title,
            });
        }

        // ── Razorpay branch ──
        // `pendingOrder` no longer carries `status`/`created_at`, but the
        // Razorpay branch only ever read `order_id`, which is still selected.
        let orderId;

        if (pendingOrder.rows.length > 0) {
            orderId = pendingOrder.rows[0].order_id;
        } else {
            const options = {
                amount: Math.round(courseData.price * 100),
                currency: "INR",
                receipt: `receipt_${Date.now()}_${userId.slice(0, 8)}`,
                notes: {
                    courseId: courseId,
                    userId: userId,
                    courseTitle: courseData.title
                }
            };

            const order = await razorpayInstance.orders.create(options);
            orderId = order.id;

            await client.query(`
                INSERT INTO payment_orders (order_id, user_id, course_id, amount, status)
                VALUES ($1, $2, $3, $4, 'created')
            `, [orderId, userId, courseId, courseData.price]);
        }

        await client.query(`
            INSERT INTO enrollments (user_id, course_id, payment_status, status)
            VALUES ($1, $2, 'pending', 'pending')
            ON CONFLICT (user_id, course_id)
            DO UPDATE SET payment_status = 'pending', updated_at = NOW()
        `, [userId, courseId]);

        await client.query('COMMIT');

        res.json({
            success: true,
            provider: "razorpay",
            orderId: orderId,
            keyId: RAZORPAY_KEY_ID,
            amount: courseData.price,
            currency: "INR",
            courseTitle: courseData.title
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Create order error:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Route 2: Verify Payment and Enroll User
router.post("/verify", authMiddleware, requirePayments, async (req, res) => {
    const { orderId, paymentId, signature, courseId } = req.body;
    const userId = req.user.id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const orderCheck = await client.query(`
            SELECT id, user_id, course_id, amount, status
            FROM payment_orders
            WHERE order_id = $1
        `, [orderId]);

        if (orderCheck.rows.length === 0) {
            return res.status(404).json({ error: "Order not found" });
        }

        const order = orderCheck.rows[0];

        if (order.user_id !== userId) {
            return res.status(403).json({ error: "Unauthorized: Payment belongs to different user" });
        }

        if (order.status === 'completed') {
            return res.json({ success: true, alreadyEnrolled: true, message: "Already enrolled" });
        }

        const body = orderId + "|" + paymentId;
        const expectedSignature = crypto
            .createHmac("sha256", RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature !== signature) {
            return res.status(400).json({ error: "Invalid payment signature" });
        }

        const razorpayOrder = await razorpayInstance.orders.fetch(orderId);
        if (razorpayOrder.amount_paid !== razorpayOrder.amount) {
            return res.status(400).json({ error: "Full amount not paid" });
        }

        await client.query(`
            UPDATE payment_orders
            SET status = 'completed',
                razorpay_payment_id = $1,
                razorpay_signature = $2,
                updated_at = NOW()
            WHERE order_id = $3
        `, [paymentId, signature, orderId]);

        const durationResult = await client.query(
            `SELECT access_duration_months, access_duration_minutes FROM courses WHERE id = $1`,
            [courseId]
        );
        const paidExpiresAt = expiryFrom({
            months: durationResult.rows[0]?.access_duration_months,
            minutes: durationResult.rows[0]?.access_duration_minutes,
        });

        await client.query(`
            UPDATE enrollments
            SET status = 'active',
                payment_status = 'completed',
                payment_id = $1,
                amount_paid = $2,
                enrolled_at = NOW(),
                expires_at = $5,
                updated_at = NOW()
            WHERE user_id = $3 AND course_id = $4
        `, [paymentId, order.amount, userId, courseId, paidExpiresAt]);

        await client.query('COMMIT');

        await notifyCourseOwner(courseId, {
            type: "enrolment",
            title: `${req.user.name || "A student"} enrolled`,
            body: `Paid ₹${order.amount}`,
            actorId: userId,
            link: `/analytics`,
        });

        res.json({
            success: true,
            message: "Payment verified and enrollment successful!"
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Payment verification error:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});


/**
 * POST /api/payments/payu/callback
 *
 * PayU's surl and furl. Not an API call — PayU redirects the customer's
 * browser here with a form POST, so this runs with no session, no JWT and no
 * CORS. It is a public endpoint that grants course access, which makes the
 * hash check the only thing standing between a forged form and a free course.
 *
 * Three things are verified, and all three matter:
 *
 *   1. the reverse hash, computed with our salt — proves PayU sent it;
 *   2. the txnid exists and is still awaiting payment — stops a genuine
 *      callback being replayed to re-grant or re-stamp an enrolment;
 *   3. the amount equals what we recorded when the order was created —
 *      a signed response for ₹1 must not unlock a ₹1,000 course.
 *
 * The response is a redirect rather than JSON: what arrives here is a person
 * looking at a browser, not a fetch() waiting on a status code.
 */
router.post("/payu/callback", async (req, res) => {
    const back = (courseId, state) =>
        `${PUBLIC_BASE_URL}/course/${courseId || ""}?payment=${state}`;

    const body = req.body || {};
    const { txnid, status, amount, mihpayid, error_Message: errorMessage } = body;
    const courseId = body.udf1 || null;

    if (!txnid) {
        return res.redirect(303, back(courseId, "failed"));
    }

    const client = await pool.connect();
    try {
        if (!hashesMatch(body.hash, responseHash(body))) {
            console.error(`[payu] hash mismatch on txnid ${txnid} — ignoring callback`);
            return res.redirect(303, back(courseId, "failed"));
        }

        await client.query("BEGIN");

        const orderRes = await client.query(
            `SELECT user_id, course_id, amount, status
               FROM payment_orders
              WHERE order_id = $1 AND provider = 'payu'
              FOR UPDATE`,
            [txnid]
        );

        if (orderRes.rows.length === 0) {
            await client.query("ROLLBACK");
            console.error(`[payu] callback for unknown txnid ${txnid}`);
            return res.redirect(303, back(courseId, "failed"));
        }

        const order = orderRes.rows[0];

        if (order.status === "completed") {
            await client.query("ROLLBACK");
            return res.redirect(303, back(order.course_id, "success"));
        }

        if (String(status).toLowerCase() !== "success") {
            await client.query(
                `UPDATE payment_orders
                    SET status = 'failed', error_message = $2, updated_at = NOW()
                  WHERE order_id = $1`,
                [txnid, errorMessage || status || "failed"]
            );
            await client.query("COMMIT");
            return res.redirect(303, back(order.course_id, "failed"));
        }

        // Unchanged — the amount check below is the guard against forged
        // or incorrect payment values and must not be removed.
        if (formatAmount(order.amount) !== formatAmount(amount)) {
            await client.query(
                `UPDATE payment_orders
                    SET status = 'failed',
                        error_message = $2,
                        updated_at = NOW()
                  WHERE order_id = $1`,
                [txnid, `amount mismatch: expected ${formatAmount(order.amount)}, got ${formatAmount(amount)}`]
            );
            await client.query("COMMIT");
            console.error(`[payu] amount mismatch on ${txnid}`);
            return res.redirect(303, back(order.course_id, "failed"));
        }

        await client.query(
            `UPDATE payment_orders
                SET status = 'completed',
                    gateway_payment_id = $2,
                    updated_at = NOW()
              WHERE order_id = $1`,
            [txnid, mihpayid || null]
        );

        const duration = await client.query(
            `SELECT access_duration_months, access_duration_minutes FROM courses WHERE id = $1`,
            [order.course_id]
        );
        const expiresAt = expiryFrom({
            months: duration.rows[0]?.access_duration_months,
            minutes: duration.rows[0]?.access_duration_minutes,
        });

        await client.query(
            `UPDATE enrollments
                SET status = 'active',
                    payment_status = 'completed',
                    payment_id = $1,
                    amount_paid = $2,
                    enrolled_at = NOW(),
                    expires_at = $5,
                    updated_at = NOW()
              WHERE user_id = $3 AND course_id = $4`,
            [mihpayid || txnid, order.amount, order.user_id, order.course_id, expiresAt]
        );

        await client.query("COMMIT");

        await notifyCourseOwner(order.course_id, {
            type: "enrolment",
            title: "A student enrolled",
            body: `Paid ₹${order.amount}`,
            actorId: order.user_id,
            link: `/analytics`,
        });

        return res.redirect(303, back(order.course_id, "success"));
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
        console.error("[payu] callback error:", err);
        return res.redirect(303, back(courseId, "failed"));
    } finally {
        client.release();
    }
});

// Route 3: Check Enrollment Status
router.get("/enrollments/status/:courseId", authMiddleware, async (req, res) => {
    const { courseId } = req.params;
    const userId = req.user.id;

    try {
        const result = await pool.query(`
            SELECT status, payment_status, payment_id, enrolled_at, amount_paid
            FROM enrollments
            WHERE user_id = $1 AND course_id = $2
        `, [userId, courseId]);

        if (result.rows.length === 0) {
            return res.json({ status: 'not_enrolled', enrolled: false });
        }

        const enrollment = result.rows[0];
        res.json({
            status: enrollment.status,
            enrolled: enrollment.status === 'active',
            paymentStatus: enrollment.payment_status,
            paymentId: enrollment.payment_id,
            enrolledAt: enrollment.enrolled_at,
            amountPaid: enrollment.amount_paid
        });

    } catch (error) {
        console.error("Status check error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Route 4: Get Payment Order Status
router.get("/order/:orderId/status", authMiddleware, async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;

    try {
        const result = await pool.query(`
            SELECT status, razorpay_payment_id, amount, created_at
            FROM payment_orders
            WHERE order_id = $1 AND user_id = $2
        `, [orderId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Order not found" });
        }

        res.json({ success: true, order: result.rows[0] });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;