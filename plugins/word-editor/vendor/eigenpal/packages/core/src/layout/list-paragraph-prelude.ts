// Per-paragraph list inputs for the story walk: the `w:numPr` a paragraph resolves to, its
// cascaded property tiers, and its outline level.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import type { NumberingLevelIndent } from './numbering-index.ts';
import { numberingLevelTiers } from './numbering-level-tier.ts';
import { resolveParagraphOutlineLevel } from './paragraph-outline-level.ts';
import { propertiesOf } from './paragraph-flow.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from './style-cascade.ts';
import { styleSeparatorMembersOf } from './style-separator-group.ts';
import { styleIdFromProps } from './style-chain.ts';

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attrVal(node: OoxmlElement, localName: string): string | undefined {
  for (const a of node.attributes) {
    if (a.localName === localName) return a.value;
  }
  return undefined;
}

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * One `w:numPr` tier read per FIELD. `undefined` means the tier does not state the field.
 *
 * `numId: null` is a tier that states "no numbering": `w:val="0"` (§17.9.18 — the null
 * numbering definition), a `w:numId` with no value, or an oversized value (hostile-input
 * guard). `ilvl: null` is a stated level outside 0–8, which invalidates the tier's
 * numbering the same way; an unparseable level reads as 0, as before.
 */
export function numPrFieldsOf(
  node: OoxmlNode
): { numId: string | null | undefined; ilvl: number | null | undefined } | null {
  if (!isElement(node)) return null;
  const numPr = childNamed(node, 'numPr');
  if (!numPr) return null;
  const numIdNode = childNamed(numPr, 'numId');
  const ilvlNode = childNamed(numPr, 'ilvl');
  let numId: string | null | undefined;
  if (numIdNode) {
    const val = attrVal(numIdNode, 'val');
    numId = val !== undefined && val !== '0' && val.length <= 64 ? val : null;
  }
  let ilvl: number | null | undefined;
  if (ilvlNode) {
    const raw = attrVal(ilvlNode, 'val');
    const parsed = /^\d{1,2}$/.test(raw ?? '') ? Number(raw) : 0;
    ilvl = parsed <= 8 ? parsed : null;
  }
  return { numId, ilvl };
}

/**
 * Read `w:numPr` from cascaded paragraph-property nodes (lowest precedence first).
 *
 * Flat `OoxmlProperty[]` bags drop nested `ilvl`/`numId`, so this walks the tree nodes
 * the same way borders and tabs do.
 *
 * `w:ilvl` and `w:numId` inherit INDEPENDENTLY through the style chain and the direct
 * `w:pPr` (§17.3.1.19): a tier stating only the level keeps the id it inherits — Word's
 * standard Heading2–Heading9 shape, where only Heading1 names the `w:num` — and a tier
 * stating only the id keeps the inherited level. Treating each `w:numPr` node as a full
 * replacement dropped the id at every level-only tier and unnumbered the paragraph. A
 * stated `w:numId w:val="0"` (or an invalid value) still switches numbering off at that
 * tier even when a lower tier set one; a higher tier stating a valid id re-enables. A
 * level-only tier with no id inherited from below resolves to no numbering.
 */
export function readNumPr(
  paragraphPropertyNodes: readonly OoxmlNode[]
): { numId: string; ilvl: number } | null {
  let numId: string | null = null;
  let ilvl = 0;
  for (const node of paragraphPropertyNodes) {
    const fields = numPrFieldsOf(node);
    if (!fields) continue;
    if (fields.numId !== undefined) numId = fields.numId;
    if (fields.ilvl !== undefined) {
      if (fields.ilvl === null) numId = null;
      else ilvl = fields.ilvl;
    }
  }
  return numId === null ? null : { numId, ilvl };
}

/**
 * Per-paragraph prelude for the story walk below, memoized on the paragraph NODE: which
 * `numPr` a paragraph resolves to — and the cascaded property tiers feeding its indent and
 * marker face — are pure functions of the immutable paragraph and the cascade table. An
 * edit republishes only the touched paragraphs, yet the resolver walks the WHOLE story per
 * keystroke; without this cache every unchanged paragraph re-ran the full style cascade
 * just to learn (usually) that it has no numbering. Only the counter advance is genuinely
 * sequential. `perLevel` holds level-derived indent/marker work, keyed on the level object
 * (identity-stable because `resolveNumberingStyleLinks` reuses the target's `levels` maps
 * by reference) — a WeakMap, so level objects orphaned by a numbering edit take their
 * entries with them.
 */
export interface ParagraphListPrelude {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly numPr: { readonly numId: string; readonly ilvl: number } | null;
  /** Properties below and above the numbering level, from `numberingLevelTiers`. */
  readonly belowLevel: readonly OoxmlProperty[];
  readonly aboveLevel: readonly OoxmlProperty[];
  readonly inheritedMarkProps: readonly OoxmlProperty[];
  /** Outline level 0-8 for a heading, null for body text. */
  readonly outlineLevel: number | null;
  readonly perLevel: WeakMap<
    object,
    { indent: NumberingLevelIndent; markerStyle: ResolvedRunStyle }
  >;
}
const paragraphListPreludes = new WeakMap<OoxmlElement, ParagraphListPrelude>();

export function paragraphListPrelude(
  paragraph: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined
): ParagraphListPrelude {
  const cached = paragraphListPreludes.get(paragraph);
  if (cached && cached.styleCascade === styleCascade) return cached;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const cascaded = styleCascade ? cascadeParagraphFormatting(styleCascade, pPr) : null;
  const nodes: readonly OoxmlNode[] = cascaded ? cascaded.paragraphPropertyNodes : pPr ? [pPr] : [];
  const directMarkRun = pPr && isElement(pPr) ? childNamed(pPr, 'rPr') : undefined;
  const numPr = readNumPr(nodes);
  // Only a list paragraph reads the tiers; skip the second style-chain walk for the rest.
  const tiers =
    numPr && styleCascade && cascaded
      ? numberingLevelTiers(styleCascade, cascaded.styleId, pPr)
      : { below: [], above: propertiesOf(pPr) };
  // The number takes the mark's formatting except its underline; only the level's own
  // `w:u` underlines it.
  const markProps = (cascaded ? cascaded.markRunProperties : propertiesOf(directMarkRun)).filter(
    (property) => property.localName !== 'u'
  );
  // An admitted separator hides its mark, not its heading number. Content and level
  // visibility remain independent, so an actually hidden list keeps its hidden marker.
  const inheritedMarkProps = styleSeparatorMembersOf(paragraph)
    ? [
        ...markProps.filter((property) => property.localName !== 'vanish'),
        ...(cascaded?.runProperties.filter((property) => property.localName === 'vanish') ?? []),
      ]
    : markProps;
  const prelude: ParagraphListPrelude = {
    styleCascade,
    numPr,
    belowLevel: tiers.below,
    aboveLevel: tiers.above,
    inheritedMarkProps,
    outlineLevel: resolveParagraphOutlineLevel(
      cascaded ? cascaded.paragraphProperties : propertiesOf(pPr),
      styleCascade,
      cascaded ? cascaded.styleId : styleIdFromProps(propertiesOf(pPr), 'pStyle')
    ),
    perLevel: new WeakMap(),
  };
  paragraphListPreludes.set(paragraph, prelude);
  return prelude;
}
