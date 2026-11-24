// Schema child orders of the property containers. The read repairs, the property writes and
// the serializer all emit children in these orders, and the read cannot import the write modules.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

/**
 * `CT_PPr`'s child sequence (ECMA-376 17.3.1.26). A `w:pPr` whose children are out of this
 * order is not merely untidy — Word reports the file as unreadable — and the flat property
 * list an op carries has no order of its own, so the merge imposes this one.
 */
export const CT_PPR_SEQUENCE: readonly string[] = [
  'pStyle',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'framePr',
  'widowControl',
  'numPr',
  'suppressLineNumbers',
  'pBdr',
  'shd',
  'tabs',
  'suppressAutoHyphens',
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  'spacing',
  'ind',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'jc',
  'textDirection',
  'textAlignment',
  'textboxTightWrap',
  'outlineLvl',
  'divId',
  'cnfStyle',
  'rPr',
  'sectPr',
  'pPrChange',
];

/**
 * `CT_RPr` (17.3.2.28), with `CT_ParaRPr`'s leading revision marks in front so the paragraph
 * mark's own run properties order by the same table.
 */
export const CT_RPR_SEQUENCE: readonly string[] = [
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
  'rPrChange',
];

/** `CT_TblPrBase` child sequence (ECMA-376 17.4.78), plus trailing `tblPrChange`. */
export const CT_TBLPR_SEQUENCE: readonly string[] = [
  'tblStyle',
  'tblpPr',
  'tblOverlap',
  'bidiVisual',
  'tblStyleRowBandSize',
  'tblStyleColBandSize',
  'tblW',
  'jc',
  'tblCellSpacing',
  'tblInd',
  'tblBorders',
  'shd',
  'tblLayout',
  'tblCellMar',
  'tblLook',
  'tblCaption',
  'tblDescription',
  'tblPrChange',
];

/**
 * `CT_TrPrBase` (17.4.80), then `CT_TrPr`'s trailing revision marks and `trPrChange`. The base
 * is a choice, so only the trailing three have a place; the rest take this one canonical order.
 */
export const CT_TRPR_SEQUENCE: readonly string[] = [
  'cnfStyle',
  'divId',
  'gridBefore',
  'gridAfter',
  'wBefore',
  'wAfter',
  'cantSplit',
  'trHeight',
  'tblHeader',
  'tblCellSpacing',
  'jc',
  'hidden',
  'ins',
  'del',
  'trPrChange',
];

/** `CT_TcPrBase` sequence (17.4.68), plus markup and `tcPrChange`. */
export const CT_TCPR_SEQUENCE: readonly string[] = [
  'cnfStyle',
  'tcW',
  'gridSpan',
  'hMerge',
  'vMerge',
  'tcBorders',
  'shd',
  'noWrap',
  'tcMar',
  'textDirection',
  'tcFitText',
  'vAlign',
  'hideMark',
  'headers',
  'cellIns',
  'cellDel',
  'cellMerge',
  'tcPrChange',
];

/** `CT_TblPrExBase` child sequence (17.4.61), plus trailing `tblPrExChange`. */
export const CT_TBLPREX_SEQUENCE: readonly string[] = [
  'tblW',
  'jc',
  'tblCellSpacing',
  'tblInd',
  'tblBorders',
  'shd',
  'tblLayout',
  'tblCellMar',
  'tblLook',
  'tblPrExChange',
];

/**
 * Position in the container's declared sequence; an unmodelled name sorts last. Only WML
 * children rank: `w14:shadow` is an extension, not the `w:shadow` the sequence names.
 */
export function rankOf(sequence: readonly string[], node: OoxmlNode): number {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return sequence.length;
  const index = sequence.indexOf(node.localName);
  return index === -1 ? sequence.length : index;
}

/**
 * The container's MODELLED children in schema order, leaving everything else where it was
 * authored, or `children` itself when they already are.
 *
 * `CT_PPr` is a strict `xsd:sequence`, and consumers refuse a file with an out-of-order
 * `w:pPr`. `CT_RPr` is a choice between its leading revision marks and its trailing
 * `w:rPrChange`, so only those positions matter there; ordering the rest by the same table
 * gives one canonical order and costs nothing.
 *
 * An element the sequence does not model (a `w14:` text effect, an `mc:AlternateContent`)
 * keeps its authored slot: its position is not ours to decide, and moving it could reorder
 * it past the very child it was written to modify.
 */
export function inSchemaOrder(
  children: readonly OoxmlNode[],
  sequence: readonly string[]
): readonly OoxmlNode[] {
  const slots: number[] = [];
  const modelled: { readonly node: OoxmlNode; readonly rank: number }[] = [];
  let ordered = true;
  let last = -1;
  children.forEach((child, index) => {
    const rank = rankOf(sequence, child);
    if (rank === sequence.length) return;
    if (rank < last) ordered = false;
    last = rank;
    slots.push(index);
    modelled.push({ node: child, rank });
  });
  if (ordered) return children;
  // Stable, so repeats of one name keep their authored order relative to each other.
  const sorted = [...modelled].sort((a, b) => a.rank - b.rank);
  const result = [...children];
  slots.forEach((slot, index) => {
    result[slot] = sorted[index]!.node;
  });
  return result;
}

const SEQUENCE_OF: Readonly<Record<string, readonly string[]>> = {
  pPr: CT_PPR_SEQUENCE,
  rPr: CT_RPR_SEQUENCE,
  tblPr: CT_TBLPR_SEQUENCE,
  tblPrEx: CT_TBLPREX_SEQUENCE,
  trPr: CT_TRPR_SEQUENCE,
  tcPr: CT_TCPR_SEQUENCE,
};

/**
 * Containers whose sequence states each child at most once (`CT_TcPr`, `CT_TblPrEx`). Two
 * collaborators who each set one cell's alignment at once leave two `w:vAlign`, and reference
 * renderings show the later one. `CT_TrPr` is a repeatable choice, so a repeat there is valid
 * and stays.
 */
const ONCE_EACH = new Set(['tcPr', 'tblPrEx']);

/**
 * Revision markup in a table property container. A repeat of one is a history the repair has
 * no right to pick from, so it stays as authored and the revision walks refuse it whole.
 */
const REVISION_MARKS = new Set([
  'ins',
  'del',
  'cellIns',
  'cellDel',
  'cellMerge',
  'trPrChange',
  'tcPrChange',
  'tblPrExChange',
]);

const isRevisionMark = (node: OoxmlNode): boolean =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  REVISION_MARKS.has(node.localName);

/**
 * The property containers a row or a cell holds at most once. A table's repeated `w:tblPr`
 * merge in `tableChildren`, by the rule reference renderings follow for them.
 */
const SINGLE_CONTAINERS_OF: Readonly<Record<string, readonly string[]>> = {
  tr: ['tblPrEx', 'trPr'],
  tc: ['tcPr'],
};

/**
 * The name a child claims its slot by when containers merge: `EG_CellMarkupElements` is one
 * choice, so a `w:cellIns` and a `w:cellDel` claim the same slot.
 */
function slotOf(child: OoxmlElement): string {
  return CELL_MARKUP.has(child.localName) ? 'cellMarkup' : child.localName;
}

const CELL_MARKUP = new Set(['cellIns', 'cellDel', 'cellMerge']);

/**
 * `children` of the element named `namespaceUri` / `localName` as the schema allows them, or
 * `children` itself when nothing changes:
 *
 * - a WML property container (`w:pPr`, `w:rPr`, `w:tblPr`, `w:tblPrEx`, `w:trPr`, `w:tcPr`),
 *   wherever it sits, holds its children in schema order, a `w:tcPr` or `w:tblPrEx` the
 *   last of a repeated one;
 * - a row or a cell holds one of each of its property containers, a later one replacing
 *   a property an earlier one states, as reference renderings merge them.
 *
 * The reader and the serializer both repair through this one function, so a file opens the
 * way a save writes it, and a file saved then reopened keeps its fingerprint. A tree that
 * concurrent collaborators merged does not: each can add a property, or a whole container,
 * and every replica shows the merge as the shared list holds it, so the tree keeps that and
 * only the saved file is repaired. Its reopen then fingerprints the repaired tree.
 */
export function repairedPropertyChildren(
  namespaceUri: string,
  localName: string,
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  if (namespaceUri !== WML_NAMESPACE_URI) return children;
  if (Object.hasOwn(SINGLE_CONTAINERS_OF, localName)) {
    return mergedPropertyContainers(localName, children);
  }
  if (!Object.hasOwn(SEQUENCE_OF, localName)) return children;
  return inSchemaOrder(withoutRepeatedProperties(localName, children), SEQUENCE_OF[localName]!);
}

/**
 * The children of a WML row (`tr`) or cell (`tc`) with each repeated property container
 * merged into its first, or `children` itself when none repeats or a repeat cannot merge.
 *
 * @internal
 */
export function mergedPropertyContainers(
  localName: string,
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  const containers = Object.hasOwn(SINGLE_CONTAINERS_OF, localName)
    ? SINGLE_CONTAINERS_OF[localName]!
    : [];
  return containers.reduce(mergedContainers, children);
}

/**
 * The children of a WML `localName` container without the earlier copies of a repeated
 * property, where its schema states each once, or `children` itself.
 *
 * @internal
 */
export function withoutRepeatedProperties(
  localName: string,
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  return ONCE_EACH.has(localName) ? lastOfEachName(children) : children;
}

/**
 * `children` keeping only the last WML element of each name, the one reference renderings
 * show, or `children` itself when none repeats. Revision markup and extensions are not the
 * repair's to count.
 */
function lastOfEachName(children: readonly OoxmlNode[]): readonly OoxmlNode[] {
  const seen = new Set<string>();
  const dropped = new Set<OoxmlNode>();
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]!;
    if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (isRevisionMark(child)) continue;
    if (seen.has(child.localName)) dropped.add(child);
    else seen.add(child.localName);
  }
  return dropped.size > 0 ? children.filter((child) => !dropped.has(child)) : children;
}

const isWmlNamed = (node: OoxmlNode, localName: string): node is OoxmlElement =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/**
 * `children` with every `localName` container merged into the first, in schema order.
 *
 * Two collaborators who each give one row a property at once each write a `w:trPr` when it
 * had none, and the merge keeps both, which the schema does not allow. Reference renderings
 * merge such copies: a later copy replaces a property an earlier one states, and adds the
 * ones it alone states. Extensions all stay, since the schema does not count them. Copies
 * that carry revision markup for one slot stay as authored: which history survives is not
 * the repair's to decide, so that row or cell still saves both, and the revision walks
 * refuse it.
 */
function mergedContainers(children: readonly OoxmlNode[], localName: string): readonly OoxmlNode[] {
  const copies = children.filter((child) => isWmlNamed(child, localName));
  const first = copies[0];
  if (!first || copies.length < 2) return children;
  const at = new Map<string, number>();
  const merged: OoxmlNode[] = [];
  for (const copy of copies) {
    for (const child of copy.children) {
      if (child.kind === 'textValue') {
        if (copy === first) merged.push(child);
        continue;
      }
      if (child.namespaceUri !== WML_NAMESPACE_URI) {
        merged.push(child);
        continue;
      }
      const slot = slotOf(child);
      const earlier = at.get(slot);
      // A repeat inside the first copy is that container's own, for its own rule; a later
      // copy replaces the last of them.
      if (earlier === undefined || copy === first) {
        at.set(slot, merged.length);
        merged.push(child);
        continue;
      }
      if (isRevisionMark(child) || isRevisionMark(merged[earlier]!)) return children;
      merged[earlier] = child;
    }
  }
  const container: OoxmlElement = {
    ...first,
    children: repairedPropertyChildren(WML_NAMESPACE_URI, localName, merged),
  } as OoxmlElement;
  const dropped = new Set<OoxmlNode>(copies.slice(1));
  return children.flatMap((child) =>
    child === first ? [container] : dropped.has(child) ? [] : [child]
  );
}

/** `children` of `node` as a save writes them; see {@link repairedPropertyChildren}. */
export function serializedPropertyOrder(
  node: OoxmlElement,
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  return repairedPropertyChildren(node.namespaceUri, node.localName, children);
}
