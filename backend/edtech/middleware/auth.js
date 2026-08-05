import jwt from "jsonwebtoken";
import { activeEnrolmentSql } from "../utils/enrollmentAccess.js";
import pool from "../config/database.js";

import { JWT_SECRET } from "../config/jwt.js";

/**
 * Authenticate only. No course, module or content resolution.
 *
 * authMiddleware below does two jobs: it verifies the token, and it infers
 * which course/module/content the request is about so it can decide access.
 * That inference reads `req.params.id` and, for any path not containing
 * "course" or "module", treats it as a *content* id:
 *
 *     const contentId = ... || (req.params.id && !req.path.includes('course')
 *                                              && !req.path.includes('module')
 *                                 ? req.params.id : null);
 *
 * For a route like GET /api/support/tickets/:id that guess is simply wrong.
 * The lookup finds no content_items row, no access flag gets set, and the
 * decision block at the end returns 403 "You do not have permission to view or
 * manage this content" — for a student reading their own support ticket.
 *
 * Educators did not see it, because a missing content row grants them a
 * creator bypass. So the bug presented as "works for teachers, denied for
 * students", which looks like a permissions rule and is actually a bad guess.
 *
 * Any router whose ids are not content ids should use this instead. It is the
 * same token check, with none of the inference.
 */
export async function authOnly(req, res, next) {
    try {
        let token;

        if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
            token = req.headers.authorization.split(" ")[1];
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({ error: "Authentication required" });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        req.user = {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role,
            name: decoded.name,
        };

        next();
    } catch (err) {
        console.error("authOnly error:", err.message);
        res.status(500).json({ error: "Authentication failed" });
    }
}

async function authMiddleware(req, res, next) {
  try {
      console.log('\n' + '='.repeat(70));
      console.log('🔐 AUTH MIDDLEWARE - REQUEST');
      console.log('='.repeat(70));
      console.log(`📍 Path: ${req.method} ${req.path}`);
      console.log(`📦 Params:`, req.params);
      console.log(`📦 Query Params:`, req.query);
      
      // ========== 1. AUTHENTICATION ==========
      let token;
      
      // Check if the token is in the Header
      if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
          token = req.headers.authorization.split(" ")[1];
          console.log('🎫 Token found in Authorization header');
      } 
      // If not in header, check the Query Params (e.g. for streaming/PDF frames)
      else if (req.query.token) {
          token = req.query.token;
          console.log('🎫 Token found in Query Parameters');
      }

      // If no token at all, stop here
      if (!token) {
          console.log('❌ No token provided');
          return res.status(401).json({ error: "Authentication required" });
      }
      
      let decoded;
      try {
          decoded = jwt.verify(token, JWT_SECRET);
          console.log(`✅ Token verified for user: ${decoded.email}`);
      } catch (err) {
          console.log('❌ Invalid token:', err.message);
          return res.status(401).json({ error: "Invalid or expired token" });
      }
      
      // Basic user info from token
      req.user = {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
          name: decoded.name
      };

      // ========== 2. PARAMETER RESOLUTION ==========
      // Extract parameters safely across mixed query and URL parameters
      const courseId = req.query.courseId || req.params.courseId || (req.params.id && req.path.includes('course') ? req.params.id : null);
      const contentId = req.query.contentId || req.params.contentId || (req.params.id && !req.path.includes('course') && !req.path.includes('module') ? req.params.id : null);
      const moduleId = req.query.moduleId || req.params.moduleId || (req.params.id && req.path.includes('module') ? req.params.id : null);
      
      console.log(`\n📌 Parameters resolved:`);
      console.log(`   - courseId: ${courseId || '❌ not provided'}`);
      console.log(`   - contentId: ${contentId || '❌ not provided'}`);
      console.log(`   - moduleId: ${moduleId || '❌ not provided'}`);
      
      // Initialize default values for authorization flags
      req.isCourseCreator = false;
      req.isContentCreator = false;
      req.isPreviewContent = false;
      req.isEnrolled = false;

      // ========== 3. CHECK COURSE CREATOR STATUS ==========
      if (courseId && courseId !== contentId) {
          console.log(`\n🔍 Checking course creator status for courseId: ${courseId}`);
          const courseCheck = await pool.query(
              `SELECT educator_id, title FROM courses WHERE id = $1 AND is_active = true`,
              [courseId]
          );
          if (courseCheck.rows.length > 0) {
              req.isCourseCreator = (courseCheck.rows[0].educator_id === req.user.id);
              req.courseId = courseId;
              req.courseTitle = courseCheck.rows[0].title;
              console.log(`   - Course title: ${courseCheck.rows[0].title}`);
              console.log(`   - isCourseCreator: ${req.isCourseCreator ? '✅ YES' : '❌ NO'}`);
          } else {
              console.log(`   - ❌ Course not found or inactive`);
          }
      }
      
      // ========== 4. CHECK MODULE OWNERSHIP ==========
      if (moduleId) {
          console.log(`\n🔍 Checking module ownership for moduleId: ${moduleId}`);
          const moduleCheck = await pool.query(`
              SELECT m.*, c.educator_id, c.title as course_title
              FROM modules m
              JOIN courses c ON m.course_id = c.id
              WHERE m.id = $1 AND m.is_active = true
          `, [moduleId]);
          
          if (moduleCheck.rows.length > 0) {
              req.courseId = moduleCheck.rows[0].course_id;
              req.moduleId = moduleId;
              req.moduleTitle = moduleCheck.rows[0].title;
              req.isCourseCreator = (moduleCheck.rows[0].educator_id === req.user.id);
              console.log(`   - Module title: ${moduleCheck.rows[0].title}`);
              console.log(`   - Associated course: ${moduleCheck.rows[0].course_title}`);
              console.log(`   - isCourseCreator: ${req.isCourseCreator ? '✅ YES' : '❌ NO'}`);
          } else {
              console.log(`   - ❌ Module not found or inactive`);
          }
      }
      
      // ========== 5. CHECK CONTENT ACCESS ==========
      if (contentId) {
          console.log(`\n🎬 Checking content access for contentId: ${contentId}`);
          
          // Fixed structural query layout (Removes invalid c.course_id check)
          const contentCheck = await pool.query(`
              SELECT c.*, 
                     m.course_id,
                     co.educator_id,
                     co.title as course_title
              FROM content_items c
              LEFT JOIN modules m ON c.id = ANY(m.content_ids)
              LEFT JOIN courses co ON m.course_id = co.id
              WHERE c.id = $1 AND c.is_active = true
              LIMIT 1
          `, [contentId]);
          
          if (contentCheck.rows.length > 0) {
              const content = contentCheck.rows[0];
              
              if (content.course_id) {
                  req.courseId = content.course_id;
                  req.courseTitle = content.course_title;
                  req.isCourseCreator = (content.educator_id === req.user.id);
              }
              
              req.contentId = contentId;
              req.contentTitle = content.title;

              // content_items.created_by must count as ownership.
              //
              // Without it, this middleware is stricter than the route handlers
              // it guards — routes/content.js checks created_by and admin, but
              // never gets the chance because the 403 is thrown here first.
              //
              // It also fails for content not yet linked to a module: the LEFT
              // JOIN yields a NULL educator_id, so the person who uploaded the
              // file cannot open it.
              const isUploader =
                  content.created_by &&
                  String(content.created_by).toLowerCase() === String(req.user.id).toLowerCase();

              req.isContentCreator =
                  isUploader ||
                  (content.educator_id === req.user.id) ||
                  req.isCourseCreator ||
                  req.user.role === 'admin';

              req.isPreviewContent = content.preview === true;

              console.log(`   - created_by match: ${isUploader ? '✅ YES' : '❌ NO'}`);
              
              console.log(`   - Content title: ${content.title}`);
              console.log(`   - Content type: ${content.content_type}`);
              console.log(`   - Preview flag: ${content.preview === true ? '✅ true' : '❌ false'}`);
              console.log(`   - Associated course: ${content.course_title || '❌ Not assigned to a module yet'}`);
              console.log(`   - isContentCreator: ${req.isContentCreator ? '✅ YES' : '❌ NO'}`);
              console.log(`   - isPreviewContent: ${req.isPreviewContent ? '✅ YES' : '❌ NO'}`);
              
              // Verify active enrollment status if user isn't the creator or a preview customer
              if (!req.isContentCreator && !req.isPreviewContent && req.courseId) {
                  console.log(`   - Checking enrollment (non-creator, non-preview)...`);

                  // Accept an enrolment on the parent course too. Content often
                  // sits in a sub-course while the student enrolled in the
                  // parent, and checking only the immediate course locks them
                  // out of material they have paid for.
                  const enrollmentCheck = await pool.query(
                      `SELECT e.id
                       FROM enrollments e
                       WHERE e.user_id = $1
                         AND ${activeEnrolmentSql('e')}
                         AND e.course_id IN (
                             SELECT $2::uuid
                             UNION
                             SELECT parent_course_id FROM courses
                              WHERE id = $2::uuid AND parent_course_id IS NOT NULL
                         )`,
                      [req.user.id, req.courseId]
                  );
                  req.isEnrolled = enrollmentCheck.rows.length > 0;
                  console.log(`   - isEnrolled: ${req.isEnrolled ? '✅ YES' : '❌ NO'}`);

                  /*
                   * Distinguish "expired" from "never enrolled".
                   *
                   * Both produced the same "you do not have permission"
                   * message, which reads as a broken app to a student who did
                   * pay — and gives no hint that renewing is the fix. Looked up
                   * only when access has already been refused, so it costs
                   * nothing on the normal path.
                   */
                  if (!req.isEnrolled) {
                      const lapsed = await pool.query(
                          `SELECT e.expires_at
                             FROM enrollments e
                            WHERE e.user_id = $1
                              AND e.status = 'active'
                              AND e.expires_at IS NOT NULL
                              AND e.expires_at <= NOW()
                              AND e.course_id IN (
                                  SELECT $2::uuid
                                  UNION
                                  SELECT parent_course_id FROM courses
                                   WHERE id = $2::uuid AND parent_course_id IS NOT NULL
                              )
                            ORDER BY e.expires_at DESC LIMIT 1`,
                          [req.user.id, req.courseId]
                      );
                      if (lapsed.rows.length > 0) {
                          req.accessExpiredAt = lapsed.rows[0].expires_at;
                          console.log(`   - access expired at ${req.accessExpiredAt.toISOString()}`);
                      }
                  }
              } else {
                  if (req.isContentCreator) console.log(`   - Skipping enrollment check (user is creator)`);
                  if (req.isPreviewContent) console.log(`   - Skipping enrollment check (content is preview)`);
              }
          } else {
              console.log(`   - ❌ Content not found or inactive`);
              // Fallback protection for deletions or uploads not linked to a module yet
              if (req.user.role === 'educator') {
                  console.log(`   - ℹ️ User is an educator. Granting contextual creator access bypass.`);
                  req.isContentCreator = true;
                  req.isCourseCreator = true;
              }
          }
      }
      
      // ========== 6. FINAL FLAGS SUMMARY ==========
      console.log(`\n📋 FINAL FLAGS SET FOR THIS REQUEST:`);
      console.log(`   ┌─────────────────────────────────────────────────┐`);
      console.log(`   │ req.user.id:        ${req.user.id}`);
      console.log(`   │ req.user.role:      ${req.user.role}`);
      console.log(`   ├─────────────────────────────────────────────────┤`);
      console.log(`   │ req.isCourseCreator:${req.isCourseCreator ? '✅ YES' : '❌ NO'}`);
      console.log(`   │ req.isContentCreator:${req.isContentCreator ? '✅ YES' : '❌ NO'}`);
      console.log(`   │ req.isPreviewContent:${req.isPreviewContent ? '✅ YES' : '❌ NO'}`);
      console.log(`   │ req.isEnrolled:     ${req.isEnrolled ? '✅ YES' : '❌ NO'}`);
      console.log(`   └─────────────────────────────────────────────────┘`);
      
      // ========== 7. ACCESS DECISION BLOCK ==========
      if (contentId) {
          console.log(`\n🔒 ACCESS DECISION:`);
          const hasAccess = req.isCourseCreator || req.isContentCreator || req.isEnrolled || req.isPreviewContent;
          
          if (hasAccess) {
              let accessReason = '';
              if (req.isCourseCreator || req.isContentCreator) accessReason = 'creator bypass';
              else if (req.isPreviewContent) accessReason = 'preview content';
              else if (req.isEnrolled) accessReason = 'enrolled user';
              
              console.log(`   ✅ ACCESS GRANTED (${accessReason})`);
              console.log(`\n${'='.repeat(70)}\n`);
              return next();
          } else {
              console.log(`   ❌ ACCESS DENIED (not creator, not enrolled, not preview)`);
              console.log(`\n${'='.repeat(70)}\n`);
              return res.status(403).json({
                  error: req.accessExpiredAt
                      ? `Your access to this course ended on ${new Date(req.accessExpiredAt).toLocaleDateString()}. Renew it to continue.`
                      : "Access denied. You do not have permission to view or manage this content.",
                  expired: Boolean(req.accessExpiredAt),
              });
          }
      }
      
      console.log(`\n${'='.repeat(70)}\n`);
      next();

  } catch (err) {
      console.error("\n❌ AUTH MIDDLEWARE ERROR:", err);
      console.log(`${'='.repeat(70)}\n`);
      res.status(500).json({ error: "Internal server error" });
  }
}

export default authMiddleware;