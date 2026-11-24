// Paragraph borders, in the vocabulary an Office-shaped object model reads and writes.
//
// INTERNAL to the automation lane. The object model's `Paragraph.borders` is a collection of five
// edges in a fixed order: top, left, bottom, right, then the border between paragraphs. That is
// the `CT_PBdr` sequence without `w:bar`, which no Office-shaped member addresses and which every
// write carries through unchanged.
//
// BORDERS CASCADE EDGE BY EDGE. Each level of the cascade (document defaults, a cell's table
// style, the style chain, the numbering level, the paragraph's own `w:pBdr`) overrides only the
// edges it states. A read answers what the page shows, folded the same way layout paints it, so
// a style's rule reads as a line on the paragraph. A write states only the edges it changes, and
// writing back what an edge shows changes nothing (a line style write still resets the width).
//
// ASSIGNMENTS APPLY IN ORDER, as the same calls do in sequence: a line style resets the width,
// so `lineWidth` before `lineStyle` is lost and after it is kept (see `applied`).
//
// UNTRUSTED VALUES. Every request value is checked against a fixed table before it becomes an
// attribute; every attribute read from the file is checked before it becomes an answer or is
// carried into a write.

import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { nullRecord } from '../store/package/safe-record.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import type {
  ParagraphBorderEdgeName,
  ParagraphBorderEdgeWrite,
} from '../store/store/tree-op-paragraph-borders.ts';
import {
  admissibleBorderAttributes,
  PARAGRAPH_BORDER_EDGES,
} from '../store/store/tree-op-paragraph-borders.ts';

/** One edge the object model addresses. */
export type AutomationParagraphBorderEdge = 'top' | 'left' | 'bottom' | 'right' | 'between';

/** The edges the object model addresses, in collection order. */
const AUTOMATION_PARAGRAPH_BORDER_EDGES: readonly AutomationParagraphBorderEdge[] = [
  'top',
  'left',
  'bottom',
  'right',
  'between',
];

/** A `Word.BorderLineStyle` value. `None` turns the edge off. */
export type AutomationBorderLineStyle =
  | 'None'
  | 'Single'
  | 'Dot'
  | 'DashSmallGap'
  | 'DashLargeGap'
  | 'DashDot'
  | 'DashDotDot'
  | 'Double'
  | 'Triple'
  | 'ThinThickSmallGap'
  | 'ThickThinSmallGap'
  | 'ThinThickThinSmallGap'
  | 'ThinThickMedGap'
  | 'ThickThinMedGap'
  | 'ThinThickThinMedGap'
  | 'ThinThickLargeGap'
  | 'ThickThinLargeGap'
  | 'ThinThickThinLargeGap'
  | 'SingleWavy'
  | 'DoubleWavy'
  | 'DashDotStroked'
  | 'Emboss3D'
  | 'Engrave3D'
  | 'Outset'
  | 'Inset';

/** `Word.BorderLineStyle` values, by the `ST_Border` value each one writes. */
const LINE_STYLE_VALUES: Readonly<Record<Exclude<AutomationBorderLineStyle, 'None'>, string>> = {
  Single: 'single',
  Dot: 'dotted',
  DashSmallGap: 'dashSmallGap',
  DashLargeGap: 'dashed',
  DashDot: 'dotDash',
  DashDotDot: 'dotDotDash',
  Double: 'double',
  Triple: 'triple',
  ThinThickSmallGap: 'thinThickSmallGap',
  ThickThinSmallGap: 'thickThinSmallGap',
  ThinThickThinSmallGap: 'thinThickThinSmallGap',
  ThinThickMedGap: 'thinThickMediumGap',
  ThickThinMedGap: 'thickThinMediumGap',
  ThinThickThinMedGap: 'thinThickThinMediumGap',
  ThinThickLargeGap: 'thinThickLargeGap',
  ThickThinLargeGap: 'thickThinLargeGap',
  ThinThickThinLargeGap: 'thinThickThinLargeGap',
  SingleWavy: 'wave',
  DoubleWavy: 'doubleWave',
  DashDotStroked: 'dashDotStroked',
  Emboss3D: 'threeDEmboss',
  Engrave3D: 'threeDEngrave',
  Outset: 'outset',
  Inset: 'inset',
};

const LINE_STYLE_BY_VALUE: ReadonlyMap<string, AutomationBorderLineStyle> = new Map(
  Object.entries(LINE_STYLE_VALUES).map(
    ([style, value]) => [value, style as AutomationBorderLineStyle] as const
  )
);

/** A `Word.LineWidth` value. */
export type AutomationBorderLineWidth =
  'Pt025' | 'Pt050' | 'Pt075' | 'Pt100' | 'Pt150' | 'Pt225' | 'Pt300' | 'Pt450' | 'Pt600';

/** `Word.LineWidth` values, by the `w:sz` (eighths of a point) each one writes. */
const LINE_WIDTH_EIGHTHS: Readonly<Record<AutomationBorderLineWidth, number>> = {
  Pt025: 2,
  Pt050: 4,
  Pt075: 6,
  Pt100: 8,
  Pt150: 12,
  Pt225: 18,
  Pt300: 24,
  Pt450: 36,
  Pt600: 48,
};

const LINE_WIDTH_BY_EIGHTHS: ReadonlyMap<number, AutomationBorderLineWidth> = new Map(
  Object.entries(LINE_WIDTH_EIGHTHS).map(
    ([width, eighths]) => [eighths, width as AutomationBorderLineWidth] as const
  )
);

/** A `Word.ColorIndex` value a read can answer. */
export type AutomationBorderColorIndex =
  | 'Auto'
  | 'Black'
  | 'Blue'
  | 'Turquoise'
  | 'BrightGreen'
  | 'Pink'
  | 'Red'
  | 'Yellow'
  | 'White'
  | 'DarkBlue'
  | 'Teal'
  | 'Green'
  | 'Violet'
  | 'DarkRed'
  | 'DarkYellow'
  | 'Gray50'
  | 'Gray25';

/**
 * `Word.ColorIndex` values this lane writes, by colour. The classic and by-author entries
 * depend on the reading application's palette or on revision authors, so they are refused.
 */
const COLOR_INDEX_HEX: Readonly<Record<Exclude<AutomationBorderColorIndex, 'Auto'>, string>> = {
  Black: '000000',
  Blue: '0000FF',
  Turquoise: '00FFFF',
  BrightGreen: '00FF00',
  Pink: 'FF00FF',
  Red: 'FF0000',
  Yellow: 'FFFF00',
  White: 'FFFFFF',
  DarkBlue: '000080',
  Teal: '008080',
  Green: '008000',
  Violet: '800080',
  DarkRed: '800000',
  DarkYellow: '808000',
  Gray50: '808080',
  Gray25: 'C0C0C0',
};

const COLOR_INDEX_BY_HEX: ReadonlyMap<string, AutomationBorderColorIndex> = new Map(
  Object.entries(COLOR_INDEX_HEX).map(
    ([name, hex]) => [hex, name as AutomationBorderColorIndex] as const
  )
);

/** One edge, as the object model reads it. */
export interface AutomationParagraphBorderRead {
  readonly edge: AutomationParagraphBorderEdge;
  /** Whether a line shows on this edge. */
  readonly isVisible: boolean;
  /** `None` for no line; `null` for a line style no `Word.BorderLineStyle` value names. */
  readonly lineStyle: AutomationBorderLineStyle | null;
  /** `null` for no line, or for a width no `Word.LineWidth` value names. */
  readonly lineWidth: AutomationBorderLineWidth | null;
  /** `#RRGGBB`, or `null` for no line or an automatic colour. */
  readonly color: string | null;
  /** `Auto` for an automatic colour; `null` for no line or a colour outside the palette. */
  readonly colorIndex: AutomationBorderColorIndex | null;
  /** Whether this is the border between paragraphs: the collection's inside edge. */
  readonly inside: boolean;
}

/** A border property a write assigns. */
export type AutomationParagraphBorderProperty =
  'isVisible' | 'lineStyle' | 'lineWidth' | 'color' | 'colorIndex';

/**
 * One assignment to one edge, in the order the caller made it.
 *
 * Order matters, as it does for the same assignments in sequence: a `lineStyle` resets the width
 * to `Pt050`, so a width set before it is lost and a width set after it stays.
 */
export type AutomationParagraphBorderAssignment =
  | {
      readonly edge: AutomationParagraphBorderEdge;
      readonly property: 'isVisible';
      readonly value: boolean;
    }
  | {
      readonly edge: AutomationParagraphBorderEdge;
      readonly property: 'lineStyle';
      readonly value: AutomationBorderLineStyle;
    }
  | {
      readonly edge: AutomationParagraphBorderEdge;
      readonly property: 'lineWidth';
      readonly value: AutomationBorderLineWidth;
    }
  | {
      readonly edge: AutomationParagraphBorderEdge;
      /** `#RRGGBB`. */
      readonly property: 'color';
      readonly value: string;
    }
  | {
      readonly edge: AutomationParagraphBorderEdge;
      readonly property: 'colorIndex';
      readonly value: AutomationBorderColorIndex;
    };

/** Border assignments to one paragraph, applied in order. */
export type AutomationParagraphBordersWrite = readonly AutomationParagraphBorderAssignment[];

/** Most assignments one write carries: a bound on the work an untyped caller can ask for. */
const MAX_ASSIGNMENTS = 1024;

const NO_LINE: ReadonlySet<string> = new Set(['nil', 'none']);
const FILE_HEX = /^[0-9A-Fa-f]{6}$/;
const REQUEST_HEX = /^#([0-9A-Fa-f]{6})$/;
const THEME_ATTRIBUTES = ['themeColor', 'themeTint', 'themeShade'] as const;
const PROPERTIES: ReadonlySet<string> = new Set([
  'isVisible',
  'lineStyle',
  'lineWidth',
  'color',
  'colorIndex',
]);

/** An edge turned off over a style edge that shows: the form an off edge is written in. */
const OFF_EDGE: Readonly<Record<string, string>> = Object.freeze({
  val: 'none',
  sz: '0',
  space: '0',
  color: 'auto',
});

type EdgeAttributes = Record<string, string>;
type EdgeMap = Map<ParagraphBorderEdgeName, EdgeAttributes>;

/** Where the inherited borders come from: the style index, which owns the cascade. */
export interface InheritedParagraphBorders {
  /**
   * The `w:pBdr` elements the paragraph inherits, in cascade order, ignoring its own: document
   * defaults, an enclosing cell's table style, its style chain, and its numbering level.
   * `styleId` resolves them as if the paragraph named that style.
   */
  inheritedBorders(part: OoxmlPart, paragraph: OoxmlNode, styleId?: string): readonly OoxmlNode[];
}

/** The `w:`-namespace attributes of one element's edges, with logical names folded to physical. */
function edgesOf(pBdr: OoxmlNode | undefined): EdgeMap {
  const edges: EdgeMap = new Map();
  if (!pBdr || pBdr.kind === 'textValue') return edges;
  for (const child of pBdr.children) {
    if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    const name =
      child.localName === 'start' ? 'left' : child.localName === 'end' ? 'right' : child.localName;
    if (!PARAGRAPH_BORDER_EDGES.includes(name as ParagraphBorderEdgeName)) continue;
    // The physical name wins when a file states both spellings, as layout reads it.
    if (edges.has(name as ParagraphBorderEdgeName) && child.localName !== name) continue;
    const attributes = nullRecord<string>();
    for (const attribute of child.attributes) {
      if (attribute.namespaceUri === WML_NAMESPACE_URI)
        attributes[attribute.localName] = attribute.value;
    }
    edges.set(name as ParagraphBorderEdgeName, attributes);
  }
  return edges;
}

/** The edges several elements state, folded in order: each overrides only the edges it states. */
function foldedEdges(elements: readonly (OoxmlNode | undefined)[]): EdgeMap {
  const folded: EdgeMap = new Map();
  for (const element of elements) {
    for (const [edge, attributes] of edgesOf(element)) folded.set(edge, attributes);
  }
  return folded;
}

function visible(attributes: EdgeAttributes | undefined): attributes is EdgeAttributes {
  return attributes !== undefined && attributes.val !== undefined && !NO_LINE.has(attributes.val);
}

/**
 * One edge reduced to what it shows. Absent attributes take the values layout paints with, so
 * `<w:bottom w:val="single"/>` and the same line with `w:sz="4"` and `w:color="auto"` compare
 * equal, and every edge with no line compares equal to every other.
 */
function meaningOf(attributes: EdgeAttributes | undefined): string {
  if (!visible(attributes)) return 'off';
  const color = attributes.color === undefined ? 'auto' : attributes.color.toLowerCase();
  return [
    attributes.val,
    attributes.sz ?? '4',
    attributes.space ?? '0',
    color,
    attributes.themeColor ?? '',
    attributes.themeTint?.toLowerCase() ?? '',
    attributes.themeShade?.toLowerCase() ?? '',
    attributes.shadow ?? '',
    attributes.frame ?? '',
  ].join('|');
}

function readEdge(
  edge: AutomationParagraphBorderEdge,
  attributes: EdgeAttributes | undefined
): AutomationParagraphBorderRead {
  const inside = edge === 'between';
  if (!visible(attributes)) {
    return {
      edge,
      isVisible: false,
      lineStyle: 'None',
      lineWidth: null,
      color: null,
      colorIndex: null,
      inside,
    };
  }
  // A missing `w:sz` paints at the half-point default, as layout draws it.
  const eighths = attributes.sz === undefined ? 4 : Number(attributes.sz);
  // An absent `w:color` is automatic, the same as `auto`.
  const automatic = attributes.color === undefined || attributes.color === 'auto';
  const hex =
    !automatic && FILE_HEX.test(attributes.color!) ? attributes.color!.toUpperCase() : null;
  return {
    edge,
    isVisible: true,
    lineStyle: LINE_STYLE_BY_VALUE.get(attributes.val) ?? null,
    lineWidth: Number.isInteger(eighths) ? (LINE_WIDTH_BY_EIGHTHS.get(eighths) ?? null) : null,
    color: hex === null ? null : `#${hex}`,
    colorIndex: automatic ? 'Auto' : hex === null ? null : (COLOR_INDEX_BY_HEX.get(hex) ?? null),
    inside,
  };
}

/** The edges a paragraph shows: the inherited ones, folded with its own, edge by edge. */
function edgesInForce(
  part: OoxmlPart,
  paragraph: OoxmlNode,
  styles: InheritedParagraphBorders
): EdgeMap {
  return foldedEdges([
    ...styles.inheritedBorders(part, paragraph),
    namedChild(paragraphPropertiesNodeOf(paragraph), 'pBdr'),
  ]);
}

/** The five edges the object model reads, in collection order, or null for no paragraph. */
export function paragraphBordersRead(
  part: OoxmlPart,
  paragraphId: string,
  styles: InheritedParagraphBorders
): readonly AutomationParagraphBorderRead[] | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const edges = edgesInForce(part, paragraph, styles);
  return AUTOMATION_PARAGRAPH_BORDER_EDGES.map((edge) => readEdge(edge, edges.get(edge)));
}

/** The result of planning a border write. */
export type ParagraphBordersPlan =
  | {
      readonly ok: true;
      /** The paragraph's own `w:pBdr` edges as they should stand, or null for no change. */
      readonly edges: readonly ParagraphBorderEdgeWrite[] | null;
    }
  | { readonly ok: false; readonly detail: string };

function refuse(detail: string): ParagraphBordersPlan {
  return { ok: false, detail };
}

/** The `w:color` one colour assignment writes, or null for a value this lane refuses. */
function requestedColor(property: 'color' | 'colorIndex', value: unknown): string | null {
  if (property === 'color') {
    const match = typeof value === 'string' ? REQUEST_HEX.exec(value) : null;
    return match ? match[1]!.toUpperCase() : null;
  }
  if (value === 'Auto') return 'auto';
  return typeof value === 'string' && Object.hasOwn(COLOR_INDEX_HEX, value)
    ? COLOR_INDEX_HEX[value as Exclude<AutomationBorderColorIndex, 'Auto'>]
    : null;
}

/**
 * One assignment applied to the edge as it stands, as the same assignment behaves in sequence:
 *
 * - a line style draws the line at `Pt050`, keeping the edge's colour and gap; a new line takes
 *   an automatic colour and no gap;
 * - `isVisible = true` draws a single line where there is none and leaves a line alone;
 * - `lineStyle = 'None'` and `isVisible = false` take the line away;
 * - a width on an edge with no line changes nothing;
 * - a colour on an edge with no line is kept for the next line drawn there.
 */
function applied(
  current: EdgeAttributes | undefined,
  property: AutomationParagraphBorderProperty,
  value: unknown
): EdgeAttributes | undefined | string {
  const shown = visible(current);
  switch (property) {
    case 'isVisible':
      if (typeof value !== 'boolean') return 'isVisible: not a boolean';
      if (!value) return undefined;
      return shown ? current : applied(current, 'lineStyle', 'Single');
    case 'lineStyle': {
      if (value === 'None') return undefined;
      if (typeof value !== 'string' || !Object.hasOwn(LINE_STYLE_VALUES, value))
        return `lineStyle: ${String(value)}`;
      const base = current ? admissibleBorderAttributes(current) : nullRecord<string>();
      return {
        ...base,
        val: LINE_STYLE_VALUES[value as Exclude<AutomationBorderLineStyle, 'None'>],
        sz: '4',
        space: base.space ?? '0',
        color: base.color ?? 'auto',
      };
    }
    case 'lineWidth':
      if (typeof value !== 'string' || !Object.hasOwn(LINE_WIDTH_EIGHTHS, value))
        return `lineWidth: ${String(value)}`;
      if (!shown) return current;
      return {
        ...admissibleBorderAttributes(current),
        sz: String(LINE_WIDTH_EIGHTHS[value as AutomationBorderLineWidth]),
      };
    case 'color':
    case 'colorIndex': {
      const color = requestedColor(property, value);
      if (color === null)
        return `${property}: ${property === 'color' ? 'not #RRGGBB' : String(value)}`;
      // A colour the edge already stores is kept with its theme colour, which `color` and
      // `colorIndex` read back as that stored value.
      if (shown && current.color?.toLowerCase() === color.toLowerCase()) return current;
      const next = shown ? admissibleBorderAttributes(current) : { ...OFF_EDGE };
      next.color = color;
      // A theme colour overrides `w:color`, so a stated colour has to drop it to show.
      for (const name of THEME_ATTRIBUTES) delete next[name];
      return next;
    }
  }
}

/**
 * The paragraph's own border edges after a write, or why the write is refused.
 *
 * Only the edges the write changes are stated, as minimal as the cascade allows: a line the
 * style already draws is not restated, an edge turned off over a style line is written off
 * (`none`), and an edge turned off with no style line under it is removed. Untouched edges,
 * including `w:bar`, keep their attributes.
 *
 * `styleId` is the style the same write applies, if any, so a style and a border can share a
 * sync and the border resolves against the new style.
 */
export function paragraphBordersPlan(
  part: OoxmlPart,
  paragraph: OoxmlNode,
  request: unknown,
  styles: InheritedParagraphBorders,
  styleId?: string
): ParagraphBordersPlan {
  if (!Array.isArray(request)) return refuse('borders: not a list of assignments');
  if (request.length > MAX_ASSIGNMENTS) return refuse('borders: too many assignments');
  const own = edgesOf(namedChild(paragraphPropertiesNodeOf(paragraph), 'pBdr'));
  const inherited = foldedEdges(styles.inheritedBorders(part, paragraph, styleId));
  const state = new Map<ParagraphBorderEdgeName, EdgeAttributes | undefined>();
  for (const assignment of request as readonly unknown[]) {
    if (typeof assignment !== 'object' || assignment === null)
      return refuse('borders: an assignment is not an object');
    const { edge, property, value } = assignment as Record<string, unknown>;
    if (!AUTOMATION_PARAGRAPH_BORDER_EDGES.includes(edge as AutomationParagraphBorderEdge))
      return refuse(`borders: ${String(edge)} is not an edge`);
    if (typeof property !== 'string' || !PROPERTIES.has(property))
      return refuse(`borders.${String(edge)}: ${String(property)} is not a border property`);
    const name = edge as AutomationParagraphBorderEdge;
    const current = state.has(name) ? state.get(name) : (own.get(name) ?? inherited.get(name));
    const next = applied(current, property as AutomationParagraphBorderProperty, value);
    if (typeof next === 'string') return refuse(`borders.${name}.${next}`);
    state.set(name, next);
  }
  const after: EdgeMap = new Map(own);
  let changed = false;
  for (const [edge, final] of state) {
    const before = own.get(edge);
    const style = inherited.get(edge);
    let stated: EdgeAttributes | undefined;
    if (visible(final)) stated = meaningOf(final) === meaningOf(style) ? undefined : final;
    else stated = visible(style) ? { ...OFF_EDGE } : undefined;
    // What the paragraph shows decides whether anything moved, not the attribute spelling.
    const showsBefore = meaningOf(before ?? style);
    const showsAfter = meaningOf(stated ?? style);
    if (showsBefore === showsAfter) continue;
    changed = true;
    if (stated) after.set(edge, stated);
    else after.delete(edge);
  }
  if (!changed) return { ok: true, edges: null };
  return {
    ok: true,
    edges: PARAGRAPH_BORDER_EDGES.flatMap((edge) => {
      const stated = after.get(edge);
      if (!stated) return [];
      const attributes = admissibleBorderAttributes(stated);
      if (attributes.val !== undefined) return [{ edge, attributes }];
      // An untouched own edge with no usable line shows no line: keep it off over a style line.
      return visible(inherited.get(edge)) ? [{ edge, attributes: { ...OFF_EDGE } }] : [];
    }),
  };
}
