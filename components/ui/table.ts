/**
 * C-10 (VO "C" changes, p.12 "All Tables"): the one shared header style every
 * table in the app uses — dark-blue row, centred header text. The owner's own
 * annotation: "Add in the dark blue background for the header roll and
 * centralise the wordings." The colour is not new: `bg-ink` is the design
 * system's existing navy token (`--color-ink`, already used for the sidebar
 * and other dark surfaces), extended here to table headers rather than
 * introducing a second "dark blue."
 *
 * A single source of truth so C-8 and C-9 (both separately specifying
 * "dark-blue header") consume this instead of each growing its own variant —
 * three independent implementations would only have meant reconciling them
 * later.
 *
 * TABLE_HEAD_ROW_CLS replaces a header `<tr>`'s existing className outright
 * (it already carries the border/size/tracking that was there before,
 * swapping only the colour). TABLE_HEAD_CELL_CLS is additive — append it to
 * each header `<th>`'s own padding/weight classes, and drop any `text-right`/
 * `text-left` alignment that was on the HEADER cell specifically (body `<td>`
 * alignment is unrelated and untouched).
 */
export const TABLE_HEAD_ROW_CLS = "border-b border-line bg-ink text-[11px] uppercase tracking-wide text-white/85";
export const TABLE_HEAD_CELL_CLS = "text-center";
