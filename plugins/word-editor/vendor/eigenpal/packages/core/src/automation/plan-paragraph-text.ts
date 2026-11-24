// Planning the two paragraph-text reads that let a client keep its own marks on a paragraph,
// such as proofing annotations: `getParagraphTextIfPresent` and `getParagraphTextSpan`.
//
// A GONE PARAGRAPH IS AN ANSWER. A client that placed marks on many paragraphs checks each of
// them again later. A paragraph that an edit removed answers no text instead of refusing, so
// one removed paragraph does not refuse the reads of every other one in the batch.
//
// VIEW OFFSETS MAP TO ONE MODEL RANGE. The client counts in the text a view shows, which can
// differ from the model offsets every endpoint uses: an expanded field result, a floating
// drawing, a hidden insertion. The span maps through the same projection the text read uses,
// so a range of that text always names the model range that shows it.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation, AutomationTextProjection } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads } from './reads.ts';
import { resolveParagraphHandle, spanValue } from './spans.ts';

type ParagraphTextOperation = Extract<
  AutomationOperation,
  { op: 'getParagraphTextIfPresent' | 'getParagraphTextSpan' }
>;

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    error: detail === undefined ? { code, message } : { code, message, detail },
  };
}

function isProjection(value: unknown): value is AutomationTextProjection | undefined {
  return value === undefined || value === 'allMarkup' || value === 'original' || value === 'model';
}

/** Plan one paragraph-text read against the batch snapshot. */
export function planParagraphText(
  operation: ParagraphTextOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): PlannedOperation {
  if (!isProjection(operation.projection))
    return refuse('unsupported-content', 'unknown text projection', 'projection');
  const projection = operation.projection ?? 'allMarkup';
  if (operation.op === 'getParagraphTextIfPresent') {
    const target = handles.resolve(operation.paragraph, 'paragraph');
    if (!target || target.kind !== 'paragraph')
      return refuse(
        'invalid-handle',
        'that handle does not name a paragraph',
        'not-a-paragraph-handle'
      );
    const story = reads.story(target.story);
    const text = story?.has(target.paragraphId)
      ? story.paragraphText(target.paragraphId, projection)
      : null;
    return {
      ok: true,
      kind: 'query',
      value: { kind: 'texts', texts: text === null ? [] : [text] },
    };
  }

  const paragraph = resolveParagraphHandle(operation.paragraph, handles, reads);
  if (!paragraph.ok)
    return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
  const { story: storyId, paragraphId } = paragraph.value;
  const projected = reads.story(storyId)?.projectedText(paragraphId, projection) ?? null;
  const { start, length } = operation;
  const end = start + length;
  if (
    !projected ||
    !Number.isInteger(start) ||
    !Number.isInteger(length) ||
    start < 0 ||
    length < 1 ||
    end > projected.text.length
  )
    return refuse('invalid-offset', 'that range is not inside the paragraph text', 'range');
  const raw = projected.rawRange(start, end);
  if (!raw) return refuse('invalid-offset', 'that range shows no model text', 'range');
  return {
    ok: true,
    kind: 'query',
    value: {
      kind: 'span',
      span: spanValue(
        {
          start: { ...paragraph.value, offset: raw.start },
          end: { ...paragraph.value, offset: raw.end },
        },
        handles
      ),
    },
  };
}
