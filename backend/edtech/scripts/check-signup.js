/**
 * Why is registration failing?
 *
 * Compares the live `users` table against exactly what POST /api/auth/register
 * writes, and reports any mismatch. Reads only — creates nothing, changes
 * nothing.
 *
 *   node scripts/check-signup.js
 *
 * The register route inserts nine columns and relies on email being nullable
 * and phone being unique. If a migration did not apply, the insert fails with
 * a Postgres error the UI turns into a generic message, and the actual cause
 * is invisible from the browser.
 */
import pool from "../config/database.js";

const line = "=".repeat(72);
let problems = 0;

const pad = (s, n) => String(s ?? "—").padEnd(n);

try {
    console.log(`\n${line}\nusers table\n${line}`);

    const { rows: cols } = await pool.query(`
        SELECT column_name, data_type, is_nullable, character_maximum_length
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
         ORDER BY ordinal_position
    `);

    if (cols.length === 0) {
        console.log("\n❌ There is no `users` table at all. The backend never ran its schema setup.\n");
        process.exit(1);
    }

    console.log(`${pad("COLUMN", 20)}${pad("TYPE", 28)}NULLABLE`);
    console.log("-".repeat(72));
    for (const c of cols) {
        const type = c.character_maximum_length
            ? `${c.data_type}(${c.character_maximum_length})`
            : c.data_type;
        console.log(pad(c.column_name, 20) + pad(type, 28) + c.is_nullable);
    }

    // Exactly the columns the INSERT in routes/auth.js names.
    const REQUIRED = [
        "name", "email", "phone", "password_hash", "role",
        "class_level", "board", "state", "school",
    ];

    console.log(`\n${line}\nWhat registration needs\n${line}`);

    const present = new Set(cols.map((c) => c.column_name));
    for (const col of REQUIRED) {
        if (present.has(col)) console.log(`  OK    ${col}`);
        else { problems++; console.log(`  ❌    ${col} IS MISSING — the INSERT will fail`); }
    }

    // Email must be nullable: students can now register with a mobile only.
    const email = cols.find((c) => c.column_name === "email");
    if (email) {
        if (email.is_nullable === "YES") console.log("  OK    email is nullable");
        else {
            problems++;
            console.log(
                "  ❌    email is still NOT NULL.\n" +
                "        Registering without an email will fail. Fix with:\n" +
                "          ALTER TABLE users ALTER COLUMN email DROP NOT NULL;"
            );
        }
    }

    // Phone must be unique: it is a login identifier.
    const { rows: idx } = await pool.query(`
        SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'users' AND indexdef ILIKE '%phone%'
    `);
    if (idx.length) console.log(`  OK    unique index on phone (${idx[0].indexname})`);
    else {
        problems++;
        console.log(
            "  ❌    no unique index on phone.\n" +
            "        Two accounts could share a number. Fix with:\n" +
            "          CREATE UNIQUE INDEX idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;"
        );
    }

    /*
     * A duplicate phone number blocks the index from being created, and the
     * failure is silent — CREATE INDEX throws, setupDatabase catches it, and
     * everything carries on looking fine.
     */
    const { rows: dupes } = await pool.query(`
        SELECT phone, COUNT(*)::int AS n FROM users
         WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1
    `);
    if (dupes.length) {
        problems++;
        console.log(`\n  ❌    ${dupes.length} phone number(s) are used by more than one account:`);
        for (const d of dupes.slice(0, 5)) console.log(`          ${d.phone} × ${d.n}`);
        console.log("        The unique index cannot be created until these are resolved.");
    }

    // Anything left over that would break a NOT NULL insert.
    const unexpectedNotNull = cols.filter(
        (c) => c.is_nullable === "NO"
            && !["id", "name", "password_hash"].includes(c.column_name)
            && !c.column_name.endsWith("_at")
            && c.column_name !== "role"
    );
    if (unexpectedNotNull.length) {
        problems++;
        console.log(`\n  ❌    These columns are NOT NULL but registration does not set them:`);
        for (const c of unexpectedNotNull) console.log(`          ${c.column_name}`);
        console.log("        Every signup will fail until they are made nullable or defaulted.");
    }

    /*
     * Run the actual INSERT, then roll it back.
     *
     * Checking columns one by one proves each exists; it does not prove the
     * statement works. Constraints, triggers, defaults and type mismatches
     * only surface when the real query runs — so run it inside a transaction
     * that is always rolled back. Nothing is created, and the exact Postgres
     * error appears here instead of scrolling past in the server log.
     */
    console.log(`\n${line}\nTrial registration (rolled back — no account is created)\n${line}`);

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // A number no real account can hold, so it cannot collide even if the
        // rollback somehow failed.
        const testPhone = "9" + String(Date.now()).slice(-9);

        const { rows } = await client.query(
            `INSERT INTO users (name, email, phone, password_hash, role, class_level, board, state, school)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, name, phone, role, class_level`,
            ["Diagnostic Student", null, testPhone, "$2b$10$abcdefghijklmnopqrstuv", "student",
             "12th", "HP Board", "Himachal Pradesh", null]
        );

        console.log("  OK    a student with a mobile number and no email inserts cleanly");
        console.log(`        (id ${rows[0].id}, class ${rows[0].class_level})`);

        await client.query("ROLLBACK");
        console.log("  OK    rolled back — nothing was saved");
    } catch (err) {
        problems++;
        await client.query("ROLLBACK").catch(() => {});
        console.log("  ❌    THE INSERT FAILED. This is why signup does not work:\n");
        console.log(`        ${err.message}`);
        if (err.detail) console.log(`        detail:     ${err.detail}`);
        if (err.column) console.log(`        column:     ${err.column}`);
        if (err.constraint) console.log(`        constraint: ${err.constraint}`);
        if (err.code) console.log(`        sqlstate:   ${err.code}`);
    } finally {
        client.release();
    }

    console.log(`\n${line}`);
    console.log(
        problems === 0
            ? "The database accepts a registration. The failure is not in the schema\n" +
              "or the INSERT — so it is in the request itself. Check the browser's\n" +
              "Network tab: open DevTools (F12) -> Network -> try signing up -> click\n" +
              "the 'register' request and read the Response. The backend terminal also\n" +
              "logs the reason on a line starting 'Register error:'."
            : `${problems} problem(s) found above.`
    );
    console.log(`${line}\n`);
} catch (err) {
    console.error("\nDiagnostic failed:", err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
