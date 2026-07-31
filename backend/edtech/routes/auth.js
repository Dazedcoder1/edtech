import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";

import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/jwt.js";

const router = express.Router();

// ROUTE 1: REGISTER
// POST /api/auth/register
// Body: { name, email, password, role? }
router.post("/register", async (req, res) => {
    try {
        const { name, email, password, role = "student" } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: "name, email and password are required" });
        }
        if (!["student", "educator"].includes(role)) {
            return res.status(400).json({ error: "role must be student or educator" });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        const existing = await pool.query(
            `SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "Email already registered" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await pool.query(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, email, role, created_at
        `, [name, email.toLowerCase(), passwordHash, role]);

        const user = result.rows[0];

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            success: true,
            message: "Account created successfully",
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ROUTE 2: LOGIN
// POST /api/auth/login
// Body: { email, password }
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }

        const result = await pool.query(
            `SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            message: "Login successful",
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ROUTE 3: GET CURRENT USER
// GET /api/auth/me
router.get("/me", authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error("Me error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PROFILE
// ============================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Deliberately permissive: digits, spaces, +, -, (), dots. Phone formats vary
// enough internationally that anything stricter rejects valid numbers.
const PHONE_RE = /^[+]?[\d\s().-]{6,20}$/;

/**
 * PUT /api/auth/profile
 * Body: { name?, phone? }
 *
 * Email is read-only after sign-up — it is the login identifier, and letting
 * it change is an account-takeover path. Sending a different one returns 403;
 * sending the current one is accepted as a no-op so clients that echo the
 * whole profile back still work.
 *
 * A rename reissues the token, since the JWT carries the name in its payload
 * and would otherwise hold a stale value until it expired.
 */
router.put("/profile", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, phone, email, currentPassword } = req.body;

        const existing = await pool.query(
            `SELECT id, name, email, phone, role, password_hash FROM users WHERE id = $1`,
            [userId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        const user = existing.rows[0];

        // --- validate ------------------------------------------------------
        const nextName = name === undefined ? user.name : String(name).trim();
        if (!nextName) {
            return res.status(400).json({ error: "Name cannot be empty." });
        }

        let nextPhone = user.phone;
        if (phone !== undefined) {
            const trimmed = String(phone).trim();
            if (trimmed && !PHONE_RE.test(trimmed)) {
                return res.status(400).json({ error: "That phone number doesn't look valid." });
            }
            nextPhone = trimmed || null; // empty string clears it
        }

        /*
         * Email is immutable after sign-up.
         *
         * It is the login identifier, so allowing it to change here is an
         * account-takeover path: anyone reaching an unattended logged-in
         * browser could repoint the account at their own address. Requiring
         * the current password narrowed that, but the product decision is
         * that it simply cannot change.
         *
         * Enforced here rather than only by disabling the input, because the
         * input is a UI affordance — a client can still PUT any body it likes.
         * A mismatched email is rejected loudly rather than ignored silently,
         * so a stale client cannot believe it succeeded.
         */
        if (email !== undefined) {
            const trimmed = String(email).trim().toLowerCase();
            if (trimmed !== user.email.toLowerCase()) {
                return res.status(403).json({
                    error: "Your email address cannot be changed. Contact support if you need it updated.",
                });
            }
        }

        // --- persist -------------------------------------------------------
        // email is deliberately absent from the SET clause.
        const updated = await pool.query(`
            UPDATE users
            SET name = $1, phone = $2, updated_at = NOW()
            WHERE id = $3
            RETURNING id, name, email, phone, role, created_at
        `, [nextName, nextPhone, userId]);

        const profile = updated.rows[0];

        // The name is carried in the token payload, so a rename needs a fresh
        // one. Email can no longer move, so it can never go stale here.
        const nameChanged = nextName !== user.name;
        const response = { success: true, user: profile };

        if (nameChanged) {
            response.token = jwt.sign(
                { id: profile.id, email: profile.email, role: profile.role, name: profile.name },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );
        }

        res.json(response);

    } catch (err) {
        // Race against the uniqueness check above.
        if (err.code === '23505') {
            return res.status(409).json({ error: "That email is already in use." });
        }
        console.error("Profile update error:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/auth/password
 * Body: { currentPassword, newPassword }
 */
router.put("/password", authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: "Both your current and new password are required." });
        }
        if (String(newPassword).length < 8) {
            return res.status(400).json({ error: "New password must be at least 8 characters." });
        }

        const result = await pool.query(
            `SELECT password_hash FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const ok = await bcrypt.compare(String(currentPassword), result.rows[0].password_hash);
        if (!ok) {
            return res.status(401).json({ error: "Your current password is incorrect." });
        }

        const hash = await bcrypt.hash(String(newPassword), 10);
        await pool.query(
            `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
            [hash, req.user.id]
        );

        res.json({ success: true, message: "Password updated." });

    } catch (err) {
        console.error("Password change error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ROUTE 4: LOGOUT
// POST /api/auth/logout
router.post("/logout", authMiddleware, (req, res) => {
    res.json({ success: true, message: "Logged out successfully" });
});

export default router;