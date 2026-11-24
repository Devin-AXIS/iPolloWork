/**
 * Properties from two property containers of one paragraph or run, as one container shows them.
 *
 * A later container adds to an earlier one property by property. Two elements of one name
 * merge their attributes, the later winning where both set one: `w:ind w:left` and a later
 * `w:ind w:firstLine` indent by both. A paragraph mark's `w:rPr` merges the same way, and two
 * `w:tabs` keep every stop, the later winning at one position. Any other element with
 * children takes the later one's children when it has some.
 */
import { CT_RPR_SEQUENCE } from './ooxml-property-order.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

const nameOf = (node: OoxmlElement) => `${node.namespaceUri} ${node.localName}`;
const attributeName = (attribute: OoxmlAttribute) =>
  `${attribute.namespaceUri} ${attribute.localName}`;

const isWml = (node: OoxmlElement, localName: string) =>
  node.namespaceUri === WML_NAMESPACE_URI && node.localName === localName;

/** The earlier attributes with the later ones over them. */
function mergedAttributes(
  earlier: readonly OoxmlAttribute[],
  later: readonly OoxmlAttribute[]
): readonly OoxmlAttribute[] {
  const named = new Set(later.map(attributeName));
  return [...earlier.filter((attribute) => !named.has(attributeName(attribute))), ...later];
}

const positionOf = (tab: OoxmlNode): number => {
  if (tab.kind === 'textValue') return Number.NaN;
  const pos = tab.attributes.find((attribute) => attribute.localName === 'pos')?.value;
  return pos === undefined ? Number.NaN : Number.parseFloat(pos);
};

/** Every stop of both `w:tabs`, the later winning at one position, in position order. */
function mergedTabs(earlier: readonly OoxmlNode[], later: readonly OoxmlNode[]): OoxmlNode[] {
  const taken = new Set(later.map(positionOf).filter((pos) => !Number.isNaN(pos)));
  return [...earlier.filter((tab) => !taken.has(positionOf(tab))), ...later]
    .map((tab, order) => ({ tab, order, pos: positionOf(tab) }))
    .sort((a, b) =>
      Number.isNaN(a.pos) || Number.isNaN(b.pos)
        ? a.order - b.order
        : a.pos - b.pos || a.order - b.order
    )
    .map(({ tab }) => tab);
}

/** One element standing for an earlier and a later element of the same name. */
function mergedElement(earlier: OoxmlElement, later: OoxmlElement): OoxmlElement {
  let children: readonly OoxmlNode[];
  if (isWml(later, 'tabs')) children = mergedTabs(earlier.children, later.children);
  else if (isWml(later, 'rPr'))
    children = mergedPropertyList(earlier.children, later.children, CT_RPR_SEQUENCE);
  else children = later.children.length > 0 ? later.children : earlier.children;
  return {
    ...later,
    attributes: mergedAttributes(earlier.attributes, later.attributes),
    children,
  } as OoxmlElement;
}

/**
 * The properties of `earlier` with `later` added, in the order `sequence` gives. Names of
 * equal rank keep the order they came in.
 */
export function mergedPropertyList(
  earlier: readonly OoxmlNode[],
  later: readonly OoxmlNode[],
  sequence: readonly string[],
  unknownBefore?: string
): OoxmlNode[] {
  const byName = new Map<string, OoxmlElement>();
  const order: string[] = [];
  const loose: OoxmlNode[] = [];
  for (const list of [earlier, later]) {
    for (const child of list) {
      if (child.kind === 'textValue') {
        loose.push(child);
        continue;
      }
      const key = nameOf(child);
      const prior = byName.get(key);
      if (!prior) order.push(key);
      byName.set(key, prior ? mergedElement(prior, child) : child);
    }
  }
  // An unmodelled name sorts before `unknownBefore` when given (a `w:pPr` keeps its mark, section
  // and change record last), or after every modelled name.
  const unknownRank =
    unknownBefore === undefined ? sequence.length : sequence.indexOf(unknownBefore) - 0.5;
  const rank = (node: OoxmlElement) => {
    const at = node.namespaceUri === WML_NAMESPACE_URI ? sequence.indexOf(node.localName) : -1;
    return at < 0 ? unknownRank : at;
  };
  return [
    ...order
      .map((key, at) => ({ node: byName.get(key)!, at }))
      .sort((a, b) => rank(a.node) - rank(b.node) || a.at - b.at)
      .map(({ node }) => node),
    ...loose,
  ];
}
