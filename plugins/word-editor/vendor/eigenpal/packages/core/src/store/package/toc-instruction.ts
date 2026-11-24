// TOC field instruction parse — allowlisted switches only; never executed as code.

/** Parsed TOC instruction. Unknown switches are ignored for generation but left on the wire. */
export interface TocInstruction {
  readonly keyword: 'TOC';
  /** Include hyperlinks (`\\h`). */
  readonly hyperlink: boolean;
  /** Omit page numbers (`\\n`). */
  readonly omitPageNumbers: boolean;
  /** Inclusive 1-based outline levels from `\\o "n-m"`. Defaults 1–9. */
  readonly outlineStart: number;
  readonly outlineEnd: number;
  readonly raw: string;
}

/** Longest TOC field instruction read. Instructions come from a file; the parse is bounded. */
export const TOC_MAX_INSTRUCTION_CHARS = 256;
/** Most entries one generated table of contents may hold. */
export const TOC_MAX_ENTRIES = 512;
/** Most bookmarks minted during one TOC refresh. */
export const TOC_MAX_BOOKMARKS_PER_REFRESH = 512;
/** Deepest nested field instruction followed. Caps recursion on file-supplied structure. */
export const TOC_MAX_FIELD_NESTING = 4;
/**
 * Most layout passes a TOC refresh runs before settling.
 *
 * Page numbers change the TOC's own height, which changes page numbers — bounded so a
 * non-converging document stops rather than looping.
 */
export const TOC_MAX_PAGE_PASSES = 3;

/**
 * Parse a TOC field instruction string.
 *
 * Returns null when the leading keyword is not TOC, the string is over-long, or the
 * outline range is hostile. Does not evaluate or fetch anything.
 */
export function parseTocInstruction(raw: string): TocInstruction | null {
  if (raw.length > TOC_MAX_INSTRUCTION_CHARS) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const keyword = (trimmed.split(/\s+/)[0] ?? '').toUpperCase();
  if (keyword !== 'TOC') return null;

  let hyperlink = /\\h\b/i.test(trimmed);
  const omitPageNumbers = /\\n\b/i.test(trimmed);
  let outlineStart = 1;
  let outlineEnd = 9;

  const outlineMatch = /\\o\s*(?:"(\d{1,2})\s*-\s*(\d{1,2})"|(\d{1,2})\s*-\s*(\d{1,2}))/i.exec(
    trimmed
  );
  if (outlineMatch) {
    const start = Number(outlineMatch[1] ?? outlineMatch[3]);
    const end = Number(outlineMatch[2] ?? outlineMatch[4]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 1 || end > 9 || start > end) return null;
    outlineStart = start;
    outlineEnd = end;
  }

  // Gallery TOC without an explicit \h still uses hyperlinks in practice; treat missing
  // \h as hyperlink when \o is present (Word's Insert TOC default includes both).
  if (!hyperlink && /\\o\b/i.test(trimmed)) hyperlink = true;

  return {
    keyword: 'TOC',
    hyperlink,
    omitPageNumbers,
    outlineStart,
    outlineEnd,
    raw: trimmed,
  };
}
