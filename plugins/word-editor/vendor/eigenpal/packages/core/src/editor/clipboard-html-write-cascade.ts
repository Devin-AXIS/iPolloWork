// The copy lane's small self-contained style cascade over the FRAGMENT's own styles
// part — split from clipboard-html-write.ts at the max-lines cap. Toggle properties
// resolve per ECMA-376 §17.7.3, matching layout/style-cascade.ts.

import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { relationshipsOf } from '../store/package/package-edit.ts';
import { resolveInternalTarget } from '../store/package/opc-names.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import {
  applicationDefaultsContainer,
  omittedHalves,
} from '../store/package/application-doc-defaults.ts';
import { MAX_STYLE_BASED_ON_DEPTH, MAX_STYLE_DEFINITIONS } from '../layout/style-cascade.ts';
import { isElement, wmlChild, wmlVal } from './clipboard-html-write-tree.ts';

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// The layout cascade's own depth cap, so copy output resolves the same chains the
// painter does.
const MAX_STYLE_CHAIN = MAX_STYLE_BASED_ON_DEPTH;

export interface StyleIndex {
  readonly byId: ReadonlyMap<string, OoxmlElement>;
  readonly docDefaultsRPr: OoxmlElement | null;
  readonly docDefaultsPPr: OoxmlElement | null;
  readonly defaultParagraphStyleId: string | null;
  readonly defaultCharacterStyleId: string | null;
  readonly defaultTableStyleId: string | null;
}

export function relatedPart(
  pkg: OoxmlPackage,
  relType: string,
  fallback: string
): OoxmlElement | null {
  for (const record of relationshipsOf(pkg, pkg.mainDocumentPart)) {
    if (record.type !== relType || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (resolved.ok) {
      const part = pkg.parts.get(resolved.partName);
      if (part && isElement(part.root)) return part.root;
    }
  }
  const part = pkg.parts.get(fallback);
  return part && isElement(part.root) ? part.root : null;
}

export function styleIndexOf(pkg: OoxmlPackage): StyleIndex {
  const root = relatedPart(pkg, STYLES_REL, '/word/styles.xml');
  const byId = new Map<string, OoxmlElement>();
  let docDefaultsRPr: OoxmlElement | null = null;
  let docDefaultsPPr: OoxmlElement | null = null;
  let defaultParagraphStyleId: string | null = null;
  let defaultCharacterStyleId: string | null = null;
  let defaultTableStyleId: string | null = null;
  if (!root) {
    return {
      byId,
      docDefaultsRPr,
      docDefaultsPPr,
      defaultParagraphStyleId,
      defaultCharacterStyleId,
      defaultTableStyleId,
    };
  }
  // The same MAX_STYLE_DEFINITIONS cap and last-duplicate-wins default rule as
  // layout's buildStyleCascadeTable: styles.xml is attacker-controlled, and the
  // copy lane must not scan more (or resolve a default the painter revoked).
  let counted = 0;
  let docDefaults: OoxmlElement | null = null;
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName === 'docDefaults') {
      docDefaults = child;
      docDefaultsRPr = wmlChild(wmlChild(child, 'rPrDefault'), 'rPr');
      docDefaultsPPr = wmlChild(wmlChild(child, 'pPrDefault'), 'pPr');
      continue;
    }
    if (child.localName !== 'style') continue;
    if (counted >= MAX_STYLE_DEFINITIONS) break;
    counted += 1;
    const id = attributeValueOf(child, 'styleId', WML_NAMESPACE_URI);
    if (!id) continue;
    byId.set(id, child);
    const isDefault = attributeValueOf(child, 'default', WML_NAMESPACE_URI);
    const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
    // Every legal ST_OnOff spelling — layout/style-cascade.ts's isDefaultFlag
    // documents the same 'on' trap. A later duplicate styleId WITHOUT the flag
    // revokes the default, so the last definition wins like the cascade table.
    if (isDefault === '1' || isDefault === 'true' || isDefault === 'on') {
      if (type === 'paragraph') defaultParagraphStyleId = id;
      else if (type === 'character') defaultCharacterStyleId = id;
      else if (type === 'table') defaultTableStyleId = id;
    } else {
      if (defaultParagraphStyleId === id) defaultParagraphStyleId = null;
      if (defaultCharacterStyleId === id) defaultCharacterStyleId = null;
      if (defaultTableStyleId === id) defaultTableStyleId = null;
    }
  }
  // Omitted halves resolve to the application's defaults, which the page paints, judged on the
  // element read above. A fragment without a styles part carries no defaults of its own.
  if (root.namespaceUri === WML_NAMESPACE_URI) {
    const omitted = omittedHalves(docDefaults);
    if (omitted.run) docDefaultsRPr = applicationDefaultsContainer('rPr', 'application');
    if (omitted.paragraph) docDefaultsPPr = applicationDefaultsContainer('pPr', 'application');
  }
  return {
    byId,
    docDefaultsRPr,
    docDefaultsPPr,
    defaultParagraphStyleId,
    defaultCharacterStyleId,
    defaultTableStyleId,
  };
}

/** The `basedOn` chain, base style FIRST, cycle-capped. `expectedType` gates the
 *  chain TIP like layout's resolver: a `w:rStyle` naming a paragraph style
 *  contributes NOTHING on screen, so it must contribute nothing to the copy. */
export function styleChain(
  index: StyleIndex,
  styleId: string | undefined,
  expectedType?: 'paragraph' | 'character' | 'table'
): OoxmlElement[] {
  const chain: OoxmlElement[] = [];
  const seen = new Set<string>();
  let current = styleId;
  while (current && !seen.has(current) && chain.length < MAX_STYLE_CHAIN) {
    seen.add(current);
    const style = index.byId.get(current);
    if (!style) break;
    if (chain.length === 0 && expectedType !== undefined) {
      const type = attributeValueOf(style, 'type', WML_NAMESPACE_URI);
      if (type !== undefined && type !== expectedType) return [];
    }
    chain.unshift(style);
    current = wmlVal(wmlChild(style, 'basedOn'));
  }
  return chain;
}

/**
 * Ordered property sources, lowest precedence first: docDefaults, the default paragraph
 * style chain, the paragraph style chain, the run style chain, then direct formatting.
 */
export function paragraphPropertySources(
  index: StyleIndex,
  ownPPr: OoxmlElement | null,
  // Conditional table-style pPr (wholeTable then the cell's condition), layered
  // between docDefaults and the paragraph style, per §17.7.2's ordering.
  tablePPr?: readonly OoxmlElement[]
): OoxmlElement[] {
  const sources: OoxmlElement[] = [];
  if (index.docDefaultsPPr) sources.push(index.docDefaultsPPr);
  if (tablePPr) for (const source of tablePPr) sources.push(source);
  // The default (Normal) style applies ONLY when the paragraph names no pStyle —
  // the same rule layout/style-cascade.ts follows. A named style not basedOn
  // Normal must not inherit Normal's formatting.
  const ownStyleId = wmlVal(wmlChild(ownPPr, 'pStyle'));
  for (const style of styleChain(
    index,
    ownStyleId ?? index.defaultParagraphStyleId ?? undefined,
    'paragraph'
  )) {
    const pPr = wmlChild(style, 'pPr');
    if (pPr) sources.push(pPr);
  }
  if (ownPPr) sources.push(ownPPr);
  return sources;
}

/** Run property sources grouped by cascade level, so toggles can XOR per level. */
export interface RunPropertyLayers {
  /** Every source lowest-precedence first, for the non-toggle folds. */
  readonly all: readonly OoxmlElement[];
  readonly defaults: readonly OoxmlElement[];
  /** Conditional table-style rPr — its OWN §17.7.3 XOR level, like the painter. */
  readonly tableLevel: readonly OoxmlElement[];
  readonly paragraphLevel: readonly OoxmlElement[];
  readonly characterLevel: readonly OoxmlElement[];
  readonly direct: OoxmlElement | null;
}

export function runPropertyLayers(
  index: StyleIndex,
  paragraphPPr: OoxmlElement | null,
  ownRPr: OoxmlElement | null,
  // Conditional table-style rPr: its own level below the paragraph style, above
  // docDefaults, per §17.7.2's ordering — and its OWN toggle XOR level, matching
  // layout/style-toggles.ts (a table <w:b/> plus a paragraph-style <w:b/> paints
  // NOT-bold, and the copy must agree).
  tableRPr?: readonly OoxmlElement[]
): RunPropertyLayers {
  const defaults: OoxmlElement[] = [];
  if (index.docDefaultsRPr) defaults.push(index.docDefaultsRPr);
  const tableLevel: OoxmlElement[] = [];
  if (tableRPr) for (const source of tableRPr) tableLevel.push(source);
  const paragraphLevel: OoxmlElement[] = [];
  // Same rule as paragraphPropertySources: Normal applies only without a pStyle.
  const paragraphStyleId = wmlVal(wmlChild(paragraphPPr, 'pStyle'));
  for (const style of styleChain(
    index,
    paragraphStyleId ?? index.defaultParagraphStyleId ?? undefined,
    'paragraph'
  )) {
    const rPr = wmlChild(style, 'rPr');
    if (rPr) paragraphLevel.push(rPr);
  }
  const characterLevel: OoxmlElement[] = [];
  // Only a named character style applies, like layout. The default character style adds
  // nothing, also as the base of another character style.
  const characterStyleId = wmlVal(wmlChild(ownRPr, 'rStyle')) ?? undefined;
  for (const style of styleChain(index, characterStyleId, 'character')) {
    const id = attributeValueOf(style, 'styleId', WML_NAMESPACE_URI);
    if (id !== undefined && id === index.defaultCharacterStyleId) continue;
    const rPr = wmlChild(style, 'rPr');
    if (rPr) characterLevel.push(rPr);
  }
  const all = [...defaults, ...tableLevel, ...paragraphLevel, ...characterLevel];
  if (ownRPr) all.push(ownRPr);
  return { all, defaults, tableLevel, paragraphLevel, characterLevel, direct: ownRPr };
}

/** The last source carrying the named property child wins. */
export function lastProperty(
  sources: readonly OoxmlElement[],
  localName: string
): OoxmlElement | null {
  let found: OoxmlElement | null = null;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (child) found = child;
  }
  return found;
}

/** Fold one attribute across every source carrying the property (per-attribute later-wins). */
export function foldAttribute(
  sources: readonly OoxmlElement[],
  propertyName: string,
  attributeName: string
): string | undefined {
  let value: string | undefined;
  for (const source of sources) {
    const child = wmlChild(source, propertyName);
    if (!child) continue;
    const attr = attributeValueOf(child, attributeName, WML_NAMESPACE_URI);
    if (attr !== undefined) value = attr;
  }
  return value;
}

/** ONE ST_OnOff read, matching `layout/style-toggles.ts`: only '0', 'false' and
 *  'off' are falsy — 'none' is NOT a legal off spelling, and treating it as one
 *  made copy drop formatting the painter shows. */
function onOffValue(val: string | undefined): boolean {
  return !(val === '0' || val === 'false' || val === 'off');
}

/** Plain boolean semantics: the last source carrying the property wins.
 *  For paragraph booleans and non-toggle run booleans (`w:rtl`). */
export function toggleOn(sources: readonly OoxmlElement[], localName: string): boolean {
  let state = false;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (!child) continue;
    state = onOffValue(wmlVal(child));
  }
  return state;
}

/** The resolved value of a toggle within ONE style level, or undefined when unset. */
function toggleLevelValue(
  sources: readonly OoxmlElement[],
  localName: string
): boolean | undefined {
  let value: boolean | undefined;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (!child) continue;
    value = onOffValue(wmlVal(child));
  }
  return value;
}

/** ECMA-376 §17.7.3 toggle semantics, matching `layout/style-toggles.ts`: direct
 *  formatting is absolute; an explicit off at the nearest style level that states
 *  the property outranks even a true document default; a docDefaults-on toggle
 *  otherwise short-circuits ON; otherwise the style levels XOR. */
export function runToggleOn(layers: RunPropertyLayers, localName: string): boolean {
  const direct = layers.direct ? wmlChild(layers.direct, localName) : null;
  if (direct) return onOffValue(wmlVal(direct));
  const table = toggleLevelValue(layers.tableLevel, localName);
  const paragraph = toggleLevelValue(layers.paragraphLevel, localName);
  const character = toggleLevelValue(layers.characterLevel, localName);
  if (character === false) return false;
  if (character === undefined && paragraph === false) return false;
  if (character === undefined && paragraph === undefined && table === false) return false;
  if (toggleLevelValue(layers.defaults, localName) === true) return true;
  // Each style level XORs, table included — the painter keeps them separate too.
  return ((table === true) !== (paragraph === true)) !== (character === true);
}

/** Plain-cascade boolean for run properties that are NOT §17.7.3 toggles
 *  (`w:dstrike`, matching the exclusion in `layout/style-toggles.ts`): the
 *  nearest level that states the property wins outright, with no XOR. */
export function runBooleanOn(layers: RunPropertyLayers, localName: string): boolean {
  const direct = layers.direct ? wmlChild(layers.direct, localName) : null;
  if (direct) return onOffValue(wmlVal(direct));
  const character = toggleLevelValue(layers.characterLevel, localName);
  if (character !== undefined) return character;
  const paragraph = toggleLevelValue(layers.paragraphLevel, localName);
  if (paragraph !== undefined) return paragraph;
  const table = toggleLevelValue(layers.tableLevel, localName);
  if (table !== undefined) return table;
  return toggleLevelValue(layers.defaults, localName) === true;
}
