// A rich paste in suggesting mode: the whole fragment becomes ONE proposed insertion.
//
// What a desktop word processor writes when it pastes with tracking on, and what this does to
// the fragment before the merge lands it:
//  - every run sits inside a `w:ins` by the pasting author (inside a hyperlink, not around it,
//    because `CT_RunTrackChange` cannot hold one);
//  - every paragraph mark and every table row carries that author's `w:ins`;
//  - an insertion the source already proposed is absorbed into the new one;
//  - a deletion the source already proposed stays, nested inside the new insertion, so the
//    reviewer still sees it and can still decide it;
//  - formatting history (`w:rPrChange`, `w:pPrChange`) stays.
//
// The merge renumbers every revision id against the target document afterwards, so the ids
// written here only need to be unique within the fragment. Content this cannot propose as
// one insertion (moves, a block it does not know) refuses the transform, and the paste falls
// back to plain text, which suggesting mode tracks.

import type { OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { createNodeIdAllocator, replaceChildren } from '../package/ooxml-edit.ts';
import { isInlineRunContainer, WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { isInlineContainerProperty } from '../package/inline-container-properties.ts';
import { isFldSimple } from '../package/field-nodes.ts';
import { complexFieldNodes } from './field-simple-to-complex.ts';
import { build, revisionAttributes } from './tree-op-tracked-builders.ts';
import { REVISION_ID_BEARING } from './tree-op-revision-ids.ts';
import type { RevisionAttributionInput } from './tree-op-validate.ts';

/** Thrown inside the walk; turned into a refusal at the entry point. */
class Untrackable extends Error {}

const localName = (node: OoxmlNode): string =>
  node.kind === 'textValue' ? '' : ((node as { localName?: string }).localName ?? '');

const isWml = (node: OoxmlNode, name: string): boolean =>
  node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && localName(node) === name;

/** Markers that hold no content and may sit anywhere between blocks or runs. */
const MARKERS = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'permStart',
  'permEnd',
  'proofErr',
]);
const MOVES = new Set([
  'moveFrom',
  'moveTo',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
]);

const isMarker = (node: OoxmlNode): boolean =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  MARKERS.has(localName(node));

function highestRevisionId(fragment: OoxmlPackage): number {
  let highest = -1;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === WML_NAMESPACE_URI && REVISION_ID_BEARING.has(node.localName)) {
      for (const attribute of node.attributes) {
        if (attribute.namespaceUri !== WML_NAMESPACE_URI || attribute.localName !== 'id') continue;
        if (/^\d{1,9}$/.test(attribute.value)) highest = Math.max(highest, Number(attribute.value));
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const part of fragment.parts.values()) visit(part.root);
  return highest;
}

/**
 * The fragment with its main story proposed as one insertion by `revision`, or `null` when
 * it holds content that cannot be proposed that way.
 */
export function trackedFragment(
  fragment: OoxmlPackage,
  revision: RevisionAttributionInput
): OoxmlPackage | null {
  const part = fragment.parts.get(fragment.mainDocumentPart);
  if (!part || part.root.kind !== 'document') return null;
  // Node ids come from the part being walked: the body first, then each note part.
  let mint = createNodeIdAllocator(part);
  let nextId = highestRevisionId(fragment) + 1;
  const insertion = (children: readonly OoxmlNode[]): OoxmlNode =>
    build(
      mint(),
      'revisionInsert',
      'ins',
      revisionAttributes(String(nextId++), revision),
      children
    );
  const mark = (): OoxmlNode =>
    build(mint(), 'generic', 'ins', revisionAttributes(String(nextId++), revision), []);

  /** Run-level content, with every content node inside this author's insertion. */
  const inline = (nodes: readonly OoxmlNode[]): OoxmlNode[] => {
    const out: OoxmlNode[] = [];
    let group: OoxmlNode[] = [];
    const close = (): void => {
      if (group.some((node) => !isMarker(node))) out.push(insertion(group));
      else for (const node of group) out.push(node);
      group = [];
    };
    const take = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') {
        group.push(node);
        return;
      }
      if (MOVES.has(localName(node)) && node.namespaceUri === WML_NAMESPACE_URI) {
        throw new Untrackable();
      }
      // Another author's proposed insertion is absorbed: it becomes part of this one.
      if (node.kind === 'revisionInsert') {
        for (const child of node.children) take(child);
        return;
      }
      // A deletion stays, inside the insertion: proposed by this author, struck by theirs.
      if (node.kind === 'revisionDelete') {
        group.push(node);
        return;
      }
      // `w:fldSimple` cannot sit inside `w:ins`; its complex form can.
      if (isFldSimple(node)) {
        for (const child of complexFieldNodes(node, mint)) take(child);
        return;
      }
      if (isInlineRunContainer(node)) {
        close();
        const properties = node.children.filter((child) => isInlineContainerProperty(node, child));
        const content = node.children.filter((child) => !isInlineContainerProperty(node, child));
        out.push({ ...node, children: [...properties, ...inline(content)] } as OoxmlNode);
        return;
      }
      group.push(node);
    };
    for (const node of nodes) take(node);
    close();
    return out;
  };

  /** `w:pPr` with this author's `w:ins` first among the mark revisions. */
  const markedProperties = (properties: OoxmlNode | undefined): OoxmlNode => {
    const children = properties && properties.kind !== 'textValue' ? properties.children : [];
    const rPr = children.find((child) => isWml(child, 'rPr'));
    const rPrChildren = rPr && rPr.kind !== 'textValue' ? rPr.children : [];
    if (rPrChildren.some((child) => MOVES.has(localName(child)))) throw new Untrackable();
    const kept = rPrChildren.filter((child) => !isWml(child, 'ins'));
    const deleted = kept.filter((child) => isWml(child, 'del'));
    const rest = kept.filter((child) => !isWml(child, 'del'));
    const newRPr = build(
      rPr?.id ?? mint(),
      'runProperties',
      'rPr',
      rPr && rPr.kind !== 'textValue' ? rPr.attributes : [],
      [mark(), ...deleted, ...rest]
    );
    const others = children.filter((child) => !isWml(child, 'rPr'));
    const trailing = others.filter((child) => isWml(child, 'sectPr') || isWml(child, 'pPrChange'));
    const leading = others.filter((child) => !trailing.includes(child));
    return build(
      properties?.id ?? mint(),
      'paragraphProperties',
      'pPr',
      properties && properties.kind !== 'textValue' ? properties.attributes : [],
      [...leading, newRPr, ...trailing]
    );
  };

  const paragraph = (node: OoxmlNode & { children: readonly OoxmlNode[] }): OoxmlNode => {
    const properties = node.children.find((child) => child.kind === 'paragraphProperties');
    const content = node.children.filter((child) => child.kind !== 'paragraphProperties');
    return { ...node, children: [markedProperties(properties), ...inline(content)] } as OoxmlNode;
  };

  /** `w:trPr` with this author's `w:ins` after the row properties (`CT_TrPr`). */
  const markedRowProperties = (properties: OoxmlNode | undefined): OoxmlNode => {
    const children = properties && properties.kind !== 'textValue' ? properties.children : [];
    const kept = children.filter((child) => !isWml(child, 'ins'));
    const history = kept.filter((child) => isWml(child, 'del') || isWml(child, 'trPrChange'));
    const base = kept.filter((child) => !history.includes(child));
    return build(
      properties?.id ?? mint(),
      properties && properties.kind !== 'textValue' ? properties.kind : 'generic',
      'trPr',
      properties && properties.kind !== 'textValue' ? properties.attributes : [],
      [...base, mark(), ...history]
    );
  };

  const row = (node: OoxmlNode & { children: readonly OoxmlNode[] }): OoxmlNode => {
    const properties = node.children.find((child) => isWml(child, 'trPr'));
    const rest = node.children.filter((child) => !isWml(child, 'trPr'));
    const exception = rest.filter((child) => isWml(child, 'tblPrEx'));
    const cells = rest
      .filter((child) => !isWml(child, 'tblPrEx'))
      .map((child) =>
        child.kind === 'tableCell'
          ? ({ ...child, children: child.children.map(block) } as OoxmlNode)
          : child.kind === 'textValue' || isMarker(child)
            ? child
            : blockOrRefuse(child)
      );
    return {
      ...node,
      children: [...exception, markedRowProperties(properties), ...cells],
    } as OoxmlNode;
  };

  function blockOrRefuse(node: OoxmlNode): OoxmlNode {
    throw new Untrackable(localName(node));
  }

  /**
   * One child of a table: a row, the table's own properties, or a row-level content control
   * whose rows are proposed like any other. Anything else refuses rather than landing
   * untracked.
   */
  function tableChild(node: OoxmlNode): OoxmlNode {
    if (node.kind === 'textValue' || isMarker(node)) return node;
    if (node.kind === 'tableRow') return row(node);
    if (node.kind === 'tableProperties' || node.kind === 'tableGrid') return node;
    if (node.kind === 'contentControl' || node.kind === 'contentControlContent') {
      return {
        ...node,
        children: node.children.map((child) =>
          isInlineContainerProperty(node, child) ? child : tableChild(child)
        ),
      } as OoxmlNode;
    }
    if (isWml(node, 'tblPr') || isWml(node, 'tblGrid')) return node;
    return blockOrRefuse(node);
  }

  /** One block, in the body, a cell or a block content control. */
  function block(node: OoxmlNode): OoxmlNode {
    if (node.kind === 'textValue' || isMarker(node)) return node;
    switch (node.kind) {
      case 'paragraph':
        return paragraph(node);
      case 'table':
        return { ...node, children: node.children.map(tableChild) } as OoxmlNode;
      case 'tableProperties':
      case 'tableGrid':
        return node;
      case 'contentControl':
      case 'contentControlContent':
        return {
          ...node,
          children: node.children.map((child) =>
            isInlineContainerProperty(node, child) ? child : block(child)
          ),
        } as OoxmlNode;
      default:
        // Cell properties and the body's closing `w:sectPr` carry no content.
        if (isWml(node, 'tcPr') || isWml(node, 'sectPr') || isWml(node, 'sdtPr')) return node;
        if (isWml(node, 'sdtEndPr')) return node;
        return blockOrRefuse(node);
    }
  }

  const root = part.root;
  const body = root.children.find((child) => child.kind === 'body');
  if (!body || body.kind !== 'body') return null;
  const parts = new Map(fragment.parts);
  try {
    const replaced = replaceChildren(part, body.id, body.children.map(block));
    if (!replaced.ok) return null;
    parts.set(fragment.mainDocumentPart, replaced.part);
    // A pasted note's text is part of the same proposal as its reference, as on the page.
    for (const [name, notePart] of fragment.parts) {
      if (!NOTE_PART.test(name)) continue;
      mint = createNodeIdAllocator(notePart);
      let current = notePart;
      for (const note of notePart.root.children) {
        if (!isWml(note, 'footnote') && !isWml(note, 'endnote')) continue;
        if (note.kind === 'textValue') continue;
        const type = note.attributes.find((attribute) => attribute.localName === 'type')?.value;
        // Separators are the story's furniture, not pasted content.
        if (type !== undefined && type !== 'normal') continue;
        const noted = replaceChildren(current, note.id, note.children.map(block));
        if (!noted.ok) return null;
        current = noted.part;
      }
      parts.set(name, current);
    }
  } catch (error) {
    if (error instanceof Untrackable) return null;
    throw error;
  }
  return { ...fragment, parts };
}

const NOTE_PART = /\/(?:footnotes|endnotes)\.xml$/;
