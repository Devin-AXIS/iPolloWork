// The glyph outlines of text art in visual order.
//
// Text art is one line of text in one face. A right-to-left or mixed string resolves its
// embedding levels as a paragraph of its own (UAX #9, direction from its first strong
// character), each level run is shaped in its own direction, so joining scripts connect, and
// the runs are placed left to right in visual order.
import { bidiAlgorithm } from './bidi.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { visualOrderOfLevels } from './rtl-paragraph.ts';
import { itemizeScriptFontSlots } from './script-itemization.ts';
import type { TextMeasurer, TextOutline } from './semantic-records.ts';

/** `path` with every x coordinate moved by `dx`. */
function shifted(path: string, dx: number): string {
  if (dx === 0) return path;
  let index = 0;
  return path.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu, (value) => {
    const n = Number(value);
    const mapped = index++ % 2 === 0 ? n + dx : n;
    const rounded = Math.round(mapped * 1000) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  });
}

/**
 * The outline of `text` in `style`, with right-to-left runs shaped right to left and placed in
 * visual order. Undefined when the measurer has no outlines for some run.
 */
export function textArtOutline(
  text: string,
  style: ResolvedRunStyle,
  measurer: TextMeasurer
): TextOutline | undefined {
  const outline = measurer.textOutline;
  if (!outline) return undefined;
  let items, baseLevel;
  try {
    const embedding = bidiAlgorithm.getEmbeddingLevels(text);
    baseLevel = embedding.paragraphs[0]?.level ?? 0;
    items = itemizeScriptFontSlots(text, 0, embedding);
  } catch {
    return outline.call(measurer, text, style);
  }
  if (!items.some((item) => item.bidiLevel % 2 === 1)) return outline.call(measurer, text, style);
  // Font slots do not matter here: one face draws the whole string. Neighbouring items of one
  // level shape together, so kerning and joining hold across them.
  const runs: { from: number; to: number; level: number; script: string }[] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && last.level === item.bidiLevel && last.to === item.from) {
      last.to = item.to;
      if (last.script === 'Zyyy') last.script = item.script;
    } else runs.push({ from: item.from, to: item.to, level: item.bidiLevel, script: item.script });
  }
  const paths: string[] = [];
  let x = 0;
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const index of visualOrderOfLevels(runs.map((run) => run.level))) {
    const run = runs[index]!;
    const piece = text.slice(run.from, run.to);
    const pieceStyle: ResolvedRunStyle = {
      ...style,
      shaping: {
        script: run.script,
        direction: run.level % 2 === 1 ? 'rtl' : 'ltr',
        level: run.level,
        baseLevel,
      },
    };
    const advance = measurer.measure(piece, pieceStyle);
    if (piece.trim()) {
      const part = outline.call(measurer, piece, pieceStyle);
      if (!part?.path) return undefined;
      paths.push(shifted(part.path, x));
      left = Math.min(left, part.ink.left + x);
      right = Math.max(right, part.ink.right + x);
      top = Math.min(top, part.ink.top);
      bottom = Math.max(bottom, part.ink.bottom);
    }
    x += advance;
  }
  if (!paths.length || !(right > left) || !(bottom > top)) return undefined;
  return Object.freeze({
    path: paths.join(''),
    ink: Object.freeze({ left, top, right, bottom }),
  });
}
