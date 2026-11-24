// The body of a text box the file gives no story.
//
// INTERNAL. A text box or geometric shape can arrive with no `w:txbxContent` at all: a VML shape
// with no `v:textbox`, or a DrawingML one with neither `wps:txbx` nor `wps:linkedTxbx`. Such a
// shape still has a text frame, and `Shape.body` answers it as an empty story, so a script that
// reads every text box does not fail on one with nothing in it. The file has no element to hold
// text, so every write to that story is refused rather than inventing one.

import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { OoxmlGenericElementNode, OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { AutomationStoryId } from './stories.ts';
import type { AutomationHandleTable } from './handles.ts';
import { isAutomationCommand, type AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import type { AutomationShapeEntry } from './shapes.ts';
import { bodyHandle } from './virtual-furniture.ts';

const roots = new WeakSet<OoxmlNode>();

/** A detached, empty story root standing in for a text box's missing `w:txbxContent`. */
export function emptyFrameRoot(shape: AutomationShapeEntry): OoxmlNode {
  const root: OoxmlGenericElementNode = Object.freeze({
    kind: 'generic',
    id: `${shape.hostParagraphId}#empty-text-frame-${String(shape.id)}`,
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'txbxContent',
    namespaceBindings: Object.freeze([]),
    attributes: Object.freeze([]),
    children: Object.freeze([]),
  });
  roots.add(root);
  return root;
}

const REFUSAL: PlannedOperation = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'unsupported-content',
    message: 'that shape has no text story in the file, so it cannot take content',
    detail: 'unsupported-story',
  }),
});

function isEmptyFrame(story: AutomationStoryId, reads: AutomationPackageReads): boolean {
  if (story.kind !== 'textbox') return false;
  const found = reads.story(story);
  return !!found && roots.has(found.root);
}

/**
 * The refusal for a write into an empty text frame, or null for anything else.
 *
 * Checked before planning, so the caller hears why rather than that the story has no paragraph,
 * and again on the planned write, whatever handle it came through. A command that plans no
 * change, such as clearing a shape that holds nothing, is not a write and is answered as planned.
 */
export function emptyFrameWriteRefusal(
  operation: AutomationOperation,
  planned: () => PlannedOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): PlannedOperation {
  const handle = isAutomationCommand(operation) ? bodyHandle(operation) : undefined;
  const target = handle === undefined ? null : handles.resolve(handle, 'body');
  if (target?.kind === 'body' && isEmptyFrame(target.story, reads)) {
    const step = planned();
    return step.ok && step.kind === 'query' ? step : unchanged(step) ? step : REFUSAL;
  }
  const step = planned();
  if (!step.ok || step.kind === 'query' || !('story' in step)) return step;
  return isEmptyFrame(step.story, reads) && !unchanged(step) ? REFUSAL : step;
}

function unchanged(step: PlannedOperation): boolean {
  return (
    step.ok &&
    step.kind === 'command' &&
    step.ops.length === 0 &&
    !step.lifecycle &&
    !step.packageEdits?.length &&
    !step.relate
  );
}
