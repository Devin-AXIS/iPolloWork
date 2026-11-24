import { findNode } from '../store/package/ooxml-edit.ts';
import { TARGET_REMOVED } from './target-removed.ts';
import { projectDrawingsInPart } from '../store/package/drawing-projection.ts';
import { segmentsOf } from '../store/store/tree-op-segments.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { effectiveContentLockAt, isBoundAt, parentOf } from '../store/store/tree-op-nodes.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { resolveSpanRef, spanOffsets, storyOfSpanRef } from './spans.ts';
import {
  insertPicturePlan,
  pictureIdsInSpans,
  pictureProjection,
  pictureRead,
  pictureWriteOps,
} from './pictures.ts';

type PictureOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getInlinePictures'
      | 'getInlinePicture'
      | 'setInlinePicture'
      | 'deleteInlinePicture'
      | 'insertInlinePicture';
  }
>;
const refuse = (
  message: string,
  code: 'unsupported-content' | 'invalid-handle' = 'unsupported-content',
  detail?: string
): PlannedOperation => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
});

/** Root admission must make insertion solitary and reject mutations while tracking. */
export function planPictures(
  operation: PictureOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null
): PlannedOperation {
  if (operation.op === 'getInlinePictures' || operation.op === 'insertInlinePicture') {
    const range = resolveSpanRef(operation.span, handles, reads);
    const resolvedStory = storyOfSpanRef(operation.span, handles, reads);
    if (!range.ok || !resolvedStory.ok)
      return refuse(
        'that picture range no longer exists',
        'invalid-handle',
        !range.ok ? range.detail : !resolvedStory.ok ? resolvedStory.detail : undefined
      );
    const story = resolvedStory.value;
    if (operation.op === 'getInlinePictures')
      return {
        ok: true,
        kind: 'query',
        value: {
          kind: 'handles',
          handles: pictureIdsInSpans(story.part, spanOffsets(range.value, story)).map((id) =>
            handles.inlinePicture(id, story.story)
          ),
        },
      };
    if (!range.value || !reads.package)
      return refuse('insert a paragraph before inserting a picture');
    const { start, end } = range.value;
    if (!['Before', 'After', 'Start', 'End', 'Replace'].includes(operation.location))
      return refuse('unsupported picture insert location');
    if (operation.location === 'Replace' && start.paragraphId !== end.paragraphId)
      return refuse('picture replacement requires a single paragraph');
    const point = operation.location === 'After' || operation.location === 'End' ? end : start;
    if (
      effectiveContentLockAt(story.part, point.paragraphId).content ||
      isBoundAt(story.part, point.paragraphId)
    )
      return refuse('picture insertion is inside protected content');
    const paragraph = findNode(story.part, point.paragraphId);
    if (paragraph?.kind === 'paragraph') {
      for (const segment of segmentsOf(paragraph)) {
        const touches =
          operation.location === 'Replace'
            ? segment.start < end.offset && segment.end > start.offset
            : segment.start < point.offset && segment.end > point.offset;
        if (
          touches &&
          (effectiveContentLockAt(story.part, segment.node.id).content ||
            isBoundAt(story.part, segment.node.id))
        )
          return refuse('picture insertion touches protected content');
      }
    }
    const conflict = claim(story, point.paragraphId);
    if (conflict) return conflict;
    const insertion = insertPicturePlan(
      reads.package,
      story.part.name,
      point.paragraphId,
      point.offset,
      operation.base64
    );
    if (!insertion.ok) return refuse(insertion.detail);
    const ops: TreeDocOp[] = [];
    if (operation.location === 'Replace' && end.offset > start.offset)
      ops.push({
        op: 'deleteText',
        paragraphId: start.paragraphId,
        start: start.offset,
        end: end.offset,
      });
    ops.push(...insertion.ops);
    return {
      ok: true,
      kind: 'command',
      story: story.story,
      ops,
      packageEdits: insertion.packageEdits,
      answer: (post) => {
        const part = post.story(story.story)?.part;
        const drawing =
          part &&
          projectDrawingsInPart(part).find(
            (p) => p.docPrId === insertion.docPrId && p.kind === 'inline'
          );
        if (!drawing) throw new Error('inserted picture was not committed');
        return {
          kind: 'handle',
          handle: handles.inlinePicture(drawing.drawingNodeId, story.story),
        };
      },
    };
  }
  const target = handles.resolve(operation.picture, 'inlinePicture');
  if (!target || target.kind !== 'inlinePicture')
    return refuse('that is not a picture handle', 'invalid-handle');
  const story = reads.story(target.story);
  const projection = story && pictureProjection(story.part, target.drawingNodeId);
  if (!story || !projection)
    return refuse('that inline picture no longer exists', 'invalid-handle', TARGET_REMOVED);
  if (operation.op === 'getInlinePicture')
    return {
      ok: true,
      kind: 'query',
      value: { kind: 'inlinePicture', picture: pictureRead(projection) },
    };
  let paragraph = findNode(story.part, target.drawingNodeId);
  while (paragraph && paragraph.kind !== 'paragraph')
    paragraph = parentOf(story.part, paragraph.id);
  if (!paragraph || !story.has(paragraph.id))
    return refuse('picture is outside this story', 'invalid-handle');
  const conflict = claim(story, paragraph.id);
  if (conflict) return conflict;
  const planned =
    operation.op === 'deleteInlinePicture'
      ? {
          ok: true as const,
          ops: [{ op: 'deleteDrawing' as const, drawingNodeId: target.drawingNodeId }],
        }
      : pictureWriteOps(projection, operation.properties);
  if (!planned.ok) return refuse(planned.detail);
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops: planned.ops,
    answer: () => ({ kind: 'applied' }),
  };
}
