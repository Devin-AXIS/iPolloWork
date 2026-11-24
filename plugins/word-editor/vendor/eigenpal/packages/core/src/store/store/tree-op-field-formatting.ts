// The run formatting that new inline content takes at an offset: the rule typed text follows.
//
// A field the editing API inserts is content the caller writes at a caret, so its runs take
// the same face a word typed there would. Beside a control that typing cannot enter, the text
// outside the control wins (`tree-op-restricted-edge.ts`). Otherwise the run to the LEFT
// wins, then the run to the right, and an empty paragraph gives its mark's character style
// (`mark-character-style-run.ts`). A tracked formatting record (`w:rPrChange`) never travels.

import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { emptyParagraphRunProperties } from './mark-character-style-run.ts';
import { formattingRunBesideRestrictedControl } from './tree-op-restricted-edge.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import { insertedRunProperties } from './tree-op-tracked.ts';

/** Fresh `w:rPr` copies for content inserted at `offset`, or `[]` for none. */
export function insertionRunPropertiesAt(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  mint: () => string
): OoxmlNode[] {
  const offsets = paragraphOffsetIndex(paragraph);
  const beside = formattingRunBesideRestrictedControl(paragraph, offset, offsets);
  if (beside !== undefined) return beside ? insertedRunProperties(mint, beside) : [];
  const segments = offsets.segments;
  let left: (typeof segments)[number] | undefined;
  let right: (typeof segments)[number] | undefined;
  for (const segment of segments) {
    if (segment.end === offset) left = segment;
    if (segment.start === offset && right === undefined) right = segment;
  }
  for (const segment of [left, right]) {
    const run = segment ? findNode(part, segment.runId) : null;
    if (run && run.kind === 'run') return insertedRunProperties(mint, run);
  }
  return emptyParagraphRunProperties(paragraph, mint);
}
