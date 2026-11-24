import { insertsBeforePrompt } from './tree-op-prompt-bias.ts';
import {
  isInsertableText,
  LINE_BREAK_TEXT,
  propertiesHoldLineBreaks,
} from './tree-op-inline-elements.ts';
import {
  contentControlPropertiesOf,
  contentControlsIn,
  resolveContentControlLock,
} from '../package/content-control-nodes.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import { canTrackContentControl } from './tracked-content-control-insert.ts';
import { findNode } from '../package/ooxml-edit.ts';
import {
  enclosingContentControls,
  INSERTABLE_CONTENT_CONTROL_TYPES,
  isWritableContentControlMetadata,
} from './tree-op-content-controls.ts';
import { strikesWholeControl } from './tree-op-control-strike.ts';
import { invalidRevisionAttribution, type TreeDocOp } from './tree-op-types.ts';
import {
  isParagraph,
  paragraphLength,
  splitsSurrogate,
  indivisibleAt,
} from './tree-op-segments.ts';
// Content-control restrictions, as the validator sees them (store lane).
//
// Split out of tree-op-validate.ts, which is at its line cap. `w:sdt` locks are the one
// refusal family that needs its own ancestor walk: whether an edit is allowed depends not
// on the node it names but on every control WRAPPING that node. Re-exported from
// tree-op-validate.ts so importers keep one entry point.

import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import {
  checkboxContentWritable,
  decodeCheckboxGlyph,
  isInlineControl,
} from './content-control-checkbox.ts';
import { valueContentWritable } from './content-control-value-content.ts';
import {
  checkboxPayloadOf,
  contentControlAncestorsOf,
  contentControlContentOf,
  contentControlValueTypeOf,
  declaredLockOf,
  effectiveContentLockAt,
  effectiveLockOf,
  findContentControl,
  formatSdtDateDisplay,
  innermostContentControlAround,
  isBoundAt,
  isBoundContentControl,
  isContentControlNode,
  isRepeatingSectionControl,
  isShowingPlaceholder,
  isTemporaryControl,
  leavesInlineContainer,
  listItemsOf,
  parseCheckboxValue,
} from './tree-op-nodes.ts';
import {
  insertionDestination,
  insertsBesideRestrictedControl,
  segmentsOf,
  fieldInsertionEndAt,
} from './tree-op-segments.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

/**
 * The content control that owns a caret/range in a paragraph — innermost ancestor of the
 * run under the caret. At a boundary, a `showingPlcHdr` control on either side wins so a
 * first keystroke replaces the prompt rather than appending beside it.
 */
export function contentControlAtCaret(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  bias?: 'left' | 'right'
): ReturnType<typeof findContentControl> {
  const segments = segmentsOf(paragraph);
  const overlapping = segments.filter((segment) => segment.start < end && segment.end > start);
  if (overlapping.length > 0) {
    return innermostContentControlAround(part, overlapping[0]!.runId);
  }
  if (start !== end) {
    return innermostContentControlAround(part, paragraph.id);
  }
  if (
    fieldInsertionEndAt(paragraph, start) ||
    insertsBesideRestrictedControl(paragraph, start, bias)
  ) {
    return innermostContentControlAround(
      part,
      insertionDestination(paragraph, start, null, bias).landingNodeId
    );
  }
  const after = segments.find((segment) => segment.start === start);
  const before = [...segments].reverse().find((segment) => segment.end === start);
  const afterControl = after ? innermostContentControlAround(part, after.runId) : null;
  const beforeControl = before ? innermostContentControlAround(part, before.runId) : null;
  if (afterControl && isShowingPlaceholder(afterControl)) {
    if (insertsBeforePrompt(paragraph, start, afterControl, bias)) {
      return innermostContentControlAround(
        part,
        insertionDestination(paragraph, start, null, bias).landingNodeId
      );
    }
    return afterControl;
  }
  if (beforeControl && isShowingPlaceholder(beforeControl)) return beforeControl;
  // A `w:temporary` control at either side of the caret is claimed EAGERLY, like a
  // placeholder: its contract is unwrap-on-first-edit, and a keystroke at its boundary is
  // that edit (pinned by the temporary-unwrap tests).
  if (afterControl && isTemporaryControl(afterControl)) return afterControl;
  if (beforeControl && isTemporaryControl(beforeControl)) return beforeControl;
  // Otherwise attribute the caret to the control the APPLY side would type into, under
  // apply's EXACT conditions — bias left, an intact (non-deleted) before segment, no
  // control-membership change across the boundary, and not leaving a link/field.
  // Mirroring only part of the rule is how a `bias: 'right'` insert validated against
  // the outside run while apply wrote inside a locked chip.
  if (
    bias !== 'right' &&
    before &&
    before.removeNodeIds === undefined &&
    beforeControl?.id === afterControl?.id &&
    !leavesInlineContainer(paragraph, before, after)
  ) {
    return beforeControl ?? innermostContentControlAround(part, paragraph.id);
  }
  // At an inline-control boundary the run STARTING at the caret owns the insertion —
  // typing at a control's leading edge enters it, as in Word.
  if (after) return afterControl ?? innermostContentControlAround(part, paragraph.id);
  if (beforeControl) {
    // Outer edge with nothing beyond: only controls ABOVE the one being left still own
    // the caret (a run inside a control with no after segment always leaves it).
    const ancestors = contentControlAncestorsOf(part, beforeControl.id);
    return ancestors[ancestors.length - 1] ?? null;
  }
  return innermostContentControlAround(part, paragraph.id);
}

/**
 * Whether `[start, end)` overlaps content that an enclosing content control forbids editing.
 * A range that merely touches a lock boundary is refused whole — never partially applied.
 *
 * `dataBinding` refuses before placeholder/temporary transitions. A `w:temporary` control
 * whose wrapper cannot be removed (effective `sdtLocked` / `sdtContentLocked`) refuses the
 * whole content edit with `locked` — temporary's contract is unwrap-on-edit.
 *
 * `restyle` skips only the content-lock answers, for a write a host's `ContentLockPolicy` lets
 * past them (`restylePassesContentLock`); `bound` and the temporary wrapper refusal still hold.
 */
export function rangeTouchesContentRestriction(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  { bias, restyle = false, struckWhole }: ContentEditCheck = {}
): TreeOpRejection | null {
  // The landing resolver moved this insert out of where the run rule below would put it, so
  // validate the place it actually lands.
  if (
    start === end &&
    (fieldInsertionEndAt(paragraph, start) ||
      insertsBesideRestrictedControl(paragraph, start, bias))
  ) {
    return nodeTouchesContentRestriction(
      part,
      insertionDestination(paragraph, start, null, bias).landingNodeId
    );
  }
  const segments = segmentsOf(paragraph);
  const overlappingRunIds = new Set(
    segments.filter((segment) => segment.start < end && segment.end > start).map((s) => s.runId)
  );
  // A collapsed insert at `start` (end === start) still sits at a caret. The run checked
  // is the run the APPLY side would type into, under apply's EXACT conditions (bias left,
  // an intact before segment, not leaving a container) — mirroring only part of the rule
  // is how a `bias: 'right'` insert validated against the outside run while apply wrote
  // inside a locked chip. At a container's outer edge with nothing beyond, the insert
  // lands BESIDE it and the control check below owns ancestor locks.
  if (overlappingRunIds.size === 0 && start === end) {
    const after = segments.find((segment) => segment.start === start);
    const before = [...segments].reverse().find((segment) => segment.end === start);
    const leftWins =
      bias !== 'right' &&
      before !== undefined &&
      before.removeNodeIds === undefined &&
      // The same control-membership guard apply's `crossesContentControlBoundary` applies:
      // at a control boundary the run STARTING at the caret owns the insertion.
      innermostContentControlAround(part, before.runId)?.id ===
        (after ? innermostContentControlAround(part, after.runId)?.id : undefined) &&
      !leavesInlineContainer(paragraph, before, after);
    const at = leftWins ? before : after;
    if (at) overlappingRunIds.add(at.runId);
  }
  for (const runId of overlappingRunIds) {
    // A run inside a control struck WHOLE is not edited: the control is. The lock check on its
    // reach asks that control the removal question and its enclosing controls the edit one.
    if (
      struckWhole?.size &&
      contentControlAncestorsOf(part, runId).some((c) => struckWhole.has(c.id))
    ) {
      continue;
    }
    if (isBoundAt(part, runId)) return 'bound';
    if (!restyle && effectiveContentLockAt(part, runId).content) return 'locked';
  }
  const control = contentControlAtCaret(part, paragraph, start, end, bias);
  if (control && !struckWhole?.has(control.id)) {
    if (
      isBoundContentControl(control) ||
      contentControlAncestorsOf(part, control.id).some(isBoundContentControl)
    ) {
      return 'bound';
    }
    // Empty paragraphs have no overlapping runs, so content lock must be read from the
    // control itself — otherwise an empty `contentLocked` / `sdtContentLocked` control
    // would admit the first insertion.
    if (!restyle && effectiveLockOf(part, control).content) return 'locked';
    if (isTemporaryControl(control) && effectiveLockOf(part, control).wrapper) {
      return 'locked';
    }
  }
  return null;
}

export function holds(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => holds(child, id));
}

/** How a content-bearing range is checked: the insertion bias, and whether a host policy lets a restyle past the lock. */
export interface ContentEditCheck {
  readonly bias?: 'left' | 'right' | undefined;
  readonly restyle?: boolean;
  /** Controls a tracked deletion strikes whole; see {@link controlsStruckWhole}. */
  readonly struckWhole?: ReadonlySet<string>;
}

/** The controls a tracked deletion of `[start, end)` strikes whole, by node id. */
export function controlsStruckWhole(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number
): ReadonlySet<string> {
  const inside = contentControlsIn(paragraph);
  if (inside.length === 0) return new Set();
  const offsets = paragraphOffsetIndex(paragraph);
  const struck = new Set<string>();
  for (const entry of inside) {
    const locks = enclosingContentControls(part, entry.node.id).map(
      (control) => contentControlPropertiesOf(control).lock
    );
    const lock = resolveContentControlLock(locks);
    if (strikesWholeControl(offsets.spanOf(entry.node), { start, end }, lock, entry.node)) {
      struck.add(entry.node.id);
    }
  }
  return struck;
}

/** Refuse a content-bearing edit that would rewrite a locked or bound region. */
export function rejectContentEdit(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  check: ContentEditCheck = {}
): TreeOpRejection | null {
  return rangeTouchesContentRestriction(part, paragraph, start, end, check);
}

/**
 * Whether rewriting a node (hyperlink retarget/removal, and similar) would touch a locked or
 * bound content control that encloses it. Same axes as {@link rangeTouchesContentRestriction}:
 * `dataBinding` → `bound`, content lock → `locked`, temporary unwrap blocked by wrapper lock →
 * `locked`.
 */
export function nodeTouchesContentRestriction(
  part: OoxmlPart,
  nodeId: string
): TreeOpRejection | null {
  if (isBoundAt(part, nodeId)) return 'bound';
  if (effectiveContentLockAt(part, nodeId).content) return 'locked';
  const control = innermostContentControlAround(part, nodeId);
  if (control) {
    if (
      isBoundContentControl(control) ||
      contentControlAncestorsOf(part, control.id).some(isBoundContentControl)
    ) {
      return 'bound';
    }
    if (isTemporaryControl(control) && effectiveLockOf(part, control).wrapper) {
      return 'locked';
    }
  }
  return null;
}

/**
 * Whether deleting `block` would destroy a locked or bound content control: enclosing content
 * locks / bindings on the block itself, or any descendant control whose wrapper lock or data
 * binding would be removed with the subtree.
 *
 * Wrapper locks matter on descendants because `deleteBlock` removes the wrapper from the
 * document; they do not matter on ancestors (deleting a paragraph inside an `sdtLocked`
 * control leaves the wrapper in place). A descendant's CONTENT lock does not matter:
 * `contentLocked` protects what the control holds and lets the whole control go.
 */
export function deleteBlockTouchesContentRestriction(
  part: OoxmlPart,
  block: OoxmlNode
): TreeOpRejection | null {
  if (block.kind === 'textValue') return null;
  if (isBoundAt(part, block.id)) return 'bound';
  if (effectiveContentLockAt(part, block.id).content) return 'locked';

  const walk = (node: OoxmlNode): TreeOpRejection | null => {
    if (node.kind === 'textValue') return null;
    if (isContentControlNode(node)) {
      if (isBoundContentControl(node)) return 'bound';
      if (declaredLockOf(node).wrapper) return 'locked';
    }
    for (const child of node.children) {
      const rejection = walk(child);
      if (rejection) return rejection;
    }
    return null;
  };
  return walk(block);
}

export function validateSetContentControlValue(
  part: OoxmlPart,
  controlId: string,
  value: string
): TreeOpRejection | null {
  if (typeof controlId !== 'string' || controlId.length === 0) return 'unknown-control';
  const control = findContentControl(part, controlId);
  if (!control) return 'unknown-control';
  if (
    isRepeatingSectionControl(control) ||
    contentControlValueTypeOf(control) === 'repeatingSection'
  ) {
    return 'unsupported';
  }
  if (
    isBoundContentControl(control) ||
    contentControlAncestorsOf(part, control.id).some(isBoundContentControl)
  ) {
    return 'bound';
  }
  if (effectiveLockOf(part, control).content) return 'locked';
  // Temporary unwrap is part of a successful value write; refuse when the wrapper is locked.
  if (isTemporaryControl(control) && effectiveLockOf(part, control).wrapper) return 'locked';
  if (typeof value !== 'string' || !isInsertableText(value)) return 'invalidArgs';
  if (
    value.includes(LINE_BREAK_TEXT) &&
    !propertiesHoldLineBreaks(contentControlPropertiesOf(control))
  )
    return 'invalidArgs';

  const type = contentControlValueTypeOf(control);
  // A value becomes one run inside the structure the control wraps; content no value can stand
  // in for is refused here, before the write, so `can()` and `exec()` agree.
  const textWritable = (): TreeOpRejection | null =>
    valueContentWritable(contentControlContentOf(control), isInlineControl(part, controlId))
      ? null
      : 'unsupported';
  switch (type) {
    case 'dropdown': {
      const items = listItemsOf(control);
      if (!items.some((item) => item.value === value)) return 'invalidArgs';
      return textWritable();
    }
    case 'combo':
      return textWritable();
    case 'checkbox': {
      if (parseCheckboxValue(value) === null) return 'typeMismatch';
      const payload = checkboxPayloadOf(control);
      if (!payload) return 'typeMismatch';
      // A state that names no code point cannot be written; the typed path refuses it too.
      if (
        decodeCheckboxGlyph(payload.checkedGlyph) === null ||
        decodeCheckboxGlyph(payload.uncheckedGlyph) === null
      ) {
        return 'invalidArgs';
      }
      // The applier refuses content it cannot rewrite in place; say so before the write.
      const inline = isInlineControl(part, controlId);
      return checkboxContentWritable(contentControlContentOf(control), inline)
        ? null
        : 'unsupported';
    }
    case 'date': {
      if (formatSdtDateDisplay(value, undefined) === null) return 'invalidArgs';
      return textWritable();
    }
    case 'picture':
      return 'typeMismatch';
    case 'text':
    case 'richText':
    case 'other':
      return textWritable();
    default:
      return 'unsupported';
  }
}

export function validateRemoveContentControl(
  part: OoxmlPart,
  controlId: string
): TreeOpRejection | null {
  if (typeof controlId !== 'string' || controlId.length === 0) return 'unknown-control';
  const control = findContentControl(part, controlId);
  if (!control) return 'unknown-control';
  if (effectiveLockOf(part, control).wrapper) return 'locked';
  return enclosingContentLockRefusal(part, control.id);
}

/**
 * Removing or unwrapping a control edits the content of the control that ENCLOSES it, so a
 * content lock there refuses, whatever the removed control's own lock says.
 */
export function enclosingContentLockRefusal(
  part: OoxmlPart,
  controlId: string
): TreeOpRejection | null {
  const ancestors = contentControlAncestorsOf(part, controlId);
  return ancestors.some((ancestor) => declaredLockOf(ancestor).content) ? 'locked' : null;
}

export const CONTENT_CONTROL_LOCKS: ReadonlySet<string> = new Set([
  'unlocked',
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
]);

export function validateInsertContentControl(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'insertContentControl' }>
): TreeOpRejection | null {
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision))
    return 'invalid-property-value';
  if (!INSERTABLE_CONTENT_CONTROL_TYPES.includes(op.type)) return 'invalidArgs';
  for (const value of [op.tag, op.alias]) {
    if (!isWritableContentControlMetadata(value)) return 'invalid-property-value';
  }
  if (op.lock !== undefined && !CONTENT_CONTROL_LOCKS.has(op.lock)) return 'invalidArgs';
  if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) return 'invalid-range';
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (!isParagraph(paragraph)) return 'not-a-paragraph';
  if (op.start < 0 || op.end > paragraphLength(paragraph) || op.start > op.end) {
    return 'invalid-range';
  }
  if (splitsSurrogate(paragraph, op.start) || splitsSurrogate(paragraph, op.end)) {
    return 'splits-surrogate-pair';
  }
  // BOTH EDGES, and here rather than in the applier: a control is a sibling of runs, so an
  // edge strictly inside a hyperlink, an inline control or an atomic field is not a place one
  // can start or stop. The applier refused these too, but only after `can` had already told a
  // caller the command was live — a disabled button that runs, or an enabled one that fails.
  if (indivisibleAt(paragraph, op.start) || indivisibleAt(paragraph, op.end)) {
    return 'indivisible-content';
  }
  // The same restriction check every other range op runs: a locked or bound control the span
  // touches, and forms protection. The applier answered it, so the write was refused — but
  // only after `can` had already told chrome the command was live, on exactly the document
  // class this verb is for.
  if (op.revision && !canTrackContentControl(part, op.paragraphId, op.start, op.end))
    return 'indivisible-content';
  return rejectContentEdit(part, paragraph, op.start, op.end);
}
