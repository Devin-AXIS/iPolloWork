// Planning content-control reads scoped to a span: `Range.contentControls` and
// `Paragraph.contentControls`, and the `getById`/`getByTag`/`getByTitle` lookups on them.
//
// A SPAN ANSWERS EVERY CONTROL IT OVERLAPS, at any nesting depth, in document order: a block
// control that holds one of the span's paragraphs, and an inline control whose content shares at
// least one character with the span. A control that holds the whole span is included, so a word
// range inside a locked control reports that control. An empty span, or an empty control, counts
// when one lies at or inside the other's edges.

import {
  contentControlPropertiesOf,
  contentControlsIn,
} from '../store/package/content-control-nodes.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { paragraphsHeldBy } from './content-controls.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation, AutomationSpanRef } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { resolveSpanRef, spanOffsets, storyOfSpanRef, type ResolvedSpan } from './spans.ts';

type SpanControlOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getContentControls'
      | 'getContentControlById'
      | 'getContentControlsByTag'
      | 'getContentControlsByTitle';
  }
> & { readonly scope: { readonly span: AutomationSpanRef } };

/** Most controls one span answers, like any other scope. */
const MAX_CONTROLS_PER_SPAN = 10_000;

/** Whether an operation is a content-control read scoped to a span. */
export function isSpanControlOperation(
  operation: AutomationOperation
): operation is SpanControlOperation {
  return (
    (operation.op === 'getContentControls' ||
      operation.op === 'getContentControlById' ||
      operation.op === 'getContentControlsByTag' ||
      operation.op === 'getContentControlsByTitle') &&
    typeof operation.scope === 'object' &&
    operation.scope !== null &&
    'span' in operation.scope
  );
}

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    error: detail === undefined ? { code, message } : { code, message, detail },
  };
}

/** Block controls of one story by the paragraphs they hold, outermost first. Built once. */
const blockControlsByRoot = new WeakMap<OoxmlNode, ReadonlyMap<string, readonly OoxmlNode[]>>();

function blockControlsOf(reads: AutomationStoryReads): ReadonlyMap<string, readonly OoxmlNode[]> {
  const cached = blockControlsByRoot.get(reads.root);
  if (cached) return cached;
  const byParagraph = new Map<string, OoxmlNode[]>();
  // `contentControlsIn` walks in document order, so an outer control precedes its inner ones.
  for (const entry of contentControlsIn(reads.root)) {
    for (const paragraphId of paragraphsHeldBy(entry.node)) {
      const list = byParagraph.get(paragraphId);
      if (list) list.push(entry.node);
      else byParagraph.set(paragraphId, [entry.node]);
    }
  }
  blockControlsByRoot.set(reads.root, byParagraph);
  return byParagraph;
}

/** Whether `[start, end)` and `[from, to)` share a character, or an empty one touches the other. */
function overlaps(start: number, end: number, from: number, to: number): boolean {
  if (start === end || from === to) return from <= end && start <= to;
  return Math.max(start, from) < Math.min(end, to);
}

/** Every control a span overlaps, in document order. */
export function contentControlsInSpan(
  span: ResolvedSpan,
  reads: AutomationStoryReads
): readonly OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const seen = new Set<string>();
  const add = (node: OoxmlNode): void => {
    if (seen.has(node.id) || found.length >= MAX_CONTROLS_PER_SPAN) return;
    seen.add(node.id);
    found.push(node);
  };
  const blocks = blockControlsOf(reads);
  for (const piece of spanOffsets(span, reads)) {
    for (const control of blocks.get(piece.paragraphId) ?? []) add(control);
    const paragraph = reads.node(piece.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    const index = paragraphOffsetIndex(paragraph);
    for (const entry of contentControlsIn(paragraph)) {
      const at = index.spanOf(entry.node);
      if (at && overlaps(piece.start, piece.end, at.start, at.end)) add(entry.node);
    }
  }
  return found;
}

/** Plan one span-scoped content-control read. */
export function planSpanControls(
  operation: SpanControlOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): PlannedOperation {
  const resolved = resolveSpanRef(operation.scope.span, handles, reads);
  if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
  const story = storyOfSpanRef(operation.scope.span, handles, reads);
  if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
  const controls = contentControlsInSpan(resolved.value, story.value);
  const handleOf = (node: OoxmlNode) => handles.contentControl(node.id, story.value.story);
  switch (operation.op) {
    case 'getContentControls':
      return {
        ok: true,
        kind: 'query',
        value: { kind: 'handles', handles: controls.map(handleOf) },
      };
    case 'getContentControlById': {
      if (!Number.isInteger(operation.id))
        return refuse(
          'unsupported-content',
          'a control id is a whole number',
          String(operation.id)
        );
      const match = controls.find((node) => contentControlPropertiesOf(node).id === operation.id);
      if (!match)
        return refuse(
          'invalid-handle',
          'no control in that scope carries that id',
          String(operation.id)
        );
      return { ok: true, kind: 'query', value: { kind: 'handle', handle: handleOf(match) } };
    }
    default: {
      const byTag = operation.op === 'getContentControlsByTag';
      const wanted = byTag ? operation.tag : operation.title;
      if (typeof wanted !== 'string' || wanted.length === 0)
        return refuse('unsupported-content', 'a tag or title to match is required', operation.op);
      const matches = controls.filter((node) => {
        const properties = contentControlPropertiesOf(node);
        return (byTag ? properties.tag : properties.alias) === wanted;
      });
      return {
        ok: true,
        kind: 'query',
        value: { kind: 'handles', handles: matches.map(handleOf) },
      };
    }
  }
}
