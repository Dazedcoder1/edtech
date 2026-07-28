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
                c.title as course_title,
                c.description as course_description,
                c.thumbnail_url,
                c.price as course_price,
                c.status as course_status,
                u.name as educator_name,
                (
                    -- Completed PDFs/videos
                    (
                        SELECT COUNT(DISTINCT vp.content_id)
                        FROM video_progress vp
                        WHERE vp.course_id = c.id AND vp.user_id = e.user_id AND vp.is_completed = true
                    )
                    +
                    -- Completed quizzes (🌟 FIX: these were never counted before)
                    (
                        SELECT COUNT(DISTINCT qa.quiz_id)
                        FROM quiz_attempts qa
                        JOIN quizzes q ON q.id = qa.quiz_id
                        JOIN modules m ON m.id = q.module_id
                        WHERE m.course_id = c.id AND qa.user_id = e.user_id AND qa.status = 'completed'
                    )
                ) as completed_items,
                (
                    -- Total PDFs/videos
                    (
                        SELECT COALESCE(SUM(cardinality(m.content_ids)), 0)
                        FROM modules m
                        WHERE m.course_id = c.id
                    )
                    +
                    -- Total quizzes (🌟 FIX: these were never counted before)
                    (
                        SELECT COUNT(*)
                        FROM quizzes q
                        JOIN modules m ON m.id = q.module_id
                        WHERE m.course_id = c.id
                    )
                ) as total_items
            FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            JOIN users u ON c.educator_id = u.id
            WHERE e.user_id = $1 AND e.status = 'active'
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

        const result = await pool.query(`
            SELECT 
                e.id as enrollment_id,
                e.user_id,
                e.status as enrollment_status,
                e.payment_status,
                e.payment_id,
                e.amount_paid,
                e.enrolled_at,
                e.progress,
                e.last_accessed,
                u.name as student_name,
                u.email as student_email,
                u.created_at as member_since
            FROM enrollments e
            JOIN users u ON e.user_id = u.id
            WHERE e.course_id = $1 AND e.status = 'active'
            ORDER BY e.enrolled_at DESC
        `, [courseId]);

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_enrolled,
                COALESCE(AVG(progress), 0) as avg_progress,
                COUNT(CASE WHEN progress = 100 THEN 1 END) as completed_count
            FROM enrollments
            WHERE course_id = $1 AND status = 'active'
        `, [courseId]);

        res.json({
            success: true,
            courseId: courseId,
            statistics: {
                total_enrolled: parseInt(stats.rows[0].total_enrolled),
                avg_progress: Math.round(stats.rows[0].avg_progress),
                completed_count: parseInt(stats.rows[0].completed_count)
            },
            count: result.rows.length,
            students: result.rows
        });

    } catch (err) {
        console.error("Get course enrollments error:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;