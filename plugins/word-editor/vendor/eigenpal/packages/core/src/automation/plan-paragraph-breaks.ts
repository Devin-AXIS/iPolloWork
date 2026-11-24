// Paragraph breaks inside written text: `\n`, `\r`, and `\r\n` start a new paragraph.
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationValue } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { revisionDateNow } from './revision-date.ts';
import { resolveSpanRef } from './spans.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { findContentControl } from '../store/package/content-control-nodes.ts';
import { isParagraph } from '../store/store/tree-op-segments.ts';
import { contentControlAtCaret } from '../store/store/tree-op-validate.ts';

/** The characters a text write treats as a paragraph break. */
const PARAGRAPH_BREAK_IN_TEXT = /[\r\n]/;
/** One break each: a CRLF pair is one break, not two. */
const PARAGRAPH_BREAK = /\r\n|\r|\n/;
/** Paragraph-like characters that a text write still refuses. */
const UNSUPPORTED_BREAK_IN_TEXT = /[\f\u2028\u2029]/;

/** What the planner lends this lane. */
export interface ParagraphBreakPlanning {
  readonly handles: AutomationHandleTable;
  readonly reads: AutomationPackageReads;
  /**
   * Plans the write of the text without its breaks. The write claims its paragraphs for itself,
   * because a split cannot compose with other text edits in the same paragraph.
   */
  readonly planJoined: (operation: AutomationOperation) => PlannedOperation;
  /**
   * Reserves `count` created paragraphs directly after `paragraphId`, in reading order, in the
   * story the joined write pinned. Null when that story does not hold the paragraph.
   */
  readonly reserve: (
    paragraphId: string,
    count: number
  ) => readonly { readonly id: string | null }[] | null;
  /** The runtime author when the write is tracked. */
  readonly trackingAuthor?: string;
}

/**
 * Whether text written at `offset` lands inside a content control that sits within the
 * paragraph. Splitting one would leave two controls with one `w:id`, so the write refuses. A
 * block-level control around the paragraph holds the new paragraphs and is not split.
 */
function splitsInlineControl(story: AutomationStoryReads, paragraphId: string, offset: number) {
  const paragraph = findNode(story.part, paragraphId);
  if (!isParagraph(paragraph)) return false;
  const control = contentControlAtCaret(story.part, paragraph, offset, offset);
  return control !== null && findContentControl(paragraph, control.id) !== null;
}

const refuse = (message: string, detail: string): PlannedOperation => ({
  ok: false,
  error: { code: 'unsupported-content', message, detail },
});

/**
 * A text write that holds paragraph breaks, planned as the plain-text paste does it: the text
 * without its breaks goes in first, and one `splitParagraphMany` then cuts the paragraph at each
 * break. Each new paragraph clones the paragraph properties of the paragraph it came from, so a
 * list item stays in its list.
 *
 * Tracked, the split carries the same revision as the inserted text, and the store stamps a
 * `w:rPr/w:ins` on every paragraph mark it adds. Rejecting the change joins the paragraphs again.
 *
 * Answers a range from the first written character to the end of the last written segment, in
 * the last new paragraph. Returns null for an operation this lane does not own.
 */
export function planParagraphBreaks(
  operation: AutomationOperation,
  planning: ParagraphBreakPlanning
): PlannedOperation | null {
  if (operation.op !== 'insertText' && operation.op !== 'replaceSpan') return null;
  const { text } = operation;
  if (typeof text !== 'string' || !PARAGRAPH_BREAK_IN_TEXT.test(text)) return null;
  if (UNSUPPORTED_BREAK_IN_TEXT.test(text))
    return refuse(
      'text carrying a paragraph mark is not written by this host',
      'paragraph-mark-in-text'
    );
  const segments = text.split(PARAGRAPH_BREAK);
  const planned = planning.planJoined({ ...operation, text: segments.join('') });
  if (!planned.ok || planned.kind !== 'command') return planned;
  if (planned.lifecycle || planned.relate || planned.packageEdits?.length)
    return refuse('that write cannot also split its paragraph', 'paragraph-break');

  // WHERE THE TEXT LANDED, as the write itself answers it. A tracked write lands after struck
  // text, so the planner's own answer is the only place that rule is not restated.
  const answered = planned.answer(planning.reads);
  if (answered.kind !== 'span')
    return refuse('that write does not name where its text lands', 'paragraph-break');
  // The start only: the end names text the write has not added yet.
  const { start } = answered.span;
  const landed = resolveSpanRef({ start, end: start }, planning.handles, planning.reads);
  if (!landed.ok || !landed.value)
    return refuse('that write does not name where its text lands', 'paragraph-break');
  const head = landed.value.start;
  const story = planning.reads.story(head.story);
  if (!story) return refuse('that story is not in this document', 'paragraph-break');

  if (splitsInlineControl(story, head.paragraphId, head.offset))
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message: 'a paragraph break cannot split an inline content control',
        detail: 'indivisible-content',
      },
    };

  const offsets: number[] = [];
  let at = head.offset;
  for (const segment of segments.slice(0, -1)) {
    at += segment.length;
    offsets.push(at);
  }
  const created = planning.reserve(head.paragraphId, offsets.length);
  if (!created) return refuse('that paragraph is not in this story', 'paragraph-break');

  const written = planned.ops.find(
    (op): op is Extract<TreeDocOp, { op: 'insertText' }> =>
      op.op === 'insertText' && op.revision !== undefined
  );
  const revision = planning.trackingAuthor
    ? (written?.revision ?? { author: planning.trackingAuthor.trim(), date: revisionDateNow() })
    : undefined;
  const split: TreeDocOp = {
    op: 'splitParagraphMany',
    paragraphId: head.paragraphId,
    offsets,
    ...(revision ? { revision } : {}),
  };
  const tail = segments[segments.length - 1]!;
  return {
    ...planned,
    ops: [...planned.ops, split],
    answer: (): AutomationValue => {
      const last = created[created.length - 1]?.id;
      if (!last) return { kind: 'applied' };
      return {
        kind: 'span',
        span: {
          start: {
            paragraph: planning.handles.paragraph(head.paragraphId, story.story),
            offset: head.offset,
          },
          end: { paragraph: planning.handles.paragraph(last, story.story), offset: tail.length },
        },
      };
    },
  };
}
