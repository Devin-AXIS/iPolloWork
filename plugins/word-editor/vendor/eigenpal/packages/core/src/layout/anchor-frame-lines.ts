// Anchor framing for a paragraph fragment's anchors. Extracted from the story loop in
// semantic-layout so that file stays inside its line budget.

import type { LayoutBox, LineRecord } from './semantic-records.ts';

/**
 * The lines and paragraph box a fragment's anchors resolve against: its own placed lines. Each
 * fragment publishes the anchors its lines hold, so an anchor on a later page measures from the
 * top of the paragraph's part on that page.
 *
 * `positionV relativeFrom="paragraph"` measures from where the paragraph would begin without the
 * wrapping bands that pushed its first line down (`bandSkip`): its own, whose displacement the
 * picture would otherwise chase, and inherited ones alike. `relativeFrom="line"` on the first
 * line measures from the top of the space and border above that line, after the band push, or
 * before it in legacy modes (`lineBeforeBandPush`, `lineAnchorsBeforeBandPush`).
 */
export function fragmentAnchorFrame(input: {
  readonly pending: readonly LineRecord[];
  readonly top: number;
  readonly height: number;
  readonly column: { readonly x: number; readonly width: number };
  readonly indentLeft: number;
  readonly available: number;
  /** How far an earlier band displaced this paragraph on the page. */
  readonly displacement: number;
  readonly bandSkip: number;
  readonly lineBeforeBandPush: boolean;
}): { readonly lines: readonly LineRecord[]; readonly paragraphBox: LayoutBox } {
  const { pending, top, bandSkip } = input;
  const y = top - bandSkip - input.displacement;
  const x = input.column.x + input.indentLeft;
  const [first, ...rest] = pending;
  const lineTop = input.lineBeforeBandPush ? top - bandSkip : top;
  const lines =
    first && first.box.y !== lineTop
      ? [
          {
            ...first,
            box: { ...first.box, y: lineTop, height: first.box.y + first.box.height - lineTop },
          },
          ...rest,
        ]
      : pending;
  return { lines, paragraphBox: { x, y, width: input.available, height: input.height } };
}
