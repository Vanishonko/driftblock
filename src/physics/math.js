/* ============================================================
   MATH — the two helpers everything shares.
   ============================================================ */

/** Clamp `v` into [a, b]. */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** -1, 0 or 1. */
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
