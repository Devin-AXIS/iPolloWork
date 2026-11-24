// Shared UTF-16 offset insertion for run-level content (text, drawings, tabs, …).
//
// Split out of tree-op-apply so drawing insertion can share the same canonical run split
// without importing tree-op-apply (which imports tree-op-drawings).

import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  replaceChildren,
  type EditOptions,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { insertionSite, segmentsOf } from './tree-op-segments.ts';

function contains(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => contains(child, id));
}

function findTextContainer(paragraph: OoxmlParagraphNode, valueId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (
      (node.kind === 'text' || node.kind === 'deletedText') &&
      node.children.some((child) => child.id === valueId)
    ) {
      return node;
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(paragraph);
}

function textElement(
  nextId: () => string,
  text: string,
  kind: 'text' | 'deletedText' = 'text'
): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName: kind === 'deletedText' ? 'delText' : 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

function runElement(nextId: () => string, children: readonly OoxmlNode[]): OoxmlNode {
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

/** Insert one or more run children at a UTF-16 offset, splitting text when needed. */
export function insertRunPayloadAtOffset(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  payload: readonly OoxmlNode[],
  options?: EditOptions,
  bias?: 'left' | 'right'
): OoxmlEditResult {
  const nextId = createNodeIdAllocator(part);
  const site = insertionSite(paragraph, offset, null, bias);

  if (site.kind === 'withinValue') {
    const segment = site.segment;
    if (segment.node.kind !== 'textValue') {
      return { ok: false, issues: [{ code: 'known-node-invariant', path: 'text-value' }] };
    }
    const local = offset - segment.start;
    const value = segment.node.value;
    const textNode = findTextContainer(paragraph, segment.node.id);
    if (!textNode) {
      return {
        ok: false,
        issues: [
          { code: 'known-node-invariant', path: 'orphan-text-value', nodeId: segment.node.id },
        ],
      };
    }
    const run = findNode(part, segment.runId);
    if (!run || run.kind !== 'run') {
      return {
        ok: false,
        issues: [{ code: 'known-node-invariant', path: 'missing-run', nodeId: segment.runId }],
      };
    }
    const kind = textNode.kind === 'deletedText' ? 'deletedText' : 'text';
    const head = textElement(nextId, value.slice(0, local), kind);
    const tail = textElement(nextId, value.slice(local), kind);
    const rebuilt = run.children.flatMap((child) =>
      child.id === textNode.id ? [head, ...payload, tail] : [child]
    );
    return replaceChildren(part, run.id, rebuilt, options);
  }

  if (site.kind === 'atBoundary') {
    const run = findNode(part, site.segment.runId);
    if (!run || run.kind !== 'run') {
      return {
        ok: false,
        issues: [{ code: 'known-node-invariant', path: 'missing-run', nodeId: site.segment.runId }],
      };
    }
    const index = run.children.findIndex((child) => contains(child, site.segment.node.id));
    return insertChildren(part, run.id, Math.max(0, index), payload, options);
  }

  if (site.kind === 'appendToRun') {
    return insertChildren(part, site.run.id, site.run.children.length, payload, options);
  }
  if (site.kind === 'atRunIndex') {
    return insertChildren(part, site.run.id, site.index, payload, options);
  }

  return insertChildren(
    part,
    site.holder.id,
    site.index ?? site.holder.children.length,
    [runElement(nextId, payload)],
    options
  );
}

/** Whether an offset lands strictly inside an atomic field/drawing/note segment. */
export function offsetInsideAtomicSegment(paragraph: OoxmlParagraphNode, offset: number): boolean {
  for (const segment of segmentsOf(paragraph)) {
    if (!segment.removeNodeIds || segment.removeNodeIds.length === 0) continue;
    if (offset > segment.start && offset < segment.end) return true;
  }
  return false;
}
