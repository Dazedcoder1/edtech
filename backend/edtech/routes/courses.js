import express from "express";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/jwt.js";

const router = express.Router();

// GET /api/courses

router.get("/", async (req, res) => {
    try {
        let userId = null;
        let userRole = null;
        
        // 1. Peek at the token to see who is asking (Student or Educator)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const token = authHeader.split(" ")[1];
                const decoded = jwt.verify(token, JWT_SECRET);
                userId = decoded.id;
                userRole = decoded.role;
            } catch (err) {}
        }

        // 2. Base query
        let query = `
            SELECT c.*, u.name as educator_name
            FROM courses c
            JOIN users u ON c.educator_id = u.id
            WHERE c.is_active = true AND c.deleted_at IS NULL
        `;
        const params = [];

        // 3. Apply strict security filters based on role
        if (userRole === "admin") {
            // Admins see everything
        } else if (userRole === "educator" && userId) {
            // Educators see ALL published courses + ONLY their own drafts
            query += ` AND (c.status = 'published' OR c.educator_id = $1)`;
            params.push(userId);
        } else {
            // 🌟 STUDENTS AND GUESTS ONLY SEE PUBLISHED COURSES
            query += ` AND c.status = 'published'`;
        }

        query += ` ORDER BY c.created_at DESC`;

        const result = await pool.query(query, params);
        res.json({ success: true, courses: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/my-courses
router.get("/my-courses", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        let courses = [];

        if (userRole === "student") {
            const result = await pool.query(`
                SELECT
                    c.*,
                    u.name as educator_name,
                    e.enrolled_at,
                    e.progress,
                    e.last_accessed,
                    e.status as enrollment_status
                FROM enrollments e
                JOIN courses c ON e.course_id = c.id
                JOIN users u ON c.educator_id = u.id
                WHERE e.user_id = $1
                    AND e.status = 'active'
                    AND c.status = 'published'
                    AND c.deleted_at IS NULL
                ORDER BY e.enrolled_at DESC
            `, [userId]);
            courses = result.rows;
        } else if (userRole === "educator") {
            const result = await pool.query(`
                SELECT
                    c.*,
                    u.name as educator_name,
                    COUNT(DISTINCT e.user_id) as total_students,
                    COUNT(DISTINCT m.id) as total_modules,
                    COUNT(DISTINCT ci.id) as total_contents
                FROM courses c
                JOIN users u ON c.educator_id = u.id
                LEFT JOIN enrollments e ON c.id = e.course_id AND e.status = 'active'
                LEFT JOIN modules m ON c.id = m.course_id
                LEFT JOIN content_items ci ON ci.id = ANY(m.content_ids)
                WHERE c.educator_id = $1
                    AND c.deleted_at IS NULL
                GROUP BY c.id, u.name
                ORDER BY c.created_at DESC
            `, [userId]);
            courses = result.rows;
        } else if (userRole === "admin") {
            const result = await pool.query(`
                SELECT
                    c.*,
                    u.name as educator_name,
                    COUNT(DISTINCT e.user_id) as total_students
                FROM courses c
                JOIN users u ON c.educator_id = u.id
                LEFT JOIN enrollments e ON c.id = e.course_id AND e.status = 'active'
                WHERE c.deleted_at IS NULL
                GROUP BY c.id, u.name
                ORDER BY c.created_at DESC
            `);
            courses = result.rows;
        }

        res.json({
            success: true,
            role: userRole,
            count: courses.length,
            courses
        });
    } catch (err) {
        console.error("My courses error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/courses/:id
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const courseResult = await pool.query(`
            SELECT c.*, u.name as educator_name
            FROM courses c
            JOIN users u ON c.educator_id = u.id
            WHERE c.id = $1 AND c.status = 'published' AND c.is_active = true
        `, [id]);

        if (courseResult.rows.length === 0) {
            return res.status(404).json({ error: "Course not found" });
        }

        const course = courseResult.rows[0];

        let isEnrolled = false;
        let isCreator = false;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const token = authHeader.split(" ")[1];
                const decoded = jwt.verify(token, JWT_SECRET);

                const enrollmentCheck = await pool.query(
                    `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
                    [decoded.id, id]
                );
                isEnrolled = enrollmentCheck.rows.length > 0;
                isCreator = course.educator_id === decoded.id;
            } catch (err) {
                // Never swallow this. A verify failure here silently strips
                // isCreator/isEnrolled, so the UI hides every educator control
                // and looks like a permissions bug with nothing in the logs.
                console.warn(
                    `[courses] token verification failed on GET /courses/${id}: ${err.message}. ` +
                    `isCreator/isEnrolled will be false.`
                );
            }
        }


        const modulesResult = await pool.query(`
            SELECT * FROM modules
            WHERE course_id = $1 AND is_active = true
            ORDER BY module_order ASC
        `, [id]);

        const modules = [];
        for (const module of modulesResult.rows) {
            let contents = [];
            if (module.content_ids && module.content_ids.length > 0) {
                // ✅ FIXED: Added all needed fields including file_size_bytes
                const contentResult = await pool.query(`
                    SELECT 
                        id, 
                        title, 
                        description, 
                        content_type, 
                        duration_seconds,
                        thumbnail_url, 
                        preview, 
                        priority, 
                        file_size_bytes,
                        file_name,
                        mime_type,
                        status,
                        r2_key,
                        created_at,
                        folder_id
                    FROM content_items
                    WHERE id = ANY($1::uuid[])
                    AND is_active = true
                    AND ($2::boolean OR status = 'ready')
                `, [module.content_ids, isCreator]);
                
                // Log the file sizes for debugging
                contentResult.rows.forEach(c => {
                    if (c.content_type === 'pdf') {
                        console.log(`📄 PDF: ${c.title} - ${c.file_size_bytes || 0} bytes`);
                    }
                });
                
                contents = contentResult.rows;
            }
            modules.push({ ...module, contents });
        }

        res.json({
            success: true,
            course: {
                ...course,
                isEnrolled,
                isCreator
            },
            modules
        });
    } catch (err) {
        console.error("Course fetch error:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/courses
router.post("/", authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== "educator" && req.user.role !== "admin") {
            return res.status(403).json({ error: "Only educators can create courses" });
        }

        const { title, description, price, status, parent_course_id, thumbnail_url } = req.body;

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const courseResult = await client.query(`
    INSERT INTO courses (educator_id, title, description, price, status, thumbnail_url, is_active, parent_course_id)
    VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING *
`, [req.user.id, title, description, price || 0, status || "draft", thumbnail_url || null, parent_course_id || null]);
            const course = courseResult.rows[0];

            const moduleResult = await client.query(`
                INSERT INTO modules (course_id, title, description, module_order, content_ids, is_active)
                VALUES ($1, $2, $3, $4, $5, true) RETURNING *
            `, [course.id, "Preview Module", "Course preview content - get a glimpse of what you'll learn", 0, []]);

            await client.query("COMMIT");

            res.status(201).json({
                success: true,
                course: course,
                previewModule: moduleResult.rows[0],
                message: "Course created with preview module"
            });

        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

    } catch (err) {
        console.error("Course creation error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/courses/reorder
router.put("/reorder", authMiddleware, async (req, res) => {
    try {
        const { orderedIds } = req.body;

        if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
            return res.status(400).json({ error: "orderedIds array is required" });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            for (let i = 0; i < orderedIds.length; i++) {
                await client.query(
                    `UPDATE courses
                     SET display_order = $1, updated_at = NOW()
                     WHERE id = $2 AND educator_id = $3`,
                    [i, orderedIds[i], req.user.id]
                );
            }

            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        res.json({ success: true, message: "Order updated" });
    } catch (err) {
        console.error("Reorder error:", err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/courses/:id
router.put("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (!req.isCourseCreator) {
            return res.status(403).json({ error: "Only course creator can update courses" });
        }

        const { title, description, price, status ,thumbnail_url} = req.body;

        const result = await pool.query(`
    UPDATE courses
    SET title = COALESCE($1, title),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        status = COALESCE($4, status),
        thumbnail_url = COALESCE($5, thumbnail_url),
        updated_at = NOW()
    WHERE id = $6
    RETURNING *
`, [title, description, price, status, thumbnail_url, id]);
        res.json({ success: true, course: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/courses/:id
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const courseId = req.query.courseId || req.params.id;

        if (!courseId) {
            return res.status(400).json({ error: "courseId is required" });
        }

        const courseCheck = await pool.query(
            `SELECT educator_id FROM courses WHERE id = $1 AND is_active = true`,
            [courseId]
        );

        if (courseCheck.rows.length === 0) {
            return res.status(404).json({ error: "Course not found or already deleted" });
        }

        if (courseCheck.rows[0].educator_id !== req.user.id) {
            return res.status(403).json({ error: "Only course creator can delete courses" });
        }

        await pool.query(`
            UPDATE courses
            SET is_active = false,
                status = 'deleted',
                updated_at = NOW()
            WHERE id = $1 AND is_active = true
        `, [courseId]);

        res.json({ success: true, message: "Course deactivated successfully" });
    } catch (err) {
        console.error("Delete course error:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/courses/:id/reactivate
router.post("/:id/reactivate", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (!req.isCourseCreator) {
            return res.status(403).json({ error: "Only course creator can reactivate" });
        }

        const result = await pool.query(`
            UPDATE courses
            SET is_active = true,
                status = 'draft',
                updated_at = NOW()
            WHERE id = $1 AND is_active = false
            RETURNING id
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Course not found or already active" });
        }

        res.json({ success: true, message: "Course reactivated successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;