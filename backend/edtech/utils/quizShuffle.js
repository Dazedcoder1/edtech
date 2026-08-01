/**
 * Per-student shuffling of quiz questions and answer options.
 *
 * The order is *derived*, never stored. A seed built from the quiz and the
 * student reproduces the same permutation on demand, which matters more than
 * it might sound:
 *
 *  - The student must see a stable order. A fresh random shuffle on every
 *    request would reorder the options underneath them on a page refresh, so
 *    the answer they had already picked would silently become a different one.
 *  - Grading happens in a separate request. Without a stored permutation the
 *    submit route can only interpret "the student picked option 2" by
 *    rebuilding the exact same shuffle — so the derivation has to be pure.
 *  - Two students get different orders, which is the point.
 *
 * Answers are stored in the database in ORIGINAL option order. Display order
 * is a presentation concern; keeping storage canonical means existing rows,
 * statistics and the answer key stay meaningful, and a change to the shuffle
 * can never corrupt already-graded attempts.
 */

/** FNV-1a: small, fast, and stable across processes — unlike hashing objects. */
function fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        // 32-bit FNV prime multiply, kept in range with Math.imul.
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** mulberry32 — a compact, well-distributed seeded PRNG. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A permutation of [0..length), derived from `seedString`.
 *
 * Returns display order: `perm[displayIndex] === originalIndex`.
 */
export function seededPermutation(length, seedString) {
    const order = Array.from({ length }, (_, i) => i);
    if (length < 2) return order;

    const rand = mulberry32(fnv1a(seedString));

    // Fisher-Yates, which is uniform — unlike sort() with a random comparator,
    // whose bias would make some option positions measurably likelier.
    for (let i = length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/** Invert a permutation: `inverse[originalIndex] === displayIndex`. */
export function invertPermutation(perm) {
    const inverse = new Array(perm.length);
    for (let display = 0; display < perm.length; display++) {
        inverse[perm[display]] = display;
    }
    return inverse;
}

export const questionOrderSeed = (quizId, userId) => `${quizId}:${userId}:questions`;

// Includes the question id so two questions with the same option count in the
// same quiz do not receive identical option orderings.
export const optionOrderSeed = (quizId, userId, questionId) =>
    `${quizId}:${userId}:${questionId}:options`;
