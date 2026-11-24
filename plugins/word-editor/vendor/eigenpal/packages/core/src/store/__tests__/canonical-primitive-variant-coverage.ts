// Journal coverage fixtures for every VARIANT the accepted vocabularies admit.
//
// The kind-level fixtures (`canonical-primitive-journal-coverage-ops.ts`) prove each op
// replicates with one representative value. These prove each MEMBER of the frozen
// vocabularies replicates: every accepted paragraph and run property, every image wrap
// target, every insertable content-control type. A new entry in any of those vocabularies
// with no fixture here fails the coverage gate — the forcing function that keeps
// collaboration able to express everything a single session can author.

import { TreePackageStore } from '../store/tree-package-store.ts';
import type { TreeDocOp } from '../store/tree-ops.ts';
import type { AcceptedParagraphProperty, AcceptedRunProperty } from '../store/tree-op-types.ts';
import type { ImageWrapTarget } from '../package/drawing-projection.ts';
import type { InsertableContentControlKind } from '../store/tree-op-content-controls.ts';
import {
  firstParagraphId,
  paragraphIds,
  PIC_URI,
  PNG,
  plainDoc,
  R,
  transactBody,
  W,
  walkNodes,
  zipDoc,
  type JournalCoverageFixture,
} from './canonical-primitive-journal-coverage-support.ts';

/** A body fixture whose journal proves one variant token replicates. */
export interface VariantFixture {
  readonly token: string;
  readonly fixture: JournalCoverageFixture;
  /**
   * The element localName the applied fixture must leave in the author tree.
   *
   * Convergence alone is not enough: a property authored as a flat `OoxmlProperty` that the
   * applier cannot express would create an EMPTY element (or none), and an empty change
   * converges to a document that expresses the variant nowhere — a passing gate proving
   * nothing. Naming the element the fixture must produce closes that: the gate asserts it is
   * present before it trusts the convergence. Set for the property vocabularies, where a token
   * IS a localName; the wrap and control fixtures assert convergence of a whole structural op
   * instead.
   */
  readonly expectLocalName?: string;
}

function bodyVariant(
  kind: JournalCoverageFixture['kind'],
  token: string,
  bytes: Uint8Array,
  op: (store: TreePackageStore) => TreeDocOp,
  expectLocalName?: string
): VariantFixture {
  return {
    token,
    fixture: { kind, bytes, apply: (store) => transactBody(store, op(store)) },
    ...(expectLocalName ? { expectLocalName } : {}),
  };
}

// --- Paragraph properties -------------------------------------------------------------------

const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
  '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function listDoc(): Uint8Array {
  return zipDoc({
    body:
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>Item</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p><w:sectPr/>',
    rels: `<Relationship Id="rIdN" Type="${R}/numbering" Target="numbering.xml"/>`,
    overrides:
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    extraXml: { 'word/numbering.xml': NUMBERING },
  });
}

/** Author one paragraph property through `setParagraphProperties`. */
function paraProp(
  token: AcceptedParagraphProperty,
  property: { readonly localName: string; readonly attributes?: Record<string, string> }
): VariantFixture {
  return bodyVariant(
    'setParagraphProperties',
    token,
    plainDoc(),
    (store) => ({
      op: 'setParagraphProperties',
      paragraphId: firstParagraphId(store),
      properties: [property],
    }),
    property.localName
  );
}

const PARAGRAPH_PROPERTY_FIXTURES: readonly VariantFixture[] = [
  paraProp('pStyle', { localName: 'pStyle', attributes: { val: 'Heading1' } }),
  paraProp('jc', { localName: 'jc', attributes: { val: 'center' } }),
  paraProp('spacing', {
    localName: 'spacing',
    attributes: { before: '240', after: '240', line: '360', lineRule: 'auto' },
  }),
  paraProp('ind', {
    localName: 'ind',
    attributes: { start: '720', end: '360', firstLine: '240' },
  }),
  paraProp('keepNext', { localName: 'keepNext' }),
  paraProp('keepLines', { localName: 'keepLines' }),
  paraProp('widowControl', { localName: 'widowControl', attributes: { val: 'false' } }),
  paraProp('pageBreakBefore', { localName: 'pageBreakBefore' }),
  paraProp('contextualSpacing', { localName: 'contextualSpacing' }),
  paraProp('bidi', { localName: 'bidi' }),
  paraProp('shd', {
    localName: 'shd',
    attributes: { val: 'clear', color: 'auto', fill: 'FFFF00' },
  }),
  // Child-carrying properties: `OoxmlProperty` is flat, so their dedicated ops author them.
  bodyVariant(
    'setParagraphTabStops',
    'tabs',
    plainDoc(),
    (store) => ({
      op: 'setParagraphTabStops',
      paragraphId: firstParagraphId(store),
      stops: [{ positionTwips: 1440, alignment: 'left' }],
    }),
    'tabs'
  ),
  bodyVariant(
    'setListNumbering',
    'numPr',
    listDoc(),
    (store) => ({
      op: 'setListNumbering',
      paragraphId: paragraphIds(store)[1]!,
      numId: '1',
      level: 0,
    }),
    'numPr'
  ),
];

// --- Run properties -------------------------------------------------------------------------

function runProp(
  token: AcceptedRunProperty,
  property: { readonly localName: string; readonly attributes?: Record<string, string> }
): VariantFixture {
  return bodyVariant(
    'setRunProperties',
    token,
    plainDoc(),
    (store) => ({
      op: 'setRunProperties',
      paragraphId: firstParagraphId(store),
      start: 0,
      end: 3,
      properties: [property],
    }),
    property.localName
  );
}

const RUN_PROPERTY_FIXTURES: readonly VariantFixture[] = [
  runProp('rFonts', { localName: 'rFonts', attributes: { ascii: 'Arial', hAnsi: 'Arial' } }),
  runProp('sz', { localName: 'sz', attributes: { val: '28' } }),
  runProp('szCs', { localName: 'szCs', attributes: { val: '28' } }),
  runProp('color', { localName: 'color', attributes: { val: 'FF0000' } }),
  runProp('b', { localName: 'b' }),
  runProp('bCs', { localName: 'bCs' }),
  runProp('i', { localName: 'i' }),
  runProp('iCs', { localName: 'iCs' }),
  runProp('u', { localName: 'u', attributes: { val: 'single' } }),
  runProp('strike', { localName: 'strike' }),
  runProp('dstrike', { localName: 'dstrike' }),
  runProp('highlight', { localName: 'highlight', attributes: { val: 'yellow' } }),
  runProp('vertAlign', { localName: 'vertAlign', attributes: { val: 'superscript' } }),
  runProp('position', { localName: 'position', attributes: { val: '6' } }),
  runProp('caps', { localName: 'caps' }),
  runProp('smallCaps', { localName: 'smallCaps' }),
  runProp('spacing', { localName: 'spacing', attributes: { val: '20' } }),
  runProp('w', { localName: 'w', attributes: { val: '150' } }),
  runProp('kern', { localName: 'kern', attributes: { val: '20' } }),
];

// --- Drawing wrap ---------------------------------------------------------------------------

const PIC =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId14"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm rot="0"><a:ext cx="152400" cy="152400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const ANCHOR_DRAWING =
  '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'behindDoc="0" locked="0" relativeHeight="1" allowOverlap="1" layoutInCell="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="152400" cy="152400"/><wp:wrapSquare wrapText="bothSides"/>' +
  '<wp:docPr id="2" name="float"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${PIC_URI}">${PIC}</a:graphicData></a:graphic>` +
  '</wp:anchor></w:drawing></w:r></w:p><w:p><w:r><w:t>y</w:t></w:r></w:p><w:sectPr/>';

function anchorDrawingDoc(): Uint8Array {
  return zipDoc({
    body: ANCHOR_DRAWING,
    rels: `<Relationship Id="rId14" Type="${R}/image" Target="media/image1.png"/>`,
    extraBytes: { 'word/media/image1.png': PNG },
  });
}

function drawingId(store: TreePackageStore): string {
  let found: string | undefined;
  walkNodes(store.bodyStore().part.root, (node) => {
    if (!found && node.kind === 'drawing') found = node.id;
  });
  if (!found) throw new Error('missing drawing');
  return found;
}

function wrapVariant(target: ImageWrapTarget): VariantFixture {
  return bodyVariant('setDrawingWrap', target, anchorDrawingDoc(), (store) => ({
    op: 'setDrawingWrap',
    drawingNodeId: drawingId(store),
    wrap: target,
  }));
}

// Every wrap target starts from an ANCHORED drawing, so `inline` is a real anchored→inline
// transition and the rest are anchor-shape changes.
const WRAP_FIXTURES: readonly VariantFixture[] = (
  [
    'inline',
    'square',
    'squareLeft',
    'squareRight',
    'tight',
    'through',
    'topAndBottom',
    'behind',
    'inFront',
  ] satisfies ImageWrapTarget[]
).map(wrapVariant);

// --- Content-control types ------------------------------------------------------------------

function controlVariant(type: InsertableContentControlKind): VariantFixture {
  return bodyVariant('insertContentControl', type, plainDoc(), (store) => ({
    op: 'insertContentControl',
    paragraphId: firstParagraphId(store),
    start: 0,
    end: 5,
    type,
  }));
}

const CONTENT_CONTROL_FIXTURES: readonly VariantFixture[] = (
  [
    'richText',
    'plainText',
    'dropDownList',
    'comboBox',
    'date',
  ] satisfies InsertableContentControlKind[]
).map(controlVariant);

/** Variant fixtures grouped by the vocabulary they cover. */
export function variantCoverageFixtures(): {
  readonly paragraphProperties: readonly VariantFixture[];
  readonly runProperties: readonly VariantFixture[];
  readonly wrapTargets: readonly VariantFixture[];
  readonly contentControlTypes: readonly VariantFixture[];
} {
  return {
    paragraphProperties: PARAGRAPH_PROPERTY_FIXTURES,
    runProperties: RUN_PROPERTY_FIXTURES,
    wrapTargets: WRAP_FIXTURES,
    contentControlTypes: CONTENT_CONTROL_FIXTURES,
  };
}
