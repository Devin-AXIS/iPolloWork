// The heading outline over the tree session (`documentOutline`, facade `getOutline`).
//
// What these pin down: a heading is a BODY-STORY paragraph whose `w:pStyle` resolves
// through the styles part — by Word's built-in `heading N` name (case-insensitive) or by
// the style's own `w:outlineLvl` 0..8; everything else is excluded (no pStyle, unknown
// style, outlineLvl 9, table-cell paragraphs); hostile file strings are bounded at the
// derivation boundary; and the answer is memoized per revision but follows edits.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

function docx(options: { body: string; styles?: string }): Uint8Array {
  const { body, styles } = options;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (styles) {
    files['word/styles.xml'] = strToU8(styles);
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId10" Type="${STYLES_REL}" Target="styles.xml"/>` +
        '</Relationships>'
    );
  }
  return zipSync(files);
}

function open(bytes: Uint8Array): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

const styledParagraph = (styleId: string, text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const plainParagraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const style = (options: { styleId: string; name?: string; type?: string; outlineLvl?: string }) =>
  `<w:style w:type="${options.type ?? 'paragraph'}" w:styleId="${options.styleId}">` +
  (options.name !== undefined ? `<w:name w:val="${options.name}"/>` : '') +
  (options.outlineLvl !== undefined
    ? `<w:pPr><w:outlineLvl w:val="${options.outlineLvl}"/></w:pPr>`
    : '') +
  '</w:style>';

const stylesXml = (styleMarkup: string) => `<w:styles xmlns:w="${W}">${styleMarkup}</w:styles>`;

describe('documentOutline', () => {
  test('resolves built-in heading names to 0-based levels, in document order', () => {
    const session = open(
      docx({
        body:
          styledParagraph('H1', 'Introduction') +
          plainParagraph('Body text between headings.') +
          styledParagraph('H2', 'Details') +
          styledParagraph('H1', 'Conclusion'),
        styles: stylesXml(
          style({ styleId: 'H1', name: 'heading 1' }) +
            // Case-insensitive: Word writes `heading 2`, files in the wild vary.
            style({ styleId: 'H2', name: 'Heading 2' }) +
            style({ styleId: 'Normal', name: 'Normal' })
        ),
      })
    );
    const outline = session.documentOutline();
    expect(outline.map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'Introduction', level: 0 },
      { text: 'Details', level: 1 },
      { text: 'Conclusion', level: 0 },
    ]);
    // Each blockId addresses a real body paragraph — the id `setSelection` navigates to.
    const ids = session.paragraphIds();
    for (const entry of outline) expect(ids).toContain(entry.blockId);
    // Distinct headings, distinct addresses.
    expect(new Set(outline.map((entry) => entry.blockId)).size).toBe(outline.length);
  });

  test("a custom style's own outlineLvl 0..8 confers a level; 9 and junk do not", () => {
    const session = open(
      docx({
        body:
          styledParagraph('Chapter', 'Chapter heading') +
          styledParagraph('BodyLvl', 'Not a heading (outlineLvl 9)') +
          styledParagraph('Demoted', 'Heading name explicitly demoted') +
          styledParagraph('Junk', 'Not a heading (outlineLvl junk)'),
        styles: stylesXml(
          style({ styleId: 'Chapter', name: 'Chapter Title', outlineLvl: '2' }) +
            // 9 is Word's "body text" sentinel, not an outline level.
            style({ styleId: 'BodyLvl', name: 'Body Level', outlineLvl: '9' }) +
            style({ styleId: 'Demoted', name: 'Heading 1', outlineLvl: '9' }) +
            style({ styleId: 'Junk', name: 'Junky', outlineLvl: 'not-a-number' })
        ),
      })
    );
    expect(session.documentOutline()).toMatchObject([{ text: 'Chapter heading', level: 2 }]);
  });

  test('non-headings are excluded: no pStyle, unknown style, non-paragraph style types', () => {
    const session = open(
      docx({
        body:
          plainParagraph('No style at all') +
          styledParagraph('Missing', 'Style not defined') +
          styledParagraph('CharHeading', 'Character-style heading name') +
          styledParagraph('H1', 'Real heading'),
        styles: stylesXml(
          // A CHARACTER style named like a heading must not make paragraphs headings.
          style({ styleId: 'CharHeading', name: 'heading 1', type: 'character' }) +
            style({ styleId: 'H1', name: 'heading 1' })
        ),
      })
    );
    expect(session.documentOutline().map((entry) => entry.text)).toEqual(['Real heading']);
  });

  test('body story only: a heading-styled paragraph inside a table cell is not outline', () => {
    const session = open(
      docx({
        body:
          styledParagraph('H1', 'Body heading') +
          '<w:tbl><w:tr><w:tc>' +
          styledParagraph('H1', 'Cell heading') +
          '</w:tc></w:tr></w:tbl>' +
          plainParagraph('tail'),
        styles: stylesXml(style({ styleId: 'H1', name: 'heading 1' })),
      })
    );
    expect(session.documentOutline().map((entry) => entry.text)).toEqual(['Body heading']);
  });

  test('hostile file strings are bounded at the derivation boundary', () => {
    const longText = 'A'.repeat(500);
    const session = open(
      docx({
        body:
          styledParagraph('H1', longText) +
          // Tabs are control characters in the projected text; they flatten to spaces.
          `<w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>before</w:t></w:r><w:r><w:tab/><w:t>after</w:t></w:r></w:p>` +
          // Whitespace-only heading text: no entry, never a blank row.
          styledParagraph('H1', '   ') +
          styledParagraph('Evil&#9;Id', 'Styled by a control-character id'),
        styles: stylesXml(
          style({ styleId: 'H1', name: 'heading 1' }) +
            // The styleId itself carries a TAB — dropped, never repaired.
            style({ styleId: 'Evil&#9;Id', name: 'heading 2' })
        ),
      })
    );
    const outline = session.documentOutline();
    expect(outline).toHaveLength(2);
    expect(outline[0]!.text).toHaveLength(200);
    expect(outline[0]!.text).toBe('A'.repeat(200));
    expect(outline[1]!.text).toBe('before after');
  });

  test('memoized per revision, and an edit to a heading refreshes the answer', () => {
    const session = open(
      docx({
        body: styledParagraph('H1', 'Title'),
        styles: stylesXml(style({ styleId: 'H1', name: 'heading 1' })),
      })
    );
    const first = session.documentOutline();
    // Same revision: the SAME array reference, not a re-derivation.
    expect(session.documentOutline()).toBe(first);
    expect(first.map((entry) => entry.text)).toEqual(['Title']);

    const headingId = first[0]!.blockId;
    const applied = session.applyTreeOps([
      { op: 'insertText', paragraphId: headingId, offset: 0, text: 'Re' },
    ]);
    expect(applied.committed).toBe(true);
    const second = session.documentOutline();
    expect(second).not.toBe(first);
    expect(second.map((entry) => entry.text)).toEqual(['ReTitle']);
  });

  test('a document without a styles part answers empty', () => {
    const session = open(docx({ body: styledParagraph('H1', 'Orphan heading') }));
    expect(session.documentOutline()).toEqual([]);
  });
});
