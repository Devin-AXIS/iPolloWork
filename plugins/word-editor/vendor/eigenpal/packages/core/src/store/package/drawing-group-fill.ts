// The fill a group hands its members. A member whose `spPr` says `a:grpFill` paints the fill
// of its nearest group's `grpSpPr`; a group that itself says `a:grpFill` hands on its parent
// group's. The projection paints with it and the shape format reads and writes it.

import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const FILLS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);

/** The first fill-choice child of `parent`, or undefined when it authors none. */
function firstFill(parent: OoxmlElement): OoxmlElement | undefined {
  for (const node of parent.children) {
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI && FILLS.has(node.localName))
      return node;
  }
  return undefined;
}

/**
 * The fill element `group` (a `wpg:wgp`/`wpg:grpSp` or any element with a `grpSpPr` in its own
 * namespace) hands its members: its own fill, `inherited` for `a:grpFill`, or null for none.
 *
 * @internal
 */
export function groupFillOf(
  group: OoxmlElement,
  inherited: OoxmlElement | null
): OoxmlElement | null {
  let own: OoxmlElement | undefined;
  for (const node of group.children) {
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === group.namespaceUri && node.localName === 'grpSpPr') {
      own = firstFill(node);
      break;
    }
  }
  if (!own) return null;
  return own.localName === 'grpFill' ? inherited : own;
}

/**
 * `spPr` with its `a:grpFill` replaced by `groupFill`, so fill readers see the fill the member
 * paints; `spPr` itself when it authors another fill or no group fill is known.
 *
 * @internal
 */
export function withResolvedGroupFill(
  spPr: OoxmlElement,
  groupFill: OoxmlElement | null | undefined
): OoxmlElement {
  if (!groupFill) return spPr;
  const own = firstFill(spPr);
  if (own?.localName !== 'grpFill') return spPr;
  return {
    ...spPr,
    children: spPr.children.map((node) => (node === own ? groupFill : node)),
  } as OoxmlElement;
}

const SPANNING = new Set(['gradFill', 'pattFill', 'blipFill']);

/**
 * Whether `spPr` says `a:grpFill` while the group fill is a gradient, a pattern or a picture.
 * Word spans a gradient across the group box (2026-11-12 render), which per-member paint cannot
 * match; a pattern or picture group fill has no per-member paint here either.
 *
 * @internal
 */
export function groupFillSpansMembers(
  spPr: OoxmlElement,
  groupFill: OoxmlElement | null | undefined
): boolean {
  if (!groupFill || !SPANNING.has(groupFill.localName)) return false;
  return firstFill(spPr)?.localName === 'grpFill';
}
