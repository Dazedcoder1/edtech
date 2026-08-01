import express from "express";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// GET /api/enrollments
router.get("/", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        // Added efficient subqueries to dynamically count total and completed items
        const result = await pool.query(`
            SELECT 
                e.id as enrollment_id,
                e.course_id,
                e.status as enrollment_status,
                e.payment_status,
                e.payment_id,
                e.amount_paid,
                e.enrolled_at,
                e.expires_at,
                c.title as course_title,
                c.description as course_description,
                c.thumbnail_url,
                c.price as course_price,
                c.status as course_status,
                u.name as educator_name,
                /*
                 * Numerator and denominator must describe the same set of
                 * items: the ones the student can actually see in the course.
                 *
                 * The total used SUM(cardinality(m.content_ids)), which counts
                 * every id ever put in the array — including inactive modules,
                 * soft-deleted content, and videos still transcoding or failed.
                 * The curriculum endpoint hides all of those, so the student
                 * saw (say) 6 items while the denominator was 9 and the bar
                 * could never reach 100%.
                 *
                 * The completed counts are constrained to the same visible set,
                 * otherwise finishing an item that was later deleted would push
                 * the percentage above 100.
                 */
                (
                    -- Completed videos/PDFs, restricted to still-visible items
                    (
                        SELECT COUNT(DISTINCT vp.content_id)
                        FROM video_progress vp
                        JOIN content_items ci ON ci.id = vp.content_id
                        JOIN modules m ON ci.id = ANY(m.content_ids)
                        WHERE vp.user_id = e.user_id
                          AND vp.is_completed = true
                          AND m.course_id = c.id
                          AND m.is_active = true
                          AND ci.is_active = true
                          AND ci.status = 'ready'
                    )
                    +
                    -- Completed quizzes
                    (
                        SELECT COUNT(DISTINCT qa.quiz_id)
                        FROM quiz_attempts qa
                        JOIN quizzes q ON q.id = qa.quiz_id
                        JOIN modules m ON m.id = q.module_id
                        WHERE m.course_id = c.id
                          AND m.is_active = true
                          AND qa.user_id = e.user_id
                          AND qa.status = 'completed'
                    )
                ) as completed_items,
                (
                    -- Total videos/PDFs the student can actually open
                    (
                        SELECT COUNT(DISTINCT ci.id)
                        FROM content_items ci
                        JOIN modules m ON ci.id = ANY(m.content_ids)
                        WHERE m.course_id = c.id
                          AND m.is_active = true
                          AND ci.is_active = true
                          AND ci.status = 'ready'
                    )
                    +
                    -- Total quizzes
                    (
                        SELECT COUNT(*)
                        FROM quizzes q
                        JOIN modules m ON m.id = q.module_id
                        WHERE m.course_id = c.id
                          AND m.is_active = true
                    )
                ) as total_items
            FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            JOIN users u ON c.educator_id = u.id
            WHERE e.user_id = $1
              AND e.status = 'active'
              -- A course the teacher deleted must leave the student's shelf.
              -- Without this it stayed listed and opened to "Course not found".
              AND c.is_active = true
            ORDER BY e.enrolled_at DESC
        `, [userId]);

        const enrollmentsWithProgress = result.rows.map(row => {
            const completed = parseInt(row.completed_items) || 0;
            const total = parseInt(row.total_items) || 0;
            // total_items now correctly counts PDFs + videos + quizzes together,
            // so a straight fraction is accurate — no more guesswork needed.
            const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

            return {
                ...row,
                progress // Inject the calculated progress field
            };
        });

        res.json({
            success: true,
            count: enrollmentsWithProgress.length,
            enrollments: enrollmentsWithProgress
        });

    } catch (err) {
        console.error("Get enrollments error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/enrollments/:courseId
router.get("/:courseId", authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;

        const result = await pool.query(`
            SELECT 
                e.*,
                c.title as course_title,
                c.description as course_description,
                c.thumbnail_url,
                c.price,
                u.name as educator_name
            FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            JOIN users u ON c.educator_id = u.id
            WHERE e.user_id = $1 AND e.course_id = $2
        `, [userId, courseId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Enrollment not found" });
        }

        res.json({
            success: true,
            enrollment: result.rows[0]
        });

    } catch (err) {
        console.error("Get enrollment details error:", err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/enrollments?courseId=xxx
router.delete("/", authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.query;
        const userId = req.user.id;

        if (!courseId) {
            return res.status(400).json({ error: "courseId is required" });
        }

        const enrollmentCheck = await pool.query(`
            SELECT id, status FROM enrollments 
            WHERE user_id = $1 AND course_id = $2
        `, [userId, courseId]);

        if (enrollmentCheck.rows.length === 0) {
            return res.status(404).json({ error: "Enrollment not found" });
        }

        if (enrollmentCheck.rows[0].status !== 'active') {
            return res.status(400).json({ error: "Enrollment is not active" });
        }

        await pool.query(`
            UPDATE enrollments 
            SET status = 'inactive', 
                updated_at = NOW()
            WHERE user_id = $1 AND course_id = $2
        `, [userId, courseId]);

        await pool.query(`
            UPDATE video_progress 
            SET updated_at = NOW()
            WHERE user_id = $1 AND course_id = $2
        `, [userId, courseId]);

        res.json({
            success: true,
            message: "Successfully unenrolled from course",
            courseId: courseId
        });

    } catch (err) {
        console.error("Delete enrollment error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/courses/:courseId/enrollments
router.get("/courses/:courseId/enrollments", authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.params;

        if (!req.isCourseCreator) {
            return res.status(403).json({
                error: "Only course creator can view enrollment list"
            });
        }

        /*
         * progress is computed, not stored.
         *
         * This query used to select e.progress and e.last_accessed. Neither
         * column exists on enrollments, so the endpoint threw
         * "column e.progress does not exist" on every call and the modal
         * showed "Could not load the student list" — the educator could never
         * see who had enrolled.
         *
         * Adding the columns would have silenced the error while reporting 0%
         * for everyone, because nothing in the codebase maintains them. The
         * student-facing list already derives progress from actual completion,
         * so this uses the same definition and the two views agree.
         */
        const result = await pool.query(`
            SELECT
                e.id as enrollment_id,
                e.user_id,
                e.status as enrollment_status,
                e.payment_status,
                e.payment_id,
                e.amount_paid,
                e.enrolled_at,
                e.expires_at,
                u.name as student_name,
                u.email as student_email,
                u.created_at as member_since,
                (
                    (
                        SELECT COUNT(DISTINCT vp.content_id)
                        FROM video_progress vp
                        JOIN content_items ci ON ci.id = vp.content_id
                        JOIN modules m ON ci.id = ANY(m.content_ids)
                        WHERE vp.user_id = e.user_id
                          AND vp.is_completed = true
                          AND m.course_id = $1
                          AND m.is_active = true
                          AND ci.is_active = true
                          AND ci.status = 'ready'
                    )
                    +
                    (
                        SELECT COUNT(DISTINCT qa.quiz_id)
                        FROM quiz_attempts qa
                        JOIN quizzes q ON q.id = qa.quiz_id
                        JOIN modules m ON m.id = q.module_id
                        WHERE m.course_id = $1
                          AND m.is_active = true
                          AND qa.user_id = e.user_id
                          AND qa.status = 'completed'
                    )
                )::int AS completed_items,
                (
                    (
                        SELECT COUNT(DISTINCT ci.id)
                        FROM content_items ci
                        JOIN modules m ON ci.id = ANY(m.content_ids)
                        WHERE m.course_id = $1
                          AND m.is_active = true
                          AND ci.is_active = true
                          AND ci.status = 'ready'
                    )
                    +
                    (
                        SELECT COUNT(*)
                        FROM quizzes q
                        JOIN modules m ON m.id = q.module_id
                        WHERE m.course_id = $1
                          AND m.is_active = true
                    )
                )::int AS total_items
            FROM enrollments e
            JOIN users u ON e.user_id = u.id
            WHERE e.course_id = $1 AND e.status = 'active'
            ORDER BY e.enrolled_at DESC
        `, [courseId]);

        const students = result.rows.map((row) => {
            const completed = Number(row.completed_items) || 0;
            const total = Number(row.total_items) || 0;
            return { ...row, progress: total > 0 ? Math.round((completed / total) * 100) : 0 };
        });

        // Derived from the same rows, so the summary cannot disagree with the
        // list beneath it.
        const avgProgress = students.length
            ? Math.round(students.reduce((sum, s) => sum + s.progress, 0) / students.length)
            : 0;

        res.json({
            success: true,
            courseId: courseId,
            statistics: {
                total_enrolled: students.length,
                avg_progress: avgProgress,
                completed_count: students.filter((s) => s.progress >= 100).length
            },
            count: students.length,
            students
        });

    } catch (err) {
        console.error("Get course enrollments error:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;