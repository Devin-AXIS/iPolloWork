// Paragraph marks size the lines they end (ECMA-376 §17.3.1.29). An empty paragraph's line is
// measured in the mark's face, which comes from `w:pPr/w:rPr`, the paragraph style, the table
// style and `w:docDefaults` (§17.7.5). Export must load those faces even where no text run
// names them, or empty lines are measured in the fallback face.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import {
  collectRenderedFontFamilies,
  collectRenderedFontFamilyCandidates,
} from '../../store/package/rendered-fonts.ts';
import { defineFontResolver } from '../../layout/font-resolver.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const theme = {
  major: 'Heading Face',
  minor: 'Body Face',
  majorEastAsia: null,
  minorEastAsia: null,
};

const STYLES =
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Default Face" w:hAnsi="Default Face" w:eastAsia="Default CJK"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Mono"><w:rPr><w:rFonts w:ascii="Style Face"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="MarkChar"><w:rPr><w:rFonts w:ascii="Char Face"/></w:rPr></w:style>' +
  '<w:style w:type="table" w:styleId="Grid"><w:rPr><w:rFonts w:ascii="Table Face"/></w:rPr></w:style>';

function root(xml: string, name: string): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part.root;
}
const styles = root(`<w:styles xmlns:w="${W}">${STYLES}</w:styles>`, '/word/styles.xml');
const body = (content: string) =>
  root(`<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`, '/word/document.xml');
const table = (cell: string, style = '') =>
  `<w:tbl><w:tblPr>${style ? `<w:tblStyle w:val="${style}"/>` : ''}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${cell}</w:tc></w:tr></w:tbl>`;
const markFonts = (rPr: string, content = '') =>
  `<w:p><w:pPr><w:rPr>${rPr}</w:rPr></w:pPr>${content}</w:p>`;

test('empty paragraphs request the faces their marks are measured in', () => {
  const cases: [string, readonly string[], readonly string[]][] = [
    // Only empty table cells: the document defaults size every line.
    [table('<w:p/>'), [], ['Default Face']],
    // The mark's own run properties.
    [markFonts('<w:rFonts w:ascii="Mark Face"/>'), ['Mark Face'], ['Default Face']],
    // The paragraph style.
    ['<w:p><w:pPr><w:pStyle w:val="Mono"/></w:pPr></w:p>', [], ['Default Face', 'Style Face']],
    // The table style.
    [table('<w:p/>', 'Grid'), [], ['Default Face', 'Table Face']],
    // The mark's character style sizes an empty line.
    [markFonts('<w:rStyle w:val="MarkChar"/>'), [], ['Char Face', 'Default Face']],
  ];
  for (const [content, direct, inherited] of cases) {
    const candidates = collectRenderedFontFamilyCandidates([body(content)], styles, theme);
    expect(candidates.direct).toEqual(direct);
    // No East Asian face: an empty mark is measured in its Latin face.
    expect(candidates.inherited).toEqual(inherited);
    // The substitution notice still reports only faces that text renders in.
    expect(collectRenderedFontFamilies([body(content)], styles, theme)).toEqual([]);
  }
});

test('a mark character style does not size a line with content', () => {
  const text = '<w:r><w:rPr><w:rFonts w:ascii="Run Face"/></w:rPr><w:t>Text</w:t></w:r>';
  const candidates = collectRenderedFontFamilyCandidates(
    [body(markFonts('<w:rStyle w:val="MarkChar"/>', text))],
    styles,
    theme
  );
  expect(candidates.direct).toEqual(['Run Face']);
  expect(candidates.inherited).not.toContain('Char Face');
});

test('export requests the mark faces of a document with no text', async () => {
  let requested: readonly string[] = [];
  const opened = await openFontBackedDocumentForExport(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="styles" Type="${OFFICE}/styles" Target="styles.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${table(markFonts('<w:rFonts w:ascii="Mark Face"/>'))}<w:p/></w:body></w:document>`
      ),
      'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${STYLES}</w:styles>`),
    }),
    {
      fonts: defineFontResolver((request) => {
        requested = request.families;
        return { sources: [], defaultFont: { family: 'Host Fallback', sizeHalfPoints: 22 } };
      }),
    }
  );
  if (!opened.ok) throw new Error('fixture rejected');
  opened.session.dispose();
  expect(requested).toEqual(['Mark Face', 'Default Face']);
});
