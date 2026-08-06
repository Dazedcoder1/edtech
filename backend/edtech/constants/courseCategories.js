/**
 * The course categories students filter by on the home screen.
 *
 * Enumerated rather than free text, and shared by the API, the educator form
 * and the student filter bar. Free text would mean "HP Board", "HP board" and
 * "Hp Board" become three separate chips that each hide two thirds of the
 * courses — a filter that quietly lies is worse than no filter.
 *
 * `null` is a legitimate value: courses created before this existed have no
 * category and appear under "All" only. That is deliberate, so adding the
 * field does not silently file old courses under a board they may not belong
 * to.
 */
export const COURSE_CATEGORIES = [
    { id: "hp_board", label: "HP Board" },
    { id: "neet", label: "NEET" },
    { id: "jee", label: "JEE" },
    { id: "cbse", label: "CBSE" },
    { id: "test_series", label: "Test Series" },
];

export const CATEGORY_IDS = COURSE_CATEGORIES.map((c) => c.id);

/**
 * Validate a category coming in over the wire.
 *
 * Empty string and null both mean "uncategorised" — the form sends "" when the
 * teacher picks the blank option, and treating that as invalid would make the
 * category impossible to clear once set.
 *
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function parseCategory(raw) {
    if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
    if (!CATEGORY_IDS.includes(raw)) {
        return { ok: false, error: `category must be one of: ${CATEGORY_IDS.join(", ")}` };
    }
    return { ok: true, value: raw };
}
