/**
 * The student home screen, in one request.
 *
 * Everything here could be assembled from existing endpoints, but the home
 * screen is the first thing loaded after sign-in and on a phone connection
 * four round trips is the difference between "instant" and "loading". One
 * query set, one response.
 */
import express from "express";
import pool from "../config/database.js";
import { authOnly as authMiddleware } from "../middleware/auth.js";
import { activeEnrolmentSql } from "../utils/enrollmentAccess.js";

const router = express.Router();

/**
 * Consecutive days ending today or yesterday.
 *
 * Yesterday counts as unbroken: a streak that dies at midnight punishes
 * someone who studies every evening for looking at 11pm one day and 1am the
 * next. It breaks only once a full day has passed with nothing.
 *
 * @param {string[]} isoDays distinct activity days, newest first, as YYYY-MM-DD
 */
export function streakFromDays(isoDays, today = new Date()) {
    if (!isoDays || isoDays.length === 0) return 0;

    const dayMs = 86_400_000;
    const asUtcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const todayNum = asUtcDay(today);

    // Parsed as UTC midnights so daylight-saving shifts cannot make two
    // adjacent days look 23 or 25 hours apart and break the arithmetic.
    const days = [...new Set(isoDays)]
        .map((s) => {
            const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
            return Date.UTC(y, m - 1, d);
        })
        .sort((a, b) => b - a);

    const gapFromToday = (todayNum - days[0]) / dayMs;
    if (gapFromToday > 1) return 0;

    let streak = 1;
    for (let i = 1; i < days.length; i++) {
        if ((days[i - 1] - days[i]) / dayMs === 1) streak++;
        else break;
    }
    return streak;
}

/**
 * GET /api/home
 *
 * Scoped entirely to req.user.id. There is no id parameter anywhere in this
 * route by design — a home screen that can be asked about somebody else is a
 * data leak waiting for the first person who edits a URL.
 */
router.get("/", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        /*
         * Activity days come from what students actually do: watch video and
         * take quizzes. Both tables already carry timestamps, so a streak needs
         * no new tracking — and one built on a fresh table would have started
         * at zero for everyone on the day it shipped.
         */
        const activity = await pool.query(`
            SELECT DISTINCT day::text AS day FROM (
                SELECT DATE(updated_at) AS day FROM video_progress WHERE user_id = $1
                UNION
                SELECT DATE(completed_at) AS day FROM quiz_attempts
                 WHERE user_id = $1 AND completed_at IS NOT NULL
            ) AS days
            WHERE day IS NOT NULL
            ORDER BY day DESC
            LIMIT 400
        `, [userId]);

        /*
         * Enrolled courses with progress.
         *
         * Progress is computed rather than stored: there is no progress column
         * on enrollments, and an earlier attempt to select one made every
         * request fail. Counting distinct watched videos against the course's
         * total gives the same figure from rows that exist.
         */
        const courses = await pool.query(`
            SELECT
                c.id,
                c.title,
                c.description,
                c.thumbnail_url,
                c.price,
                e.enrolled_at,
                e.expires_at,
                parent.title AS parent_title,
                (SELECT COUNT(*)::int FROM modules m
                  WHERE m.course_id = c.id AND m.is_active = true) AS module_count,
                (SELECT COUNT(*)::int
                   FROM content_items ci
                   JOIN modules m ON ci.id = ANY(m.content_ids)
                  WHERE m.course_id = c.id AND ci.is_active = true
                    AND ci.content_type = 'video' AND ci.status = 'ready') AS video_count,
                (SELECT COUNT(DISTINCT vp.content_id)::int FROM video_progress vp
                  WHERE vp.user_id = $1 AND vp.course_id = c.id) AS videos_watched,
                (SELECT COUNT(DISTINCT e2.user_id)::int FROM enrollments e2
                  WHERE e2.course_id = c.id AND e2.status = 'active') AS student_count
            FROM enrollments e
            JOIN courses c ON c.id = e.course_id
            LEFT JOIN courses parent ON parent.id = c.parent_course_id
            WHERE e.user_id = $1
              AND ${activeEnrolmentSql('e')}
              AND c.is_active = true
            ORDER BY e.enrolled_at DESC
        `, [userId]);

        /*
         * Counts behind the quick-action tiles.
         *
         * Restricted to courses this student can currently open, so a tile
         * never advertises material behind a lapsed enrolment.
         */
        const counts = await pool.query(`
            WITH mine AS (
                SELECT c.id FROM enrollments e
                JOIN courses c ON c.id = e.course_id
                WHERE e.user_id = $1 AND ${activeEnrolmentSql('e')} AND c.is_active = true
            )
            SELECT
                (SELECT COUNT(*)::int
                   FROM content_items ci
                   JOIN modules m ON ci.id = ANY(m.content_ids)
                  WHERE m.course_id IN (SELECT id FROM mine)
                    AND ci.is_active = true AND ci.content_type <> 'video'
                    AND ci.status = 'ready') AS notes_count,
                (SELECT COUNT(*)::int
                   FROM quizzes q
                   JOIN modules m ON m.id = q.module_id
                  WHERE m.course_id IN (SELECT id FROM mine)) AS quiz_count,
                (SELECT COUNT(*)::int
                   FROM quiz_attempts qa
                   JOIN quizzes q ON q.id = qa.quiz_id
                   JOIN modules m ON m.id = q.module_id
                  WHERE qa.user_id = $1 AND m.course_id IN (SELECT id FROM mine)
                    AND qa.status = 'completed') AS quizzes_done
        `, [userId]);

        const days = activity.rows.map((r) => r.day);

        res.json({
            success: true,
            streak: streakFromDays(days),
            activeDays: days.length,
            courses: courses.rows,
            counts: counts.rows[0] ?? { notes_count: 0, quiz_count: 0, quizzes_done: 0 },
        });
    } catch (err) {
        console.error("GET /home:", err);
        res.status(500).json({ error: "Could not load your home page" });
    }
});

export default router;
