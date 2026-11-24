import type { AutomationOperation, AutomationPoint } from './operations.ts';
import { LINE_BREAK_CHAR } from './line-break-text.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { PlannedOperation } from './plan.ts';
import { revisionDateNow } from './revision-date.ts';
import { resolveSpanRef } from './spans.ts';
import {
  governingSectionAt,
  isTableNested,
  sectionBreakTypeOf,
} from '../store/store/tree-op-section-address.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';

/**
 * Page/section breaks are structural mutations, with one atomic store transaction.
 *
 * With a tracking author, each is a tracked insertion, in the shape suggesting mode writes:
 * a page break is a `w:br w:type="page"` run inside `w:ins`, and a section break splits the
 * paragraph with an inserted mark (`w:rPr/w:ins`) that carries the new `w:sectPr`. Rejecting
 * the section break joins the paragraphs again and drops that `w:sectPr`.
 */
export function planBreakOperation(
  operation: Extract<AutomationOperation, { op: 'insertBreak' }>,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  admit: (
    story: AutomationStoryReads,
    paragraphId: string,
    createdCount: number
  ) => PlannedOperation | null,
  trackingAuthor?: string
): PlannedOperation {
  const refuse = (message: string): PlannedOperation => ({
    ok: false,
    error: { code: 'unsupported-content', message },
  });
  // The public code for a write that has no tracked form: nothing is applied.
  const refuseTracked = (message: string): PlannedOperation => ({
    ok: false,
    error: {
      code: 'unsupported-capability',
      message,
      detail: 'change-tracking-operation-unsupported',
    },
  });
  if (operation.breakType !== 'Page' && operation.breakType !== 'SectionNext')
    return refuse('only Line, Page, and SectionNext breaks are supported');
  if (!['Before', 'After', 'Start', 'End', 'Replace'].includes(operation.location))
    return refuse('invalid break insertion location');
  if (trackingAuthor !== undefined && operation.location === 'Replace')
    return refuseTracked(
      'a tracked page or section break cannot replace text; delete the text, then insert the break'
    );
  const resolved = resolveSpanRef(operation.span, handles, reads);
  if (!resolved.ok) return { ok: false, error: { code: resolved.code, message: resolved.detail } };
  const range = resolved.value;
  if (!range) return refuse('empty story has no break position');
  const point =
    operation.location === 'After' || operation.location === 'End' ? range.end : range.start;
  const story = reads.story(point.story);
  if (!story) return refuse('missing story');
  if (operation.location === 'Replace' && range.start.paragraphId !== range.end.paragraphId)
    return refuse('break replacement must remain in one paragraph');
  const section = operation.breakType === 'SectionNext';
  if (section && (story.story.kind !== 'body' || isTableNested(story.part, point.paragraphId)))
    return refuse('section breaks require a body paragraph outside a table');
  // The break type belongs to the section that STARTS at the new mark, which is the one that
  // governs the paragraph now. A section that does not start on a new page would have to change
  // type, and a section type change has no tracked form here.
  if (
    section &&
    trackingAuthor !== undefined &&
    sectionBreakTypeOf(governingSectionAt(story.part, point.paragraphId).section) !== 'nextPage'
  )
    return refuseTracked(
      'a tracked next-page section break cannot change how the following section starts'
    );
  const conflict = admit(story, point.paragraphId, section ? 1 : 0);
  if (conflict) return conflict;
  const revision =
    trackingAuthor === undefined
      ? undefined
      : { author: trackingAuthor.trim(), date: revisionDateNow() };
  const ops: TreeDocOp[] = [];
  if (operation.location === 'Replace' && range.end.offset > range.start.offset)
    ops.push({
      op: 'deleteText',
      paragraphId: point.paragraphId,
      start: range.start.offset,
      end: range.end.offset,
    });
  if (section)
    ops.push(
      revision
        ? {
            op: 'splitParagraphMany',
            paragraphId: point.paragraphId,
            offsets: [point.offset],
            revision,
          }
        : { op: 'splitParagraph', paragraphId: point.paragraphId, offset: point.offset },
      { op: 'setSectionMark', paragraphId: point.paragraphId, breakType: 'nextPage' }
    );
  else
    ops.push({
      op: 'insertPageBreak',
      paragraphId: point.paragraphId,
      offset: point.offset,
      ...(revision ? { revision } : {}),
    });
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops,
    answer: () => ({ kind: 'applied' }),
  };
}

/**
 * A `Line` break planned as the text write it is: `\v` inserted at the break position, or
 * written over the span for `Replace`.
 *
 * It then composes with other text edits in its paragraph, records a tracked insertion when an
 * author is tracking, and creates a missing header or footer, on the same terms as text. The
 * answer stays `applied`, as for every break type.
 */
export function planLineBreak(
  operation: AutomationOperation,
  plan: (text: AutomationOperation) => PlannedOperation
): PlannedOperation | null {
  if (operation.op !== 'insertBreak' || operation.breakType !== 'Line') return null;
  const { span, location } = operation;
  const edge = (at: 'start' | 'end'): AutomationPoint =>
    'body' in span
      ? { body: span.body, at }
      : 'paragraph' in span
        ? { paragraph: span.paragraph, at }
        : at === 'start'
          ? span.start
          : span.end;
  const write: AutomationOperation | null =
    location === 'Replace'
      ? { op: 'replaceSpan', span, text: LINE_BREAK_CHAR }
      : location === 'Before' || location === 'Start'
        ? { op: 'insertText', at: edge('start'), text: LINE_BREAK_CHAR }
        : location === 'After' || location === 'End'
          ? { op: 'insertText', at: edge('end'), text: LINE_BREAK_CHAR }
          : null;
  if (!write)
    return {
      ok: false,
      error: { code: 'unsupported-content', message: 'invalid break insertion location' },
    };
  const planned = plan(write);
  return planned.ok && planned.kind === 'command'
    ? { ...planned, answer: () => ({ kind: 'applied' as const }) }
    : planned;
}
