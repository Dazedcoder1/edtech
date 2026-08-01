/**
 * Read-only diagnostic for timed course access.
 *
 * Prints what the database actually believes about a student's enrolment and
 * evaluates the exact predicate the access gates use, so "it isn't expiring"
 * or "it won't let me re-purchase" becomes a fact rather than a guess.
 *
 *   node scripts/check-access.js student@example.com
 *   node scripts/check-access.js student@example.com "Physics"
 *
 * Writes nothing. Safe to run against production.
 */
import pool from "../config/database.js";
import { activeEnrolmentSql } from "../utils/enrollmentAccess.js";

const [, , who, courseFilter] = process.argv;

if (!who) {
    console.error("Usage: node scripts/check-access.js <student email or name> [course title fragment]");
    process.exit(1);
}

const pad = (s, n) => String(s ?? "—").padEnd(n);

try {
    const { rows: clock } = await pool.query(
        `SELECT NOW() AS db_now, current_setting('TimeZone') AS db_tz`
    );
    console.log(`\nDatabase now : ${clock[0].db_now.toISOString()}  (session zone: ${clock[0].db_tz})`);
    console.log(`Node now     : ${new Date().toISOString()}  (process zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

    const { rows: colType } = await pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'enrollments' AND column_name = 'expires_at'
    `);
    const type = colType[0]?.data_type ?? "MISSING";
    console.log(`expires_at   : ${type}${type === "timestamp without time zone" ? "   <-- needs the TIMESTAMPTZ migration; restart the server" : ""}`);

    const { rows } = await pool.query(
        `SELECT c.title,
                c.price,
                c.access_duration_months,
                c.access_duration_minutes,
                e.status,
                e.payment_status,
                e.enrolled_at,
                e.expires_at,
                (${activeEnrolmentSql("e")}) AS gate_allows,
                (e.expires_at IS NOT NULL AND e.expires_at <= NOW()) AS has_lapsed
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
           JOIN users u ON u.id = e.user_id
          WHERE (LOWER(u.email) = LOWER($1) OR u.name ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR c.title ILIKE '%' || $2 || '%')
          ORDER BY e.enrolled_at DESC`,
        [who, courseFilter ?? null]
    );

    if (rows.length === 0) {
        console.log(`\nNo enrolments found for "${who}"${courseFilter ? ` matching "${courseFilter}"` : ""}.`);

        const { rows: students } = await pool.query(`
            SELECT u.name, u.email, COUNT(e.id)::int AS enrolments
              FROM users u
              LEFT JOIN enrollments e ON e.user_id = u.id
             WHERE u.role = 'student'
             GROUP BY u.id, u.name, u.email
             ORDER BY enrolments DESC, u.name
             LIMIT 15
        `);

        if (students.length) {
            console.log(`\nStudents on this database:`);
            console.log(`${pad("NAME", 24)}${pad("EMAIL", 34)}ENROLMENTS`);
            console.log("-".repeat(70));
            for (const st of students) {
                console.log(pad(st.name?.slice(0, 22), 24) + pad(st.email?.slice(0, 32), 34) + st.enrolments);
            }
        }
        console.log("");
    } else {
        console.log(`\n${pad("COURSE", 26)}${pad("PRICE", 8)}${pad("VALIDITY", 14)}${pad("STATUS", 10)}${pad("EXPIRES", 26)}${pad("GATE", 8)}LAPSED`);
        console.log("-".repeat(100));
        for (const r of rows) {
            const validity = r.access_duration_minutes
                ? `${r.access_duration_minutes} min (test)`
                : r.access_duration_months
                ? `${r.access_duration_months} months`
                : "lifetime";
            console.log(
                pad(r.title.slice(0, 24), 26) +
                pad(Number(r.price) === 0 ? "free" : r.price, 8) +
                pad(validity, 14) +
                pad(r.status, 10) +
                pad(r.expires_at ? r.expires_at.toISOString() : "never", 26) +
                pad(r.gate_allows ? "OPEN" : "CLOSED", 8) +
                (r.has_lapsed ? "yes" : "no")
            );
        }

        console.log(`
GATE = what the content/video/quiz checks decide right now.
  OPEN   + lapsed=yes -> the expiry is not being honoured
  CLOSED + lapsed=yes -> working; re-purchase should be allowed
  OPEN   + lapsed=no  -> still inside the paid window
`);
    }
} catch (err) {
    console.error("\nDiagnostic failed:", err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
