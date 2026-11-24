// The list marker of a cell paragraph takes the table style's run formatting (17.7.6) through
// the paragraph mark, as the cell's text does. The level's own `w:rPr` (17.9.6) and the
// paragraph style still win over the table style.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { paragraphFragmentsOf, type ListMarkerRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string) {
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}

const level = (id: number, rPr = '') =>
  `<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
  `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${rPr}</w:lvl></w:abstractNum>` +
  `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`;
const numberingIndex = buildNumberingIndex(
  part(
    `<w:numbering xmlns:w="${W}">${level(1)}${level(2, '<w:rPr><w:sz w:val="40"/></w:rPr>')}</w:numbering>`
  ).root
);

const styleCascade = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Big"><w:name w:val="Big"/><w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>' +
      '<w:style w:type="table" w:styleId="Probe"><w:name w:val="Probe"/><w:basedOn w:val="TableNormal"/>' +
      '<w:rPr><w:color w:val="3366FF"/><w:sz w:val="16"/></w:rPr></w:style></w:styles>'
  ).root,
  undefined,
  part(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
  ).root
);

function marker(options: { style?: string; numId?: number; pStyle?: string; table?: boolean }) {
  const pPr =
    (options.pStyle ? `<w:pStyle w:val="${options.pStyle}"/>` : '') +
    `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${options.numId ?? 1}"/></w:numPr>`;
  const paragraph = `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>Item text</w:t></w:r></w:p>`;
  const body =
    options.table === false
      ? paragraph
      : `<w:tbl><w:tblPr>${options.style ? `<w:tblStyle w:val="${options.style}"/>` : ''}` +
        '<w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
        `<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`;
  const layout = layoutSemanticDocument(
    part(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    0,
    { measurer: createFixedMeasurer(6, 14), numberingIndex, styleCascade }
  );
  return [...paragraphFragmentsOf(layout.pages[0]!)].find((entry) => entry.marker)!
    .marker as ListMarkerRecord;
}

describe('list marker in a styled table cell', () => {
  test('takes the table style run properties', () => {
    const styled = marker({ style: 'Probe' });
    expect(styled.style.fontSizePt).toBe(8);
    expect(styled.style.color).toBe('3366FF');
  });

  test('keeps the document defaults without a table style or outside a table', () => {
    expect(marker({}).style.fontSizePt).toBe(10);
    expect(marker({ table: false }).style.fontSizePt).toBe(10);
  });

  test('yields to the level run properties and the paragraph style', () => {
    expect(marker({ style: 'Probe', numId: 2 }).style.fontSizePt).toBe(20);
    expect(marker({ style: 'Probe', pStyle: 'Big' }).style.fontSizePt).toBe(16);
    // The color still comes from the table style where nothing else states one.
    expect(marker({ style: 'Probe', pStyle: 'Big' }).style.color).toBe('3366FF');
  });
});
