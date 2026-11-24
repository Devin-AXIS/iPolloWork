// Where a numbering level's indent ranks when a paragraph STYLE supplies the numbering.
//
// The level sits directly below the nearest style that states a `w:numPr`, even one that
// states only `w:ilvl`. That style, the styles based on it and the paragraph's own `w:pPr`
// outrank the level; that style's bases and the document defaults do not. A paragraph whose
// own `w:pPr` states a `w:numPr` puts the level above the whole chain.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems, walkStoryParagraphs } from '../list-resolve.ts';
import { buildStyleCascadeTable, resolveParagraphLayoutInputs } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Level 0: left 2880, hanging 720 (144pt / 36pt). Level 1: left 5040, hanging 720. */
const NUMBERING = `<w:numbering xmlns:w="${W}">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:pPr><w:ind w:left="2880" w:hanging="720"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
      <w:pPr><w:ind w:left="5040" w:hanging="720"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const NUM = '<w:numPr><w:numId w:val="1"/></w:numPr>';

function style(id: string, pPr: string, basedOn = 'Normal') {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:basedOn w:val="${basedOn}"/>
    <w:pPr>${pPr}</w:pPr></w:style>`;
}

const STYLES = `<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  ${style('FirstBase', '<w:ind w:firstLine="1440"/>')}
  ${style('NumOnFirstBase', NUM, 'FirstBase')}
  ${style('LeftBase', '<w:ind w:left="720"/>')}
  ${style('NumOnLeftBase', NUM, 'LeftBase')}
  ${style('NumOwnLeft', `${NUM}<w:ind w:left="720"/>`)}
  ${style('NumBase', NUM)}
  ${style('IndOnNumBase', '<w:ind w:left="720"/>', 'NumBase')}
  ${style('PlainOnNumOwnLeft', '<w:keepNext/>', 'NumOwnLeft')}
  ${style('PlainOnNumOnLeftBase', '<w:keepNext/>', 'NumOnLeftBase')}
  ${style('NumOwnFirstZero', `${NUM}<w:ind w:firstLine="0"/>`)}
  ${style('NumOwnLeftRtl', `${NUM}<w:bidi/><w:ind w:left="720"/>`)}
  ${style('NumOwnLevel0Ind', `${NUM}<w:ind w:left="2880" w:hanging="720"/>`)}
  ${style('Ilvl1OnNumOwnLevel0Ind', '<w:numPr><w:ilvl w:val="1"/></w:numPr>', 'NumOwnLevel0Ind')}
</w:styles>`;

function paragraph(styleId: string, directPPr = '') {
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${directPPr}</w:pPr>
    <w:r><w:t>item</w:t></w:r></w:p>`;
}

function resolve(bodyXml: string) {
  const document = part(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`
  );
  const body = document.root.children.find(
    (child) => (child as OoxmlElement).localName === 'body'
  ) as OoxmlElement;
  const blocks = body.children.filter(
    (child) => child.kind === 'paragraph' || child.kind === 'table'
  ) as OoxmlElement[];
  const cascade = buildStyleCascadeTable(part('/word/styles.xml', STYLES).root);
  const items = resolveStoryListItems(
    blocks,
    buildNumberingIndex(part('/word/numbering.xml', NUMBERING).root),
    cascade
  );
  const target = walkStoryParagraphs(blocks)[0]!;
  const item = items.get(target.id)!;
  return { item, inputs: resolveParagraphLayoutInputs(target, 500, cascade, item) };
}

function indentOf(styleId: string, directPPr = '') {
  const { item } = resolve(paragraph(styleId, directPPr));
  return { ilvl: item.ilvl, ...item.indent };
}

describe('list indent tier when a style supplies the numbering', () => {
  test("a base style's first-line indent does not replace the level's hanging", () => {
    const { item, inputs } = resolve(paragraph('NumOnFirstBase'));
    expect(item.indent).toEqual({ left: 144, right: 0, hanging: 36, firstLine: 0 });
    expect(inputs.indent).toEqual(item.indent);
  });

  test("a base style's left indent does not replace the level's", () => {
    expect(indentOf('NumOnLeftBase')).toMatchObject({ left: 144, hanging: 36 });
  });

  test("the declaring style's own left indent replaces the level's", () => {
    expect(indentOf('NumOwnLeft')).toMatchObject({ left: 36, hanging: 36 });
  });

  test('a style based on the declaring style outranks the level', () => {
    expect(indentOf('IndOnNumBase')).toMatchObject({ left: 36, hanging: 36 });
    expect(indentOf('PlainOnNumOwnLeft')).toMatchObject({ left: 36, hanging: 36 });
  });

  test("the declaring style's bases stay below the level when a child style inherits it", () => {
    expect(indentOf('PlainOnNumOnLeftBase')).toMatchObject({ left: 144, hanging: 36 });
  });

  test('a child style stating only ilvl ranks its base indent below the level', () => {
    expect(indentOf('Ilvl1OnNumOwnLevel0Ind')).toMatchObject({ ilvl: 1, left: 252, hanging: 36 });
  });

  test("the declaring style's first-line slot replaces the level's hanging", () => {
    expect(indentOf('NumOwnFirstZero')).toEqual({
      ilvl: 0,
      left: 144,
      right: 0,
      hanging: 0,
      firstLine: 0,
    });
  });

  test("a right-to-left declaring style's leading indent lands on the right", () => {
    expect(indentOf('NumOwnLeftRtl')).toEqual({
      ilvl: 0,
      left: 0,
      right: 36,
      hanging: 36,
      firstLine: 0,
    });
  });

  test('a table cell paragraph ranks the level the same way', () => {
    const cell = (styleId: string) =>
      resolve(`<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>
        <w:tr><w:tc>${paragraph(styleId)}</w:tc></w:tr></w:tbl>`).item.indent;
    expect(cell('NumOnLeftBase')).toMatchObject({ left: 144, hanging: 36 });
    expect(cell('NumOwnLeft')).toMatchObject({ left: 36, hanging: 36 });
  });
});

describe('a direct numPr puts the level above the whole chain', () => {
  test('a direct numPr stating only ilvl outranks the style indent', () => {
    const direct = '<w:numPr><w:ilvl w:val="1"/></w:numPr>';
    expect(indentOf('NumOwnLevel0Ind', direct)).toMatchObject({ ilvl: 1, left: 252, hanging: 36 });
    expect(indentOf('NumOwnLeft', direct)).toMatchObject({ ilvl: 1, left: 252, hanging: 36 });
    expect(indentOf('NumOnLeftBase', direct)).toMatchObject({ ilvl: 1, left: 252, hanging: 36 });
  });

  test('a direct numPr stating numId applies the numbering directly', () => {
    expect(indentOf('NumOwnLeft', NUM)).toMatchObject({ ilvl: 0, left: 144, hanging: 36 });
    const full = '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>';
    expect(indentOf('NumOwnLeft', full)).toMatchObject({ ilvl: 1, left: 252, hanging: 36 });
  });

  test("the paragraph's own indent outranks the level in both tiers", () => {
    const ind = '<w:ind w:left="400" w:firstLine="200"/>';
    const own = { left: 20, hanging: 0, firstLine: 10 };
    expect(indentOf('NumOnFirstBase', ind)).toMatchObject(own);
    expect(indentOf('NumOwnLeft', NUM + ind)).toMatchObject(own);
  });
});
