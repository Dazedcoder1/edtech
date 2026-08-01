/**
 * One definition of "this enrolment still grants access".
 *
 * Enrolment was checked in a dozen places with a hand-written
 * `status = 'active'`. Adding an expiry date means every one of those has to
 * learn about it, and any that is missed becomes a hole a lapsed student can
 * still walk through — the sort of bug that is invisible until someone notices
 * they never had to renew.
 *
 * Access gates use this. Analytics deliberately do not: "how many students
 * enrolled in this course" is a different question from "who may open the
 * videos today", and a lapsed student is still a sale that happened.
 *
 * @param {string} alias table alias, or '' when the query has no alias
 */
export function activeEnrolmentSql(alias = 'e') {
    const col = alias ? `${alias}.` : '';
    // NULL expires_at means the course was sold with unlimited access. It is
    // the default, so every enrolment predating this feature keeps working.
    return `${col}status = 'active' AND (${col}expires_at IS NULL OR ${col}expires_at > NOW())`;
}

/**
 * When an enrolment bought right now should lapse.
 *
 * Returns null for lifetime access.
 *
 * The expiry is stamped onto the enrolment at purchase rather than derived
 * from the course's current setting on every read. If a teacher later changes
 * the course from 6 months to 3, that must not retroactively cut short access
 * somebody has already paid for.
 *
 * `minutes` exists so the expiry can actually be tested — waiting a month to
 * find out whether the lockout works is not a test. When set it wins, and
 * months are ignored. It is a real duration, not a debug flag: a course left
 * on minutes by accident will genuinely expire that fast.
 */
export function expiryFrom({ months, minutes } = {}) {
    const mins = Number(minutes);
    if (Number.isInteger(mins) && mins >= 1) {
        return new Date(Date.now() + mins * 60 * 1000);
    }

    const parsed = Number(months);
    if (!Number.isInteger(parsed) || parsed < 1) return null;

    const expires = new Date();
    // setMonth handles rollover, and clamps sensibly: 31 Jan + 1 month lands in
    // March, so pull back to the last day of the target month instead of
    // silently granting a few extra days.
    const targetMonth = expires.getMonth() + parsed;
    const dayOfMonth = expires.getDate();
    expires.setMonth(targetMonth);
    if (expires.getDate() !== dayOfMonth) {
        expires.setDate(0);
    }
    return expires;
}

/** Kept so existing callers passing a bare month count still work. */
export function expiryFromMonths(months) {
    return expiryFrom({ months });
}

/** Minutes of validity for the testing path, or null. */
export function parseDurationMinutes(value) {
    if (value === undefined || value === null || value === '') return { ok: true, minutes: null };

    const minutes = Number(value);
    // Capped at a day — this is for verifying the lockout, and anything longer
    // should be expressed in months where the calendar maths is correct.
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        return {
            ok: false,
            error: 'Test duration must be a whole number of minutes between 1 and 1440 (24 hours).',
        };
    }
    return { ok: true, minutes };
}

/** Whole months of validity, or null for lifetime. Throws nothing; validates. */
export function parseDurationMonths(value) {
    if (value === undefined || value === null || value === '') return { ok: true, months: null };

    const months = Number(value);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
        return {
            ok: false,
            error: 'Validity must be a whole number of months between 1 and 120, or left empty for lifetime access.',
        };
    }
    return { ok: true, months };
}
