/**
 * Repair expires_at values shifted by the TIMESTAMPTZ conversion.
 *
 * The first version of that migration interpreted the old naive timestamps in
 * the DATABASE's zone. They had actually been written in the APP SERVER's zone
 * (node-postgres serialises a JS Date to a local wall-clock string, and a naive
 * column keeps exactly that). Where the two zones differ — a UTC database with
 * an IST app server, say — every expiry landed 5.5 hours late, so nothing
 * expired.
 *
 * Rather than guessing an offset to subtract, this recomputes each expiry from
 * facts that were never ambiguous: the enrolment's own enrolled_at, which the
 * database generated with NOW(), plus the course's configured validity. That
 * is deterministic and gives the same answer however many times it is run.
 *
 *   node scripts/fix-expiry.js          # dry run, changes nothing
 *   node scripts/fix-expiry.js --apply  # writes the corrected values
 *
 * Lifetime enrolments (expires_at IS NULL) are never touched.
 */
import pool from "../config/database.js";

const apply = process.argv.includes("--apply");

// Minutes win over months, matching expiryFrom() in utils/enrollmentAccess.js.
const CORRECT_EXPIRY = `
    (e.enrolled_at AT TIME ZONE 'UTC')
    + CASE
        WHEN c.access_duration_minutes IS NOT NULL
            THEN c.access_duration_minutes * INTERVAL '1 minute'
        ELSE c.access_duration_months * INTERVAL '1 month'
      END
`;

const pad = (s, n) => String(s ?? "—").padEnd(n);

try {
    const { rows } = await pool.query(`
        SELECT u.name,
               c.title,
               c.access_duration_months,
               c.access_duration_minutes,
               e.enrolled_at,
               e.expires_at            AS current_expiry,
               ${CORRECT_EXPIRY}       AS correct_expiry,
               EXTRACT(EPOCH FROM (e.expires_at - (${CORRECT_EXPIRY})))::int AS drift_seconds
          FROM enrollments e
          JOIN courses c ON c.id = e.course_id
          JOIN users u ON u.id = e.user_id
         WHERE e.expires_at IS NOT NULL
           AND (c.access_duration_minutes IS NOT NULL OR c.access_duration_months IS NOT NULL)
         ORDER BY u.name, c.title
    `);

    if (rows.length === 0) {
        console.log("\nNothing to repair: no timed enrolments found.\n");
    } else {
        console.log(`\n${pad("STUDENT", 14)}${pad("COURSE", 18)}${pad("STORED", 26)}${pad("SHOULD BE", 26)}DRIFT`);
        console.log("-".repeat(96));

        let wrong = 0;
        for (const r of rows) {
            const drift = r.drift_seconds ?? 0;
            if (Math.abs(drift) > 60) wrong++;
            console.log(
                pad(r.name?.slice(0, 12), 14) +
                pad(r.title?.slice(0, 16), 18) +
                pad(r.current_expiry.toISOString(), 26) +
                pad(new Date(r.correct_expiry).toISOString(), 26) +
                (Math.abs(drift) > 60 ? `${(drift / 3600).toFixed(1)}h` : "ok")
            );
        }

        console.log(`\n${wrong} of ${rows.length} enrolment(s) drifted by more than a minute.`);

        if (!apply) {
            console.log("\nDry run — nothing written. Re-run with --apply to correct them.\n");
        } else {
            const result = await pool.query(`
                UPDATE enrollments e
                   SET expires_at = ${CORRECT_EXPIRY},
                       updated_at = NOW()
                  FROM courses c
                 WHERE c.id = e.course_id
                   AND e.expires_at IS NOT NULL
                   AND (c.access_duration_minutes IS NOT NULL OR c.access_duration_months IS NOT NULL)
            `);
            console.log(`\nUpdated ${result.rowCount} enrolment(s).`);
            console.log("Re-run scripts/check-access.js to confirm the gates now agree.\n");
        }
    }
} catch (err) {
    console.error("\nRepair failed:", err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
