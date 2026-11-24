// The text-box story of a legacy VML shape: `v:textbox` → `w:txbxContent`.
//
// The story is ordinary WML content. This module validates only the wrapper and reads the
// shape chrome, inner margins, turn and text flow; `legacy-vml-textbox-geometry.ts` reads the
// shape's outline and text area. Story layout bounds the content by its own limits. Every value
// read here comes from the file, so each one is bounded or refused before it leaves.

import type { TextboxLegacyFrame, TextboxStoryProjection } from './drawing-shape-projection.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';
import { legacyTemplateOf, legacyTextboxGeometry } from './legacy-vml-textbox-geometry.ts';
import {
  legacyDashPattern,
  legacyStrokeCap,
  legacyTextboxShadow,
} from './legacy-vml-textbox-stroke.ts';
import {
  attribute as a,
  children,
  color,
  legacyRotationDegrees,
  named,
  numeric,
  off,
  OFFICE,
  points,
  styleOf,
  VML,
  WORD_VML,
} from './legacy-vml-values.ts';

const EMU_PER_POINT = 12_700;
/** The `v:textbox/@inset` defaults: 0.1 in left and right, 0.05 in top and bottom. */
const DEFAULT_INSET_POINTS = Object.freeze({ left: 7.2, top: 3.6, right: 7.2, bottom: 3.6 });
const MAX_INSET_POINTS = 1000;
const MAX_STROKE_POINTS = 100;
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A validated `v:textbox` and its story root. */
export interface LegacyTextbox {
  readonly textbox: OoxmlElement;
  readonly content: OoxmlElement;
}

/** Shape kinds that can host a text box story. */
const TEXTBOX_HOSTS = new Set(['shape', 'rect', 'roundrect', 'oval']);
/**
 * Chrome children the text box reads. Formulas of the shape's own would override its
 * template's, which the geometry does not evaluate, so they refuse the shape.
 */
const CHROME_CHILDREN = new Set(['fill', 'stroke', 'shadow', 'path', 'textbox']);
/** `v:path` attributes that do not move the text: flags, connection sites, and `textboxrect`,
 * which `legacyTextboxGeometry` reads. */
const PATH_ATTRIBUTES = new Set([
  'gradientshapeok',
  'arrowok',
  'strokeok',
  'fillok',
  'textboxrect',
  'limo',
]);
const OFFICE_PATH_ATTRIBUTES = new Set([
  'connecttype',
  'connectlocs',
  'connectangles',
  'extrusionok',
]);
/** Shape border hints for page borders around a floating shape; the shape paints none. */
const BORDER_HINTS = new Set(['bordertop', 'borderleft', 'borderbottom', 'borderright']);

/** Whether a shape child is inert for its text box. */
function inertChild(child: OoxmlElement): boolean {
  if (child.namespaceUri === VML && CHROME_CHILDREN.has(child.localName)) return true;
  if (named(child, OFFICE, 'lock') || named(child, WORD_VML, 'wrap')) return true;
  if (named(child, WORD_VML, 'anchorlock') && child.attributes.length === 0) return true;
  if (child.namespaceUri === WORD_VML && BORDER_HINTS.has(child.localName)) return true;
  // A switched-off extrusion paints nothing.
  if (named(child, OFFICE, 'extrusion')) return !a(child, 'on') || off(a(child, 'on'));
  // An image with no picture is an empty fill hint.
  if (named(child, VML, 'imagedata'))
    return child.attributes.every(
      (attr) =>
        !(attr.namespaceUri === RELATIONSHIPS || ['src', 'relid'].includes(attr.localName)) &&
        !(attr.namespaceUri === OFFICE && attr.localName === 'relid')
    );
  return false;
}

/** The `v:textbox` style keys and values this subset lays out or can ignore. */
function textboxStyleOk(key: string, value: string): boolean {
  switch (key) {
    case 'mso-fit-shape-to-text':
    case 'mso-next-textbox':
    case 'mso-direction-alt':
    case 'mso-rotate-with-shape':
      return true;
    case 'mso-wrap-style':
      return value === 'none' || value === 'square';
    case 'layout-flow':
      return ['horizontal', 'horizontal-ideographic', 'vertical', 'vertical-ideographic'].includes(
        value
      );
    case 'mso-layout-flow-alt':
      return value === 'top-to-bottom' || value === 'bottom-to-top';
    default:
      return false;
  }
}

/** Text that ideographic vertical flow keeps upright: CJK ideographs, kana, hangul, full width. */
const UPRIGHT_IN_VERTICAL =
  /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;
const MAX_SCANNED_NODES = 20_000;

/**
 * Whether a story holds text that ideographic vertical flow keeps upright. Turning the whole
 * story would lay such text on its side, so it is outside this subset. The walk is bounded; a
 * story too large to scan counts as holding such text.
 */
function holdsUprightText(content: OoxmlElement): boolean {
  const stack: OoxmlNode[] = [content];
  for (let seen = 0; stack.length; seen++) {
    if (seen > MAX_SCANNED_NODES) return true;
    const node = stack.pop()!;
    if (node.kind === 'textValue') {
      if (UPRIGHT_IN_VERTICAL.test(node.value)) return true;
      continue;
    }
    for (const child of node.children) stack.push(child);
  }
  return false;
}

/**
 * The text box of a VML shape: undefined when the shape has none, null when this subset
 * refuses it. A refused text box refuses the whole shape, as before, rather than paint a frame
 * whose text is missing.
 */
export function legacyTextbox(root: OoxmlElement): LegacyTextbox | null | undefined {
  const boxes = children(root).filter((child) => named(child, VML, 'textbox'));
  if (boxes.length === 0) return undefined;
  if (boxes.length > 1 || !TEXTBOX_HOSTS.has(root.localName)) return null;
  if (!children(root).every(inertChild)) return null;
  for (const path of children(root).filter((child) => named(child, VML, 'path'))) {
    if (
      children(path).length ||
      path.attributes.some(
        (attr) =>
          !(
            (!attr.namespaceUri && PATH_ATTRIBUTES.has(attr.localName)) ||
            (attr.namespaceUri === OFFICE && OFFICE_PATH_ATTRIBUTES.has(attr.localName))
          )
      )
    )
      return null;
  }
  const textbox = boxes[0]!;
  const content = children(textbox);
  if (content.length !== 1 || !named(content[0]!, WML_NAMESPACE_URI, 'txbxContent')) return null;
  if (
    textbox.attributes.some(
      (attr) =>
        !(
          (!attr.namespaceUri && ['id', 'style', 'inset'].includes(attr.localName)) ||
          (attr.namespaceUri === OFFICE && ['singleclick', 'insetmode'].includes(attr.localName))
        )
    )
  )
    return null;
  const style = styleOf(textbox);
  if (!style) return null;
  for (const [key, value] of style) if (!textboxStyleOk(key, value)) return null;
  if (style.get('layout-flow') === 'vertical-ideographic' && holdsUprightText(content[0]!))
    return null;
  return Object.freeze({ textbox, content: content[0]! });
}

/** One `inset` component in points; the default when empty, NaN when malformed. */
function insetPoints(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = points(value);
  if (!Number.isFinite(parsed) || parsed > MAX_INSET_POINTS) return NaN;
  return Math.max(0, parsed);
}

/** `v-text-anchor` on the shape style, collapsed to the three renderable positions. */
function verticalAnchor(value: string | undefined): TextboxStoryProjection['verticalAnchor'] {
  if (value?.startsWith('middle')) return 'center';
  if (value?.startsWith('bottom')) return 'bottom';
  return 'top';
}

const hex = (value: string | null) => (value ? value.slice(1).toUpperCase() : null);

/** The text flow a validated `v:textbox` style names. */
function textFlow(style: ReadonlyMap<string, string> | null): TextboxLegacyFrame['flow'] {
  const flow = style?.get('layout-flow');
  if (flow !== 'vertical' && flow !== 'vertical-ideographic') return 'horizontal';
  return style?.get('mso-layout-flow-alt') === 'bottom-to-top' ? 'verticalBottomToTop' : 'vertical';
}

/** `flip` on the shape style: `x`, `y`, or both, in either order. */
function flipOf(raw: string | undefined): { x: boolean; y: boolean } | null {
  const parts = (raw ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.some((part) => part !== 'x' && part !== 'y')) return null;
  return { x: parts.includes('x'), y: parts.includes('y') };
}

/**
 * The story projection of a validated VML text box. `style` is the shape's validated style,
 * `host` the `w:pict` that holds the shape and any template it names, and `width`×`height`
 * the shape box in points.
 *
 * The chrome is the shape's solid fill and outline, with its dash pattern and shadow.
 * Decorations outside that subset, such as a gradient or a perspective shadow, keep the box and
 * its text and paint the solid base colors. Null when an inset, the turn, or the shape geometry
 * is outside this subset.
 */
export function legacyTextboxStory(
  root: OoxmlElement,
  box: LegacyTextbox,
  style: ReadonlyMap<string, string>,
  host: OoxmlElement,
  width: number,
  height: number
): TextboxStoryProjection | null {
  // An explicit inset applies in either inset mode; without one the defaults apply.
  const parts = (a(box.textbox, 'inset') ?? '').split(',');
  if (parts.length > 4) return null;
  const left = insetPoints(parts[0], DEFAULT_INSET_POINTS.left),
    top = insetPoints(parts[1], DEFAULT_INSET_POINTS.top),
    right = insetPoints(parts[2], DEFAULT_INSET_POINTS.right),
    bottom = insetPoints(parts[3], DEFAULT_INSET_POINTS.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;

  const list = children(root);
  // A shape takes its outline and fill switches, outline colour and weight from its template
  // when it writes none of its own; the template's fill colour and child elements do not carry.
  const template = legacyTemplateOf(host, root);
  const own = (name: string) => a(root, name) ?? (template ? a(template, name) : undefined);
  const fillNode = list.find((child) => named(child, VML, 'fill'));
  const strokeNode = list.find((child) => named(child, VML, 'stroke'));
  if (
    list.filter((child) => named(child, VML, 'fill')).length > 1 ||
    list.filter((child) => named(child, VML, 'stroke')).length > 1
  )
    return null;
  // A fully transparent fill paints nothing. Opacity is a fraction or a 16.16 fixed value.
  const opacity = fillNode ? a(fillNode, 'opacity')?.trim() : undefined;
  const clear =
    opacity !== undefined &&
    (opacity.endsWith('f') ? numeric(opacity.slice(0, -1)) : numeric(opacity)) === 0;
  // A path that is not filled or not stroked paints no fill or outline, whatever the shape says.
  const pathNode = list.find((child) => named(child, VML, 'path'));
  const filled = !(
    off(own('filled')) ||
    (fillNode && off(a(fillNode, 'on'))) ||
    clear ||
    (pathNode && off(a(pathNode, 'fillok')))
  );
  const fill = filled
    ? color(
        fillNode ? (a(fillNode, 'color') ?? a(root, 'fillcolor')) : a(root, 'fillcolor'),
        'white'
      )
    : null;
  const stroked = !(
    off(own('stroked')) ||
    (strokeNode && off(a(strokeNode, 'on'))) ||
    (pathNode && off(a(pathNode, 'strokeok')))
  );
  const stroke = stroked
    ? color(
        strokeNode ? (a(strokeNode, 'color') ?? own('strokecolor')) : own('strokecolor'),
        'black'
      )
    : null;
  const weight = points(
    (strokeNode ? a(strokeNode, 'weight') : undefined) ?? own('strokeweight') ?? '0.75pt'
  );
  const strokeWidth =
    Number.isFinite(weight) && weight >= 0 && weight <= MAX_STROKE_POINTS ? weight : 0.75;
  const textboxStyle = styleOf(box.textbox);
  const fitStyle = textboxStyle?.get('mso-fit-shape-to-text');
  // The shape style carries the wrap mode; a text box style that repeats it agrees.
  const noWrap = (textboxStyle?.get('mso-wrap-style') ?? style.get('mso-wrap-style')) === 'none';
  const dash = legacyDashPattern(strokeNode);
  const cap = legacyStrokeCap(strokeNode);
  const shadow = legacyTextboxShadow(list.find((child) => named(child, VML, 'shadow')));
  const rotationDegrees = legacyRotationDegrees(style.get('rotation'));
  const flip = flipOf(style.get('flip'));
  if (!Number.isFinite(rotationDegrees) || !flip) return null;
  const measured = legacyTextboxGeometry(host, root, width, height, flip);
  if (!measured) return null;
  // A path that is not stroked hides the outline, and its text keeps the half-width inset the
  // outline would give it.
  const hiddenHalf =
    pathNode &&
    off(a(pathNode, 'strokeok')) &&
    !off(own('stroked')) &&
    !(strokeNode && off(a(strokeNode, 'on')))
      ? Math.round((strokeWidth / 2) * EMU_PER_POINT)
      : 0;
  const geometry = hiddenHalf
    ? Object.freeze({
        ...measured,
        textAreaEmu: Object.freeze({
          top: measured.textAreaEmu.top + hiddenHalf,
          right: measured.textAreaEmu.right + hiddenHalf,
          bottom: measured.textAreaEmu.bottom + hiddenHalf,
          left: measured.textAreaEmu.left + hiddenHalf,
        }),
      })
    : measured;
  // An inset pen is a shape or an outline setting; the outline's wins.
  const pen = (strokeNode ? a(strokeNode, 'insetpen') : undefined) ?? a(root, 'insetpen');
  const insetPen = pen !== undefined && !off(pen);
  const turns = textboxStyle?.get('mso-rotate-with-shape');
  const flow = textFlow(textboxStyle);
  const textArea = geometry.textAreaEmu;
  const framed =
    geometry.textHidden === true ||
    geometry.outline !== null ||
    rotationDegrees !== 0 ||
    flow !== 'horizontal' ||
    Object.values(textArea).some((edge) => edge !== 0);
  const legacyFrame: TextboxLegacyFrame | null = framed
    ? Object.freeze({
        textAreaEmu: textArea,
        outline: geometry.outline,
        rotationDegrees,
        textTurnsWithShape: turns !== undefined && !off(turns),
        flow,
        ...(geometry.textHidden ? { textHidden: true as const } : {}),
        ...(geometry.textAreaRule ? { textAreaRule: geometry.textAreaRule } : {}),
      })
    : null;
  return Object.freeze({
    contentNodeId: box.content.id,
    content: box.content,
    insetsEmu: Object.freeze({
      top: Math.round(top * EMU_PER_POINT),
      right: Math.round(right * EMU_PER_POINT),
      bottom: Math.round(bottom * EMU_PER_POINT),
      left: Math.round(left * EMU_PER_POINT),
    }),
    verticalAnchor: verticalAnchor(style.get('v-text-anchor')),
    autofit: fitStyle !== undefined && !off(fitStyle) ? 'shape' : 'none',
    ...(noWrap ? { noWrap: true as const } : {}),
    // An untyped shape with no path paints nothing: no fill, outline, shadow or text.
    fillHex: geometry.invisible ? null : hex(fill),
    strokeHex: stroke && strokeWidth > 0 && !geometry.invisible ? hex(stroke) : null,
    strokeWidthEmu: stroke && strokeWidth > 0 ? Math.round(strokeWidth * EMU_PER_POINT) : 0,
    ...(legacyFrame ? { legacyFrame } : {}),
    ...(insetPen ? { strokeInset: true as const } : { strokeCentered: true as const }),
    ...(fitStyle !== undefined && !off(fitStyle) ? { fitHeightToText: true as const } : {}),
    ...(dash && stroke && strokeWidth > 0 ? { strokeDash: dash } : {}),
    ...(cap && stroke && strokeWidth > 0 ? { strokeCap: cap } : {}),
    ...(shadow && !geometry.invisible ? { shadow } : {}),
  });
}
