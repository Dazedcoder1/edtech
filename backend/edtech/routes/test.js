import express from "express";
import multer from "multer";
import crypto from "crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import pool from "../config/database.js";
import { r2Client, R2_BUCKET_NAME } from "../config/r2.js";
import authMiddleware from "../middleware/auth.js";
import { activeEnrolmentSql } from "../utils/enrollmentAccess.js";
import { generateFileHash, getFileExtension, getMimeType } from "../utils/helpers.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

// POST /api/test/upload
router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        const { moduleId, title, description, folder_id } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!title) return res.status(400).json({ error: "Title is required" });
        if (!moduleId) return res.status(400).json({ error: "Module ID is required" });

        const courseCheck = await pool.query(`
            SELECT c.educator_id 
            FROM modules m
            JOIN courses c ON m.course_id = c.id
            WHERE m.id = $1
        `, [moduleId]);

        if (courseCheck.rows.length === 0) {
            return res.status(404).json({ error: "Module not found" });
        }

        if (courseCheck.rows[0].educator_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only course creator can upload tests" });
        }

        const mimeType = getMimeType(file.originalname);
        if (mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            return res.status(400).json({ error: "Only DOCX files are allowed" });
        }

        const fileHash = generateFileHash(file.buffer);
        const extension = getFileExtension(file.originalname);
        const hashPrefix = fileHash.slice(0, 6);
        const r2Key = `tests/${hashPrefix}/${fileHash}${extension}`;

        await r2Client.send(new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Key,
            Body: file.buffer,
            ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }));

        const result = await pool.query(`
            INSERT INTO test_files (
                module_id, title, description, file_name, file_size_bytes, 
                r2_key, status, created_by, folder_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
        `, [
            moduleId, title, description || "", file.originalname, file.size,
            r2Key, "ready", req.user.id, folder_id || null
        ]);

        res.status(201).json({
            success: true,
            message: "Test file uploaded successfully",
            test: result.rows[0]
        });

    } catch (err) {
        console.error("Test upload error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/test/:id
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            SELECT tf.*, m.course_id, c.educator_id as course_educator
            FROM test_files tf
            JOIN modules m ON tf.module_id = m.id
            JOIN courses c ON m.course_id = c.id
            WHERE tf.id = $1 AND tf.is_active = true
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Test not found" });
        }

        const test = result.rows[0];
        const isCreator = test.course_educator === req.user.id;
        const isEnrolled = await pool.query(
            `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND ${activeEnrolmentSql('')}`,
            [req.user.id, test.course_id]
        );

        if (!isCreator && isEnrolled.rows.length === 0 && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Access denied" });
        }

        const command = new GetObjectCommand({ 
            Bucket: R2_BUCKET_NAME, 
            Key: test.r2_key 
        });
        
        const signedUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });

        res.json({
            success: true,
            test: {
                ...test,
                downloadUrl: signedUrl
            }
        });

    } catch (err) {
        console.error("Get test error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/test/module/:moduleId
router.get("/module/:moduleId", authMiddleware, async (req, res) => {
    try {
        const { moduleId } = req.params;

        const result = await pool.query(`
            SELECT tf.*, u.name as creator_name
            FROM test_files tf
            JOIN users u ON tf.created_by = u.id
            WHERE tf.module_id = $1 AND tf.is_active = true
            ORDER BY tf.created_at DESC
        `, [moduleId]);

        res.json({
            success: true,
            tests: result.rows
        });

    } catch (err) {
        console.error("Get module tests error:", err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/test/:id
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            SELECT tf.*, c.educator_id
            FROM test_files tf
            JOIN modules m ON tf.module_id = m.id
            JOIN courses c ON m.course_id = c.id
            WHERE tf.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Test not found" });
        }

        const test = result.rows[0];

        if (test.educator_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Only course creator can delete tests" });
        }

        await pool.query(`
            UPDATE test_files 
            SET is_active = false, updated_at = NOW()
            WHERE id = $1
        `, [id]);

        res.json({ success: true, message: "Test deleted successfully" });

    } catch (err) {
        console.error("Delete test error:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
