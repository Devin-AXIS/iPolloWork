// The document's own metadata — what `docProps/core.xml` and `docProps/app.xml` record.
//
// Word's document-property fields (TITLE, AUTHOR, SUBJECT, …) paint these strings. The values
// are ATTACKER-CONTROLLED: a `.docx` is a zip whose XML the sender fully controls, so every
// string is capped here at the trust boundary and the downstream paint sink writes it through
// `textContent` (never markup). This reader only extracts the known, fixed properties by their
// exact (namespace, localName); it never builds a map keyed by a file-supplied element name, so
// a hostile `<__proto__>` element is simply never matched and can pollute nothing.

import type { OoxmlNode } from './ooxml-tree.ts';

/** Dublin Core elements namespace — `dc:title`, `dc:creator`, `dc:subject`, `dc:description`. */
const DC_NAMESPACE_URI = 'http://purl.org/dc/elements/1.1/';
/** Core-properties namespace — `cp:keywords`, `cp:lastModifiedBy`. */
const CORE_PROPERTIES_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
/** Extended (app) properties namespace — `Company`, `Manager`. */
const EXTENDED_PROPERTIES_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

/**
 * Per-value character cap. A legitimate title or author is short; anything near this is a
 * hostile payload sized to bloat layout, and clamping it costs a well-formed file nothing.
 */
export const MAX_DOCUMENT_PROPERTY_CHARS = 4096;

/**
 * The document metadata Word's document-property fields render.
 *
 * Every member is optional: an absent part, an absent element, or an empty value all read as
 * `undefined`, and a field over a missing property paints nothing. Keys are engine-internal
 * names; the field → property mapping (`TITLE` → `title`, `AUTHOR` → `creator`, …) lives in
 * `layout/field-doc-property.ts`.
 */
export interface DocumentProperties {
  /** `dc:title` — TITLE. */
  readonly title?: string;
  /** `dc:creator` — AUTHOR. */
  readonly creator?: string;
  /** `dc:subject` — SUBJECT. */
  readonly subject?: string;
  /** `cp:keywords` — KEYWORDS. */
  readonly keywords?: string;
  /** `cp:lastModifiedBy` — LASTSAVEDBY. */
  readonly lastModifiedBy?: string;
  /** `dc:description` — COMMENTS. */
  readonly description?: string;
  /** `Company` from `docProps/app.xml`. No field maps to it yet; carried for completeness. */
  readonly company?: string;
  /** `Manager` from `docProps/app.xml`. No field maps to it yet; carried for completeness. */
  readonly manager?: string;
}

/** The empty answer a document with no properties part gives. Frozen: a shared constant. */
export const EMPTY_DOCUMENT_PROPERTIES: DocumentProperties = Object.freeze({});

/**
 * Text of the FIRST direct child element of `root` with this exact (namespace, localName),
 * trimmed and length-capped, or undefined when absent or empty after trimming.
 *
 * Reads a single `textValue` child only — a property element carries one text node — so nested
 * markup a hostile file wraps around the value contributes nothing.
 */
function childText(root: OoxmlNode, namespaceUri: string, localName: string): string | undefined {
  if (root.kind === 'textValue') return undefined;
  for (const child of root.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri !== namespaceUri || child.localName !== localName) continue;
    const text = child.children.find((node) => node.kind === 'textValue');
    if (!text || text.kind !== 'textValue') return undefined;
    const trimmed = text.value.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.length > MAX_DOCUMENT_PROPERTY_CHARS
      ? trimmed.slice(0, MAX_DOCUMENT_PROPERTY_CHARS)
      : trimmed;
  }
  return undefined;
}

/**
 * Read the typed document properties from the parsed `docProps/core.xml` and `docProps/app.xml`
 * roots. Either root may be null/undefined — a document without that part contributes nothing.
 *
 * Assigns only fixed, known keys, so no file-supplied element name ever becomes an object key.
 */
export function readDocumentProperties(
  coreRoot: OoxmlNode | null | undefined,
  appRoot?: OoxmlNode | null
): DocumentProperties {
  const result: {
    title?: string;
    creator?: string;
    subject?: string;
    keywords?: string;
    lastModifiedBy?: string;
    description?: string;
    company?: string;
    manager?: string;
  } = {};

  if (coreRoot && coreRoot.kind !== 'textValue') {
    const title = childText(coreRoot, DC_NAMESPACE_URI, 'title');
    if (title !== undefined) result.title = title;
    const creator = childText(coreRoot, DC_NAMESPACE_URI, 'creator');
    if (creator !== undefined) result.creator = creator;
    const subject = childText(coreRoot, DC_NAMESPACE_URI, 'subject');
    if (subject !== undefined) result.subject = subject;
    const description = childText(coreRoot, DC_NAMESPACE_URI, 'description');
    if (description !== undefined) result.description = description;
    const keywords = childText(coreRoot, CORE_PROPERTIES_NAMESPACE_URI, 'keywords');
    if (keywords !== undefined) result.keywords = keywords;
    const lastModifiedBy = childText(coreRoot, CORE_PROPERTIES_NAMESPACE_URI, 'lastModifiedBy');
    if (lastModifiedBy !== undefined) result.lastModifiedBy = lastModifiedBy;
  }

  if (appRoot && appRoot.kind !== 'textValue') {
    const company = childText(appRoot, EXTENDED_PROPERTIES_NAMESPACE_URI, 'Company');
    if (company !== undefined) result.company = company;
    const manager = childText(appRoot, EXTENDED_PROPERTIES_NAMESPACE_URI, 'Manager');
    if (manager !== undefined) result.manager = manager;
  }

  return result;
}
