/**
 * Validation and normalisation for the account fields.
 *
 * Kept in one place because register, login and profile-update all touch the
 * same values, and a phone number normalised differently at signup than at
 * login is a bug with no error message: the account simply cannot be found.
 */

export const CLASS_LEVELS = ["10th", "11th", "12th", "NEET", "JEE"];
export const BOARDS = ["HP Board", "CBSE", "Other"];

/** Indian states and union territories, for the State field. */
export const STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
    "Ladakh", "Lakshadweep", "Puducherry",
];

/**
 * Reduce a typed phone number to the digits that identify it.
 *
 * The same person will write 98765 43210, +91 98765-43210 and 09876543210 on
 * different days. Storing whatever they typed means the login lookup misses
 * and the account looks deleted, so everything is reduced to a bare national
 * number before it is either stored or searched for.
 *
 * @returns {{ok: true, phone: string} | {ok: false, error: string}}
 */
export function normalizePhone(input) {
    if (input === undefined || input === null || String(input).trim() === "") {
        return { ok: false, error: "A mobile number is required." };
    }

    let digits = String(input).replace(/\D/g, "");

    // +91 98765 43210 -> 9876543210
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    // 0 98765 43210 -> 9876543210
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

    if (digits.length !== 10) {
        return { ok: false, error: "Enter a 10-digit mobile number." };
    }
    // Indian mobile numbers start 6-9. Catches a landline or a typo'd digit
    // before it becomes an account nobody can sign in to.
    if (!/^[6-9]/.test(digits)) {
        return { ok: false, error: "That doesn't look like a mobile number." };
    }

    return { ok: true, phone: digits };
}

/**
 * Email is optional, but must be plausible when given.
 *
 * @returns {{ok: true, email: string|null} | {ok: false, error: string}}
 */
export function normalizeEmail(input) {
    if (input === undefined || input === null || String(input).trim() === "") {
        return { ok: true, email: null };
    }
    const email = String(input).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return { ok: false, error: "That email address doesn't look valid." };
    }
    return { ok: true, email };
}

/**
 * Decide whether a login identifier is a phone number or an email address.
 *
 * Chosen by shape rather than by asking the user which one they typed: a
 * single field they can put either into is one less thing to get wrong, and
 * an "@" is an unambiguous signal.
 */
export function classifyIdentifier(input) {
    const raw = String(input ?? "").trim();
    if (!raw) return { kind: "empty" };

    if (raw.includes("@")) {
        return { kind: "email", value: raw.toLowerCase() };
    }

    const phone = normalizePhone(raw);
    return phone.ok ? { kind: "phone", value: phone.phone } : { kind: "unknown" };
}

/**
 * Validate the academic fields.
 *
 * `strict` is true at registration, where the fields are mandatory for a
 * student, and false on profile update, where an omitted field means "leave it
 * alone" rather than "clear it".
 *
 * @returns {{ok: true, values: object} | {ok: false, error: string}}
 */
export function validateStudentFields(body, { strict = false } = {}) {
    const values = {};

    const classLevel = body.class_level ?? body.classLevel;
    if (classLevel !== undefined && classLevel !== null && String(classLevel).trim() !== "") {
        if (!CLASS_LEVELS.includes(String(classLevel))) {
            return { ok: false, error: `Class must be one of: ${CLASS_LEVELS.join(", ")}` };
        }
        values.class_level = String(classLevel);
    } else if (strict) {
        return { ok: false, error: "Please choose your class." };
    }

    const board = body.board;
    if (board !== undefined && board !== null && String(board).trim() !== "") {
        if (!BOARDS.includes(String(board))) {
            return { ok: false, error: `Board must be one of: ${BOARDS.join(", ")}` };
        }
        values.board = String(board);
    } else if (strict) {
        return { ok: false, error: "Please choose your board." };
    }

    const state = body.state;
    if (state !== undefined && state !== null && String(state).trim() !== "") {
        // Not restricted to the STATES list on the way in. The list drives the
        // dropdown, but rejecting anything outside it would break the moment a
        // state is renamed or reorganised, and the value is display-only.
        values.state = String(state).trim().slice(0, 80);
    } else if (strict) {
        return { ok: false, error: "Please choose your state." };
    }

    // School is optional everywhere, including at registration.
    const school = body.school;
    if (school !== undefined) {
        const trimmed = String(school ?? "").trim();
        values.school = trimmed === "" ? null : trimmed.slice(0, 255);
    }

    return { ok: true, values };
}
