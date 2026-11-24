// The visual pieces of a list marker in a right-to-left paragraph.

import { bidiAlgorithm } from './bidi.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import { visualOrderOfLevels } from './rtl-paragraph.ts';
import { itemizeScriptFontSlots } from './script-itemization.ts';
import type { LayoutBox, ListMarkerRecord, TextMeasurer } from './semantic-records.ts';

type MarkerPiece = NonNullable<ListMarkerRecord['pieces']>[number];

/**
 * A right-to-left paragraph's marker text, split into direction runs in visual order.
 *
 * The marker resolves at the paragraph's right-to-left base level (UAX #9), so `1.` shows
 * its period on the left of the digit and a multi-digit number keeps its digits left to
 * right. Undefined when the text shows as one left-to-right run: the marker then paints
 * from `text` unchanged.
 */
export function rtlListMarkerPieces(
  text: string,
  style: ResolvedRunStyle,
  box: LayoutBox,
  measurer: TextMeasurer
): readonly MarkerPiece[] | undefined {
  if (text.length === 0) return undefined;
  let items;
  try {
    items = itemizeScriptFontSlots(text, 0, bidiAlgorithm.getEmbeddingLevels(text, 'rtl'));
  } catch {
    return undefined;
  }
  if (items.length === 0 || (items.length === 1 && items[0]!.bidiLevel % 2 === 0)) {
    return undefined;
  }
  const pieces: MarkerPiece[] = [];
  for (const index of visualOrderOfLevels(items.map((item) => item.bidiLevel))) {
    const item = items[index]!;
    const pieceText = text.slice(item.from, item.to);
    const pieceStyle: ResolvedRunStyle = {
      ...style,
      shaping: {
        script: item.script,
        direction: item.direction,
        level: item.bidiLevel,
        baseLevel: 1,
      },
    };
    const width = measurer.measure(displayText(pieceText, pieceStyle), pieceStyle);
    pieces.push({ text: pieceText, style: pieceStyle, box: { ...box, width } });
  }
  // Shaped runs need not sum to the whole marker's width; the leading (right) edge holds.
  let x = box.x + box.width - pieces.reduce((sum, piece) => sum + piece.box.width, 0);
  return pieces.map((piece) => {
    const placed = { ...piece, box: { ...piece.box, x } };
    x += piece.box.width;
    return placed;
  });
}
