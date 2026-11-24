// Where a character-relative anchor sits on its line: the model offset of the last text
// boundary before the drawing atom, and the x of that offset on the line as drawn.

import type { LayoutBox } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';

export function anchorCharacterXOnLine(
  line: {
    readonly range: { readonly start: number; readonly end: number };
    readonly box: LayoutBox;
    readonly spans: readonly {
      readonly range: { readonly start: number; readonly end: number };
      readonly box: LayoutBox;
      readonly text?: string;
      readonly style?: import('./run-style.ts').ResolvedRunStyle;
      readonly fontSlot?: import('./script-itemization.ts').FontSlot;
    }[];
  },
  modelOffset: number,
  measurer?: import('./semantic-records.ts').TextMeasurer
): number {
  // As drawn: the span's font slot decides the face this prefix measures in.
  const measured = (
    text: string,
    style: import('./run-style.ts').ResolvedRunStyle,
    slot: import('./script-itemization.ts').FontSlot | undefined
  ): number => measureDisplayText(text, styleForFontSlot(style, slot), measurer!);
  for (const span of line.spans) {
    if (modelOffset < span.range.start) break;
    if (modelOffset < span.range.end) {
      if (measurer && span.text !== undefined && span.style !== undefined) {
        const within = modelOffset - span.range.start;
        return span.box.x + measured(span.text.slice(0, within), span.style, span.fontSlot);
      }
      const spanLength = span.range.end - span.range.start;
      if (spanLength <= 0) return span.box.x;
      const within = modelOffset - span.range.start;
      return span.box.x + (span.box.width * within) / spanLength;
    }
    if (modelOffset === span.range.end) {
      if (measurer && span.text !== undefined && span.style !== undefined) {
        return span.box.x + measured(span.text, span.style, span.fontSlot);
      }
      return span.box.x + span.box.width;
    }
  }
  let trailing: (typeof line.spans)[number] | undefined;
  for (const span of line.spans) {
    if (span.range.end <= modelOffset) trailing = span;
  }
  if (trailing) {
    if (measurer && trailing.text !== undefined && trailing.style !== undefined) {
      return trailing.box.x + measured(trailing.text, trailing.style, trailing.fontSlot);
    }
    return trailing.box.x + trailing.box.width;
  }
  return line.box.x;
}

/** Model offset for a character-relative anchor — last text boundary before the drawing atom. */
export function anchorCharacterFrameOffset(
  line: {
    readonly range: { readonly start: number; readonly end: number };
    readonly spans: readonly { readonly range: { readonly start: number; readonly end: number } }[];
  },
  modelStart: number
): number {
  let textEnd = line.range.start;
  for (const span of line.spans) {
    if (span.range.end <= modelStart) textEnd = span.range.end;
  }
  return textEnd;
}
