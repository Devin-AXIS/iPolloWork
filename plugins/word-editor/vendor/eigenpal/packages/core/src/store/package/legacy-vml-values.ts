import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** The VML namespace. @internal */
export const VML = 'urn:schemas-microsoft-com:vml';
/** The Office VML extensions namespace (`o:`). @internal */
export const OFFICE = 'urn:schemas-microsoft-com:office:office';
/** The Word VML extensions namespace (`w10:`). @internal */
export const WORD_VML = 'urn:schemas-microsoft-com:office:word';
export const element = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
/** Whether `node` is the element `ns`:`name`. @internal */
export const named = (node: OoxmlNode, ns: string, name: string): boolean =>
  element(node) && node.namespaceUri === ns && node.localName === name;
/** The value of attribute `name` in namespace `ns` (none by default). @internal */
export const attribute = (node: OoxmlElement, name: string, ns = '') =>
  node.attributes.find((a) => (a.namespaceUri ?? '') === ns && a.localName === name)?.value;
/** The element children of `node`. @internal */
export function children(node: OoxmlElement): OoxmlElement[] {
  const values: readonly OoxmlNode[] = node.children;
  return values.filter(element);
}
/** The VML elements that draw a shape; `v:shapetype` is a template, not a shape. @internal */
export const VML_SHAPE_ELEMENTS: ReadonlySet<string> = new Set([
  'shape',
  'rect',
  'roundrect',
  'oval',
  'line',
  'polyline',
  'curve',
  'arc',
  'image',
  'group',
]);
/** Word's VML shape id: `_x0000_` and a letter, then the shape number (`xsd:unsignedInt`). */
const SHAPE_ID = /^_x0000_[a-z](\d{1,10})$/i;
/**
 * The number Word names a VML shape by: the one in `o:spid`, or in `id` when the file writes no
 * `o:spid`, spelled `_x0000_s1025` floating and `_x0000_i1025` on the line. Null when the id
 * has no number, or for an element that draws no shape. @internal
 */
export function vmlShapeNumber(shape: OoxmlElement): number | null {
  if (shape.namespaceUri !== VML || !VML_SHAPE_ELEMENTS.has(shape.localName)) return null;
  const raw = attribute(shape, 'spid', OFFICE) ?? attribute(shape, 'id');
  const digits = raw?.trim().match(SHAPE_ID)?.[1];
  if (digits === undefined) return null;
  const value = Number(digits);
  return value <= 0xffffffff ? value : null;
}
/** Whether a VML boolean is false (`f`, `false`, `0`). @internal */
export const off = (value: string | undefined) => /^(f|false|0)$/i.test(value ?? '');
export const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
  );
/**
 * A VML fraction: `19661f` is 19661/65536, a plain number is the value itself. Undefined when
 * absent, NaN when malformed.
 */
export function vmlFraction(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // A 16.16 fixed-point value spans the signed 32-bit range, up to `2147483647f`.
  if (/^-?\d{8,10}f$/.test(trimmed)) {
    const fixed = Number(trimmed.slice(0, -1));
    return Math.abs(fixed) <= 2_147_483_647 ? fixed / 65536 : NaN;
  }
  if (!/^-?(?:\d{1,7}(?:\.\d{1,6})?|\.\d{1,6})f?$/.test(trimmed)) return NaN;
  return trimmed.endsWith('f') ? numeric(trimmed.slice(0, -1)) / 65536 : numeric(trimmed);
}
/** A plain decimal number, bounded; NaN when malformed. @internal */
export function numeric(value: string | undefined): number {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value ?? '')) return NaN;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 1_000_000 ? n : NaN;
}
/** A VML length in points (`pt`, `in`, `cm`, `mm`, `px`); NaN when malformed. @internal */
export function points(value: string | undefined): number {
  const match = value?.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(pt|in|cm|mm|px)?$/i);
  if (!match) return NaN;
  return (
    numeric(match[1]) *
    { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75 }[match[2]?.toLowerCase() ?? 'pt']!
  );
}
/**
 * A VML text distance in points. Writers spell a tiny negative distance with an exponent
 * (`-1e-4mm`); a negative distance leaves no gap, so it reads as 0. NaN when malformed.
 */
export function wrapDistancePoints(value: string): number {
  const match = value.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(?:e([+-]?\d{1,3}))?(pt|in|cm|mm|px)?$/i);
  if (!match) return NaN;
  const scaled = points(match[1]! + (match[3] ?? '')) * 10 ** Number(match[2] ?? 0);
  return Number.isFinite(scaled) ? Math.max(0, scaled) : NaN;
}
/**
 * VML rotation in degrees (`315`, `-45`, or `fd` sixty-five-thousandths). NaN when malformed.
 *
 * @internal
 */
export function legacyRotationDegrees(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const value = raw.trim();
  // `fd` is sixty-five-thousandths of a degree, so whole turns exceed the plain number bound.
  // A bare `f` suffix is read the same way.
  const fixed = /^(-?\d{1,10})fd?$/.exec(value);
  const degrees = fixed ? Number(fixed[1]) / 65536 : numeric(value);
  if (!Number.isFinite(degrees) || Math.abs(degrees) > 100_000) return NaN;
  return ((degrees % 360) + 360) % 360;
}

/** A `coordorigin`: an omitted y is 0, as in `coordorigin="5689"`. */
export function coordOrigin(value: string): [number, number] | null {
  const single = /^\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  return single ? [Number(single[1]), 0] : pair(value);
}

export function pair(value: string): [number, number] | null {
  const values = value
    .trim()
    .split(/[,\s]+/)
    .map(numeric);
  return values.length === 2 && values.every(Number.isFinite) ? (values as [number, number]) : null;
}
/** The declarations of a `style` attribute by lower-case name; null when malformed. @internal */
export function styleOf(node: OoxmlElement): ReadonlyMap<string, string> | null {
  const styles = new Map<string, string>();
  for (const part of (attribute(node, 'style') ?? '').split(';')) {
    if (!part.trim()) continue;
    const i = part.indexOf(':');
    if (i < 1 || styles.size >= 48) return null;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (styles.has(key) && styles.get(key) !== value) return null;
    styles.set(key, value);
  }
  return styles;
}
/** A VML colour as `#rrggbb`, `fallback` when absent; null when malformed. @internal */
export function color(value: string | undefined, fallback: string): string | null {
  const input = value ?? fallback;
  // Anchor the color token so malformed suffixes cannot rescan each whitespace position.
  const indexed = input.match(/^(\S+)\s+\[\d+\]$/);
  const raw = (indexed?.[1] ?? input).toLowerCase();
  if (/^#[\da-f]{6}$/.test(raw)) return raw;
  // The three-digit form doubles each digit, as in CSS.
  if (/^#[\da-f]{3}$/.test(raw)) return '#' + Array.from(raw.slice(1), (d) => d + d).join('');
  return NAMED_COLORS.get(raw) ?? rgbColor(raw);
}

/** The CSS `rgb(r, g, b)` form, each channel 0 to 255; null otherwise. */
function rgbColor(raw: string): string | null {
  // Bounded digit runs and no nested repeats: no backtracking on a hostile value.
  const match =
    /^rgb\(\s{0,8}(\d{1,3})\s{0,8},\s{0,8}(\d{1,3})\s{0,8},\s{0,8}(\d{1,3})\s{0,8}\)$/.exec(raw);
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return '#' + channels.map((channel) => channel.toString(16).padStart(2, '0')).join('');
}

/** The sixteen basic color names a VML color attribute can spell. */
const NAMED_COLORS: ReadonlyMap<string, string> = new Map([
  ['black', '#000000'],
  ['silver', '#c0c0c0'],
  ['gray', '#808080'],
  ['white', '#ffffff'],
  ['maroon', '#800000'],
  ['red', '#ff0000'],
  ['purple', '#800080'],
  ['fuchsia', '#ff00ff'],
  ['green', '#008000'],
  ['lime', '#00ff00'],
  ['olive', '#808000'],
  ['yellow', '#ffff00'],
  ['navy', '#000080'],
  ['blue', '#0000ff'],
  ['teal', '#008080'],
  ['aqua', '#00ffff'],
]);

/**
 * Bound the complete input before doing any splitting, recursion or SVG allocation.
 *
 * `stories` are the text-box story roots inside the shape, a group member's included. They are
 * ordinary WML content that story layout bounds by its own limits, so this graphic budget
 * counts only their elements.
 */
export function boundedVml(node: OoxmlNode, stories?: ReadonlySet<OoxmlNode>): boolean {
  const stack = [{ node, depth: 0 }];
  let visited = 0,
    characters = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++visited > 512 || current.depth > 16) return false;
    if (stories?.has(current.node)) continue;
    if (!element(current.node)) {
      if (current.node.value.trim()) return false;
      characters += current.node.value.length;
    } else {
      if (
        visited + stack.length + current.node.children.length > 512 ||
        current.node.attributes.length > 48
      )
        return false;
      for (const attr of current.node.attributes) {
        // A packed copy of the drawing (`o:gfxdata`) is opaque and never read here or
        // anywhere else, so it spends no part of the budget.
        if (attr.localName === 'gfxdata' && attr.namespaceUri === OFFICE) continue;
        // Equation Editor stores opaque source metadata beside its preview.
        // Never parse or emit that metadata into SVG. It still counts against
        // the complete 64 KiB input budget below.
        const equationMetadata =
          named(current.node, VML, 'shape') &&
          attr.localName === 'equationxml' &&
          (!attr.namespaceUri || attr.namespaceUri === OFFICE);
        if (attr.value.length > (equationMetadata ? 65_536 : 8192)) return false;
        characters += attr.value.length;
      }
      for (const child of current.node.children)
        stack.push({ node: child, depth: current.depth + 1 });
    }
    if (characters > 65_536) return false;
  }
  return true;
}
