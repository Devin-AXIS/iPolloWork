// Packages with the parts a document keeps BESIDE its body: headers, footers and notes.
//
// Assembled by hand rather than through the engine's own lifecycle ops, because these fixtures
// have to be able to describe a document the engine would not author — a header declared on the
// second section only, a notes part holding four notes, a comment anchored inside a footnote —
// and a fixture built by the code under test cannot fail the way a real file does.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OFFICE_REL = R;
const HEADER_REL = `${OFFICE_REL}/header`;
const FOOTER_REL = `${OFFICE_REL}/footer`;
const FOOTNOTES_REL = `${OFFICE_REL}/footnotes`;
const ENDNOTES_REL = `${OFFICE_REL}/endnotes`;
const COMMENTS_REL = `${OFFICE_REL}/comments`;
const SETTINGS_REL = `${OFFICE_REL}/settings`;
const NUMBERING_REL = `${OFFICE_REL}/numbering`;
const STYLES_REL = `${OFFICE_REL}/styles`;

const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** One relationship the main document part declares. */
export interface Rel {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

/** One part beside the main document: its name, its content type, and its XML. */
export interface SidePart {
  /** Zip path, e.g. `word/header1.xml`. */
  readonly name: string;
  readonly contentType: string;
  readonly xml: string;
}

export interface RichDocx {
  readonly body: string;
  readonly rels?: readonly Rel[];
  readonly parts?: readonly SidePart[];
}

/** A package with whatever parts and relationships the fixture names. */
export function richDocx(input: RichDocx): Uint8Array {
  const parts = input.parts ?? [];
  const rels = input.rels ?? [];
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        parts
          .map((part) => `<Override PartName="/${part.name}" ContentType="${part.contentType}"/>`)
          .join('') +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        rels
          .map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`)
          .join('') +
        `</Relationships>`
    ),
    ...Object.fromEntries(parts.map((part) => [part.name, strToU8(part.xml)])),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}">` +
        `<w:body>${input.body}</w:body></w:document>`
    ),
  });
}

const wRoot = (tag: string, inner: string): string =>
  `<w:${tag} xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}">${inner}</w:${tag}>`;

export const headerPart = (name: string, inner: string): SidePart => ({
  name,
  contentType: `${WML}.header+xml`,
  xml: wRoot('hdr', inner),
});

export const footerPart = (name: string, inner: string): SidePart => ({
  name,
  contentType: `${WML}.footer+xml`,
  xml: wRoot('ftr', inner),
});

/** A `w:sectPr` declaring furniture by relationship id. */
export const sectionProperties = (refs: readonly string[], extra = ''): string =>
  `<w:sectPr>${refs.join('')}${extra}<w:pgSz w:w="11906" w:h="16838"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
  `</w:sectPr>`;

/** A `w:headerReference` / `w:footerReference`, which is how a section declares furniture. */
export const furnitureRef = (
  kind: 'header' | 'footer',
  rId: string,
  variant: 'default' | 'first' | 'even'
): string => `<w:${kind}Reference w:type="${variant}" r:id="${rId}"/>`;

export const REL_TYPES = {
  header: HEADER_REL,
  footer: FOOTER_REL,
  footnotes: FOOTNOTES_REL,
  endnotes: ENDNOTES_REL,
  comments: COMMENTS_REL,
  settings: SETTINGS_REL,
  numbering: NUMBERING_REL,
  styles: STYLES_REL,
} as const;

export const CONTENT_TYPES = {
  footnotes: `${WML}.footnotes+xml`,
  endnotes: `${WML}.endnotes+xml`,
  comments: `${WML}.comments+xml`,
  settings: `${WML}.settings+xml`,
  numbering: `${WML}.numbering+xml`,
  styles: `${WML}.styles+xml`,
} as const;

/**
 * A footnotes part holding the two reserved separators plus the notes given.
 *
 * A note is given either as `text` (one plain paragraph) or as `xml` — the note's own blocks,
 * verbatim — because a story that shares its part with three others is exactly where markup a
 * fixture has to spell out belongs: a tracked change, a comment anchor, a second paragraph.
 */
export const notesPart = (
  kind: 'footnote' | 'endnote',
  notes: readonly { readonly id: number; readonly text?: string; readonly xml?: string }[]
): SidePart => ({
  name: `word/${kind}s.xml`,
  contentType: kind === 'footnote' ? CONTENT_TYPES.footnotes : CONTENT_TYPES.endnotes,
  xml: wRoot(
    `${kind}s`,
    [-1, 0]
      .map(
        (id) =>
          `<w:${kind} w:type="${id === -1 ? 'separator' : 'continuationSeparator'}" w:id="${String(id)}"><w:p/></w:${kind}>`
      )
      .join('') +
      notes
        .map(
          (note) =>
            `<w:${kind} w:id="${String(note.id)}">` +
            (note.xml ??
              `<w:p><w:r><w:t xml:space="preserve">${note.text ?? ''}</w:t></w:r></w:p>`) +
            `</w:${kind}>`
        )
        .join('')
  ),
});

/** A run carrying a note reference, which is how a note is reached from a story. */
export const noteReference = (kind: 'footnote' | 'endnote', id: number): string =>
  `<w:r><w:${kind}Reference w:id="${String(id)}"/></w:r>`;
