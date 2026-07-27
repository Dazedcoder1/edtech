// edtech/routes/quiz.js (enhanced version)
import express from "express";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// ============================================================
// CREATE QUIZ (existing code with folder_id support)
// ============================================================
router.post("/create", authMiddleware, async (req, res) => {
    const { moduleId, title, description, questions, folder_id } = req.body;

    if (!moduleId || !title || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: "moduleId, title and at least one question are required" });
    }

    const moduleCheck = await pool.query(`
        SELECT c.educator_id
        FROM modules m
        JOIN courses c ON m.course_id = c.id
        WHERE m.id = $1 AND m.is_active = true
    `, [moduleId]);

    if (moduleCheck.rows.length === 0) {
        return res.status(404).json({ error: "Module not found" });
    }
    if (moduleCheck.rows[0].educator_id !== req.user.id) {
        return res.status(403).json({ error: "Only the course creator can add quizzes" });
    }

    for (const q of questions) {
        if (!q.question_text || !Array.isArray(q.options) || q.options.length < 2) {
            return res.status(400).json({ error: "Each question needs text and at least 2 options" });
        }
        if (
            typeof q.correct_option_index !== "number" ||
            q.correct_option_index < 0 ||
            q.correct_option_index >= q.options.length
        ) {
            return res.status(400).json({ error: "Each question needs a valid correct_option_index" });
        }
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const quizResult = await client.query(`
            INSERT INTO quizzes (module_id, title, description, created_by, folder_id)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [moduleId, title, description || "", req.user.id, folder_id || null]);

        const quiz = quizResult.rows[0];

        for (const q of questions) {
            await client.query(`
                INSERT INTO quiz_questions (quiz_id, question_text, options, correct_option_index)
                VALUES ($1, $2, $3, $4)
            `, [quiz.id, q.question_text, JSON.stringify(q.options), q.correct_option_index]);
        }

        await client.query("COMMIT");
        res.status(201).json({ success: true, quiz });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Quiz create error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================
// SUBMIT QUIZ ANSWER (per question)
// ============================================================
router.post("/:quizId/answer", authMiddleware, async (req, res) => {
    try {
        const { quizId } = req.params;
        const { questionId, selectedOption } = req.body;
        const userId = req.user.id;

        // Check if user has permission
        const quizCheck = await pool.query(`
            SELECT c.id AS course_id, c.educator_id 
            FROM quizzes q
            JOIN modules m ON q.module_id = m.id
            JOIN courses c ON m.course_id = c.id
            WHERE q.id = $1
        `, [quizId]);

        if (quizCheck.rows.length === 0) {
            return res.status(404).json({ error: "Quiz not found" });
        }

        const isOwner = quizCheck.rows[0].educator_id === userId;
        if (!isOwner) {
            const enrollCheck = await pool.query(
                `SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
                [userId, quizCheck.rows[0].course_id]
            );
            if (enrollCheck.rows.length === 0) {
                return res.status(403).json({ error: "Access denied. You must be enrolled." });
            }
        }

        // Get question details
        const questionResult = await pool.query(`
            SELECT id, correct_option_index
            FROM quiz_questions
            WHERE id = $1 AND quiz_id = $2
        `, [questionId, quizId]);

        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: "Question not found" });
        }

        const question = questionResult.rows[0];
        const isCorrect = selectedOption === question.correct_option_index;

        // Get or create attempt
        let attemptResult = await pool.query(`
            SELECT id FROM quiz_attempts 
            WHERE quiz_id = $1 AND user_id = $2 AND status = 'in_progress'
        `, [quizId, userId]);

        let attemptId;
        if (attemptResult.rows.length === 0) {
            const newAttempt = await pool.query(`
                INSERT INTO quiz_attempts (quiz_id, user_id, status, started_at)
                VALUES ($1, $2, 'in_progress', NOW())
                RETURNING id
            `, [quizId, userId]);
            attemptId = newAttempt.rows[0].id;
        } else {
            attemptId = attemptResult.rows[0].id;
        }

        // Save the answer
        await pool.query(`
            INSERT INTO quiz_answers (attempt_id, question_id, selected_option, is_correct, answered_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (attempt_id, question_id) 
            DO UPDATE SET 
                selected_option = EXCLUDED.selected_option,
                is_correct = EXCLUDED.is_correct,
                answered_at = NOW()
        `, [attemptId, questionId, selectedOption, isCorrect]);

        // Update attempt stats incrementally
        await pool.query(`
            UPDATE quiz_attempts 
            SET correct_answers = (
                SELECT COUNT(*) FROM quiz_answers 
                WHERE attempt_id = $1 AND is_correct = true
            ),
            total_questions = (
                SELECT COUNT(*) FROM quiz_questions 
                WHERE quiz_id = $2
            ),
            updated_at = NOW()
            WHERE id = $1
        `, [attemptId, quizId]);

        res.json({
            success: true,
            isCorrect,
            attemptId
        });

    } catch (err) {
        console.error("Quiz answer error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// SUBMIT QUIZ (finalize)
// ============================================================
router.post("/:quizId/submit", authMiddleware, async (req, res) => {
    try {
        const { quizId } = req.params;
        const userId = req.user.id;

        // Get or create attempt
        const attemptResult = await pool.query(`
            SELECT id, correct_answers, total_questions
            FROM quiz_attempts 
            WHERE quiz_id = $1 AND user_id = $2 AND status = 'in_progress'
        `, [quizId, userId]);

        if (attemptResult.rows.length === 0) {
            return res.status(404).json({ error: "No attempt found" });
        }

        const attempt = attemptResult.rows[0];
        const score = attempt.total_questions > 0 
            ? Math.round((attempt.correct_answers / attempt.total_questions) * 100)
            : 0;

        // Mark attempt as completed
        await pool.query(`
            UPDATE quiz_attempts 
            SET 
                status = 'completed',
                score = $1,
                completed_at = NOW()
            WHERE id = $2
        `, [score, attempt.id]);

        res.json({
            success: true,
            attemptId: attempt.id,
            total: attempt.total_questions,
            correct: attempt.correct_answers,
            score
        });

    } catch (err) {
        console.error("Quiz submit error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET QUIZ ATTEMPT HISTORY
// ============================================================
router.get("/:quizId/attempts", authMiddleware, async (req, res) => {
    try {
        const { quizId } = req.params;
        const userId = req.user.id;

        // Check if user is owner
        const quizCheck = await pool.query(`
            SELECT c.educator_id
            FROM quizzes q
            JOIN modules m ON q.module_id = m.id
            JOIN courses c ON m.course_id = c.id
            WHERE q.id = $1
        `, [quizId]);

        const isOwner = quizCheck.rows.length > 0 && quizCheck.rows[0].educator_id === userId;

        if (!isOwner) {
            // Students can only see their own attempts
            const result = await pool.query(`
                SELECT 
                    id, score, total_questions, correct_answers,
                    started_at, completed_at, status
                FROM quiz_attempts
                WHERE quiz_id = $1 AND user_id = $2
                ORDER BY started_at DESC
            `, [quizId, userId]);

            return res.json({
                success: true,
                attempts: result.rows,
                isOwner: false
            });
        }

        // Owner can see all attempts with user details
        const result = await pool.query(`
            SELECT 
                qa.*,
                u.name as student_name,
                u.email as student_email
            FROM quiz_attempts qa
            JOIN users u ON qa.user_id = u.id
            WHERE qa.quiz_id = $1
            ORDER BY qa.started_at DESC
        `, [quizId]);

        res.json({
            success: true,
            attempts: result.rows,
            isOwner: true
        });

    } catch (err) {
        console.error("Get quiz attempts error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET QUIZ ATTEMPT DETAILS (with answers)
// ============================================================
router.get("/attempt/:attemptId", authMiddleware, async (req, res) => {
    try {
        const { attemptId } = req.params;
        const userId = req.user.id;

        const attemptResult = await pool.query(`
            SELECT qa.*, q.title as quiz_title, q.id as quiz_id
            FROM quiz_attempts qa
            JOIN quizzes q ON qa.quiz_id = q.id
            JOIN modules m ON q.module_id = m.id
            JOIN courses c ON m.course_id = c.id
            WHERE qa.id = $1
        `, [attemptId]);

        if (attemptResult.rows.length === 0) {
            return res.status(404).json({ error: "Attempt not found" });
        }

        const attempt = attemptResult.rows[0];
        const isOwner = attempt.user_id === userId || attempt.educator_id === userId;

        if (!isOwner && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Access denied" });
        }

        // Get all answers with question details
        const answersResult = await pool.query(`
            SELECT 
                qa.*,
                qq.question_text,
                qq.options,
                qq.correct_option_index
            FROM quiz_answers qa
            JOIN quiz_questions qq ON qa.question_id = qq.id
            WHERE qa.attempt_id = $1
            ORDER BY qq.created_at ASC
        `, [attemptId]);

        res.json({
            success: true,
            attempt,
            answers: answersResult.rows
        });

    } catch (err) {
        console.error("Get attempt details error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET QUIZ (existing - with attempt status)
// ============================================================
router.get("/:quizId", authMiddleware, async (req, res) => {
    try {
        const { quizId } = req.params;

        const quizResult = await pool.query(`
            SELECT q.*, c.id AS course_id, c.educator_id
            FROM quizzes q
            JOIN modules m ON q.module_id = m.id
            JOIN courses c ON m.course_id = c.id
            WHERE q.id = $1
        `, [quizId]);

        if (quizResult.rows.length === 0) {
            return res.status(404).json({ error: "Quiz not found" });
        }

        const quiz = quizResult.rows[0];
        const isOwner = quiz.educator_id === req.user.id;

        // Check enrollment for students
        if (!isOwner && req.user.role === 'student') {
            const enrollCheck = await pool.query(
                `SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
                [req.user.id, quiz.course_id]
            );
            if (enrollCheck.rows.length === 0) {
                return res.status(403).json({ error: "Access denied. You must be enrolled to take this quiz." });
            }
        }

        // Get questions (hide correct answers for students)
        const questionsResult = await pool.query(`
            SELECT id, question_text, options, correct_option_index
            FROM quiz_questions WHERE quiz_id = $1 ORDER BY created_at ASC
        `, [quizId]);

        const questions = questionsResult.rows.map((q) => ({
            id: q.id,
            question_text: q.question_text,
            options: q.options,
            ...(isOwner ? { correct_option_index: q.correct_option_index } : {})
        }));

        // Check if user has an in-progress attempt
        let attempt = null;
        if (!isOwner) {
            const attemptResult = await pool.query(`
                SELECT id, answers, started_at, status
                FROM quiz_attempts
                WHERE quiz_id = $1 AND user_id = $2 AND status = 'in_progress'
                ORDER BY started_at DESC LIMIT 1
            `, [quizId, req.user.id]);
            
            if (attemptResult.rows.length > 0) {
                attempt = attemptResult.rows[0];
            }
        }

        res.json({
            success: true,
            quiz: { 
                id: quiz.id, 
                title: quiz.title, 
                description: quiz.description, 
                module_id: quiz.module_id, 
                folder_id: quiz.folder_id 
            },
            questions,
            isOwner,
            attempt
        });

    } catch (err) {
        console.error("Quiz fetch error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE QUIZ (existing)
// ============================================================
router.delete("/:quizId", authMiddleware, async (req, res) => {
    try {
        const { quizId } = req.params;

        const quizCheck = await pool.query(`
            SELECT c.educator_id
            FROM quizzes q
            JOIN modules m ON q.module_id = m.id
            JOIN courses c ON m.course_id = c.id
            WHERE q.id = $1
        `, [quizId]);

        if (quizCheck.rows.length === 0) {
            return res.status(404).json({ error: "Quiz not found" });
        }
        if (quizCheck.rows[0].educator_id !== req.user.id) {
            return res.status(403).json({ error: "Only the course creator can delete this quiz" });
        }

        await pool.query(`DELETE FROM quizzes WHERE id = $1`, [quizId]);
        res.json({ success: true, message: "Quiz deleted" });
    } catch (err) {
        console.error("Quiz delete error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET QUIZZES FOR MODULE (existing)
// ============================================================
router.get("/module/:moduleId", authMiddleware, async (req, res) => {
    try {
        const { moduleId } = req.params;
        const result = await pool.query(`
            SELECT q.id, q.title, q.description, q.created_at, q.folder_id,
                   COUNT(qq.id)::int AS question_count
            FROM quizzes q
            LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
            WHERE q.module_id = $1
            GROUP BY q.id
            ORDER BY q.created_at DESC
        `, [moduleId]);

        res.json({ success: true, quizzes: result.rows });
    } catch (err) {
        console.error("Quiz list error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET QUIZ SCORE SUMMARY (for dashboard)
// ============================================================
router.get("/summary/:quizId", authMiddleware, async (req, res) => {
    try {
        const { quizId } = req.params;
        const userId = req.user.id;

        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_attempts,
                AVG(score) as avg_score,
                MAX(score) as highest_score,
                MIN(score) as lowest_score,
                (
                    SELECT score FROM quiz_attempts 
                    WHERE quiz_id = $1 AND user_id = $2
                    ORDER BY completed_at DESC LIMIT 1
                ) as user_last_score,
                (
                    SELECT id FROM quiz_attempts 
                    WHERE quiz_id = $1 AND user_id = $2 AND status = 'completed'
                    ORDER BY completed_at DESC LIMIT 1
                ) as user_last_attempt_id
            FROM quiz_attempts
            WHERE quiz_id = $1 AND status = 'completed'
        `, [quizId, userId]);

        res.json({
            success: true,
            summary: result.rows[0] || { total_attempts: 0, avg_score: 0 }
        });

    } catch (err) {
        console.error("Quiz summary error:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;