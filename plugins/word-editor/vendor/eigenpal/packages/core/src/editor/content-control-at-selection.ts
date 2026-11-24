import { isContentControl } from '../store/package/content-control-walk.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { contentControlRecordsInPart } from '../layout/content-control-boundary-layout.ts';
// The content control a selection is IN, for the chrome's active state.
//
// A caret answers with one point. A range that selects a prompt whole runs from the
// control's start to its end, and the head's point sits on the control's outer edge, just
// outside the fragment the hit test consults — so the control that was clearly just clicked
// read as "no control at the caret", its chrome went dark, and its button hid. The range's
// ends are probed a hair inside the selection instead, so a selected prompt keeps its control
// active. Its own module because the surface sits at its line cap.

import type { SemanticLayout, ContentControlBoundaryRecord } from '../layout/semantic-records.ts';
import type { SemanticSelection, SemanticPosition } from '../layout/semantic-interaction.ts';
import { caretAt, contentControlAtSemantic } from '../layout/semantic-interaction.ts';
import type { TextMeasurer } from '../layout/semantic-records.ts';

/** A quarter point inside the fragment edge: enough to be inside, too small to cross a glyph. */
const INSIDE = 0.25;

export function contentControlAtSelection(
  layout: SemanticLayout,
  selection: SemanticSelection,
  measurer: TextMeasurer
): ContentControlBoundaryRecord | null {
  const probe = (position: SemanticPosition, shiftX: number) => {
    const caret = caretAt(layout, position, measurer);
    if (!caret) return null;
    return contentControlAtSemantic(layout, {
      x: caret.x + shiftX,
      y: caret.y + caret.height / 2,
      pageIndex: caret.pageIndex,
    });
  };
  const atHead = probe(selection.head, 0);
  if (atHead) return atHead;
  const collapsed =
    selection.anchor.paragraphId === selection.head.paragraphId &&
    selection.anchor.offset === selection.head.offset;
  // A caret on a control's trailing edge is still IN the control, as Word's is: typing there
  // continues the field, and ArrowRight is what leaves it. The edge itself hit-tests outside,
  // and a hair to its left is not always the control: an automatic inter-script gap
  // (`w:autoSpaceDE`/`w:autoSpaceDN`) before the next text puts the caret past that gap. An
  // inline control's model range answers the edge without geometry.
  if (collapsed) return endingAt(layout, selection.head) ?? probe(selection.head, -INSIDE);
  const headFirst =
    selection.head.paragraphId === selection.anchor.paragraphId &&
    selection.head.offset < selection.anchor.offset;
  // The end of the range sits on the control's outer edge; step inward from both ends.
  return (
    probe(selection.head, headFirst ? INSIDE : -INSIDE) ??
    probe(selection.anchor, headFirst ? -INSIDE : INSIDE)
  );
}

/** The innermost non-empty inline control whose content ends at `position`. */
function endingAt(
  layout: SemanticLayout,
  position: SemanticPosition
): ContentControlBoundaryRecord | null {
  let best: ContentControlBoundaryRecord | null = null;
  for (const control of layout.contentControls ?? []) {
    const range = control.range;
    if (!range || range.paragraphId !== position.paragraphId) continue;
    if (range.end !== position.offset || range.start === range.end) continue;
    if (!best || control.nestingDepth > best.nestingDepth) best = control;
  }
  return best;
}

/** Cache body chrome reads by the layout and selection identities that determine them. */
export function memoizedContentControlSelection(
  layoutOf: () => SemanticLayout,
  selectionOf: () => SemanticSelection,
  resolve: () => ContentControlBoundaryRecord | null
): () => ContentControlBoundaryRecord | null {
  let previousLayout: SemanticLayout | undefined;
  let previousSelection: SemanticSelection | undefined;
  let result: ContentControlBoundaryRecord | null = null;
  return () => {
    const layout = layoutOf(),
      selection = selectionOf();
    if (layout !== previousLayout || selection !== previousSelection) {
      result = resolve();
      previousLayout = layout;
      previousSelection = selection;
    }
    return result;
  };
}

/** The retained caret is outside this prompt, but can remain inside an enclosing control. */
export function controlOutsidePrompt(
  part: import('../store/package/ooxml-tree.ts').OoxmlPart,
  promptId: string,
  layout: SemanticLayout
): ContentControlBoundaryRecord | null {
  for (let node = parentNodeOf(part, promptId); node; node = parentNodeOf(part, node.id)) {
    if (isContentControl(node)) {
      const id = node.id;
      return (
        layout.contentControls?.find((record) => record.id === id) ??
        contentControlRecordsInPart(part).find((record) => record.id === id) ??
        null
      );
    }
  }
  return null;
}
