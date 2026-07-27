import pool from "./config/database.js";

async function migrateTestTables() {
    try {
        console.log("📦 Creating test tables...");

        await pool.query(`
            CREATE TABLE IF NOT EXISTS test_files (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                file_name VARCHAR(512) NOT NULL,
                file_size_bytes BIGINT,
                r2_key VARCHAR(1024) NOT NULL,
                folder_id UUID DEFAULT NULL,
                status VARCHAR(50) DEFAULT 'ready',
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_test_files_module_id ON test_files(module_id);
        `);

        console.log("✅ Test tables created successfully!");
    } catch (err) {
        console.error("❌ Migration error:", err);
    } finally {
        await pool.end();
    }
}

migrateTestTables();
