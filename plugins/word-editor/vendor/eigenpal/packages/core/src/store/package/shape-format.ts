// The shapes a fill or outline edit reaches, and the fill and outline they show now.
//
// A drawing names its shapes three ways. A `wps:wsp` is one shape. A group (`wpg:wgp`) or a
// canvas (`wpc:wpc`) holds several, and a format edit on the whole drawing reaches each of them,
// as formatting a selected group does. A standalone legacy `w:pict` draws VML shapes. A text box
// is a `wps:wsp` or a VML shape like any other: its fill and outline are the box's.
//
// A drawing that Word wrote inside `mc:AlternateContent` keeps a VML copy in `mc:Fallback`. When
// the copy draws the same shapes in the same order, an edit writes it too (`tree-op-shape-format`),
// so a reader of only the fallback shows the same colours.

import { readLineProperties, readStyleReferenceIndex } from './drawing-line-properties.ts';
import { dashPresetOf } from './drawing-line-dash.ts';
import type { ShapeOutlineDash } from '../store/tree-op-types.ts';
import { resolveColorNode, type ShapeColor } from './drawing-shape-color.ts';
import { presetColorHex } from './drawing-preset-colors.ts';
import { isMcAlternateContent } from './drawing-projection-walk.ts';
import { shapePaintOf } from './drawing-shape-projection.ts';
import { groupFillOf } from './drawing-group-fill.ts';
import { legacyInk } from './legacy-vml-shapes.ts';
import { children, named, VML } from './legacy-vml-values.ts';
import { findNode, parentNodeOf } from './ooxml-edit.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import { MC_NAMESPACE_URI, WML_NAMESPACE_URI, WP_NAMESPACE_URI } from './ooxml-shared.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from './ooxml-tree.ts';
import type { PackageShapeThemeResolvers } from './theme-color-resolution.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
/** Containers a group or canvas nests its shapes in. */
const CONTAINERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [WPG, new Set(['wgp', 'grpSp'])],
  [WPC, new Set(['wpc'])],
]);
/** Shapes one drawing may hold, and how deep its groups may nest. */
const MAX_SHAPES = 1024;
const MAX_DEPTH = 16;
/** VML elements that draw a shape a fill or outline can reach. A picture has neither. */
const VML_FORMAT_SHAPES: ReadonlySet<string> = new Set([
  'shape',
  'rect',
  'roundrect',
  'oval',
  'line',
  'polyline',
  'curve',
  'arc',
]);
const EMU_PER_POINT = 12_700;

/**
 * `RRGGBB` from `RRGGBB`, `#RRGGBB`, or a CSS colour name, case-insensitive; null for anything
 * else. Shared by the editor commands and `Shape.fill`, so both accept the same spellings.
 *
 * @internal
 */
export function shapeColorHex(color: string): string | null {
  if (typeof color !== 'string') return null;
  const hex = /^#?([0-9A-Fa-f]{6})$/.exec(color);
  if (hex) return hex[1]!.toUpperCase();
  if (!/^[A-Za-z]{3,20}$/.test(color)) return null;
  const name = color.toLowerCase();
  // CSS has one named colour that `ST_PresetColorVal` lacks; it stays out of preset parsing.
  return name === 'rebeccapurple' ? '663399' : (presetColorHex(name) ?? null);
}

/** The theme colour slots a shape colour can name, in theme grid order. @internal */
export const SHAPE_THEME_COLOR_NAMES: ReadonlySet<string> = new Set([
  'bg1',
  'tx1',
  'bg2',
  'tx2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
]);

const valOf = (node: OoxmlElement): string | undefined =>
  schemaAttributeValue(node.attributes, 'val');

/**
 * The theme colour that a colour element names, as the theme grid writes it: `a:schemeClr` with
 * no transform but `a:lumMod`, `a:lumOff`, and opacity. Null for any other colour, so a colour
 * that only looks like a theme colour is never called one.
 */
function themeColorOf(node: OoxmlElement | undefined): ShapeThemeColor | null {
  if (!node || node.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return null;
  const name = valOf(node);
  if (node.localName !== 'schemeClr' || !name || !SHAPE_THEME_COLOR_NAMES.has(name)) return null;
  let lumMod = 100_000;
  let lumOff = 0;
  for (const transform of children(node)) {
    const value = Number(valOf(transform));
    if (transform.localName === 'lumMod') lumMod = value;
    else if (transform.localName === 'lumOff') lumOff = value;
    else if (!/^alpha(Off|Mod)?$/.test(transform.localName)) return null;
  }
  let shift: number;
  if (lumOff === 0) shift = (lumMod - 100_000) / 1000;
  else if (lumMod + lumOff === 100_000) shift = lumOff / 1000;
  else return null;
  if (!Number.isInteger(shift) || shift < -100 || shift > 100) return null;
  return { name: name as ShapeThemeColor['name'], shift };
}

/** The colour element of a solid fill element, if any. */
const solidColorNode = (fill: OoxmlElement | undefined | null): OoxmlElement | undefined =>
  fill?.localName === 'solidFill' ? children(fill)[0] : undefined;

/** The fill choices of `a:spPr` (ECMA-376 `EG_FillProperties`). @internal */
export const SHAPE_FILL_NAMES: ReadonlySet<string> = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
]);

/** What a fill or outline edit on one drawing reaches. @internal */
export interface ShapeFormatTargets {
  /** The node an edit replaces: the `mc:AlternateContent`, the `w:drawing`, or the `w:pict`. */
  readonly root: OoxmlElement;
  /** True for a standalone legacy `w:pict`, whose shapes are VML. */
  readonly legacy: boolean;
  /** Every `wps:wsp` or VML shape the drawing holds, in document order. */
  readonly shapes: readonly OoxmlElement[];
  /** The VML fallback shape of each of `shapes`, index for index, or null when none matches. */
  readonly fallback: readonly OoxmlElement[] | null;
  /**
   * The fill each of `shapes` takes from its groups when it says `a:grpFill`: the nearest
   * group's own fill element, or null when no group sets one.
   */
  readonly groupFills: readonly (OoxmlElement | null)[];
}

/**
 * A theme colour that a fill or outline names: a theme slot, lighter or darker by `shift`
 * percent. @public
 */
export interface ShapeThemeColor {
  readonly name:
    | 'bg1'
    | 'tx1'
    | 'bg2'
    | 'tx2'
    | 'accent1'
    | 'accent2'
    | 'accent3'
    | 'accent4'
    | 'accent5'
    | 'accent6';
  /** From -100 to 100: `40` is Lighter 40%, `-25` is Darker 25%, 0 the colour itself. */
  readonly shift: number;
}

/** The fill a read answers. @public */
export interface ShapeFillState {
  /** `mixed` when the shapes of a group disagree. */
  readonly type: 'solid' | 'none' | 'gradient' | 'pattern' | 'picture' | 'mixed';
  /** `RRGGBB` of a solid fill, or null. */
  readonly color: string | null;
  /** The theme colour a solid fill names, when its markup is a theme reference. */
  readonly theme?: ShapeThemeColor;
  /** From 0 (opaque) to 1 (clear). 0 for anything but a solid fill. */
  readonly transparency: number;
}

/** The outline a read answers. Null fields mean the shapes of a group disagree. @public */
export interface ShapeOutlineState {
  readonly visible: boolean | null;
  /** `RRGGBB` of a visible solid outline, or null. */
  readonly color: string | null;
  /** The theme colour a visible outline names, when its markup is a theme reference. */
  readonly theme?: ShapeThemeColor;
  readonly widthPt: number | null;
  /**
   * The preset dash the outline shows (`solid` for a plain line), `custom` for a dash list no
   * preset names, or null when the shapes of a group disagree. The engine always sets it; it is
   * optional so a state built by hand (a test double) without it stays valid.
   */
  readonly dash?: ShapeOutlineDash | 'custom' | null;
}

/** The fill and outline of the shapes one drawing holds. @public */
export interface ShapeFormatState {
  readonly fill: ShapeFillState;
  readonly outline: ShapeOutlineState;
}

function element(node: OoxmlElement['children'][number] | undefined): OoxmlElement | null {
  return node && node.kind !== 'textValue' ? node : null;
}

function child(parent: OoxmlElement, namespaceUri: string, localName: string): OoxmlElement | null {
  return element(parent.children.find((node) => named(node, namespaceUri, localName)));
}

/** The `wps:wsp` shapes under a drawing's graphic data, or null for any other payload. */
function drawingShapes(
  drawing: OoxmlElement
): { shapes: OoxmlElement[]; groupFills: (OoxmlElement | null)[] } | null {
  const anchor = children(drawing).find(
    (node) => named(node, WP_NAMESPACE_URI, 'anchor') || named(node, WP_NAMESPACE_URI, 'inline')
  );
  const graphic = anchor && child(anchor, DRAWINGML_MAIN_NAMESPACE_URI, 'graphic');
  const data = graphic && child(graphic, DRAWINGML_MAIN_NAMESPACE_URI, 'graphicData');
  const uri = data ? schemaAttributeValue(data.attributes, 'uri') : undefined;
  if (!data || (uri !== WPS_NAMESPACE_URI && uri !== WPG && uri !== WPC)) return null;
  const shapes: OoxmlElement[] = [];
  const groupFills: (OoxmlElement | null)[] = [];
  const walk = (node: OoxmlElement, depth: number, fill: OoxmlElement | null): boolean => {
    for (const member of children(node)) {
      if (named(member, WPS_NAMESPACE_URI, 'wsp')) {
        groupFills.push(fill);
        if (shapes.push(member) > MAX_SHAPES) return false;
      } else if (CONTAINERS.get(member.namespaceUri)?.has(member.localName)) {
        if (depth >= MAX_DEPTH || !walk(member, depth + 1, groupFillOf(member, fill))) return false;
      }
    }
    return true;
  };
  return walk(data, 0, null) && shapes.length > 0 ? { shapes, groupFills } : null;
}

/** The VML shapes a `w:pict` draws, with a group's members in place of the group. */
function vmlShapes(pict: OoxmlElement): OoxmlElement[] | null {
  const shapes: OoxmlElement[] = [];
  for (const node of children(pict)) {
    if (node.namespaceUri !== VML) continue;
    const members = node.localName === 'group' ? children(node) : [node];
    for (const member of members) {
      if (member.namespaceUri !== VML || member.localName === 'shapetype') continue;
      if (member.localName === 'group') return null;
      // A shape that only shows a picture has no fill or outline of its own to format.
      if (!VML_FORMAT_SHAPES.has(member.localName) || child(member, VML, 'imagedata')) continue;
      if (shapes.push(member) > MAX_SHAPES) return null;
    }
  }
  return shapes;
}

/** The fallback VML shapes of a wrapper, when they match `shapes` one for one. */
function fallbackShapes(alternate: OoxmlElement, count: number): OoxmlElement[] | null {
  const fallback = child(alternate, MC_NAMESPACE_URI, 'Fallback');
  const picts = fallback
    ? children(fallback).filter((n) => named(n, WML_NAMESPACE_URI, 'pict'))
    : [];
  if (picts.length !== 1) return null;
  const shapes = vmlShapes(picts[0]!);
  return shapes && shapes.length === count ? shapes : null;
}

/**
 * The shapes a format edit on `drawingNodeId` reaches. The id names a `w:drawing`, the
 * `mc:AlternateContent` that holds one, or a standalone `w:pict`.
 *
 * @internal
 */
export function shapeFormatTargets(
  part: OoxmlPart,
  drawingNodeId: string
): ShapeFormatTargets | 'unknown-drawing' | 'not-a-shape-drawing' {
  const node = findNode(part, drawingNodeId);
  if (!node || node.kind === 'textValue') return 'unknown-drawing';
  if (named(node, WML_NAMESPACE_URI, 'pict')) {
    const shapes = vmlShapes(node);
    return shapes?.length
      ? { root: node, legacy: true, shapes, fallback: null, groupFills: shapes.map(() => null) }
      : 'not-a-shape-drawing';
  }
  let drawing: OoxmlElement | null = null;
  let alternate: OoxmlElement | null = null;
  if (named(node, WML_NAMESPACE_URI, 'drawing')) {
    drawing = node;
    const choice = parentNodeOf(part, node.id);
    const wrapper =
      choice && named(choice, MC_NAMESPACE_URI, 'Choice') && parentNodeOf(part, choice.id);
    if (wrapper && isMcAlternateContent(wrapper)) alternate = wrapper;
  } else if (isMcAlternateContent(node)) {
    // The DrawingML branch is the shape; the VML fallback follows it when it draws the same
    // shapes, so whichever branch the page shows changes.
    const choice = child(node, MC_NAMESPACE_URI, 'Choice');
    drawing = choice ? child(choice, WML_NAMESPACE_URI, 'drawing') : null;
    if (!drawing) return 'not-a-shape-drawing';
    alternate = node;
  }
  const found = drawing && drawingShapes(drawing);
  if (!drawing || !found) return 'not-a-shape-drawing';
  const { shapes, groupFills } = found;
  return {
    root: alternate ?? drawing,
    legacy: false,
    shapes,
    fallback: alternate ? fallbackShapes(alternate, shapes.length) : null,
    groupFills,
  };
}

/**
 * The indexes of `targets.shapes` that `shapeNodeId` names: every shape when it is omitted, the
 * shape with that id, or each member of the VML group with that id. Empty when it names none.
 *
 * @internal
 */
export function chosenShapes(
  part: OoxmlPart,
  targets: ShapeFormatTargets,
  shapeNodeId: string | undefined
): number[] {
  const all = targets.shapes.map((_, index) => index);
  if (shapeNodeId === undefined) return all;
  return all.filter((index) => {
    const shape = targets.shapes[index]!;
    return shape.id === shapeNodeId || parentNodeOf(part, shape.id)?.id === shapeNodeId;
  });
}

/** `targets` narrowed to the shapes `chosenShapes` names. @internal */
export function narrowedTargets(
  part: OoxmlPart,
  targets: ShapeFormatTargets,
  shapeNodeId: string | undefined
): ShapeFormatTargets | null {
  if (shapeNodeId === undefined) return targets;
  const chosen = chosenShapes(part, targets, shapeNodeId);
  if (chosen.length === 0) return null;
  return {
    ...targets,
    shapes: chosen.map((index) => targets.shapes[index]!),
    fallback: targets.fallback ? chosen.map((index) => targets.fallback![index]!) : null,
    groupFills: chosen.map((index) => targets.groupFills[index]!),
  };
}

const FILL_TYPES: Readonly<Record<string, ShapeFillState['type']>> = {
  noFill: 'none',
  solidFill: 'solid',
  gradFill: 'gradient',
  pattFill: 'pattern',
  blipFill: 'picture',
  grpFill: 'mixed',
};

const roundTransparency = (alpha: number) => Math.round((1 - alpha) * 100_000) / 100_000;
const roundPoints = (emu: number) => Math.round((emu / EMU_PER_POINT) * 100) / 100;

/**
 * The colour a style reference paints with when the theme cannot say: its own placeholder
 * colour, which a theme's solid style fill or line paints as `phClr`. Null for index 0 (none).
 */
function styleColor(
  wsp: OoxmlElement,
  reference: 'fillRef' | 'lnRef',
  theme?: PackageShapeThemeResolvers
): ShapeColor | null {
  const ref = readStyleReferenceIndex(wsp, reference);
  if (!ref || ref.index === 0 || !ref.color) return null;
  return resolveColorNode(ref.color, theme?.resolveSchemeColor);
}

/** The first DrawingML fill child of `parent`. */
function authoredFill(parent: OoxmlElement | null): OoxmlElement | undefined {
  return parent
    ? children(parent).find(
        (n) => n.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI && SHAPE_FILL_NAMES.has(n.localName)
      )
    : undefined;
}

function wspFormat(
  wsp: OoxmlElement,
  groupFill: OoxmlElement | null,
  theme?: PackageShapeThemeResolvers
): ShapeFormatState {
  const spPr = child(wsp, wsp.namespaceUri, 'spPr');
  const paint = shapePaintOf(wsp, theme?.resolveSchemeColor, theme?.resolveStyleMatrixReference);
  const own = authoredFill(spPr);
  // `a:grpFill` paints the group's fill: read that one, or none when no group sets a fill.
  if (own?.localName === 'grpFill') return withGroupFill(wsp, groupFill, theme);
  const authored = own;
  const fill = paint?.fill ?? (authored ? null : styleColor(wsp, 'fillRef', theme));
  const type: ShapeFillState['type'] = authored
    ? FILL_TYPES[authored.localName]!
    : paint?.fillGradient
      ? 'gradient'
      : fill
        ? 'solid'
        : 'none';
  const solid = type === 'solid' ? fill : null;
  const ln = paint?.ln ?? null;
  const stroke = paint?.stroke ?? (authoredFill(ln) ? null : styleColor(wsp, 'lnRef', theme));
  const width = readLineProperties(wsp, ln, theme?.resolveStyleMatrixReference);
  const fillTheme = solid ? themeColorOf(solidColorNode(authored)) : null;
  const lineTheme = stroke ? themeColorOf(solidColorNode(authoredFill(ln))) : null;
  return {
    fill: {
      type,
      color: solid?.hex ?? null,
      transparency: solid ? roundTransparency(solid.alpha) : 0,
      ...(fillTheme ? { theme: fillTheme } : {}),
    },
    outline: {
      visible: stroke !== null,
      color: stroke?.hex ?? null,
      widthPt: roundPoints(width.widthEmu),
      dash: dashPresetOf(width.dash),
      ...(lineTheme ? { theme: lineTheme } : {}),
    },
  };
}

function withGroupFill(
  wsp: OoxmlElement,
  groupFill: OoxmlElement | null,
  theme?: PackageShapeThemeResolvers
): ShapeFormatState {
  const spPr = child(wsp, wsp.namespaceUri, 'spPr')!;
  const ownState = wspFormat(
    {
      ...wsp,
      children: wsp.children.map((n) =>
        n === spPr
          ? {
              ...spPr,
              children: spPr.children.filter(
                (c) => c.kind === 'textValue' || c.localName !== 'grpFill'
              ),
            }
          : n
      ),
    } as OoxmlElement,
    null,
    theme
  );
  const color = groupFill?.localName === 'solidFill' ? children(groupFill)[0] : undefined;
  const solid = color ? resolveColorNode(color, theme?.resolveSchemeColor) : null;
  const fillTheme = solid ? themeColorOf(color) : null;
  const type: ShapeFillState['type'] = !groupFill
    ? 'none'
    : groupFill.localName === 'solidFill'
      ? solid
        ? 'solid'
        : 'mixed'
      : FILL_TYPES[groupFill.localName]!;
  return {
    fill: {
      type,
      color: solid?.hex ?? null,
      transparency: solid ? roundTransparency(solid.alpha) : 0,
      ...(fillTheme ? { theme: fillTheme } : {}),
    },
    outline: ownState.outline,
  };
}

function vmlFormat(shape: OoxmlElement): ShapeFormatState {
  const ink = legacyInk(shape, shape.localName === 'line');
  const hex = (value: string | undefined) =>
    value && value !== 'none' ? value.replace('#', '').toUpperCase() : null;
  const fill = hex(ink?.fill);
  const stroke = hex(ink?.stroke);
  return {
    fill: { type: ink ? (fill ? 'solid' : 'none') : 'mixed', color: fill, transparency: 0 },
    outline: {
      visible: ink ? stroke !== null : null,
      color: stroke,
      widthPt: ink ? Math.round(ink.weight * 100) / 100 : null,
      dash: ink ? dashPresetOf(ink.dash) : null,
    },
  };
}

/** One answer for several shapes: a field the shapes disagree on reads as unknown. */
function agreed(states: readonly ShapeFormatState[]): ShapeFormatState {
  const [first, ...rest] = states;
  if (!first) throw new Error('no shapes to read');
  const same = <T>(read: (state: ShapeFormatState) => T) =>
    rest.every((state) => read(state) === read(first));
  const themeKey = (theme: ShapeThemeColor | undefined) =>
    theme ? `${theme.name}:${theme.shift}` : '';
  const fillAgrees = same((s) => s.fill.type) && same((s) => s.fill.color);
  const fillTheme = same((s) => themeKey(s.fill.theme)) ? first.fill.theme : undefined;
  const outlineColor = same((s) => s.outline.color);
  const lineTheme =
    outlineColor && same((s) => themeKey(s.outline.theme)) ? first.outline.theme : undefined;
  const { theme: _fill, ...fill } = first.fill;
  return {
    fill: fillAgrees
      ? {
          ...fill,
          transparency: same((s) => s.fill.transparency) ? first.fill.transparency : 0,
          ...(fillTheme ? { theme: fillTheme } : {}),
        }
      : { type: 'mixed', color: null, transparency: 0 },
    outline: {
      visible: same((s) => s.outline.visible) ? first.outline.visible : null,
      color: outlineColor ? first.outline.color : null,
      widthPt: same((s) => s.outline.widthPt) ? first.outline.widthPt : null,
      dash: same((s) => s.outline.dash) ? first.outline.dash : null,
      ...(lineTheme ? { theme: lineTheme } : {}),
    },
  };
}

/**
 * The fill and outline the targets show now: the authored values, else the shape style's,
 * resolved through the theme when `theme` is given.
 *
 * @internal
 */
export function readShapeFormat(
  targets: ShapeFormatTargets,
  theme?: PackageShapeThemeResolvers
): ShapeFormatState {
  return agreed(
    targets.shapes.map((shape, index) =>
      targets.legacy ? vmlFormat(shape) : wspFormat(shape, targets.groupFills[index]!, theme)
    )
  );
}
