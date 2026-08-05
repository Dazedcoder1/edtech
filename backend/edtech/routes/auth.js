import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";

import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/jwt.js";
import {
    normalizePhone,
    normalizeEmail,
    classifyIdentifier,
    validateStudentFields,
    CLASS_LEVELS,
    BOARDS,
    STATES,
} from "../utils/studentProfile.js";
import { sendMail, passwordResetEmail } from "../utils/mailer.js";

const router = express.Router();

/** The shape of `user` returned to the client, kept identical everywhere. */
const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    class_level: u.class_level,
    board: u.board,
    state: u.state,
    school: u.school,
});

// ROUTE 1: REGISTER
// POST /api/auth/register
// Body: { name, phone, password, email?, role?, class_level?, board?, state?, school? }
router.post("/register", async (req, res) => {
    try {
        const { name, password, role = "student" } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: "Please enter your full name." });
        }
        if (!password) {
            return res.status(400).json({ error: "Please choose a password." });
        }
        if (!["student", "educator"].includes(role)) {
            return res.status(400).json({ error: "role must be student or educator" });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        // Mobile is now the primary identifier, so it is required for everyone
        // and validated before anything else touches the database.
        const phoneCheck = normalizePhone(req.body.phone);
        if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });

        const emailCheck = normalizeEmail(req.body.email);
        if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });

        /*
         * Academic fields are required for students and ignored for educators.
         * A teacher has no class, and demanding one would block their signup on
         * a field that means nothing to them.
         */
        const isStudent = role === "student";
        const fields = validateStudentFields(req.body, { strict: isStudent });
        if (!fields.ok) return res.status(400).json({ error: fields.error });
        const extra = isStudent ? fields.values : {};

        const clash = await pool.query(
            `SELECT phone, email FROM users
              WHERE phone = $1 OR ($2::text IS NOT NULL AND email = $2)`,
            [phoneCheck.phone, emailCheck.email]
        );
        if (clash.rows.length > 0) {
            // Named specifically: "already registered" without saying which
            // field sends people round in circles retyping the wrong one.
            const phoneTaken = clash.rows.some((r) => r.phone === phoneCheck.phone);
            return res.status(409).json({
                error: phoneTaken
                    ? "That mobile number is already registered."
                    : "That email address is already registered.",
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await pool.query(`
            INSERT INTO users (name, email, phone, password_hash, role, class_level, board, state, school)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, name, email, phone, role, class_level, board, state, school, created_at
        `, [
            String(name).trim(),
            emailCheck.email,
            phoneCheck.phone,
            passwordHash,
            role,
            extra.class_level ?? null,
            extra.board ?? null,
            extra.state ?? null,
            extra.school ?? null,
        ]);

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
            user: publicUser(user),
        });

    } catch (err) {
        console.error("Register error:", err);
        if (err.code === "23505") {
            return res.status(409).json({ error: "That mobile number or email is already registered." });
        }
        res.status(500).json({ error: err.message });
    }
});

// ROUTE 2: LOGIN
// POST /api/auth/login
// Body: { identifier, password }  — identifier is a mobile number or an email
router.post("/login", async (req, res) => {
    try {
        const { password } = req.body;

        /*
         * `email` is still accepted as the field name.
         *
         * That is what every existing client sends, including any browser tab
         * left open across the deploy. Reading either key means the rename can
         * happen in the UI without a flag day.
         */
        const raw = req.body.identifier ?? req.body.email ?? req.body.phone;

        if (!raw || !password) {
            return res.status(400).json({ error: "Enter your mobile number or email, and your password." });
        }

        const id = classifyIdentifier(raw);
        if (id.kind === "empty" || id.kind === "unknown") {
            // Same wording as a wrong password below: telling an attacker that
            // an identifier is merely malformed is harmless, but keeping one
            // message avoids leaking which accounts exist.
            return res.status(401).json({ error: "Invalid login or password" });
        }

        const result = await pool.query(
            id.kind === "email"
                ? `SELECT * FROM users WHERE email = $1`
                : `SELECT * FROM users WHERE phone = $1`,
            [id.value]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid login or password" });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid login or password" });
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
            user: publicUser(user),
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
            `SELECT id, name, email, phone, role, class_level, board, state, school, created_at
               FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        // The allowed values travel with the profile so the form's dropdowns
        // are populated from the same list the server validates against.
        res.json({
            success: true,
            user: result.rows[0],
            options: { classLevels: CLASS_LEVELS, boards: BOARDS, states: STATES },
        });
    } catch (err) {
        console.error("Me error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PROFILE
// ============================================================

/*
 * The local EMAIL_RE / PHONE_RE that lived here are gone.
 *
 * Both are now in utils/studentProfile.js, alongside the normalisation that
 * has to agree with them. The phone rule in particular is no longer just a
 * format check: it rewrites +91 and leading-zero forms to a bare 10-digit
 * number, and if validation and normalisation lived apart, a number could pass
 * one and be stored in a shape the login lookup never matches.
 */

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
            `SELECT id, name, email, phone, role, class_level, board, state, school, password_hash
               FROM users WHERE id = $1`,
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

        /*
         * Phone can be corrected, but not cleared.
         *
         * It is a login identifier now: an account with no phone and no email
         * cannot be signed in to at all, so an empty value here would lock the
         * user out of their own account with no way back.
         */
        let nextPhone = user.phone;
        if (phone !== undefined) {
            const check = normalizePhone(phone);
            if (!check.ok) return res.status(400).json({ error: check.error });
            nextPhone = check.phone;

            if (nextPhone !== user.phone) {
                const taken = await pool.query(
                    `SELECT id FROM users WHERE phone = $1 AND id <> $2`,
                    [nextPhone, userId]
                );
                if (taken.rows.length > 0) {
                    return res.status(409).json({ error: "That mobile number is already registered." });
                }
            }
        }

        /*
         * Class is locked after signup; board, state and school are not.
         *
         * Class decides which material a student is shown, so letting them
         * change it is a way to reach content they did not pay for. The other
         * three are descriptive — a student who changes school should be able
         * to say so without contacting anyone.
         */
        if (req.body.class_level !== undefined || req.body.classLevel !== undefined) {
            const sent = String(req.body.class_level ?? req.body.classLevel ?? "");
            if (sent !== String(user.class_level ?? "")) {
                return res.status(403).json({
                    error: "Your class cannot be changed. Contact support if you need it updated.",
                });
            }
        }

        const fields = validateStudentFields(req.body, { strict: false });
        if (!fields.ok) return res.status(400).json({ error: fields.error });

        const nextBoard = fields.values.board ?? user.board;
        const nextState = fields.values.state ?? user.state;
        // school is the one field where an explicit empty string means "clear
        // it", because leaving a stale school on the profile is worse than a
        // blank one.
        const nextSchool = "school" in fields.values ? fields.values.school : user.school;

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
            // `user.email` can now be null — email is optional at signup — so
            // this must not call .toLowerCase() on it unguarded.
            const current = (user.email ?? "").toLowerCase();

            /*
             * One exception to immutability: adding an address where there was
             * none. An account created with only a mobile number has nothing to
             * take over, so setting the first email is not the risk the rule
             * exists to prevent — and refusing it would make the optional field
             * permanently unfillable.
             */
            if (current === "" && trimmed !== "") {
                const emailCheck = normalizeEmail(trimmed);
                if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });

                const taken = await pool.query(
                    `SELECT id FROM users WHERE email = $1 AND id <> $2`,
                    [emailCheck.email, userId]
                );
                if (taken.rows.length > 0) {
                    return res.status(409).json({ error: "That email address is already registered." });
                }
                user.pendingEmail = emailCheck.email;
            } else if (trimmed !== current) {
                return res.status(403).json({
                    error: "Your email address cannot be changed. Contact support if you need it updated.",
                });
            }
        }

        // --- persist -------------------------------------------------------
        // An existing email is never overwritten: COALESCE keeps the stored
        // value whenever pendingEmail is absent.
        const updated = await pool.query(`
            UPDATE users
            SET name = $1,
                phone = $2,
                email = COALESCE($4, email),
                board = $5,
                state = $6,
                school = $7,
                updated_at = NOW()
            WHERE id = $3
            RETURNING id, name, email, phone, role, class_level, board, state, school, created_at
        `, [nextName, nextPhone, userId, user.pendingEmail ?? null, nextBoard, nextState, nextSchool]);

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

// ============================================================
// PASSWORD RESET BY EMAIL OTP
// ============================================================

/** How long a code stays valid. Short enough to matter, long enough to find. */
const OTP_TTL_MINUTES = 15;
/** Wrong guesses allowed before the code is burned. */
const OTP_MAX_ATTEMPTS = 5;
/** Codes a single account may request per hour. */
const OTP_MAX_PER_HOUR = 5;

/**
 * A six-digit code from a cryptographic source.
 *
 * Math.random() is seeded predictably enough that a determined attacker who
 * knows roughly when a code was issued can narrow the search dramatically.
 * randomInt costs nothing here and removes the question.
 */
function generateOtp() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/*
 * Every response below is the same whether or not the account exists.
 *
 * A reset form that says "no account with that email" is an account
 * enumeration oracle: anyone can test an address list against it and learn who
 * is registered. The one exception is deliberate and product-driven, and is
 * explained where it appears.
 */
const NEUTRAL = "If an account with that email exists, a reset code is on its way.";

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 */
router.post("/forgot-password", async (req, res) => {
    try {
        const check = normalizeEmail(req.body.email);
        if (!check.ok || !check.email) {
            return res.status(400).json({ error: "Enter the email address on your account." });
        }

        const found = await pool.query(
            `SELECT id, name, email FROM users WHERE email = $1`,
            [check.email]
        );

        // Nothing to send to — but the caller is told the same thing either way.
        if (found.rows.length === 0) {
            return res.json({ success: true, message: NEUTRAL });
        }

        const user = found.rows[0];

        /*
         * Cap requests per account, not per IP.
         *
         * The cost being controlled is mail sent to a real person: someone who
         * hammers this endpoint against one address is spamming that person's
         * inbox, and rotating IPs would defeat an IP-based limit while doing
         * nothing to change who receives the mail.
         */
        const recent = await pool.query(
            `SELECT COUNT(*)::int AS n FROM password_resets
              WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
            [user.id]
        );
        if (recent.rows[0].n >= OTP_MAX_PER_HOUR) {
            return res.status(429).json({
                error: "Too many reset requests. Please wait an hour and try again.",
            });
        }

        // Any earlier code is dead the moment a new one is issued, so two
        // codes in an inbox can never both work.
        await pool.query(
            `UPDATE password_resets SET consumed_at = NOW()
              WHERE user_id = $1 AND consumed_at IS NULL`,
            [user.id]
        );

        const code = generateOtp();
        const codeHash = await bcrypt.hash(code, 10);

        await pool.query(
            `INSERT INTO password_resets (user_id, code_hash, expires_at)
             VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
            [user.id, codeHash, String(OTP_TTL_MINUTES)]
        );

        const mail = passwordResetEmail({ name: user.name, code, minutes: OTP_TTL_MINUTES });
        await sendMail({ to: user.email, ...mail });

        res.json({ success: true, message: NEUTRAL });

    } catch (err) {
        console.error("Forgot password error:", err);
        res.status(500).json({ error: "Could not start the reset. Please try again." });
    }
});

/**
 * POST /api/auth/verify-reset-code
 * Body: { email, code }
 *
 * Separate from the reset itself so the UI can tell someone their code is
 * wrong before making them invent a password. Verifying does not consume the
 * code — the reset step re-checks it.
 */
router.post("/verify-reset-code", async (req, res) => {
    try {
        const result = await consumeResetCode(req.body, { consume: false });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        res.json({ success: true, message: "Code accepted." });
    } catch (err) {
        console.error("Verify reset code error:", err);
        res.status(500).json({ error: "Could not check that code. Please try again." });
    }
});

/**
 * POST /api/auth/reset-password
 * Body: { email, code, newPassword }
 */
router.post("/reset-password", async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || String(newPassword).length < 8) {
            return res.status(400).json({ error: "New password must be at least 8 characters." });
        }

        const result = await consumeResetCode(req.body, { consume: true });
        if (!result.ok) return res.status(result.status).json({ error: result.error });

        const hash = await bcrypt.hash(String(newPassword), 10);
        await pool.query(
            `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
            [hash, result.userId]
        );

        res.json({ success: true, message: "Your password has been changed. You can sign in now." });

    } catch (err) {
        console.error("Reset password error:", err);
        res.status(500).json({ error: "Could not reset your password. Please try again." });
    }
});

/**
 * Shared check behind both verify and reset.
 *
 * One function so the two endpoints cannot drift: a verify that is stricter
 * than the reset would reject a working code, and a verify that is laxer would
 * wave someone through to a step that then fails for reasons they cannot see.
 *
 * @returns {{ok: true, userId: string} | {ok: false, status: number, error: string}}
 */
async function consumeResetCode({ email, code }, { consume }) {
    const emailCheck = normalizeEmail(email);
    const digits = String(code ?? "").trim();

    if (!emailCheck.ok || !emailCheck.email || !/^\d{6}$/.test(digits)) {
        return { ok: false, status: 400, error: "Enter the 6-digit code from your email." };
    }

    const found = await pool.query(`SELECT id FROM users WHERE email = $1`, [emailCheck.email]);
    if (found.rows.length === 0) {
        return { ok: false, status: 400, error: "That code is not valid. Request a new one." };
    }
    const userId = found.rows[0].id;

    const reset = await pool.query(
        `SELECT id, code_hash, attempts, expires_at
           FROM password_resets
          WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 1`,
        [userId]
    );
    if (reset.rows.length === 0) {
        return { ok: false, status: 400, error: "That code has expired. Request a new one." };
    }

    const row = reset.rows[0];

    if (row.attempts >= OTP_MAX_ATTEMPTS) {
        // Burn it rather than leaving a locked row around that still counts as
        // "the newest live code" and blocks a fresh request from working.
        await pool.query(`UPDATE password_resets SET consumed_at = NOW() WHERE id = $1`, [row.id]);
        return { ok: false, status: 429, error: "Too many wrong codes. Request a new one." };
    }

    const matches = await bcrypt.compare(digits, row.code_hash);
    if (!matches) {
        // Counted on the row, not in memory: a process restart must not hand
        // an attacker a fresh five guesses.
        await pool.query(`UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
        return {
            ok: false,
            status: 400,
            error: left > 0
                ? `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.`
                : "That code is not correct. Request a new one.",
        };
    }

    if (consume) {
        /*
         * Consume conditionally, and check that it worked.
         *
         * `consumed_at IS NULL` in the WHERE makes this an atomic claim: two
         * requests arriving with the same valid code — a double-tapped button
         * is enough — cannot both succeed, because only one UPDATE matches.
         */
        const claim = await pool.query(
            `UPDATE password_resets SET consumed_at = NOW()
              WHERE id = $1 AND consumed_at IS NULL
            RETURNING id`,
            [row.id]
        );
        if (claim.rowCount === 0) {
            return { ok: false, status: 400, error: "That code has already been used. Request a new one." };
        }
    }

    return { ok: true, userId };
}

// ROUTE 4: LOGOUT
// POST /api/auth/logout
router.post("/logout", authMiddleware, (req, res) => {
    res.json({ success: true, message: "Logged out successfully" });
});

export default router;