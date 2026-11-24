// The tree helpers that the chart edits share: read a child or an attribute of a chart part
// element (`c:chartSpace`, ECMA-376 Part 1, 21.2) or of a workbook part, parse and write a part,
// and the refusal that an edit throws. Every chart and workbook element is a generic node, so
// the edits build new nodes as plain objects. Node ids are assigned when the edit is
// committed (`chart-package.ts`). DOM-free.

import type {
  OoxmlAttribute,
  OoxmlElement,
  OoxmlGenericElementNode,
  OoxmlTextNode,
} from '../ooxml-tree.ts';
import { readOoxmlPart } from '../ooxml-tree.ts';
import { serializeOoxmlPart } from '../ooxml-serialize.ts';
import { escapeXml, escapeXmlAttribute, isValidXmlText } from '../sinks.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, RELATIONSHIPS_NAMESPACE_URI } from '../ooxml-shared.ts';
import { CHART_NAMESPACE_URI } from '../chart-parts.ts';
import type { ChartColor, ChartThemeColor } from './types.ts';

export { escapeXml, escapeXmlAttribute, isValidXmlText };

/**
 * An element of a chart or workbook part. The reader types only WordprocessingML and the
 * drawing anchor, so every element of these parts is a generic node.
 */
export interface Element extends Omit<OoxmlGenericElementNode, 'children'> {
  readonly children: readonly Node[];
}
/** A node of a chart or workbook part. */
export type Node = Element | OoxmlTextNode;

/** A chart or workbook part element as the chart edits type it. */
export const asChartElement = (el: OoxmlElement): Element => el as unknown as Element;
export type { ChartColor, ChartThemeColor };

/** The namespaces of a chart part. */
export const NS = {
  c: CHART_NAMESPACE_URI,
  a: DRAWINGML_MAIN_NAMESPACE_URI,
  r: RELATIONSHIPS_NAMESPACE_URI,
} as const;

const PREFIXES: Readonly<Record<string, string>> = { c: NS.c, a: NS.a, r: NS.r };

/**
 * Why a chart edit is refused. `reason` is a translation key, such as
 * `chart.errors.noChart`; `detail` names the field or the value.
 */
export class ChartRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: string
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

/** The element children of `el`. */
export const elements = (el: Element | undefined): Element[] =>
  el ? (el.children.filter((k) => k.kind !== 'textValue') as Element[]) : [];

/** A namespace and local name, or a `prefix:local` name of a chart part namespace. */
export type ChildName =
  | string
  | { readonly namespaceUri: string; readonly local: string }
  | { readonly namespaceUri: string; readonly localName: string };

function nameOf(name: ChildName): { ns: string; local: string } {
  if (typeof name !== 'string')
    return { ns: name.namespaceUri, local: 'local' in name ? name.local : name.localName };
  const at = name.indexOf(':');
  if (at < 0) return { ns: '', local: name };
  return { ns: PREFIXES[name.slice(0, at)] ?? '', local: name.slice(at + 1) };
}

/** The first child of `el` with the name `name`. */
export function child(el: Element | undefined, name: ChildName): Element | undefined {
  const { ns, local } = nameOf(name);
  return elements(el).find((e) => e.namespaceUri === ns && e.localName === local);
}

/** Every child of `el` with the name `name`. */
export function children(el: Element | undefined, name: ChildName): Element[] {
  const { ns, local } = nameOf(name);
  return elements(el).filter((e) => e.namespaceUri === ns && e.localName === local);
}

/** The value of the attribute `name` (`val`, or `r:id`), or undefined. */
export function attr(el: Element | undefined, name: ChildName): string | undefined {
  if (!el) return undefined;
  const { ns, local } = nameOf(name);
  return el.attributes.find((a) => a.namespaceUri === ns && a.localName === local)?.value;
}

/** The text of an element's text children. */
export function textOf(el: Element | undefined): string {
  let s = '';
  for (const n of el?.children ?? []) if (n.kind === 'textValue') s += n.value;
  return s;
}

/** An attribute with no namespace. */
export const plainAttr = (localName: string, value: string): OoxmlAttribute => ({
  kind: 'genericExtension',
  namespaceUri: '',
  localName,
  value,
});

/** A new generic element. Its id is assigned when the edit is committed. */
export function newElement(
  namespaceUri: string,
  prefix: string | undefined,
  localName: string,
  attributes: readonly OoxmlAttribute[] = [],
  kids: readonly Node[] = []
): Element {
  const el: Element = {
    id: '',
    kind: 'generic',
    namespaceUri,
    localName,
    ...(prefix ? { prefix } : {}),
    namespaceBindings: [],
    attributes,
    children: kids,
  };
  return el;
}

/** A new text node. */
export const newText = (value: string): Node => ({ id: '', kind: 'textValue', value });

/** `el` with other attributes. */
export const withAttributes = (el: Element, attributes: readonly OoxmlAttribute[]): Element => ({
  ...el,
  attributes,
});

/** The parsed root of one XML part, or the reason it cannot be read. */
export type PartRead =
  | { readonly ok: true; readonly part: { readonly root: Element } }
  | { readonly ok: false; readonly reason: string };

/** Parse one XML part with the bounded reader. Never throws: the bytes are untrusted. */
export function parseXmlPart(partName: string, xml: string): PartRead {
  const read = readOoxmlPart(xml, { name: partName, contentType: 'application/xml' });
  return read.ok
    ? { ok: true, part: { root: asChartElement(read.part.root) } }
    : { ok: false, reason: read.reason };
}

/** The XML of a part with `root`. Throws for a value that XML cannot hold. */
export function serializeXmlPart(partName: string, root: Element): string {
  return serializeOoxmlPart({
    id: partName,
    name: partName,
    contentType: 'application/xml',
    root,
  });
}

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

/** Whether `value` is a `ChartColor`: `#RRGGBB`, or a theme color with a shift. */
export function isChartColor(value: unknown): value is ChartColor {
  if (typeof value === 'string') return /^#[0-9A-Fa-f]{6}$/.test(value);
  if (!value || typeof value !== 'object') return false;
  const { theme, shift } = value as { theme?: unknown; shift?: unknown };
  if (typeof theme !== 'string' || !THEME_SLOTS.has(theme)) return false;
  return (
    shift === undefined ||
    (typeof shift === 'number' && Number.isInteger(shift) && Math.abs(shift) < 100)
  );
}

/** Whether `slot` names a theme color that a chart color can use. */
export const isThemeSlot = (slot: string): slot is ChartThemeColor => THEME_SLOTS.has(slot);

/** The DrawingML color element of a chart color. Throws `ChartRefusal` for another value. */
export function colorXml(color: ChartColor): string {
  if (!isChartColor(color)) throw new ChartRefusal('chart.errors.invalidValue', 'color');
  if (typeof color === 'string')
    return `<a:srgbClr val="${color.replace(/^#/, '').toUpperCase()}"/>`;
  const shift = color.shift ?? 0;
  if (shift === 0) return `<a:schemeClr val="${color.theme}"/>`;
  const mod = `<a:lumMod val="${(100 - Math.abs(shift)) * 1000}"/>`;
  const off = shift > 0 ? `<a:lumOff val="${shift * 1000}"/>` : '';
  return `<a:schemeClr val="${color.theme}">${mod}${off}</a:schemeClr>`;
}
