// Floating and inline shapes and text-box stories: the reads behind `Body.shapes`, `Paragraph.shapes`,
// `Shape` and `Shape.body`.
//
// A shape is named by its `wp:docPr/@id` within the story that anchors it. A text box's body is
// an ordinary story — paragraphs, text, search and edits through the same operations as any other
// body — so this module only lists shapes and names their stories; it never edits.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { planShapeFill } from './plan-shape-fill.ts';
import type { AutomationShapeEntry } from './shapes.ts';
import { resolveSpanRef, spanParagraphIds, storyOfSpanRef } from './spans.ts';
import { isShapeOwnerStory, storyKey, type AutomationStoryId } from './stories.ts';

const SHAPE_TYPES: ReadonlySet<string> = new Set([
  'TextBox',
  'GeometricShape',
  'Picture',
  'Group',
  'Canvas',
  'Unsupported',
]);

type ShapeOperation = Extract<
  AutomationOperation,
  { op: 'getShapes' | 'getShape' | 'getShapeBody' | 'getShapeFill' | 'setShapeFill' }
>;

const refuse = (
  code: 'unsupported-content' | 'invalid-handle' | 'ambiguous-document',
  message: string,
  detail?: string
): PlannedOperation => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
});

const query = (value: Extract<PlannedOperation, { kind: 'query' }>['value']): PlannedOperation => ({
  ok: true,
  kind: 'query',
  value,
});

/** One shape a handle names, or the refusal that says why it names none. */
function shapeOfHandle(
  handle: unknown,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): { readonly owner: AutomationStoryId; readonly shape: AutomationShapeEntry } | PlannedOperation {
  const target = handles.resolve(handle, 'shape');
  if (!target || target.kind !== 'shape')
    return refuse('invalid-handle', 'that handle does not name a shape', 'shape');
  const listing = reads.shapes(target.owner);
  if (!listing.ok)
    return refuse(
      'ambiguous-document',
      'shape identities in that story are not completely and unambiguously enumerable',
      listing.reason
    );
  const shape = listing.shapes.find((entry) => entry.id === target.shapeId);
  // A shape DELETED since the handle was minted is gone, and saying so is the point.
  if (!shape)
    return refuse('invalid-handle', 'that shape is not in this document', storyKey(target.owner));
  return { owner: target.owner, shape };
}

export function planShapes(
  operation: ShapeOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null
): PlannedOperation {
  if (operation.op === 'getShapes') {
    // A shape belongs to the paragraph that anchors it. A partial range would have to decide
    // whether an anchor at its edge is inside, so only whole paragraphs and bodies list shapes.
    const types = operation.types;
    if (
      types !== undefined &&
      (!Array.isArray(types) || types.some((type) => !SHAPE_TYPES.has(type)))
    )
      return refuse('unsupported-content', 'unknown shape type', 'types');
    if (!('body' in operation.span) && !('paragraph' in operation.span))
      return refuse('unsupported-content', 'shapes are listed for a body or a paragraph only');
    const range = resolveSpanRef(operation.span, handles, reads);
    const story = storyOfSpanRef(operation.span, handles, reads);
    if (!range.ok || !story.ok)
      return refuse(
        'invalid-handle',
        'that range no longer exists',
        !range.ok ? range.detail : !story.ok ? story.detail : undefined
      );
    const listing = reads.shapes(story.value.story);
    if (!listing.ok)
      return refuse(
        'ambiguous-document',
        'shape identities in that story are not completely and unambiguously enumerable',
        listing.reason
      );
    const paragraphs = new Set(range.value ? spanParagraphIds(range.value, story.value) : []);
    return query({
      kind: 'handles',
      handles: listing.shapes
        .filter(
          (shape) => paragraphs.has(shape.hostParagraphId) && (!types || types.includes(shape.type))
        )
        .map((shape) => handles.shape(shape.id, story.value.story)),
    });
  }

  const found = shapeOfHandle(operation.shape, handles, reads);
  if ('ok' in found) return found;
  if (operation.op === 'getShape') {
    const { id, name, type } = found.shape;
    return query({ kind: 'shape', shape: { id, name, type } });
  }
  if (operation.op === 'getShapeFill' || operation.op === 'setShapeFill')
    return planShapeFill(operation, found, reads, claim);
  // A text box the file gives no story still has an empty body (`empty-text-frame.ts`).
  if (!found.shape.textboxRoot && !found.shape.emptyFrame)
    return refuse(
      'unsupported-content',
      'that shape holds no text story of its own',
      found.shape.type
    );
  if (!isShapeOwnerStory(found.owner))
    return refuse(
      'unsupported-content',
      'text boxes are reachable in the body, headers and footers only',
      storyKey(found.owner)
    );
  const story: AutomationStoryId = { kind: 'textbox', owner: found.owner, shapeId: found.shape.id };
  if (!reads.story(story))
    return refuse('invalid-handle', 'that text box is not in this document', storyKey(story));
  return query({ kind: 'handle', handle: handles.body(story) });
}
