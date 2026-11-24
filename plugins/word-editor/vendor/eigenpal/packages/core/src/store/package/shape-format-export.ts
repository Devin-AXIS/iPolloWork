// Keep a saved shape's fill and outline consistent with itself on export.
//
// Two people can edit one shape's fill at once: one hides it, which keeps the old fill in an
// `a14:hiddenFill` extension, while the other recolours it. Each write is valid on its own, but
// merged they can leave a hidden-fill extension with no fill, or a VML fallback that says
// `filled="f"` beside a DrawingML fill that shows. A file with an empty `a14:hiddenFill` does not
// open in the reference application. So an export snapshot repairs what a merge can leave:
//
// - an `a14:hiddenFill` keeps exactly one fill, or goes when it holds none; an `a14:hiddenLine`
//   keeps one fill; a repeated extension keeps its first copy;
// - a VML fallback flag or named colour that contradicts the fill or line the DrawingML copy
//   writes in its own `spPr` takes the DrawingML value.
//
// Paint that comes from a shape style, and VML defaults, stay as authored, so a file whose
// copies do not contradict each other is written back unchanged. The decision reads canonical
// content only, so every participant in a collaboration session saves the same bytes.

import { isMcAlternateContent } from './drawing-projection-walk.ts';
import { replaceNodesForExport } from './export-node-replace.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI as A,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';
import { shapeColorHex, shapeFormatTargets } from './shape-format.ts';

const VML = 'urn:schemas-microsoft-com:vml';
const HIDDEN_FILL_URI = '{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}';
const HIDDEN_URIS = new Set([HIDDEN_FILL_URI, '{91240B29-F687-4F45-9708-019B960494DF}']);
const FILLS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);
/** Node visits per part. A part that exhausts it is written as it is, never half-repaired. */
const MAX_SCANNED_NODES = 1 << 20;

function elementsOf(node: OoxmlElement): OoxmlElement[] {
  const values: readonly OoxmlNode[] = node.children;
  return values.filter((child): child is OoxmlElement => child.kind !== 'textValue');
}

function attributeOf(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((a) => !a.namespaceUri && a.localName === localName)?.value;
}

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}

const fillsOf = (node: OoxmlElement) =>
  elementsOf(node).filter((c) => c.namespaceUri === A && FILLS.has(c.localName));

/**
 * One hidden extension repaired, the same node, or null when it goes. `a14:hiddenFill` needs
 * exactly one fill; `a14:hiddenLine` is a whole line, so only a repeated fill inside it goes.
 */
function repairedExtension(ext: OoxmlElement, uri: string): OoxmlElement | null {
  const hidden = elementsOf(ext)[0];
  if (!hidden) return null;
  const fills = fillsOf(hidden);
  if (uri === HIDDEN_FILL_URI && fills.length === 0) return null;
  if (fills.length <= 1) return ext;
  const extra = new Set<OoxmlNode>(fills.slice(1));
  return withChildren(ext, [
    withChildren(
      hidden,
      hidden.children.filter((c) => !extra.has(c))
    ),
  ]);
}

/** `extLst` with each hidden extension repaired, the same node when it needs none, or null. */
function repairedExtensions(list: OoxmlElement): OoxmlElement | null {
  const seen = new Set<string>();
  let changed = false;
  const kept: OoxmlNode[] = [];
  for (const ext of list.children) {
    const uri = ext.kind !== 'textValue' ? attributeOf(ext, 'uri') : undefined;
    if (ext.kind === 'textValue' || ext.localName !== 'ext' || !uri || !HIDDEN_URIS.has(uri)) {
      kept.push(ext);
      continue;
    }
    const next = seen.has(uri) ? null : repairedExtension(ext, uri);
    seen.add(uri);
    if (next !== ext) changed = true;
    if (next) kept.push(next);
  }
  if (!changed) return list;
  return kept.some((child) => child.kind !== 'textValue') ? withChildren(list, kept) : null;
}

/** A shape property element (`spPr`, `a:ln`) with its hidden extensions repaired. */
function repairedProperties(node: OoxmlElement): OoxmlElement {
  const list = node.children.find(
    (c) => c.kind !== 'textValue' && c.namespaceUri === A && c.localName === 'extLst'
  ) as OoxmlElement | undefined;
  if (!list) return node;
  const next = repairedExtensions(list);
  if (next === list) return node;
  return withChildren(
    node,
    next
      ? node.children.map((c) => (c === list ? next : c))
      : node.children.filter((c) => c !== list)
  );
}

/** `attributes` with each unqualified value set, or removed for null. */
function setAttributes(
  attributes: readonly OoxmlAttribute[],
  values: ReadonlyMap<string, string | null>
): OoxmlAttribute[] {
  const next = attributes.filter((a) => a.namespaceUri || !values.has(a.localName));
  for (const [localName, value] of values)
    if (value !== null)
      next.push({ kind: 'genericExtension', namespaceUri: '', localName, value } as OoxmlAttribute);
  return next;
}

/**
 * The plain sRGB colour a fill element shows, as `RRGGBB`, or null. A colour transform other
 * than `a:alpha` changes the colour, so such a colour is not plain.
 */
function srgbOf(fill: OoxmlElement | null | undefined): string | null {
  if (!fill || fill.localName !== 'solidFill') return null;
  const color = elementsOf(fill)[0];
  if (!color || color.localName !== 'srgbClr') return null;
  if (elementsOf(color).some((c) => c.localName !== 'alpha')) return null;
  const value = attributeOf(color, 'val');
  return value && /^[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : null;
}

/** A VML colour as `RRGGBB`: `#rrggbb`, `#rgb` or a colour name, theme suffix ignored. */
function vmlColourHex(value: string): string | null {
  const text = value.replace(/\s*\[\d+\]\s*$/, '').trim();
  const short = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/.exec(text);
  if (short)
    return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  return shapeColorHex(text);
}

const flagOff = (value: string | undefined) =>
  value !== undefined && ['f', 'false', '0'].includes(value.trim().toLowerCase());

/** Whether a fill element paints: true, false, or null when the element cannot say. */
function paints(fill: OoxmlElement | null | undefined): boolean | null {
  if (!fill || fill.localName === 'grpFill') return null;
  return fill.localName !== 'noFill';
}

/**
 * Sets a VML colour that names a different colour than `color`. Only a colour the VML copy
 * names and the repair can read is compared, by value (`black` is `#000000`), with a theme
 * index suffix ignored.
 */
function agreeColour(
  values: Map<string, string | null>,
  vml: OoxmlElement,
  name: string,
  color: string | null
): void {
  const current = attributeOf(vml, name);
  if (!color || current === undefined) return;
  // A colour the repair cannot read (`window`, `rgb(...)`) stays as written.
  const named = vmlColourHex(current);
  if (named !== null && named !== color) values.set(name, `#${color.toLowerCase()}`);
}

/**
 * The VML copy with its fill and stroke agreeing with the DrawingML shape's own `spPr`, or
 * itself. A VML copy that names a colour paints it unless a flag says otherwise.
 */
function agreeingVml(
  vml: OoxmlElement,
  wsp: OoxmlElement,
  groupFill: OoxmlElement | null
): OoxmlElement {
  const spPr = elementsOf(wsp).find(
    (c) => c.namespaceUri === wsp.namespaceUri && c.localName === 'spPr'
  );
  if (!spPr) return vml;
  const own = fillsOf(spPr)[0];
  const fill = own?.localName === 'grpFill' ? groupFill : own;
  const ln = elementsOf(spPr).find((c) => c.namespaceUri === A && c.localName === 'ln');
  const lineFill = ln ? fillsOf(ln)[0] : undefined;
  const values = new Map<string, string | null>();
  // A `v:fill` or `v:stroke` child with `on="f"` turns the paint off as the flag does.
  const shown = new Set<OoxmlElement>();
  const agree = (paint: boolean | null, flag: string, colour: string, child: string) => {
    const sub = elementsOf(vml).find((c) => c.namespaceUri === VML && c.localName === child);
    const flagIsOff = flagOff(attributeOf(vml, flag));
    const subIsOff = !!sub && flagOff(attributeOf(sub, 'on'));
    // A VML copy that names a colour paints it unless a flag says otherwise.
    if (paint === false && !flagIsOff && !subIsOff && attributeOf(vml, colour) !== undefined)
      values.set(flag, 'f');
    if (paint === true && flagIsOff) values.set(flag, null);
    if (paint === true && subIsOff) shown.add(sub!);
  };
  // A line has no inside; its fill is never drawn.
  const fills = vml.localName === 'line' ? null : paints(fill);
  agree(fills, 'filled', 'fillcolor', 'fill');
  if (fills === true) agreeColour(values, vml, 'fillcolor', srgbOf(fill));
  const strokes = paints(lineFill);
  agree(strokes, 'stroked', 'strokecolor', 'stroke');
  if (strokes === true) agreeColour(values, vml, 'strokecolor', srgbOf(lineFill));
  if (values.size === 0 && shown.size === 0) return vml;
  const on = new Map<string, string | null>([['on', null]]);
  return {
    ...vml,
    attributes: values.size ? setAttributes(vml.attributes, values) : vml.attributes,
    children: shown.size
      ? vml.children.map((c) =>
          shown.has(c as OoxmlElement)
            ? ({
                ...c,
                attributes: setAttributes((c as OoxmlElement).attributes, on),
              } as OoxmlElement)
            : c
        )
      : vml.children,
  } as OoxmlElement;
}

/** Roots already found consistent: a save after an edit elsewhere skips them. */
const consistentRoots = new WeakSet<object>();

/** Replacements, by node id, that make one part consistent. */
function repairsOf(part: OoxmlPart): Map<string, OoxmlElement> | null {
  if (consistentRoots.has(part.root)) return null;
  const found = scanRepairs(part);
  if (!found) consistentRoots.add(part.root);
  return found;
}

function scanRepairs(part: OoxmlPart): Map<string, OoxmlElement> | null {
  const replaced = new Map<string, OoxmlElement>();
  const alternates: OoxmlElement[] = [];
  const stack: OoxmlNode[] = [part.root];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (++visited > MAX_SCANNED_NODES) return null;
    if (isMcAlternateContent(node)) alternates.push(node);
    if (
      (node.localName === 'spPr' || (node.namespaceUri === A && node.localName === 'ln')) &&
      node.children.length
    ) {
      const repaired = repairedProperties(node);
      if (repaired !== node) replaced.set(node.id, repaired);
    }
    for (let at = node.children.length - 1; at >= 0; at -= 1) stack.push(node.children[at]!);
  }
  for (const alternate of alternates) {
    const targets = shapeFormatTargets(part, alternate.id);
    if (typeof targets === 'string' || !targets.fallback) continue;
    targets.shapes.forEach((wsp, index) => {
      const vml = targets.fallback![index]!;
      const next = agreeingVml(vml, wsp, targets.groupFills[index] ?? null);
      if (next !== vml) replaced.set(vml.id, next);
    });
  }
  return replaced.size ? replaced : null;
}

/** An export snapshot whose shapes' hidden fills and VML fallbacks agree with their fills. */
export function shapeFormatExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  let next: OoxmlPackage | null = null;
  for (const part of pkg.parts.values()) {
    const repairs = repairsOf(part);
    if (!repairs) continue;
    const repaired = replaceNodesForExport(part, repairs);
    if (!repaired) continue;
    next ??= { ...pkg, parts: new Map(pkg.parts) };
    (next.parts as Map<string, OoxmlPart>).set(part.name, repaired);
  }
  return next ?? pkg;
}
