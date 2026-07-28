import express from "express";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// POST /api/video/progress
router.post("/progress", authMiddleware, async (req, res) => {
    try {
        // 🌟 FIX 1: Extract 'is_completed' from the frontend payload
        const { contentId, courseId, position, is_completed } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;

        if (!contentId || !courseId) {
            return res.status(400).json({ error: "contentId and courseId are required" });
        }

        const isAdmin = userRole === 'admin';

        // Check if the user is the creator of the course
        const courseCheck = await pool.query(
            `SELECT educator_id FROM courses WHERE id = $1`,
            [courseId]
        );
        const isCreator = courseCheck.rows.length > 0 &&
            (userRole === 'educator' && courseCheck.rows[0].educator_id === userId);

        // 🌟 FIX 2: Do NOT throw a 404 error here if the item is a PDF or Quiz.
        // We gracefully check if it's a video, but allow other content types to pass.
        const contentCheck = await pool.query(
            `SELECT preview, duration_seconds FROM content_items WHERE id = $1 AND is_active = true`,
            [contentId]
        );

        let isPreviewVideo = false;
        let videoDuration = 0;

        if (contentCheck.rows.length > 0) {
            isPreviewVideo = contentCheck.rows[0].preview === true;
            videoDuration = contentCheck.rows[0].duration_seconds || 0;
        }

        // Enforce active course enrollment validation checks
        if (!isAdmin && !isCreator && !isPreviewVideo) {
            const enrollmentCheck = await pool.query(
                `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
                [userId, courseId]
            );

            if (enrollmentCheck.rows.length === 0) {
                return res.status(403).json({ error: "Not authorized or enrolled in this course" });
            }
        }

        // 🌟 FIX 3: Trust the frontend's is_completed flag for PDFs/Quizzes!
        const finalIsCompleted = (is_completed === true) || (videoDuration > 0 && (position >= videoDuration - 5));

        // Upsert progress cleanly
        await pool.query(`
            INSERT INTO video_progress (user_id, content_id, course_id, position, is_completed, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (user_id, content_id) 
            DO UPDATE SET 
                position = EXCLUDED.position,
                is_completed = CASE WHEN video_progress.is_completed = true THEN true ELSE EXCLUDED.is_completed END,
                updated_at = NOW()
        `, [userId, contentId, courseId, position || 100, finalIsCompleted]);

        res.json({
            success: true,
            message: "Progress saved",
            isCompleted: finalIsCompleted
        });

    } catch (err) {
        console.error("Save progress error:", err.message, "| code:", err.code, "| detail:", err.detail);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/video/progress/course/:courseId
// 🌟 PROGRESS TRACKING: bulk fetch so the curriculum view can mark every
// completed video/PDF at once instead of one request per content item.
// NOTE: must be declared before "/progress/:contentId" or Express will treat
// "course" as a contentId value.
router.get("/progress/course/:courseId", authMiddleware, async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;

        const result = await pool.query(`
            SELECT content_id, is_completed, position, updated_at
            FROM video_progress
            WHERE user_id = $1 AND course_id = $2
        `, [userId, courseId]);

        const completedContentIds = result.rows
            .filter(r => r.is_completed)
            .map(r => r.content_id);

        res.json({
            success: true,
            progress: result.rows,
            completedContentIds
        });
    } catch (err) {
        console.error("Get course progress error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/video/progress/:contentId
router.get("/progress/:contentId", authMiddleware, async (req, res) => {
    try {
        const { contentId } = req.params;
        const { courseId } = req.query;
        const userId = req.user.id;
        const userRole = req.user.role;

        if (!courseId) {
            return res.status(400).json({ error: "courseId query parameter is required for access verification" });
        }

        const isAdmin = userRole === 'admin';

        const courseCheck = await pool.query(
            `SELECT educator_id FROM courses WHERE id = $1`,
            [courseId]
        );
        const isCreator = courseCheck.rows.length > 0 &&
            (userRole === 'educator' && courseCheck.rows[0].educator_id === userId);

        const contentCheck = await pool.query(
            `SELECT preview FROM content_items WHERE id = $1 AND is_active = true`,
            [contentId]
        );

        const isPreviewVideo = contentCheck.rows.length > 0 && contentCheck.rows[0].preview === true;

        if (!isAdmin && !isCreator && !isPreviewVideo) {
            const enrollmentCheck = await pool.query(
                `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
                [userId, courseId]
            );

            if (enrollmentCheck.rows.length === 0) {
                return res.status(403).json({ error: "Not authorized to read watch history records for this course" });
            }
        }

        const result = await pool.query(`
            SELECT position, is_completed, updated_at
            FROM video_progress
            WHERE user_id = $1 AND content_id = $2
        `, [userId, contentId]);

        if (result.rows.length === 0) {
            return res.json({
                hasProgress: false,
                position: 0,
                isCompleted: false
            });
        }

        res.json({
            hasProgress: true,
            position: result.rows[0].position,
            isCompleted: result.rows[0].is_completed || false,
            lastUpdated: result.rows[0].updated_at
        });

    } catch (err) {
        console.error("Get progress error:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;