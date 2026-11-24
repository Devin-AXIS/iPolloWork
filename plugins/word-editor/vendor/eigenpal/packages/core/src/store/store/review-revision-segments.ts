// Where one tracked change ends and the next begins, beyond its identity.
//
// A change that runs across the edge of a content control, hyperlink, simple field, or
// direction wrapper is two changes, one on each side. Inside a complex field, each field
// character is a change of its own, and the instruction and the result are separate changes.
// The mark of the last paragraph in a block content control is a change of its own too.

import { parentNodeOf } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

const REVISION_CONTENT: ReadonlySet<string> = new Set([
  'revisionInsert',
  'revisionDelete',
  'revisionMoveFrom',
  'revisionMoveTo',
]);

const MATH_NAMESPACE_URI = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
/** The outermost of these names the equation a change inside it belongs to. */
const EQUATIONS: ReadonlySet<string> = new Set(['oMath', 'oMathPara']);

/** Inline wrappers whose edge ends a change. */
const CONTAINERS: ReadonlySet<string> = new Set(['hyperlink', 'fldSimple', 'dir', 'bdo']);

const isW = (node: OoxmlNode, name: string): boolean =>
  node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;

function isContainer(node: OoxmlNode): boolean {
  return (
    node.kind === 'contentControl' ||
    (node.kind !== 'textValue' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      CONTAINERS.has(node.localName))
  );
}

/** Range markers that hold no content, so they never make a block the last one. */
const INERT_MARKERS: ReadonlySet<string> = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'permStart',
  'permEnd',
  'proofErr',
]);

/** The last child that holds content, found from the end. */
function lastElement(node: OoxmlElement): OoxmlNode | undefined {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]!;
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && INERT_MARKERS.has(child.localName)) continue;
    return child;
  }
  return undefined;
}

/** The outermost open complex field at each node, per paragraph node: a paragraph is immutable. */
const fieldOwnersByParagraph = new WeakMap<OoxmlElement, ReadonlyMap<string, string>>();
/** Field positions per paragraph node, or null when it holds no field character. */
const fieldPositionsByParagraph = new WeakMap<OoxmlElement, ReadonlyMap<string, string> | null>();

function fieldOwners(paragraph: OoxmlElement): ReadonlyMap<string, string> {
  const cached = fieldOwnersByParagraph.get(paragraph);
  if (cached) return cached;
  const found = new Map<string, string>();
  const open: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (open.length) found.set(node.id, open[0]!);
    const character =
      node.kind === 'run' ? node.children.find((child) => isW(child, 'fldChar')) : undefined;
    const type = character?.attributes.find((a) => a.localName === 'fldCharType')?.value;
    if (type === 'begin') open.push(node.id);
    for (const child of node.children) visit(child);
    if (type === 'end') open.pop();
  };
  for (const child of paragraph.children) visit(child);
  fieldOwnersByParagraph.set(paragraph, found);
  return found;
}

function fieldPositions(paragraph: OoxmlElement): ReadonlyMap<string, string> | null {
  const cached = fieldPositionsByParagraph.get(paragraph);
  if (cached !== undefined) return cached;
  const positions = new Map<string, string>();
  let count = 0;
  let any = false;
  // A field character the change itself holds does not end it: only an unchanged one does.
  const visit = (node: OoxmlNode, inside: string | null, changed: boolean): void => {
    if (node.kind === 'textValue') return;
    const fieldRun =
      inside === null &&
      !changed &&
      node.kind === 'run' &&
      node.children.some((c) => isW(c, 'fldChar'));
    const own = inside ?? (fieldRun ? `c${count}` : `${count}`);
    positions.set(node.id, own);
    const content = changed || REVISION_CONTENT.has(node.kind);
    for (const child of node.children) visit(child, fieldRun ? own : inside, content);
    if (fieldRun) {
      count += 1;
      any = true;
    }
  };
  for (const child of paragraph.children) visit(child, null, false);
  const result = any ? positions : null;
  fieldPositionsByParagraph.set(paragraph, result);
  return result;
}

/**
 * One answer per derivation: `segmentOf(nodeId, mark)` names the segment a site belongs to.
 *
 * A caller that holds the node's parent passes it, so the walk up starts there. Each answer
 * that depends only on a paragraph's own content is kept per paragraph node, across
 * derivations: a decision changes a few paragraphs, and the queue is derived again for all.
 */
export function revisionSegments(part: OoxmlPart): {
  /** The segment of an inline site: its container and its place among field characters. */
  readonly segmentOf: (nodeId: string, parent?: OoxmlElement | null) => string;
  /** The segment of a paragraph mark site: its container, or the end of a block control. */
  readonly markSegmentOf: (nodeId: string, parent?: OoxmlElement | null) => string;
  /** The container alone, for joins across paragraph marks. */
  readonly containerOf: (nodeId: string) => string;
  /** The equation a node sits in, if any. */
  readonly equationOf: (nodeId: string, parent?: OoxmlElement | null) => string | undefined;
  /** The begin run of the outermost complex field a node sits in, if any. */
  readonly fieldOf: (nodeId: string, parent?: OoxmlElement | null) => string | undefined;
} {
  const containers = new Map<string, string>();
  const containerOf = (id: string): string => {
    const parent = parentNodeOf(part, id);
    if (!parent) return '';
    let found = containers.get(parent.id);
    if (found === undefined) {
      found = isContainer(parent) ? parent.id : containerOf(parent.id);
      containers.set(parent.id, found);
    }
    return found;
  };
  const parentOf = (id: string, parent: OoxmlElement | null | undefined): OoxmlElement | null =>
    parent !== undefined ? parent : parentNodeOf(part, id);
  // The paragraph at or above each node, per node id: the changes of one paragraph share it.
  const paragraphs = new Map<string, OoxmlElement | null>();
  const paragraphAt = (node: OoxmlElement | null): OoxmlElement | null => {
    if (!node) return null;
    if (node.kind === 'paragraph') return node;
    let found = paragraphs.get(node.id);
    if (found === undefined) {
      found = paragraphAt(parentNodeOf(part, node.id));
      paragraphs.set(node.id, found);
    }
    return found;
  };
  const paragraphOf = (id: string, parent?: OoxmlElement | null) =>
    paragraphAt(parentOf(id, parent));
  return {
    containerOf,
    fieldOf: (id, parent) => {
      const paragraph = paragraphOf(id, parent);
      return paragraph && fieldPositions(paragraph) ? fieldOwners(paragraph).get(id) : undefined;
    },
    equationOf: (id, parent) => {
      let found: string | undefined;
      for (let node = parentOf(id, parent); node; node = parentNodeOf(part, node.id))
        if (node.namespaceUri === MATH_NAMESPACE_URI && EQUATIONS.has(node.localName))
          found = node.id;
      return found;
    },
    segmentOf: (id, parent) => {
      const paragraph = paragraphOf(id, parent);
      const field = paragraph ? (fieldPositions(paragraph)?.get(id) ?? '') : '';
      return `${containerOf(id)}\u0000${field}`;
    },
    markSegmentOf: (id, parent) => {
      const paragraph = paragraphOf(id, parent);
      if (!paragraph) return containerOf(id);
      // The control first: a body-level paragraph's parent is the whole body.
      const holder = parentNodeOf(part, paragraph.id);
      const control = holder?.kind === 'contentControlContent' && parentNodeOf(part, holder.id);
      if (!control || control.kind !== 'contentControl' || lastElement(holder) !== paragraph)
        return containerOf(id);
      // A control that closes a table cell ends with the cell, not on its own.
      const cell = parentNodeOf(part, control.id);
      if (cell?.kind === 'tableCell' && lastElement(cell) === control) return containerOf(id);
      return `${control.id}\u0000end`;
    },
  };
}
