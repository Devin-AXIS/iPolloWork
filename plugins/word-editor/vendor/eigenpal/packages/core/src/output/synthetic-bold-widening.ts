// How far the host browser itself widens each glyph of a synthesized bold.
//
// Layout gives each widened glyph of a synthesized-bold span 1/50 em of extra advance, and
// screen paint adds that extra as letter spacing. Some engines widen a synthesized bold
// themselves: Gecko adds an offset to every glyph and space, about 0.25 + 0.75 * size / 48 px,
// while Blink and WebKit keep the face's advances. Paint measures that widening once for each
// face, style, and size, and takes it back out of the letter spacing, so the glyphs land on
// layout's advances in every engine. Spaces need no correction: their word spacing already
// takes back everything the letter spacing and the engine add.
import type { StyleSpanRecord } from '../layout/semantic-records.ts';
import { syntheticBoldGraphemeStarts } from '../layout/synthetic-bold.ts';

/** The painted font of a span, read from the styles paint set on its element. */
export interface PaintedFont {
  readonly family: string;
  readonly style: string;
  readonly sizePx: number;
}

/**
 * Measure the width of `text` in `font` at a CSS `weight`, in CSS pixels. The default probe
 * lays out a hidden element in `document`; tests inject their own.
 */
export type BoldWideningProbe = (
  document: Document,
  font: PaintedFont,
  weight: '599' | '700',
  text: string
) => number;

/** Most graphemes of a span that one probe measures. */
const PROBE_GRAPHEMES = 24;
/** Sizes within one bucket share a measurement: Gecko's offset moves 0.016 px per px. */
const SIZE_BUCKET_PX = 0.25;
/** Entries one document keeps before the cache starts again. */
const MAX_ENTRIES = 512;

const domProbe: BoldWideningProbe = (document, font, weight, text) => {
  const body = document.body;
  if (!body) return 0;
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  const css = probe.style;
  css.position = 'absolute';
  css.left = '-100000px';
  css.top = '0';
  css.visibility = 'hidden';
  css.whiteSpace = 'pre';
  css.letterSpacing = '0';
  css.fontKerning = 'none';
  if (font.family) css.fontFamily = font.family;
  css.fontStyle = font.style;
  css.fontSize = `${font.sizePx}px`;
  css.fontWeight = weight;
  probe.textContent = text; // SAFE: textContent, never innerHTML
  body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
};

let activeProbe: BoldWideningProbe = domProbe;
let cacheEpoch = 0;
const cache = new WeakMap<Document, Map<string, number>>();

/**
 * Replace the probe, for tests. Returns a function that restores the previous probe. Clears
 * every cached measurement.
 *
 * @internal
 */
export function setBoldWideningProbe(probe: BoldWideningProbe): () => void {
  const previous = activeProbe;
  activeProbe = probe;
  cacheEpoch += 1;
  return () => {
    activeProbe = previous;
    cacheEpoch += 1;
  };
}

/**
 * The widening, in CSS pixels at the element's own font size, that the browser gives each glyph
 * when it synthesizes the bold of `span`, painted in `element`.
 *
 * The face that bold text selects is measured twice: at weight 599, which selects the same face
 * without synthesizing bold, and at 700, which synthesizes it. Each new face, style, and size
 * bucket costs two layouts of one hidden element, once per document; every later span reads the
 * cache. A measurement outside 0 to 0.2 em reads as 0. The probe is measured in the body of the
 * element's document; an element without a family of its own probes in the body's font.
 *
 * @internal
 */
export function browserBoldWideningPx(element: HTMLElement, span: StyleSpanRecord): number {
  const css = element.style;
  const sizePx = Number.parseFloat(css.fontSize);
  if (!(sizePx > 0)) return 0;
  const bucket = Math.max(SIZE_BUCKET_PX, Math.round(sizePx / SIZE_BUCKET_PX) * SIZE_BUCKET_PX);
  const font: PaintedFont = {
    family: css.fontFamily,
    style: css.fontStyle || 'normal',
    sizePx: bucket,
  };
  const document = element.ownerDocument;
  // A face still loading measures on a fallback. Its answer is kept apart from the settled one,
  // so the first paint after loading measures again, once.
  const loading =
    (document as Document & { fonts?: { status?: string } }).fonts?.status === 'loading';
  const key = `${cacheEpoch}|${loading ? 'loading' : ''}|${font.style}|${bucket}|${font.family}`;
  let entries = cache.get(document);
  const cached = entries?.get(key);
  if (cached !== undefined) return cached;
  const text = probeText(span.text);
  if (text.count === 0) return 0;
  let widening = 0;
  try {
    const synthesized = activeProbe(document, font, '700', text.text);
    const plain = activeProbe(document, font, '599', text.text);
    widening = (synthesized - plain) / text.count;
  } catch {
    widening = 0;
  }
  if (!Number.isFinite(widening) || widening < 0 || widening > bucket * 0.2) widening = 0;
  if (!entries) cache.set(document, (entries = new Map()));
  if (entries.size >= MAX_ENTRIES) entries.clear();
  entries.set(key, widening);
  return widening;
}

/** The widened graphemes of `text`, up to {@link PROBE_GRAPHEMES}, and how many there are. */
function probeText(text: string): { readonly text: string; readonly count: number } {
  const starts = syntheticBoldGraphemeStarts(text).slice(0, PROBE_GRAPHEMES + 1);
  let probe = '';
  const count = Math.min(PROBE_GRAPHEMES, starts.length);
  for (let index = 0; index < count; index++) {
    const from = starts[index]!;
    const next = starts[index + 1] ?? text.length;
    // A grapheme runs to the next widened start, blanks and marks included; keep only its
    // first cluster's text up to the next blank.
    probe += text.slice(from, next).replace(/[\s​-‍⁠﻿]+$/u, '');
  }
  return { text: probe, count };
}
