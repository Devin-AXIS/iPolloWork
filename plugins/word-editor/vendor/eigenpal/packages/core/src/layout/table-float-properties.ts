// Bounded positioning and text-distance properties for top-level floating tables.
import {
  readTwipsMeasure,
  WML_NAMESPACE_URI,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
/**
 * `w:tblpPr/@w:horzAnchor` (17.4.58) and `@w:vertAnchor` (17.4.66): the box a floated
 * table's offsets are measured from. An absent horizontal anchor means `text`; an absent vertical anchor means `margin`.
 */
export type TableFloatAnchor = 'text' | 'margin' | 'page';

/** `w:tblpPr/@w:tblpXSpec` (17.4.63, ST_XAlign). */
export type TableFloatXSpec = 'left' | 'center' | 'right' | 'inside' | 'outside';

/** `w:tblpPr/@w:tblpYSpec` (17.4.65, ST_YAlign). */
export type TableFloatYSpec = 'inline' | 'top' | 'center' | 'bottom' | 'inside' | 'outside';

/**
 * `w:tblPr/w:tblpPr` (17.4.57) — a table positioned against an anchor box rather than at
 * the point in the text where it was authored.
 *
 * A spec (`tblpXSpec`/`tblpYSpec`) supersedes the matching offset when both are present:
 * 17.4.57 states the alignment outright, and the offset only answers "how far from the
 * anchor" for the case where no alignment was stated.
 */
export interface TableFloatPosition {
  readonly horzAnchor: TableFloatAnchor;
  readonly vertAnchor: TableFloatAnchor;
  readonly xSpec?: TableFloatXSpec;
  /** `w:tblpX` in points; signed, so a table can be pulled into the margin. */
  readonly xPt: number;
  readonly ySpec?: TableFloatYSpec;
  /** `w:tblpY` in points; signed. */
  readonly yPt: number;
  readonly distances?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    )
      return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
  )?.value;
}

/**
 * Ceiling on a `w:tblpX`/`w:tblpY` offset (~22"), matching the other bounded geometry
 * reads here. Both are signed, so the clamp is two-sided.
 */
const MAX_TABLE_FLOAT_OFFSET_PT = 31_680 / 20;

function readFloatAnchor(raw: string | undefined): TableFloatAnchor | undefined {
  if (raw === 'page') return 'page';
  if (raw === 'margin') return 'margin';
  if (raw === 'text') return 'text';
  return undefined;
}

function readSignedTwipsPt(raw: string | undefined, encodedOffset = false): number | undefined {
  const twips = readTwipsMeasure(raw);
  if (twips === null) return undefined;
  // Numeric table positions carry a one-twip storage bias (MS-OE376 2.1.163e).
  // Text clearances use ordinary twips, and an absent position has no bias.
  const pt = (twips - (encodedOffset ? 1 : 0)) / 20;
  return Math.max(-MAX_TABLE_FLOAT_OFFSET_PT, Math.min(MAX_TABLE_FLOAT_OFFSET_PT, pt));
}

/**
 * Read `w:tblpPr`. Absent anchors default to horizontal `text` and vertical `margin`; an unrecognised
 * spec is dropped rather than guessed at, which leaves the offset to place the table.
 */
export function readTableFloatPosition(
  container: OoxmlElement | undefined
): TableFloatPosition | undefined {
  const tblpPr =
    container?.namespaceUri === WML_NAMESPACE_URI ? childNamed(container, 'tblpPr') : undefined;
  if (!tblpPr) return undefined;
  const rawXSpec = attributeValue(tblpPr, 'tblpXSpec');
  const xSpec: TableFloatXSpec | undefined =
    rawXSpec === 'left' ||
    rawXSpec === 'center' ||
    rawXSpec === 'right' ||
    rawXSpec === 'inside' ||
    rawXSpec === 'outside'
      ? rawXSpec
      : undefined;
  const rawYSpec = attributeValue(tblpPr, 'tblpYSpec');
  const ySpec: TableFloatYSpec | undefined =
    rawYSpec === 'inline' ||
    rawYSpec === 'top' ||
    rawYSpec === 'center' ||
    rawYSpec === 'bottom' ||
    rawYSpec === 'inside' ||
    rawYSpec === 'outside'
      ? rawYSpec
      : undefined;
  // An omitted vertical anchor measures `w:tblpY` from the top margin, not from the text.
  const vertAnchor = readFloatAnchor(attributeValue(tblpPr, 'vertAnchor')) ?? 'margin';
  // Against the text, every `w:tblpYSpec` (17.4.65) puts the table at the top of its anchor
  // paragraph, and it still supersedes `w:tblpY`: the table floats there with no offset.
  const textAligned = ySpec !== undefined && vertAnchor === 'text';
  return {
    horzAnchor: readFloatAnchor(attributeValue(tblpPr, 'horzAnchor')) ?? 'text',
    vertAnchor,
    ...(xSpec ? { xSpec } : {}),
    xPt: readSignedTwipsPt(attributeValue(tblpPr, 'tblpX'), true) ?? 0,
    ...(ySpec && !textAligned ? { ySpec } : {}),
    yPt: textAligned ? 0 : (readSignedTwipsPt(attributeValue(tblpPr, 'tblpY'), true) ?? 0),
    ...(['topFromText', 'rightFromText', 'bottomFromText', 'leftFromText'].some(
      (name) => attributeValue(tblpPr, name) !== undefined
    )
      ? {
          distances: {
            top: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'topFromText')) ?? 0),
            right: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'rightFromText')) ?? 0),
            bottom: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'bottomFromText')) ?? 0),
            left: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'leftFromText')) ?? 0),
          },
        }
      : {}),
  };
}
