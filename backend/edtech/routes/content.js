import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import pool from "../config/database.js";
import { r2Client, R2_BUCKET_NAME } from "../config/r2.js";
import authMiddleware from "../middleware/auth.js";
import { generateFileHash, getFileExtension, getMimeType } from "../utils/helpers.js";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_VIDEO_DIR = path.join(__dirname, "../temp_videos");

// Ensure scratch disk space exists securely
if (!fs.existsSync(TEMP_VIDEO_DIR)) {
    fs.mkdirSync(TEMP_VIDEO_DIR, { recursive: true });
}

// Small assets (PDFs/docs) stay in memory — fine at 50MB.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB Limit for non-video content
});

// 🚀 FIX: Videos stream straight to disk instead of buffering into RAM.
// At 3GB, memoryStorage would need 3GB of RAM per concurrent upload — a
// couple of simultaneous uploads would OOM-crash the whole Node process.
// diskStorage writes the incoming stream directly to TEMP_VIDEO_DIR.
const videoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, TEMP_VIDEO_DIR),
        filename: (req, file, cb) => cb(null, `raw_${crypto.randomUUID()}${getFileExtension(file.originalname)}`)
    }),
    limits: { fileSize: 3 * 1024 * 1024 * 1024 } // 3GB Limit for videos
});

// 🚀 FIX: Wrap Multer middleware so LIMIT_FILE_SIZE and other Multer errors
// return a clean JSON 4xx instead of crashing as an unhandled error.
function handleUpload(multerMiddleware) {
    return (req, res, next) => {
        multerMiddleware(req, res, (err) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(413).json({ error: "File is too large. Maximum allowed size is 3GB for videos." });
                    }
                    return res.status(400).json({ error: err.message });
                }
                return res.status(500).json({ error: err.message });
            }
            next();
        });
    };
}

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

const activeJobs = new Map();

// Helper safely mapping clean resolution strings for the M3U8 Master manifest
function cleanResolutionString(scaleStr) {
    const standard = scaleStr.replace("w=", "").replace("h=", "");
    return standard.includes(":") ? standard.replace(":", "x") : standard;
}
router.post("/upload-image", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        if (req.user.role !== 'educator' && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only educators can upload images" });
        }

        const file = req.file;
        const folder = req.query.folder || "general";

        if (!file) return res.status(400).json({ error: "No image file provided" });
        if (!file.mimetype.startsWith("image/")) {
            return res.status(400).json({ error: "Only image files are allowed (PNG, JPG, WEBP)" });
        }

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname) || ".png";
        const r2Key = `images/${folder}/${fileHash}${extension}`;

        await r2Client.send(new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));

        // 🌟 FIXED: Use reliable query param (?key=...) instead of URL path wildcard
        const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}/api`;
        const imageUrl = `${baseUrl}/content/stream-image?key=${encodeURIComponent(r2Key)}`;

        console.log(`🖼️ Uploaded image: ${r2Key} -> URL: ${imageUrl}`);
        res.status(201).json({ success: true, imageUrl, r2Key });
    } catch (err) {
        console.error("Image upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// GET /api/content/stream-image
// Streams images directly from R2 using a query parameter (?key=...)
// ============================================================
router.get("/stream-image", async (req, res) => {
    try {
        const r2Key = req.query.key;
        if (!r2Key) return res.status(400).send("Missing image key parameter");

        const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Key
        });

        const response = await r2Client.send(command);
        
        res.setHeader("Content-Type", response.ContentType || "image/png");
        res.setHeader("Cache-Control", "public, max-age=31536000"); // Cache for 1 year
        res.setHeader("Access-Control-Allow-Origin", "*");
        response.Body.pipe(res);
    } catch (err) {
        console.error("Stream image error:", err.message);
        res.status(404).send("Image not found");
    }
});
// POST /api/content/upload
router.post("/upload", authMiddleware, handleUpload(upload.single("file")), async (req, res) => {
    const client = await pool.connect();
    try {
        // Fallback checks both req.body AND req.query for maximum reliability!
        const moduleId = req.body.moduleId || req.query.moduleId; 
        const { title, description, content_type, preview, folder_id, priority } = req.body;
        const file = req.file;
        
        if (req.user.role !== 'educator' && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only educators can upload content" });
        }
        
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!title || !content_type) return res.status(400).json({ error: "title and content_type are required" });
        if (!moduleId) return res.status(400).json({ error: "moduleId is required" });

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname);
        const mimeType = getMimeType(file.originalname) || "application/pdf";

        // 🚀 FIX: Only treat ACTIVE rows as real duplicates. A soft-deleted row
        // (is_active = false, r2_key stripped) with a matching hash must NOT
        // short-circuit the upload — that was returning dead, unopenable
        // "duplicates" forever after any delete + re-upload of the same file.
        const existing = await client.query(
            `SELECT * FROM content_items WHERE file_hash = $1 AND is_active = true`,
            [fileHash]
        );
        if (existing.rows.length > 0) {
            const existingId = existing.rows[0].id;
            await client.query(`
                UPDATE modules 
                SET content_ids = array_append(COALESCE(content_ids, ARRAY[]::uuid[]), $1) 
                WHERE id = $2 AND NOT ($1 = ANY(COALESCE(content_ids, ARRAY[]::uuid[])))
            `, [existingId, moduleId]);

            return res.status(200).json({ success: true, message: "File already exists.", content: existing.rows[0], isDuplicate: true });
        }

        const hashPrefix = fileHash.slice(0, 6);
        const r2Key = `content/${hashPrefix}/${fileHash}${extension}`;
        
        await r2Client.send(new PutObjectCommand({ 
            Bucket: process.env.R2_BUCKET_NAME || R2_BUCKET_NAME, 
            Key: r2Key, 
            Body: file.buffer, 
            ContentType: mimeType 
        }));

        await client.query('BEGIN');

        const contentResult = await client.query(`
            INSERT INTO content_items (title, description, content_type, file_hash, file_name, file_size_bytes, mime_type, r2_key, status, preview, priority, folder_id, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9, $10, $11, $12) RETURNING *
        `, [title, description, content_type, fileHash, file.originalname, file.size, mimeType, r2Key, preview === 'true' || preview === true, priority || 2, folder_id || null, req.user.id]);

        const newContentId = contentResult.rows[0].id;

        await client.query(`
            UPDATE modules 
            SET content_ids = array_append(COALESCE(content_ids, ARRAY[]::uuid[]), $1) 
            WHERE id = $2
        `, [newContentId, moduleId]);
        
        await client.query('COMMIT');
        res.status(201).json({ success: true, content: contentResult.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// POST /api/content/upload-video
router.post("/upload-video", authMiddleware, handleUpload(videoUpload.single("file")), async (req, res) => {
    const client = await pool.connect();
    // Track the raw disk path Multer wrote to, so it can be cleaned up on any early-exit path.
    let rawDiskPath = null;
    try {
        // Fallback checks both req.body AND req.query for maximum reliability!
        const moduleId = req.body.moduleId || req.query.moduleId;
        const { title, description, preview, folder_id, priority } = req.body;
        const file = req.file;

        if (req.user.role !== 'educator' && req.user.role !== 'admin') {
            if (file) fs.unlinkSync(file.path);
            return res.status(403).json({ error: "Only educators can upload videos" });
        }

        if (!file) return res.status(400).json({ error: "No file uploaded" });
        rawDiskPath = file.path;

        if (!title) { fs.unlinkSync(rawDiskPath); return res.status(400).json({ error: "Title is required" }); }
        if (!moduleId) { fs.unlinkSync(rawDiskPath); return res.status(400).json({ error: "moduleId is required" }); }
        if (!file.mimetype.startsWith("video/")) {
            fs.unlinkSync(rawDiskPath);
            return res.status(400).json({ error: "Only video files are allowed" });
        }

        // 🚀 FIX: File already lives on disk (Multer diskStorage) — hash it by
        // streaming instead of loading a buffer, so a 3GB file never sits in RAM.
        const fileHash = await hashFileFromDisk(rawDiskPath);
        const extension = getFileExtension(file.originalname);

        // 🚀 FIX: Same as /upload — only ACTIVE rows count as a real duplicate.
        // Without this, re-uploading a video whose old row was soft-deleted
        // just returns the dead row (is_active=false, r2_key=null) forever,
        // so it "succeeds" but never actually plays.
        const existing = await client.query(
            `SELECT * FROM content_items WHERE file_hash = $1 AND is_active = true`,
            [fileHash]
        );
        if (existing.rows.length > 0) {
            fs.unlinkSync(rawDiskPath); // duplicate content — discard the fresh upload, we already have it
            const existingId = existing.rows[0].id;
            await client.query(`
                UPDATE modules 
                SET content_ids = array_append(COALESCE(content_ids, ARRAY[]::uuid[]), $1) 
                WHERE id = $2 AND NOT ($1 = ANY(COALESCE(content_ids, ARRAY[]::uuid[])))
            `, [existingId, moduleId]);

            return res.status(200).json({ success: true, message: "Video already exists.", content: existing.rows[0], isDuplicate: true });
        }

        // Rename to the hash-based name transcodeVideo/cleanup expects.
        const tempFilePath = path.join(TEMP_VIDEO_DIR, `${fileHash}${extension}`);
        fs.renameSync(rawDiskPath, tempFilePath);
        rawDiskPath = null; // ownership moved to tempFilePath now

        let videoInfo = { width: 0, height: 0, duration: 0 };
        try {
            videoInfo = await new Promise((resolve, reject) => {
                const ffprobe = spawn(ffprobePath, [
                    "-v", "error",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=width,height:format=duration",
                    "-of", "json",
                    tempFilePath
                ]);

                let output = "";
                ffprobe.stdout.on("data", (data) => output += data.toString());
                ffprobe.on("close", (code) => {
                    if (code !== 0) return reject(new Error("FFprobe parsed with error exit code"));
                    try {
                        const parsed = JSON.parse(output);
                        const stream = parsed.streams?.[0] || {};
                        const duration = parsed.format?.duration || 0;
                        resolve({
                            width: parseInt(stream.width) || 1280,
                            height: parseInt(stream.height) || 720,
                            duration: Math.round(parseFloat(duration)) || 0
                        });
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } catch (probeErr) {
            console.warn("⚠️ FFprobe fallback activated:", probeErr.message);
            videoInfo = { width: 1280, height: 720, duration: 0 };
        }
        
        const targetResolutions = [
            { name: "360p", scale: "w=640:h=360", bitrate: "800k" },
            { name: "720p", scale: "w=1280:h=720", bitrate: "2500k" }
        ];
        if (videoInfo.height >= 1080) {
            targetResolutions.push({ name: "1080p", scale: "w=1920:h=1080", bitrate: "5000k" });
        }

        await client.query('BEGIN');

        const contentResult = await client.query(`
            INSERT INTO content_items (title, description, content_type, file_hash, file_name, file_size_bytes, mime_type, duration_seconds, status, preview, priority, folder_id, created_by)
            VALUES ($1, $2, 'video', $3, $4, $5, $6, $7, 'processing', $8, $9, $10, $11) RETURNING *
        `, [title, description, fileHash, file.originalname, file.size, file.mimetype, videoInfo.duration, preview === 'true' || preview === true, priority || 2, folder_id || null, req.user.id]);

        const newContentId = contentResult.rows[0].id;

        await client.query(`
            UPDATE modules 
            SET content_ids = array_append(COALESCE(content_ids, ARRAY[]::uuid[]), $1) 
            WHERE id = $2
        `, [newContentId, moduleId]);

        await client.query('COMMIT');

        // Background transcoding thread execution
        transcodeVideo(newContentId, tempFilePath, fileHash, title, targetResolutions, videoInfo.duration);
        
        res.status(201).json({ success: true, content: contentResult.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Video Upload error:", err);
        if (rawDiskPath && fs.existsSync(rawDiskPath)) {
            try { fs.unlinkSync(rawDiskPath); } catch (_) {}
        }
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// GET /api/content
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM content_items WHERE is_active = true ORDER BY created_at DESC`);
        res.json({ success: true, contents: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/content/folders/:moduleId
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

// POST /api/content/folder
router.post("/folder", authMiddleware, async (req, res) => {
    const { module_id, title } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO folders (module_id, title) VALUES ($1, $2) RETURNING *`,
            [module_id, title]
        );
        res.json({ success: true, folder: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/content/bulk-move
router.put("/bulk-move", authMiddleware, async (req, res) => {
    const { content_ids, folder_id } = req.body; 
    try {
        const result = await pool.query(
            `UPDATE content_items SET folder_id = $2 WHERE id = ANY($1::uuid[]) RETURNING id, folder_id`,
            [content_ids, folder_id]
        );
        res.json({ success: true, updated: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/content/folder/:id
router.put("/folder/:id", authMiddleware, async (req, res) => {
    try {
        const { title } = req.body;
        const result = await pool.query(
            `UPDATE folders SET title = $1 WHERE id = $2 RETURNING *`,
            [title, req.params.id]
        );
        res.json({ success: true, folder: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/content/folder/:id
router.delete("/folder/:id", authMiddleware, async (req, res) => {
    try {
        await pool.query(`DELETE FROM folders WHERE id = $1`, [req.params.id]);
        res.json({ success: true, message: "Folder deleted" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/content/:id/priority
router.put("/:id/priority", authMiddleware, async (req, res) => {
    try {
        const { priority } = req.body;
        await pool.query(
            `UPDATE content_items SET priority = $1 WHERE id = $2`, 
            [parseInt(priority) || 0, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/content/:id
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1 AND is_active = true`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        res.json({ success: true, content: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/content/:id/status
router.get("/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`SELECT status, metadata FROM content_items WHERE id = $1`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        res.json({ status: result.rows[0].status, metadata: result.rows[0].metadata });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/content/:id/pdf
router.get("/:id/pdf", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const requestedCourseId = req.query.courseId; 
        
        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1 AND is_active = true`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        const content = result.rows[0];

        let isCourseOwner = false;
        if (requestedCourseId) {
             const cCheck = await pool.query(`SELECT educator_id FROM courses WHERE id = $1`, [requestedCourseId]);
             if (cCheck.rows.length > 0 && cCheck.rows[0].educator_id === req.user.id) {
                 isCourseOwner = true;
             }
        }

        const isOwner = content.created_by === req.user.id || isCourseOwner;
        if (!isOwner && !req.isContentCreator && !req.isEnrolled && !req.isPreviewContent) {
            return res.status(403).json({ 
                error: "Access denied. You are not enrolled in this course.",
                requiresEnrollment: true
            });
        }
        
        const type = String(content.content_type).toLowerCase();
        if (!type.includes("pdf") && !type.includes("document")) {
            return res.status(400).json({ error: `Not a PDF file (Found type: ${content.content_type})` });
        }

        const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: content.r2_key });
        const r2Response = await r2Client.send(command);

        const byteArray = await r2Response.Body.transformToByteArray();
        const pdfBuffer = Buffer.from(byteArray);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Content-Length", pdfBuffer.length);
        res.removeHeader("X-Frame-Options"); 
        res.send(pdfBuffer);
        
     } catch (err) {
        console.error("PDF fetch error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/content/:id/stream
router.get("/:id/stream", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const requestedCourseId = req.query.courseId; 
        
        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1 AND is_active = true`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });
        const content = result.rows[0];

        let isCourseOwner = false;
        if (requestedCourseId) {
             const cCheck = await pool.query(`SELECT educator_id FROM courses WHERE id = $1`, [requestedCourseId]);
             if (cCheck.rows.length > 0 && cCheck.rows[0].educator_id === req.user.id) {
                 isCourseOwner = true;
             }
        }

        const isOwner = content.created_by === req.user.id || isCourseOwner;
        if (!isOwner && !req.isContentCreator && !req.isEnrolled && !req.isPreviewContent) {
            return res.status(403).json({ 
                error: "Access denied. You are not enrolled in this course.",
                requiresEnrollment: true
            });
        }

        const type = String(content.content_type).toLowerCase();
        if (!type.includes("video")) return res.status(400).json({ error: "Not a video" });

        if (content.status !== "ready") {
            return res.status(202).json({
                status: content.status,
                message: content.status === "processing" ? "Video is still processing" : "Video processing failed"
            });
        }
        if (!content.r2_key) return res.status(404).json({ error: "Video manifest not found" });

        res.json({
            success: true,
            hlsUrl: `/api/hls/serve?videoId=${id}&path=master.m3u8`,
            duration: content.duration_seconds,
            accessType: isOwner || req.isContentCreator ? 'creator' : (req.isPreviewContent ? 'preview' : 'enrolled')
        });
    } catch (err) {
        console.error("Stream endpoint error:", err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/content/:id
router.put("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, preview } = req.body;

        const contentCheck = await pool.query(`SELECT * FROM content_items WHERE id = $1`, [id]);
        if (contentCheck.rows.length === 0) {
            return res.status(404).json({ error: "Content not found" });
        }

        const contentItem = contentCheck.rows[0];
        if (contentItem.created_by !== req.user.id && req.user.role !== "admin") {
            return res.status(403).json({ error: "Only the creator can update this content" });
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

        if (updateFields.length === 0) {
            return res.status(400).json({ error: "No fields to update" });
        }

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
        console.error("Update error:", err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/content/:id
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const contentCheck = await pool.query(`SELECT * FROM content_items WHERE id = $1`, [id]);

        if (contentCheck.rows.length === 0) {
            return res.status(404).json({ error: "Content asset not found" });
        }

        const contentItem = contentCheck.rows[0];
        if (contentItem.created_by !== req.user.id && req.user.role !== "admin") {
            return res.status(403).json({ error: "Only the creator can wipe content assets" });
        }

        if (contentItem.r2_key) {
            try {
                const type = String(contentItem.content_type).toLowerCase();
                if (type.includes("video")) {
                    const baseFolderPrefix = contentItem.r2_key.replace("/master.m3u8", "");
                    const listedObjects = await r2Client.send(new ListObjectsV2Command({
                        Bucket: R2_BUCKET_NAME,
                        Prefix: baseFolderPrefix
                    }));

                    if (listedObjects.Contents && listedObjects.Contents.length > 0) {
                        for (const object of listedObjects.Contents) {
                            await r2Client.send(new DeleteObjectCommand({
                                Bucket: R2_BUCKET_NAME,
                                Key: object.Key
                            }));
                        }
                    }
                } else {
                    await r2Client.send(new DeleteObjectCommand({
                        Bucket: R2_BUCKET_NAME,
                        Key: contentItem.r2_key
                    }));
                }
                console.log(`🧹 Cloudflare R2 Storage cleaned up cleanly for item key: ${contentItem.r2_key}`);
            } catch (r2Err) {
                console.error("⚠️ Failed to purge file cleanly from R2 bucket storage:", r2Err.message);
            }
        }

        await pool.query(`
            UPDATE content_items 
            SET is_active = false, 
                r2_key = NULL,
                updated_at = NOW()
            WHERE id = $1
        `, [id]);

        await pool.query(`
            UPDATE modules 
            SET content_ids = array_remove(content_ids, $1),
                updated_at = NOW()
            WHERE $1 = ANY(content_ids)
        `, [id]);

        res.json({ success: true, message: "Asset purged from storage and active course structures cleanly!" });
    } catch (err) {
        console.error("Delete error:", err);
        res.status(500).json({ error: err.message });
    }
});

// BACKGROUND TRANSCODER EXECUTION ENGINE
async function transcodeVideo(contentId, inputPath, fileHash, title, resolutions, duration) {
    console.log(`\n${"=".repeat(70)}\n🎬 TRANSCODING START — ID: ${contentId}\n${"=".repeat(70)}`);

    const outputDir = path.join(TEMP_VIDEO_DIR, `hls_${contentId}`);
    const hashPrefix = fileHash.slice(0, 6);
    const r2BasePath = `content/videos/${hashPrefix}/${fileHash}`;

    activeJobs.set(contentId, { title, startTime: Date.now(), resolutions: resolutions.map(r => r.name), status: "processing" });

    try {
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        for (const { name: resName, scale, bitrate } of resolutions) {
            const qualityDir = path.join(outputDir, resName);
            if (!fs.existsSync(qualityDir)) fs.mkdirSync(qualityDir, { recursive: true });

            const segmentPattern = path.join(qualityDir, "segment_%03d.ts");
            const playlistPath = path.join(qualityDir, "index.m3u8");

            console.log(`\n🎬 Compiling Variant layer [${resName}]...`);

            await new Promise((resolve, reject) => {
                const ffmpeg = spawn(ffmpegPath, [
                    "-i", inputPath,
                    "-vf", `scale=${scale}`,
                    "-c:v", "libx264", "-preset", "medium",
                    "-b:v", bitrate, "-maxrate", bitrate,
                    "-bufsize", `${parseInt(bitrate) * 2}k`,
                    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", 
                    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
                    "-f", "hls",
                    "-hls_time", "10",
                    "-hls_list_size", "0",
                    "-hls_segment_type", "mpegts",
                    "-hls_segment_filename", segmentPattern,
                    playlistPath
                ]);

            let lastLoggedFrame = 0;
            ffmpeg.stderr.on("data", (data) => {
                const str = data.toString();
                const match = str.match(/frame=\s*(\d+)/);
                if (match) {
                    const currentFrame = parseInt(match[1]);
                    if (currentFrame - lastLoggedFrame >= 500) {
                        console.log(`   🎬 ${resName}: frame ${currentFrame}`);
                        lastLoggedFrame = currentFrame;
                    }
                }
            });

                ffmpeg.on("close", (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`ffmpeg exited ${code} for ${resName}`));
                });
                ffmpeg.on("error", (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
            });

            const allFiles = fs.readdirSync(qualityDir).sort();
            const segments = allFiles.filter(f => f.endsWith(".ts"));

            for (const seg of segments) {
                const filePath = path.join(qualityDir, seg);
                await r2Client.send(new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: `${r2BasePath}/${resName}/${seg}`,
                    Body: fs.createReadStream(filePath), 
                    ContentType: "video/mp2t"
                }));
                fs.unlinkSync(filePath); 
            }

            if (fs.existsSync(playlistPath)) {
                await r2Client.send(new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: `${r2BasePath}/${resName}/index.m3u8`,
                    Body: fs.createReadStream(playlistPath), 
                    ContentType: "application/vnd.apple.mpegurl"
                }));
                fs.unlinkSync(playlistPath);
            }
        }

        let masterManifest = "#EXTM3U\n#EXT-X-VERSION:3\n";
        for (const res of resolutions) {
            const bandwidth = res.name === "1080p" ? "5000000" : res.name === "720p" ? "2800000" : "1200000";
            const resAttr = cleanResolutionString(res.scale); 
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
            SET status = 'ready',
                r2_key = $1,
                duration_seconds = $2,
                metadata = $3,
                updated_at = NOW()
            WHERE id = $4::uuid
        `, [masterR2Key, duration, metadataObj, contentId]);

        const elapsed = ((Date.now() - activeJobs.get(contentId).startTime) / 1000).toFixed(1);
        console.log(`\n✅ TRANSCODING COMPLETE in ${elapsed} seconds`);
        activeJobs.delete(contentId);

    } catch (err) {
        console.error(`❌ Transcoding failed:`, err.message);
        activeJobs.delete(contentId);

        await pool.query(`
            UPDATE content_items
            SET status = 'failed',
                metadata = $1,
                updated_at = NOW()
            WHERE id = $2::uuid
        `, [{ error: err.message, failed_at: new Date().toISOString() }, contentId]);
    } finally {
        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
        } catch (e) {
            console.warn("Cleanup warning:", e.message);
        }
    }
}
// ============================================================
// POST /api/content/upload-image
// Query Params: ?folder=thumbnails OR ?folder=quizzes
// ============================================================
// ============================================================
// POST /api/content/upload-image
// ============================================================

export default router;