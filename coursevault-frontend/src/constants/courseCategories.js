/**
 * Course categories, mirroring backend/edtech/constants/courseCategories.js.
 *
 * Duplicated rather than fetched: the filter bar renders on first paint, and a
 * round trip for six fixed strings would leave it empty for a moment on every
 * load. The API validates against its own copy regardless, so the worst a
 * drift here can cause is a chip that saves nothing — not a bad write.
 *
 * The ids must match the backend exactly. If you add one, add it in both.
 */
export const COURSE_CATEGORIES = [
  { id: 'hp_board', label: 'HP Board' },
  { id: 'neet', label: 'NEET' },
  { id: 'jee', label: 'JEE' },
  { id: 'cbse', label: 'CBSE' },
  { id: 'test_series', label: 'Test Series' },
];

/** Label for a stored id, falling back to the raw value rather than blank. */
export function categoryLabel(id) {
  if (!id) return '';
  return COURSE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
