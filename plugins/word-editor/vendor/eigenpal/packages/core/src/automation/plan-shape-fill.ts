// `Shape.fill` reads and writes for one listed shape.
//
// A read answers what the shape paints, its style and theme resolved. A write is one
// `setShapeFormat` op on the drawing or `w:pict` that holds the shape, so the fill change commits
// in the batch's transaction with every other edit. A shape with no fill to set (a picture, a
// chart, a diagram) refuses both.

import {
  narrowedTargets,
  readShapeFormat,
  shapeFormatTargets,
} from '../store/package/shape-format.ts';
import { createPackageShapeThemeResolvers } from '../store/package/theme-color-resolution.ts';
import { validateShapeFormat } from '../store/store/tree-op-shape-format.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import { answered, refused } from './plan-results.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { shapeFillInput, shapeFillRead } from './shape-fill.ts';
import type { AutomationShapeEntry } from './shapes.ts';
import type { AutomationStoryId } from './stories.ts';
import { storyKey } from './stories.ts';
import { TARGET_REMOVED } from './target-removed.ts';

type FillOperation = Extract<AutomationOperation, { op: 'getShapeFill' | 'setShapeFill' }>;

export function planShapeFill(
  operation: FillOperation,
  found: { readonly owner: AutomationStoryId; readonly shape: AutomationShapeEntry },
  reads: AutomationPackageReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null
): PlannedOperation {
  const story = reads.story(found.owner);
  if (!story)
    return refused('invalid-handle', 'that shape is not in this document', TARGET_REMOVED);
  const { drawingNodeId, shapeNodeId } = found.shape.formatTarget;
  const all = shapeFormatTargets(story.part, drawingNodeId);
  const targets = typeof all === 'string' ? null : narrowedTargets(story.part, all, shapeNodeId);
  if (!targets)
    return refused(
      'unsupported-content',
      'that shape has no fill to read or set',
      found.shape.type
    );
  if (operation.op === 'getShapeFill') {
    const theme = reads.package ? createPackageShapeThemeResolvers(reads.package) : undefined;
    return answered({
      kind: 'shapeFill',
      fill: shapeFillRead(readShapeFormat(targets, theme).fill),
    });
  }
  const fill = shapeFillInput(operation.fill);
  if ('refused' in fill) return refused('unsupported-content', fill.refused, 'fill');
  if (!story.has(found.shape.hostParagraphId))
    return refused('invalid-handle', 'that shape is outside this story', storyKey(found.owner));
  const conflict = claim(story, found.shape.hostParagraphId);
  if (conflict) return conflict;
  const op = {
    op: 'setShapeFormat' as const,
    drawingNodeId,
    ...(shapeNodeId !== undefined ? { shapeNodeId } : {}),
    fill,
  };
  // A legacy VML shape has no transparency to write; refuse it here rather than at commit.
  const rejection = validateShapeFormat(story.part, op);
  if (rejection)
    return refused(
      'unsupported-content',
      rejection === 'no-solid-fill'
        ? 'the shape has no solid fill of its own or from its group to change; set a color'
        : `that fill cannot be written: ${rejection}`,
      'fill'
    );
  return {
    ok: true,
    kind: 'command',
    story: found.owner,
    ops: [op],
    answer: () => ({ kind: 'applied' }),
  };
}
