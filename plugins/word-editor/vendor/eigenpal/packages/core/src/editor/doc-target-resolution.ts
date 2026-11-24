// Public DocTarget resolution for explicit editor commands.

import type {
  DocAnchor,
  DocLocation,
  DocRange,
  DocTarget,
  ExecErrorCode,
} from '../contracts/types.ts';
import type { SemanticSelection } from '../layout/semantic-interaction.ts';
import {
  bodyStoryRoot,
  contentControlContentChildren,
  findNode,
  isContentControlNode,
  noteIdOf,
  paragraphTextOf,
  storyRootsOf,
  type OoxmlElement,
} from '../store/index.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { isDocAnchor, resolveDocAnchor } from './anchor-resolution.ts';
import { storyScopeOfNodeId } from './surface-scope.ts';

type Resolution =
  | { readonly ok: true; readonly selection: SemanticSelection }
  | { readonly ok: false; readonly code: ExecErrorCode; readonly reason: string };

function isLocation(value: unknown): value is DocLocation {
  return (
    typeof value === 'object' &&
    value !== null &&
    'container' in value &&
    Array.isArray((value as DocLocation).path)
  );
}

function isRange(value: unknown): value is DocRange {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value;
}

function directBlocks(element: OoxmlElement): OoxmlElement[] {
  return directBlocksFrom(element.children);
}

function directBlocksFrom(
  children: readonly import('../store/index.ts').OoxmlNode[]
): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  for (const child of children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraph' || child.kind === 'table' || isContentControlNode(child)) {
      blocks.push(child);
    }
  }
  return blocks;
}

function nestedBlocks(node: OoxmlElement): OoxmlElement[] {
  if (isContentControlNode(node)) return directBlocksFrom(contentControlContentChildren(node));
  if (node.kind !== 'table') return [];
  const blocks: OoxmlElement[] = [];
  for (const row of node.children) {
    if (row.kind !== 'tableRow') continue;
    for (const cell of row.children) {
      if (cell.kind === 'tableCell') blocks.push(...directBlocks(cell));
    }
  }
  return blocks;
}

function locationPoint(
  surface: PaginatedSurface,
  location: DocLocation,
  edge: 'start' | 'end'
): Resolution {
  const container = location.container;
  const scope =
    container.part === 'body'
      ? ({ kind: 'body' } as const)
      : container.part === 'header' || container.part === 'footer'
        ? ({ kind: 'headerFooter', rId: container.rId } as const)
        : ({
            kind: 'notesPart',
            noteKind: container.part === 'footnote' ? 'footnote' : 'endnote',
          } as const);
  const part = surface.session.partFor(scope);
  if (!part) return { ok: false, code: 'notFound', reason: 'the target story was not found' };
  const targetNoteId = 'noteId' in container ? container.noteId : null;
  const root =
    container.part === 'body'
      ? bodyStoryRoot(part)
      : storyRootsOf(part).find((story) => {
          if (container.part === 'header' || container.part === 'footer') {
            return story.kind === container.part;
          }
          return story.kind === 'note' && noteIdOf(story.root) === targetNoteId;
        })?.root;
  if (!root || root.kind === 'textValue') {
    return { ok: false, code: 'notFound', reason: 'the target story was not found' };
  }
  if (location.path.length === 0) {
    return { ok: false, code: 'invalidArgs', reason: 'DocLocation path must not be empty' };
  }
  let blocks = directBlocks(root);
  let node: OoxmlElement | undefined;
  for (let depth = 0; depth < location.path.length; depth += 1) {
    const index = location.path[depth]!;
    if (!Number.isInteger(index) || index < 0) {
      return { ok: false, code: 'invalidArgs', reason: 'DocLocation indices must be non-negative' };
    }
    node = blocks[index];
    if (!node)
      return { ok: false, code: 'notFound', reason: `block index ${index} is out of range` };
    if (depth < location.path.length - 1) blocks = nestedBlocks(node);
  }
  if (!node || node.kind !== 'paragraph' || !findNode(part, node.id)) {
    return { ok: false, code: 'invalidArgs', reason: 'DocLocation must resolve to a paragraph' };
  }
  const length = (paragraphTextOf(part, node.id) ?? '').length;
  const offset = location.offset ?? (edge === 'start' ? 0 : length);
  if (!Number.isInteger(offset) || offset < 0 || offset > length) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'DocLocation offset is outside the paragraph',
    };
  }
  const point = { paragraphId: node.id, offset };
  return { ok: true, selection: { anchor: point, head: point } };
}

function endpoint(
  surface: PaginatedSurface,
  value: DocAnchor | DocLocation,
  edge: 'start' | 'end'
): Resolution {
  if (isLocation(value)) return locationPoint(surface, value, edge);
  if (!isDocAnchor(value)) {
    return { ok: false, code: 'invalidArgs', reason: 'unrecognized DocTarget endpoint' };
  }
  const anchors = surface.session.paragraphAnchors();
  const nodeId = anchors.nodeByParaId.get(value.paraId.toUpperCase());
  if (!nodeId) return { ok: false, code: 'notFound', reason: 'the paragraph was not found' };
  const scope = storyScopeOfNodeId(surface.session, nodeId, { kind: 'body' });
  const part = surface.session.partFor(scope);
  if (!part) return { ok: false, code: 'notFound', reason: 'the target story was not found' };
  const resolved = resolveDocAnchor(part, anchors, value);
  if (!resolved.ok) return resolved;
  const offset = edge === 'start' ? resolved.span.start : resolved.span.end;
  const point = { paragraphId: resolved.span.nodeId, offset };
  return { ok: true, selection: { anchor: point, head: point } };
}

/** Resolve a DocTarget to one concrete selection without changing the surface. */
export function resolveDocTargetSelection(
  surface: PaginatedSurface,
  target: DocTarget
): Resolution {
  if (!isRange(target)) {
    const start = endpoint(surface, target, 'start');
    if (!start.ok) return start;
    const end = endpoint(surface, target, 'end');
    if (!end.ok) return end;
    return {
      ok: true,
      selection: { anchor: start.selection.anchor, head: end.selection.head },
    };
  }
  const from = endpoint(surface, target.from, 'start');
  if (!from.ok) return from;
  const to = endpoint(surface, target.to, 'end');
  if (!to.ok) return to;
  return { ok: true, selection: { anchor: from.selection.anchor, head: to.selection.head } };
}
