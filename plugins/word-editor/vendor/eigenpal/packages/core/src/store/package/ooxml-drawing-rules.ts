// Drawing vocabulary resolution and validation — shared by the read path and validateOoxmlPart.
//
// Kept apart from ooxml-shared.ts to avoid a module cycle: shared's validKnownKind calls in here,
// while the tree read path calls resolveDrawingElementKind and validateDrawingNode.

import type { OoxmlAttribute, OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

const WML_NAMESPACE_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const WPS_NAMESPACE_URI =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const DRAWINGML_MAIN_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const RELATIONSHIPS_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_GRAPHIC_DATA_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

/** Re-export the parse/digest depth authority for tests that assert the same bound. */
export { MAX_XML_DEPTH } from './xml-reader.ts';

/** ECMA-376 ST_PositionOffset (`xsd:int`). Values outside this range demote typed anchors. */
export const ST_POSITION_OFFSET_MIN = -2_147_483_648;
export const ST_POSITION_OFFSET_MAX = 2_147_483_647;

/** ECMA-376 ST_CoordinateUnqualified (`xsd:long` with schema min/max). */
export const ST_COORDINATE_MIN = -27_273_042_329_600;
export const ST_COORDINATE_MAX = 27_273_042_316_900;

/** ECMA-376 ST_PositiveCoordinate (`xsd:unsignedLong` with schema max). */
export const ST_POSITIVE_COORDINATE_MAX = 27_273_042_316_900;

const DRAWING_KINDS = new Set([
  'drawing',
  'inlineDrawing',
  'anchoredDrawing',
  'drawingExtent',
  'drawingEffectExtent',
  'drawingDocPr',
  'drawingGraphicFramePr',
  'drawingGraphic',
  'drawingGraphicData',
  'drawingSimplePos',
  'drawingPositionH',
  'drawingPositionV',
  'drawingPositionAlign',
  'drawingPositionOffset',
  'drawingWrapNone',
  'drawingWrapSquare',
  'drawingWrapTight',
  'drawingWrapThrough',
  'drawingWrapTopBottom',
  'drawingWrapPolygon',
  'drawingWrapPolygonStart',
  'drawingWrapPolygonLineTo',
  'picture',
  'pictureNvPicPr',
  'pictureBlipFill',
  'pictureBlip',
  'pictureSrcRect',
  'pictureStretch',
  'pictureTile',
  'pictureShapeProperties',
  'pictureTransform',
  'pictureTransformOffset',
  'pictureTransformExtent',
  'picturePresetGeometry',
]);

export const REL_FROM_H_VALUES = new Set([
  'character',
  'column',
  'insideMargin',
  'leftMargin',
  'margin',
  'outsideMargin',
  'page',
  'rightMargin',
]);
export const REL_FROM_V_VALUES = new Set([
  'bottomMargin',
  'insideMargin',
  'line',
  'margin',
  'outsideMargin',
  'page',
  'paragraph',
  'topMargin',
]);
const WRAP_TEXT_VALUES = new Set(['bothSides', 'left', 'right', 'largest']);
const ALIGN_H_VALUES = new Set(['center', 'inside', 'left', 'outside', 'right']);
const ALIGN_V_VALUES = new Set(['bottom', 'center', 'inside', 'outside', 'top']);

/** Maximum polygon vertices (one start + lineTo points) accepted under wrapTight/through. */
export const DRAWING_WRAP_POLYGON_MAX_POINTS = 512;

export interface DrawingParentContext {
  readonly wmlLocalName?: string;
  readonly kind?: string;
  readonly namespaceUri?: string;
  readonly localName?: string;
  readonly attributes?: readonly OoxmlAttribute[];
}

export function isDrawingKnownKind(kind: string): boolean {
  return DRAWING_KINDS.has(kind);
}

/** Whether a typed drawing kind is legal under its immediate parent's final kind/context. */
export function drawingKindLegalParent(kind: string, parent?: DrawingParentContext): boolean {
  if (!isDrawingKnownKind(kind)) return true;
  if (parent === undefined) return false;
  const parentKind = parent.kind;
  if (parentKind === 'generic') return false;

  switch (kind) {
    case 'drawing':
      return parent.wmlLocalName === 'r';
    case 'inlineDrawing':
    case 'anchoredDrawing':
      return parentKind === 'drawing';
    case 'drawingExtent':
    case 'drawingDocPr':
    case 'drawingGraphicFramePr':
    case 'drawingGraphic':
      return parentKind === 'inlineDrawing' || parentKind === 'anchoredDrawing';
    case 'drawingEffectExtent':
      return (
        parentKind === 'inlineDrawing' ||
        parentKind === 'anchoredDrawing' ||
        parentKind === 'drawingWrapSquare' ||
        parentKind === 'drawingWrapTopBottom'
      );
    case 'drawingSimplePos':
    case 'drawingPositionH':
    case 'drawingPositionV':
    case 'drawingWrapNone':
    case 'drawingWrapSquare':
    case 'drawingWrapTight':
    case 'drawingWrapThrough':
    case 'drawingWrapTopBottom':
      return parentKind === 'anchoredDrawing';
    case 'drawingPositionAlign':
    case 'drawingPositionOffset':
      return parentKind === 'drawingPositionH' || parentKind === 'drawingPositionV';
    case 'drawingWrapPolygon':
      return parentKind === 'drawingWrapTight' || parentKind === 'drawingWrapThrough';
    case 'drawingWrapPolygonStart':
    case 'drawingWrapPolygonLineTo':
      return parentKind === 'drawingWrapPolygon';
    case 'drawingGraphicData':
      return parentKind === 'drawingGraphic';
    case 'picture':
      return (
        parentKind === 'drawingGraphicData' &&
        parent.attributes !== undefined &&
        graphicDataUriIsPicture(parent.attributes)
      );
    case 'pictureNvPicPr':
    case 'pictureBlipFill':
    case 'pictureShapeProperties':
      return parentKind === 'picture';
    case 'pictureBlip':
    case 'pictureSrcRect':
    case 'pictureStretch':
    case 'pictureTile':
      return parentKind === 'pictureBlipFill';
    case 'pictureTransform':
    case 'picturePresetGeometry':
      return parentKind === 'pictureShapeProperties';
    case 'pictureTransformOffset':
    case 'pictureTransformExtent':
      return parentKind === 'pictureTransform';
    default:
      return false;
  }
}

/**
 * The fixed `whiteSpace="collapse"` facet of `xsd:boolean` and the numeric `xsd:` types
 * (`xsd:string`, e.g. `docPr/@descr`, preserves instead). XML 1.0's `S` is exactly
 * `#x20 | #x9 | #xD | #xA`; JavaScript's `\s` is wider (`\v`, `\f`, NBSP, U+FEFF) and would
 * accept what the schema does not.
 */
export function collapseSchemaWhitespace(value: string): string {
  return value.replace(/[ \t\n\r]+/g, ' ').trim();
}

export function parseSchemaBoolean(value: string | undefined): boolean | null {
  const lexical = collapseSchemaWhitespace(value ?? '');
  if (lexical === '1' || lexical === 'true') return true;
  if (lexical === '0' || lexical === 'false') return false;
  return null;
}

/** Schema-local attribute: unqualified only (no owner-namespace or foreign lookalikes). @internal */
export function schemaAttributeValue(
  attributes: readonly OoxmlAttribute[],
  localName: string
): string | undefined {
  for (const attribute of attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== '') continue;
    return attribute.value;
  }
  return undefined;
}

function relationshipAttributeValue(
  attributes: readonly OoxmlAttribute[],
  localName: 'embed' | 'link'
): string | undefined {
  for (const attribute of attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== RELATIONSHIPS_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

function parseSignedInteger(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function signedCoordinateAttribute(
  attributes: readonly OoxmlAttribute[],
  localName: string
): string | undefined {
  const value = schemaAttributeValue(attributes, localName);
  const parsed = parseSignedInteger(value);
  if (parsed === null) return undefined;
  if (parsed < ST_COORDINATE_MIN || parsed > ST_COORDINATE_MAX) return undefined;
  return value;
}

/** Signed polygon / effectExtent coordinates — ST_Coordinate range. */
function signedEmuAttribute(
  attributes: readonly OoxmlAttribute[],
  localName: string
): string | undefined {
  return signedCoordinateAttribute(attributes, localName);
}

function unsignedIntAttribute(
  attributes: readonly OoxmlAttribute[],
  localName: string
): string | undefined {
  const value = schemaAttributeValue(attributes, localName);
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffff_ffff) return undefined;
  return value;
}

function anchorAttributesValid(attributes: readonly OoxmlAttribute[]): boolean {
  for (const name of ['distT', 'distB', 'distL', 'distR'] as const) {
    const value = schemaAttributeValue(attributes, name);
    if (value !== undefined && unsignedIntAttribute(attributes, name) === undefined) return false;
  }
  if (unsignedIntAttribute(attributes, 'relativeHeight') === undefined) return false;
  // CT_Anchor's xsd:boolean attributes: `simplePos` and `hidden` optional, the rest required.
  for (const name of ['simplePos', 'hidden'] as const) {
    const value = schemaAttributeValue(attributes, name);
    if (value !== undefined && parseSchemaBoolean(value) === null) return false;
  }
  for (const name of ['behindDoc', 'locked', 'layoutInCell', 'allowOverlap'] as const) {
    if (parseSchemaBoolean(schemaAttributeValue(attributes, name)) === null) return false;
  }
  return true;
}

function nonNegativeEmuAttribute(
  attributes: readonly OoxmlAttribute[],
  localName: string
): string | undefined {
  const value = schemaAttributeValue(attributes, localName);
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > ST_POSITIVE_COORDINATE_MAX)
    return undefined;
  return value;
}

function numericPosOffset(children: readonly OoxmlNode[]): boolean {
  const offset = children.find((child) => child.kind === 'textValue');
  if (offset === undefined || offset.kind !== 'textValue') return false;
  const parsed = parseSignedInteger(offset.value);
  if (parsed === null) return false;
  return parsed >= ST_POSITION_OFFSET_MIN && parsed <= ST_POSITION_OFFSET_MAX;
}

function alignTextValid(
  kind: 'drawingPositionH' | 'drawingPositionV',
  children: readonly OoxmlNode[]
): boolean {
  const text = children.find((child) => child.kind === 'textValue');
  if (text === undefined || text.kind !== 'textValue') return false;
  const allowed = kind === 'drawingPositionH' ? ALIGN_H_VALUES : ALIGN_V_VALUES;
  return allowed.has(text.value.trim());
}

function graphicDataUriIsPicture(attributes: readonly OoxmlAttribute[]): boolean {
  return schemaAttributeValue(attributes, 'uri') === PIC_GRAPHIC_DATA_URI;
}

function countKind(children: readonly OoxmlNode[], kind: string): number {
  let count = 0;
  for (const child of children) {
    if (child.kind === kind) count += 1;
  }
  return count;
}

function graphicDataChildren(children: readonly OoxmlNode[]): number {
  let count = 0;
  for (const child of children) {
    if (child.kind === 'drawingGraphicData') count += 1;
    if (
      child.kind === 'generic' &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      child.localName === 'graphicData'
    ) {
      count += 1;
    }
  }
  return count;
}

function drawingAnchorCount(children: readonly OoxmlNode[]): number {
  let count = 0;
  for (const child of children) {
    if (child.kind === 'inlineDrawing' || child.kind === 'anchoredDrawing') count += 1;
    if (
      child.kind === 'generic' &&
      child.namespaceUri === WP_NAMESPACE_URI &&
      (child.localName === 'inline' || child.localName === 'anchor')
    ) {
      count += 1;
    }
  }
  return count;
}

const INLINE_ANCHOR_CHILD_KINDS = new Set([
  'drawingExtent',
  'drawingEffectExtent',
  'drawingDocPr',
  'drawingGraphicFramePr',
  'drawingGraphic',
  'drawingSimplePos',
  'drawingPositionH',
  'drawingPositionV',
  'drawingWrapNone',
  'drawingWrapSquare',
  'drawingWrapTight',
  'drawingWrapThrough',
  'drawingWrapTopBottom',
  'generic',
]);

const ANCHOR_ONLY_CHILD_KINDS = new Set([
  'drawingSimplePos',
  'drawingPositionH',
  'drawingPositionV',
  'drawingWrapNone',
  'drawingWrapSquare',
  'drawingWrapTight',
  'drawingWrapThrough',
  'drawingWrapTopBottom',
]);

const WRAP_KINDS = new Set([
  'drawingWrapNone',
  'drawingWrapSquare',
  'drawingWrapTight',
  'drawingWrapThrough',
  'drawingWrapTopBottom',
]);

const POSITION_H_V_CHILD_KINDS = new Set([
  'drawingPositionAlign',
  'drawingPositionOffset',
  'generic',
  'textValue',
]);

const POLYGON_CHILD_KINDS = new Set([
  'drawingWrapPolygonStart',
  'drawingWrapPolygonLineTo',
  'generic',
]);

const WRAP_SQUARE_CHILD_KINDS = new Set(['drawingEffectExtent', 'generic']);

const WRAP_TOP_BOTTOM_CHILD_KINDS = new Set(['drawingEffectExtent', 'generic']);

const WRAP_TIGHT_THROUGH_CHILD_KINDS = new Set(['drawingWrapPolygon', 'generic']);

function isWpEffectExtentChild(child: OoxmlNode): boolean {
  return (
    child.kind === 'drawingEffectExtent' ||
    (child.kind === 'generic' &&
      child.namespaceUri === WP_NAMESPACE_URI &&
      child.localName === 'effectExtent')
  );
}

function effectExtentAttributesValid(attributes: readonly OoxmlAttribute[]): boolean {
  return (
    signedEmuAttribute(attributes, 'l') !== undefined &&
    signedEmuAttribute(attributes, 't') !== undefined &&
    signedEmuAttribute(attributes, 'r') !== undefined &&
    signedEmuAttribute(attributes, 'b') !== undefined
  );
}

function wrapEffectExtentChildrenValid(children: readonly OoxmlNode[]): boolean {
  const effectExtents = children.filter(isWpEffectExtentChild);
  if (effectExtents.length > 1) return false;
  for (const child of effectExtents) {
    if (child.kind === 'textValue') return false;
    if (!effectExtentAttributesValid(child.attributes)) return false;
  }
  return true;
}

function wrapDisallowsEffectExtent(children: readonly OoxmlNode[]): boolean {
  return !children.some(isWpEffectExtentChild);
}

const PICTURE_CHILD_KINDS = new Set([
  'pictureNvPicPr',
  'pictureBlipFill',
  'pictureShapeProperties',
  'generic',
]);

const BLIP_FILL_CHILD_KINDS = new Set([
  'pictureBlip',
  'pictureSrcRect',
  'pictureStretch',
  'pictureTile',
  'generic',
]);

const SHAPE_PROPERTIES_CHILD_KINDS = new Set([
  'pictureTransform',
  'picturePresetGeometry',
  'generic',
]);

const TRANSFORM_CHILD_KINDS = new Set([
  'pictureTransformOffset',
  'pictureTransformExtent',
  'generic',
]);

function wrapPolygonStructureValid(children: readonly OoxmlNode[]): boolean {
  if (countKind(children, 'drawingWrapPolygonStart') !== 1) return false;

  let pointCount = 0;
  let seenLineTo = false;
  for (const child of children) {
    if (child.kind === 'generic') continue;
    if (!POLYGON_CHILD_KINDS.has(child.kind)) return false;
    if (child.kind === 'drawingWrapPolygonStart') {
      if (seenLineTo || pointCount > 0) return false;
      pointCount += 1;
      continue;
    }
    if (child.kind === 'drawingWrapPolygonLineTo') {
      if (pointCount === 0) return false;
      seenLineTo = true;
      pointCount += 1;
    }
  }
  if (pointCount < 3) return false;
  if (pointCount > DRAWING_WRAP_POLYGON_MAX_POINTS) return false;
  const firstTyped = children.find(
    (child) => child.kind === 'drawingWrapPolygonStart' || child.kind === 'drawingWrapPolygonLineTo'
  );
  return firstTyped?.kind === 'drawingWrapPolygonStart';
}

function wrapTextAttributesValid(attributes: readonly OoxmlAttribute[]): boolean {
  const wrapText = schemaAttributeValue(attributes, 'wrapText');
  return wrapText !== undefined && WRAP_TEXT_VALUES.has(wrapText);
}

const ANCHOR_REQUIRED_CHILD_SEQUENCE = [
  'drawingSimplePos',
  'drawingPositionH',
  'drawingPositionV',
  'drawingExtent',
] as const;

const WP14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';

/**
 * Word 2010 drawing-extension trailing children of `wp:anchor` (`wp14:sizeRelH` /
 * `wp14:sizeRelV`). Word emits them on ordinary anchored pictures; they stay generic
 * (preserved, ignored by layout) and must not demote the typed anchor.
 */
function anchorSizeRelKind(child: OoxmlNode): 'drawingSizeRelH' | 'drawingSizeRelV' | null {
  if (child.kind !== 'generic') return null;
  if (child.namespaceUri !== WP14_NAMESPACE_URI) return null;
  if (child.localName === 'sizeRelH') return 'drawingSizeRelH';
  if (child.localName === 'sizeRelV') return 'drawingSizeRelV';
  return null;
}

function anchorChildKind(child: OoxmlNode): string | null {
  if (child.kind === 'drawingSimplePos') return 'drawingSimplePos';
  if (child.kind === 'drawingPositionH') return 'drawingPositionH';
  if (child.kind === 'drawingPositionV') return 'drawingPositionV';
  if (child.kind === 'drawingExtent') return 'drawingExtent';
  if (child.kind === 'drawingEffectExtent') return 'drawingEffectExtent';
  if (WRAP_KINDS.has(child.kind)) return 'drawingWrap';
  if (child.kind === 'drawingDocPr') return 'drawingDocPr';
  if (child.kind === 'drawingGraphicFramePr') return 'drawingGraphicFramePr';
  if (child.kind === 'drawingGraphic') return 'drawingGraphic';
  if (child.kind !== 'generic') return null;
  if (child.namespaceUri !== WP_NAMESPACE_URI) return null;
  switch (child.localName) {
    case 'simplePos':
      return 'drawingSimplePos';
    case 'positionH':
      return 'drawingPositionH';
    case 'positionV':
      return 'drawingPositionV';
    case 'extent':
      return 'drawingExtent';
    case 'effectExtent':
      return 'drawingEffectExtent';
    case 'wrapNone':
    case 'wrapSquare':
    case 'wrapTight':
    case 'wrapThrough':
    case 'wrapTopAndBottom':
      return 'drawingWrap';
    case 'docPr':
      return 'drawingDocPr';
    case 'cNvGraphicFramePr':
      return 'drawingGraphicFramePr';
    case 'graphic':
      return 'drawingGraphic';
    default:
      return null;
  }
}

function anchoredDrawingChildrenValid(children: readonly OoxmlNode[]): boolean {
  if (countKind(children, 'drawingExtent') !== 1) return false;
  if (countKind(children, 'drawingGraphic') !== 1) return false;
  if (!wrapEffectExtentChildrenValid(children)) return false;
  if (countKind(children, 'drawingDocPr') !== 1) return false;
  if (countKind(children, 'drawingGraphicFramePr') > 1) return false;
  if (countKind(children, 'drawingSimplePos') !== 1) return false;
  if (countKind(children, 'drawingPositionH') !== 1) return false;
  if (countKind(children, 'drawingPositionV') !== 1) return false;

  let wrapCount = 0;
  for (const child of children) {
    if (!INLINE_ANCHOR_CHILD_KINDS.has(child.kind) && anchorSizeRelKind(child) === null) {
      return false;
    }
    if (WRAP_KINDS.has(child.kind)) wrapCount += 1;
  }
  if (wrapCount !== 1) return false;

  const extent = children.find((child) => child.kind === 'drawingExtent');
  if (extent === undefined || extent.kind !== 'drawingExtent') return false;
  if (
    nonNegativeEmuAttribute(extent.attributes, 'cx') === undefined ||
    nonNegativeEmuAttribute(extent.attributes, 'cy') === undefined
  ) {
    return false;
  }

  const sequence: string[] = [];
  for (const child of children) {
    const kind = anchorSizeRelKind(child) ?? anchorChildKind(child);
    if (kind === null) return false;
    sequence.push(
      kind === 'drawingWrapSquare' ||
        kind === 'drawingWrapNone' ||
        kind === 'drawingWrapTight' ||
        kind === 'drawingWrapThrough' ||
        kind === 'drawingWrapTopBottom'
        ? 'drawingWrap'
        : kind
    );
  }

  let index = 0;
  for (const required of ANCHOR_REQUIRED_CHILD_SEQUENCE) {
    if (sequence[index] !== required) return false;
    index += 1;
  }
  if (sequence[index] === 'drawingEffectExtent') index += 1;
  if (sequence[index] !== 'drawingWrap') return false;
  index += 1;
  if (sequence[index] !== 'drawingDocPr') return false;
  index += 1;
  if (sequence[index] === 'drawingGraphicFramePr') index += 1;
  if (sequence[index] !== 'drawingGraphic') return false;
  index += 1;
  // CT_Anchor 2010 extensions: optional sizeRelH, then optional sizeRelV, both trailing.
  if (sequence[index] === 'drawingSizeRelH') index += 1;
  if (sequence[index] === 'drawingSizeRelV') index += 1;
  return index === sequence.length;
}

function inlineAnchorChildrenValid(
  kind: 'inlineDrawing' | 'anchoredDrawing',
  children: readonly OoxmlNode[]
): boolean {
  if (kind === 'anchoredDrawing') return anchoredDrawingChildrenValid(children);
  if (countKind(children, 'drawingExtent') !== 1) return false;
  if (countKind(children, 'drawingGraphic') !== 1) return false;
  if (!wrapEffectExtentChildrenValid(children)) return false;
  if (countKind(children, 'drawingDocPr') > 1) return false;
  if (countKind(children, 'drawingGraphicFramePr') > 1) return false;

  let wrapCount = 0;
  for (const child of children) {
    if (!INLINE_ANCHOR_CHILD_KINDS.has(child.kind)) return false;
    if (ANCHOR_ONLY_CHILD_KINDS.has(child.kind)) return false;
    if (WRAP_KINDS.has(child.kind)) wrapCount += 1;
  }

  const extent = children.find((child) => child.kind === 'drawingExtent');
  if (extent === undefined || extent.kind !== 'drawingExtent') return false;
  if (
    nonNegativeEmuAttribute(extent.attributes, 'cx') === undefined ||
    nonNegativeEmuAttribute(extent.attributes, 'cy') === undefined
  ) {
    return false;
  }
  return true;
}

function positionChoiceValid(children: readonly OoxmlNode[]): boolean {
  const align = countKind(children, 'drawingPositionAlign');
  const offset = countKind(children, 'drawingPositionOffset');
  if (align + offset !== 1) return false;
  return children.every((child) => POSITION_H_V_CHILD_KINDS.has(child.kind));
}

function docPrNonvisualChildValid(child: OoxmlNode): boolean {
  if (child.kind !== 'generic') return false;
  if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
  return (
    child.localName === 'hlinkClick' ||
    child.localName === 'hlinkHover' ||
    child.localName === 'extLst'
  );
}

function picNonvisualDrawingPropsValid(child: OoxmlNode): boolean {
  if (child.kind !== 'generic') return false;
  if (child.namespaceUri !== PIC_NAMESPACE_URI || child.localName !== 'cNvPr') return false;
  if (unsignedIntAttribute(child.attributes, 'id') === undefined) return false;
  return schemaAttributeValue(child.attributes, 'name') !== undefined;
}

function pictureNvPicPrChildrenValid(children: readonly OoxmlNode[]): boolean {
  if (children.length !== 2) return false;
  const [cNvPr, cNvPicPr] = children;
  if (!picNonvisualDrawingPropsValid(cNvPr)) return false;
  return (
    cNvPicPr.kind === 'generic' &&
    cNvPicPr.namespaceUri === PIC_NAMESPACE_URI &&
    cNvPicPr.localName === 'cNvPicPr'
  );
}

function pictureChildSequenceValid(children: readonly OoxmlNode[]): boolean {
  const typed = children.filter((child) => child.kind !== 'generic');
  if (typed.length !== 3) return false;
  return (
    typed[0]!.kind === 'pictureNvPicPr' &&
    typed[1]!.kind === 'pictureBlipFill' &&
    typed[2]!.kind === 'pictureShapeProperties'
  );
}

function drawingChildStructureValid(kind: string, children: readonly OoxmlNode[]): boolean {
  switch (kind) {
    case 'drawing':
      return (
        countKind(children, 'inlineDrawing') + countKind(children, 'anchoredDrawing') === 1 &&
        children.every(
          (child) =>
            child.kind === 'inlineDrawing' ||
            child.kind === 'anchoredDrawing' ||
            child.kind === 'generic'
        )
      );
    case 'inlineDrawing':
      return inlineAnchorChildrenValid('inlineDrawing', children);
    case 'anchoredDrawing':
      return inlineAnchorChildrenValid('anchoredDrawing', children);
    case 'drawingGraphic':
      return graphicDataChildren(children) === 1;
    case 'pictureBlipFill':
      return countKind(children, 'pictureBlip') === 1;
    default:
      return true;
  }
}

export function validDrawingKnownKind(kind: string, children: readonly OoxmlNode[]): boolean {
  if (!isDrawingKnownKind(kind)) return false;
  return drawingChildStructureValid(kind, children);
}

export function validateDrawingNode(
  kind: string,
  localName: string,
  attributes: readonly OoxmlAttribute[],
  children: readonly OoxmlNode[],
  parent?: DrawingParentContext
): boolean {
  if (!isDrawingKnownKind(kind)) return true;
  if (!drawingKindLegalParent(kind, parent)) return false;
  if (!drawingChildStructureValid(kind, children)) return false;

  if (kind === 'drawing') {
    if (localName !== 'drawing') return false;
    const typedAnchors =
      countKind(children, 'inlineDrawing') + countKind(children, 'anchoredDrawing');
    return typedAnchors === 1 && drawingAnchorCount(children) === 1;
  }

  if (kind === 'inlineDrawing') {
    return localName === 'inline' && inlineAnchorChildrenValid('inlineDrawing', children);
  }

  if (kind === 'anchoredDrawing') {
    return (
      localName === 'anchor' &&
      anchorAttributesValid(attributes) &&
      inlineAnchorChildrenValid('anchoredDrawing', children)
    );
  }

  if (kind === 'drawingExtent') {
    return (
      localName === 'extent' &&
      nonNegativeEmuAttribute(attributes, 'cx') !== undefined &&
      nonNegativeEmuAttribute(attributes, 'cy') !== undefined &&
      children.length === 0
    );
  }

  if (kind === 'drawingEffectExtent') {
    return (
      localName === 'effectExtent' &&
      effectExtentAttributesValid(attributes) &&
      children.length === 0
    );
  }

  if (kind === 'drawingGraphicFramePr') {
    if (localName !== 'cNvGraphicFramePr') return false;
    let lockCount = 0;
    for (const child of children) {
      if (child.kind !== 'generic') return false;
      if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
      if (child.localName === 'graphicFrameLocks') {
        lockCount += 1;
        continue;
      }
      if (child.localName === 'extLst') continue;
      return false;
    }
    return lockCount <= 1;
  }

  if (kind === 'drawingDocPr') {
    return children.every((child) => docPrNonvisualChildValid(child));
  }

  if (kind === 'drawingGraphic') {
    return (
      localName === 'graphic' &&
      countKind(children, 'drawingGraphicData') <= 1 &&
      children.every((child) => child.kind === 'drawingGraphicData' || child.kind === 'generic')
    );
  }

  if (kind === 'drawingGraphicData') {
    return (
      localName === 'graphicData' &&
      graphicDataUriIsPicture(attributes) &&
      countKind(children, 'picture') <= 1 &&
      children.every((child) => child.kind === 'picture' || child.kind === 'generic')
    );
  }

  if (kind === 'drawingSimplePos') {
    return (
      localName === 'simplePos' &&
      signedCoordinateAttribute(attributes, 'x') !== undefined &&
      signedCoordinateAttribute(attributes, 'y') !== undefined &&
      children.length === 0
    );
  }

  if (kind === 'drawingPositionH') {
    const relativeFrom = schemaAttributeValue(attributes, 'relativeFrom');
    if (localName !== 'positionH') return false;
    if (relativeFrom === undefined || !REL_FROM_H_VALUES.has(relativeFrom)) return false;
    if (!positionChoiceValid(children)) return false;
    const alignNode = children.find((child) => child.kind === 'drawingPositionAlign');
    const offsetNode = children.find((child) => child.kind === 'drawingPositionOffset');
    if (alignNode !== undefined && !alignTextValid('drawingPositionH', alignNode.children))
      return false;
    if (offsetNode !== undefined && !numericPosOffset(offsetNode.children)) return false;
    return true;
  }

  if (kind === 'drawingPositionV') {
    const relativeFrom = schemaAttributeValue(attributes, 'relativeFrom');
    if (localName !== 'positionV') return false;
    if (relativeFrom === undefined || !REL_FROM_V_VALUES.has(relativeFrom)) return false;
    if (!positionChoiceValid(children)) return false;
    const alignNode = children.find((child) => child.kind === 'drawingPositionAlign');
    const offsetNode = children.find((child) => child.kind === 'drawingPositionOffset');
    if (alignNode !== undefined && !alignTextValid('drawingPositionV', alignNode.children))
      return false;
    if (offsetNode !== undefined && !numericPosOffset(offsetNode.children)) return false;
    return true;
  }

  if (kind === 'drawingWrapNone') {
    return (
      localName === 'wrapNone' &&
      countKind(children, 'drawingWrapPolygon') === 0 &&
      wrapDisallowsEffectExtent(children)
    );
  }

  if (kind === 'drawingWrapSquare') {
    return (
      localName === 'wrapSquare' &&
      countKind(children, 'drawingWrapPolygon') === 0 &&
      wrapEffectExtentChildrenValid(children) &&
      children.every((child) => WRAP_SQUARE_CHILD_KINDS.has(child.kind)) &&
      wrapTextAttributesValid(attributes)
    );
  }

  if (kind === 'drawingWrapTopBottom') {
    return (
      localName === 'wrapTopAndBottom' &&
      countKind(children, 'drawingWrapPolygon') === 0 &&
      wrapEffectExtentChildrenValid(children) &&
      children.every((child) => WRAP_TOP_BOTTOM_CHILD_KINDS.has(child.kind))
    );
  }

  if (kind === 'drawingWrapTight' || kind === 'drawingWrapThrough') {
    const expectedLocal = kind === 'drawingWrapTight' ? 'wrapTight' : 'wrapThrough';
    const polygonCount = countKind(children, 'drawingWrapPolygon');
    if (polygonCount !== 1) return false;
    if (localName !== expectedLocal) return false;
    if (!wrapTextAttributesValid(attributes)) return false;
    if (!wrapDisallowsEffectExtent(children)) return false;
    if (!children.every((child) => WRAP_TIGHT_THROUGH_CHILD_KINDS.has(child.kind))) return false;
    const polygon = children.find((child) => child.kind === 'drawingWrapPolygon');
    return polygon !== undefined && wrapPolygonStructureValid(polygon.children);
  }

  if (kind === 'drawingPositionAlign' || kind === 'drawingPositionOffset') {
    if (localName !== (kind === 'drawingPositionAlign' ? 'align' : 'posOffset')) return false;
    return children.every((child) => child.kind === 'textValue' || child.kind === 'generic');
  }

  if (kind === 'drawingWrapPolygon') {
    return localName === 'wrapPolygon' && wrapPolygonStructureValid(children);
  }

  if (kind === 'drawingWrapPolygonStart' || kind === 'drawingWrapPolygonLineTo') {
    const expectedLocal = kind === 'drawingWrapPolygonStart' ? 'start' : 'lineTo';
    return (
      localName === expectedLocal &&
      signedEmuAttribute(attributes, 'x') !== undefined &&
      signedEmuAttribute(attributes, 'y') !== undefined &&
      children.length === 0
    );
  }

  if (kind === 'picture') {
    return (
      localName === 'pic' &&
      children.every((child) => PICTURE_CHILD_KINDS.has(child.kind)) &&
      countKind(children, 'pictureNvPicPr') === 1 &&
      countKind(children, 'pictureBlipFill') === 1 &&
      countKind(children, 'pictureShapeProperties') === 1 &&
      pictureChildSequenceValid(children)
    );
  }

  if (kind === 'pictureNvPicPr') {
    return localName === 'nvPicPr' && pictureNvPicPrChildrenValid(children);
  }

  if (kind === 'pictureBlipFill') {
    const stretchCount = countKind(children, 'pictureStretch');
    const tileCount = countKind(children, 'pictureTile');
    return (
      localName === 'blipFill' &&
      children.every((child) => BLIP_FILL_CHILD_KINDS.has(child.kind)) &&
      countKind(children, 'pictureBlip') === 1 &&
      countKind(children, 'pictureSrcRect') <= 1 &&
      // `EG_FillModeProperties` is minOccurs="0" in CT_BlipFillProperties (dml-main), so a
      // blipFill with neither `a:stretch` nor `a:tile` is valid and means the default fill.
      // Demanding one demoted the whole `pic:pic` to generic, i.e. the image vanished.
      stretchCount + tileCount <= 1
    );
  }

  if (kind === 'pictureBlip') {
    const embed = relationshipAttributeValue(attributes, 'embed');
    const link = relationshipAttributeValue(attributes, 'link');
    // CT_Blip makes both optional. With both, the embedded copy is the picture shown and the
    // link only names its source, which is never loaded.
    if (embed === undefined && link === undefined) return false;
    return localName === 'blip' && children.every((child) => child.kind === 'generic');
  }

  if (kind === 'pictureSrcRect') {
    return localName === 'srcRect' && children.length === 0;
  }

  if (kind === 'pictureStretch' || kind === 'pictureTile') {
    const expectedLocal = kind === 'pictureStretch' ? 'stretch' : 'tile';
    return localName === expectedLocal && children.every((child) => child.kind === 'generic');
  }

  if (kind === 'pictureShapeProperties') {
    return (
      localName === 'spPr' &&
      children.every((child) => SHAPE_PROPERTIES_CHILD_KINDS.has(child.kind)) &&
      // Both `a:xfrm` and the `EG_Geometry` group are minOccurs="0" in CT_ShapeProperties
      // (dml-main), so an spPr carrying neither is valid — an unrotated picture that takes
      // its size from `wp:extent` authors nothing here.
      countKind(children, 'pictureTransform') <= 1 &&
      countKind(children, 'picturePresetGeometry') <= 1
    );
  }

  if (kind === 'pictureTransform') {
    return (
      localName === 'xfrm' &&
      children.every((child) => TRANSFORM_CHILD_KINDS.has(child.kind)) &&
      countKind(children, 'pictureTransformOffset') <= 1 &&
      countKind(children, 'pictureTransformExtent') <= 1
    );
  }

  if (kind === 'pictureTransformOffset') {
    return (
      localName === 'off' &&
      signedEmuAttribute(attributes, 'x') !== undefined &&
      signedEmuAttribute(attributes, 'y') !== undefined &&
      children.length === 0
    );
  }

  if (kind === 'pictureTransformExtent') {
    return (
      localName === 'ext' &&
      nonNegativeEmuAttribute(attributes, 'cx') !== undefined &&
      nonNegativeEmuAttribute(attributes, 'cy') !== undefined &&
      children.length === 0
    );
  }

  if (kind === 'picturePresetGeometry') {
    return localName === 'prstGeom' && children.every((child) => child.kind === 'generic');
  }

  return false;
}

/** @deprecated Use validateDrawingNode — kept for import stability within the worktree. */
export const drawingKindCompatible = validateDrawingNode;

export function resolveDrawingElementKind(
  namespaceUri: string,
  localName: string,
  parent?: DrawingParentContext
): string | null {
  if (namespaceUri === WML_NAMESPACE_URI && localName === 'drawing') {
    return parent?.wmlLocalName === 'r' ? 'drawing' : 'generic';
  }
  if (namespaceUri === WP_NAMESPACE_URI) {
    if (parent?.kind === 'drawing') {
      if (localName === 'inline') return 'inlineDrawing';
      if (localName === 'anchor') return 'anchoredDrawing';
    }
    if (parent?.kind === 'inlineDrawing' || parent?.kind === 'anchoredDrawing') {
      if (localName === 'extent') return 'drawingExtent';
      if (localName === 'effectExtent') return 'drawingEffectExtent';
      if (localName === 'docPr') return 'drawingDocPr';
      if (localName === 'cNvGraphicFramePr') return 'drawingGraphicFramePr';
      if (localName === 'simplePos' && parent.kind === 'anchoredDrawing') return 'drawingSimplePos';
      if (localName === 'positionH' && parent.kind === 'anchoredDrawing') return 'drawingPositionH';
      if (localName === 'positionV' && parent.kind === 'anchoredDrawing') return 'drawingPositionV';
      if (localName === 'wrapNone' && parent.kind === 'anchoredDrawing') return 'drawingWrapNone';
      if (localName === 'wrapSquare' && parent.kind === 'anchoredDrawing')
        return 'drawingWrapSquare';
      if (localName === 'wrapTight' && parent.kind === 'anchoredDrawing') return 'drawingWrapTight';
      if (localName === 'wrapThrough' && parent.kind === 'anchoredDrawing')
        return 'drawingWrapThrough';
      if (localName === 'wrapTopAndBottom' && parent.kind === 'anchoredDrawing') {
        return 'drawingWrapTopBottom';
      }
    }
    if (parent?.kind === 'drawingPositionH' || parent?.kind === 'drawingPositionV') {
      if (localName === 'align') return 'drawingPositionAlign';
      if (localName === 'posOffset') return 'drawingPositionOffset';
    }
    if (parent?.kind === 'drawingWrapTight' || parent?.kind === 'drawingWrapThrough') {
      if (localName === 'wrapPolygon') return 'drawingWrapPolygon';
    }
    if (parent?.kind === 'drawingWrapSquare' || parent?.kind === 'drawingWrapTopBottom') {
      if (localName === 'effectExtent') return 'drawingEffectExtent';
    }
    if (parent?.kind === 'drawingWrapPolygon') {
      if (localName === 'start') return 'drawingWrapPolygonStart';
      if (localName === 'lineTo') return 'drawingWrapPolygonLineTo';
    }
    return null;
  }
  if (namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI) {
    if (
      (parent?.kind === 'inlineDrawing' || parent?.kind === 'anchoredDrawing') &&
      localName === 'graphic'
    ) {
      return 'drawingGraphic';
    }
    if (parent?.kind === 'drawingGraphic' && localName === 'graphicData') {
      return 'drawingGraphicData';
    }
    if (parent?.kind === 'pictureBlipFill') {
      if (localName === 'blip') return 'pictureBlip';
      if (localName === 'srcRect') return 'pictureSrcRect';
      if (localName === 'stretch') return 'pictureStretch';
      if (localName === 'tile') return 'pictureTile';
    }
    if (parent?.kind === 'pictureTransform') {
      if (localName === 'off') return 'pictureTransformOffset';
      if (localName === 'ext') return 'pictureTransformExtent';
    }
    if (parent?.kind === 'pictureShapeProperties') {
      if (localName === 'xfrm') return 'pictureTransform';
      if (localName === 'prstGeom') return 'picturePresetGeometry';
    }
    return null;
  }
  if (namespaceUri === PIC_NAMESPACE_URI) {
    if (parent?.kind === 'drawingGraphicData' && localName === 'pic') {
      if (parent.attributes !== undefined && graphicDataUriIsPicture(parent.attributes)) {
        return 'picture';
      }
      return 'generic';
    }
    if (parent?.kind === 'picture') {
      if (localName === 'nvPicPr') return 'pictureNvPicPr';
      if (localName === 'blipFill') return 'pictureBlipFill';
      if (localName === 'spPr') return 'pictureShapeProperties';
    }
    return null;
  }
  return null;
}

/**
 * Whether a node opens a WML story that a drawing merely HOSTS.
 *
 * `w:txbxContent` is not part of the DrawingML grammar around it: it is ordinary body
 * content — paragraphs, runs, and drawings of their own — that happens to live inside a
 * shape.
 */
/** Just enough of the parent to place a node; the tree node itself may not exist yet. */
type DemotionParent = { readonly namespaceUri: string; readonly localName: string };

function opensHostedWmlStory(node: OoxmlElement, parent: DemotionParent | undefined): boolean {
  return (
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'txbxContent' &&
    parent?.namespaceUri === WPS_NAMESPACE_URI &&
    parent.localName === 'txbx'
  );
}

/**
 * Demote every typed drawing kind under a generic parent subtree.
 *
 * Stops at a hosted WML story. A text box is a `wps:wsp` under an `a:graphicData` whose uri
 * is not the picture one, so that graphicData is correctly not a typed `drawingGraphicData`
 * and demotes — but its story is a separate grammar, and cascading into it stripped the
 * typed `w:drawing` off a picture INSIDE the box. Nothing then recognized that picture as a
 * drawing atom: no projection, no resource, nothing painted.
 *
 * The carve-out is positional, not name-only: only a `w:txbxContent` directly under a
 * `wps:txbx` opens a story. A stray element of that name planted anywhere else in a failed
 * drawing subtree demotes like everything around it.
 */
export function demoteDrawingKindsInSubtree(
  children: readonly OoxmlNode[],
  parent?: DemotionParent
): readonly OoxmlNode[] {
  return children.map((child) => {
    if (child.kind === 'textValue') return child;
    if (opensHostedWmlStory(child, parent)) return child;
    const nextKind = isDrawingKnownKind(child.kind) ? 'generic' : child.kind;
    return {
      ...child,
      kind: nextKind,
      children: demoteDrawingKindsInSubtree(child.children, child),
    } as OoxmlElement;
  });
}
