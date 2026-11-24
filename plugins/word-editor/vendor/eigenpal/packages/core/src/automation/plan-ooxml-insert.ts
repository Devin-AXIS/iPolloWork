// `Range.insertOoxml`: insert the one equation a Flat OPC package holds.
//
// The OOXML is caller data. `readEquationSnippet` reads it through the bounded reader and an
// allowlist (`equation-snippet.ts`) and answers canonical nodes, or a typed refusal. Every
// input outside that shape refuses; no part of it is inserted, approximated, or fetched.
// Placement is the one a field insertion uses (`plan-inline-insert.ts`). Under
// `TrackMineOnly` the equation and its runs go into one `w:ins` by the runtime author.

import { readEquationSnippet } from '../store/store/equation-snippet.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { planInlineInsertPlacement } from './plan-inline-insert.ts';
import { resolveSpanRef, storyOfSpanRef } from './spans.ts';

type InsertOoxmlOperation = Extract<AutomationOperation, { op: 'insertOoxml' }>;

const refuse = (code: AutomationErrorCode, message: string, detail?: string): PlannedOperation => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
});

export function planOoxmlInsert(
  operation: InsertOoxmlOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null,
  trackingAuthor?: string
): PlannedOperation {
  const read = readEquationSnippet(operation.ooxml);
  if (!read.ok) {
    if (read.reason === 'resource-limit')
      return refuse('unsupported-content', 'the OOXML is too large or too deep', 'resource-limit');
    return read.reason === 'ooxml-invalid'
      ? refuse(
          'unsupported-content',
          'the OOXML is not well-formed or names no namespace',
          'invalidArgs'
        )
      : refuse(
          'unsupported-capability',
          'insertOoxml inserts one paragraph that holds one inline equation and plain runs',
          'ooxml-unsupported'
        );
  }
  const range = resolveSpanRef(operation.span, handles, reads);
  const storyResult = storyOfSpanRef(operation.span, handles, reads);
  if (!range.ok || !storyResult.ok)
    return refuse(
      'invalid-handle',
      'that range no longer exists',
      !range.ok ? range.detail : !storyResult.ok ? storyResult.detail : undefined
    );
  if (!range.value) return refuse('unsupported-content', 'insert a paragraph before an equation');
  const story = storyResult.value;
  const placement = planInlineInsertPlacement(
    'equation',
    operation.location,
    range.value,
    story,
    claim,
    trackingAuthor
  );
  if ('ok' in placement) return placement;
  const { paragraphId, at, revision } = placement;
  const { nodes, length } = read.snippet;
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops: [
      ...placement.ops,
      {
        op: 'insertEquation',
        paragraphId,
        offset: at,
        nodes,
        length,
        ...(revision ? { revision } : {}),
      },
    ],
    answer: () => ({
      kind: 'span',
      span: {
        start: { paragraph: handles.paragraph(paragraphId, story.story), offset: at },
        end: { paragraph: handles.paragraph(paragraphId, story.story), offset: at + length },
      },
    }),
  };
}
