// Small tools for editing a chart part (`c:chartSpace`, ECMA-376 Part 1, 21.2) as a tree: parse
// a fragment of chart markup, find a child, and put a child where the schema's sequence wants
// it. The chart type and element edits (`format.ts`) and the new chart (`insert.ts`) share
// them. DOM-free.

import {
  attr,
  child,
  ChartRefusal,
  colorXml,
  elements,
  escapeXml,
  NS,
  parseXmlPart,
  type ChartColor,
  type ChartThemeColor,
  type Element,
  type Node,
} from './tree.ts';

const WRAP = `xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"`;

/** The elements of a fragment of chart markup with the `c`, `a`, and `r` prefixes. */
export function chartFragment(xml: string): Element[] {
  const r = parseXmlPart('/chart-fragment.xml', `<c:w ${WRAP}>${xml}</c:w>`);
  if (!r.ok) throw new ChartRefusal('chart.errors.unsupported', 'template');
  return elements(r.part.root);
}
export function chartElement(xml: string): Element {
  const [first] = chartFragment(xml);
  if (!first) throw new ChartRefusal('chart.errors.unsupported', 'template');
  return first;
}

/** The `c:` child `local` of `el`. */
export const cChild = (el: Element | undefined, local: string): Element | undefined =>
  child(el, { namespaceUri: NS.c, local });

/** The `c:` children `local` of `el`. */
export const cChildren = (el: Element | undefined, local: string): Element[] =>
  elements(el).filter((e) => e.namespaceUri === NS.c && e.localName === local);

/** The `val` of the `c:` child `local`, or undefined. */
export const cVal = (el: Element | undefined, local: string): string | undefined =>
  attr(cChild(el, local), 'val');

/** A boolean `c:` child (`CT_Boolean`): absent is `fallback`; no `val` is true. */
export function cFlag(el: Element | undefined, local: string, fallback: boolean): boolean {
  const flag = cChild(el, local);
  if (!flag) return fallback;
  const v = attr(flag, 'val');
  return v === undefined || v === '1' || v === 'true';
}

/** `el` with other children. */
export const withKids = (el: Element, children: readonly Node[]): Element => ({
  ...el,
  children: [...children],
});

/** `el` without its children `drop` returns true for. */
export const without = (el: Element, drop: (e: Element) => boolean): Element =>
  withKids(
    el,
    el.children.filter((k) => k.kind === 'textValue' || !drop(k))
  );

/** `el` without its `c:` children named in `locals`. */
export const withoutC = (el: Element, ...locals: string[]): Element =>
  without(el, (e) => e.namespaceUri === NS.c && locals.includes(e.localName));

/**
 * `el` with `next` in the place the schema sequence `order` gives it. An element of the same
 * namespace and name goes; the new one comes before the first child that the sequence puts
 * after it. A child the sequence does not name never moves.
 */
export function placeChild(el: Element, next: Element, order: readonly string[]): Element {
  const rank = order.indexOf(next.localName);
  const kept = el.children.filter(
    (k) =>
      !(
        k.kind !== 'textValue' &&
        k.namespaceUri === next.namespaceUri &&
        k.localName === next.localName
      )
  );
  const at = kept.findIndex(
    (k) =>
      k.kind !== 'textValue' &&
      k.namespaceUri === next.namespaceUri &&
      order.indexOf(k.localName) > rank
  );
  if (at < 0) return withKids(el, [...kept, next]);
  return withKids(el, [...kept.slice(0, at), next, ...kept.slice(at)]);
}

/** `el` with its child `old` replaced by `next`. */
export const replaceKid = (el: Element, old: Element, next: Element): Element =>
  withKids(
    el,
    el.children.map((k) => (k === old ? next : k))
  );

/** `CT_Chart` (§21.2.2.27). */
export const CHART_ORDER = [
  'title',
  'autoTitleDeleted',
  'pivotFmts',
  'view3D',
  'floor',
  'sideWall',
  'backWall',
  'plotArea',
  'legend',
  'plotVisOnly',
  'dispBlanksAs',
  'showDLblsOverMax',
  'extLst',
];

/** `CT_CatAx`, `CT_ValAx`, `CT_DateAx`, and `CT_SerAx` (§21.2.2.25, 21.2.2.226, …) as one. */
export const AXIS_ORDER = [
  'axId',
  'scaling',
  'delete',
  'axPos',
  'majorGridlines',
  'minorGridlines',
  'title',
  'numFmt',
  'majorTickMark',
  'minorTickMark',
  'tickLblPos',
  'spPr',
  'txPr',
  'crossAx',
  'crosses',
  'crossesAt',
  'crossBetween',
  'auto',
  'lblAlgn',
  'lblOffset',
  'baseTimeUnit',
  'majorUnit',
  'minorUnit',
  'majorTimeUnit',
  'minorTimeUnit',
  'tickLblSkip',
  'tickMarkSkip',
  'dispUnits',
  'noMultiLvlLbl',
  'extLst',
];

/** `CT_Legend` (§21.2.2.93). */
export const LEGEND_ORDER = [
  'legendPos',
  'legendEntry',
  'layout',
  'overlay',
  'spPr',
  'txPr',
  'extLst',
];

/** The series types of §21.2.2 (`CT_BarSer`, `CT_LineSer`, `CT_PieSer`, …) as one sequence. */
export const SERIES_ORDER = [
  'idx',
  'order',
  'tx',
  'spPr',
  'explosion',
  'invertIfNegative',
  'pictureOptions',
  'marker',
  'dPt',
  'dLbls',
  'trendline',
  'errBars',
  'cat',
  'xVal',
  'val',
  'yVal',
  'shape',
  'smooth',
  'extLst',
];

/** `CT_DPt` (§21.2.2.52). */
export const POINT_ORDER = [
  'idx',
  'invertIfNegative',
  'marker',
  'bubble3D',
  'explosion',
  'spPr',
  'pictureOptions',
  'extLst',
];

/** `CT_ShapeProperties` (§20.1.2.2.35). */
export const SHAPE_PROPS_ORDER = [
  'xfrm',
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
  'ln',
  'effectLst',
  'effectDag',
  'scene3d',
  'sp3d',
  'extLst',
];

/** The fill elements of `EG_FillProperties`. */
export const FILLS = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
]);

const THEME_SLOTS: ReadonlySet<string> = new Set<ChartThemeColor>([
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

/**
 * The color of a fill element as the chrome names it, or null for no solid color: `#RRGGBB`, or
 * a theme color with its lighter or darker shift (`a:lumMod`, `a:lumOff`).
 */
export function colorOfFill(fill: Element | undefined): ChartColor | null {
  if (!fill || fill.namespaceUri !== NS.a || fill.localName !== 'solidFill') return null;
  const color = elements(fill)[0];
  if (!color) return null;
  const val = attr(color, 'val') ?? '';
  if (color.localName === 'srgbClr')
    return /^[0-9A-Fa-f]{6}$/.test(val) ? `#${val.toUpperCase()}` : null;
  if (color.localName !== 'schemeClr' || !THEME_SLOTS.has(val)) return null;
  const mod = Number(attr(child(color, 'a:lumMod'), 'val') ?? 100_000);
  const off = Number(attr(child(color, 'a:lumOff'), 'val') ?? 0);
  const shift =
    off > 0 ? Math.round(off / 1000) : mod < 100_000 ? -Math.round(100 - mod / 1000) : 0;
  const theme = val as ChartThemeColor;
  return shift !== 0 && Math.abs(shift) < 100 ? { theme, shift } : { theme };
}

/** An `a:solidFill` of a color the chrome names. Throws `ChartRefusal` for another value. */
export const solidFillXml = (color: ChartColor): string =>
  `<a:solidFill>${colorXml(color)}</a:solidFill>`;

/** A paragraph of chart text (`c:rich`) holding `text`, with `rPr` for its run. */
export function richXml(
  text: string,
  bodyPr = '<a:bodyPr/>',
  rPr = '<a:rPr lang="en-US"/>'
): string {
  const runs = text
    ? `<a:r>${rPr}<a:t>${escapeXml(text)}</a:t></a:r>`
    : '<a:endParaRPr lang="en-US"/>';
  return `<c:rich>${bodyPr}<a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr>${runs}</a:p></c:rich>`;
}
