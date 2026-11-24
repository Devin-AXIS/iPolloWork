// Minimal grapheme ↔ UTF-16 mapping for semantic selection sync (binding-local; engine-layout
// owns the authoritative segmentation for layout). Uses Intl.Segmenter with the same invariant
// locale as engine-layout so binding resolution matches published caret stops.

export interface GraphemeSegment {
  readonly index: number;
  readonly utf16From: number;
  readonly utf16To: number;
}

const GRAPHEME_LOCALE = 'und' as const;

type IntlSegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' }
) => { segment(input: string): Iterable<{ segment: string; index: number }> };

function segmentGraphemes(text: string): readonly GraphemeSegment[] {
  const Seg = (Intl as unknown as { Segmenter?: IntlSegmenterCtor }).Segmenter;
  if (typeof Seg !== 'function') {
    throw new Error(
      `Intl.Segmenter is required for semantic selection sync (locale: ${GRAPHEME_LOCALE})`
    );
  }
  const segmenter = new Seg(GRAPHEME_LOCALE, { granularity: 'grapheme' });
  const out: GraphemeSegment[] = [];
  let index = 0;
  for (const part of segmenter.segment(text)) {
    out.push({ index, utf16From: part.index, utf16To: part.index + part.segment.length });
    index += 1;
  }
  return out;
}

export function graphemeOffsetToUtf16(text: string, graphemeOffset: number): number {
  const segments = segmentGraphemes(text);
  if (segments.length === 0) return 0;
  const clamped = Math.max(0, Math.min(graphemeOffset, segments.length));
  if (clamped >= segments.length) return text.length;
  return segments[clamped]!.utf16From;
}

export function utf16OffsetToGrapheme(text: string, utf16Offset: number): number {
  const clamped = Math.max(0, Math.min(utf16Offset, text.length));
  for (const seg of segmentGraphemes(text)) {
    if (clamped <= seg.utf16From) return seg.index;
    if (clamped < seg.utf16To) return seg.index;
  }
  return segmentGraphemes(text).length;
}
