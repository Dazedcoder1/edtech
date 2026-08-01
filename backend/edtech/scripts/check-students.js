/**
 * Read-only diagnostic for the educator's "Students" list.
 *
 * Runs the same query GET /api/enrollments/courses/:courseId/enrollments runs,
 * and reports the two things that can make it come back empty or fail:
 * a missing column (the endpoint 500s and the modal shows an error), or the
 * enrolments simply sitting on a different course than the one being opened —
 * students enrol in a class, while "Students" is often clicked on a subject.
 *
 *   node scripts/check-students.js                 # list courses and counts
 *   node scripts/check-students.js "Physics"       # drill into one course
 *
 * Writes nothing.
 */
import pool from "../config/database.js";

const [, , courseFilter] = process.argv;
const pad = (s, n) => String(s ?? "—").padEnd(n);

try {
    // 1. Does the table have the columns the endpoint selects?
    const { rows: cols } = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'enrollments'
    `);
    const have = new Set(cols.map((c) => c.column_name));
    const needed = ["progress", "last_accessed", "status", "enrolled_at", "user_id", "course_id"];
    const missing = needed.filter((c) => !have.has(c));

    console.log(`\nenrollments columns : ${cols.length} found`);
    if (missing.length) {
        console.log(`MISSING             : ${missing.join(", ")}`);
        console.log(`  -> the Students endpoint selects these; a missing one makes it 500,`);
        console.log(`     which the modal shows as "Could not load the student list".`);
    } else {
        console.log(`All columns the Students endpoint needs are present.`);
    }

    // 2. Where do the enrolments actually live?
    const { rows } = await pool.query(`
        SELECT c.id,
               c.title,
               c.parent_course_id IS NOT NULL AS is_subject,
               p.title AS parent_title,
               COUNT(e.id) FILTER (WHERE e.status = 'active')::int AS active_students,
               COUNT(e.id)::int AS all_enrolments
          FROM courses c
          LEFT JOIN courses p ON p.id = c.parent_course_id
          LEFT JOIN enrollments e ON e.course_id = c.id
         WHERE c.is_active = true
           AND ($1::text IS NULL OR c.title ILIKE '%' || $1 || '%')
         GROUP BY c.id, c.title, c.parent_course_id, p.title
         ORDER BY active_students DESC, c.title
    `, [courseFilter ?? null]);

    console.log(`\n${pad("COURSE", 24)}${pad("KIND", 20)}${pad("ACTIVE", 8)}TOTAL`);
    console.log("-".repeat(62));
    for (const r of rows) {
        console.log(
            pad(r.title?.slice(0, 22), 24) +
            pad(r.is_subject ? `subject of ${String(r.parent_title).slice(0, 8)}` : "class", 20) +
            pad(r.active_students, 8) +
            r.all_enrolments
        );
    }

    // 3. For a named course, run the endpoint's own query verbatim.
    if (courseFilter && rows.length) {
        const target = rows[0];
        console.log(`\nRunning the Students query for "${target.title}":`);
        try {
            const { rows: students } = await pool.query(`
                SELECT u.name AS student_name, u.email AS student_email,
                       e.status, e.enrolled_at, e.progress
                  FROM enrollments e
                  JOIN users u ON e.user_id = u.id
                 WHERE e.course_id = $1 AND e.status = 'active'
                 ORDER BY e.enrolled_at DESC
            `, [target.id]);

            if (students.length === 0) {
                console.log("  (no active enrolments on this course)");
            } else {
                for (const s of students) {
                    console.log(`  ${pad(s.student_name, 18)}${pad(s.student_email, 30)}${s.status}`);
                }
            }
        } catch (queryErr) {
            console.log(`  QUERY FAILED: ${queryErr.message}`);
            console.log("  -> this is exactly what the endpoint would return as a 500.");
        }
    }
    console.log("");
} catch (err) {
    console.error("\nDiagnostic failed:", err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
