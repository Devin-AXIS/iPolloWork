import { registerGroupThemeEffects } from './drawing-group-theme-effects.ts';
import { resolveRelationship } from './relationships.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
} from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';

const THEME_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
const SETTINGS_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const HEX = /^[0-9A-Fa-f]{6}$/;
/** Entries a `fmtScheme` style list may hold; a reference past it resolves to nothing. */
const MAX_STYLE_MATRIX_ENTRIES = 16;
// Every key below is looked up with a value out of `theme*.xml` or `settings.xml`, which
// the sender controls. These are Maps, not object literals, so a `val` of `__proto__` or
// `constructor` answers undefined instead of reaching a prototype member — the same reason
// `SYSTEM_COLORS` used to need `hasOwnProperty`.
const SYSTEM_COLORS: ReadonlyMap<string, string> = new Map([
  ['window', 'FFFFFF'],
  ['windowText', '000000'],
]);
const DEFAULT_MAPPING: ReadonlyMap<string, string> = new Map([
  ['bg1', 'lt1'],
  ['tx1', 'dk1'],
  ['bg2', 'lt2'],
  ['tx2', 'dk2'],
  ['accent1', 'accent1'],
  ['accent2', 'accent2'],
  ['accent3', 'accent3'],
  ['accent4', 'accent4'],
  ['accent5', 'accent5'],
  ['accent6', 'accent6'],
  ['hlink', 'hlink'],
  ['folHlink', 'folHlink'],
]);
const MAPPING_ATTRIBUTE_TO_TOKEN: ReadonlyMap<string, string> = new Map([
  ['bg1', 'bg1'],
  ['t1', 'tx1'],
  ['bg2', 'bg2'],
  ['t2', 'tx2'],
  ['accent1', 'accent1'],
  ['accent2', 'accent2'],
  ['accent3', 'accent3'],
  ['accent4', 'accent4'],
  ['accent5', 'accent5'],
  ['accent6', 'accent6'],
  ['hyperlink', 'hlink'],
  ['followedHyperlink', 'folHlink'],
]);
const MAPPING_VALUE_TO_SLOT: ReadonlyMap<string, string> = new Map([
  ['dark1', 'dk1'],
  ['light1', 'lt1'],
  ['dark2', 'dk2'],
  ['light2', 'lt2'],
  ['accent1', 'accent1'],
  ['accent2', 'accent2'],
  ['accent3', 'accent3'],
  ['accent4', 'accent4'],
  ['accent5', 'accent5'],
  ['accent6', 'accent6'],
  ['hyperlink', 'hlink'],
  ['followedHyperlink', 'folHlink'],
]);

export type ShapeStyleMatrixKind = 'fill' | 'line';

export interface PackageShapeThemeResolvers {
  readonly resolveSchemeColor: (scheme: string) => string | null;
  readonly resolveStyleMatrixReference: (
    kind: ShapeStyleMatrixKind,
    index: number
  ) => OoxmlElement | null;
  readonly cacheToken: string;
}
const PACKAGE_THEME_CACHE = new WeakMap<OoxmlPackage, PackageShapeThemeResolvers>();
const THEME_ROOT_IDS = new WeakMap<OoxmlElement, number>();
let nextThemeRootId = 1;

const THEME_TOKENS = new WeakMap<(token: string) => string | null, string>();

/**
 * The theme and settings identity behind a scheme colour resolver. Resolvers are rebuilt for
 * every package revision; the token stays the same while the theme and settings parts do.
 *
 * @internal
 */
export function shapeThemeCacheToken(
  resolveSchemeColor: (token: string) => string | null
): string | undefined {
  return THEME_TOKENS.get(resolveSchemeColor);
}

function rootIdentity(root: OoxmlElement | null): number {
  if (!root) return 0;
  const existing = THEME_ROOT_IDS.get(root);
  if (existing !== undefined) return existing;
  const id = nextThemeRootId;
  nextThemeRootId += 1;
  THEME_ROOT_IDS.set(root, id);
  return id;
}

const element = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
const genericElement = (node: OoxmlNode): node is OoxmlGenericElementNode =>
  element(node) && 'namespaceUri' in node && 'localName' in node;

function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  return node.attributes.find(
    (entry) =>
      entry.localName === localName &&
      (entry.namespaceUri === namespaceUri || entry.namespaceUri === '')
  )?.value;
}

function firstDescendant(
  root: OoxmlElement,
  namespaceUri: string,
  localName: string
): OoxmlGenericElementNode | null {
  const stack: OoxmlElement[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < 4096) {
    const node = stack.pop()!;
    visited += 1;
    if (
      genericElement(node) &&
      node.namespaceUri === namespaceUri &&
      node.localName === localName
    ) {
      return node;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (element(child)) stack.push(child);
    }
  }
  return null;
}

function directGeneric(
  parent: OoxmlElement,
  namespaceUri: string,
  localName: string
): OoxmlGenericElementNode | null {
  for (const child of parent.children) {
    if (
      genericElement(child) &&
      child.namespaceUri === namespaceUri &&
      child.localName === localName
    ) {
      return child;
    }
  }
  return null;
}

function relatedRoot(
  pkg: OoxmlPackage,
  relationshipType: string,
  fallbackName: string
): OoxmlElement | null {
  const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
    (candidate) => candidate.type === relationshipType
  );
  if (record) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      const part = pkg.parts.get(resolved.target.partName);
      if (part) return part.root;
    }
  }
  return pkg.parts.get(fallbackName)?.root ?? null;
}

function colorHex(slot: OoxmlGenericElementNode): string | null {
  const color = slot.children.find(genericElement);
  if (!color || color.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return null;
  let value: string | undefined;
  if (color.localName === 'srgbClr') {
    value = attribute(color, DRAWINGML_MAIN_NAMESPACE_URI, 'val');
  } else if (color.localName === 'sysClr') {
    const system = attribute(color, DRAWINGML_MAIN_NAMESPACE_URI, 'val') ?? '';
    value = attribute(color, DRAWINGML_MAIN_NAMESPACE_URI, 'lastClr') ?? SYSTEM_COLORS.get(system);
  }
  return value && HEX.test(value) ? value.toUpperCase() : null;
}

/** Read validated base colours from one DrawingML theme colour scheme. */
export function collectThemeColorScheme(
  themeRoot: OoxmlElement | null
): ReadonlyMap<string, string> {
  const scheme = themeRoot
    ? firstDescendant(themeRoot, DRAWINGML_MAIN_NAMESPACE_URI, 'clrScheme')
    : null;
  const colors = new Map<string, string>();
  if (!scheme) return colors;
  for (const child of scheme.children) {
    if (!genericElement(child) || child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    const hex = colorHex(child);
    if (hex) colors.set(child.localName, hex);
  }
  return colors;
}

/** The package's theme part root, or null when it has none. */
export function packageThemeRoot(pkg: OoxmlPackage): OoxmlElement | null {
  return relatedRoot(pkg, THEME_RELATIONSHIP, '/word/theme/theme1.xml');
}

/** Resolve theme colours and style-matrix entries from one immutable package snapshot. */
export function createPackageShapeThemeResolvers(pkg: OoxmlPackage): PackageShapeThemeResolvers {
  const cached = PACKAGE_THEME_CACHE.get(pkg);
  if (cached) return cached;
  const theme = relatedRoot(pkg, THEME_RELATIONSHIP, '/word/theme/theme1.xml');
  const settings = relatedRoot(pkg, SETTINGS_RELATIONSHIP, '/word/settings.xml');
  const colors = collectThemeColorScheme(theme);
  const mapping = new Map<string, string>(DEFAULT_MAPPING);
  const mappingNode = settings
    ? firstDescendant(settings, WML_NAMESPACE_URI, 'clrSchemeMapping')
    : null;
  if (mappingNode) {
    for (const entry of mappingNode.attributes) {
      if (entry.namespaceUri !== WML_NAMESPACE_URI) continue;
      const token = MAPPING_ATTRIBUTE_TO_TOKEN.get(entry.localName);
      const slot = MAPPING_VALUE_TO_SLOT.get(entry.value);
      if (!token || !slot) continue;
      mapping.set(token, slot);
    }
  }
  const formatScheme = theme
    ? firstDescendant(theme, DRAWINGML_MAIN_NAMESPACE_URI, 'fmtScheme')
    : null;
  const styleList = (
    kind: ShapeStyleMatrixKind,
    index: number
  ): { readonly list: OoxmlElement; readonly offset: number } | null => {
    if (!formatScheme) return null;
    // ECMA-376 20.1.4.1.19/20.1.4.1.24: the index is 1-based into the matching style list,
    // and a fill index of 1001 or more selects the background list from 1001.
    const background = kind === 'fill' && index >= 1001;
    const list = directGeneric(
      formatScheme,
      DRAWINGML_MAIN_NAMESPACE_URI,
      kind === 'line' ? 'lnStyleLst' : background ? 'bgFillStyleLst' : 'fillStyleLst'
    );
    // One bound, for both lists and both bases. Only the ceiling has a test: the entry walk
    // below already answers null for any offset it cannot reach, so the floor and the
    // integer check are defence in depth against a future direct index, not behaviour a
    // caller can observe today. That is also why there is no second, narrower ceiling — it
    // would be a bound with nothing to hold it in step.
    const offset = background ? index - 1001 : index - 1;
    const usable =
      list !== null &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      offset < MAX_STYLE_MATRIX_ENTRIES;
    return usable ? { list: list!, offset } : null;
  };
  const result: PackageShapeThemeResolvers = Object.freeze({
    resolveSchemeColor: (token: string): string | null => {
      const mapped = mapping.get(token) ?? token;
      return colors.get(mapped) ?? null;
    },
    resolveStyleMatrixReference: (
      kind: ShapeStyleMatrixKind,
      index: number
    ): OoxmlElement | null => {
      const selected = styleList(kind, index);
      if (!selected) return null;
      let offset = 0;
      for (const child of selected.list.children) {
        if (!genericElement(child)) continue;
        if (offset === selected.offset) return child;
        offset += 1;
      }
      return null;
    },
    cacheToken: `${rootIdentity(theme)}|${rootIdentity(settings)}`,
  });
  THEME_TOKENS.set(result.resolveSchemeColor, result.cacheToken);
  registerGroupThemeEffects(result.resolveStyleMatrixReference, (index) => {
    if (
      !formatScheme ||
      !Number.isSafeInteger(index) ||
      index < 1 ||
      index > MAX_STYLE_MATRIX_ENTRIES
    )
      return null;
    const list = directGeneric(formatScheme, DRAWINGML_MAIN_NAMESPACE_URI, 'effectStyleLst');
    if (!list) return null;
    let at = 0;
    for (const child of list.children) {
      if (!genericElement(child)) continue;
      if (++at === index) return child;
    }
    return null;
  });
  PACKAGE_THEME_CACHE.set(pkg, result);
  return result;
}
