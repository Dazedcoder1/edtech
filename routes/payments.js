import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import pool from "../config/database.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

/*
 * Dead copy — see the note in ../config/database.js. The deployed payments
 * code is backend/edtech/routes/payments.js.
 *
 * The literal key_id and key_secret that were here have been removed. A key
 * secret in source is a signing key anyone with the repository can use.
 */
const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Route 1: Create Razorpay Order
router.post("/create-order", authMiddleware, async (req, res) => {
    const { courseId } = req.body;
    const userId = req.user.id;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const existingEnrollment = await client.query(`
            SELECT status FROM enrollments 
            WHERE user_id = $1 AND course_id = $2 AND status = 'active'
        `, [userId, courseId]);
        
        if (existingEnrollment.rows.length > 0) {
            return res.status(400).json({ error: "Already enrolled in this course" });
        }
        
        const course = await client.query(`
            SELECT price, title FROM courses WHERE id = $1
        `, [courseId]);
        
        if (course.rows.length === 0) {
            return res.status(404).json({ error: "Course not found" });
        }
        
        const courseData = course.rows[0];
        
        const pendingOrder = await client.query(`
            SELECT order_id FROM payment_orders 
            WHERE user_id = $1 AND course_id = $2 AND status = 'created'
            ORDER BY created_at DESC LIMIT 1
        `, [userId, courseId]);
        
        let orderId;
        
        if (pendingOrder.rows.length > 0) {
            orderId = pendingOrder.rows[0].order_id;
        } else {
            const options = {
                amount: Math.round(courseData.price * 100),
                currency: "INR",
                receipt: `receipt_${Date.now()}_${userId.slice(0, 8)}`,
                notes: {
                    courseId: courseId,
                    userId: userId,
                    courseTitle: courseData.title
                }
            };
            
            const order = await razorpayInstance.orders.create(options);
            orderId = order.id;
            
            await client.query(`
                INSERT INTO payment_orders (order_id, user_id, course_id, amount, status)
                VALUES ($1, $2, $3, $4, 'created')
            `, [orderId, userId, courseId, courseData.price]);
        }
        
        await client.query(`
            INSERT INTO enrollments (user_id, course_id, payment_status, status)
            VALUES ($1, $2, 'pending', 'pending')
            ON CONFLICT (user_id, course_id) 
            DO UPDATE SET payment_status = 'pending', status = 'pending', updated_at = NOW()
        `, [userId, courseId]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            orderId: orderId,
            keyId: process.env.RAZORPAY_KEY_ID,
            amount: courseData.price,
            currency: "INR",
            courseTitle: courseData.title
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Create order error:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Route 2: Verify Payment and Enroll User
router.post("/verify", authMiddleware, async (req, res) => {
    const { orderId, paymentId, signature, courseId } = req.body;
    const userId = req.user.id;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const orderCheck = await client.query(`
            SELECT id, user_id, course_id, amount, status 
            FROM payment_orders 
            WHERE order_id = $1
        `, [orderId]);
        
        if (orderCheck.rows.length === 0) {
            return res.status(404).json({ error: "Order not found" });
        }
        
        const order = orderCheck.rows[0];
        
        if (order.user_id !== userId) {
            return res.status(403).json({ error: "Unauthorized: Payment belongs to different user" });
        }
        
        if (order.status === 'completed') {
            return res.json({ success: true, alreadyEnrolled: true, message: "Already enrolled" });
        }
        
        const body = orderId + "|" + paymentId;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");
        
        if (expectedSignature !== signature) {
            return res.status(400).json({ error: "Invalid payment signature" });
        }
        
        const razorpayOrder = await razorpayInstance.orders.fetch(orderId);
        if (razorpayOrder.amount_paid !== razorpayOrder.amount) {
            return res.status(400).json({ error: "Full amount not paid" });
        }
        
        await client.query(`
            UPDATE payment_orders 
            SET status = 'completed', 
                razorpay_payment_id = $1,
                razorpay_signature = $2,
                updated_at = NOW()
            WHERE order_id = $3
        `, [paymentId, signature, orderId]);
        
        await client.query(`
            UPDATE enrollments 
            SET status = 'active', 
                payment_status = 'completed',
                payment_id = $1,
                amount_paid = $2,
                enrolled_at = NOW(),
                updated_at = NOW()
            WHERE user_id = $3 AND course_id = $4
        `, [paymentId, order.amount, userId, courseId]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: "Payment verified and enrollment successful!"
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Payment verification error:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Route 3: Check Enrollment Status
router.get("/enrollments/status/:courseId", authMiddleware, async (req, res) => {
    const { courseId } = req.params;
    const userId = req.user.id;
    
    try {
        const result = await pool.query(`
            SELECT status, payment_status, payment_id, enrolled_at, amount_paid
            FROM enrollments 
            WHERE user_id = $1 AND course_id = $2
        `, [userId, courseId]);
        
        if (result.rows.length === 0) {
            return res.json({ status: 'not_enrolled', enrolled: false });
        }
        
        const enrollment = result.rows[0];
        res.json({
            status: enrollment.status,
            enrolled: enrollment.status === 'active',
            paymentStatus: enrollment.payment_status,
            paymentId: enrollment.payment_id,
            enrolledAt: enrollment.enrolled_at,
            amountPaid: enrollment.amount_paid
        });
        
    } catch (error) {
        console.error("Status check error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Route 4: Get Payment Order Status
router.get("/order/:orderId/status", authMiddleware, async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    try {
        const result = await pool.query(`
            SELECT status, razorpay_payment_id, amount, created_at
            FROM payment_orders 
            WHERE order_id = $1 AND user_id = $2
        `, [orderId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Order not found" });
        }
        
        res.json({ success: true, order: result.rows[0] });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;