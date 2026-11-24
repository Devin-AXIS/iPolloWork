// Run splitting at a model offset, shared by formatting, comments and content-control inserts.

import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { textElement } from './tree-op-inline-elements.ts';
import {
  cloneWithNewIds,
  isRunPropertiesNode,
  parentOf,
  runPropertiesNodeOf,
} from './tree-op-nodes.ts';
import { segmentsOf, type Segment } from './tree-op-segments.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

export function runElement(nextId: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

export function contains(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => contains(child, id));
}

/** Whether the element holding a text value is a `w:t` or a `w:delText`. */
export function textKindOfValue(root: OoxmlNode, valueId: string): 'text' | 'deletedText' {
  const walk = (node: OoxmlNode): 'text' | 'deletedText' | null => {
    if (node.kind === 'textValue') return null;
    if (
      (node.kind === 'text' || node.kind === 'deletedText') &&
      node.children.some((child) => child.id === valueId)
    ) {
      return node.kind;
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root) ?? 'text';
}

interface RunSpan {
  readonly runId: string;
  readonly start: number;
  end: number;
  /** The run's first and last segment indexes. */
  readonly first: number;
  last: number;
}

interface RunSpans {
  /** In order of each run's first segment. */
  readonly spans: readonly RunSpan[];
  /** Each span starts at or after the previous one's end, so a binary search finds the one. */
  readonly ordered: boolean;
}

/**
 * Keyed by the segment array, which `segmentsOf` memoizes by paragraph identity and carries
 * across a run-property write: a formatting press splits twice per run it covers, and
 * rebuilding the spans for every split cost the paragraph's length each time.
 */
const runSpansCache = new WeakMap<readonly Segment[], RunSpans>();

function runSpansOf(segments: readonly Segment[]): RunSpans {
  const cached = runSpansCache.get(segments);
  if (cached) return cached;
  // A run's span is its first segment's start to its last segment's end.
  const byRun = new Map<string, RunSpan>();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    // Simple fields are paragraph children: their atom has no owning run. Grouping
    // their empty run IDs invents one run spanning every simple field, then attempts
    // to split that nonexistent run at an otherwise valid boundary between fields.
    if (!segment.runId) continue;
    const span = byRun.get(segment.runId);
    if (span) {
      span.end = segment.end;
      span.last = index;
    } else
      byRun.set(segment.runId, {
        runId: segment.runId,
        start: segment.start,
        end: segment.end,
        first: index,
        last: index,
      });
  }
  const spans = [...byRun.values()];
  let ordered = true;
  for (let index = 1; index < spans.length && ordered; index += 1) {
    if (spans[index]!.start < spans[index - 1]!.end) ordered = false;
  }
  const result = { spans, ordered };
  runSpansCache.set(segments, result);
  return result;
}

/** The first run, in first-segment order, whose span holds `offset` strictly inside it. */
function straddlingRun(segments: readonly Segment[], offset: number): RunSpan | undefined {
  const { spans, ordered } = runSpansOf(segments);
  if (!ordered) {
    for (const span of spans) if (span.start < offset && span.end > offset) return span;
    return undefined;
  }
  // Disjoint and sorted: only the last span starting before `offset` can hold it.
  let low = 0;
  let high = spans.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (spans[middle]!.start < offset) {
      candidate = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const span = candidate >= 0 ? spans[candidate]! : undefined;
  return span && span.end > offset ? span : undefined;
}

/** Divide any run straddling `offset` so the offset falls on a run boundary. */
export function splitRunsAt(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  options?: EditOptions
): { ok: true; part: OoxmlPart } | { ok: false; reason: TreeOpRejection; detail?: string } {
  const segments = segmentsOf(paragraph);
  // The run the offset falls INSIDE, wherever inside: looking only for a straddling TEXT
  // VALUE missed every boundary between two of a run's own children. A `w:tab` and a
  // `w:br` each measure one character, so `<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r>`
  // has edges at 1 and 2 that no text value straddles — the run was left whole, the range
  // then matched it through the tab's segment, and formatting the tab alone bolded all
  // three characters.
  const straddling = straddlingRun(segments, offset);
  if (straddling === undefined) return { ok: true, part };
  const run = findNode(part, straddling.runId);
  if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
  const nextId = createNodeIdAllocator(part);
  const rPr = runPropertiesNodeOf(run);
  const headContent: OoxmlNode[] = [];
  const tailContent: OoxmlNode[] = [];
  // Only the run's own index range: a split must not scan the whole paragraph.
  const ownSegments = segments
    .slice(straddling.first, straddling.last + 1)
    .filter((segment) => segment.runId === run.id);
  for (const child of run.children) {
    if (isRunPropertiesNode(child)) continue;
    const segment = ownSegments.find((candidate) => contains(child, candidate.node.id));
    if (!segment) {
      headContent.push(child);
      continue;
    }
    if (segment.end <= offset) headContent.push(child);
    else if (segment.start >= offset) tailContent.push(child);
    else if (segment.node.kind === 'textValue') {
      const local = offset - segment.start;
      const splitKind = textKindOfValue(child, segment.node.id);
      headContent.push(textElement(nextId, segment.node.value.slice(0, local), splitKind));
      tailContent.push(textElement(nextId, segment.node.value.slice(local), splitKind));
    } else headContent.push(child);
  }
  const head = runElement(nextId, rPr ? [rPr, ...headContent] : headContent);
  const tail = runElement(
    nextId,
    rPr ? [cloneWithNewIds(rPr, nextId), ...tailContent] : tailContent
  );
  const parent = parentOf(part, run.id);
  if (!parent) return { ok: false, reason: 'tree-invariant' };
  const rebuilt = parent.children.flatMap((child) =>
    child.id === run.id ? [head, tail] : [child]
  );
  const replaced = replaceChildren(part, parent.id, rebuilt, options);
  if (!replaced.ok)
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(replaced.issues) };
  return { ok: true, part: replaced.part };
}
