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

if (!fs.existsSync(TEMP_VIDEO_DIR)) fs.mkdirSync(TEMP_VIDEO_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
const activeJobs = new Map();

// POST /api/content/upload
router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        const { title, description, content_type, preview } = req.body;
        const file = req.file;
        const userId = req.user.id || req.user.userId || req.user.sub;
        
        if (req.user.role !== 'educator' && req.user.role !== 'admin') return res.status(403).json({ error: "Only educators can upload content" });
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!title || !content_type) return res.status(400).json({ error: "title and content_type are required" });

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname);
        const mimeType = getMimeType(file.originalname);

        const existing = await pool.query(`SELECT * FROM content_items WHERE file_hash = $1`, [fileHash]);
        if (existing.rows.length > 0) {
            // 🌟 LINK TO MODULE EVEN IF DUPLICATE
            const contentId = existing.rows[0].id;
            if (req.query.moduleId) {
                await pool.query(`
                    UPDATE modules 
                    SET content_ids = array_append(content_ids, $1::uuid) 
                    WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
                `, [contentId, req.query.moduleId]);
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

        // 🌟 LINK FRESH UPLOAD TO MODULE
        if (req.query.moduleId) {
            await pool.query(`
                UPDATE modules 
                SET content_ids = array_append(content_ids, $1::uuid) 
                WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
            `, [contentId, req.query.moduleId]);
        }

        res.status(201).json({ success: true, content: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/content/upload-image
router.post("/upload-image", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        const folder = (req.query.folder || "misc").replace(/[^a-zA-Z0-9_-]/g, "");

        if (req.user.role !== 'educator' && req.user.role !== 'admin') return res.status(403).json({ error: "Only educators can upload images" });
        if (!file || !file.mimetype.startsWith("image/")) return res.status(400).json({ error: "Only image files are allowed" });

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname) || ".jpg";
        const r2Key = `images/${folder}/${fileHash}${extension}`;

        await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key, Body: file.buffer, ContentType: file.mimetype }));
        res.status(201).json({ success: true, imageUrl: `/api/content/stream-image?key=${encodeURIComponent(r2Key)}`, key: r2Key });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/content/stream-image
router.get("/stream-image", async (req, res) => {
    try {
        const { key } = req.query;
        if (!key || !key.startsWith("images/")) return res.status(400).json({ error: "Invalid image key" });

        const r2Response = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
        const chunks = [];
        for await (const chunk of r2Response.Body) chunks.push(chunk);
        const imageBuffer = Buffer.concat(chunks);

        res.setHeader("Content-Type", r2Response.ContentType || "image/jpeg");
        res.setHeader("Content-Length", imageBuffer.length);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(imageBuffer);
    } catch (err) {
        res.status(404).json({ error: "Image not found" });
    }
});

router.options("/stream-image", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(200).end();
});

// POST /api/content/upload-video
router.post("/upload-video", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        const { title, description, preview } = req.body;
        const file = req.file;
        const userId = req.user.id || req.user.userId || req.user.sub;

        if (req.user.role !== 'educator' && req.user.role !== 'admin') return res.status(403).json({ error: "Only educators can upload videos" });
        if (!file || !title || !file.mimetype.startsWith("video/")) return res.status(400).json({ error: "Invalid video upload" });

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname);
        const tempFilePath = path.join(TEMP_VIDEO_DIR, `${fileHash}${extension}`);
        
        fs.writeFileSync(tempFilePath, file.buffer);

        const existing = await pool.query(`SELECT * FROM content_items WHERE file_hash = $1`, [fileHash]);
        if (existing.rows.length > 0) {
            // 🌟 LINK TO MODULE EVEN IF DUPLICATE
            const contentId = existing.rows[0].id;
            if (req.query.moduleId) {
                await pool.query(`
                    UPDATE modules 
                    SET content_ids = array_append(content_ids, $1::uuid) 
                    WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
                `, [contentId, req.query.moduleId]);
            }
            return res.status(200).json({ success: true, message: "Video already exists.", content: existing.rows[0], isDuplicate: true });
        }
        
        const result = await pool.query(`
            INSERT INTO content_items (
                title, description, content_type, file_hash, file_name, file_size_bytes, mime_type,
                status, preview, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', $8, $9) RETURNING id
        `, [title, description || "", "video", fileHash, file.originalname, file.size, file.mimetype, preview === 'true' || preview === true, userId]);

        const contentId = result.rows[0].id;

        // 🌟 LINK FRESH UPLOAD TO MODULE
        if (req.query.moduleId) {
            await pool.query(`
                UPDATE modules 
                SET content_ids = array_append(content_ids, $1::uuid) 
                WHERE id = $2::uuid AND NOT ($1::uuid = ANY(content_ids))
            `, [contentId, req.query.moduleId]);
        }
        
        transcodeVideo(contentId, tempFilePath, fileHash, title, [
            { name: "480p", scale: "854:480", bitrate: "1000k" },
            { name: "720p", scale: "1280:720", bitrate: "2500k" },
            { name: "1080p", scale: "1920:1080", bitrate: "4500k" }
        ], 0);

        res.status(202).json({ success: true, message: "Video uploaded. Processing in background.", content: { id: contentId, title, content_type: "video", status: "processing" } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.json({ status: result.rows[0].status, metadata: result.rows[0].metadata });
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
        
        if (content.content_type !== "pdf") return res.status(400).json({ error: "Not a PDF file" });

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

            const enrollCheck = await pool.query(
                `SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
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
        
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(content.file_name || content.title + '.pdf')}"`);
        res.setHeader("Content-Length", Buffer.concat(chunks).length);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(Buffer.concat(chunks));
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

            const enrollCheck = await pool.query(
                `SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
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
        
        const contentCheck = await pool.query(`
            SELECT ci.*, c.educator_id 
            FROM content_items ci
            JOIN modules m ON ci.id = ANY(m.content_ids)
            JOIN courses c ON m.course_id = c.id
            WHERE ci.id = $1
            LIMIT 1
        `, [id]);
        
        if (contentCheck.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        
        if (String(contentCheck.rows[0].educator_id) !== String(userId)) {
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
            values.push(preview);
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
        
        const contentCheck = await pool.query(`
            SELECT c.educator_id 
            FROM content_items ci
            JOIN modules m ON ci.id = ANY(m.content_ids)
            JOIN courses c ON m.course_id = c.id
            WHERE ci.id = $1
            LIMIT 1
        `, [id]);
        
        if (contentCheck.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        
        if (String(contentCheck.rows[0].educator_id) !== String(userId)) {
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

        let actualDuration = duration;
        await new Promise((resolve) => {
            const ffprobe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath]);
            ffprobe.stdout.on("data", d => { actualDuration = Math.round(parseFloat(d.toString())); });
            ffprobe.on("close", resolve);
        });

        for (const { name: resName, scale, bitrate } of resolutions) {
            const qualityDir = path.join(outputDir, resName);
            if (!fs.existsSync(qualityDir)) fs.mkdirSync(qualityDir, { recursive: true });

            const segmentPattern = path.join(qualityDir, "segment_%03d.ts");
            const playlistPath = path.join(qualityDir, "index.m3u8");

            console.log(`\n🎬 Transcoding ${resName}...`);

            await new Promise((resolve, reject) => {
                const ffmpeg = spawn("ffmpeg", [
                    "-i", inputPath,
                    "-vf", `scale=${scale}`,
                    "-c:v", "libx264", "-preset", "medium",
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

                ffmpeg.on("close", (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`ffmpeg exited ${code} for ${resName}`));
                });
                ffmpeg.on("error", reject);
            });

            const allFiles = fs.readdirSync(qualityDir).sort();
            const segments = allFiles.filter(f => f.endsWith(".ts"));

            for (const seg of segments) {
                const filePath = path.join(qualityDir, seg);
                await r2Client.send(new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: `${r2BasePath}/${resName}/${seg}`,
                    Body: fs.readFileSync(filePath),
                    ContentType: "video/mp2t"
                }));
                fs.unlinkSync(filePath);
            }

            if (fs.existsSync(playlistPath)) {
                await r2Client.send(new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: `${r2BasePath}/${resName}/index.m3u8`,
                    Body: fs.readFileSync(playlistPath),
                    ContentType: "application/vnd.apple.mpegurl"
                }));
            }
        }

        let masterManifest = "#EXTM3U\n#EXT-X-VERSION:3\n";
        for (const res of resolutions) {
            const bandwidth = res.name === "1080p" ? "5000000" : res.name === "720p" ? "2800000" : "1200000";
            const resAttr = res.scale.replace(":", "x");
            masterManifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resAttr}\n`;
            masterManifest += `${res.name}/index.m3u8\n`;
        }

        const masterR2Key = `${r2BasePath}/master.m3u8`;
        await r2Client.send(new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: masterR2Key,
            Body: Buffer.from(masterManifest, "utf-8"),
            ContentType: "application/vnd.apple.mpegurl"
        }));

        const resolutionNames = resolutions.map(r => r.name);
        const metadataObj = {
            resolutions: resolutionNames,
            r2_base_path: r2BasePath,
            completed_at: new Date().toISOString()
        };

        await pool.query(`
            UPDATE content_items
            SET status = 'ready', r2_key = $1, duration_seconds = $2, metadata = $3, updated_at = NOW()
            WHERE id = $4::uuid
        `, [masterR2Key, actualDuration || duration, metadataObj, contentId]);

        activeJobs.delete(contentId);
        
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });

    } catch (err) {
        console.error(`❌ Transcoding failed:`, err.message);
        activeJobs.delete(contentId);

        await pool.query(`
            UPDATE content_items
            SET status = 'failed', metadata = $1, updated_at = NOW()
            WHERE id = $2::uuid
        `, [{ error: err.message, failed_at: new Date().toISOString() }, contentId]);

        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        const od = path.join(TEMP_VIDEO_DIR, `hls_${contentId}`);
        if (fs.existsSync(od)) fs.rmSync(od, { recursive: true, force: true });
    }
}

export default router;
