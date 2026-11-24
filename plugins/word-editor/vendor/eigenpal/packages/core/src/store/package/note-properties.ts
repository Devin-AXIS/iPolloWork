// Note properties: CT_FtnProps / CT_EdnProps at document (settings) and section level.
//
// Authored vs resolved stay distinguishable. Numbering (`w:numFmt`, `w:numStart`,
// `w:numRestart`) and the footnote position resolve from the section's own `w:sectPr` and the
// defaults only: the document-wide copies in settings.xml do not apply. The endnote position
// (`w:pos`) is the reverse: it is document-wide, read from settings.xml only, and a section's own
// endnote `w:pos` does not apply. Unedited documents without authored props must not invent any
// on save.
// This module is store/layout-shared and does not mutate trees.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveRelationship } from './relationships.ts';

/** `w:pos` — where a section's footnotes are laid out. */
export type FootnotePosition = 'pageBottom' | 'beneathText' | 'sectEnd' | 'docEnd';
/** `w:pos` for endnotes — only the two document-level placements are legal. */
export type EndnotePosition = 'sectEnd' | 'docEnd';
/** `w:numRestart` — when note numbering starts over. `eachPage` needs the reference's page. */
export type NoteNumRestart = 'continuous' | 'eachSect' | 'eachPage';

/** Authored subset — only keys present in the file appear. */
export interface AuthoredNoteProperties {
  readonly pos?: string;
  readonly numFmt?: string;
  readonly numStart?: number;
  readonly numRestart?: string;
}

/** Fully resolved footnote properties (defaults filled). */
export interface ResolvedFootnoteProperties {
  readonly pos: FootnotePosition;
  readonly numFmt: string;
  readonly numStart: number;
  readonly numRestart: NoteNumRestart;
}

/** Fully resolved endnote properties (defaults filled). */
export interface ResolvedEndnoteProperties {
  readonly pos: EndnotePosition;
  readonly numFmt: string;
  readonly numStart: number;
  readonly numRestart: NoteNumRestart;
}

/** Footnote defaults, applied to every field a section's `w:footnotePr` does not author. */
export const DEFAULT_FOOTNOTE_PROPERTIES: ResolvedFootnoteProperties = Object.freeze({
  pos: 'pageBottom',
  numFmt: 'decimal',
  numStart: 1,
  numRestart: 'continuous',
});

/**
 * Word-compatible defaults. ECMA-376 says omitted endnote `numFmt` is decimal;
 * MS-OE376 / MS-OI29500 document that Word’s default is `lowerRoman` instead.
 * Resolved (not authored) — unedited packages still invent nothing on save.
 */
export const DEFAULT_ENDNOTE_PROPERTIES: ResolvedEndnoteProperties = Object.freeze({
  pos: 'docEnd',
  numFmt: 'lowerRoman',
  numStart: 1,
  numRestart: 'continuous',
});

const FOOTNOTE_POS = new Set(['pageBottom', 'beneathText', 'sectEnd', 'docEnd']);
const ENDNOTE_POS = new Set(['sectEnd', 'docEnd']);
const NUM_RESTART = new Set(['continuous', 'eachSect', 'eachPage']);
const SETTINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

function isWml(node: OoxmlNode, localName: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function childNamed(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (isWml(child, localName)) return child as OoxmlElement;
  }
  return undefined;
}

function attribute(node: OoxmlElement, localName: string): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName !== localName) continue;
    if (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '') return entry.value;
  }
  return undefined;
}

function parseNumStart(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,10}$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) return undefined;
  return n;
}

/** Parse authored CT_FtnProps / CT_EdnProps without inventing defaults. */
export function parseAuthoredNoteProperties(
  propsNode: OoxmlNode | null | undefined
): AuthoredNoteProperties | undefined {
  if (!propsNode || propsNode.kind === 'textValue') return undefined;
  const authored: {
    pos?: string;
    numFmt?: string;
    numStart?: number;
    numRestart?: string;
  } = {};
  let any = false;

  const pos = childNamed(propsNode, 'pos');
  if (pos) {
    const val = attribute(pos, 'val');
    if (val !== undefined) {
      authored.pos = val;
      any = true;
    }
  }
  const numFmt = childNamed(propsNode, 'numFmt');
  if (numFmt) {
    const val = attribute(numFmt, 'val');
    if (val !== undefined) {
      authored.numFmt = val;
      any = true;
    }
  }
  const numStart = childNamed(propsNode, 'numStart');
  if (numStart) {
    const n = parseNumStart(attribute(numStart, 'val'));
    if (n !== undefined) {
      authored.numStart = n;
      any = true;
    }
  }
  const numRestart = childNamed(propsNode, 'numRestart');
  if (numRestart) {
    const val = attribute(numRestart, 'val');
    if (val !== undefined) {
      authored.numRestart = val;
      any = true;
    }
  }

  // Empty `<w:footnotePr/>` is authored presence with no fields — distinguish from absent.
  if (!any && propsNode.children.length === 0) return {};
  return any ? authored : propsNode.children.length > 0 ? authored : undefined;
}

function readPropsChild(
  container: OoxmlNode | null | undefined,
  localName: 'footnotePr' | 'endnotePr'
): AuthoredNoteProperties | undefined {
  if (!container) return undefined;
  const child = childNamed(container, localName);
  return parseAuthoredNoteProperties(child);
}

/** Authored footnotePr on a sectPr node. */
export function authoredFootnotePropertiesFromSectPr(
  sectPr: OoxmlNode | null | undefined
): AuthoredNoteProperties | undefined {
  return readPropsChild(sectPr, 'footnotePr');
}

/** Authored endnotePr on a sectPr node. */
export function authoredEndnotePropertiesFromSectPr(
  sectPr: OoxmlNode | null | undefined
): AuthoredNoteProperties | undefined {
  return readPropsChild(sectPr, 'endnotePr');
}

/** Locate settings.xml via the main document relationship when present. */
export function settingsPartOf(pkg: OoxmlPackage): OoxmlPart | null {
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  for (const record of relationships) {
    if (record.type !== SETTINGS_REL) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    return pkg.parts.get(resolved.target.partName) ?? null;
  }
  // Common default path when rel exists under a different walk — never invent a part.
  return pkg.parts.get('/word/settings.xml') ?? null;
}

/** Authored document-level footnotePr from settings. */
export function authoredDocumentFootnoteProperties(
  settings: OoxmlPart | null | undefined
): AuthoredNoteProperties | undefined {
  if (!settings) return undefined;
  return readPropsChild(settings.root, 'footnotePr');
}

/** Authored document-level endnotePr from settings. */
export function authoredDocumentEndnoteProperties(
  settings: OoxmlPart | null | undefined
): AuthoredNoteProperties | undefined {
  if (!settings) return undefined;
  return readPropsChild(settings.root, 'endnotePr');
}

function resolveRestart(raw: string | undefined, fallback: NoteNumRestart): NoteNumRestart {
  if (raw !== undefined && NUM_RESTART.has(raw)) return raw as NoteNumRestart;
  return fallback;
}

/**
 * Resolve footnote properties from the section's own `w:footnotePr` and the defaults.
 *
 * The document-wide `w:footnotePr` in settings.xml does not take part: a section with no
 * footnote properties of its own numbers `decimal` from 1, continuously, at the page bottom,
 * whatever settings.xml says. A section that authors only some fields takes the defaults for
 * the rest, so `<w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>` numbers its
 * notes 1, 2, 3 in decimal even when settings.xml names `chicago`.
 * Illegal position or restart strings fall back to the default.
 *
 * @param section - The section's authored `w:footnotePr`, if any.
 */
export function resolveFootnoteProperties(
  section?: AuthoredNoteProperties
): ResolvedFootnoteProperties;
/**
 * Resolve footnote properties, ignoring the document-wide value.
 *
 * @deprecated The settings.xml `w:footnotePr` does not change footnote numbering or
 * position, so the second argument has no effect. Call `resolveFootnoteProperties(section)`.
 * @param section - The section's authored `w:footnotePr`, if any.
 * @param document - Ignored.
 */
export function resolveFootnoteProperties(
  section: AuthoredNoteProperties | undefined,
  document: AuthoredNoteProperties | undefined
): ResolvedFootnoteProperties;
export function resolveFootnoteProperties(
  section?: AuthoredNoteProperties
): ResolvedFootnoteProperties {
  const posRaw = section?.pos ?? DEFAULT_FOOTNOTE_PROPERTIES.pos;
  const pos = FOOTNOTE_POS.has(posRaw)
    ? (posRaw as FootnotePosition)
    : DEFAULT_FOOTNOTE_PROPERTIES.pos;
  return {
    pos,
    numFmt: section?.numFmt ?? DEFAULT_FOOTNOTE_PROPERTIES.numFmt,
    numStart: section?.numStart ?? DEFAULT_FOOTNOTE_PROPERTIES.numStart,
    numRestart: resolveRestart(section?.numRestart, DEFAULT_FOOTNOTE_PROPERTIES.numRestart),
  };
}

/**
 * Resolve endnote properties.
 *
 * Numbering (`numFmt`, `numStart`, `numRestart`) comes from the section's own `w:endnotePr`
 * and the defaults (`lowerRoman` from 1, continuous) only. The position is document-wide: the
 * settings.xml `w:pos`, else `docEnd`. A section's own endnote `w:pos` does not move its
 * endnotes. `pageBottom` is never a legal endnote position and resolves to `docEnd`.
 *
 * @param section - The section's authored `w:endnotePr`, if any; its `w:pos` is not read.
 * @param document - The settings.xml `w:endnotePr`; only its `w:pos` is read.
 */
export function resolveEndnoteProperties(
  section?: AuthoredNoteProperties,
  document?: AuthoredNoteProperties
): ResolvedEndnoteProperties {
  const posRaw = document?.pos;
  const pos =
    posRaw !== undefined && ENDNOTE_POS.has(posRaw)
      ? (posRaw as EndnotePosition)
      : DEFAULT_ENDNOTE_PROPERTIES.pos;
  return {
    pos,
    numFmt: section?.numFmt ?? DEFAULT_ENDNOTE_PROPERTIES.numFmt,
    numStart: section?.numStart ?? DEFAULT_ENDNOTE_PROPERTIES.numStart,
    numRestart: resolveRestart(section?.numRestart, DEFAULT_ENDNOTE_PROPERTIES.numRestart),
  };
}

/** Validate an authored endnote position write — refuse `pageBottom`. */
export function isLegalEndnotePosition(pos: string): pos is EndnotePosition {
  return ENDNOTE_POS.has(pos);
}

/** Validate an authored footnote position write. */
export function isLegalFootnotePosition(pos: string): pos is FootnotePosition {
  return FOOTNOTE_POS.has(pos);
}

/** Whether a file-supplied string is a legal `w:numRestart` value. Narrows the type. */
export function isLegalNumRestart(value: string): value is NoteNumRestart {
  return NUM_RESTART.has(value);
}
