// Shared drawing walks for anchor collection and UTF-16 model positions.
// Visibility affects published anchors, never the canonical model's offsets.

import {
  isRunLevelMcAlternateContent,
  type DrawingProjection,
} from '../store/package/drawing-projection.ts';
import { isLegacyVmlAtom } from '../store/package/legacy-vml-projection.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { walkDrawingAtoms, walkDrawingRunContent } from './drawing-inline-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { runPropertiesOf } from './field-run-text.ts';
import { resolveRunStyle } from './run-style.ts';
import {
  NO_REVISIONS,
  isRevisionWrapper,
  revisionAttributionOf,
  withRevision,
  type RevisionAttribution,
} from './revision-projection.ts';

const directRunHidden = new WeakMap<OoxmlNode, boolean>();

function isDirectlyHiddenRun(node: OoxmlNode): boolean {
  if (node.kind !== 'run') return false;
  let hidden = directRunHidden.get(node);
  if (hidden === undefined) {
    // This context has no style-cascade reader. Match the shared direct-property
    // resolver, including explicit w:vanish w:val="0", without guessing inheritance.
    hidden = resolveRunStyle(runPropertiesOf(node, [])).hidden;
    directRunHidden.set(node, hidden);
  }
  return hidden;
}

/** Run-level drawing / MC atoms carrying anchored projections in one paragraph. */
export function anchoredDrawingAtomsInParagraph(
  paragraph: OoxmlNode,
  context: InlineDrawingLayoutContext
): readonly {
  readonly atomId: string;
  readonly projection: DrawingProjection;
  /** Enclosing revision wrappers, outermost first — the stack spans carry (see #479). */
  readonly revisions: readonly RevisionAttribution[];
}[] {
  if (paragraph.kind !== 'paragraph') return [];
  const atoms: {
    atomId: string;
    projection: DrawingProjection;
    revisions: readonly RevisionAttribution[];
  }[] = [];
  walkDrawingAtoms(paragraph, (node, containers, run) => {
    let revisions: readonly RevisionAttribution[] = NO_REVISIONS;
    for (const container of containers) {
      const attribution = isRevisionWrapper(container) ? revisionAttributionOf(container) : null;
      if (attribution) revisions = withRevision(revisions, attribution);
    }
    if (node.kind === 'drawing') {
      const projection =
        context.projectionForAtom?.(node.id) ??
        context.project(node as import('../store/package/ooxml-tree.ts').OoxmlDrawingNode);
      if (projection?.kind === 'anchored') atoms.push({ atomId: node.id, projection, revisions });
      return;
    }
    if (isRunLevelMcAlternateContent(node) || isLegacyVmlAtom(node)) {
      // Main's VML visibility rule still applies beneath transparent inline wrappers.
      if (isLegacyVmlAtom(node) && isDirectlyHiddenRun(run)) return;
      const projection = context.projectionForAtom?.(node.id) ?? null;
      if (projection?.kind === 'anchored') atoms.push({ atomId: node.id, projection, revisions });
    }
  });
  return Object.freeze(atoms);
}

const drawingOffsetMemos = new WeakMap<OoxmlNode, ReadonlyMap<string, number>>();

export function drawingModelOffsetsInParagraph(paragraph: OoxmlNode): ReadonlyMap<string, number> {
  // Asked once per placed line of a paragraph, and a node never changes: one walk per node.
  const known = drawingOffsetMemos.get(paragraph);
  if (known) return known;
  const offsets = new Map<string, number>();
  if (paragraph.kind !== 'paragraph') return offsets;
  // The shared paragraph index counts breaks, tabs, wrappers, and every modeled atom.
  // Allocate it only for paragraphs that contain drawings.
  let index: ReturnType<typeof paragraphOffsetIndex> | undefined;
  walkDrawingRunContent(paragraph, (node) => {
    if (node.kind !== 'drawing' && !isRunLevelMcAlternateContent(node) && !isLegacyVmlAtom(node))
      return;
    const span = (index ??= paragraphOffsetIndex(paragraph)).spanOf(node);
    if (span) offsets.set(node.id, span.start);
  });
  const answer = offsets.size === 0 ? NO_DRAWING_OFFSETS : offsets;
  drawingOffsetMemos.set(paragraph, answer);
  return answer;
}

/** Shared by every paragraph without drawings, so the memo holds no map per paragraph. */
const NO_DRAWING_OFFSETS: ReadonlyMap<string, number> = new Map();
