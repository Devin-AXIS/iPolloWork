// Shared reads for a `wpg:wgp` drawing group: the graphic payload lookup, the group's child
// coordinate space, and the fail-closed `a:xfrm` scalar tests its members share. The vector
// projection and the group picture projection both read a group through here, so the two
// agree on which groups they accept and where each member lands.

import { findDirectChild, parseEmu, readSize } from './drawing-shape-readers.ts';
import { isElement, findDirectKind } from './drawing-projection-walk.ts';
import {
  collapseSchemaWhitespace,
  parseSchemaBoolean,
  schemaAttributeValue,
} from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { shapeRotationDegrees } from './drawing-shape-geometry.ts';

export const WPG_NAMESPACE_URI =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPG_GRAPHIC_DATA_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** The most members one group may carry before its projection refuses it. */
export const MAX_GROUP_SHAPE_CHILDREN = 128;

/**
 * An `xsd:boolean` attribute read fail-closed.
 *
 * Only a legal `0`/`false` and an absent attribute mean "not set"; every other spelling —
 * `TRUE`, `yes`, `2` — is schema-invalid, and the sender chose it, so it refuses the shape
 * rather than painting as if the flag were unset. The collapse inside
 * {@link parseSchemaBoolean} is load-bearing here: comparing the raw string would refuse a
 * shape Word paints, which is the one way a fail-closed read can be worse than the
 * permissive one it replaced.
 */
export function schemaFlagIsUnset(value: string | undefined): boolean {
  return value === undefined || parseSchemaBoolean(value) === false;
}

/**
 * The complement of {@link schemaFlagIsUnset}: an `xsd:boolean` that legally reads true.
 *
 * A value that is neither set nor unset is schema-invalid. The `a:xfrm` check refuses the
 * shape on one, so the flip reads further down only ever see a legal spelling. A picture
 * flip, which the engine can paint either way, does not go through here: it reads
 * `parseSchemaBoolean(...) ?? false` and treats an invalid spelling as unset rather than
 * dropping the picture.
 */
export function schemaFlagIsSet(value: string | undefined): boolean {
  return parseSchemaBoolean(value) === true;
}

/**
 * `rot` on an `a:xfrm`, tested for "not rotated".
 *
 * `ST_Angle` derives from `xsd:int`, so it carries the same collapse facet as `xsd:boolean`
 * and the same freedom over sign and leading zeros: ` 0 `, `00`, `+0` and `-0` are all a
 * zero rotation. Comparing the raw string to `'0'` refused every one of them and dropped the
 * shape to a placeholder. A non-zero angle still refuses where the caller does not accept a
 * turn, and so does anything that is not a legal `xsd:int`.
 */
export function schemaAngleIsZero(value: string | undefined): boolean {
  if (value === undefined) return true;
  const collapsed = collapseSchemaWhitespace(value);
  // Bounded digit count: `rot` is an int, and this only ever compares it against zero.
  return /^[+-]?\d{1,12}$/.test(collapsed) && Number(collapsed) === 0;
}

/** @internal */
export function findGraphicData(anchor: OoxmlElement): OoxmlElement | null {
  // Non-picture graphic payloads demote to generic nodes even under a typed
  // `drawingGraphic`, so the generic lookup is always in play here.
  const graphic =
    findDirectKind(anchor.children, 'drawingGraphic') ??
    findDirectChild(anchor.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'graphic',
    });
  if (!graphic) return null;
  const data =
    findDirectKind(graphic.children, 'drawingGraphicData') ??
    findDirectChild(graphic.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'graphicData',
    });
  return data;
}

const GROUP_PROPERTY_NAMES = new Set([
  'xfrm',
  'extLst',
  'noFill',
  'solidFill',
  'gradFill',
  'pattFill',
  'grpFill',
]);

/** Refuse visibility and visual effects that grouped members cannot represent. */
export function supportedGroupVisuals(
  owner: OoxmlElement,
  properties: OoxmlElement,
  group: boolean
): boolean {
  const nonVisual = findDirectChild(owner.children, {
    namespaceUri: owner.namespaceUri,
    localName: 'cNvPr',
  });
  if (nonVisual && !schemaFlagIsUnset(schemaAttributeValue(nonVisual.attributes, 'hidden')))
    return false;
  const mode = schemaAttributeValue(properties.attributes, 'bwMode');
  if (mode !== undefined && !['auto', 'clr'].includes(collapseSchemaWhitespace(mode))) return false;
  for (const child of properties.children) {
    if (!isElement(child)) continue;
    if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
    if (child.localName === 'effectLst') {
      if (child.children.some(isElement)) return false;
      continue;
    }
    if (['effectDag', 'scene3d', 'sp3d'].includes(child.localName)) return false;
    // A group paints no fill of its own; the fill it sets is the one `a:grpFill` members paint.
    if (group && !GROUP_PROPERTY_NAMES.has(child.localName)) return false;
  }
  return true;
}

/** A group payload and the child coordinate space its members are authored in. */
export interface DrawingGroupFrame {
  readonly group: OoxmlElement;
  readonly childOffsetEmu: Readonly<{ x: number; y: number }>;
  readonly childExtentEmu: Readonly<{ cx: number; cy: number }>;
  /**
   * The group's own turn and flips, read only when the caller accepts them (`turned`). The
   * whole group flips, then turns clockwise, about the centre of its extent.
   */
  readonly turn?: GroupTurn;
}

/** A group's `a:xfrm` turn in clockwise degrees in [0, 360), and its flips. */
export interface GroupTurn {
  readonly rotationDegrees: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

/**
 * The `wpg:wgp` under the anchor's graphic data with its `a:chOff`/`a:chExt`, or null when
 * the payload is not a group or has a missing or negative child extent. A child extent may
 * be zero on one or both axes. A turned or flipped group is null too, unless `turned` is set:
 * then its schema-valid turn and flips come back in `turn`.
 */
export function readDrawingGroupFrame(
  anchor: OoxmlElement,
  options: { readonly turned?: boolean } = {}
): DrawingGroupFrame | null {
  const data = findGraphicData(anchor);
  if (!data || schemaAttributeValue(data.attributes, 'uri') !== WPG_GRAPHIC_DATA_URI) return null;
  const group = findDirectChild(data.children, {
    namespaceUri: WPG_NAMESPACE_URI,
    localName: 'wgp',
  });
  const groupProperties = group
    ? findDirectChild(group.children, { namespaceUri: WPG_NAMESPACE_URI, localName: 'grpSpPr' })
    : null;
  const xfrm = groupProperties
    ? findDirectChild(groupProperties.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'xfrm',
      })
    : null;
  const childOffset = xfrm
    ? findDirectChild(xfrm.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'chOff',
      })
    : null;
  const childExtent = xfrm
    ? findDirectChild(xfrm.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'chExt',
      })
    : null;
  if (!group || !groupProperties || !childExtent) return null;
  if (!supportedGroupVisuals(group, groupProperties, true)) return null;
  let turn: GroupTurn | null = null;
  if (xfrm && options.turned) {
    turn = groupTurn(xfrm);
    if (!turn) return null;
  } else if (xfrm) {
    if (!schemaAngleIsZero(schemaAttributeValue(xfrm.attributes, 'rot'))) return null;
    if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipH'))) return null;
    if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipV'))) return null;
  }
  // A zero child extent is legal: rules that share one x (or y) give the group a zero child
  // extent on that axis. Readers that divide by the extent must guard that axis themselves.
  const cx = readSize(schemaAttributeValue(childExtent.attributes, 'cx'), null);
  const cy = readSize(schemaAttributeValue(childExtent.attributes, 'cy'), null);
  if (cx === null || cy === null) return null;
  return {
    group,
    childOffsetEmu: {
      x: childOffset
        ? (parseEmu(schemaAttributeValue(childOffset.attributes, 'x'), false) ?? 0)
        : 0,
      y: childOffset
        ? (parseEmu(schemaAttributeValue(childOffset.attributes, 'y'), false) ?? 0)
        : 0,
    },
    childExtentEmu: { cx, cy },
    ...(turn && (turn.rotationDegrees !== 0 || turn.flipH || turn.flipV) ? { turn } : {}),
  };
}

/** The schema-valid turn and flips of a group's `a:xfrm`, or null for an invalid spelling. */
function groupTurn(xfrm: OoxmlElement): GroupTurn | null {
  const rotationDegrees = shapeRotationDegrees(xfrm);
  if (rotationDegrees === null) return null;
  const flips = ['flipH', 'flipV'].map((name) => schemaAttributeValue(xfrm.attributes, name));
  if (flips.some((value) => !schemaFlagIsUnset(value) && !schemaFlagIsSet(value))) return null;
  return {
    rotationDegrees,
    flipH: schemaFlagIsSet(flips[0]),
    flipV: schemaFlagIsSet(flips[1]),
  };
}

/** Group bookkeeping children that are not painted members. */
export function isGroupPropertyChild(child: OoxmlElement): boolean {
  return (
    child.namespaceUri === WPG_NAMESPACE_URI &&
    (child.localName === 'cNvPr' ||
      child.localName === 'cNvGrpSpPr' ||
      child.localName === 'grpSpPr')
  );
}
