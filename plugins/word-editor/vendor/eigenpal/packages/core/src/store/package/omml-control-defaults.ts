// Default run formatting of Office Math: control properties (`m:ctrlPr`) and run properties
// (`w:rPr` on `m:r`).
//
// Most documents write the same `m:ctrlPr` on every structure and the same `w:rPr` on every
// run, holding only the default math run formatting. Compact replacement can reproduce that
// source by writing the same properties on each structure and run it emits. Any other
// formatting stays read-only.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlGenericElementNode, OoxmlNode } from './ooxml-tree.ts';

const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/** The math face the equation lane draws with. Control fonts must name it to be default. */
export const EQUATION_DEFAULT_MATH_FONT = 'Cambria Math';

const FONT_SLOTS: ReadonlySet<string> = new Set(['ascii', 'hAnsi', 'eastAsia', 'cs']);
const LANGUAGE_SLOTS: ReadonlySet<string> = new Set(['val', 'eastAsia', 'bidi']);
const ON_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'on']);
// A bounded language tag: no nested quantifiers, so no backtracking on file-derived text.
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;
const HALF_POINTS = /^[1-9][0-9]{0,3}$/;

function wordElement(node: OoxmlNode, localName?: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (localName === undefined || node.localName === localName)
  );
}

function wordAttributes(
  node: OoxmlElement,
  allowed: ReadonlySet<string>,
  accept: (value: string) => boolean
): boolean {
  const seen = new Set<string>();
  for (const attribute of node.attributes) {
    if (
      attribute.namespaceUri !== WML_NAMESPACE_URI ||
      !allowed.has(attribute.localName) ||
      seen.has(attribute.localName) ||
      !accept(attribute.value)
    )
      return false;
    seen.add(attribute.localName);
  }
  return true;
}

/**
 * True for one `w:lang` that names only bounded language tags in its `w:val`, `w:eastAsia`,
 * and `w:bidi` slots. Language does not change equation layout, and save keeps it verbatim.
 */
export function equationLanguagePropertyIsSupported(property: OoxmlElement): boolean {
  return (
    wordElement(property, 'lang') &&
    property.children.length === 0 &&
    wordAttributes(property, LANGUAGE_SLOTS, (value) => LANGUAGE_TAG.test(value))
  );
}

/**
 * Default run properties, reduced to an order-insensitive signature of their properties and
 * values. Two property sets with the same signature write the same formatting.
 */
type DefaultProperties = { readonly signature: string } | false;

function propertySignature(property: OoxmlElement): string {
  const attributes = property.attributes
    .map((attribute) => `${attribute.localName}=${attribute.value}`)
    .sort();
  return `${property.localName}(${attributes.join(',')})`;
}

/** Read one `w:rPr` under the default rule. */
function readDefaultProperties(properties: OoxmlElement): DefaultProperties {
  if (!wordElement(properties, 'rPr') || properties.attributes.length !== 0) return false;
  const seen = new Set<string>();
  const sizes: string[] = [];
  const signature: string[] = [];
  for (const property of properties.children) {
    if (!wordElement(property) || property.children.length !== 0) return false;
    if (seen.has(property.localName)) return false;
    seen.add(property.localName);
    switch (property.localName) {
      case 'rFonts':
        if (!wordAttributes(property, FONT_SLOTS, (value) => value === EQUATION_DEFAULT_MATH_FONT))
          return false;
        break;
      case 'i':
      case 'iCs':
        if (!wordAttributes(property, new Set(['val']), (value) => ON_VALUES.has(value)))
          return false;
        break;
      case 'sz':
      case 'szCs': {
        const value = property.attributes[0]?.value;
        if (
          property.attributes.length !== 1 ||
          !wordAttributes(property, new Set(['val']), (size) => HALF_POINTS.test(size))
        )
          return false;
        sizes.push(value!);
        break;
      }
      case 'lang':
        if (!wordAttributes(property, LANGUAGE_SLOTS, (value) => LANGUAGE_TAG.test(value)))
          return false;
        break;
      default:
        return false;
    }
    signature.push(propertySignature(property));
  }
  if (sizes.some((size) => size !== sizes[0])) return false;
  return { signature: signature.sort().join(';') };
}

function readDefaultControl(node: OoxmlElement): DefaultProperties {
  if (node.attributes.length !== 0 || node.children.length > 1) return false;
  const properties = node.children[0];
  if (!properties) return { signature: '' };
  return properties.kind === 'textValue' ? false : readDefaultProperties(properties);
}

/**
 * True when one `m:ctrlPr` holds only default math formatting, so compact replacement can
 * write it back unchanged. The rule is narrow:
 *
 * - The element is empty, or holds exactly one `w:rPr` (no tracked `w:ins`/`w:del` wrapper).
 * - `w:rPr` holds each of these at most once, and nothing else:
 *   - `w:rFonts` whose `w:ascii`, `w:hAnsi`, `w:eastAsia`, and `w:cs` are absent or name
 *     the math face ({@link EQUATION_DEFAULT_MATH_FONT});
 *   - `w:i` and `w:iCs`, on;
 *   - `w:sz` and `w:szCs`, one positive half-point value shared by both;
 *   - `w:lang` with bounded language tags.
 *
 * The equation-level check, {@link equationDefaultFormatting}, also requires every
 * `m:ctrlPr` of the equation to hold the same properties and values. Replacement writes one
 * copy on every structure, so differing controls (one sized and one not, or two languages)
 * would otherwise lose formatting.
 */
export function equationControlPropertiesAreDefault(node: OoxmlElement): boolean {
  return readDefaultControl(node) !== false;
}

const BARE = Object.freeze({ kind: 'bare' as const });

type DefaultRun =
  /** The run has no `w:rPr`. */
  | { readonly kind: 'bare' }
  | { readonly kind: 'default'; readonly properties: OoxmlElement; readonly signature: string }
  | false;

/**
 * Read one `m:r` under the default rule: no attributes, no `m:rPr`, at most one `w:rPr`
 * before its `m:t` children, and nothing else. Any `m:rPr` (`m:sty`, `m:nor`, `m:lit`, and
 * the rest) changes how layout draws the run, so it is never default.
 */
function readDefaultRun(run: OoxmlElement): DefaultRun {
  if (run.attributes.length !== 0) return false;
  let properties: OoxmlElement | null = null;
  let texts = 0;
  for (const child of run.children) {
    if (child.kind === 'textValue') return false;
    if (child.namespaceUri === MATH && child.localName === 't') {
      texts += 1;
    } else if (wordElement(child, 'rPr') && properties === null && texts === 0) {
      properties = child;
    } else {
      return false;
    }
  }
  if (!properties) return BARE;
  const read = readDefaultProperties(properties);
  return read === false ? false : { kind: 'default', properties, signature: read.signature };
}

/**
 * True when one `m:r` carries `w:rPr` that holds only default math formatting, under the
 * same rule as {@link equationControlPropertiesAreDefault}, and carries no `m:rPr`.
 *
 * Layout draws such a run with the glyphs of the same run without `w:rPr`. A run without
 * `m:rPr` takes the default italic math style: letters become mathematical italic glyphs in
 * the math face, and digits and operators stay upright. `w:i` and the font slots do not
 * change those glyphs. When every run shares one `w:sz`, the equation takes that size; see
 * {@link equationDefaultRunSizePt}.
 */
export function equationRunPropertiesAreDefault(run: OoxmlElement): boolean {
  const read = readDefaultRun(run);
  return read !== false && read.kind === 'default';
}

/**
 * The font size, in points, of default run properties (`w:sz`), or undefined without one.
 * The default rule already bounds the value to a positive half-point count that `w:szCs`
 * shares.
 */
export function equationDefaultRunSizePt(properties: OoxmlElement): number | undefined {
  const size = properties.children.find((child) => wordElement(child, 'sz'));
  const value = size && size.kind !== 'textValue' ? size.attributes[0]?.value : undefined;
  return value && HALF_POINTS.test(value) ? Number(value) / 2 : undefined;
}

/**
 * The font size, in points, that every `m:r` of one equation shares through default run
 * properties, or undefined. Control properties do not take part: a formatted `m:ctrlPr`
 * changes operator glyphs, not the size of the runs. The scan honors the same limits as
 * {@link equationDefaultFormatting}.
 */
export function equationSharedRunSizePt(
  equation: OoxmlNode,
  maxNodes: number,
  maxDepth: number
): number | undefined {
  let size: number | undefined;
  let visited = 0;
  const stack: { node: OoxmlNode; depth: number }[] = [{ node: equation, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    visited += 1;
    if (visited > maxNodes || depth > maxDepth) return undefined;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === MATH && node.localName === 'r') {
      const read = readDefaultRun(node);
      if (read === false || read.kind === 'bare') return undefined;
      const runSize = equationDefaultRunSizePt(read.properties);
      if (runSize === undefined || (size !== undefined && size !== runSize)) return undefined;
      size = runSize;
      continue;
    }
    if (visited + stack.length + node.children.length > maxNodes) return undefined;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index]!, depth: depth + 1 });
    }
  }
  return size;
}

/** How compact replacement treats the control properties of one equation. */
export type EquationControlDefaults =
  /** No structure carries `m:ctrlPr`. Replacement writes none. */
  | { readonly kind: 'none' }
  /** Every `m:ctrlPr` is default. Replacement writes `control` on each emitted structure. */
  | { readonly kind: 'default'; readonly control: OoxmlGenericElementNode }
  /** Some `m:ctrlPr` is not default, or the scan passed its work limit. */
  | { readonly kind: 'other' };

/** How compact replacement treats the run properties of one equation. */
export type EquationRunDefaults =
  /** No run carries `w:rPr`. Replacement writes none. */
  | { readonly kind: 'none' }
  /**
   * Every run carries default `w:rPr` with the same properties and values, and no control
   * is `other`.
   * Replacement writes `properties` on each emitted run.
   */
  | { readonly kind: 'default'; readonly properties: OoxmlElement }
  /** Runs differ, some run is not default, some control is not default, or the scan stopped. */
  | { readonly kind: 'other' };

/** The default formatting of one equation, for its controls and for its runs. */
export interface EquationFormattingDefaults {
  readonly controls: EquationControlDefaults;
  readonly runs: EquationRunDefaults;
}

const NONE = Object.freeze({ kind: 'none' as const });
const OTHER = Object.freeze({ kind: 'other' as const });
const ALL_OTHER: EquationFormattingDefaults = Object.freeze({ controls: OTHER, runs: OTHER });

/**
 * Classify the `m:ctrlPr` and `m:r` elements of one `m:oMath`. The first default element of
 * each kind in document order is the canonical copy. The scan visits at most `maxNodes` nodes
 * to `maxDepth` levels, the equation reader's own limits, and reports `other` past them.
 *
 * Every default element of one kind must hold the same properties and values as the first,
 * in any order, because replacement writes one copy of the first on every structure or run.
 * A sized element beside an unsized one, or two languages, is `other`. So is a run without
 * `w:rPr` beside a run with default `w:rPr`.
 */
export function equationDefaultFormatting(
  equation: OoxmlNode,
  maxNodes: number,
  maxDepth: number
): EquationFormattingDefaults {
  let visited = 0;
  let control: OoxmlGenericElementNode | null = null;
  let controlSignature: string | null = null;
  let properties: OoxmlElement | null = null;
  let runSignature: string | null = null;
  let bareRuns = false;
  let otherRuns = false;
  const stack: { node: OoxmlNode; depth: number }[] = [{ node: equation, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    visited += 1;
    if (visited > maxNodes || depth > maxDepth) return ALL_OTHER;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === MATH && node.localName === 'ctrlPr') {
      const read = readDefaultControl(node);
      if (read === false || node.kind !== 'generic') return ALL_OTHER;
      if (controlSignature !== null && controlSignature !== read.signature) return ALL_OTHER;
      controlSignature = read.signature;
      control ??= node;
      continue;
    }
    if (node.namespaceUri === MATH && node.localName === 'r' && !otherRuns) {
      const read = readDefaultRun(node);
      if (read === false) otherRuns = true;
      else if (read.kind === 'bare') bareRuns = true;
      else if (properties === null) {
        properties = read.properties;
        runSignature = read.signature;
      } else if (runSignature !== read.signature) otherRuns = true;
    }
    if (visited + stack.length + node.children.length > maxNodes) return ALL_OTHER;
    // Push in reverse so the stack pops children in document order.
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index]!, depth: depth + 1 });
    }
  }
  const runs: EquationRunDefaults =
    otherRuns || (bareRuns && properties)
      ? OTHER
      : properties
        ? Object.freeze({ kind: 'default', properties })
        : NONE;
  return Object.freeze({
    controls: control ? Object.freeze({ kind: 'default', control }) : NONE,
    runs,
  });
}

/** Classify the `m:ctrlPr` elements of one `m:oMath`. See {@link equationDefaultFormatting}. */
export function equationDefaultControlProperties(
  equation: OoxmlNode,
  maxNodes: number,
  maxDepth: number
): EquationControlDefaults {
  return equationDefaultFormatting(equation, maxNodes, maxDepth).controls;
}

/** Copy a control or run property element with fresh part-scoped ids. Values stay verbatim. */
export function cloneEquationControl<T extends OoxmlElement>(node: T, nextId: () => string): T {
  const copy = (source: OoxmlNode): OoxmlNode =>
    source.kind === 'textValue'
      ? Object.freeze({ ...source, id: nextId() })
      : (Object.freeze({
          ...source,
          id: nextId(),
          children: Object.freeze(source.children.map(copy)),
        }) as OoxmlNode);
  return copy(node) as T;
}
