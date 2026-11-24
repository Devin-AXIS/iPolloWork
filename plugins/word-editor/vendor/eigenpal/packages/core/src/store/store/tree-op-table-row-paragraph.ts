// The paragraph content an inserted table row's cells start with.
//
// Inserting a row copies each source cell's first-paragraph properties, paragraph mark
// included, into the new cell's empty paragraph, so a new row matches the row it was made
// from instead of falling back to the document defaults. Only the paragraph mark's run
// properties carry over as the text face. The source's text runs never do: a bold "Label:"
// at the start of a cell is that cell's content, not the face of values written below it.
//
// A mark formats only the empty line; text written into the cell needs a run that carries the
// face. So when the mark has formatting, the new paragraph also holds an empty run with it:
// written or typed text joins it, the way it joins any run already in a paragraph.
//
// Only WordprocessingML properties are copied, re-spelled under the prefix the new row uses.
// An extension namespace may be bound only on the source paragraph, where a copy cannot
// follow it. Revision markers are dropped: the copy is a fresh paragraph, not a continuation of
// someone's pending decision. A section break never belongs in a table cell.

import {
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
} from '../package/ooxml-tree.ts';
import type { WmlFreshNamespaceContext } from '../package/wml-namespace.ts';
import { paragraphPropertiesNodeOf } from './tree-op-nodes.ts';
import { isWmlElement } from './tree-op-table-shared.ts';
import { NOT_INHERITED } from './mark-character-style-run.ts';

const PPR_DROPPED = new Set(['pPrChange', 'sectPr', 'rPr']);
// Revision markers, plus visibility: a hidden source must not hide the values written here.
// The same rule new text follows when it joins an empty run (`mark-character-style-run.ts`).
const MARK_DROPPED = NOT_INHERITED;
/** Revision records dropped at any depth: a copy must not repeat someone's decision. */
const REVISION_RECORDS = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'numberingChange',
]);
function wmlChildren(node: OoxmlElement, dropped: ReadonlySet<string>): OoxmlNode[] {
  return node.children.filter(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      !dropped.has(child.localName)
  );
}

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}

interface SourceContent {
  /** The new paragraph's children before respelling: `w:pPr`, then the seed run. */
  readonly nodes: readonly OoxmlNode[];
  /** Their node count, an upper bound on what respelling creates. */
  readonly count: number;
}

const sources = new WeakMap<OoxmlElement, SourceContent | null>();

function element(
  template: OoxmlElement,
  kind: OoxmlElement['kind'],
  localName: string,
  children: readonly OoxmlNode[]
): OoxmlElement {
  return { ...template, kind, localName, attributes: [], children } as OoxmlElement;
}

function nodeCount(node: OoxmlNode): number {
  if (node.kind === 'textValue') return 1;
  let count = 1;
  for (const child of node.children) count += nodeCount(child);
  return count;
}

function sourceContent(cell: OoxmlElement): SourceContent | null {
  const cached = sources.get(cell);
  if (cached !== undefined) return cached;
  const paragraph = cell.children.find((child) => child.kind === 'paragraph');
  let result: SourceContent | null = null;
  if (paragraph) {
    const pPr = paragraphPropertiesNodeOf(paragraph);
    const ownMark = pPr?.children.find((child) => isWmlElement(child, 'rPr')) as
      OoxmlElement | undefined;
    // The mark copies as the source mark is: list markers and the empty line take their face
    // from it. A mark holding only revision markers has no formatting of its own.
    const ownChildren = ownMark ? wmlChildren(ownMark, MARK_DROPPED) : [];
    const mark = ownChildren.length > 0 ? withChildren(ownMark!, ownChildren) : undefined;
    // The seed run carries the face written text shows: the mark's, and nothing else.
    const face = mark;
    const properties = pPr ? wmlChildren(pPr, PPR_DROPPED) : [];
    const pPrChildren = mark ? [...properties, mark] : properties;
    const nodes: OoxmlNode[] = [];
    if (pPrChildren.length > 0)
      // Non-empty only when the source has a `w:pPr`: the mark comes from it.
      nodes.push(element(pPr!, 'paragraphProperties', 'pPr', pPrChildren));
    if (face) nodes.push(element(face, 'run', 'r', [face]));
    if (nodes.length > 0)
      result = { nodes, count: nodes.reduce((total, node) => total + nodeCount(node), 0) };
  }
  sources.set(cell, result);
  return result;
}

/** A WML-only copy under the row's prefixes, with fresh identities and no local bindings. */
function respelled(
  node: OoxmlNode,
  wml: WmlFreshNamespaceContext,
  nextId: () => string
): OoxmlNode | null {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  if (node.namespaceUri !== WML_NAMESPACE_URI || REVISION_RECORDS.has(node.localName)) return null;
  const attributes: OoxmlAttribute[] = [];
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI)
      attributes.push({ ...attribute, prefix: wml.attributePrefix } as OoxmlAttribute);
    else if (attribute.namespaceUri === XML_NAMESPACE_URI || !attribute.namespaceUri)
      attributes.push(attribute);
  }
  const children: OoxmlNode[] = [];
  for (const child of node.children) {
    const copy = respelled(child, wml, nextId);
    if (copy) children.push(copy);
  }
  const { prefix: _prefix, ...rest } = node;
  return {
    ...rest,
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    id: nextId(),
    namespaceBindings: [],
    attributes,
    children,
  } as OoxmlNode;
}

/** Fresh paragraph content for a cell copied from `sourceCell`. */
export function insertedCellParagraphContent(
  sourceCell: OoxmlElement,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlNode[] {
  const source = sourceContent(sourceCell);
  if (!source) return [];
  return source.nodes.flatMap((node) => respelled(node, wml, nextId) ?? []);
}

/** An upper bound on the nodes {@link insertedCellParagraphContent} creates, for budgeting. */
export function insertedCellParagraphNodeCount(sourceCell: OoxmlElement): number {
  const source = sourceContent(sourceCell);
  return source?.count ?? 0;
}
