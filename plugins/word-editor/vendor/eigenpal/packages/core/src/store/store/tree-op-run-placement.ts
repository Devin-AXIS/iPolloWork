// Place complete run-level nodes (runs, an `m:oMath`) at an offset, untracked.
//
// The landing place is the one typed text takes (`insertionDestination`), so the nodes go
// inside a link, a content control, or a pending insertion exactly where a typed character
// would. Typed text joins a run; whole nodes go beside it instead, and a run that holds the
// offset is split in two around them. Struck text is never a landing place: the nodes go after
// the deletion that holds the offset, as typed text does.

import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import { inlineContainersOf, ok, parentOf, TEXT_DEPS } from './tree-op-nodes.ts';
import { insertionDestination, paragraphOffsetIndex } from './tree-op-segments.ts';
import { copy, splitRun } from './tree-op-tracked.ts';
import type { TreeOpResult } from './tree-op-types.ts';

const isDeletion = (node: OoxmlNode): boolean =>
  node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom';

const hasContent = (run: OoxmlNode): boolean =>
  run.kind !== 'textValue' && run.children.some((child) => child.kind !== 'runProperties');

interface Placement {
  readonly holder: OoxmlElement;
  /** Index in `holder.children` the nodes go before, after `replace` is applied. */
  readonly index: number;
  /** A run to replace with its two halves; the nodes go between them. */
  readonly split?: { readonly run: OoxmlNode; readonly halves: readonly OoxmlNode[] };
}

function placementOf(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  mint: () => string
): Placement | null {
  const { site, landingNodeId } = insertionDestination(paragraph, offset, null);
  // Never inside struck content: after the outermost deletion around the landing place.
  const deletion = inlineContainersOf(paragraph, landingNodeId).filter(isDeletion).at(-1);
  if (deletion) {
    const holder = parentOf(part, deletion.id);
    if (!holder) return null;
    return { holder, index: holder.children.findIndex((node) => node.id === deletion.id) + 1 };
  }
  if (site.kind === 'newRun') {
    return { holder: site.holder, index: site.index ?? site.holder.children.length };
  }
  const run =
    site.kind === 'appendToRun' || site.kind === 'atRunIndex'
      ? site.run
      : findNode(part, site.segment.runId);
  if (!run || run.kind === 'textValue') return null;
  const holder = parentOf(part, run.id);
  if (!holder) return null;
  const at = holder.children.findIndex((node) => node.id === run.id);
  if (site.kind === 'appendToRun') return { holder, index: at + 1 };
  if (run.kind !== 'run') return { holder, index: at };
  let halves: OoxmlNode[];
  if (site.kind === 'atRunIndex') {
    const properties = run.children.filter((child) => child.kind === 'runProperties');
    const content = run.children.filter((child) => child.kind !== 'runProperties');
    const cut = site.index - (run.children.length - content.length);
    halves = [
      { ...run, id: mint(), children: [...properties, ...content.slice(0, Math.max(0, cut))] },
      {
        ...run,
        id: mint(),
        children: [
          ...properties.map((child) => copy(mint, child)),
          ...content.slice(Math.max(0, cut)),
        ],
      },
    ] as OoxmlNode[];
  } else {
    const offsets = paragraphOffsetIndex(paragraph);
    const span = offsets.spanOf(run);
    if (!span) return null;
    halves = splitRun(mint, offsets, run, offset - span.start);
  }
  const [head, tail] = halves;
  if (!hasContent(head!)) return { holder, index: at };
  if (!hasContent(tail!)) return { holder, index: at + 1 };
  return { holder, index: at + 1, split: { run, halves } };
}

/** Insert `nodes`, with fresh ids, at `offset`. */
export function applyPlaceRunNodes(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  nodes: readonly OoxmlNode[],
  options?: EditOptions,
  preserveSubtrees?: ReadonlySet<string>
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  const placement = placementOf(part, paragraph, offset, mint);
  if (!placement) return { ok: false, reason: 'tree-invariant' };
  const { holder, index, split } = placement;
  const clone = (node: OoxmlNode): OoxmlNode => {
    if (preserveSubtrees?.has(node.id)) return node;
    if (!preserveSubtrees) return copy(mint, node);
    return node.kind === 'textValue'
      ? { ...node, id: mint() }
      : ({ ...node, id: mint(), children: node.children.map(clone) } as OoxmlNode);
  };
  const placed = nodes.map(clone);
  const children: OoxmlNode[] = [];
  for (const child of holder.children) {
    children.push(split && child.id === split.run.id ? split.halves[0]! : child);
  }
  const tail = split ? [split.halves[1]!] : [];
  const next = [...children.slice(0, index), ...placed, ...tail, ...children.slice(index)];
  const replaced = replaceChildren(part, holder.id, next, options);
  if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
  return ok(replaced.part, {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  });
}
