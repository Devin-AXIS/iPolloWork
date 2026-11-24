// Document/section note-property writes for `setNoteProperties`.
//
// Note numbering and the footnote position resolve from each section's own `w:sectPr`
// (see `note-properties.ts`); settings.xml supplies only the endnote position. A document-scope
// write therefore writes every section's `w:footnotePr`/`w:endnotePr`, and settings.xml as
// well, so the saved file carries the change in both places other consumers look. A
// section-scope write that names an endnote position also writes it to settings.xml, because
// the endnote position is document-wide and a section's own copy does not apply. For the same
// reason a write never adds or changes an endnote position in a section.
//
// Every write is a per-field merge made in place:
// - A field the op does not name keeps its value.
// - An element that exists keeps its node id, and so does each of its field children; only
//   the `w:val` that changes is rewritten. Concurrent writers then contest the same nodes and
//   attributes instead of each adding a copy of an element the schema allows once.
// - A field the container does not author is added only when its value differs from the
//   default, so a write that changes nothing (the dialog applied as it opened) leaves the
//   package as it was.

import { createNodeIdAllocator, insertChildren, replaceNode } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { collectSectionPropertyNodes } from './hf-references.ts';
import { freeRelationshipId, withContentTypeOverride } from './note-lifecycle-shell.ts';
import { withStoryRelationship } from './hf-lifecycle-shell.ts';
import {
  DEFAULT_ENDNOTE_PROPERTIES,
  DEFAULT_FOOTNOTE_PROPERTIES,
  settingsPartOf,
} from './note-properties.ts';

const W = WML_NAMESPACE_URI;
const SETTINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const SETTINGS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const SETTINGS_PART = '/word/settings.xml';

/** The fields one note kind's write can set. A field left out keeps its current value. */
export interface NotePropertiesWrite {
  readonly numFmt?: string;
  readonly numRestart?: string;
  readonly position?: string;
  readonly numStart?: number;
}

export type SetNotePropertiesOp = {
  readonly op: 'setNoteProperties';
  readonly scope: 'document' | 'section';
  readonly sectionIndex?: number;
  readonly footnote?: NotePropertiesWrite;
  readonly endnote?: NotePropertiesWrite;
};

type PropsName = 'footnotePr' | 'endnotePr';

/** `CT_FtnProps`/`CT_EdnProps` fields in schema order, with the op key that sets each. */
const FIELDS: readonly (readonly [string, keyof NotePropertiesWrite])[] = [
  ['pos', 'position'],
  ['numFmt', 'numFmt'],
  ['numStart', 'numStart'],
  ['numRestart', 'numRestart'],
];
const FIELD_NAMES: ReadonlySet<string> = new Set(FIELDS.map(([name]) => name));

const DEFAULTS: Readonly<Record<PropsName, Readonly<Record<string, string>>>> = {
  footnotePr: {
    pos: DEFAULT_FOOTNOTE_PROPERTIES.pos,
    numFmt: DEFAULT_FOOTNOTE_PROPERTIES.numFmt,
    numStart: String(DEFAULT_FOOTNOTE_PROPERTIES.numStart),
    numRestart: DEFAULT_FOOTNOTE_PROPERTIES.numRestart,
  },
  endnotePr: {
    pos: DEFAULT_ENDNOTE_PROPERTIES.pos,
    numFmt: DEFAULT_ENDNOTE_PROPERTIES.numFmt,
    numStart: String(DEFAULT_ENDNOTE_PROPERTIES.numStart),
    numRestart: DEFAULT_ENDNOTE_PROPERTIES.numRestart,
  },
};

/**
 * Write note properties for the whole document: settings.xml and every section's `w:sectPr`.
 * A side the op omits (`footnote` or `endnote`), and a field a side omits, keep their values
 * everywhere. An implicit final section with no `w:sectPr` gets one when the write adds a value.
 */
export function writeDocumentNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  const withSettings = writeSettingsNoteProperties(pkg, op);
  if (!withSettings) return null;
  return writeEverySectionNoteProperties(withSettings, op);
}

/** Write one section's note properties; an endnote position also goes to settings.xml. */
export function writeSectionNoteProperties(
  pkg: OoxmlPackage,
  sectionIndex: number,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;
  const sectPrNodes = collectSectionPropertyNodes(main.root);
  if (sectionIndex >= sectPrNodes.length) return null;
  const target = sectPrNodes[sectionIndex];
  if (!target) return null;

  const updated = containerWith(
    target,
    sectionOp(op),
    createNodeIdAllocator(main),
    sectPrInsertIndex
  );
  let written = pkg;
  if (updated) {
    const replaced = replaceNode(main, target.id, updated);
    if (!replaced.ok) return null;
    written = withPart(pkg, replaced.part);
  }
  const position = op.endnote?.position;
  if (position === undefined) return written;
  // The endnote position is document-wide: merge it into settings.xml, keeping the rest.
  return writeSettingsNoteProperties(written, {
    op: 'setNoteProperties',
    scope: 'document',
    endnote: { position },
  });
}

function writeSettingsNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  let next = pkg;
  let settings = settingsPartOf(next);
  if (!settings) {
    // Create the part only when the write adds a value to it.
    const empty = element('probe', 'settings', []);
    if (!containerWith(empty, op, counterIds(), settingsInsertIndex)) return pkg;
    const created = ensureSettingsPart(next);
    if (!created) return null;
    next = created;
    settings = settingsPartOf(next);
  }
  if (!settings) return null;
  const updated = containerWith(
    settings.root,
    op,
    createNodeIdAllocator(settings),
    settingsInsertIndex
  );
  if (!updated) return next;
  const replaced = replaceNode(settings, settings.root.id, updated);
  return replaced.ok ? withPart(next, replaced.part) : null;
}

function ensureSettingsPart(pkg: OoxmlPackage): OoxmlPackage | null {
  if (pkg.parts.has(SETTINGS_PART)) return pkg;
  const xml = `<w:settings xmlns:w="${W}"></w:settings>`;
  const read = readOoxmlPart(xml, { name: SETTINGS_PART, contentType: SETTINGS_CT });
  if (!read.ok) return null;
  let next = withPart(pkg, read.part);
  const rId = freeRelationshipId(next);
  const related = withStoryRelationship(next, rId, SETTINGS_REL, 'settings.xml');
  if (!related) return null;
  next = related;
  const typed = withContentTypeOverride(next, SETTINGS_PART, SETTINGS_CT);
  return typed;
}

/**
 * Write the op's note properties into every section's `w:sectPr`. Sections are bounded by
 * `collectSectionPropertyNodes`. The implicit final section (no body-level `w:sectPr`) gets a
 * new one as the body's last child, so the write reaches every section the document has.
 */
function writeEverySectionNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;
  const nextId = createNodeIdAllocator(main);
  const forSection = sectionOp(op);
  let working: OoxmlPart = main;
  for (const sectPr of collectSectionPropertyNodes(main.root)) {
    if (sectPr) {
      const updated = containerWith(sectPr, forSection, nextId, sectPrInsertIndex);
      if (!updated) continue;
      const replaced = replaceNode(working, sectPr.id, updated);
      if (!replaced.ok) return null;
      working = replaced.part;
      continue;
    }
    const minted = containerWith(
      element(nextId(), 'sectPr', []),
      forSection,
      nextId,
      sectPrInsertIndex
    );
    if (!minted) continue;
    const body = bodyOf(working.root);
    if (!body) return null;
    const inserted = insertChildren(working, body.id, body.children.length, [minted]);
    if (!inserted.ok) return null;
    working = inserted.part;
  }
  return working === main ? pkg : withPart(pkg, working);
}

/**
 * The op as a section receives it. The endnote position is document-wide and settings.xml
 * holds it; a section's own copy has no effect, so a write does not add or change one there.
 */
function sectionOp(op: SetNotePropertiesOp): SetNotePropertiesOp {
  if (op.endnote?.position === undefined) return op;
  const { position: _position, ...endnote } = op.endnote;
  return { ...op, endnote };
}

/**
 * The container (a `w:sectPr` or the settings root) with the op's note properties merged in,
 * or null when nothing changes. An existing `w:footnotePr`/`w:endnotePr` is updated in place;
 * a missing one is inserted where `insertIndex` says.
 */
function containerWith(
  container: OoxmlElement,
  op: SetNotePropertiesOp,
  nextId: () => string,
  insertIndex: (children: readonly OoxmlNode[], name: PropsName) => number
): OoxmlElement | null {
  let children = [...container.children];
  let changed = false;
  for (const [name, side] of [
    ['footnotePr', op.footnote],
    ['endnotePr', op.endnote],
  ] as const) {
    const at: number[] = [];
    children.forEach((child, index) => {
      if (isW(child, name)) at.push(index);
    });
    const first = at.length > 0 ? (children[at[0]!] as OoxmlElement) : undefined;
    // Copies the schema allows once (two peers that each added the element at the same time)
    // collapse into the first, which is the copy every reader uses. This runs whether or not
    // the write names this kind, so any write heals the container it visits.
    const prior = first ? collapseCopies(first) : undefined;
    let next = prior;
    if (side)
      next = prior ? fieldsWritten(prior, name, side, nextId) : addedProps(name, side, nextId);
    if (at.length > 1) {
      const extra = new Set(at.slice(1));
      children = children.filter((_, index) => !extra.has(index));
      changed = true;
    }
    if (!next || next === first) continue;
    changed = true;
    if (first) children[at[0]!] = next;
    else children.splice(insertIndex(children, name), 0, next);
  }
  return changed ? ({ ...container, children } as OoxmlElement) : null;
}

/**
 * One `w:footnotePr`/`w:endnotePr` from the copies a container holds: the first copy, whole,
 * keeping its node id and the first occurrence of each field. Every reader uses exactly that,
 * so the result reads the same as before. Later copies are dropped with all their children,
 * fields and anything else; nothing moves from them into the first copy. Returns the first copy
 * itself when it repeats no field.
 */
function collapseCopies(first: OoxmlElement): OoxmlElement {
  const seen = new Set<string>();
  const kept = first.children.filter((child) => {
    if (!isField(child)) return true;
    if (seen.has(child.localName)) return false;
    seen.add(child.localName);
    return true;
  });
  if (kept.length === first.children.length) return first;
  return { ...first, children: kept } as OoxmlElement;
}

/** A new element for a container that has none, or undefined when every value is the default. */
function addedProps(
  name: PropsName,
  side: NotePropertiesWrite,
  nextId: () => string
): OoxmlElement | undefined {
  const empty = element('', name, []);
  const written = fieldsWritten(empty, name, side, nextId);
  if (written === empty) return undefined;
  return { ...written, id: nextId() } as OoxmlElement;
}

/**
 * `prior` with the side's fields merged in, keeping its id and the ids of the field children
 * it already has. A field the side does not name keeps its value; a field `prior` does not
 * author is added only when its value is not the default. Returns `prior` when nothing changes.
 */
function fieldsWritten(
  prior: OoxmlElement,
  name: PropsName,
  side: NotePropertiesWrite,
  nextId: () => string
): OoxmlElement {
  const children = [...prior.children];
  let changed = false;
  for (const [field, key] of FIELDS) {
    const raw = side[key];
    if (raw === undefined) continue;
    const value = String(raw);
    const index = children.findIndex((child) => isW(child, field));
    if (index >= 0) {
      const existing = children[index] as OoxmlElement;
      if (valOf(existing) === value) continue;
      children[index] = withVal(existing, value);
      changed = true;
    } else if (value !== DEFAULTS[name][field]) {
      children.push(element(nextId(), field, [wmlVal(value)]));
      changed = true;
    }
  }
  if (!changed) return prior;
  return { ...prior, children: inFieldOrder(children) } as OoxmlElement;
}

function isField(child: OoxmlNode): child is OoxmlElement {
  return child.kind !== 'textValue' && child.namespaceUri === W && FIELD_NAMES.has(child.localName);
}

/**
 * The four fields first, in `CT_FtnProps` order; other children (settings.xml lists separator
 * references here) follow, as `CT_FtnDocProps` orders them.
 */
function inFieldOrder(children: readonly OoxmlNode[]): OoxmlNode[] {
  const rank = (child: OoxmlNode) =>
    isField(child) ? FIELDS.findIndex(([field]) => field === child.localName) : FIELDS.length;
  return children
    .map((child, index) => ({ child, index }))
    .sort((left, right) => rank(left.child) - rank(right.child) || left.index - right.index)
    .map((entry) => entry.child);
}

/**
 * The package with every `w:sectPr` and the settings root holding at most one
 * `w:footnotePr`/`w:endnotePr`, and at most one of each field in them. It keeps the first copy
 * and the first occurrence of each field, which is what every reader uses, and drops later
 * copies whole, so the saved file reads the same as the document. Returns `pkg` itself when nothing repeats. Save runs it on
 * the package it exports; the document state does not change.
 */
export function withoutDuplicateNoteProperties(pkg: OoxmlPackage): OoxmlPackage {
  const dedupe: SetNotePropertiesOp = { op: 'setNoteProperties', scope: 'document' };
  const noNewNodes = (): string => {
    throw new Error('a duplicate collapse adds no node');
  };
  let next = pkg;
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (main) {
    const replacements = new Map<string, OoxmlElement>();
    for (const sectPr of collectSectionPropertyNodes(main.root)) {
      if (!sectPr || !repeats(sectPr)) continue;
      const updated = containerWith(sectPr, dedupe, noNewNodes, sectPrInsertIndex);
      if (updated) replacements.set(sectPr.id, updated);
    }
    if (replacements.size > 0) {
      const root = replacedById(main.root, replacements) as OoxmlElement;
      next = withPart(next, { ...main, root });
    }
  }
  const settings = settingsPartOf(next);
  if (settings && repeats(settings.root)) {
    const root = containerWith(settings.root, dedupe, noNewNodes, settingsInsertIndex);
    if (root) next = withPart(next, { ...settings, root });
  }
  return next;
}

/**
 * `node` with the listed descendants replaced, copying only their ancestors. A plain copy, not
 * an edit primitive: save must not touch the live tree's node index.
 */
function replacedById(node: OoxmlNode, replacements: ReadonlyMap<string, OoxmlElement>): OoxmlNode {
  const replacement = replacements.get(node.id);
  if (replacement) return replacement;
  if (node.kind === 'textValue') return node;
  let children: OoxmlNode[] | null = null;
  node.children.forEach((child, index) => {
    const next = replacedById(child, replacements);
    if (next === child) return;
    children ??= [...node.children];
    children[index] = next;
  });
  return children ? ({ ...node, children } as OoxmlNode) : node;
}

/** A cheap check before any rebuild: a repeated note properties element, or field in one. */
function repeats(container: OoxmlElement): boolean {
  let footnote = 0;
  let endnote = 0;
  for (const child of container.children) {
    if (isW(child, 'footnotePr')) footnote += 1;
    else if (isW(child, 'endnotePr')) endnote += 1;
    else continue;
    if (footnote > 1 || endnote > 1) return true;
    const fields = new Set<string>();
    for (const field of (child as OoxmlElement).children) {
      if (!isField(field)) continue;
      if (fields.has(field.localName)) return true;
      fields.add(field.localName);
    }
  }
  return false;
}

/** `CT_SectPr`: note properties follow the header/footer references, footnotes first. */
function sectPrInsertIndex(children: readonly OoxmlNode[], name: PropsName): number {
  let at = 0;
  children.forEach((child, index) => {
    if (
      isW(child, 'headerReference') ||
      isW(child, 'footerReference') ||
      (name === 'endnotePr' && isW(child, 'footnotePr'))
    ) {
      at = index + 1;
    }
  });
  return at;
}

/**
 * `CT_Settings` members that FOLLOW `w:footnotePr`/`w:endnotePr`. The note properties go
 * before the first of these (or before the first element in another namespace, such as
 * `m:mathPr` or the `w14`/`w15` extensions), never appended: settings.xml is read in schema
 * order, and a member out of sequence makes the part invalid.
 */
const SETTINGS_AFTER_NOTE_PROPERTIES: ReadonlySet<string> = new Set([
  'compat',
  'docVars',
  'rsids',
  'attachedSchema',
  'themeFontLang',
  'clrSchemeMapping',
  'doNotIncludeSubdocsInStats',
  'doNotAutoCompressPictures',
  'forceUpgrade',
  'captions',
  'readModeInkLockDown',
  'smartTagType',
  'shapeDefaults',
  'doNotEmbedSmartTags',
  'decimalSymbol',
  'listSeparator',
]);

function settingsInsertIndex(children: readonly OoxmlNode[], name: PropsName): number {
  const at = children.findIndex(
    (child) =>
      child.kind !== 'textValue' &&
      (child.namespaceUri !== W ||
        SETTINGS_AFTER_NOTE_PROPERTIES.has(child.localName) ||
        (name === 'footnotePr' && child.localName === 'endnotePr'))
  );
  return at === -1 ? children.length : at;
}

function isW(child: OoxmlNode, localName: string): boolean {
  return child.kind !== 'textValue' && child.namespaceUri === W && child.localName === localName;
}

function valOf(node: OoxmlElement): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === 'val')?.value;
}

function withVal(node: OoxmlElement, value: string): OoxmlElement {
  const has = node.attributes.some((attribute) => attribute.localName === 'val');
  const attributes = has
    ? node.attributes.map((attribute) =>
        attribute.localName === 'val' ? { ...attribute, value } : attribute
      )
    : [...node.attributes, wmlVal(value)];
  return { ...node, attributes } as OoxmlElement;
}

function bodyOf(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  return root.children.find((child) => isW(child, 'body')) as OoxmlElement | undefined;
}

/** Ids for a throwaway probe tree that never enters a part. */
function counterIds(): () => string {
  let next = 0;
  return () => `probe:${(next += 1)}`;
}

function element(
  id: string,
  localName: string,
  attributes: readonly unknown[],
  children: readonly OoxmlNode[] = []
): OoxmlElement {
  return {
    id,
    kind: 'generic',
    namespaceUri: W,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as unknown as OoxmlElement;
}

function wmlVal(value: string) {
  return { kind: 'wmlVal', namespaceUri: W, localName: 'val', prefix: 'w', value };
}
