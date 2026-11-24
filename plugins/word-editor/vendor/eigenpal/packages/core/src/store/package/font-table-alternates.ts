import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { resolveRelationship } from './relationships.ts';
import { fontFamilyName, listedFontFamilyName } from './font-family-name.ts';
import { fontTableFamilyClass, type FontFamilyClass } from './font-family-class.ts';

const FONT_TABLE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
const MAX_FONT_TABLE_NAMES = 256;
/** `w:altName` is limited to 31 characters. A longer value is ignored, never truncated. */
const MAX_ALTERNATE_NAME_LENGTH = 31;

function wordElement(node: OoxmlNode, name: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' && node.localName === name && node.namespaceUri === WML_NAMESPACE_URI
  );
}

function wordAttribute(node: OoxmlElement, name: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.localName === name && attribute.namespaceUri === WML_NAMESPACE_URI
  )?.value;
}

/** The font table's root element, when the package has one. */
function fontTableRoot(pkg: OoxmlPackage): OoxmlElement | undefined {
  const relationship = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
    (record) => record.type === FONT_TABLE_REL
  );
  const resolved = relationship ? resolveRelationship(relationship) : undefined;
  const part =
    resolved?.mode === 'Internal' && resolved.target.ok
      ? pkg.parts.get(resolved.target.partName)
      : undefined;
  const root = (part ?? pkg.parts.get('/word/fontTable.xml'))?.root;
  return root && wordElement(root, 'fonts') ? root : undefined;
}

/** The value of `w:<name> w:val` inside a `w:font` entry. */
function entryValue(font: OoxmlElement, name: string): string | undefined {
  const node = font.children.find((child) => wordElement(child, name));
  return node && node.kind !== 'textValue' ? wordAttribute(node, 'val') : undefined;
}

/**
 * The class each font table entry records (`w:family`, `w:pitch`), keyed by lower-cased family.
 * Entries that record none are absent.
 */
export function fontTableClasses(pkg: OoxmlPackage): ReadonlyMap<string, FontFamilyClass> {
  const root = fontTableRoot(pkg);
  const classes = new Map<string, FontFamilyClass>();
  if (!root) return classes;
  let inspected = 0;
  for (const font of root.children) {
    if (!wordElement(font, 'font')) continue;
    if (++inspected > MAX_FONT_TABLE_NAMES) break;
    const family = listedFontFamilyName(wordAttribute(font, 'name'));
    if (!family) continue;
    const kind = fontTableFamilyClass(entryValue(font, 'family'), entryValue(font, 'pitch'));
    const key = family.trim().toLowerCase();
    if (kind && !classes.has(key)) classes.set(key, kind);
  }
  return classes;
}

/** `w:charset` values of the Korean character sets: Hangul (0x81) and Johab (0x82). */
const KOREAN_CHARSETS: ReadonlySet<string> = new Set(['81', '82']);

const serifHangulFaceLookups = new WeakMap<OoxmlElement, (family: string) => boolean>();
const NO_SERIF_HANGUL_FACES = (): boolean => false;

/**
 * Whether the font table records a family as a serif face (`w:family` roman) of a Korean
 * character set (`w:charset`). One lookup per font table, so a lookup's identity changes
 * only with the table.
 */
export function fontTableSerifHangulFace(pkg: OoxmlPackage): (family: string) => boolean {
  const root = fontTableRoot(pkg);
  if (!root) return NO_SERIF_HANGUL_FACES;
  const known = serifHangulFaceLookups.get(root);
  if (known) return known;
  const faces = new Set<string>();
  let inspected = 0;
  for (const font of root.children) {
    if (!wordElement(font, 'font')) continue;
    if (++inspected > MAX_FONT_TABLE_NAMES) break;
    const family = listedFontFamilyName(wordAttribute(font, 'name'));
    const charset = entryValue(font, 'charset')?.toLowerCase();
    if (!family || !charset || !KOREAN_CHARSETS.has(charset)) continue;
    if (fontTableFamilyClass(entryValue(font, 'family'), entryValue(font, 'pitch')) !== 'serif')
      continue;
    faces.add(family.trim().toLowerCase());
  }
  const lookup =
    faces.size === 0
      ? NO_SERIF_HANGUL_FACES
      : (family: string) => faces.has(family.trim().toLowerCase());
  serifHangulFaceLookups.set(root, lookup);
  return lookup;
}

/** Read whole alternate names without changing the canonical font table. */
export function fontTableAlternates(pkg: OoxmlPackage): ReadonlyMap<string, string> {
  const root = fontTableRoot(pkg);
  const alternatives = new Map<string, string>();
  if (!root) return alternatives;
  let inspected = 0;
  for (const font of root.children) {
    if (!wordElement(font, 'font')) continue;
    if (++inspected > MAX_FONT_TABLE_NAMES) break;
    const family = listedFontFamilyName(wordAttribute(font, 'name'));
    if (!family) continue;
    const alternateNode = font.children.find((node) => wordElement(node, 'altName'));
    const rawAlternate =
      alternateNode && alternateNode.kind !== 'textValue'
        ? wordAttribute(alternateNode, 'val')
        : undefined;
    const alternate =
      rawAlternate !== undefined && rawAlternate.length <= MAX_ALTERNATE_NAME_LENGTH
        ? fontFamilyName(rawAlternate)
        : null;
    const key = family.trim().toLowerCase();
    if (alternate && !alternatives.has(key)) alternatives.set(key, alternate);
  }
  return alternatives;
}
