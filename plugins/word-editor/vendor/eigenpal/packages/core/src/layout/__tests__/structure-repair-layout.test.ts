// Content in a broken shape stays on the page and lays out as its properties say: run
// properties add up where they stand, a paragraph's properties after content apply to
// nothing, two table property lists merge, a paragraph written into a row joins the next
// cell, and a break inside a text element breaks the line.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MARGINS =
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>';
const SECTION = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${MARGINS}</w:sectPr>`;
const LANDSCAPE = `<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>${MARGINS}</w:sectPr>`;

function lay(body: string): SemanticLayout {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${SECTION}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
}

const paragraphs = (layout: SemanticLayout): ParagraphFragmentRecord[] =>
  layout.pages.flatMap((page) =>
    page.fragments.filter(
      (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
    )
  );
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
const spans = (layout: SemanticLayout) =>
  paragraphs(layout).flatMap((fragment) => fragment.lines.flatMap((line) => line.spans));
const text = (layout: SemanticLayout) =>
  spans(layout)
    .map((span) => span.text)
    .join('');
/** `localName=val` for each run property on the span holding `word`. */
const propsOf = (layout: SemanticLayout, word: string) =>
  spans(layout)
    .find((span) => span.text.includes(word))!
    .props.map((prop) =>
      prop.attributes?.val ? `${prop.localName}=${prop.attributes.val}` : prop.localName
    );

describe('run properties out of place', () => {
  test('after a saved page break, they apply to the run text', () => {
    const layout = lay(
      '<w:p><w:r><w:lastRenderedPageBreak/><w:rPr><w:b/></w:rPr><w:t>Lead</w:t></w:r>' +
        '<w:r><w:t>Additional words</w:t></w:r></w:p>'
    );
    expect(text(layout)).toBe('LeadAdditional words');
    expect(propsOf(layout, 'Lead')).toEqual(['b']);
  });

  test('they apply from where they stand, adding to the ones before them', () => {
    const layout = lay(
      '<w:p><w:r><w:t xml:space="preserve">Plain </w:t><w:rPr><w:sz w:val="56"/></w:rPr>' +
        '<w:t xml:space="preserve">Big </w:t><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bold </w:t>' +
        '<w:rPr><w:sz w:val="20"/></w:rPr><w:t>Small</w:t></w:r></w:p>'
    );
    expect(text(layout)).toBe('Plain Big Bold Small');
    expect(propsOf(layout, 'Plain')).toEqual([]);
    expect(propsOf(layout, 'Big')).toEqual(['sz=56']);
    expect(propsOf(layout, 'Bold')).toEqual(['b', 'sz=56']);
    expect(propsOf(layout, 'Small')).toEqual(['b', 'sz=20']);
  });
});

describe('paragraph properties out of place', () => {
  test('after a bookmark, they apply with their section break', () => {
    const layout = lay(
      '<w:p><w:bookmarkStart w:id="0" w:name="b"/><w:pPr><w:jc w:val="center"/>' +
        `${LANDSCAPE}</w:pPr><w:r><w:t>First</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>` +
        '<w:p><w:r><w:t>Second</w:t></w:r></w:p>'
    );
    expect(text(layout)).toBe('FirstSecond');
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.box).toMatchObject({ width: 792, height: 612 });
    expect(paragraphs(layout)[0]!.alignment).toBe('center');
  });

  test('after content, they apply to nothing and open no section', () => {
    const layout = lay(
      '<w:p><w:r><w:t>First</w:t></w:r><w:pPr><w:spacing w:before="2000"/><w:jc w:val="right"/>' +
        `${LANDSCAPE}</w:pPr></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>`
    );
    expect(text(layout)).toBe('FirstSecond');
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.box).toMatchObject({ width: 612, height: 792 });
    const [first] = paragraphs(layout);
    expect(first!.alignment).toBe('left');
    expect(first!.spacing.before).toBe(0);
  });

  test('a stray w:val leaves the paragraph and run properties applying', () => {
    const layout = lay(
      '<w:p w:val="1"><w:pPr><w:jc w:val="center"/></w:pPr><w:r w:val="2">' +
        '<w:rPr><w:sz w:val="56"/></w:rPr><w:t w:val="3">Valued</w:t></w:r></w:p>'
    );
    expect(text(layout)).toBe('Valued');
    expect(paragraphs(layout)[0]!.alignment).toBe('center');
    expect(propsOf(layout, 'Valued')).toEqual(['sz=56']);
  });
});

describe('run content out of place', () => {
  test('a w:br inside a w:t breaks the line, and a w:tab inside one shows nothing', () => {
    const layout = lay(
      '<w:p><w:r><w:t>Upper<w:br/>Lower</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Left<w:tab/>Right</w:t></w:r></w:p>'
    );
    const [broken, tabbed] = paragraphs(layout);
    const lineText = (line: { spans: readonly { text: string }[] }) =>
      line.spans.map((span) => span.text.replace('\n', '')).join('');
    expect(broken!.lines.map(lineText)).toEqual(['Upper', 'Lower']);
    expect(tabbed!.lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      'LeftRight',
    ]);
  });

  test('a w:tab written straight into a paragraph shows nothing', () => {
    const layout = lay('<w:p><w:tab/><w:r><w:t>After</w:t></w:r></w:p>');
    const [paragraph] = paragraphs(layout);
    expect(text(layout)).toBe('After');
    expect(paragraph!.lines[0]!.contentX).toBe(0);
  });

  test('a w:ins inside a run shows its text', () => {
    const layout = lay(
      '<w:p><w:r><w:t>Plain</w:t><w:ins w:id="9" w:author="a"><w:t>Inserted</w:t></w:ins>' +
        '<w:t>Tail</w:t></w:r></w:p>'
    );
    expect(text(layout)).toBe('PlainInsertedTail');
  });
});

describe('tables in a broken shape', () => {
  test('two w:tblPr apply together, the later winning, and the first grid sets the widths', () => {
    const layout = lay(
      '<w:tbl><w:tblPr><w:jc w:val="right"/></w:tblPr><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:r><w:t>Merged</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>'
    );
    const [table] = tables(layout);
    // 468pt of content width, a 200pt table aligned right. Its absolute width puts the cell
    // content, not the outer edge, on the right text edge: one 0.5pt fallback margin out.
    expect(table!.box).toMatchObject({ x: 268.5, width: 200 });
    expect(table!.columnEdges).toEqual([0, 200]);
  });

  test('a paragraph written straight into a row shows at the top of the next cell', () => {
    const layout = lay(
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
        '<w:tc><w:p><w:r><w:t>One</w:t></w:r></w:p></w:tc><w:p><w:r><w:t>Stray</w:t></w:r></w:p>' +
        '<w:tc><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>'
    );
    const cells = tables(layout)[0]!.rows[0]!.cells;
    const words = cells.map((cell) =>
      cell.blocks.map((block) =>
        block.kind === 'paragraph'
          ? block.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
          : ''
      )
    );
    expect(words).toEqual([['One'], ['Stray', 'Two']]);
  });
});

describe('text white space', () => {
  test('boundary spaces without xml:space show nothing, and inner spaces stay', () => {
    const layout = lay(
      '<w:p><w:r><w:t>One </w:t><w:t>Two</w:t></w:r><w:r><w:t> </w:t></w:r>' +
        '<w:r><w:t> Three  Four</w:t></w:r></w:p>'
    );
    expect(text(layout)).toBe('OneTwoThree  Four');
  });
});

describe('paragraph properties merged', () => {
  test('two w:pPr before the content both apply, and attributes of one element add up', () => {
    const layout = lay(
      '<w:p><w:pPr><w:jc w:val="right"/><w:ind w:left="2880"/></w:pPr>' +
        '<w:pPr><w:spacing w:before="2000"/><w:ind w:firstLine="720"/></w:pPr>' +
        '<w:r><w:t>Merged</w:t></w:r></w:p>'
    );
    const [paragraph] = paragraphs(layout);
    expect(paragraph!.alignment).toBe('right');
    expect(paragraph!.spacing.before).toBe(100);
    expect(paragraph!.indent).toMatchObject({ left: 144, firstLine: 36 });
  });
});

describe('nesting', () => {
  test('a paragraph and a run inside a paragraph show on its line, and a table stays a table', () => {
    const layout = lay(
      '<w:p><w:r><w:t>Aa</w:t></w:r><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:t>Bb</w:t><w:r><w:rPr><w:b/></w:rPr><w:t>Cc</w:t></w:r></w:r></w:p></w:p>' +
        '<w:p><w:r><w:t>Dd</w:t></w:r><w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:r><w:t>Ee</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:p>'
    );
    // The outer paragraph's own mark follows the joined text, and follows the table.
    const [first, firstMark, tableMark] = paragraphs(layout);
    expect(paragraphs(layout)).toHaveLength(3);
    expect(firstMark!.lines.flatMap((line) => line.spans)).toEqual([]);
    expect(tableMark!.lines.flatMap((line) => line.spans)).toEqual([]);
    expect(first!.lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      'AaBbCc',
    ]);
    expect(first!.alignment).toBe('center');
    expect(propsOf(layout, 'Cc')).toEqual(['b']);
    const cell = tables(layout)[0]!.rows[0]!.cells[0]!;
    const [cellParagraph] = cell.blocks;
    expect(
      cellParagraph!.kind === 'paragraph' &&
        cellParagraph!.lines.map((line) => line.spans.map((span) => span.text).join(''))
    ).toEqual(['DdEe']);
  });
});
