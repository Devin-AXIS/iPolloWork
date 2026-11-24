// Retained-byte estimates for paragraph break cache entries.
//
// Entry counts are a poor memory bound: one cached break may hold a single short span while
// another holds hundreds. The estimate follows the structure a cached break retains: one map
// slot and recency node, the key, and for each frozen line its span and box copies, span text,
// caret edges, drawing records and revision lists.
//
// Limits: the constants are fixed per-object allowances, not engine measurements, and engines
// lay out objects differently. Strings count two bytes per UTF-16 unit. Objects shared with
// other structures (run properties, resolved styles, source ranges) count only as the slot
// that references them. Any other value counts as the entry overhead and its key. The budget
// is therefore an approximate bound, not an exact heap size.

/** Map slot, recency node and value array of one entry. */
const ENTRY_BYTES = 160;
/** String header; characters are counted on top at two bytes each. */
const STRING_BYTES = 24;
/** One frozen line with its span and drawing arrays. */
const LINE_BYTES = 224;
/** One frozen span copy and its box copy. */
const SPAN_BYTES = 160;
/** One drawing copy with its paint and hit bounds. */
const DRAWING_BYTES = 480;
const ARRAY_BYTES = 32;
const SLOT_BYTES = 8;

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null;

const stringBytes = (value: string): number => STRING_BYTES + value.length * 2;

const listBytes = (list: unknown): number =>
  Array.isArray(list) ? ARRAY_BYTES + list.length * SLOT_BYTES : 0;

function spanBytes(span: unknown): number {
  if (!isObject(span)) return SLOT_BYTES;
  const text = typeof span.text === 'string' ? stringBytes(span.text) : 0;
  return SPAN_BYTES + text + listBytes(span.caretEdges);
}

function lineBytes(line: unknown): number {
  if (!isObject(line)) return SLOT_BYTES;
  let bytes =
    LINE_BYTES +
    listBytes(line.deletedRanges) +
    listBytes(line.anchorRevisions) +
    listBytes(line.changeSites);
  const { spans, drawings } = line;
  if (Array.isArray(spans)) for (const span of spans) bytes += spanBytes(span);
  if (Array.isArray(drawings)) bytes += drawings.length * DRAWING_BYTES;
  return bytes;
}

/**
 * Estimated bytes one cache entry retains: its key plus, for a broken paragraph, every
 * line it holds. Accepts any value; anything that is not an array of line-shaped objects
 * counts per slot. O(lines + spans), paid once per write.
 */
export function estimatedParagraphCacheEntryBytes(key: string, value: unknown): number {
  let bytes = ENTRY_BYTES + stringBytes(key);
  if (!Array.isArray(value)) return bytes;
  for (const line of value) bytes += lineBytes(line);
  return bytes;
}
