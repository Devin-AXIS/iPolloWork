import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';
import { isStandardVmlTemplate } from './legacy-vml-templates.ts';
import { shapeLineGeometry } from './legacy-vml-shape-line.ts';
import { embeddedObjectPreview, pictureObjectPreview } from './legacy-vml-object.ts';
import type {
  DrawingProjection,
  DrawingHorizontalReferenceFrame,
  DrawingVerticalReferenceFrame,
  DrawingWrapProjection,
} from './drawing-projection.ts';
import { legacyTextbox, legacyTextboxStory } from './legacy-vml-textbox.ts';
import { legacyTemplateOf } from './legacy-vml-textbox-geometry.ts';
import { legacyVectorGroup, type LegacyVectorGroup } from './legacy-vml-group.ts';
import { inlineLegacyProjection, legacyPlaceholderProjection } from './legacy-vml-placeholder.ts';
import { legacyHorizontalRule } from './legacy-vml-rule.ts';
import { legacyPathShape } from './legacy-vml-path-shape.ts';
import {
  legacyLineReach,
  legacyPictureBorder,
  legacyShapeFragment,
  legacyBoxShape,
  legacyLineShape,
  type LegacyLineEnds,
  type LegacyBox,
  type LegacyGraphicFragment,
  type LegacyPictureBorder,
} from './legacy-vml-shapes.ts';
import type { VectorShapeProjection } from './drawing-shape-projection.ts';
import { freezeVectorShapeComponent } from './drawing-vector-freeze.ts';
import { legacyImageEffects } from './legacy-vml-image-effects.ts';
import { drawingTextArt, isUnrenderedTextArt } from './legacy-vml-text-art.ts';
import { drawingRenderers } from './drawing-renderers.ts';
import {
  attribute as a,
  boundedVml,
  children,
  element,
  named,
  numeric,
  off,
  OFFICE,
  pair,
  points,
  styleOf,
  VML,
  WORD_VML,
  wrapDistancePoints,
  coordOrigin,
} from './legacy-vml-values.ts';
export type { LegacyGraphicProjection } from './legacy-vml-shapes.ts';

const emptyEdges = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const memo = new WeakMap<OoxmlNode, DrawingProjection | null>();
// Layer order is a signed CSS integer, not a geometric coordinate. Word routinely
// writes 251658240 here; the coordinate reader's one-million limit rejects that.
function layerOrder(raw = '0'): number {
  if (raw.toLowerCase() === 'auto') return 0;
  if (!/^[+-]?\d{1,10}$/.test(raw)) return NaN;
  const value = Number(raw);
  return value >= -2147483648 && value <= 2147483647 ? value : NaN;
}
const commonStyles = new Set([
  'text-align',
  'mso-left-percent',
  'mso-top-percent',
  'mso-width-relative',
  'mso-height-relative',
  'v-text-anchor',
  'mso-wrap-edited',
  'mso-width-percent',
  'mso-height-percent',
  'mso-position-horizontal',
  'mso-position-vertical',
  'mso-wrap-style',
  'visibility',
  'position',
  'left',
  'top',
  'width',
  'height',
  'margin-left',
  'margin-top',
  'z-index',
  'flip',
  'mso-position-horizontal-relative',
  'mso-position-vertical-relative',
  'mso-wrap-distance-left',
  'mso-wrap-distance-top',
  'mso-wrap-distance-right',
  'mso-wrap-distance-bottom',
  // Read only for floating text art; `readProjection` refuses it on every other shape.
  'rotation',
]);

const relativeSizeFrames = [
  'margin',
  'page',
  'left-margin-area',
  'right-margin-area',
  'inner-margin-area',
  'outer-margin-area',
  'top-margin-area',
  'bottom-margin-area',
];
/** Style values this subset reads or can ignore; any other value refuses the shape. */
const knownValues: Readonly<Record<string, readonly string[]>> = {
  'text-align': ['left', 'center', 'right', 'justify'],
  'mso-wrap-edited': ['f', 't'],
  // -10001 is the writer's "no percentage position" value.
  'mso-left-percent': ['-10001'],
  'mso-top-percent': ['-10001'],
  'mso-width-relative': relativeSizeFrames,
  'mso-height-relative': relativeSizeFrames,
  'mso-position-horizontal': ['absolute', 'left', 'center', 'right', 'inside', 'outside'],
  'mso-position-vertical': ['absolute', 'top', 'center', 'bottom', 'inside', 'outside'],
  'mso-wrap-style': ['square', 'none'],
  'v-text-anchor': [
    'top',
    'middle',
    'bottom',
    'top-center',
    'middle-center',
    'bottom-center',
    'top-baseline',
    'bottom-baseline',
    'top-center-baseline',
    'bottom-center-baseline',
  ],
  visibility: ['visible', 'hidden'],
};

function supportedStyle(
  node: OoxmlElement,
  root: boolean,
  textbox = false
): ReadonlyMap<string, string> | null {
  const styles = styleOf(node);
  if (!styles || a(node, 'opacity') || a(node, 'href') || a(node, 'src')) return null;
  for (const key of styles.keys()) if (!commonStyles.has(key)) return null;
  for (const [key, allowed] of Object.entries(knownValues)) {
    const value = styles.get(key);
    if (value !== undefined && !allowed.includes(value)) return null;
  }
  // A relative size is stored beside the absolute size that the writer computed from it; the
  // absolute size is the one laid out.
  for (const key of ['mso-width-percent', 'mso-height-percent']) {
    const value = styles.get(key);
    if (value !== undefined && !/^\d{1,4}$/.test(value)) return null;
  }
  if (styles.has('position') && !['absolute', 'relative'].includes(styles.get('position')!))
    return null;
  if (
    !root &&
    (styles.has('z-index') ||
      styles.has('rotation') ||
      styles.has('margin-left') ||
      styles.has('margin-top') ||
      // A member's `mso-wrap-edited` only records an editing step, and `mso-wrap-style` only
      // wraps its own text; other `mso-` keys place or size it and stay outside the subset.
      Array.from(styles.keys()).some(
        (k) => k.startsWith('mso-') && k !== 'mso-wrap-edited' && k !== 'mso-wrap-style'
      ))
  )
    return null;
  // A text box reads its flip with its geometry; its text stays unmirrored.
  if (
    styles.has('flip') &&
    !textbox &&
    node.localName !== 'line' &&
    a(node, 'type') !== '#_x0000_t32'
  )
    return null;
  return styles;
}

function groupLayers(
  group: OoxmlElement,
  box: LegacyBox,
  out: LegacyGraphicFragment[],
  depth: number,
  canvas: LegacyBox = box
): boolean {
  if (depth > 8 || out.length >= 128 || !supportedStyle(group, depth === 0)) return false;
  const origin = coordOrigin(a(group, 'coordorigin') ?? '0,0'),
    size = pair(a(group, 'coordsize') ?? '21600,21600');
  if (!origin || !size || size.some((v) => v <= 0)) return false;
  for (const child of children(group)) {
    if (named(child, OFFICE, 'lock') || (depth === 0 && named(child, WORD_VML, 'wrap'))) continue;
    if (
      child.namespaceUri !== VML ||
      !['shape', 'rect', 'oval', 'line', 'group'].includes(child.localName)
    )
      return false;
    const style = supportedStyle(child, false);
    if (!style) return false;
    const left = numeric(style.get('left') ?? '0'),
      top = numeric(style.get('top') ?? '0');
    const width = numeric(style.get('width')),
      height = numeric(style.get('height'));
    const line = child.localName === 'line' || a(child, 'type') === '#_x0000_t32';
    if (
      ![left, top, width, height].every(Number.isFinite) ||
      (line ? width < 0 || height < 0 || width + height <= 0 : width <= 0 || height <= 0)
    )
      return false;
    const next = {
      x: box.x + ((left - origin[0]) * box.width) / size[0],
      y: box.y + ((top - origin[1]) * box.height) / size[1],
      width: (width * box.width) / size[0],
      height: (height * box.height) / size[1],
    };
    if (Object.values(next).some((v) => !Number.isFinite(v) || Math.abs(v) > 100_000)) return false;
    if (child.localName === 'group') {
      if (!groupLayers(child, next, out, depth + 1, canvas)) return false;
    } else {
      // Colour adjustments paint only on a single picture, never inside a composite.
      if (hasImageEffects(child)) return false;
      const fragment = legacyShapeFragment(child, next, canvas);
      if (fragment === null || out.length >= 128) return false;
      out.push(fragment);
    }
  }
  return true;
}

/** Whether a shape's `v:imagedata` carries colour adjustments. */
function hasImageEffects(shape: OoxmlElement): boolean {
  const image = children(shape).find((n) => named(n, VML, 'imagedata'));
  if (!image) return false;
  const effects = legacyImageEffects(image);
  return (
    effects === null ||
    effects.grayscale ||
    effects.brightness !== 0 ||
    effects.contrast !== 0 ||
    effects.bilevel !== undefined
  );
}

/** The outline stroke centred in the border band, which the picture sits inside. */
function pictureOutline(
  border: LegacyPictureBorder,
  cx: number,
  cy: number
): VectorShapeProjection {
  const weight = Math.round(border.weight * 12700),
    half = weight / 2,
    hex = border.color.slice(1).toUpperCase();
  const component = freezeVectorShapeComponent({
    subpathsEmu: [
      [
        { x: half, y: half },
        { x: cx - half, y: half },
        { x: cx - half, y: cy - half },
        { x: half, y: cy - half },
      ],
    ],
    subpathsClosed: [true],
    fillHex: null,
    fillAlpha: 1,
    strokeHex: hex,
    strokeAlpha: 1,
    strokeWidthEmu: weight,
  });
  return Object.freeze({
    extentEmu: Object.freeze({ cx, cy }),
    subpathsEmu: component.subpathsEmu,
    fillHex: null,
    fillAlpha: 1,
    strokeHex: hex,
    strokeAlpha: 1,
    strokeWidthEmu: weight,
    components: Object.freeze([component]),
  });
}

/**
 * The story roots inside a shape: its own text box story, or those of a group's members at
 * any depth. Bounded scans; a group too large to scan names none, and its text then counts
 * against the graphic budget, which refuses it.
 */
function storyCandidates(root: OoxmlElement): ReadonlySet<OoxmlNode> {
  const stories = new Set<OoxmlNode>();
  const stack: { node: OoxmlElement; depth: number }[] = [{ node: root, depth: 0 }];
  for (let seen = 0; stack.length && seen < 512; seen += 1) {
    const { node, depth } = stack.pop()!;
    const story = storyCandidate(node);
    if (story) stories.add(story);
    if (node.localName !== 'group' || depth >= 8 || node.children.length > 512) continue;
    for (const child of children(node)) stack.push({ node: child, depth: depth + 1 });
  }
  return stories;
}

/** The first `w:txbxContent` of a `v:textbox` child, found with bounded direct-child scans. */
function storyCandidate(root: OoxmlElement): OoxmlNode | undefined {
  if (root.children.length > 512) return undefined;
  for (const child of root.children) {
    if (!named(child, VML, 'textbox') || child.kind === 'textValue') continue;
    if (child.children.length > 512) return undefined;
    return child.children.find((inner) => named(inner, WML_NAMESPACE_URI, 'txbxContent'));
  }
  return undefined;
}

/** A `v:line` length pair (`x,y`) in points, or null. */
function lengthPair(value: string | undefined): [number, number] | null {
  const parts = value?.split(',');
  if (parts?.length !== 2) return null;
  const pair = parts.map((part) => points(part.trim()));
  return pair.every((n) => Number.isFinite(n) && Math.abs(n) <= 100_000)
    ? (pair as [number, number])
    : null;
}

interface LineGeometry {
  /** The box origin relative to the shape's own offset, in points. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ends: LegacyLineEnds;
}

/**
 * The box of a floating `v:line`, from its `from` and `to` points. A horizontal or vertical
 * line has no width or height, as a modern line can. Null for an inline line, a line without
 * both points, or one whose points coincide.
 */
function lineGeometry(root: OoxmlElement, floating: boolean): LineGeometry | null {
  const from = lengthPair(a(root, 'from')),
    to = lengthPair(a(root, 'to'));
  if (!floating || !from || !to) return null;
  const x = Math.min(from[0], to[0]),
    y = Math.min(from[1], to[1]);
  const width = Math.abs(to[0] - from[0]),
    height = Math.abs(to[1] - from[1]);
  if (width + height <= 0) return null;
  // A flip mirrors the line inside the box its points span, as the reference draws it.
  const flip = (styleOf(root)?.get('flip') ?? '').trim().split(/\s+/).filter(Boolean);
  if (flip.some((axis) => axis !== 'x' && axis !== 'y')) return null;
  const end = ([px, py]: readonly [number, number]) =>
    Object.freeze([
      flip.includes('x') ? width - (px - x) : px - x,
      flip.includes('y') ? height - (py - y) : py - y,
    ] as const);
  return Object.freeze({
    x,
    y,
    width,
    height,
    ends: Object.freeze([end(from), end(to)] as const),
  });
}

/**
 * `preview` is the validated cached-preview shape of a `w:object`. A `w:pict` picture beside an
 * `o:OLEObject` is the same kind of preview. Either projection is a static read-only graphic: no
 * picture member, so picture edits never reach the embedded object. A preview may float as an
 * ordinary picture does.
 */
function readProjection(node: OoxmlElement, preview?: OoxmlElement): DrawingProjection | null {
  const shapes = preview ? [preview] : children(node).filter((c) => !named(c, VML, 'shapetype'));
  const objectPreview = preview ? undefined : pictureObjectPreview(shapes);
  if (objectPreview === null) return null;
  const roots = objectPreview ? [objectPreview] : shapes;
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const readOnly = !!(preview ?? objectPreview);
  if (
    root.namespaceUri !== VML ||
    !['shape', 'rect', 'roundrect', 'oval', 'line', 'group'].includes(root.localName)
  )
    return null;
  // The text box story is ordinary WML content, bounded by story layout rather than here.
  // Everything else is bounded before the text box is read.
  if (!boundedVml(preview ?? node, preview ? undefined : storyCandidates(root))) return null;
  // A horizontal rule takes the width of its line, which layout gives it.
  const ruled = readOnly ? undefined : legacyHorizontalRule(root);
  if (ruled === null) return null;
  if (ruled)
    return inlineLegacyProjection(node, root, 0, ruled.heightPt, {
      hidden: styleOf(root)?.get('visibility') === 'hidden',
      diagnostics: Object.freeze([]),
      horizontalRule: ruled.rule,
    });
  const textbox = readOnly ? undefined : legacyTextbox(root);
  if (textbox === null) return null;
  // A text path projects its text for layout to fit, floating or on the line; every other
  // shape keeps the preview subset, which has no rotation. A text box story carries its own turn.
  // Text art outside a watermark needs an installed text art renderer; without one the text
  // path is refused, as a drawing outside the subset is, rather than drawn as its preview.
  const textArtRenderer = drawingRenderers().legacyTextArt;
  const template = textbox ? undefined : legacyTemplateOf(node, root);
  const textArt = !readOnly && !textbox ? drawingTextArt(root, textArtRenderer, template) : null;
  // Built-in templates are metadata, not a second drawing. Unknown custom
  // templates may redefine geometry and are outside this bounded subset. A text box reads the
  // template it names with its geometry, which refuses what it cannot trace, and so does a
  // text art renderer that projected the shape.
  if (
    !textbox &&
    children(node).some(
      (child) =>
        named(child, VML, 'shapetype') &&
        !isStandardVmlTemplate(child) &&
        !(textArt && child === template)
    )
  )
    return null;
  const style = supportedStyle(root, true, !!textbox);
  if (!style) return null;
  const floating = style.get('position') === 'absolute';
  if (style.has('rotation') && !textArt && !textbox) return null;
  if (!readOnly && !textArt && !textArtRenderer && isUnrenderedTextArt(root)) return null;
  // A line spans its `from` and `to` points.
  const line =
    root.localName === 'line'
      ? lineGeometry(root, floating)
      : shapeLineGeometry(root, style, floating);
  if (line === null) return null;
  const width = line?.width ?? points(style.get('width')),
    height = line?.height ?? points(style.get('height'));
  const extentOk = (n: number) => Number.isFinite(n) && (line ? n >= 0 : n > 0) && n <= 10_000;
  if (![width, height].every(extentOk)) return null;
  // A picture outline widens the drawing by its full weight on every side; the picture keeps
  // its authored size inside it.
  const border = root.localName === 'shape' && !textbox ? legacyPictureBorder(root) : undefined;
  if (border === null || (readOnly && border)) return null;
  // A line is a vector shape, which paints in every output and whose outline reaches past its
  // box as a modern line's does. The other shapes are a graphic preview, which grows by the
  // outline's reach on every side to keep the outline inside its image.
  const vector = !!line;
  // A connector drawn corner to corner is a line too, with the reach of its ends.
  const connector =
    root.localName === 'shape' &&
    (a(root, 'type') === '#_x0000_t32' || (!a(root, 'type') && !!a(root, 'path')));
  const strokeReach =
    !textbox &&
    !border &&
    (line || connector || ['rect', 'roundrect', 'oval'].includes(root.localName))
      ? legacyLineReach(root, !line && !connector)
      : 0;
  if (strokeReach === null) return null;
  const inset = border?.weight ?? strokeReach,
    outerWidth = width + 2 * inset,
    outerHeight = height + 2 * inset;
  const grow = vector ? 0 : inset;
  const fragments: LegacyGraphicFragment[] = [];
  let boxShape: VectorShapeProjection | null = null;
  const box = { x: 0, y: 0, width, height };
  // The story paints the shape's fill and outline itself, so a text box has no graphic.
  const textboxStory = textbox
    ? legacyTextboxStory(root, textbox, style, node, width, height)
    : null;
  if (textbox && !textboxStory) return null;
  let vectorGroup: LegacyVectorGroup | null = null;
  if (!textboxStory && root.localName === 'group') {
    // Shapes, lines and text boxes paint as vectors in every output; anything else keeps the
    // graphic preview.
    if (!readOnly)
      vectorGroup = legacyVectorGroup(root, node, width, height, (n) => supportedStyle(n, false));
    // The preview cannot paint member text, so a group with text paints as vectors or not at all.
    if (!vectorGroup && storyCandidates(root).size) return null;
    if (!vectorGroup && (!groupLayers(root, box, fragments, 0) || !fragments.length)) return null;
  } else if (!textboxStory && !textArt) {
    const fragment = legacyShapeFragment(
      root,
      { x: inset, y: inset, width, height },
      { x: 0, y: 0, width: outerWidth, height: outerHeight },
      !!border,
      line?.ends
    );
    if (fragment === null) return null;
    if ((border || readOnly) && (typeof fragment === 'string' || !fragment.nativeCrop)) return null;
    // A vector shape is validated by the same reading and painted from its own projection.
    if (!vector) fragments.push(fragment);
    // A plain rectangle or oval is a vector shape too, over the same box as its preview.
    if (!readOnly && typeof fragment === 'string')
      boxShape =
        legacyBoxShape(
          root,
          { x: inset, y: inset, width, height },
          { x: 0, y: 0, width: outerWidth, height: outerHeight }
        ) ??
        legacyPathShape(
          root,
          { x: inset, y: inset, width, height },
          { x: 0, y: 0, width: outerWidth, height: outerHeight }
        );
  }
  const vectorShape = line
    ? legacyLineShape(root, width, height, line.ends)
    : (vectorGroup?.vectorShape ?? boxShape);
  if (line && !vectorShape) return null;
  const wrapNodes = children(root).filter((n) => named(n, WORD_VML, 'wrap'));
  if (wrapNodes.length > 1) return null;
  const wrapNode = wrapNodes[0];
  const anchorX = wrapNode ? a(wrapNode, 'anchorx') : undefined;
  const anchorY = wrapNode ? a(wrapNode, 'anchory') : undefined;
  if (anchorX && !['page', 'margin', 'text', 'char'].includes(anchorX)) return null;
  if (anchorY && !['page', 'margin', 'text', 'line'].includes(anchorY)) return null;
  if (border && floating) return null;
  const horizontal = new Map<string, DrawingHorizontalReferenceFrame>([
    ['text', 'column'],
    ['char', 'character'],
    ['page', 'page'],
    ['margin', 'margin'],
    ['left-margin-area', 'leftMargin'],
    ['right-margin-area', 'rightMargin'],
  ]).get(style.get('mso-position-horizontal-relative') ?? anchorX ?? 'text');
  const vertical = new Map<string, DrawingVerticalReferenceFrame>([
    ['text', 'paragraph'],
    // Some writers name the anchor paragraph directly.
    ['paragraph', 'paragraph'],
    ['line', 'line'],
    ['page', 'page'],
    ['margin', 'margin'],
    ['top-margin-area', 'topMargin'],
    ['bottom-margin-area', 'bottomMargin'],
  ]).get(style.get('mso-position-vertical-relative') ?? anchorY ?? 'text');
  const left = points(style.get('margin-left') ?? style.get('left') ?? '0') + (line?.x ?? 0) - grow,
    top = points(style.get('margin-top') ?? style.get('top') ?? '0') + (line?.y ?? 0) - grow;
  // An aligned position replaces the offset, as `wp:align` does for a modern drawing.
  const alignOf = (value: string | undefined) =>
    value === undefined || value === 'absolute' ? null : value;
  const horizontalAlign = alignOf(style.get('mso-position-horizontal')),
    verticalAlign = alignOf(style.get('mso-position-vertical'));
  const z = layerOrder(style.get('z-index'));
  if (
    !horizontal ||
    !vertical ||
    ![left, top, z].every(Number.isFinite) ||
    Math.abs(left) > 100_000 ||
    Math.abs(top) > 100_000
  )
    return null;
  const wrap = wrapNode ? (a(wrapNode, 'type') ?? 'none') : 'none';
  if (
    !['none', 'square', 'topAndBottom', 'tight', 'through'].includes(wrap) ||
    (wrapNode &&
      wrapNode.attributes.some(
        (attr) =>
          !['type', 'side', 'anchorx', 'anchory'].includes(attr.localName) || attr.namespaceUri
      ))
  )
    return null;
  const side = wrapNode ? (a(wrapNode, 'side') ?? 'both') : 'both';
  const textSide = new Map<string, DrawingWrapProjection['textSide']>([
    ['both', 'bothSides'],
    ['left', 'left'],
    ['right', 'right'],
    ['largest', 'largest'],
  ]).get(side);
  if (!textSide) return null;
  const polygon: { x: number; y: number }[] = [];
  if (wrap === 'tight' || wrap === 'through') {
    const raw = (a(root, 'wrapcoords') ?? '').trim().split(/[\s,]+/);
    if (raw.length < 6 || raw.length > 256 || raw.length % 2) return null;
    const coords = raw.map(numeric);
    if (coords.some((n) => !Number.isFinite(n) || Math.abs(n) > 216_000)) return null;
    for (let i = 0; i < coords.length; i += 2)
      polygon.push(Object.freeze({ x: coords[i]!, y: coords[i + 1]! }));
  }
  const distances: Record<'top' | 'right' | 'bottom' | 'left', number> = { ...emptyEdges };
  // A text box keeps 9 pt beside wrapped text unless it names its distances.
  const sideDefault = textboxStory ? '9pt' : '0';
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const fallback = side === 'left' || side === 'right' ? sideDefault : '0';
    const value = wrapDistancePoints(style.get('mso-wrap-distance-' + side) ?? fallback);
    if (!Number.isFinite(value) || value > 1000) return null;
    distances[side] = Math.round(value * 12700);
  }
  const photo =
    !readOnly &&
    root.localName !== 'group' &&
    fragments.length === 1 &&
    typeof fragments[0] !== 'string' &&
    fragments[0]?.nativeCrop
      ? fragments[0]
      : undefined;
  // Colour adjustments are picture effects; a preview, outline or composite cannot carry them.
  const imageNode = children(root).find((n) => named(n, VML, 'imagedata'));
  const effects = imageNode ? legacyImageEffects(imageNode) : null;
  // A read-only preview of one picture resolves to that picture, so it carries effects too.
  const sole = !photo && !textboxStory && !textArt ? soleImage(fragments, inset) : {};
  const pictured = !!photo || !!sole.soleImageRelationshipId;
  if (hasImageEffects(root) && (!pictured || border)) return null;
  const outerCx = Math.round((vector ? width : outerWidth) * 12700),
    outerCy = Math.round((vector ? height : outerHeight) * 12700);
  return Object.freeze({
    drawingNodeId: node.id,
    ownerPartName: '',
    kind: floating ? 'anchored' : 'inline',
    relationshipId: photo?.relationshipId ?? null,
    docPrId: null,
    name: a(root, 'id') ?? 'Legacy graphic',
    title: a(root, 'title') ?? '',
    description: a(root, 'alt') ?? '',
    hyperlinkHref: null,
    hidden: style.get('visibility') === 'hidden',
    extentEmu: Object.freeze({ cx: outerCx, cy: outerCy }),
    effectExtentEmu: emptyEdges,
    inlineDistancesEmu: emptyEdges,
    wrap: floating
      ? wrap === 'none'
        ? z < 0
          ? 'behind'
          : 'inFront'
        : wrap === 'tight' || wrap === 'through'
          ? wrap
          : wrap === 'topAndBottom'
            ? 'topAndBottom'
            : textSide === 'left'
              ? 'squareLeft'
              : textSide === 'right'
                ? 'squareRight'
                : 'square'
      : 'inline',
    wrapGeometry: floating
      ? Object.freeze({
          element: wrap as DrawingWrapProjection['element'],
          textSide,
          distancesEmu: Object.freeze(distances),
          polygon: Object.freeze(polygon),
        })
      : null,
    position: floating
      ? Object.freeze({
          simplePosition: Object.freeze({ xEmu: 0, yEmu: 0 }),
          horizontal: Object.freeze({
            relativeFrom: horizontal,
            align: horizontalAlign,
            offsetEmu: horizontalAlign ? null : Math.round(left * 12700),
          }),
          vertical: Object.freeze({
            relativeFrom: vertical,
            align: verticalAlign,
            offsetEmu: verticalAlign ? null : Math.round(top * 12700),
          }),
        })
      : null,
    anchor: floating
      ? Object.freeze({
          simplePos: false,
          // Behind-text drawings have their own paint layer; retain their signed order
          // in its non-negative rank instead of collapsing every negative value to zero.
          relativeHeight: z < 0 ? z + 2147483648 : z,
          behindDocument: z < 0,
          layoutInCell: !off(a(root, 'allowincell', OFFICE)),
          allowOverlap: true,
        })
      : null,
    picture:
      photo && !border
        ? Object.freeze({
            embeddedRelationshipId: photo.relationshipId,
            linkedRelationshipId: null,
            crop: photo.nativeCrop!,
            fillMode: 'stretch' as const,
            presetGeometry: null,
            transform: Object.freeze({
              rotationDegrees: 0,
              flipHorizontal: false,
              flipVertical: false,
              offsetEmu: Object.freeze({ x: 0, y: 0 }),
              extentEmu: Object.freeze({
                cx: Math.round(width * 12700),
                cy: Math.round(height * 12700),
              }),
            }),
          })
        : null,
    vectorShape: border ? pictureOutline(border, outerCx, outerCy) : vectorShape,
    groupPicture:
      photo && border
        ? Object.freeze({
            embeddedRelationshipId: photo.relationshipId,
            linkedRelationshipId: null,
            crop: photo.nativeCrop!,
            frameEmu: Object.freeze({
              x: Math.round(inset * 12700),
              y: Math.round(inset * 12700),
              cx: Math.round(width * 12700),
              cy: Math.round(height * 12700),
            }),
            memberNodeId: children(root).find((n) => named(n, VML, 'imagedata'))!.id,
            alternateContent: false,
          })
        : (vectorGroup?.groupPicture ?? null),
    textboxStory,
    // The graphic covers the whole drawing, outline reach included.
    ...(textArt ? { textArt } : {}),
    ...(vectorGroup?.groupTextboxes ? { groupTextboxes: vectorGroup.groupTextboxes } : {}),
    ...(!photo && !textboxStory && !vectorShape && !textArt && !vectorGroup
      ? {
          legacyGraphic: Object.freeze({
            width: outerWidth,
            height: outerHeight,
            fragments: Object.freeze(fragments),
            ...sole,
          }),
        }
      : {}),
    // An upright text box moves and resizes through its `style`; a turned one, and a size the
    // writer keeps as a percentage of a frame, stay as authored. A plain vector shape selects,
    // so its fill and outline can be edited, but keeps its frame. Every other shape is read-only.
    locks:
      !textboxStory && !photo && vectorShape && !vectorGroup
        ? Object.freeze({ select: false, move: true, resize: true, changeAspect: true })
        : textboxStory && !style.has('rotation')
          ? Object.freeze({
              select: false,
              move: !floating,
              // `0` is the writer's "no percentage", so the absolute size is the one kept.
              resize: ['mso-width-percent', 'mso-height-percent'].some(
                (key) => (style.get(key) ?? '0') !== '0'
              ),
              changeAspect: false,
            })
          : Object.freeze({ select: true, move: true, resize: true, changeAspect: true }),
    effects:
      pictured && effects
        ? effects
        : Object.freeze({ grayscale: false, brightness: 0, contrast: 0 }),
    compatibilityBranchNodeId: null,
    diagnostics: Object.freeze([]),
  });
}

/** The one uncropped picture that fills a graphic with no outline reach, if that is all it is. */
function soleImage(
  fragments: readonly LegacyGraphicFragment[],
  inset: number
): { soleImageRelationshipId?: string } {
  const only = fragments.length === 1 ? fragments[0] : undefined;
  if (inset !== 0 || !only || typeof only === 'string' || !only.nativeCrop) return {};
  const { left, top, right, bottom } = only.nativeCrop;
  return left || top || right || bottom ? {} : { soleImageRelationshipId: only.relationshipId };
}

/**
 * Supported standalone w:pict, or the cached preview of a w:object, is one read-only drawing
 * atom. Dead MC fallbacks are not visited.
 */
export function isLegacyVmlAtom(node: OoxmlNode): boolean {
  if (!element(node)) return false;
  const object = named(node, WML_NAMESPACE_URI, 'object');
  if (!object && !named(node, WML_NAMESPACE_URI, 'pict')) return false;
  if (!memo.has(node)) {
    const preview = object ? embeddedObjectPreview(node) : undefined;
    // A drawing on the line that cannot paint still keeps its box, with a placeholder.
    memo.set(
      node,
      preview === null
        ? null
        : (readProjection(node, preview) ?? legacyPlaceholderProjection(node, preview))
    );
  }
  return memo.get(node) !== null;
}
/** Whether a supported VML atom floats; false for anything else. Reads the memo, no copy. */
export function isFloatingLegacyVmlAtom(node: OoxmlNode): boolean {
  return isLegacyVmlAtom(node) && memo.get(node)!.kind === 'anchored';
}

export function projectLegacyVml(node: OoxmlNode, ownerPartName: string): DrawingProjection | null {
  if (!isLegacyVmlAtom(node)) return null;
  return Object.freeze({ ...memo.get(node)!, ownerPartName });
}
