import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Import routes
import authRoutes from "./routes/auth.js";
import courseRoutes from "./routes/courses.js";
import moduleRoutes from "./routes/modules.js";
import contentRoutes from "./routes/content.js";
import paymentRoutes from "./routes/payments.js";
import enrollmentRoutes from "./routes/enrollments.js";
import videoRoutes from "./routes/video.js";
import analyticsRoutes from "./routes/analytics.js";
import quizRoutes from "./routes/quiz.js";        // ✅ Quiz routes
import testRoutes from "./routes/test.js";        // ✅ Test routes (NEW)

// Import config
import pool from "./config/database.js";
import { r2Client, R2_BUCKET_NAME } from "./config/r2.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_VIDEO_DIR = path.join(__dirname, "temp_videos");

if (!fs.existsSync(TEMP_VIDEO_DIR)) {
    fs.mkdirSync(TEMP_VIDEO_DIR, { recursive: true });
}

// ============================================
// Database Schema Setup
// ============================================
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'student',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            INSERT INTO users (id, email, password_hash, name, role)
            VALUES ('11111111-1111-1111-1111-111111111111', 'educator@example.com', 'hashed_password', 'Default Educator', 'educator')
            ON CONFLICT (id) DO NOTHING
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                educator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                thumbnail_url TEXT,
                price DECIMAL(10,2) DEFAULT 0,
                status VARCHAR(50) DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                deleted_at TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS content_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR(512) NOT NULL,
                description TEXT,
                content_type VARCHAR(50) NOT NULL,
                file_hash VARCHAR(64) UNIQUE,
                file_name VARCHAR(512),
                file_size_bytes BIGINT,
                mime_type VARCHAR(127),
                r2_key VARCHAR(1024),
                duration_seconds INT,
                thumbnail_url TEXT,
                status VARCHAR(50) DEFAULT 'processing',
                metadata JSONB DEFAULT '{}',
                created_by UUID REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_published BOOLEAN DEFAULT TRUE,
                preview BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                deleted_at TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS modules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                module_order INT DEFAULT 0,
                content_ids UUID[] DEFAULT '{}',
                is_published BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                deleted_at TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_orders (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                order_id VARCHAR(255) UNIQUE NOT NULL,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
                amount DECIMAL(10,2),
                currency VARCHAR(3) DEFAULT 'INR',
                status VARCHAR(50) DEFAULT 'created',
                razorpay_payment_id VARCHAR(255) UNIQUE,
                razorpay_signature VARCHAR(512),
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS video_progress (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
                course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                position INT DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, content_id)
            )
        `);

        // ============================================
        // QUIZ TABLES
        // ============================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quizzes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                created_by UUID REFERENCES users(id),
                folder_id UUID DEFAULT NULL,
                time_limit INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_questions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
                question_text TEXT NOT NULL,
                options JSONB NOT NULL,
                correct_option_index INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ============================================
        // QUIZ ATTEMPT TABLES
        // ============================================
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

        // ============================================
        // TEST FILES TABLE
        // ============================================
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

        // ============================================
        // INDEXES
        // ============================================
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_modules_course_id ON modules(course_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_content_items_hash ON content_items(file_hash)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_courses_educator_id ON courses(educator_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_orders_order_id ON payment_orders(order_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_video_progress_user_content ON video_progress(user_id, content_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_quizzes_module_id ON quizzes(module_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_id ON quiz_questions(quiz_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt_id ON quiz_answers(attempt_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_files_module_id ON test_files(module_id)`);

        console.log("✅ Database schema ready");
    } catch (err) {
        console.error("❌ Database setup error:", err);
    }
}

setupDatabase();

// ============================================
// CORS Middleware (MUST BE FIRST!)
// ============================================
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:3000', 'https://sv.gridsphere.in', 'http://localhost:5174'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors({
    origin: true, // ✅ Dynamically reflects the incoming request origin (bulletproof for dev & prod)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true,
    optionsSuccessStatus: 200
}));

// ============================================
// Body Parsers & Security Headers
// ============================================
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/temp_videos', express.static(path.join(__dirname, 'temp_videos')));

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self' http://localhost:5173 https://sv.gridsphere.in");
    next();
});

// ============================================
// Routes
// ============================================
app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/quiz", quizRoutes);      // ✅ Quiz routes
app.use("/api/test", testRoutes);      // ✅ Test routes (NEW)

// ============================================
// HLS Proxy Route
// ============================================
app.get("/api/hls/serve", async (req, res) => {
    try {
        const { videoId, path: hlsPathRaw } = req.query;
        if (!videoId || !hlsPathRaw) return res.status(400).send("Missing videoId or path");

        const hlsPath = hlsPathRaw;
        if (hlsPath.includes("..")) return res.status(400).send("Invalid path");

        const result = await pool.query(
            `SELECT r2_key, status FROM content_items WHERE id = $1`,
            [videoId]
        );
        if (result.rows.length === 0) return res.status(404).send("Content not found");

        const content = result.rows[0];
        if (content.status !== "ready") return res.status(202).send("Video still processing");
        if (!content.r2_key) return res.status(404).send("Manifest not found");

        const r2Base = content.r2_key.replace(/\/master\.m3u8$/, "");
        const r2Key = hlsPath === "master.m3u8" ? content.r2_key : `${r2Base}/${hlsPath}`;

        console.log(`HLS: ${videoId} → ${r2Key}`);

        let r2Response;
        try {
            const { GetObjectCommand } = await import("@aws-sdk/client-s3");
            r2Response = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key }));
        } catch (err) {
            if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
                console.error(`R2 not found: ${r2Key}`);
                return res.status(404).send(`Not found: ${hlsPath}`);
            }
            throw err;
        }

        const isM3u8 = hlsPath.endsWith(".m3u8");
        const isTs = hlsPath.endsWith(".ts");

        res.setHeader("Content-Type",
            isM3u8 ? "application/vnd.apple.mpegurl"
                : isTs ? "video/mp2t"
                    : "application/octet-stream"
        );
        res.setHeader("Cache-Control", "no-cache, no-store, private");
        res.setHeader("Access-Control-Allow-Origin", "*");
        
        if (r2Response.ContentLength) {
            res.setHeader("Content-Length", r2Response.ContentLength);
        }
        if (isTs) {
            r2Response.Body.pipe(res);
            return;
        }

        const chunks = [];
        for await (const chunk of r2Response.Body) chunks.push(chunk);
        let manifest = Buffer.concat(chunks).toString("utf-8");

        const currentDir = hlsPath.includes("/")
            ? hlsPath.substring(0, hlsPath.lastIndexOf("/") + 1)
            : "";

        const rewritten = manifest.split("\n").map(line => {
            const t = line.trim();
            if (!t || t.startsWith("#")) return line;
            if (t.startsWith("/api/") || t.startsWith("http")) return line;

            const fullPath = currentDir + t;
            return `/api/hls/serve?videoId=${videoId}&path=${encodeURIComponent(fullPath)}`;
        });

        res.send(rewritten.join("\n"));

    } catch (err) {
        console.error("HLS proxy error:", err);
        res.status(500).send("Proxy error: " + err.message);
    }
});

// ============================================
// Monitoring & Health
// ============================================
app.get("/api/transcode/active", (req, res) => {
    res.json({ success: true, activeJobs: [], count: 0 });
});

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", database: "connected", r2: "configured" });
    } catch (err) {
        res.status(500).json({ status: "error", database: "disconnected", error: err.message });
    }
});

// ============================================
// Error Handling
// ============================================
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
});

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Temp:   ${TEMP_VIDEO_DIR}`);
    console.log(`☁️  R2:     ${R2_BUCKET_NAME}`);
    console.log(`📁 Routes loaded:`);
    console.log(`   - /api/auth`);
    console.log(`   - /api/courses`);
    console.log(`   - /api/modules`);
    console.log(`   - /api/content`);
    console.log(`   - /api/payments`);
    console.log(`   - /api/enrollments`);
    console.log(`   - /api/video`);
    console.log(`   - /api/analytics`);
    console.log(`   - /api/quiz`);
    console.log(`   - /api/test`);  // ✅ Added test route
    console.log(`${"=".repeat(70)}\n`);
});