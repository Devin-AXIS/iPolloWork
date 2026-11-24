// When presses on the pages count as one multi-click: the pointer's word and paragraph
// selection, and the double press that enters a header or footer text box, read the same rule.

/** How long after a click a second one still counts as a double. */
export const MULTI_CLICK_MS = 500;
/** How far it may move and still count — a click, not a tiny drag. */
export const MULTI_CLICK_SLOP_PX = 4;
