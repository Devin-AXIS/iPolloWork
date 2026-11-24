import type { ResolvedFont } from './font-resource.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { reverseGapStyleEligible } from './authored-average-widths.ts';
const MAX_TABLE_RECORDS = 4096;
export interface CjkAutoSpacingFontMetrics {
  readonly faceIndex: number;
  readonly collection: boolean;
  readonly unitsPerEm: number;
  readonly os2Version: number;
  readonly xAvgCharWidth: number;
  readonly averageAdvanceEm: number;
}
// Derived whitespace only. This metric never replaces glyph advances or shaping.
// OpenType OS/2.xAvgCharWidth is explicitly unsuitable for actual glyph widths.
// Caller must bind these exact bytes/face to its already admitted font source.
export function readCjkAutoSpacingFontMetrics(
  bytes: Uint8Array,
  faceIndex = 0
): CjkAutoSpacingFontMetrics | undefined {
  if (
    !(bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(faceIndex) ||
    faceIndex < 0 ||
    bytes.byteLength < 12
  )
    return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const within = (offset: number, length: number) =>
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.length - length;
  const u16 = (offset: number) => view.getUint16(offset, false),
    u32 = (offset: number) => view.getUint32(offset, false);
  let header = 0,
    collection = false;
  if (u32(0) === 0x74746366) {
    collection = true;
    const version = u32(4),
      count = u32(8);
    if (
      ![0x00010000, 0x00020000].includes(version) ||
      !count ||
      faceIndex >= count ||
      !within(12, count * 4)
    )
      return;
    header = u32(12 + faceIndex * 4);
  } else if (faceIndex !== 0) return;
  if (!within(header, 12) || ![0x00010000, 0x4f54544f, 0x74727565].includes(u32(header))) return;
  const count = u16(header + 4);
  if (!count || count > MAX_TABLE_RECORDS || !within(header + 12, count * 16)) return;
  const tables = new Map<number, { offset: number; length: number }>();
  for (let index = 0; index < count; index++) {
    const record = header + 12 + index * 16,
      tag = u32(record),
      offset = u32(record + 8),
      length = u32(record + 12);
    if (tables.has(tag) || !within(offset, length)) return;
    tables.set(tag, { offset, length });
  }
  const head = tables.get(0x68656164),
    os2 = tables.get(0x4f532f32);
  if (!head || head.length < 20 || !os2 || os2.length < 4) return;
  const unitsPerEm = u16(head.offset + 18),
    os2Version = u16(os2.offset),
    xAvgCharWidth = view.getInt16(os2.offset + 2, false);
  if (unitsPerEm < 16 || unitsPerEm > 16384 || os2Version > 5 || xAvgCharWidth <= 0) return;
  return Object.freeze({
    faceIndex,
    collection,
    unitsPerEm,
    os2Version,
    xAvgCharWidth,
    averageAdvanceEm: xAvgCharWidth / unitsPerEm,
  });
}

// The pinned native resource contract is sha256:<64 hex>, not a bare digest.
// The existing resolver admits and hash-validates these exact face bytes.
// Cache only the face metric; source styles and glyph widths remain unchanged.
export function createResolvedCjkAutoSpacingGapMetric(
  resolveFont: (style: ResolvedRunStyle) => ResolvedFont | null,
  readMetrics = readCjkAutoSpacingFontMetrics
): ((style: ResolvedRunStyle) => number | undefined) | undefined {
  if (typeof resolveFont !== 'function' || typeof readMetrics !== 'function') return;
  const cache = new WeakMap<ResolvedFont, CjkAutoSpacingFontMetrics | null>();
  return (style: ResolvedRunStyle) => {
    if (!reverseGapStyleEligible(style)) return;
    let resolved: ResolvedFont | null;
    try {
      resolved = resolveFont(style);
    } catch {
      return;
    }
    if (
      !resolved ||
      typeof resolved !== 'object' ||
      resolved.substitution !== null ||
      resolved.family.trim().toLowerCase() !== style.fontFamily?.trim().toLowerCase() ||
      typeof resolved.hash !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(resolved.hash) ||
      !Number.isSafeInteger(resolved.faceIndex) ||
      resolved.faceIndex < 0
    )
      return;
    let metrics = cache.get(resolved);
    if (metrics === undefined) {
      metrics = readMetrics(resolved.bytes, resolved.faceIndex) ?? null;
      cache.set(resolved, metrics);
    }
    if (!metrics) return;
    const gap = (style.fontSizePt * metrics.averageAdvanceEm) / 2;
    return Number.isFinite(gap) && gap >= 0 && gap <= style.fontSizePt ? gap : undefined;
  };
}
