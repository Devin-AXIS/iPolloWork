// Where a list paragraph's indent comes from: STYLE, then the numbering LEVEL, then DIRECT.
//
// Word applies a level's `w:pPr/w:ind` between the paragraph style and the paragraph's own
// formatting, per attribute. Reading the flattened cascade as "the paragraph's indent" hands
// the STYLE's value to a level that overrode it — which is what put every lettered sub-item
// of a converted agreement a full indent step left of where Word draws it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { buildStyleCascadeTable, resolveParagraphLayoutInputs } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function numbering(levelInd: string) {
  return buildNumberingIndex(
    part(
      '/word/numbering.xml',
      `<w:numbering xmlns:w="${W}">
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>
            <w:lvlText w:val="(%1)"/><w:lvlJc w:val="left"/>
            <w:pPr>${levelInd}</w:pPr></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      </w:numbering>`
    ).root
  );
}

/** A `ListParagraph` style stating an indent of its own, the way a converted file writes it. */
const STYLES = `<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:pPr><w:ind w:left="775" w:hanging="624"/></w:pPr>
  </w:style>
</w:styles>`;

function listItem(directInd: string, levelInd: string) {
  const document = part(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="ListParagraph"/>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
        ${directInd}</w:pPr><w:r><w:t>item</w:t></w:r></w:p>
    </w:body></w:document>`
  );
  const body = document.root.children.find(
    (child) => (child as OoxmlElement).localName === 'body'
  ) as OoxmlElement;
  const blocks = body.children.filter((child) => child.kind === 'paragraph') as OoxmlElement[];
  const items = resolveStoryListItems(
    blocks,
    numbering(levelInd),
    buildStyleCascadeTable(part('/word/styles.xml', STYLES).root)
  );
  return [...items.values()][0]!;
}

describe('list indent precedence (style → level → direct)', () => {
  test("the level's left beats the style's, and the paragraph's own hanging beats the level's", () => {
    // The shape a PDF-converted agreement writes: style left=775 hanging=624, level
    // left=1512 hanging=738, paragraph states hanging="737" and nothing else.
    const item = listItem('<w:ind w:hanging="737"/>', '<w:ind w:left="1512" w:hanging="738"/>');
    expect(item.indent.left).toBe(1512 / 20);
    expect(item.indent.hanging).toBe(737 / 20);
  });

  test("the paragraph's own left beats the level's", () => {
    const item = listItem('<w:ind w:left="2000"/>', '<w:ind w:left="1512" w:hanging="738"/>');
    expect(item.indent.left).toBe(100);
    // Untouched by the direct `w:ind`, which states no first-line offset.
    expect(item.indent.hanging).toBe(738 / 20);
  });

  test("a level that states no indent leaves the style's standing", () => {
    const item = listItem('', '');
    expect(item.indent.left).toBe(775 / 20);
    expect(item.indent.hanging).toBe(624 / 20);
  });

  test('a level stating only left keeps the style first-line offset', () => {
    const item = listItem('', '<w:ind w:left="1512"/>');
    expect(item.indent.left).toBe(1512 / 20);
    expect(item.indent.hanging).toBe(624 / 20);
  });
});

/** A body style that carries the numbering itself and states only a leading indent. */
const NUMBERED_STYLES = `<w:styles xmlns:w="${W}">
  <w:docDefaults><w:pPrDefault><w:pPr><w:ind w:left="100" w:right="200"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="NumberedBody">
    <w:name w:val="Numbered Body"/>
    <w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:ind w:left="567"/></w:pPr>
  </w:style>
</w:styles>`;

function styleNumberedItem(directPPr: string, levelInd: string) {
  const document = part(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="NumberedBody"/>${directPPr}</w:pPr>
        <w:r><w:t>item</w:t></w:r></w:p>
    </w:body></w:document>`
  );
  const body = document.root.children.find(
    (child) => (child as OoxmlElement).localName === 'body'
  ) as OoxmlElement;
  const blocks = body.children.filter((child) => child.kind === 'paragraph') as OoxmlElement[];
  const cascade = buildStyleCascadeTable(part('/word/styles.xml', NUMBERED_STYLES).root);
  const items = resolveStoryListItems(blocks, numbering(levelInd), cascade);
  const item = [...items.values()][0]!;
  return { item, inputs: resolveParagraphLayoutInputs(blocks[0]!, 500, cascade, item) };
}

describe('list indent precedence when the style carries the numbering', () => {
  const LEVEL = '<w:ind w:left="6237" w:right="300" w:hanging="567"/>';

  test("the style's stated left beats the level's; the level fills what the style omits", () => {
    const { item, inputs } = styleNumberedItem('', LEVEL);
    expect(item.indent.left).toBe(567 / 20);
    expect(item.indent.hanging).toBe(567 / 20);
    expect(item.indent.right).toBe(300 / 20);
    expect(inputs.indent.left).toBe(567 / 20);
  });

  test('document defaults stay below the level', () => {
    const { item } = styleNumberedItem('', '<w:ind w:left="6237" w:hanging="567"/>');
    expect(item.indent.right).toBe(200 / 20);
    expect(styleNumberedItem('', LEVEL).item.indent.right).toBe(300 / 20);
  });

  test("the paragraph's own indent still wins", () => {
    const { item } = styleNumberedItem('<w:ind w:left="900" w:firstLine="0"/>', LEVEL);
    expect(item.indent).toEqual({ left: 45, right: 15, hanging: 0, firstLine: 0 });
  });

  test('a directly applied numPr puts the level back above the style', () => {
    const direct = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
    const { item, inputs } = styleNumberedItem(direct, LEVEL);
    expect(item.indent.left).toBe(6237 / 20);
    expect(inputs.indent.left).toBe(6237 / 20);
  });
});
