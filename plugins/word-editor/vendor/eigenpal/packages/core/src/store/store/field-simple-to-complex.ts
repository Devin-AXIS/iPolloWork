// Rewrite an editable `w:fldSimple` as the equivalent complex field before an edit inside it.
//
// A simple field holds its result runs inside one element, which the revision and run-split
// lanes do not enter. The complex form has the same meaning (begin, instruction, separate,
// the same result runs, end), and it is the form the document is saved in by the reference
// word processor anyway. So an edit that reaches inside an editable simple field's result
// first rewrites the field, then edits ordinary runs.

import { fldSimpleInstr, isFldSimple } from '../package/field-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { cloneWithNewIds, parentOf, runPropertiesNodeOf } from './tree-op-nodes.ts';

function attribute(localName: string, value: string): Record<string, unknown> {
  return {
    kind: 'genericExtension',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

function element(
  nextId: () => string,
  kind: string,
  localName: string,
  attributes: readonly Record<string, unknown>[],
  children: readonly OoxmlNode[]
): OoxmlNode {
  return {
    id: nextId(),
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as unknown as OoxmlNode;
}

/** The first result run's properties, so the markers carry the result's formatting. */
function resultRunProperties(simple: OoxmlNode): OoxmlNode | null {
  if (simple.kind === 'textValue') return null;
  for (const child of simple.children) {
    if (child.kind === 'run') return runPropertiesNodeOf(child) ?? null;
  }
  return null;
}

const localNameOf = (node: OoxmlNode): string =>
  node.kind === 'textValue' ? '' : ((node as { localName?: string }).localName ?? '');

/**
 * The result's properties for a marker run, without a tracked property change: that change
 * belongs to the result run, and a copy would repeat its `w:id`.
 */
function markerRunProperties(rPr: OoxmlNode, nextId: () => string): OoxmlNode {
  const clone = cloneWithNewIds(rPr, nextId);
  if (clone.kind === 'textValue') return clone;
  return {
    ...clone,
    children: clone.children.filter((child) => localNameOf(child) !== 'rPrChange'),
  } as OoxmlNode;
}

/** What the rewrite replaced: the simple field, and the runs that now carry its markers. */
export interface SimpleFieldRewrite {
  readonly ok: true;
  readonly part: OoxmlPart;
  readonly created: readonly string[];
  readonly deleted: readonly string[];
}

/**
 * Replace the simple field `simpleId` with its complex form (`complexFieldNodes`).
 */
export function complexFieldFromSimple(
  part: OoxmlPart,
  simpleId: string,
  options?: EditOptions
): SimpleFieldRewrite | { ok: false } {
  const simple = findNode(part, simpleId);
  const parent = parentOf(part, simpleId);
  if (!simple || !isFldSimple(simple) || simple.kind === 'textValue' || !parent)
    return { ok: false };
  const created: string[] = [];
  const complex = complexFieldNodes(simple, createNodeIdAllocator(part), created);
  const rebuilt = parent.children.flatMap((child) => (child.id === simpleId ? complex : [child]));
  const replaced = replaceChildren(part, parent.id, rebuilt, options);
  return replaced.ok
    ? { ok: true, part: replaced.part, created, deleted: [simpleId] }
    : { ok: false };
}

/**
 * The complex form of a simple field: begin, instruction, separate, the same result runs,
 * end. The instruction and the result runs are kept as they are. The field's `w:fldLock` and
 * `w:dirty` attributes and its `w:fldData` move to the begin marker. Each marker run's id is
 * pushed onto `created`.
 */
export function complexFieldNodes(
  simple: OoxmlNode,
  nextId: () => string,
  created: string[] = []
): OoxmlNode[] {
  if (simple.kind === 'textValue') return [simple];
  const rPr = resultRunProperties(simple);
  const run = (child: OoxmlNode): OoxmlNode => {
    const children = rPr ? [markerRunProperties(rPr, nextId), child] : [child];
    const marker = element(nextId, 'run', 'r', [], children);
    created.push(marker.id);
    return marker;
  };
  const beginAttributes: Record<string, unknown>[] = [attribute('fldCharType', 'begin')];
  for (const kept of simple.attributes) {
    if (kept.localName === 'fldLock' || kept.localName === 'dirty')
      beginAttributes.push({ ...kept });
  }
  const fieldData = simple.children.filter((child) => localNameOf(child) === 'fldData');
  const result = simple.children.filter((child) => localNameOf(child) !== 'fldData');
  const fldChar = (
    attributes: readonly Record<string, unknown>[],
    children: readonly OoxmlNode[] = []
  ) => element(nextId, 'fldChar', 'fldChar', attributes, children);
  const instruction = element(
    nextId,
    'instrText',
    'instrText',
    [
      {
        kind: 'xmlSpace',
        namespaceUri: XML_NAMESPACE_URI,
        localName: 'space',
        prefix: 'xml',
        value: 'preserve',
      },
    ],
    [{ id: nextId(), kind: 'textValue', value: fldSimpleInstr(simple) ?? '' } as OoxmlNode]
  );
  return [
    run(fldChar(beginAttributes, fieldData)),
    run(instruction),
    run(fldChar([attribute('fldCharType', 'separate')])),
    ...result,
    run(fldChar([attribute('fldCharType', 'end')])),
  ];
}
