// Read only the run properties whose typography the equation lane represents.
// Unknown properties retain the bounded fallback rather than being discarded.
import { classifyFontSlot, type FontSlot } from './font-slot-classes.ts';
import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from './ooxml-shared.ts';
import {
  EQUATION_DEFAULT_MATH_FONT,
  equationControlPropertiesAreDefault,
  equationDefaultRunSizePt,
  equationLanguagePropertyIsSupported,
  equationRunPropertiesAreDefault,
} from './omml-control-defaults.ts';
import type { OoxmlElement, OoxmlGenericElementNode, OoxmlNode } from './ooxml-tree.ts';

const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

export interface EquationRunFormat {
  readonly fontFamily?: string;
  readonly fontSizePt?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly literal?: boolean;
  readonly normalText?: boolean;
  readonly mathStyle?: 'p' | 'b' | 'i' | 'bi';
  /**
   * `w:kern` (17.3.2.19): the smallest font size, in points, that takes pair kerning. Zero
   * turns kerning off.
   */
  readonly kerningMinPt?: number;
}

/**
 * The kerning threshold a math run's format states, in points (`w:kern`, 17.3.2.19). The
 * projected expression type does not name it, so layout reads it through this helper.
 */
export function equationFormatKerningMinPt(format: object | undefined): number | undefined {
  const value = format ? (format as EquationRunFormat).kerningMinPt : undefined;
  return typeof value === 'number' ? value : undefined;
}

function element(node: OoxmlNode, namespace: string, localName: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === namespace && node.localName === localName
  );
}

function toggle(node: OoxmlElement, namespace: string): boolean | null {
  if (node.children.length !== 0 || node.attributes.length > 1) return null;
  const attribute = node.attributes[0];
  if (!attribute) return true;
  if (attribute.namespaceUri !== namespace || attribute.localName !== 'val') return null;
  if (['1', 'true', 'on'].includes(attribute.value)) return true;
  if (['0', 'false', 'off'].includes(attribute.value)) return false;
  return null;
}

type MutableRunFormat = { -readonly [K in keyof EquationRunFormat]: EquationRunFormat[K] };

const FONT_SLOTS: readonly FontSlot[] = ['ascii', 'hAnsi', 'eastAsia', 'cs'];

/**
 * The `w:rFonts` slots that the characters of `text` draw through, with the slot policy that
 * text layout uses (`classifyFontSlot`). Common characters, such as spaces, punctuation, and
 * operators, take a neighbour's slot, so they add no slot beside strong text. Text of only
 * common characters takes `w:ascii` when it is ASCII and `w:hAnsi` otherwise.
 */
function textFontSlots(text: string): ReadonlySet<FontSlot> {
  const slots = new Set<FontSlot>();
  let ascii = true;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    ascii &&= codePoint < 0x80;
    const classified = classifyFontSlot(codePoint);
    // A script outside the slot policy, such as Armenian, draws in the w:hAnsi face.
    if (classified === undefined) slots.add('hAnsi');
    else if (classified) slots.add(classified.slot);
  }
  if (slots.size === 0 && text.length > 0) slots.add(ascii ? 'ascii' : 'hAnsi');
  return slots;
}

/**
 * The one face that a run's `w:rFonts` gives its text. Undefined means no named face, and
 * null means the text needs two faces.
 *
 * Each character takes the face of its own slot: for example `w:ascii` for ASCII letters and
 * digits, `w:eastAsia` for East Asian scripts, `w:cs` for complex scripts such as Hebrew,
 * Arabic, and Thai, and `w:hAnsi` for other Latin, Greek, and Cyrillic text. So Latin text
 * keeps its Latin face beside a different East Asian or complex-script face. A slot that
 * names no face does not choose the run face, so `w:cs` alone gives ASCII digits no face.
 */
function runFace(fonts: ReadonlyMap<FontSlot, string>, text: string): string | undefined | null {
  let face: string | undefined;
  for (const slot of textFontSlots(text)) {
    const family = fonts.get(slot);
    if (family === undefined) continue;
    if (face !== undefined && face !== family) return null;
    face = family;
  }
  return face;
}

/**
 * Whether run properties name formatting for complex-script characters only: `w:bCs`, or a
 * `w:szCs` that differs from `w:sz` (ISO/IEC 29500-1 17.3.2.2, 17.3.2.39). The lane does not
 * draw it, so it is supported only where no complex-script character can take it: run text
 * without one, and control properties, whose control characters are math operators. (`w:iCs`
 * is part of the default math formatting, which the default reader accepts.)
 */
interface ComplexScriptFormatting {
  named: boolean;
}

/**
 * Read one `w:rPr` or `m:rPr` into `format`. False means an unsupported property. The named
 * `w:rFonts` slots go into `fonts`; the caller resolves them against the run text.
 *
 * Complex-script-only formatting is recorded in `complexScript` for the caller to check
 * against the run text. `w:sz` gives the size either way.
 */
function readRunProperties(
  child: OoxmlElement,
  word: boolean,
  format: MutableRunFormat,
  fonts: Map<FontSlot, string> = new Map(),
  complexScript: ComplexScriptFormatting = { named: false }
): boolean {
  if (child.attributes.length !== 0) return false;
  const namespace = word ? WML_NAMESPACE_URI : MATH;
  const properties = new Set<string>();
  let size: number | undefined;
  for (const property of child.children) {
    if (
      property.kind === 'textValue' ||
      property.namespaceUri !== namespace ||
      properties.has(property.localName)
    )
      return false;
    properties.add(property.localName);
    if (word && property.localName === 'rFonts') {
      if (property.children.length !== 0) return false;
      for (const attr of property.attributes) {
        const slot = FONT_SLOTS.find((name) => name === attr.localName);
        if (
          attr.namespaceUri !== namespace ||
          slot === undefined ||
          fonts.has(slot) ||
          attr.value.length === 0 ||
          attr.value.trim() !== attr.value
        )
          return false;
        fonts.set(slot, attr.value);
      }
    } else if (word && (property.localName === 'sz' || property.localName === 'szCs')) {
      const attribute = property.attributes[0];
      if (
        property.children.length !== 0 ||
        property.attributes.length !== 1 ||
        attribute?.namespaceUri !== namespace ||
        attribute.localName !== 'val' ||
        !/^[1-9][0-9]{0,3}$/.test(attribute.value)
      )
        return false;
      const points = Number(attribute.value) / 2;
      if (size !== undefined && size !== points) complexScript.named = true;
      size = points;
      if (property.localName === 'sz') format.fontSizePt = points;
    } else if (word && property.localName === 'bCs') {
      if (toggle(property, namespace) === null) return false;
      complexScript.named = true;
    } else if (word && property.localName === 'kern') {
      const attribute = property.attributes[0];
      if (
        property.children.length !== 0 ||
        property.attributes.length !== 1 ||
        attribute?.namespaceUri !== namespace ||
        attribute.localName !== 'val' ||
        !/^(?:0|[1-9][0-9]{0,3})$/.test(attribute.value)
      )
        return false;
      format.kerningMinPt = Number(attribute.value) / 2;
    } else if (word && property.localName === 'lang') {
      // Language takes no part in equation layout. The source keeps it on save.
      if (!equationLanguagePropertyIsSupported(property)) return false;
    } else if (!word && property.localName === 'sty') {
      if (property.children.length !== 0 || property.attributes.length > 1) return false;
      const attribute = property.attributes[0];
      if (attribute && (attribute.namespaceUri !== namespace || attribute.localName !== 'val'))
        return false;
      const value = attribute?.value ?? 'i';
      if (value !== 'p' && value !== 'b' && value !== 'i' && value !== 'bi') return false;
      format.mathStyle = value;
    } else {
      const key = word
        ? property.localName === 'b'
          ? 'bold'
          : property.localName === 'i'
            ? 'italic'
            : undefined
        : property.localName === 'lit'
          ? 'literal'
          : property.localName === 'nor'
            ? 'normalText'
            : undefined;
      if (key === undefined) return false;
      const value = toggle(property, namespace);
      if (value === null) return false;
      format[key] = value;
    }
  }
  // An unrepresented complex-script-only size still needs the default-source marker.
  return !properties.has('szCs') || properties.has('sz');
}

// The face marks default properties as formatted source when runs differ. Keep the size
// separately when the default reader accepts properties outside the typography allowlist.
const DEFAULT_RUN_FORMAT: EquationRunFormat = Object.freeze({
  fontFamily: EQUATION_DEFAULT_MATH_FONT,
});

/**
 * Null means unsupported source. An empty format preserves existing math defaults. Default
 * run properties (see `equationRunPropertiesAreDefault`) are always supported.
 */
export function equationRunFormat(run: OoxmlElement): EquationRunFormat | null {
  const format = readRunFormat(run);
  if (format !== null || !equationRunPropertiesAreDefault(run)) return format;
  const properties = run.children.find((child) => element(child, WML_NAMESPACE_URI, 'rPr'));
  const fontSizePt =
    properties && properties.kind !== 'textValue'
      ? equationDefaultRunSizePt(properties)
      : undefined;
  return fontSizePt === undefined
    ? DEFAULT_RUN_FORMAT
    : Object.freeze({ ...DEFAULT_RUN_FORMAT, fontSizePt });
}

function readRunFormat(run: OoxmlElement): EquationRunFormat | null {
  if (run.attributes.length !== 0) return null;
  const format: MutableRunFormat = {};
  const fonts = new Map<FontSlot, string>();
  const complexScript: ComplexScriptFormatting = { named: false };
  const seen = new Set<string>();
  let text = '';
  for (const child of run.children) {
    if (child.kind === 'textValue') return null;
    if (element(child, MATH, 't')) {
      for (const value of child.children) if (value.kind === 'textValue') text += value.value;
      continue;
    }
    const word = element(child, WML_NAMESPACE_URI, 'rPr');
    if (!word && !element(child, MATH, 'rPr')) return null;
    const namespace = word ? WML_NAMESPACE_URI : MATH;
    if (seen.has(namespace)) return null;
    seen.add(namespace);
    if (!readRunProperties(child, word, format, fonts, complexScript)) return null;
  }
  if (complexScript.named && textFontSlots(text).has('cs')) return null;
  const face = runFace(fonts, text);
  if (face === null) return null;
  if (face !== undefined) format.fontFamily = face;
  // A format keeps compact replacement refused, so a language or complex-script formatting is
  // never written away. A run whose only other properties are default leaves the decision to
  // the default reader.
  if (Object.keys(format).length === 0 && (complexScript.named || runNamesLanguage(run)))
    return null;
  return Object.freeze(format);
}

function runNamesLanguage(run: OoxmlElement): boolean {
  return run.children.some(
    (child) =>
      child.kind !== 'textValue' &&
      element(child, WML_NAMESPACE_URI, 'rPr') &&
      child.children.some(
        (property) => property.kind !== 'textValue' && element(property, WML_NAMESPACE_URI, 'lang')
      )
  );
}

const TRACKED_CONTROL_ATTRIBUTES: ReadonlySet<string> = new Set(['id', 'author', 'date']);

/**
 * The font size, in points, of one supported `m:ctrlPr`: the `w:sz` of its `w:rPr`, directly
 * or inside a tracked `w:ins` or `w:del`. Undefined when the control names no valid size.
 */
export function equationControlFontSizePt(control: OoxmlElement): number | undefined {
  let properties = control.children[0];
  if (
    properties &&
    properties.kind !== 'textValue' &&
    (element(properties, WML_NAMESPACE_URI, 'ins') || element(properties, WML_NAMESPACE_URI, 'del'))
  ) {
    properties = properties.children[0];
  }
  if (!properties || properties.kind === 'textValue') return undefined;
  if (!element(properties, WML_NAMESPACE_URI, 'rPr')) return undefined;
  for (const property of properties.children) {
    if (property.kind === 'textValue' || !element(property, WML_NAMESPACE_URI, 'sz')) continue;
    const value = property.attributes.find(
      (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
    )?.value;
    return value !== undefined && /^[1-9][0-9]{0,3}$/.test(value) ? Number(value) / 2 : undefined;
  }
  return undefined;
}

/**
 * True when an `m:ctrlPr` holds only source the equation lane can preserve: default control
 * properties, one `w:rPr` within the math run allowlist, or one tracked `w:ins`/`w:del` around
 * such a `w:rPr`. Complex-script-only formatting is allowed unless `characters`, the
 * structure's control characters, include a complex-script character: the lane does not draw
 * it, and no other control character can take it. Such properties are not default, so they
 * keep the source. Any other content keeps the bounded fallback.
 */
export function equationControlPropertiesAreSupported(
  node: OoxmlElement,
  characters = ''
): boolean {
  if (equationControlPropertiesAreDefault(node)) return true;
  if (node.attributes.length !== 0 || node.children.length > 1) return false;
  const child = node.children[0];
  if (!child) return true;
  if (child.kind === 'textValue') return false;
  if (element(child, WML_NAMESPACE_URI, 'rPr')) return controlRunProperties(child, characters);
  if (!element(child, WML_NAMESPACE_URI, 'ins') && !element(child, WML_NAMESPACE_URI, 'del'))
    return false;
  const names = new Set<string>();
  for (const attribute of child.attributes) {
    if (
      attribute.namespaceUri !== WML_NAMESPACE_URI ||
      !TRACKED_CONTROL_ATTRIBUTES.has(attribute.localName) ||
      names.has(attribute.localName)
    )
      return false;
    names.add(attribute.localName);
  }
  if (child.children.length > 1) return false;
  const properties = child.children[0];
  return (
    properties === undefined ||
    (properties.kind !== 'textValue' &&
      element(properties, WML_NAMESPACE_URI, 'rPr') &&
      controlRunProperties(properties, characters))
  );
}

/** One control `w:rPr` within the math run allowlist, checked against its control characters. */
function controlRunProperties(properties: OoxmlElement, characters: string): boolean {
  const complexScript: ComplexScriptFormatting = { named: false };
  if (!readRunProperties(properties, true, {}, new Map(), complexScript)) return false;
  return !complexScript.named || !textFontSlots(characters).has('cs');
}

function isMathElement(node: OoxmlNode, localName?: string): node is OoxmlGenericElementNode {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === MATH &&
    (localName === undefined || node.localName === localName)
  );
}

export function equationMathChild(
  node: OoxmlGenericElementNode,
  localName: string
): OoxmlGenericElementNode | null {
  for (const child of node.children) {
    if (isMathElement(child, localName)) return child;
  }
  return null;
}

export function equationMathChildren(
  node: OoxmlGenericElementNode,
  localName: string
): readonly OoxmlGenericElementNode[] {
  return node.children.filter((child): child is OoxmlGenericElementNode =>
    isMathElement(child, localName)
  );
}

export function equationTextIsSupported(node: OoxmlGenericElementNode): boolean {
  return (
    node.attributes.every(
      (attribute) =>
        attribute.namespaceUri === XML_NAMESPACE_URI &&
        attribute.localName === 'space' &&
        (attribute.value === 'preserve' || attribute.value === 'default')
    ) && node.children.every((child) => child.kind === 'textValue')
  );
}

export function equationRunIsSupported(node: OoxmlGenericElementNode): boolean {
  if (node.attributes.length > 0) return false;
  const texts = equationMathChildren(node, 't');
  if (texts.length === 0 || equationRunFormat(node) === null) return false;
  return texts.every(equationTextIsSupported);
}
