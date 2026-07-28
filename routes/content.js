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

if (!fs.existsSync(TEMP_VIDEO_DIR)) {
    fs.mkdirSync(TEMP_VIDEO_DIR, { recursive: true });
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 }
});

const activeJobs = new Map();

// POST /api/content/upload
router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        const { title, description, content_type, preview } = req.body;
        const file = req.file;
        
        if (req.user.role !== 'educator' && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only educators can upload content" });
        }
        
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!title || !content_type) return res.status(400).json({ error: "title and content_type are required" });

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname);
        const mimeType = getMimeType(file.originalname);

        const existing = await pool.query(`SELECT * FROM content_items WHERE file_hash = $1`, [fileHash]);
        if (existing.rows.length > 0) {
            return res.status(200).json({ success: true, message: "File already exists.", content: existing.rows[0], isDuplicate: true });
        }

        const hashPrefix = fileHash.slice(0, 6);
        const r2Key = `content/${hashPrefix}/${fileHash}${extension}`;
        await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key, Body: file.buffer, ContentType: mimeType }));

        const result = await pool.query(`
            INSERT INTO content_items (title, description, content_type, file_hash, file_name, file_size_bytes, mime_type, r2_key, status, preview, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9, $10) RETURNING *
        `, [title, description, content_type, fileHash, file.originalname, file.size, mimeType, r2Key, preview === 'true' || preview === true, req.user.id]);

        res.status(201).json({ success: true, content: result.rows[0] });
    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// POST /api/content/upload-image
// 🌟 NEW: Used by QuizModal.jsx's "Add Diagram" button. Uploads a small
// standalone image (quiz diagrams etc, not tied to a content_items row)
// straight to R2 and returns a URL the frontend can use directly as
// <img src>. This does NOT touch content_items -- it's a lighter-weight
// path than the main course-content upload.
// ============================================================
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

        // Frontend just needs a URL it can drop into <img src>.
        // Route it through our own stream-image endpoint (below) so we
        // don't need to expose public R2 URLs.
        const imageUrl = `/api/content/stream-image?key=${encodeURIComponent(r2Key)}`;

        res.status(201).json({ success: true, imageUrl, key: r2Key });
    } catch (err) {
        console.error("Image upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// GET /api/content/stream-image
// 🌟 NEW: Serves an image previously stored via /upload-image, straight
// from R2. Used as the <img src> for quiz diagrams both in QuizModal.jsx
// (preview) and QuizTakeModal.jsx (student view).
// ============================================================
router.get("/stream-image", authMiddleware, async (req, res) => {
    try {
        const { key } = req.query;
        if (!key) return res.status(400).json({ error: "key is required" });

        // Only ever serve keys under images/ -- this route isn't a generic
        // R2 proxy, just an image server for the image-upload feature above.
        if (!key.startsWith("images/")) {
            return res.status(400).json({ error: "Invalid image key" });
        }

        const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
        const r2Response = await r2Client.send(command);

        const chunks = [];
        for await (const chunk of r2Response.Body) {
            chunks.push(chunk);
        }
        const imageBuffer = Buffer.concat(chunks);

        res.setHeader("Content-Type", r2Response.ContentType || "image/jpeg");
        res.setHeader("Content-Length", imageBuffer.length);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(imageBuffer);

    } catch (err) {
        console.error("Stream image error:", err);
        if (err.name === "NoSuchKey" || err.Code === "NoSuchKey") {
            return res.status(404).json({ error: "Image not found in storage" });
        }
        res.status(500).json({ error: "Failed to load image", details: err.message });
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

        if (req.user.role !== 'educator' && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only educators can upload videos" });
        }

        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!title) return res.status(400).json({ error: "Title is required" });
        if (!file.mimetype.startsWith("video/")) return res.status(400).json({ error: "Only video files are allowed" });

        console.log(`\n${"=".repeat(70)}\n📤 VIDEO UPLOAD STARTED\n${"=".repeat(70)}`);
        console.log(`📹 ${file.originalname} — ${(file.size / (1024 * 1024)).toFixed(2)} MB`);

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname);

        const existing = await pool.query(`SELECT * FROM content_items WHERE file_hash = $1`, [fileHash]);
        if (existing.rows.length > 0) {
            console.log(`📎 Duplicate video detected`);
            return res.status(200).json({ success: true, message: "Video already exists.", content: existing.rows[0], isDuplicate: true });
        }

        const tempFilePath = path.join(TEMP_VIDEO_DIR, `${fileHash}${extension}`);
        fs.writeFileSync(tempFilePath, file.buffer);
        console.log(`💾 Saved temp: ${path.basename(tempFilePath)}`);

        let videoInfo = { width: 0, height: 0, duration: 0 };
        await new Promise((resolve) => {
            const ffprobe = spawn("ffprobe", [
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-show_entries", "format=duration",
                "-of", "json",
                tempFilePath
            ]);
            let output = "";
            ffprobe.stdout.on("data", d => { output += d.toString(); });
            ffprobe.on("close", () => {
                try {
                    const data = JSON.parse(output);
                    if (data.streams?.[0]) {
                        videoInfo.width = data.streams[0].width || 0;
                        videoInfo.height = data.streams[0].height || 0;
                    }
                    if (data.format?.duration) {
                        videoInfo.duration = Math.round(parseFloat(data.format.duration));
                    }
                } catch (e) {}
                resolve();
            });
        });
        console.log(`📐 ${videoInfo.width}x${videoInfo.height}, ${videoInfo.duration}s`);

        const resolutions = [{ name: "480p", scale: "854:480", bitrate: "1000k" }];
        if (videoInfo.height >= 720) resolutions.push({ name: "720p", scale: "1280:720", bitrate: "2500k" });
        if (videoInfo.height >= 1080) resolutions.push({ name: "1080p", scale: "1920:1080", bitrate: "4500k" });
        console.log(`🎬 Resolutions: ${resolutions.map(r => r.name).join(", ")}`);

        const result = await pool.query(`
            INSERT INTO content_items (
                title, description, content_type,
                file_hash, file_name, file_size_bytes, mime_type,
                duration_seconds, status, preview, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        `, [
            title,
            description || "",
            "video",
            fileHash,
            file.originalname,
            file.size,
            file.mimetype,
            videoInfo.duration,
            "processing",
            preview === 'true' || preview === true,
            req.user.id
        ]);

        const contentId = result.rows[0].id;
        console.log(`📝 DB entry created: ${contentId}`);

        transcodeVideo(contentId, tempFilePath, fileHash, title, resolutions, videoInfo.duration);

        res.status(202).json({
            success: true,
            message: "Video uploaded. Processing in background.",
            content: { id: contentId, title, content_type: "video", status: "processing", preview: preview === 'true' || preview === true }
        });
    } catch (err) {
        console.error("❌ Video upload error:", err);
        res.status(500).json({ success: false, error: err.message });
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

// ============================================
// ⭐ FIXED PDF ROUTE
// ============================================
// GET /api/content/:id/pdf
router.get("/:id/pdf", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { courseId } = req.query;
        
        console.log(`📄 PDF Request: contentId=${id}, courseId=${courseId}`);
        console.log(`👤 User: ${req.user.id} (${req.user.role})`);
        
        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1`, [id]);
        if (result.rows.length === 0) {
            console.log(`❌ Content not found: ${id}`);
            return res.status(404).json({ error: "Content not found" });
        }
        
        const content = result.rows[0];
        console.log(`📄 Content found: "${content.title}" (${content.content_type})`);
        console.log(`📄 R2 Key: ${content.r2_key}`);
        
        if (content.content_type !== "pdf") {
            console.log(`❌ Not a PDF: ${content.content_type}`);
            return res.status(400).json({ error: "Not a PDF file" });
        }
        
        let hasAccess = false;
        
        if (courseId) {
            const courseCheck = await pool.query(
                `SELECT educator_id FROM courses WHERE id = $1`,
                [courseId]
            );
            
            if (courseCheck.rows.length > 0) {
                const isCreator = courseCheck.rows[0].educator_id === req.user.id;
                if (isCreator) {
                    hasAccess = true;
                    console.log(`✅ User is course creator`);
                }
            }
            
            if (!hasAccess) {
                const enrollmentCheck = await pool.query(
                    `SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2`,
                    [req.user.id, courseId]
                );
                
                if (enrollmentCheck.rows.length > 0) {
                    hasAccess = true;
                    console.log(`✅ User is enrolled in course`);
                }
            }
        }
        
        if (!hasAccess && content.preview) {
            hasAccess = true;
            console.log(`✅ Content is preview, access granted`);
        }
        
        if (!hasAccess && req.user.role === 'admin') {
            hasAccess = true;
            console.log(`✅ User is admin, access granted`);
        }
        
        if (!hasAccess) {
            console.log(`❌ Access denied for user ${req.user.id}`);
            return res.status(403).json({ 
                error: "Access denied. You are not enrolled in this course.",
                requiresEnrollment: true
            });
        }
        
        if (!content.r2_key) {
            console.error(`❌ No r2_key for content ${id}`);
            return res.status(404).json({ error: "PDF file not found in storage" });
        }
        
        try {
            console.log(`🔍 Fetching from R2: ${content.r2_key}`);
            
            const command = new GetObjectCommand({ 
                Bucket: R2_BUCKET_NAME, 
                Key: content.r2_key 
            });
            
            const r2Response = await r2Client.send(command);
            console.log(`✅ R2 response received`);
            
            const chunks = [];
            for await (const chunk of r2Response.Body) {
                chunks.push(chunk);
            }
            
            const pdfBuffer = Buffer.concat(chunks);
            console.log(`📄 PDF size: ${pdfBuffer.length} bytes`);
            
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(content.file_name || content.title + '.pdf')}"`);
            res.setHeader("Content-Length", pdfBuffer.length);
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
            
            res.send(pdfBuffer);
            
            console.log(`✅ PDF served successfully: ${content.title}`);
            
        } catch (r2Error) {
            console.error(`❌ R2 fetch error:`, r2Error);
            
            if (r2Error.name === "NoSuchKey" || r2Error.Code === "NoSuchKey") {
                return res.status(404).json({ 
                    error: "PDF file not found in storage. Please re-upload the file."
                });
            }
            
            throw r2Error;
        }
        
    } catch (err) {
        console.error("❌ PDF fetch error:", err);
        res.status(500).json({ 
            error: "Failed to load PDF",
            details: err.message 
        });
    }
});

router.options("/:id/pdf", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(200).end();
});

// GET /api/content/:id/stream
router.get("/:id/stream", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!req.isContentCreator && !req.isEnrolled && !req.isPreviewContent) {
            return res.status(403).json({ 
                error: "Access denied. You are not enrolled in this course.",
                requiresEnrollment: true,
                courseId: req.courseId
            });
        }
        
        const result = await pool.query(`SELECT * FROM content_items WHERE id = $1`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Content not found" });

        const content = result.rows[0];
        if (content.content_type !== "video") return res.status(400).json({ error: "Not a video" });

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
            accessType: req.isContentCreator ? 'creator' : (req.isPreviewContent ? 'preview' : 'enrolled')
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
        
        const contentCheck = await pool.query(`
            SELECT ci.*, c.educator_id 
            FROM content_items ci
            JOIN modules m ON ci.id = ANY(m.content_ids)
            JOIN courses c ON m.course_id = c.id
            WHERE ci.id = $1
            LIMIT 1
        `, [id]);
        
        if (contentCheck.rows.length === 0) {
            return res.status(404).json({ error: "Content not found" });
        }
        
        if (contentCheck.rows[0].educator_id !== req.user.id) {
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
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/content/:id
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const contentCheck = await pool.query(`
            SELECT c.educator_id 
            FROM content_items ci
            JOIN modules m ON ci.id = ANY(m.content_ids)
            JOIN courses c ON m.course_id = c.id
            WHERE ci.id = $1
            LIMIT 1
        `, [id]);
        
        if (contentCheck.rows.length === 0) {
            return res.status(404).json({ error: "Content not found" });
        }
        
        if (contentCheck.rows[0].educator_id !== req.user.id) {
            return res.status(403).json({ error: "Only course creator can delete content" });
        }
        
        await pool.query(`
            UPDATE content_items 
            SET is_active = false, 
                updated_at = NOW()
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

async function transcodeVideo(contentId, inputPath, fileHash, title, resolutions, duration) {
    console.log(`\n${"=".repeat(70)}\n🎬 TRANSCODING — ${contentId}\n${"=".repeat(70)}`);

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

                ffmpeg.stderr.on("data", (data) => {
                    const str = data.toString();
                    const match = str.match(/frame=\s*(\d+)/);
                    if (match && parseInt(match[1]) % 500 === 0) {
                        console.log(`  🎬 ${resName}: frame ${match[1]}`);
                    }
                });

                ffmpeg.on("close", (code) => {
                    if (code === 0) {
                        console.log(`✅ ${resName} ffmpeg done`);
                        resolve();
                    } else {
                        reject(new Error(`ffmpeg exited ${code} for ${resName}`));
                    }
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
                console.log(`  ✓ ${resName}/${seg}`);
                fs.unlinkSync(filePath);
            }

            if (fs.existsSync(playlistPath)) {
                await r2Client.send(new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: `${r2BasePath}/${resName}/index.m3u8`,
                    Body: fs.readFileSync(playlistPath),
                    ContentType: "application/vnd.apple.mpegurl"
                }));
                console.log(`  ✓ ${resName}/index.m3u8`);
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
        console.log(`✅ Master manifest uploaded to: ${masterR2Key}`);

        const resolutionNames = resolutions.map(r => r.name);
        const metadataObj = {
            resolutions: resolutionNames,
            r2_base_path: r2BasePath,
            completed_at: new Date().toISOString()
        };

        await pool.query(`
            UPDATE content_items
            SET 
                status = 'ready',
                r2_key = $1,
                duration_seconds = $2,
                metadata = $3,
                updated_at = NOW()
            WHERE id = $4::uuid
        `, [masterR2Key, duration, metadataObj, contentId]);

        const elapsed = ((Date.now() - activeJobs.get(contentId).startTime) / 1000).toFixed(1);
        console.log(`\n✅ TRANSCODING COMPLETE in ${elapsed} seconds`);
        activeJobs.delete(contentId);

        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
            console.log("🧹 Temp files cleaned up");
        } catch (e) {
            console.warn("Cleanup warning:", e.message);
        }

    } catch (err) {
        console.error(`❌ Transcoding failed:`, err.message);
        activeJobs.delete(contentId);

        await pool.query(`
            UPDATE content_items
            SET 
                status = 'failed',
                metadata = $1,
                updated_at = NOW()
            WHERE id = $2::uuid
        `, [{
            error: err.message,
            failed_at: new Date().toISOString()
        }, contentId]);

        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            const od = path.join(TEMP_VIDEO_DIR, `hls_${contentId}`);
            if (fs.existsSync(od)) fs.rmSync(od, { recursive: true, force: true });
        } catch (e) {
            console.warn("Cleanup warning:", e.message);
        }
    }
}

export default router;