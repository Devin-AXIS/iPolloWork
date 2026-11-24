/** Allowlisted OOXML table border line styles — store/layout authority. */
export const TABLE_BORDER_STYLES = [
  'single',
  'dashed',
  'dotted',
  'double',
  'triple',
  'thick',
] as const;

/**
 * One of the border line styles this engine draws.
 *
 * An ALLOWLIST, not the full `ST_Border` enumeration: a file may name any of the seventy-odd
 * OOXML border styles, and anything outside this set falls back rather than being passed through
 * to paint.
 */
export type TableBorderStyle = (typeof TABLE_BORDER_STYLES)[number];
