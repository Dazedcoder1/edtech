/**
 * Creating notifications.
 *
 * Every call here is a side effect of something else the user asked for —
 * uploading a video, submitting a quiz, opening a ticket. None of those should
 * fail because a notification could not be written, so every function in this
 * file swallows its own errors and logs them. A student whose upload succeeded
 * but whose classmates got no bell icon has a cosmetic problem; a student whose
 * upload was rolled back because of the bell has a real one.
 *
 * The corollary: never call these inside a transaction you care about, and
 * never rely on the return value for control flow.
 */
import pool from "../config/database.js";

/**
 * Write one notification per recipient.
 *
 * @param {string[]} userIds recipients; duplicates and falsy values are dropped
 * @param {object}   n
 * @param {string}   n.type     machine-readable kind, used for the icon
 * @param {string}   n.title    one line, shown bold in the dropdown
 * @param {string}   [n.body]   optional detail
 * @param {string}   [n.courseId]
 * @param {string}   [n.actorId] who caused it; excluded from recipients
 * @param {string}   [n.link]   in-app path to open on click
 */
export async function notifyUsers(userIds, { type, title, body = null, courseId = null, actorId = null, link = null }) {
    try {
        // Nobody wants to be told about their own action.
        const recipients = [...new Set((userIds || []).filter(Boolean))].filter((id) => id !== actorId);
        if (recipients.length === 0) return 0;

        /*
         * One INSERT with unnest rather than a loop of INSERTs.
         *
         * A class of 200 students would otherwise mean 200 round trips to the
         * database while the teacher's upload request is still open, turning a
         * fast upload into a visibly slow one.
         */
        const { rowCount } = await pool.query(
            `INSERT INTO notifications (user_id, actor_id, type, title, body, course_id, link)
             SELECT u, $2, $3, $4, $5, $6, $7
               FROM unnest($1::uuid[]) AS u`,
            [recipients, actorId, type, title, body, courseId, link]
        );
        return rowCount;
    } catch (err) {
        console.error("[notify] could not write notifications:", err.message);
        return 0;
    }
}

/**
 * Notify everyone with live access to a course.
 *
 * Enrolment is parent-aware: a student who bought "9th Class" has access to
 * the "Mathematics" course nested inside it, and is enrolled in the parent
 * row only. Notifying on `course_id = $1` alone would therefore reach nobody
 * for exactly the courses that carry the content.
 *
 * Expired enrolments are excluded — someone whose access lapsed should not
 * keep receiving updates about material they can no longer open.
 */
export async function notifyCourseStudents(courseId, payload) {
    try {
        if (!courseId) return 0;

        const { rows } = await pool.query(
            `SELECT DISTINCT e.user_id
               FROM enrollments e
              WHERE e.status = 'active'
                AND (e.expires_at IS NULL OR e.expires_at > NOW())
                AND e.course_id IN (
                    SELECT $1::uuid
                    UNION
                    SELECT parent_course_id FROM courses
                     WHERE id = $1::uuid AND parent_course_id IS NOT NULL
                )`,
            [courseId]
        );

        return await notifyUsers(rows.map((r) => r.user_id), { ...payload, courseId });
    } catch (err) {
        console.error("[notify] could not resolve course students:", err.message);
        return 0;
    }
}

/**
 * Notify the educator who owns a course.
 *
 * Walks up to the parent when the course is a child, because that is where
 * ownership is meaningful — but falls back to the child's own educator_id if
 * there is no parent.
 */
export async function notifyCourseOwner(courseId, payload) {
    try {
        if (!courseId) return 0;

        const { rows } = await pool.query(
            `SELECT educator_id FROM courses WHERE id = $1 AND is_active = true`,
            [courseId]
        );
        if (rows.length === 0) return 0;

        return await notifyUsers([rows[0].educator_id], { ...payload, courseId });
    } catch (err) {
        console.error("[notify] could not resolve course owner:", err.message);
        return 0;
    }
}

/**
 * Notify every student on the platform.
 *
 * Used for a newly published top-level course, which by definition nobody is
 * enrolled in yet — so there is no narrower audience to address.
 *
 * This is the widest fan-out in the system: one row per student per course.
 * Fine at school scale; if the student table ever reaches the tens of
 * thousands this is the first thing that should become a single broadcast row
 * with per-user read tracking instead.
 */
export async function notifyAllStudents(payload) {
    try {
        const { rows } = await pool.query(`SELECT id FROM users WHERE role = 'student'`);
        return await notifyUsers(rows.map((r) => r.id), payload);
    } catch (err) {
        console.error("[notify] could not resolve students:", err.message);
        return 0;
    }
}

/**
 * Announce a course to students, exactly once in its lifetime.
 *
 * Returns the number of students notified, or 0 if this course had already
 * been announced, is not published, or does not exist.
 *
 * The "already announced" check and the stamp are a single UPDATE with
 * `announced_at IS NULL` in the WHERE clause. Reading the column first and
 * writing it afterwards would leave a window in which two concurrent publish
 * requests — a double-clicked toggle is enough — both see NULL and both
 * broadcast. Letting the database decide who wins makes that impossible.
 */
export async function announceCourseIfNew(courseId, actorId) {
    try {
        if (!courseId) return 0;

        const claim = await pool.query(
            `UPDATE courses
                SET announced_at = NOW()
              WHERE id = $1
                AND status = 'published'
                AND is_active = true
                AND announced_at IS NULL
            RETURNING title, parent_course_id`,
            [courseId]
        );

        // Lost the race, or the course is not in a state to be announced.
        if (claim.rowCount === 0) return 0;

        const { title, parent_course_id: parentId } = claim.rows[0];

        /*
         * A sub-course is not news to the whole school.
         *
         * Top-level courses are the classes students browse and buy, so a new
         * one goes to everybody. A sub-course ("Mathematics" inside "9th
         * Class") is a subject appearing inside something students have
         * already paid for — announcing it platform-wide would advertise
         * material most recipients cannot open, while the people who actually
         * gained something would be buried in the same broadcast.
         */
        if (parentId) {
            return await notifyCourseStudents(parentId, {
                type: "course",
                title: "New subject added",
                body: title,
                actorId,
                link: `/course/${courseId}`,
            });
        }

        return await notifyAllStudents({
            type: "course",
            title: "New course available",
            body: title,
            courseId,
            actorId,
            link: `/course/${courseId}`,
        });
    } catch (err) {
        console.error("[notify] could not announce course:", err.message);
        return 0;
    }
}

/**
 * Notify every educator on the platform.
 *
 * Used for support tickets, which are not tied to one teacher's courses and
 * would otherwise sit unseen until someone happened to check.
 */
export async function notifyEducators(payload) {
    try {
        const { rows } = await pool.query(`SELECT id FROM users WHERE role = 'educator'`);
        return await notifyUsers(rows.map((r) => r.id), payload);
    } catch (err) {
        console.error("[notify] could not resolve educators:", err.message);
        return 0;
    }
}

/**
 * Resolve the course a module belongs to.
 *
 * Content and quizzes are attached to modules, but notifications are addressed
 * by course, so this hop is needed in several routes.
 */
export async function courseIdForModule(moduleId) {
    try {
        if (!moduleId) return null;
        const { rows } = await pool.query(`SELECT course_id FROM modules WHERE id = $1`, [moduleId]);
        return rows[0]?.course_id ?? null;
    } catch (err) {
        console.error("[notify] could not resolve module course:", err.message);
        return null;
    }
}
