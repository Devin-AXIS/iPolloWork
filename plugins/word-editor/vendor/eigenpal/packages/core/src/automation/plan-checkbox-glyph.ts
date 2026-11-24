// A replacement whose span is exactly the display of a checkbox content control (#1144).
//
// A checkbox shows one of its two state glyphs and nothing else. Text written over that glyph
// is a request to change the state, so a state glyph plans the same op as setting the
// control's value: the glyph and `w14:checked` change together, inside the control. Any other
// text is refused. The ordinary text path would strike the glyph and land the new text beside
// the control, because typing never enters a checkbox, and that left the control empty.

import { contentControlsIn } from '../store/package/content-control-nodes.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { decodeCheckboxGlyph } from '../store/store/content-control-checkbox.ts';
import { checkboxPayloadOf } from '../store/store/tree-op-nodes.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { paragraphsHeldBy } from './content-controls.ts';
import { refused as refuse } from './plan-results.ts';
import type { AutomationValue } from './protocol.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationStoryReads } from './reads.ts';
import type { ResolvedRange } from './spans.ts';

/**
 * The plan for replacing a checkbox's glyph with `text`, or null when the range is not exactly
 * one checkbox's display. `answer` is the replacement's own answer.
 */
export function planCheckboxGlyphReplacement(
  reads: AutomationStoryReads,
  range: ResolvedRange,
  text: string,
  answer: () => AutomationValue
): PlannedOperation | null {
  const control = checkboxDisplayedBy(reads, range);
  if (!control) return null;
  const payload = checkboxPayloadOf(control)!;
  const checked =
    text === decodeCheckboxGlyph(payload.checkedGlyph)
      ? true
      : text === decodeCheckboxGlyph(payload.uncheckedGlyph)
        ? false
        : null;
  if (checked === null) {
    return refuse(
      'unsupported-capability',
      'a checkbox shows only its state glyphs; change its checked state instead',
      'checkbox-glyph'
    );
  }
  return {
    ok: true,
    kind: 'command',
    story: range.start.story,
    ops: [
      { op: 'setContentControlValue', controlId: control.id, value: { kind: 'checkbox', checked } },
    ],
    answer,
  };
}

/**
 * The checkbox whose whole display the range covers: an inline one whose content is exactly the
 * range, or a block one that holds only the range's paragraph, all of it.
 */
function checkboxDisplayedBy(reads: AutomationStoryReads, range: ResolvedRange): OoxmlNode | null {
  const { start, end } = range;
  if (start.paragraphId !== end.paragraphId || end.offset <= start.offset) return null;
  const paragraph = reads.node(start.paragraphId);
  if (paragraph?.kind !== 'paragraph') return null;
  const offsets = paragraphOffsetIndex(paragraph);
  for (const { node } of contentControlsIn(paragraph)) {
    const span = offsets.spanOf(node);
    if (span?.start === start.offset && span.end === end.offset && checkboxPayloadOf(node)) {
      return node;
    }
  }
  if (start.offset !== 0 || end.offset !== (reads.rawText(start.paragraphId) ?? '').length) {
    return null;
  }
  for (const { node } of contentControlsIn(reads.root)) {
    const held = paragraphsHeldBy(node);
    if (held.length === 1 && held[0] === start.paragraphId && checkboxPayloadOf(node)) return node;
  }
  return null;
}
