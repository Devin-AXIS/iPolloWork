// The legacy table style hierarchy ([MS-DOCX] 2.3.1 overrideTableStyleFontSizeAndJustification).
//
// In it, the default paragraph style's 11pt or 12pt size yields when the table style states
// any paragraph or run formatting (17.7.6), on the style, its `w:basedOn` chain, or a
// conditional format; the cell then takes the document default size. Its left alignment
// yields to the table style. Compatibility mode 15 and later, without the setting, apply the
// table style below the default paragraph style instead (17.7.2), as the setting does when on.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const read = (xml: string) => {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};

const styles = (probe: string, normalSize = 24) =>
  read(`<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:pPr><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="${normalSize}"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableNormal" w:default="1"><w:name w:val="Normal Table"/></w:style>
  <w:style w:type="table" w:styleId="Base"><w:basedOn w:val="TableNormal"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>
  ${probe}
  </w:styles>`).root;

const probeStyle = (content: string, basedOn = 'TableNormal') =>
  `<w:style w:type="table" w:styleId="Probe"><w:basedOn w:val="${basedOn}"/>${content}</w:style>`;

const setting = (name: string, value: string) =>
  `<w:compatSetting w:name="${name}" w:uri="http://schemas.microsoft.com/office/word" w:val="${value}"/>`;
const settings = (mode: number | null, overrides: readonly string[] = []) =>
  read(
    `<w:settings xmlns:w="${W}"><w:compat>${mode === null ? '' : setting('compatibilityMode', String(mode))}${overrides
      .map((value) => setting('overrideTableStyleFontSizeAndJustification', value))
      .join('')}</w:compat></w:settings>`
  ).root;

const document = read(
  `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p>` +
    '<w:tbl><w:tblPr><w:tblStyle w:val="Probe"/><w:tblW w:w="4000" w:type="dxa"/>' +
    '<w:tblLayout w:type="fixed"/><w:tblLook w:val="0020"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Next</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:body></w:document>'
);

function cells(styleRoot: ReturnType<typeof styles>, settingsRoot: ReturnType<typeof settings>) {
  const pages = layoutSemanticDocument(document, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: buildStyleCascadeTable(styleRoot, undefined, settingsRoot),
  }).pages;
  const spans = pages
    .flatMap((page) => page.fragments)
    .flatMap((block) =>
      block.kind === 'table'
        ? block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
        : []
    )
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans)
    .filter((span) => span.text === 'Cell' || span.text === 'Next');
  return spans.map((span) => ({ size: span.style.fontSizePt, x: Math.round(span.box.x) }));
}

const RIGHT = '<w:pPr><w:jc w:val="right"/></w:pPr>';

describe('legacy table style hierarchy', () => {
  test('mode 15 without the setting keeps the default paragraph style size and alignment', () => {
    const [cell] = cells(styles(probeStyle(RIGHT)), settings(15));
    const [strict] = cells(styles(probeStyle(RIGHT)), settings(15, ['1']));
    expect(cell).toEqual(strict!);
    expect(cell!.size).toBe(12);
    const [legacy] = cells(styles(probeStyle(RIGHT)), settings(15, ['0']));
    expect(legacy!.size).toBe(8);
    // Right alignment from the table style moves the text right.
    expect(legacy!.x).toBeGreaterThan(cell!.x);
  });

  test('the last of several settings decides', () => {
    const [cell] = cells(styles(probeStyle(RIGHT)), settings(15, ['1', '1', '0']));
    expect(cell!.size).toBe(8);
  });

  for (const mode of [14, 12, null]) {
    test(`mode ${mode ?? 'absent'}: stated paragraph or run formatting drops the size`, () => {
      const stated = [
        RIGHT,
        '<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>',
        '<w:rPr><w:rFonts w:ascii="Face"/></w:rPr>',
        '<w:rPr><w:color w:val="FF0000"/></w:rPr>',
        '<w:rPr><w:szCs w:val="18"/></w:rPr>',
        '<w:tblStylePr w:type="firstRow"><w:rPr><w:color w:val="FF0000"/></w:rPr></w:tblStylePr>',
      ];
      for (const content of stated) {
        expect([
          content,
          cells(styles(probeStyle(content)), settings(mode)).map((c) => c.size),
        ]).toEqual([content, [8, 8]]);
      }
      expect(cells(styles(probeStyle('', 'Base')), settings(mode)).map((c) => c.size)).toEqual([
        8, 8,
      ]);
    });

    test(`mode ${mode ?? 'absent'}: a style without paragraph or run formatting keeps it`, () => {
      const unstated = [
        '',
        '<w:rPr/>',
        '<w:pPr/>',
        '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="CCFFCC"/></w:tcPr>',
        '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="12"/></w:tblBorders></w:tblPr>',
        '<w:tblStylePr w:type="wholeTable"><w:rPr><w:color w:val="FF0000"/></w:rPr></w:tblStylePr>',
      ];
      for (const content of unstated) {
        expect([
          content,
          cells(styles(probeStyle(content)), settings(mode)).map((c) => c.size),
        ]).toEqual([content, [12, 12]]);
      }
    });
  }

  test('a default paragraph style size other than 11pt or 12pt stays', () => {
    expect(cells(styles(probeStyle(RIGHT), 20), settings(14)).map((c) => c.size)).toEqual([10, 10]);
  });

  test('a table style size replaces the default paragraph style size', () => {
    const sized = probeStyle('<w:rPr><w:sz w:val="18"/></w:rPr>');
    expect(cells(styles(sized), settings(14)).map((c) => c.size)).toEqual([9, 9]);
  });
});
