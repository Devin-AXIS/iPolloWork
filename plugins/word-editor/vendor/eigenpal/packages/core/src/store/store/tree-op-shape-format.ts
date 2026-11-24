// Set the fill and outline of a shape, a text box, a line, or each shape of a group.
//
// The markup is what Word writes for the same edit:
// - A solid fill is `a:solidFill/a:srgbClr`, with `a:alpha` (1000ths of a percent of opacity)
//   for a transparency. A theme colour is `a:schemeClr` with `a:lumMod` and `a:lumOff` for a
//   tint or shade; the VML copy takes the `RRGGBB` it resolves to.
// - No fill is `a:noFill`. The fill it replaces moves to `a14:hiddenFill` in `a:extLst`, and a
//   later solid fill without a colour brings it back.
// - An outline is `a:ln` with `@w` in EMU and a `a:solidFill` for its colour. A hidden outline
//   is `a:noFill` in `a:ln`, keeping `@w`, and its colour moves to `a14:hiddenLine`. A dash is
//   `a:prstDash` after the line fill; `solid` is written too, so a style's dash stops applying.
// Every new element goes where the schema puts it (`CT_ShapeProperties`, `CT_LineProperties`).
//
// A legacy VML shape takes the VML spelling: `filled`, `fillcolor`, `stroked`, `strokecolor`,
// `strokeweight`, and `v:stroke/@dashstyle` for a dash. A DrawingML shape whose `mc:Fallback` draws the same shapes writes them there
// too, as Word does when it saves. VML has no transparency attribute on the shape, and Word
// writes none to the fallback; a legacy shape refuses a transparency.

import { cloneWithNewIds, fromEdit } from './tree-op-nodes.ts';
import { drawingEffect } from './tree-op-drawing-kinds.ts';
import { createNodeIdAllocator, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import {
  chosenShapes,
  SHAPE_FILL_NAMES,
  SHAPE_THEME_COLOR_NAMES,
  shapeFormatTargets,
} from '../package/shape-format.ts';
import { readStyleReferenceIndex } from '../package/drawing-line-properties.ts';
import { VML } from '../package/legacy-vml-values.ts';
import { isShapeOutlineDash } from '../package/drawing-line-dash.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI as A,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type {
  DrawingTreeDocOp,
  ShapeFillInput,
  ShapeOutlineInput,
  ShapeThemeColorInput,
  TreeOpRejection,
  TreeOpResult,
} from './tree-op-types.ts';

type SetShapeFormat = Extract<DrawingTreeDocOp, { op: 'setShapeFormat' }>;

const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const HIDDEN_FILL = '{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}';
const HIDDEN_LINE = '{91240B29-F687-4F45-9708-019B960494DF}';
const EMU_PER_POINT = 12_700;
/** Word's outline width range, in points. */
const MIN_WIDTH_PT = 0.25;
const MAX_WIDTH_PT = 1584;
const LINE_FILL_NAMES: ReadonlySet<string> = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'pattFill',
]);
/** `CT_ShapeProperties` children that precede the fill. */
const BEFORE_FILL: ReadonlySet<string> = new Set(['xfrm', 'custGeom', 'prstGeom']);
/** `CT_ShapeProperties` children that precede `a:ln`. */
const BEFORE_LINE: ReadonlySet<string> = new Set([...BEFORE_FILL, ...SHAPE_FILL_NAMES]);
/** `CT_LineProperties` dash children; a new dash replaces either. */
const DASH_NAMES: ReadonlySet<string> = new Set(['prstDash', 'custDash']);
/** The `v:stroke/@dashstyle` of each preset dash (`ST_StrokeDashStyle`), by the same pattern. */
const VML_DASH_STYLES: Readonly<Record<string, string | null>> = {
  solid: null,
  sysDot: 'shortdot',
  sysDash: 'shortdash',
  sysDashDot: 'shortdashdot',
  sysDashDotDot: 'shortdashdotdot',
  dot: 'dot',
  dash: 'dash',
  lgDash: 'longdash',
  dashDot: 'dashdot',
  lgDashDot: 'longdashdot',
  lgDashDotDot: 'longdashdotdot',
};
/** Color transforms that set opacity; a new transparency replaces them. */
const ALPHA_TRANSFORMS: ReadonlySet<string> = new Set(['alpha', 'alphaOff', 'alphaMod']);

const isHex = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9A-Fa-f]{6}$/.test(value);

/** Whether a theme colour input is well formed; it always comes with its resolved `color`. */
function themeOk(theme: ShapeThemeColorInput | undefined, color: unknown): boolean {
  if (theme === undefined) return true;
  if (typeof theme !== 'object' || theme === null || !isHex(color)) return false;
  if (!SHAPE_THEME_COLOR_NAMES.has(theme.name)) return false;
  const shift = theme.shift ?? 0;
  return Number.isInteger(shift) && shift >= -100 && shift <= 100;
}

/** Why the op's values are refused, before the target is looked at. */
function valueRejection(op: SetShapeFormat): TreeOpRejection | null {
  const { fill, outline } = op;
  if (fill === undefined && outline === undefined) return 'invalid-drawing-value';
  if (op.shapeNodeId !== undefined && typeof op.shapeNodeId !== 'string')
    return 'invalid-drawing-value';
  if (fill !== undefined) {
    if (fill.type !== 'none' && fill.type !== 'solid') return 'invalid-drawing-value';
    if (fill.type === 'solid') {
      if (fill.color !== undefined && !isHex(fill.color)) return 'invalid-drawing-value';
      if (!themeOk(fill.theme, fill.color)) return 'invalid-drawing-value';
      const t = fill.transparency;
      if (t !== undefined && (typeof t !== 'number' || !(t >= 0 && t <= 1)))
        return 'invalid-drawing-value';
    }
  }
  if (outline !== undefined) {
    const { visible, color, widthPt, dash } = outline;
    if (visible === undefined && color === undefined && widthPt === undefined && dash === undefined)
      return 'invalid-drawing-value';
    if (dash !== undefined && !isShapeOutlineDash(dash)) return 'invalid-drawing-value';
    if (visible !== undefined && typeof visible !== 'boolean') return 'invalid-drawing-value';
    if (color !== undefined && !isHex(color)) return 'invalid-drawing-value';
    if (!themeOk(outline.theme, color)) return 'invalid-drawing-value';
    // A colour is an outline you can see: it never goes with hiding one.
    if (color !== undefined && visible === false) return 'invalid-drawing-value';
    if (
      widthPt !== undefined &&
      (typeof widthPt !== 'number' || !(widthPt >= MIN_WIDTH_PT && widthPt <= MAX_WIDTH_PT))
    )
      return 'invalid-drawing-value';
  }
  return null;
}

/** Why a `setShapeFormat` op is refused, or null when it applies. */
export function validateShapeFormat(part: OoxmlPart, op: SetShapeFormat): TreeOpRejection | null {
  const planned = planShapeFormat(part, op, () => 'n');
  return typeof planned === 'string' ? planned : null;
}

/** Apply a `setShapeFormat` op. */
export function applyShapeFormat(
  part: OoxmlPart,
  op: SetShapeFormat,
  options?: EditOptions
): TreeOpResult {
  const planned = planShapeFormat(part, op, createNodeIdAllocator(part));
  if (typeof planned === 'string') return { ok: false, reason: planned };
  if (!planned) return { ok: false, reason: 'tree-invariant' };
  return fromEdit(
    replaceNode(part, planned.id, planned, options),
    drawingEffect(part, planned.id, op)
  );
}

/** The rewritten root, or why the op is refused. Null never reaches a caller. */
function planShapeFormat(
  part: OoxmlPart,
  op: SetShapeFormat,
  nextId: () => string
): OoxmlElement | TreeOpRejection | null {
  const refused = valueRejection(op);
  if (refused) return refused;
  const targets = shapeFormatTargets(part, op.drawingNodeId);
  if (typeof targets === 'string') return targets;
  const chosen = chosenShapes(part, targets, op.shapeNodeId);
  if (chosen.length === 0) return 'not-a-shape-drawing';
  if (targets.legacy && op.fill?.type === 'solid' && op.fill.transparency)
    return 'unsupported-property';
  const replaced = new Map<string, OoxmlElement>();
  for (const index of chosen) {
    const shape = targets.shapes[index]!;
    const edited = targets.legacy
      ? formatVml(shape, op.fill, op.outline, nextId)
      : formatWsp(shape, op.fill, op.outline, nextId, targets.groupFills[index] ?? null);
    if (typeof edited === 'string') return edited;
    replaced.set(shape.id, edited);
    const copy = targets.fallback?.[index];
    if (copy)
      replaced.set(copy.id, formatVml(copy, op.fill, op.outline, nextId, solidColorOf(edited)));
  }
  return rebuilt(targets.root, replaced) as OoxmlElement;
}

/** `node` with each replaced descendant swapped in; untouched subtrees keep their identity. */
function rebuilt(node: OoxmlNode, replaced: ReadonlyMap<string, OoxmlElement>): OoxmlNode {
  const swap = replaced.get(node.id);
  if (swap) return swap;
  if (node.kind === 'textValue') return node;
  let changed = false;
  const next = node.children.map((child) => {
    const value = rebuilt(child, replaced);
    if (value !== child) changed = true;
    return value;
  });
  return changed ? ({ ...node, children: next } as OoxmlElement) : node;
}

// ---- DrawingML ----------------------------------------------------------------------------

function elements(node: OoxmlElement): OoxmlElement[] {
  const values: readonly OoxmlNode[] = node.children;
  return values.filter((child): child is OoxmlElement => child.kind !== 'textValue');
}

function isA(node: OoxmlNode, names: ReadonlySet<string> | string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === A &&
    (typeof names === 'string' ? node.localName === names : names.has(node.localName))
  );
}

function attr(localName: string, value: string): OoxmlAttribute {
  return { kind: 'genericExtension', namespaceUri: '', localName, value };
}

function el(
  nextId: () => string,
  localName: string,
  attributes: readonly OoxmlAttribute[] = [],
  children: readonly OoxmlNode[] = [],
  namespaceUri = A
): OoxmlElement {
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri,
    localName,
    prefix: namespaceUri === A ? 'a' : 'a14',
    namespaceBindings: namespaceUri === A ? [] : [{ prefix: 'a14', namespaceUri: A14 }],
    attributes,
    children,
  } as OoxmlElement;
}

function withAttribute(node: OoxmlElement, localName: string, value: string): OoxmlElement {
  const others = node.attributes.filter((a) => a.namespaceUri || a.localName !== localName);
  return { ...node, attributes: [...others, attr(localName, value)] } as OoxmlElement;
}

function attributeOf(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((a) => !a.namespaceUri && a.localName === localName)?.value;
}

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}

/** `children` with `node` placed after the last child `before` names. */
function inserted(
  children: readonly OoxmlNode[],
  node: OoxmlElement,
  before: ReadonlySet<string>
): OoxmlNode[] {
  let at = 0;
  children.forEach((child, index) => {
    if (isA(child, before)) at = index + 1;
  });
  return [...children.slice(0, at), node, ...children.slice(at)];
}

/** `extLst` children with the extension `uri` set to hold `payload`, or removed for null. */
function withExtension(
  children: readonly OoxmlNode[],
  uri: string,
  payload: OoxmlElement | null,
  nextId: () => string
): OoxmlNode[] {
  const list = children.find((child) => isA(child, 'extLst')) as OoxmlElement | undefined;
  const kept = list
    ? list.children.filter((ext) => !(isA(ext, 'ext') && attributeOf(ext, 'uri') === uri))
    : [];
  const exts = payload ? [...kept, el(nextId, 'ext', [attr('uri', uri)], [payload])] : kept;
  if (!list) return exts.length ? [...children, el(nextId, 'extLst', [], exts)] : [...children];
  if (exts.length === list.children.length && !payload) return [...children];
  return exts.length
    ? children.map((child) => (child === list ? withChildren(list, exts) : child))
    : children.filter((child) => child !== list);
}

/**
 * A copy, with new ids, of the fill a hidden-fill or hidden-line extension keeps, or null.
 *
 * A fill that moves between the shape and its hidden extension always moves as a copy. Moved
 * with its own id, a fill the file held keeps a file id in both places, and after concurrent
 * undos a collaboration room can hold the restored fill beside the `a:noFill` it replaced,
 * both with file ids, which the room keeps as the file's own content.
 */
function hiddenPayload(
  children: readonly OoxmlNode[],
  uri: string,
  nextId: () => string
): OoxmlElement | null {
  const list = children.find((child) => isA(child, 'extLst')) as OoxmlElement | undefined;
  const ext = list && elements(list).find((e) => isA(e, 'ext') && attributeOf(e, 'uri') === uri);
  const hidden = ext && elements(ext)[0];
  const payload = hidden ? elements(hidden)[0] : undefined;
  return payload ? (cloneWithNewIds(payload, nextId) as OoxmlElement) : null;
}

/** The colour element of a solid fill, with its opacity set to `transparency`. */
function withTransparency(
  solid: OoxmlElement,
  transparency: number,
  nextId: () => string
): OoxmlElement | TreeOpRejection {
  const color = elements(solid)[0];
  if (!color) return 'invalid-drawing-value';
  const kept = color.children.filter((t) => !isA(t, ALPHA_TRANSFORMS));
  const alpha = Math.round((1 - transparency) * 100_000);
  const transforms =
    alpha < 100_000 ? [...kept, el(nextId, 'alpha', [attr('val', String(alpha))])] : kept;
  return withChildren(solid, [withChildren(color, transforms)]);
}

/** A copy of the style's placeholder colour as a solid fill, or null without one. */
function styleSolid(wsp: OoxmlElement, ref: 'fillRef' | 'lnRef', nextId: () => string) {
  // Index 0 is the style matrix's "no fill" or "no line": there is no colour to bring back.
  const reference = readStyleReferenceIndex(wsp, ref);
  const color = reference && reference.index > 0 ? reference.color : undefined;
  return color && color.kind !== 'textValue' && color.namespaceUri === A
    ? el(nextId, 'solidFill', [], [cloneWithNewIds(color, nextId)])
    : null;
}

function srgbSolid(color: string, nextId: () => string): OoxmlElement {
  return el(nextId, 'solidFill', [], [el(nextId, 'srgbClr', [attr('val', color.toUpperCase())])]);
}

/**
 * A solid fill of `color`, or of the theme reference when `theme` is given: `a:schemeClr` with
 * `a:lumMod` (and `a:lumOff` for a tint) in 1000ths of a percent, as the theme grid writes.
 */
function colorSolid(
  color: string,
  theme: ShapeThemeColorInput | undefined,
  nextId: () => string
): OoxmlElement {
  if (!theme) return srgbSolid(color, nextId);
  return el(nextId, 'solidFill', [], [themeColorElement(theme, nextId)]);
}

/**
 * The `a:schemeClr` of a theme colour: `a:lumMod` (and `a:lumOff` for a tint) in 1000ths of a
 * percent, as the theme colour grid writes them. Lighter 40% is `lumMod 60000` and
 * `lumOff 40000`; Darker 25% is `lumMod 75000`.
 */
export function themeColorElement(
  theme: ShapeThemeColorInput,
  nextId: () => string = () => 'theme-color'
): OoxmlElement {
  const shift = theme.shift ?? 0;
  const transforms: OoxmlElement[] = [];
  if (shift !== 0)
    transforms.push(el(nextId, 'lumMod', [attr('val', String((100 - Math.abs(shift)) * 1000))]));
  if (shift > 0) transforms.push(el(nextId, 'lumOff', [attr('val', String(shift * 1000))]));
  return el(nextId, 'schemeClr', [attr('val', theme.name)], transforms);
}

function formatWsp(
  wsp: OoxmlElement,
  fill: ShapeFillInput | undefined,
  outline: ShapeOutlineInput | undefined,
  nextId: () => string,
  groupFill: OoxmlElement | null
): OoxmlElement | TreeOpRejection {
  const spPr = elements(wsp).find(
    (c) => c.namespaceUri === wsp.namespaceUri && c.localName === 'spPr'
  );
  if (!spPr) return 'not-a-shape-drawing';
  let children: readonly OoxmlNode[] = spPr.children;
  if (fill) {
    const next = formatFill(wsp, children, fill, nextId, groupFill);
    if (typeof next === 'string') return next;
    children = next;
  }
  if (outline) {
    const next = formatOutline(wsp, children, outline, nextId);
    if (typeof next === 'string') return next;
    children = next;
  }
  const edited = withChildren(spPr, children);
  return withChildren(
    wsp,
    wsp.children.map((child) => (child === spPr ? edited : child))
  );
}

function formatFill(
  wsp: OoxmlElement,
  children: readonly OoxmlNode[],
  fill: ShapeFillInput,
  nextId: () => string,
  groupFill: OoxmlElement | null
): readonly OoxmlNode[] | TreeOpRejection {
  const current = children.find((c) => isA(c, SHAPE_FILL_NAMES)) as OoxmlElement | undefined;
  const put = (node: OoxmlElement, list: readonly OoxmlNode[]) =>
    current && list.includes(current)
      ? list.map((c) => (c === current ? node : c))
      : inserted(list, node, BEFORE_FILL);
  if (fill.type === 'none') {
    if (current?.localName === 'noFill') return children;
    const kept = current
      ? withExtension(
          children,
          HIDDEN_FILL,
          el(nextId, 'hiddenFill', [], [cloneWithNewIds(current, nextId)], A14),
          nextId
        )
      : children;
    return put(el(nextId, 'noFill'), kept);
  }
  let solid: OoxmlElement | null = null;
  if (fill.color !== undefined) {
    // A new colour keeps the transparency the shape had, as Word's colour picker does.
    const previous = current?.localName === 'solidFill' ? elements(current)[0] : undefined;
    const alpha = previous?.children.filter((t) => isA(t, ALPHA_TRANSFORMS)) ?? [];
    const base = colorSolid(fill.color, fill.theme, nextId);
    const color = elements(base)[0]!;
    solid = withChildren(base, [
      withChildren(color, [...color.children, ...alpha.map((t) => cloneWithNewIds(t, nextId))]),
    ]);
  } else if (current?.localName === 'grpFill') {
    // A group member that takes its group's fill gets that fill written as its own.
    solid =
      groupFill?.localName === 'solidFill'
        ? (cloneWithNewIds(groupFill, nextId) as OoxmlElement)
        : null;
  } else if (current && current.localName !== 'noFill') {
    solid = current;
  } else {
    solid = hiddenPayload(children, HIDDEN_FILL, nextId) ?? styleSolid(wsp, 'fillRef', nextId);
  }
  // Never invent a fill: without a colour to keep or bring back, the write needs one.
  if (!solid) return 'no-solid-fill';
  if (fill.transparency !== undefined) {
    if (solid.localName !== 'solidFill') return 'no-solid-fill';
    const next = withTransparency(solid, fill.transparency, nextId);
    if (typeof next === 'string') return next;
    solid = next;
  }
  return put(solid, withExtension(children, HIDDEN_FILL, null, nextId));
}

function formatOutline(
  wsp: OoxmlElement,
  children: readonly OoxmlNode[],
  outline: ShapeOutlineInput,
  nextId: () => string
): readonly OoxmlNode[] | TreeOpRejection {
  const existing = children.find((c) => isA(c, 'ln')) as OoxmlElement | undefined;
  let ln = existing ?? el(nextId, 'ln');
  if (outline.widthPt !== undefined)
    ln = withAttribute(ln, 'w', String(Math.round(outline.widthPt * EMU_PER_POINT)));
  let lnChildren: readonly OoxmlNode[] = ln.children;
  const current = lnChildren.find((c) => isA(c, LINE_FILL_NAMES)) as OoxmlElement | undefined;
  const put = (node: OoxmlElement, list: readonly OoxmlNode[]) =>
    current && list.includes(current)
      ? list.map((c) => (c === current ? node : c))
      : [node, ...list];
  if (outline.visible === false) {
    if (current?.localName !== 'noFill') {
      const width = attributeOf(ln, 'w');
      const hidden = current
        ? el(
            nextId,
            'hiddenLine',
            width ? [attr('w', width)] : [],
            [cloneWithNewIds(current, nextId)],
            A14
          )
        : null;
      const kept = hidden ? withExtension(lnChildren, HIDDEN_LINE, hidden, nextId) : lnChildren;
      lnChildren = put(el(nextId, 'noFill'), kept);
    }
  } else if (outline.color !== undefined || outline.visible === true) {
    let solid: OoxmlElement | null = null;
    if (outline.color !== undefined) solid = colorSolid(outline.color, outline.theme, nextId);
    else if (current && current.localName !== 'noFill') solid = current;
    else
      solid =
        hiddenPayload(lnChildren, HIDDEN_LINE, nextId) ??
        styleSolid(wsp, 'lnRef', nextId) ??
        srgbSolid('000000', nextId);
    lnChildren = put(solid, withExtension(lnChildren, HIDDEN_LINE, null, nextId));
  }
  if (outline.dash !== undefined) {
    const kept = lnChildren.filter((c) => !isA(c, DASH_NAMES));
    lnChildren = inserted(
      kept,
      el(nextId, 'prstDash', [attr('val', outline.dash)]),
      LINE_FILL_NAMES
    );
  }
  ln = withChildren(ln, lnChildren);
  return existing
    ? children.map((c) => (c === existing ? ln : c))
    : inserted(children, ln, BEFORE_LINE);
}

/** The `RRGGBB` a written fill shows, for the fallback's `fillcolor`; null when not plain. */
function solidColorOf(wsp: OoxmlElement): string | null {
  const spPr = elements(wsp).find(
    (c) => c.namespaceUri === wsp.namespaceUri && c.localName === 'spPr'
  );
  const solid = spPr && elements(spPr).find((c) => isA(c, 'solidFill'));
  const color = solid && elements(solid)[0];
  return color && isA(color, 'srgbClr') ? (attributeOf(color, 'val') ?? null) : null;
}

// ---- VML ----------------------------------------------------------------------------------

/** `attributes` with each unqualified value written, or removed for null. */
function vmlAttributes(
  attributes: readonly OoxmlAttribute[],
  values: ReadonlyMap<string, string | null>
): OoxmlAttribute[] {
  const next = attributes.filter((a) => a.namespaceUri || !values.has(a.localName));
  for (const [localName, value] of values) if (value !== null) next.push(attr(localName, value));
  return next;
}

/** A VML child (`v:fill`, `v:stroke`) without the attributes the shape's own now decide. */
function withoutOverrides(
  shape: OoxmlElement,
  name: string,
  drop: readonly string[]
): OoxmlElement {
  const values = new Map(drop.map((localName) => [localName, null]));
  return withChildren(
    shape,
    shape.children.map((child) =>
      child.kind !== 'textValue' && child.namespaceUri === VML && child.localName === name
        ? ({ ...child, attributes: vmlAttributes(child.attributes, values) } as OoxmlElement)
        : child
    )
  );
}

/**
 * The VML shape with the fill and outline written. `fillColor` is the colour a DrawingML edit
 * resolved for a fallback copy when the input names none.
 */
function formatVml(
  shape: OoxmlElement,
  fill: ShapeFillInput | undefined,
  outline: ShapeOutlineInput | undefined,
  nextId: () => string,
  fillColor: string | null = null
): OoxmlElement {
  const values = new Map<string, string | null>();
  let next = shape;
  // A line has no inside: its fill is never drawn, so it is never written.
  if (fill && shape.localName !== 'line') {
    if (fill.type === 'none') values.set('filled', 'f');
    else {
      values.set('filled', null);
      const color = fill.color ?? fillColor;
      if (color) values.set('fillcolor', `#${color.toLowerCase()}`);
      next = withoutOverrides(next, 'fill', color ? ['on', 'color'] : ['on']);
    }
  }
  if (outline) {
    if (outline.visible === false) values.set('stroked', 'f');
    else if (outline.visible === true || outline.color !== undefined) {
      values.set('stroked', null);
      next = withoutOverrides(next, 'stroke', ['on']);
    }
    if (outline.color !== undefined) {
      values.set('strokecolor', `#${outline.color.toLowerCase()}`);
      next = withoutOverrides(next, 'stroke', ['color']);
    }
    if (outline.widthPt !== undefined) {
      values.set('strokeweight', `${Math.round(outline.widthPt * 100) / 100}pt`);
      next = withoutOverrides(next, 'stroke', ['weight']);
    }
    if (outline.dash !== undefined)
      next = withDashStyle(next, VML_DASH_STYLES[outline.dash] ?? null, nextId);
  }
  return { ...next, attributes: vmlAttributes(next.attributes, values) } as OoxmlElement;
}

/**
 * The VML shape with `v:stroke/@dashstyle` set, or removed for a solid line. A shape without a
 * `v:stroke` gets one only for a dash; the stroke's other attributes stay.
 */
function withDashStyle(
  shape: OoxmlElement,
  style: string | null,
  nextId: () => string
): OoxmlElement {
  const values = new Map([['dashstyle', style]]);
  const isStroke = (child: OoxmlNode): child is OoxmlElement =>
    child.kind !== 'textValue' && child.namespaceUri === VML && child.localName === 'stroke';
  if (shape.children.some(isStroke))
    return withChildren(
      shape,
      shape.children.map((child) =>
        isStroke(child)
          ? ({ ...child, attributes: vmlAttributes(child.attributes, values) } as OoxmlElement)
          : child
      )
    );
  if (style === null) return shape;
  const stroke = {
    id: nextId(),
    kind: 'generic',
    namespaceUri: VML,
    localName: 'stroke',
    prefix: 'v',
    namespaceBindings: [],
    attributes: [attr('dashstyle', style)],
    children: [],
  } as unknown as OoxmlElement;
  return withChildren(shape, [stroke, ...shape.children]);
}
