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
 */
export function expiryFromMonths(months) {
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
