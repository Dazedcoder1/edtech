import pool from "./config/database.js";

async function migrateProgress() {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS content_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
        content_id UUID NOT NULL,
        is_completed BOOLEAN DEFAULT true,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, content_id)
      )
    `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_content_progress_course ON content_progress(course_id, user_id)`);
        console.log("✅ content_progress table created");
    } catch (err) {
        console.error("❌ Migration error:", err);
    } finally {
        await pool.end();
    }
}
migrateProgress();