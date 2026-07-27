import pool from "./config/database.js";

async function migrateQuizTables() {
    try {
        console.log("📦 Creating quiz tables...");

        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                score DECIMAL(5,2) DEFAULT 0,
                total_questions INT DEFAULT 0,
                correct_answers INT DEFAULT 0,
                answers JSONB DEFAULT '{}',
                time_taken INT DEFAULT 0,
                status VARCHAR(50) DEFAULT 'completed',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(quiz_id, user_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_answers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
                question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
                selected_option INT,
                is_correct BOOLEAN DEFAULT FALSE,
                answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(attempt_id, question_id)
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id);
            CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id);
            CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt_id ON quiz_answers(attempt_id);
        `);

        try {
            await pool.query(`
                ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS folder_id UUID DEFAULT NULL
            `);
        } catch (e) {}

        try {
            await pool.query(`
                ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS time_limit INT DEFAULT NULL
            `);
        } catch (e) {}

        console.log("✅ Quiz tables created successfully!");
    } catch (err) {
        console.error("❌ Migration error:", err);
    } finally {
        await pool.end();
    }
}

migrateQuizTables();
