/** How a product's rate versions are ordered wherever "the version in force" is
 *  resolved: newest effective date first, and among versions sharing a date the
 *  most recently created first. The tie-break makes a same-day correction
 *  resolve to the corrected version every time, at every resolution site
 *  (verify, the split-bound check, the display readers, the edit screen's
 *  own latest-version lookup) — never to whichever row the database returns. */
export const VERSION_RESOLUTION_ORDER = [{ effectiveDate: "desc" }, { createdAt: "desc" }] as const;
