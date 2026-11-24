import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { holdsMoveNode } from './revision-container-presence.ts';

/** One named move range: the wrappers it covers, and the markers that delimit it. */
export interface MoveRange {
  readonly wrappers: OoxmlElement[];
  readonly markers: OoxmlElement[];
}

function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

/**
 * Named move ranges: `@w:name` → the move wrappers inside that range, by half.
 *
 * The two join keys in this family are distinct and neither substitutes for the other.
 * `@w:name` pairs a `moveFrom` RANGE with its `moveTo` RANGE; `@w:id` pairs a range START with
 * its own range END. In a real document the two halves of a named pair carry different ids.
 */
export function namedMoveRanges(root: OoxmlNode): Map<string, MoveRange> {
  const byName = new Map<string, MoveRange>();
  const bucketFor = (name: string): MoveRange => {
    const existing = byName.get(name);
    if (existing) return existing;
    const created: MoveRange = { wrappers: [], markers: [] };
    byName.set(name, created);
    return created;
  };
  // Range markers and the wrappers between them are SIBLINGS, not ancestors, so this tracks
  // which named range is open as it walks each container in document order. A range end is
  // matched to its start by `@w:id`, which is the other join key in this family.
  const open: { name: string; id: string | undefined }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    for (const child of node.children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'moveFromRangeStart' || child.kind === 'moveToRangeStart') {
        const name = wmlAttribute(child, 'name');
        if (name !== undefined) {
          open.push({ name, id: wmlAttribute(child, 'id') });
          bucketFor(name).markers.push(child);
        }
        continue;
      }
      if (child.kind === 'moveFromRangeEnd' || child.kind === 'moveToRangeEnd') {
        const id = wmlAttribute(child, 'id');
        // Innermost matching start wins; a malformed end with no match closes the innermost
        // open range rather than being dropped, so the walk cannot leave a range open forever.
        let index = -1;
        for (let at = open.length - 1; at >= 0; at -= 1) {
          if (open[at]!.id === id) {
            index = at;
            break;
          }
        }
        const closed = index >= 0 ? open.splice(index, 1)[0] : open.pop();
        if (closed) bucketFor(closed.name).markers.push(child);
        continue;
      }
      if (child.kind === 'revisionMoveFrom' || child.kind === 'revisionMoveTo') {
        const enclosing = open[open.length - 1];
        if (enclosing !== undefined) bucketFor(enclosing.name).wrappers.push(child);
      }
      // Only markers and move wrappers change the result; skip subtrees without one.
      if (holdsMoveNode(child)) visit(child);
    }
  };
  visit(root);
  return byName;
}

/** Where a moved paragraph mark stands: the ranges open there, and its paragraph's moves. */
export interface MovedMarkPlace {
  readonly ranges: readonly string[];
  /** The move destination wrappers in the mark's paragraph. */
  readonly wrappers: readonly string[];
}

/**
 * The named move ranges open where each moved paragraph mark (`w:pPr/w:rPr/w:moveTo`) stands.
 *
 * A mark is the end of its paragraph although it is written first, in `w:pPr`, so a range covers
 * the mark when it is still open after the paragraph's last child. Every paragraph is visited:
 * a paragraph that holds only its mark still sits inside a range.
 */
export function rangesOverMovedMarks(root: OoxmlNode): Map<string, MovedMarkPlace> {
  const covering = new Map<string, MovedMarkPlace>();
  const wrappersIn = (node: OoxmlNode): string[] =>
    node.kind === 'textValue'
      ? []
      : node.kind === 'revisionMoveTo'
        ? [node.id]
        : node.children.flatMap(wrappersIn);
  const open: { name: string; id: string | undefined }[] = [];
  const marksOf = (paragraph: OoxmlElement): OoxmlElement[] => {
    const marks: OoxmlElement[] = [];
    for (const properties of paragraph.children) {
      if (properties.kind === 'textValue' || properties.localName !== 'pPr') continue;
      for (const run of properties.children) {
        if (run.kind === 'textValue' || run.localName !== 'rPr') continue;
        for (const mark of run.children)
          if (mark.kind !== 'textValue' && mark.localName === 'moveTo') marks.push(mark);
      }
    }
    return marks;
  };
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    for (const child of node.children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'moveFromRangeStart' || child.kind === 'moveToRangeStart') {
        const name = wmlAttribute(child, 'name');
        if (name !== undefined) open.push({ name, id: wmlAttribute(child, 'id') });
        continue;
      }
      if (child.kind === 'moveFromRangeEnd' || child.kind === 'moveToRangeEnd') {
        const id = wmlAttribute(child, 'id');
        let index = -1;
        for (let at = open.length - 1; at >= 0; at -= 1)
          if (open[at]!.id === id) {
            index = at;
            break;
          }
        if (index >= 0) open.splice(index, 1);
        continue;
      }
      if (child.kind === 'paragraph') {
        if (holdsMoveNode(child)) visit(child);
        const marks = marksOf(child);
        if (marks.length) {
          const place = { ranges: open.map((range) => range.name), wrappers: wrappersIn(child) };
          for (const mark of marks) covering.set(mark.id, place);
        }
        continue;
      }
      visit(child);
    }
  };
  visit(root);
  return covering;
}
