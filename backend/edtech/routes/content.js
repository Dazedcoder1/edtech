import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import pool from "../config/database.js";
import { r2Client, R2_BUCKET_NAME } from "../config/r2.js";
import authMiddleware from "../middleware/auth.js";
import { generateFileHash, getFileExtension, getMimeType } from "../utils/helpers.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_VIDEO_DIR = path.join(__dirname, "../temp_videos");

/**
 * Resolve the ffmpeg / ffprobe binaries.
 *
 * They were spawned by bare name, which requires a system-wide FFmpeg on PATH.
 * package.json already depends on @ffmpeg-installer/ffmpeg and
 * @ffprobe-installer/ffprobe, which ship the binary and expose its path — so
 * on a machine without FFmpeg installed, every transcode died with ENOENT and
 * the video was marked 'failed', with the fix sitting unused in node_modules.
 *
 * Falls back to the bare name so a system install still wins if those packages
 * are ever removed.
 */
async function resolveBinary(installerPackage, fallbackName) {
    try {
        const mod = await import(installerPackage);
        const resolved = mod.default?.path || mod.path;
        if (resolved && fs.existsSync(resolved)) {
            console.log(`ffmpeg-tools: using bundled ${fallbackName} at ${resolved}`);
            return resolved;
        }
    } catch (err) {
        console.warn(`ffmpeg-tools: could not load ${installerPackage} (${err.message}); falling back to PATH.`);
    }
    console.log(`ffmpeg-tools: ${fallbackName} falling back to PATH`);
    return fallbackName;
}

const FFMPEG_PATH = await resolveBinary("@ffmpeg-installer/ffmpeg", "ffmpeg");
const FFPROBE_PATH = await resolveBinary("@ffprobe-installer/ffprobe", "ffprobe");

if (!fs.existsSync(TEMP_VIDEO_DIR)) fs.mkdirSync(TEMP_VIDEO_DIR, { recursive: true });

// Small assets (PDFs/images) stay in memory — fine at these sizes.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// 🚀 RESTORED: Videos stream straight to disk instead of buffering into RAM.
// At 3GB, memoryStorage would need 3GB of RAM per concurrent upload — this
// was reverted back to memoryStorage/500MB at some point and needs to stay
// disk-based for large uploads to be safe.
const videoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, TEMP_VIDEO_DIR),
        filename: (req, file, cb) => cb(null, `raw_${crypto.randomUUID()}${getFileExtension(file.originalname)}`)
    }),
    limits: { fileSize: 3 * 1024 * 1024 * 1024 } // 3GB Limit for videos
});


/**
 * Decide what to do about an existing row with the same file_hash.
 *
 * content_items.file_hash is UNIQUE and deletes are soft (is_active = false),
 * which leaves three cases:
 *
 *   no row        -> caller inserts as normal
 *   active row    -> real duplicate; reuse it, upload nothing
 *   INACTIVE row  -> deleted, but the hash is still taken. Filtering it out
 *                    with "AND is_active = true" means the INSERT then fails
 *                    with 'duplicate key value ... content_items_file_hash_key'
 *                    — so revive the row instead. The bytes are already in R2
 *                    under the same hash-addressed key.
 *
 * @returns {Promise<{row: object, revived: boolean} | null>}
 */
async function resolveExistingByHash(db, fileHash, fields = {}) {
    const found = await db.query(`SELECT * FROM content_items WHERE file_hash = $1`, [fileHash]);
    if (found.rows.length === 0) return null;

    const row = found.rows[0];
    if (row.is_active) return { row, revived: false };

    const revived = await db.query(`
        UPDATE content_items
        SET is_active = true,
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            preview = COALESCE($4, preview),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [row.id, fields.title ?? null, fields.description ?? null, fields.preview ?? null]);

    return { row: revived.rows[0], revived: true };
}

const activeJobs = new Map();

// Streaming SHA-256 hash for disk-based files (videos) — avoids reading the
// whole file into memory just to hash it.
function hashFileFromDisk(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

// Wraps a multer middleware so upload errors (file too large, wrong
// field, etc.) return clean JSON instead of an unhandled exception.
function handleUpload(multerMiddleware, maxSizeBytes) {
    return (req, res, next) => {
        multerMiddleware(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({
                        success: false,
                        error: `File too large. Max allowed size is ${(maxSizeBytes / (1024 * 1024)).toFixed(0)} MB.`
                    });
                }
                return res.status(400).json({ success: false, error: err.message });
            }
            next();
        });
    };
}

// POST /api/content/upload
router.post("/upload", authMiddleware, handleUpload(upload.single("file"), 50 * 1024 * 1024), async (req, res) => {
    try {
        // 🚀 RESTORED: check both body and query for moduleId.
        const moduleId = req.body.moduleId || req.query.moduleId;
        const { title, description, content_type, preview } = req.body;
        const file = req.file;
        const userId = req.user.id || req.user.userId || req.user.sub;
        
        if (req.user.role !== 'educator' && req.user.role !== 'admin') return res.status(403).json({ error: "Only educators can upload content" });
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!title || !content_type) return res.status(400).json({ error: "title and content_type are required" });

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname);
        const mimeType = getMimeType(file.originalname);

        // 🚀 RESTORED: Only ACTIVE rows count as a real duplicate. A soft-deleted
        // row (is_active = false) with a matching hash must not short-circuit
        // the upload — that returns a dead, unopenable "duplicate" forever.
        const existingResolved = await resolveExistingByHash(pool, fileHash, { title, description });
        const existing = { rows: existingResolved ? [existingResolved.row] : [] };
        if (existing.rows.length > 0) {
            const contentId = existing.rows[0].id;
            if (moduleId) {
                await pool.query(`
                    UPDATE modules 
                    SET content_ids = array_append(content_ids, $1::uuid) 
                    WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
                `, [contentId, moduleId]);
            }
            return res.status(200).json({ success: true, message: "File already exists.", content: existing.rows[0], isDuplicate: true });
        }

        const hashPrefix = fileHash.slice(0, 6);
        const r2Key = `content/${hashPrefix}/${fileHash}${extension}`;
        await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key, Body: file.buffer, ContentType: mimeType }));

        const result = await pool.query(`
            INSERT INTO content_items (title, description, content_type, file_hash, file_name, file_size_bytes, mime_type, r2_key, status, preview, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9, $10) RETURNING *
        `, [title, description, content_type, fileHash, file.originalname, file.size, mimeType, r2Key, preview === 'true' || preview === true, userId]);

        const contentId = result.rows[0].id;

        if (moduleId) {
            await pool.query(`
                UPDATE modules 
                SET content_ids = array_append(content_ids, $1::uuid) 
                WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
            `, [contentId, moduleId]);
        }

        res.status(201).json({ success: true, content: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/content/upload-video
router.post("/upload-video", authMiddleware, handleUpload(videoUpload.single("file"), 3 * 1024 * 1024 * 1024), async (req, res) => {
    // Track the raw disk path Multer wrote to, so it can be cleaned up on any early-exit path.
    let rawDiskPath = null;
    try {
        // 🚀 RESTORED: check both body and query for moduleId. VideoUploadModal
        // sends this as a FormData body field, not a query string — without
        // this fallback, videos uploaded through that modal succeed but never
        // get linked into any module's content_ids array.
        const moduleId = req.body.moduleId || req.query.moduleId;
        const { title, description, preview } = req.body;
        const file = req.file;
        const userId = req.user.id || req.user.userId || req.user.sub;

        if (req.user.role !== 'educator' && req.user.role !== 'admin') {
            if (file) fs.unlinkSync(file.path);
            return res.status(403).json({ error: "Only educators can upload videos" });
        }
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        rawDiskPath = file.path;

        if (!title || !file.mimetype.startsWith("video/")) {
            fs.unlinkSync(rawDiskPath);
            return res.status(400).json({ error: "Invalid video upload" });
        }

        // 🚀 RESTORED: File already lives on disk — hash it by streaming
        // instead of loading a buffer, so a 3GB file never sits in RAM.
        const fileHash = await hashFileFromDisk(rawDiskPath);
        const extension = getFileExtension(file.originalname);

        // 🚀 RESTORED: Only ACTIVE rows count as a real duplicate.
        const existingResolved = await resolveExistingByHash(pool, fileHash, { title, description });
        const existing = { rows: existingResolved ? [existingResolved.row] : [] };
        if (existing.rows.length > 0) {
            fs.unlinkSync(rawDiskPath);
            const contentId = existing.rows[0].id;
            if (moduleId) {
                await pool.query(`
                    UPDATE modules 
                    SET content_ids = array_append(content_ids, $1::uuid) 
                    WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
                `, [contentId, moduleId]);
            }
            return res.status(200).json({ success: true, message: "Video already exists.", content: existing.rows[0], isDuplicate: true });
        }

        // Rename to the hash-based name transcodeVideo/cleanup expects.
        const tempFilePath = path.join(TEMP_VIDEO_DIR, `${fileHash}${extension}`);
        fs.renameSync(rawDiskPath, tempFilePath);
        rawDiskPath = null; // ownership moved to tempFilePath now

        const result = await pool.query(`
            INSERT INTO content_items (
                title, description, content_type, file_hash, file_name, file_size_bytes, mime_type,
                status, preview, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', $8, $9) RETURNING id
        `, [title, description || "", "video", fileHash, file.originalname, file.size, file.mimetype, preview === 'true' || preview === true, userId]);

        const contentId = result.rows[0].id;

        if (moduleId) {
            await pool.query(`
                UPDATE modules 
                SET content_ids = array_append(content_ids, $1::uuid) 
                WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
            `, [contentId, moduleId]);
        }
        
        transcodeVideo(contentId, tempFilePath, fileHash, title, [
            { name: "480p", scale: "854:480", bitrate: "1000k" },
            { name: "720p", scale: "1280:720", bitrate: "2500k" },
            { name: "1080p", scale: "1920:1080", bitrate: "4500k" }
        ], 0);

        res.status(202).json({ success: true, message: "Video uploaded. Processing in background.", content: { id: contentId, title, content_type: "video", status: "processing" } });
    } catch (err) {
        console.error("Video Upload error:", err);
        if (rawDiskPath && fs.existsSync(rawDiskPath)) {
            try { fs.unlinkSync(rawDiskPath); } catch (_) {}
        }
        res.status(500).json({ success: false, error: err.message });
    }
});


// ============================================================
// IMAGES (course thumbnails + quiz diagrams)
// ============================================================
//
// Both routes were lost in a merge, so CourseModal's thumbnail picker and
// QuizModal's "Add Diagram" button posted to a route that did not exist and
// got a 404 back.
//
// These must stay ABOVE `GET /:id`: Express matches in declaration order, so
// registering them later would let `/:id` capture "stream-image" as an id and
// return "content not found" instead of the image.
//
// Unlike /upload, these never touch content_items — an image is not a lesson,
// and giving it a content row would put thumbnails in the curriculum list.

// POST /api/content/upload-image
router.post("/upload-image", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        const folder = (req.query.folder || "misc").replace(/[^a-zA-Z0-9_-]/g, "");

        if (req.user.role !== 'educator' && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only educators can upload images" });
        }
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!file.mimetype.startsWith("image/")) {
            return res.status(400).json({ error: "Only image files are allowed" });
        }

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname) || ".jpg";
        const r2Key = `images/${folder}/${fileHash}${extension}`;

        await r2Client.send(new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));

        // Served back through our own endpoint rather than a public R2 URL, so
        // the bucket can stay private.
        const imageUrl = `/api/content/stream-image?key=${encodeURIComponent(r2Key)}`;

        res.status(201).json({ success: true, imageUrl, key: r2Key });
    } catch (err) {
        console.error("Image upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/content/stream-image
//
// Deliberately unauthenticated. An <img src> cannot send an Authorization
// header, and the alternative — putting the JWT in the query string — would
// leak it into browser history, access logs and Referer headers.
//
// Safe because the route is not a general R2 proxy: it serves only keys under
// images/, and those keys are content hashes, so a URL cannot be guessed. The
// images themselves (course thumbnails) already appear on public listings.
router.get("/stream-image", async (req, res) => {
    try {
        const { key } = req.query;
        if (!key) return res.status(400).json({ error: "key is required" });

        // Restricted to images/ on purpose: without this the route would be a
        // generic R2 proxy and any authenticated user could read every object
        // in the bucket, including course videos and PDFs.
        if (!key.startsWith("images/")) {
            return res.status(400).json({ error: "Invalid image key" });
        }

        const r2Response = await r2Client.send(
            new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
        );

        const chunks = [];
        for await (const chunk of r2Response.Body) chunks.push(chunk);
        const imageBuffer = Buffer.concat(chunks);

        res.setHeader("Content-Type", r2Response.ContentType || "image/jpeg");
        res.setHeader("Content-Length", imageBuffer.length);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(imageBuffer);
    } catch (err) {
        console.error("Stream image error:", err);
        if (err.name === "NoSuchKey" || err.Code === "NoSuchKey") {
            return res.status(404).json({ error: "Image not found in storage" });
        }
        res.status(500).json({ error: "Failed to load image", details: err.message });
    }
});

// GET /api/content
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM content_items WHERE is_active = true ORDER BY created_at DESC`);
        res.json({ success: true, contents: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// FOLDERS ("tabs" inside a module) + content ordering
// ============================================================
//
// These five routes were dropped in the content.js rewrite (e068d4bf) and
// replaced by a stub that returned an empty array. The UI still calls all of
// them, so tabs stopped listing, could not be created, renamed, deleted or
// moved between, and the up/down reorder arrows silently did nothing.

// GET /api/content/folders/:moduleId  — list a module's tabs
router.get("/folders/:moduleId", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM folders WHERE module_id = $1 ORDER BY created_at ASC`,
            [req.params.moduleId]
        );
        res.json({ success: true, folders: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/content/folder  — create a tab
router.post("/folder", authMiddleware, async (req, res) => {
    const { module_id, title } = req.body;
    if (!module_id || !title || !String(title).trim()) {
        return res.status(400).json({ error: "module_id and a title are required" });
    }
    try {
        const result = await pool.query(
            `INSERT INTO folders (module_id, title) VALUES ($1, $2) RETURNING *`,
            [module_id, String(title).trim()]
        );
        res.json({ success: true, folder: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/content/bulk-move  — move items between tabs
router.put("/bulk-move", authMiddleware, async (req, res) => {
    const { content_ids, folder_id } = req.body;
    if (!Array.isArray(content_ids) || content_ids.length === 0) {
        return res.status(400).json({ error: "content_ids must be a non-empty array" });
    }
    try {
        const result = await pool.query(
            `UPDATE content_items SET folder_id = $2 WHERE id = ANY($1::uuid[]) RETURNING id, folder_id`,
            [content_ids, folder_id || null]
        );
        res.json({ success: true, updated: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/content/folder/:id  — rename a tab
router.put("/folder/:id", authMiddleware, async (req, res) => {
    try {
        const { title } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: "A title is required" });
        }
        const result = await pool.query(
            `UPDATE folders SET title = $1 WHERE id = $2 RETURNING *`,
            [String(title).trim(), req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Tab not found" });
        }
        res.json({ success: true, folder: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/content/folder/:id  — delete a tab, keeping its contents
router.delete("/folder/:id", authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Detach first. Whether folders.id has ON DELETE CASCADE varies by how
        // the table was created, and cascading here would destroy the
        // educator's uploads rather than returning them to the General tab.
        const moved = await client.query(
            `UPDATE content_items SET folder_id = NULL WHERE folder_id = $1 RETURNING id`,
            [req.params.id]
        );

        const deleted = await client.query(
            `DELETE FROM folders WHERE id = $1 RETURNING id`,
            [req.params.id]
        );

        await client.query("COMMIT");

        if (deleted.rows.length === 0) {
            return res.status(404).json({ error: "Tab not found" });
        }
        res.json({ success: true, message: "Folder deleted", movedToGeneral: moved.rows.length });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// PUT /api/content/:id/priority  — the up/down reorder arrows
router.put("/:id/priority", authMiddleware, async (req, res) => {
    try {
        const { priority } = req.body;
        const result = await pool.query(
            `UPDATE content_items SET priority = $1 WHERE id = $2 RETURNING id, priority`,
            [parseInt(priority, 10) || 0, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Content not found" });
        }
        res.json({ success: true, content: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/content/:id
router.get("/:id", async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1 AND is_active = true`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        res.json({ success: true, content: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/content/:id/status
router.get("/:id/status", async (req, res) => {
    try {
        const result = await pool.query(`SELECT status, metadata FROM content_items WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });

        const row = result.rows[0];

        /*
         * activeJobs is in-memory, so it is the live view while this process is
         * doing the work and simply absent after a restart or once the job is
         * done. The DB row is the durable answer; the job only adds detail on
         * top of it, and the client must cope with progress being null.
         */
        const job = activeJobs.get(req.params.id);

        res.json({
            status: row.status,
            metadata: row.metadata,
            // True once at least one rendition is live but others are still
            // encoding — the video is watchable and still improving.
            stillEncoding: Boolean(job) || row.metadata?.pending === true,
            progress: job
                ? {
                      percent: job.percent ?? 0,
                      stage: job.stage ?? null,
                      renditionPercent: job.renditionPercent ?? 0,
                      renditionsDone: job.renditionsDone ?? 0,
                      renditionsTotal: job.renditionsTotal ?? (job.resolutions?.length ?? 0),
                      startedAt: job.startTime ?? null,
                  }
                : null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================
// ⭐ GET /api/content/:id/pdf
// ============================================
router.get("/:id/pdf", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { courseId } = req.query;
        const userId = req.user.id || req.user.userId || req.user.sub;

        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1 AND is_active = true`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        const content = result.rows[0];
        
        // Anything that is not a video is served here. The curriculum shows a
        // separate "Documents" section for .docx/.pptx, and those rows call
        // this same endpoint — an exact content_type === "pdf" test rejected
        // every one of them with "Not a PDF file".
        if (content.content_type === "video") {
            return res.status(400).json({ error: "Use the streaming endpoint for videos." });
        }

        const courseCheck = await pool.query(`
            SELECT c.educator_id, c.id as course_id
            FROM courses c JOIN modules m ON m.course_id = c.id
            WHERE $1::uuid = ANY(m.content_ids) LIMIT 1
        `, [id]);

        const educatorId = courseCheck.rows.length > 0 ? courseCheck.rows[0].educator_id : null;
        const isCourseOwner = educatorId && String(educatorId).toLowerCase() === String(userId).toLowerCase();
        const isOwner = (content.created_by && String(content.created_by).toLowerCase() === String(userId).toLowerCase()) || isCourseOwner || req.user.role === 'admin';

        if (!isOwner) {
            const courseIdToCheck = courseId || (courseCheck.rows.length > 0 ? courseCheck.rows[0].course_id : null);
            if (!courseIdToCheck) return res.status(403).json({ error: "Access denied." });

            /*
             * Accept an enrolment on the parent course too.
             *
             * Courses are nested — a "class" holds "subject" sub-courses — and
             * students enrol in the parent. This matched only the immediate
             * course_id, so content inside a subject returned 403 for exactly
             * the students who had paid for it. authMiddleware already resolves
             * enrolment this way; the route disagreeing with its own middleware
             * was the bug.
             */
            const enrollCheck = await pool.query(
                `SELECT 1
                   FROM enrollments
                  WHERE user_id = $1
                    AND status = 'active'
                    AND course_id IN (
                        SELECT $2::uuid
                        UNION
                        SELECT parent_course_id FROM courses
                         WHERE id = $2::uuid AND parent_course_id IS NOT NULL
                    )`,
                [userId, courseIdToCheck]
            );

            if (enrollCheck.rows.length === 0 && !content.preview) {
                return res.status(403).json({ error: "Access denied. You are not enrolled." });
            }
        }

        if (!content.r2_key) return res.status(404).json({ error: "PDF not found" });

        const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: content.r2_key });
        const r2Response = await r2Client.send(command);
        
        const chunks = [];
        for await (const chunk of r2Response.Body) chunks.push(chunk);
        const body = Buffer.concat(chunks);

        // An empty object would otherwise be sent as a 200 with a zero-byte
        // body, which the viewer renders as a blank frame with no error —
        // indistinguishable from a broken UI. Fail loudly instead.
        if (body.length === 0) {
            return res.status(404).json({ error: "That file is empty or missing from storage." });
        }

        // Serve the real type. Hardcoding application/pdf meant a .docx was
        // labelled a PDF, so the browser tried to render it as one and showed
        // an empty viewer.
        const contentType =
            content.mime_type ||
            (content.content_type === "pdf" ? "application/pdf" : "application/octet-stream");

        res.setHeader("Content-Type", contentType);
        res.setHeader(
            "Content-Disposition",
            `inline; filename="${encodeURIComponent(content.file_name || content.title)}"`
        );
        res.setHeader("Content-Length", body.length);
        res.send(body);
    } catch (err) {
        console.error("PDF fetch error:", err);
        res.status(500).json({ error: "Failed to load PDF" });
    }
});

// ============================================
// ⭐ GET /api/content/:id/stream
// ============================================
router.get("/:id/stream", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { courseId } = req.query;
        const userId = req.user.id || req.user.userId || req.user.sub;

        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1 AND is_active = true`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        const content = result.rows[0];
        
        if (content.content_type !== "video") return res.status(400).json({ error: "Not a video" });

        const courseCheck = await pool.query(`
            SELECT c.educator_id, c.id as course_id
            FROM courses c JOIN modules m ON m.course_id = c.id
            WHERE $1::uuid = ANY(m.content_ids) LIMIT 1
        `, [id]);

        const educatorId = courseCheck.rows.length > 0 ? courseCheck.rows[0].educator_id : null;
        const isCourseOwner = educatorId && String(educatorId).toLowerCase() === String(userId).toLowerCase();
        const isOwner = (content.created_by && String(content.created_by).toLowerCase() === String(userId).toLowerCase()) || isCourseOwner || req.user.role === 'admin';

        if (!isOwner) {
            const courseIdToCheck = courseId || (courseCheck.rows.length > 0 ? courseCheck.rows[0].course_id : null);
            if (!courseIdToCheck) return res.status(403).json({ error: "Access denied." });

            /*
             * Accept an enrolment on the parent course too.
             *
             * Courses are nested — a "class" holds "subject" sub-courses — and
             * students enrol in the parent. This matched only the immediate
             * course_id, so content inside a subject returned 403 for exactly
             * the students who had paid for it. authMiddleware already resolves
             * enrolment this way; the route disagreeing with its own middleware
             * was the bug.
             */
            const enrollCheck = await pool.query(
                `SELECT 1
                   FROM enrollments
                  WHERE user_id = $1
                    AND status = 'active'
                    AND course_id IN (
                        SELECT $2::uuid
                        UNION
                        SELECT parent_course_id FROM courses
                         WHERE id = $2::uuid AND parent_course_id IS NOT NULL
                    )`,
                [userId, courseIdToCheck]
            );

            if (enrollCheck.rows.length === 0 && !content.preview) {
                return res.status(403).json({ error: "Access denied. You are not enrolled." });
            }
        }

        if (content.status !== "ready") {
            return res.status(202).json({ status: content.status, message: "Video is processing" });
        }
        
        if (!content.r2_key) return res.status(404).json({ error: "Video manifest not found" });

        res.json({
            success: true,
            hlsUrl: `/api/hls/serve?videoId=${id}&path=master.m3u8`,
            duration: content.duration_seconds,
            accessType: isOwner ? 'creator' : 'enrolled'
        });
    } catch (err) {
        console.error("Stream endpoint error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// PUT /api/content/:id 
// ============================================
router.put("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, preview } = req.body;
        const userId = req.user.id || req.user.userId || req.user.sub;

        const contentRow = await pool.query(`SELECT * FROM content_items WHERE id = $1`, [id]);
        if (contentRow.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        const content = contentRow.rows[0];

        // 🚀 RESTORED: check ownership directly against content_items.created_by
        // first. The JOIN-through-modules check alone 404s for any content item
        // that isn't (yet) linked into a module's content_ids array — the exact
        // bug this fallback exists to prevent.
        let isOwner = content.created_by && String(content.created_by).toLowerCase() === String(userId).toLowerCase();
        if (!isOwner) {
            const courseCheck = await pool.query(`
                SELECT c.educator_id 
                FROM modules m JOIN courses c ON m.course_id = c.id
                WHERE $1::uuid = ANY(m.content_ids) LIMIT 1
            `, [id]);
            isOwner = courseCheck.rows.length > 0 && String(courseCheck.rows[0].educator_id) === String(userId);
        }
        if (!isOwner && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only course creator can update content" });
        }
        
        const updateFields = [];
        const values = [];
        let paramCounter = 1;
        
        if (title !== undefined) {
            updateFields.push(`title = $${paramCounter++}`);
            values.push(title === "" ? null : title);
        }
        if (description !== undefined) {
            updateFields.push(`description = $${paramCounter++}`);
            values.push(description === "" ? null : description);
        }
        if (preview !== undefined) {
            updateFields.push(`preview = $${paramCounter++}`);
            values.push(preview === 'true' || preview === true);
        }
        
        if (updateFields.length === 0) return res.status(400).json({ error: "No fields to update" });
        
        updateFields.push(`updated_at = NOW()`);
        values.push(id);
        
        const query = `
            UPDATE content_items 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramCounter}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        res.json({ success: true, content: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// DELETE /api/content/:id 
// ============================================
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id || req.user.userId || req.user.sub;

        const contentRow = await pool.query(`SELECT * FROM content_items WHERE id = $1`, [id]);
        if (contentRow.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        const content = contentRow.rows[0];

        // 🚀 RESTORED: same direct-ownership fallback as PUT above.
        let isOwner = content.created_by && String(content.created_by).toLowerCase() === String(userId).toLowerCase();
        if (!isOwner) {
            const courseCheck = await pool.query(`
                SELECT c.educator_id 
                FROM modules m JOIN courses c ON m.course_id = c.id
                WHERE $1::uuid = ANY(m.content_ids) LIMIT 1
            `, [id]);
            isOwner = courseCheck.rows.length > 0 && String(courseCheck.rows[0].educator_id) === String(userId);
        }
        if (!isOwner && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only course creator can delete content" });
        }
        
        await pool.query(`
            UPDATE content_items 
            SET is_active = false, updated_at = NOW()
            WHERE id = $1 AND is_active = true
        `, [id]);
        
        await pool.query(`
            UPDATE modules 
            SET content_ids = array_remove(content_ids, $1)
            WHERE $1 = ANY(content_ids)
        `, [id]);
        
        res.json({ success: true, message: "Content deactivated successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Run async work over a list with a bounded number in flight.
 *
 * Segments were uploaded to R2 one at a time, each awaiting the previous. A
 * 30-minute lecture is ~180 ten-second segments per rendition, so three
 * renditions meant ~540 sequential round-trips — at a couple of hundred
 * milliseconds each that is minutes of waiting on a mostly idle connection.
 *
 * Concurrency is capped rather than unbounded: firing 540 parallel PUTs would
 * exhaust sockets and file handles, and R2 would start rejecting them.
 */
async function runWithConcurrency(items, limit, worker) {
    let cursor = 0;
    let failure = null;

    const runner = async () => {
        while (cursor < items.length && !failure) {
            const index = cursor++;
            try {
                await worker(items[index]);
            } catch (err) {
                if (!failure) failure = err;
                return;
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, runner)
    );

    if (failure) throw failure;
}

const UPLOAD_CONCURRENCY = 8;

/**
 * Probe the source so renditions can be chosen from it.
 *
 * Returns { height, duration }; height is null when the probe fails, in which
 * case the caller keeps the full ladder rather than guessing.
 */
async function probeVideo(inputPath) {
    return new Promise((resolve) => {
        let stdout = "";
        let probe;
        try {
            probe = spawn(FFPROBE_PATH, [
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-show_entries", "format=duration",
                "-of", "json",
                inputPath
            ]);
        } catch (err) {
            return resolve({ height: null, duration: null, ok: false });
        }

        probe.stdout.on("data", (d) => { stdout += d.toString(); });
        probe.on("error", () => resolve({ height: null, duration: null, ok: false }));
        probe.on("close", () => {
            try {
                const parsed = JSON.parse(stdout);
                const height = parsed.streams?.[0]?.height ?? null;
                const duration = Math.round(parseFloat(parsed.format?.duration)) || null;
                resolve({ height, duration, ok: true });
            } catch (_) {
                resolve({ height: null, duration: null, ok: false });
            }
        });
    });
}

// ============================================
// TRANSCODE FUNCTION
// ============================================
async function transcodeVideo(contentId, inputPath, fileHash, title, resolutions, duration) {
    console.log(`\n${"=".repeat(70)}\n🎬 TRANSCODING — ${contentId}\n${"=".repeat(70)}`);

    const outputDir = path.join(TEMP_VIDEO_DIR, `hls_${contentId}`);
    const hashPrefix = fileHash.slice(0, 6);
    const r2BasePath = `content/videos/${hashPrefix}/${fileHash}`;

    activeJobs.set(contentId, { title, startTime: Date.now(), resolutions: resolutions.map(r => r.name), status: "processing" });

    try {
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const probe = await probeVideo(inputPath);
        if (!probe.ok) {
            throw new Error("FFprobe is not available (not installed or not on PATH). Cannot process video.");
        }
        const actualDuration = probe.duration || duration;

        /*
         * Never encode above the source resolution.
         *
         * The ladder was applied unconditionally, so a 480p screen recording
         * was still upscaled to 720p and 1080p. That is roughly three times
         * the encoding work to produce two files that are larger than the
         * original and cannot look any better than it — upscaling invents no
         * detail. This is the main reason processing took so long.
         *
         * The 32px tolerance keeps sources like 1072p or 704p on their
         * intended rung instead of demoting them. If the probe could not read
         * a height we keep the full ladder rather than guess.
         */
        if (probe.height) {
            const fits = resolutions.filter(
                (r) => parseInt(r.scale.split(":")[1], 10) <= probe.height + 32
            );
            // Always emit at least one rendition, even for tiny sources.
            resolutions = fits.length > 0 ? fits : [resolutions[0]];
        }

        console.log(
            `🎯 source ${probe.height ?? "?"}p → encoding ${resolutions.map(r => r.name).join(", ")}`
        );
        activeJobs.set(contentId, {
            title,
            startTime: Date.now(),
            resolutions: resolutions.map(r => r.name),
            status: "processing"
        });

        // Renditions finished so far, in ladder order.
        const completed = [];
        let isPublished = false;
        const masterR2Key = `${r2BasePath}/master.m3u8`;

        /**
         * Write a master playlist covering the renditions done so far and point
         * the content row at it, marking the video ready on the first call.
         *
         * Rewriting the master each time is cheap — it is a few hundred bytes —
         * and keeps the manifest honest about which renditions actually exist.
         * Advertising a rung whose segments are not uploaded yet would make the
         * player stall when it tried to switch up to it.
         */
        const publishMaster = async (done) => {
            let manifest = "#EXTM3U\n#EXT-X-VERSION:3\n";
            for (const res of done) {
                const bandwidth =
                    res.name === "1080p" ? "5000000" : res.name === "720p" ? "2800000" : "1200000";
                manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${res.scale.replace(":", "x")}\n`;
                manifest += `${res.name}/index.m3u8\n`;
            }

            await r2Client.send(new PutObjectCommand({
                Bucket: R2_BUCKET_NAME,
                Key: masterR2Key,
                Body: Buffer.from(manifest, "utf-8"),
                ContentType: "application/vnd.apple.mpegurl"
            }));

            await pool.query(`
                UPDATE content_items
                SET status = 'ready', r2_key = $1, duration_seconds = $2, metadata = $3, updated_at = NOW()
                WHERE id = $4::uuid
            `, [
                masterR2Key,
                actualDuration || duration,
                {
                    resolutions: done.map(r => r.name),
                    r2_base_path: r2BasePath,
                    // Only complete once every planned rung has landed, so the
                    // UI can tell "watchable" from "finished" if it wants to.
                    pending: done.length < resolutions.length,
                    completed_at: new Date().toISOString()
                },
                contentId
            ]);
        };

        for (const { name: resName, scale, bitrate } of resolutions) {
            const qualityDir = path.join(outputDir, resName);
            if (!fs.existsSync(qualityDir)) fs.mkdirSync(qualityDir, { recursive: true });

            const segmentPattern = path.join(qualityDir, "segment_%03d.ts");
            const playlistPath = path.join(qualityDir, "index.m3u8");

            console.log(`\n🎬 Transcoding ${resName}...`);

            let lastLoggedFrame = 0;
            await new Promise((resolve, reject) => {
                let ffmpeg;
                try {
                    ffmpeg = spawn(FFMPEG_PATH, [
                        "-i", inputPath,
                        "-vf", `scale=${scale}`,
                        "-c:v", "libx264", "-preset", "veryfast",
                        "-b:v", bitrate, "-maxrate", bitrate,
                        "-bufsize", `${parseInt(bitrate) * 2}k`,
                        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
                        "-f", "hls",
                        "-hls_time", "10",
                        "-hls_list_size", "0",
                        "-hls_segment_type", "mpegts",
                        "-hls_segment_filename", segmentPattern,
                        playlistPath
                    ]);
                } catch (spawnErr) {
                    return reject(new Error(`ffmpeg failed to start: ${spawnErr.message}`));
                }

                ffmpeg.stderr.on("data", (data) => {
                    const text = data.toString();

                    const match = text.match(/frame=\s*(\d+)/);
                    if (match) {
                        const currentFrame = parseInt(match[1]);
                        if (currentFrame - lastLoggedFrame >= 500) {
                            console.log(`   🎬 ${resName}: frame ${currentFrame}`);
                            lastLoggedFrame = currentFrame;
                        }
                    }

                    /*
                     * Turn ffmpeg's progress line into a real percentage.
                     *
                     * `time=` is how far into the source this pass has reached,
                     * so dividing by the probed duration gives this rendition's
                     * share. Frames would need the frame rate to mean anything;
                     * time needs only the duration we already have.
                     */
                    const t = text.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
                    if (t && actualDuration > 0) {
                        const secs = (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]);
                        const share = Math.min(secs / actualDuration, 1);
                        const overall = (completed.length + share) / resolutions.length;

                        const job = activeJobs.get(contentId);
                        if (job) {
                            job.stage = resName;
                            job.percent = Math.round(overall * 100);
                            job.renditionPercent = Math.round(share * 100);
                            job.renditionsDone = completed.length;
                            job.renditionsTotal = resolutions.length;
                        }
                    }
                });

                let stderrTail = "";
                ffmpeg.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-4000); });

                ffmpeg.on("close", (code) => {
                    if (code === 0) return resolve();
                    // Without this the failure read only "ffmpeg exited 1",
                    // which is why "check the server log" showed nothing useful.
                    const reason = stderrTail.trim().split("\n").slice(-6).join(" | ");
                    console.error(`\nffmpeg failed on ${resName} (exit ${code}):\n${stderrTail.trim()}\n`);
                    reject(new Error(`ffmpeg exited ${code} on ${resName}: ${reason || 'no output captured'}`));
                });
                // Without this handler, a missing ffmpeg binary crashes the whole process.
                ffmpeg.on("error", (err) => {
                    reject(new Error(`ffmpeg spawn error: ${err.message}. Is FFmpeg installed and on PATH?`));
                });
            });

            const allFiles = fs.readdirSync(qualityDir).sort();
            const segments = allFiles.filter(f => f.endsWith(".ts"));

            await runWithConcurrency(segments, UPLOAD_CONCURRENCY, async (seg) => {
                const filePath = path.join(qualityDir, seg);
                await r2Client.send(new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: `${r2BasePath}/${resName}/${seg}`,
                    Body: fs.createReadStream(filePath),
                    // Given explicitly so the SDK can send a plain sized PUT.
                    // Without it a stream body is uploaded chunked, which is
                    // slower and which some S3-compatible endpoints reject.
                    ContentLength: fs.statSync(filePath).size,
                    ContentType: "video/mp2t"
                }));
                fs.unlinkSync(filePath);
            });
            console.log(`   ☁️  uploaded ${segments.length} ${resName} segments`);

            if (fs.existsSync(playlistPath)) {
                await r2Client.send(new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: `${r2BasePath}/${resName}/index.m3u8`,
                    Body: fs.createReadStream(playlistPath),
                    ContentType: "application/vnd.apple.mpegurl"
                }));
            }

            /*
             * Publish after each rendition instead of only at the very end.
             *
             * The row stayed 'processing' — hidden from students, labelled
             * "Processing" for the educator — until every rung had finished.
             * With three renditions at roughly 3-4x realtime each, a 30 minute
             * lecture sat unwatchable for the better part of half an hour even
             * though the lowest quality was ready after the first third.
             *
             * The ladder runs lowest-first, so the first pass through here
             * publishes a playable 480p and flips the row to 'ready'. Each
             * later rung rewrites the master to add itself. A viewer who loads
             * mid-way simply sees fewer quality options.
             */
            completed.push({ name: resName, scale });
            await publishMaster(completed);

            if (!isPublished) {
                isPublished = true;
                console.log(`   ✅ ${resName} live — remaining renditions continue in background`);
            }
        }

        activeJobs.delete(contentId);
        
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });

    } catch (err) {
        console.error(`❌ Transcoding failed:`, err.message);
        activeJobs.delete(contentId);

        /*
         * Only fail the row if nothing was published.
         *
         * Now that each rendition goes live as it finishes, a video can be
         * perfectly watchable at 480p when the 1080p pass dies. Marking it
         * 'failed' there would hide a working video from students and tell the
         * educator to re-upload something that is already fine — so a partial
         * failure leaves the row 'ready' and just records what went wrong.
         */
        const published = await pool.query(
            `SELECT status FROM content_items WHERE id = $1::uuid`,
            [contentId]
        );
        const alreadyLive = published.rows[0]?.status === 'ready';

        if (alreadyLive) {
            console.warn(`⚠️  Keeping ${contentId} live — some renditions completed before the failure.`);
            await pool.query(`
                UPDATE content_items
                SET metadata = metadata || $1::jsonb, updated_at = NOW()
                WHERE id = $2::uuid
            `, [JSON.stringify({
                partial_error: err.message,
                failed_at: new Date().toISOString()
            }), contentId]);
        } else {
            await pool.query(`
                UPDATE content_items
                SET status = 'failed', metadata = $1, updated_at = NOW()
                WHERE id = $2::uuid
            `, [{ error: err.message, failed_at: new Date().toISOString() }, contentId]);
        }

        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        const od = path.join(TEMP_VIDEO_DIR, `hls_${contentId}`);
        if (fs.existsSync(od)) fs.rmSync(od, { recursive: true, force: true });
    }
}

export default router;