// Whether a tracked property change changes anything once the style hierarchy is applied.
//
// A `w:pPrChange` or `w:rPrChange` records the properties a paragraph or run had before an
// edit. When the earlier and the current properties resolve to the same formatting through the
// document defaults, the style chain and the numbering level, there is nothing to review: the
// file holds the record, but neither Accept nor Reject would change the document.
//
// The answer is CONSERVATIVE. Any input this module cannot compare with certainty reads as a
// real change: different style or numbering references, structured children such as tab stops
// or borders that differ, indents in character units, content in a table (its table style is
// not resolved here), or a numbering reference whose level cannot be resolved. A real change
// must never be hidden.

import { canonicalOoxmlFingerprint } from '../store/package/ooxml-serialize.ts';
import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { readNumPr, withNumberingStyleLinks } from './list-resolve.ts';
import { propertiesOf } from './paragraph-flow.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphWithNumbering,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { STYLE_TOGGLE_PROPERTIES } from './style-toggles.ts';
import { findParagraphProperties, findRunProperties } from './style-definition-reader.ts';
import {
  buildNumberingIndex,
  resolveNumberingLevel,
  type NumberingIndex,
} from './numbering-index.ts';
import { numberingParagraphProperties } from './numbering-paragraph-properties.ts';

/** The styles and numbering a document's property changes resolve against. */
export interface PropertyChangeContext {
  readonly table: StyleCascadeTable;
  readonly numbering: NumberingIndex;
}

const contexts = new WeakMap<object, WeakMap<object, PropertyChangeContext>>();
const NO_ROOT = {};

/** One context per pair of styles and numbering roots. */
export function propertyChangeContext(
  stylesRoot: OoxmlElement | null,
  numberingRoot: OoxmlElement | null
): PropertyChangeContext {
  const byStyles = contexts.get(stylesRoot ?? NO_ROOT) ?? new WeakMap();
  contexts.set(stylesRoot ?? NO_ROOT, byStyles);
  let context = byStyles.get(numberingRoot ?? NO_ROOT);
  if (!context) {
    const table = buildStyleCascadeTable(stylesRoot);
    context = {
      table,
      numbering: withNumberingStyleLinks(buildNumberingIndex(numberingRoot), table),
    };
    byStyles.set(numberingRoot ?? NO_ROOT, context);
  }
  return context;
}

/** Children that are not the properties being compared. */
const PARAGRAPH_SKIPPED = new Set(['pPrChange', 'rPr', 'sectPr']);
const RUN_SKIPPED = new Set(['rPrChange', 'ins', 'del', 'moveFrom', 'moveTo']);

/** Properties whose attributes inherit one by one; every other element replaces as a whole. */
const ATTRIBUTE_MERGED = new Set(['ind', 'spacing', 'rFonts', 'lang']);

/**
 * Attributes that name one value together: stating either replaces both. `w:firstLine` and
 * `w:hanging` are one first-line offset (§17.3.1.12), and each `w:rFonts` slot has a font and a
 * theme spelling.
 */
const SHARED_SLOTS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  ind: [['firstLine', 'hanging']],
  rFonts: [
    ['ascii', 'asciiTheme'],
    ['hAnsi', 'hAnsiTheme'],
    ['eastAsia', 'eastAsiaTheme'],
    ['cs', 'cstheme'],
  ],
};

/** Second spellings of one attribute, read as the first (§17.3.1.12). */
const ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ind: { start: 'left', end: 'right' },
};

/** Attributes this module cannot compare: indents in character units. */
const UNCOMPARED: Readonly<Record<string, ReadonlySet<string>>> = {
  ind: new Set([
    'startChars',
    'endChars',
    'leftChars',
    'rightChars',
    'firstLineChars',
    'hangingChars',
  ]),
};

/**
 * `CT_OnOff` properties that are off when absent, so a false value is the same as no value.
 * Properties that are on when absent, such as `w:snapToGrid` and `w:widowControl`, are not here:
 * their false value is a real change.
 */
const ON_OFF = new Set<string>([
  'dstrike',
  'noProof',
  'webHidden',
  'specVanish',
  'rtl',
  'cs',
  'oMath',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'suppressLineNumbers',
  'suppressAutoHyphens',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'bidi',
]);
for (const toggle of STYLE_TOGGLE_PROPERTIES) ON_OFF.add(toggle);
const FALSE_VALUES = new Set(['0', 'false', 'off']);

/** Values that mean the same as the property being absent once nothing above sets it. */
function isDefault(localName: string, attribute: string, value: string, bidi: boolean): boolean {
  if (ON_OFF.has(localName)) return attribute === 'val' && FALSE_VALUES.has(value);
  switch (localName) {
    case 'jc':
      return value === 'start' || (!bidi && value === 'left');
    case 'ind':
      return value === '0';
    case 'u':
    case 'highlight':
      return value === 'none';
    case 'vertAlign':
      return value === 'baseline';
    case 'color':
      return value === 'auto';
    case 'position':
      return value === '0';
    case 'w':
      return value === '100';
    default:
      return false;
  }
}

/** One property's attributes, with aliases folded and on/off values spelled out. */
function normalizedAttributes(property: OoxmlProperty): Record<string, string> | null {
  const aliases = ALIASES[property.localName];
  const uncompared = UNCOMPARED[property.localName];
  const attributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(property.attributes ?? {})) {
    if (uncompared?.has(name)) return null;
    const canonical = aliases?.[name] ?? name;
    // The first spelling wins when a property states both, as the layout reads it.
    if (canonical !== name && property.attributes?.[canonical] !== undefined) continue;
    attributes[canonical] = value;
  }
  if (ON_OFF.has(property.localName) && attributes.val === undefined) attributes.val = 'true';
  return attributes;
}

function merged(
  localName: string,
  previous: Record<string, string>,
  next: Record<string, string>
): Record<string, string> {
  const result = { ...previous };
  for (const slot of SHARED_SLOTS[localName] ?? []) {
    if (slot.some((name) => next[name] !== undefined)) for (const name of slot) delete result[name];
  }
  return Object.assign(result, next);
}

/** The resolved properties as a comparable string, later properties winning; null if unsure. */
function resolvedKey(
  properties: readonly OoxmlProperty[],
  skipped: ReadonlySet<string>
): string | null {
  const resolved = new Map<string, Record<string, string>>();
  for (const property of properties) {
    if (skipped.has(property.localName)) continue;
    const attributes = normalizedAttributes(property);
    if (!attributes) return null;
    const previous = resolved.get(property.localName);
    resolved.set(
      property.localName,
      previous && ATTRIBUTE_MERGED.has(property.localName)
        ? merged(property.localName, previous, attributes)
        : attributes
    );
  }
  const bidi = resolved.get('bidi');
  const isBidi = bidi !== undefined && !FALSE_VALUES.has(bidi.val ?? 'true');
  const entries: string[] = [];
  for (const [localName, attributes] of resolved) {
    const kept = Object.entries(attributes)
      .filter(([attribute, value]) => !isDefault(localName, attribute, value, isBidi))
      .sort(([a], [b]) => a.localeCompare(b));
    // An element with no attributes left said nothing beyond the default.
    if (kept.length === 0 && Object.keys(attributes).length > 0) continue;
    entries.push(`${localName}(${kept.map(([key, value]) => `${key}=${value}`).join(',')})`);
  }
  return entries.sort().join(' ');
}

/**
 * The children a flat property list cannot represent: elements with children of their own
 * (tab stops, borders, numbering references) and foreign elements. They must match exactly.
 */
function structuredChildren(properties: OoxmlElement | undefined, skipped: ReadonlySet<string>) {
  const out: string[] = [];
  for (const child of properties?.children ?? []) {
    if (child.kind === 'textValue') continue;
    const wml = child.namespaceUri === WML_NAMESPACE_URI;
    if (wml && skipped.has(child.localName)) continue;
    if (wml && !child.children.some((grandchild) => grandchild.kind !== 'textValue')) continue;
    out.push(canonicalOoxmlFingerprint(child));
  }
  return out.join('\u0000');
}

function styleReference(properties: readonly OoxmlProperty[], localName: string): string {
  let value = '';
  for (const property of properties) {
    if (property.localName === localName) value = property.attributes?.val ?? '';
  }
  return value;
}

/**
 * The numbering level's `w:pPr` for a paragraph, `null` when it has no numbering, or
 * `undefined` when it names numbering this context cannot resolve. The reference inherits
 * through the style chain as layout reads it.
 */
function numberingLevelProperties(
  context: PropertyChangeContext,
  paragraphProperties: OoxmlElement | undefined
): OoxmlElement | null | undefined {
  const nodes = cascadeParagraphWithNumbering(
    context.table,
    paragraphProperties
  ).paragraphPropertyNodes;
  const reference = readNumPr(nodes);
  if (!reference || reference.numId === '0') return null;
  const level = resolveNumberingLevel(context.numbering, reference.numId, reference.ilvl);
  return (level && numberingParagraphProperties(level.level)) ?? undefined;
}

function resolveParagraph(
  context: PropertyChangeContext,
  properties: OoxmlElement | undefined
): string | null {
  const level = numberingLevelProperties(context, properties);
  if (level === undefined) return null;
  const cascaded = cascadeParagraphWithNumbering(
    context.table,
    properties,
    undefined,
    level ?? undefined
  );
  return resolvedKey(cascaded.paragraphProperties, PARAGRAPH_SKIPPED);
}

/**
 * Whether a `w:pPrChange` leaves its paragraph formatted exactly as before.
 *
 * `current` is the paragraph's `w:pPr`, which holds `change`.
 */
export function paragraphChangeIsInert(
  context: PropertyChangeContext,
  change: OoxmlElement,
  current: OoxmlElement
): boolean {
  const previous = findParagraphProperties(change);
  if (
    styleReference(propertiesOf(current), 'pStyle') !==
    styleReference(propertiesOf(previous), 'pStyle')
  ) {
    return false;
  }
  if (
    structuredChildren(current, PARAGRAPH_SKIPPED) !==
    structuredChildren(previous, PARAGRAPH_SKIPPED)
  ) {
    return false;
  }
  const after = resolveParagraph(context, current);
  return after !== null && after === resolveParagraph(context, previous);
}

/**
 * Whether a `w:rPrChange` leaves its run formatted exactly as before.
 *
 * `current` is the run's `w:rPr`, which holds `change`; `paragraph` is the containing
 * paragraph's `w:pPr`, whose style the run inherits from.
 */
export function runChangeIsInert(
  context: PropertyChangeContext,
  change: OoxmlElement,
  current: OoxmlElement,
  paragraph: OoxmlElement | undefined
): boolean {
  const previous = findRunProperties(change);
  const currentProps = propertiesOf(current);
  const previousProps = propertiesOf(previous);
  if (styleReference(currentProps, 'rStyle') !== styleReference(previousProps, 'rStyle')) {
    return false;
  }
  if (structuredChildren(current, RUN_SKIPPED) !== structuredChildren(previous, RUN_SKIPPED)) {
    return false;
  }
  const level = numberingLevelProperties(context, paragraph);
  if (level === undefined) return false;
  const inherited = cascadeParagraphWithNumbering(
    context.table,
    paragraph,
    undefined,
    level ?? undefined
  ).runProperties;
  const resolve = (direct: readonly OoxmlProperty[]) =>
    resolvedKey(cascadeRunProperties(inherited, direct, context.table), RUN_SKIPPED);
  const after = resolve(currentProps);
  return after !== null && after === resolve(previousProps);
}
