/**
 * The calendar the platform counts days on.
 *
 * "Which day did this happen on" has no answer without a timezone, and the
 * default answer — UTC — is wrong here. UTC midnight is 05:30 in India, so a
 * student revising at 1am has their session filed under the previous day.
 * That is the exact window exam students work in, so the error lands on the
 * people who use the streak most.
 *
 * Configurable because the code should not assume one country, but defaulted
 * because leaving it unset would silently restore the UTC behaviour this
 * exists to fix.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

/**
 * Today's date in the platform's timezone, as YYYY-MM-DD.
 *
 * Built with Intl rather than date arithmetic: it handles the offset, and any
 * daylight-saving rule, from the IANA database. Hand-rolling "+5:30" would be
 * correct for India and wrong the moment APP_TIMEZONE is changed to somewhere
 * that observes DST.
 *
 * en-CA is not a locale preference — it is the shortest way to get ISO
 * ordering (YYYY-MM-DD) out of toLocaleDateString.
 */
export function todayInAppZone(now = new Date(), timeZone = APP_TIMEZONE) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}

/**
 * Turn a YYYY-MM-DD into a UTC-midnight epoch, for day arithmetic.
 *
 * Anchoring on UTC midnight is deliberate and is not a timezone bug: these are
 * bare calendar dates with the zone already applied, so what matters is that
 * consecutive dates are exactly 86,400,000 apart. Parsing them in a zone with
 * DST would make one pair 23 or 25 hours apart and break the streak on the
 * clock-change day.
 */
export function dayToUtcMs(iso) {
    const text = String(iso).slice(0, 10);
    const [y, m, d] = text.split("-").map(Number);

    /*
     * Throws rather than returning NaN.
     *
     * Passing a Date here used to yield NaN silently, and NaN poisons a
     * comparison without failing it: `NaN > 1` is false, so the check for
     * "has the streak gone stale" simply stopped applying and a long-dead
     * streak kept reporting its old length. A wrong call site should be loud,
     * not quietly generous.
     */
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
        throw new TypeError(`expected a YYYY-MM-DD day, got ${JSON.stringify(iso)}`);
    }
    return Date.UTC(y, m - 1, d);
}

export const DAY_MS = 86_400_000;
