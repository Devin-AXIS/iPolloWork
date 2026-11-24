// Word's default cell metrics: the default table style, the fallback beneath it, and the
// empty paragraph a cell must end with when its content ends with a table.
//
// A `w:tbl` that states no `w:tblStyle` is not unstyled. Word applies
// `w:style[@w:type='table'][@w:default='1']`, which in a Word-authored styles.xml is
// `TableNormal` and states 0 top, 0 bottom, 108 twips left and right. Charging 3 pt on all
// four sides instead makes every row of every such table 6 pt taller than Word's, and the
// error compounds down the table until it paginates a page early.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, readTableStructure } from '../index.ts';
import { cascadeTableFormatting } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { caretAt, documentOrder } from '../semantic-interaction.ts';
import { hitTestFragments, hitTestPage } from '../semantic-hit-test.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** `TableNormal` exactly as Word writes it, plus a named style based on it. */
const WORD_STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="TableNormal" w:default="1">' +
  '<w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>' +
  '<w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr></w:style>' +
  '<w:style w:type="table" w:styleId="Roomy"><w:name w:val="Roomy"/>' +
  '<w:basedOn w:val="TableNormal"/><w:tblPr><w:tblCellMar>' +
  '<w:top w:w="200" w:type="dxa"/><w:bottom w:w="200" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

/** The same part with no default table style at all. */
const NO_DEFAULT_STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="Roomy"><w:name w:val="Roomy"/><w:tblPr><w:tblCellMar>' +
  '<w:top w:w="200" w:type="dxa"/><w:bottom w:w="200" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

function tableOf(bodyXml: string): OoxmlElement {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    '/word/document.xml'
  );
  const found = document.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  return found as OoxmlElement;
}

const ONE_CELL_TABLE = (tblPr = '') =>
  `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tr>` +
  '<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
  '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

const marginsOf = (table: OoxmlElement, styles?: OoxmlPart) =>
  readTableStructure(table, 468, 0, styles ? buildStyleCascadeTable(styles.root) : undefined)!
    .rows[0]!.cells[0]!.margins;

describe("a table with no w:tblStyle takes the document's default table style", () => {
  test('TableNormal supplies 0 top and bottom, 108 twips left and right', () => {
    const margins = marginsOf(tableOf(ONE_CELL_TABLE()), part(WORD_STYLES, '/word/styles.xml'));
    expect(margins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
  });

  test('a named style still wins, and inherits the default through w:basedOn', () => {
    const margins = marginsOf(
      tableOf(ONE_CELL_TABLE('<w:tblStyle w:val="Roomy"/>')),
      part(WORD_STYLES, '/word/styles.xml')
    );
    // `Roomy` states only top and bottom; left and right come from `TableNormal`.
    expect(margins).toEqual({ top: 10, right: 5.4, bottom: 10, left: 5.4 });
  });

  test("the table's own w:tblCellMar still overrides the default style", () => {
    const margins = marginsOf(
      tableOf(
        ONE_CELL_TABLE(
          '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>'
        )
      ),
      part(WORD_STYLES, '/word/styles.xml')
    );
    expect(margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test('a w:tblStyle naming a style nobody defines falls to the default too', () => {
    // Word resolves an unknown style reference to the default table style. Returning
    // nothing instead costs such a table the borders, conditional formats and cell margins
    // `TableNormal` supplies.
    const margins = marginsOf(
      tableOf(ONE_CELL_TABLE('<w:tblStyle w:val="NoSuchStyle"/>')),
      part(WORD_STYLES, '/word/styles.xml')
    );
    expect(margins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
  });

  test('two tables naming one style share the resolved chain', () => {
    // The chain is flattened once per (cascade, style id): every table in a document asks
    // the same question, and allocating five containers per table showed up as GC.
    const cascade = buildStyleCascadeTable(part(WORD_STYLES, '/word/styles.xml').root);
    const first = readTableStructure(tableOf(ONE_CELL_TABLE()), 468, 0, cascade)!;
    const second = readTableStructure(
      tableOf(ONE_CELL_TABLE('<w:tblStyle w:val="Roomy"/>')),
      468,
      0,
      cascade
    )!;
    expect(cascadeTableFormatting(cascade, undefined)).toBe(
      cascadeTableFormatting(cascade, 'AlsoUndefined')
    );
    expect(first.defaultMargins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
    expect(second.defaultMargins).toEqual({ top: 10, right: 5.4, bottom: 10, left: 5.4 });
  });

  test('a styles part with no default table style uses the omitted-margin fallback', () => {
    const margins = marginsOf(
      tableOf(ONE_CELL_TABLE()),
      part(NO_DEFAULT_STYLES, '/word/styles.xml')
    );
    expect(margins).toEqual({ top: 0, right: 0.5, bottom: 0, left: 0.5 });
  });

  test('no styles part at all uses the omitted-margin fallback', () => {
    expect(marginsOf(tableOf(ONE_CELL_TABLE()))).toEqual({
      top: 0,
      right: 0.5,
      bottom: 0,
      left: 0.5,
    });
  });
});

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A cell holding a paragraph, a nested table, and the `w:p` §17.4.66 makes it end with. */
const cellWithNestedTable = (terminator: string) =>
  '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
  p('AAA') +
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
  p('BBB') +
  '</w:tc></w:tr></w:tbl>' +
  terminator +
  '</w:tc></w:tr></w:tbl>';

const measurer = createFixedMeasurer();

function layoutOf(bodyXml: string): SemanticLayout {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    '/word/document.xml'
  );
  return layoutSemanticDocument(document, 0, { measurer });
}

function outerRowHeight(layout: SemanticLayout): number {
  const fragment = layout.pages[0]!.fragments.find(
    (record): record is TableFragmentRecord => record.kind === 'table'
  )!;
  return fragment.rows[0]!.box.height;
}

describe('the empty paragraph a nested table forces at the end of a cell', () => {
  test('costs the row nothing', () => {
    const withTerminator = outerRowHeight(layoutOf(cellWithNestedTable('<w:p/>')));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    expect(withTerminator).toBeCloseTo(withNone, 6);
  });

  test('a terminator with content keeps its full line', () => {
    const withText = outerRowHeight(layoutOf(cellWithNestedTable(p('CCC'))));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    // The fixed measurer's line box at the default 10 pt size.
    expect(withText - withNone).toBeCloseTo(14 * (10 / 11), 6);
  });

  test('an empty paragraph that does NOT follow a table keeps its line', () => {
    const plain =
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      p('AAA') +
      '<w:p/>' +
      '</w:tc></w:tr></w:tbl>';
    const one =
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      p('AAA') +
      '</w:tc></w:tr></w:tbl>';
    expect(outerRowHeight(layoutOf(plain)) - outerRowHeight(layoutOf(one))).toBeCloseTo(
      14 * (10 / 11),
      6
    );
  });

  test('a w:pBdr on the terminator costs the row nothing either', () => {
    // The fit test charges the border zero, so placement has to as well: charging it here
    // grew the row past the height the caller already sized, and past `maxBottom` on the
    // last row of a page.
    const bordered =
      '<w:p><w:pPr><w:pBdr>' +
      '<w:top w:val="single" w:sz="24" w:space="6"/>' +
      '<w:bottom w:val="single" w:sz="24" w:space="6"/>' +
      '</w:pBdr></w:pPr></w:p>';
    const withBorder = outerRowHeight(layoutOf(cellWithNestedTable(bordered)));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    expect(withBorder).toBeCloseTo(withNone, 6);
  });

  test('its published line box is zero-height, so nothing paints below the row', () => {
    // `caretBoxOnLine`, the selection bands and `paragraphShadingBox` all read this box. A
    // line that kept its height while the cell stopped at `y` drew a full line of caret and
    // highlight below the row.
    const layout = layoutOf(cellWithNestedTable('<w:p/>'));
    const fragment = layout.pages[0]!.fragments.find(
      (record): record is TableFragmentRecord => record.kind === 'table'
    )!;
    const cell = fragment.rows[0]!.cells[0]!;
    const paragraphs = cell.blocks.filter((block) => block.kind === 'paragraph');
    const terminator = paragraphs[paragraphs.length - 1]!;
    if (terminator.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    expect(terminator.box.height).toBe(0);
    for (const line of terminator.lines) expect(line.box.height).toBe(0);
    const rowBottom = fragment.rows[0]!.box.y + fragment.rows[0]!.box.height;
    for (const line of terminator.lines) {
      expect(line.box.y + line.box.height).toBeLessThanOrEqual(rowBottom + 0.001);
    }
  });

  test('typing into it makes it an ordinary paragraph again', () => {
    // The zero box is what Word draws, and it is not a trap: the moment the paragraph holds
    // anything it stops being a terminator and takes its full line back.
    const withText = outerRowHeight(layoutOf(cellWithNestedTable(p('x'))));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    expect(withText).toBeGreaterThan(withNone);
  });

  test('the caret in it is visible, inside the row, and reachable by pointer', () => {
    // Zero flow height is Word's geometry, but a zero-height CARET is not a caret: the
    // engine suppresses the native one for as long as it paints its own, so the user would
    // type blind. The caret falls back to the ascent the line was measured at.
    //
    // POSITION, not just existence. The line sits on the cell's content bottom, so a caret
    // grown downward from it lands wholly outside the row and over the block after the
    // table. It is drawn ending at the collapse point instead.
    const layout = layoutOf(cellWithNestedTable('<w:p/>') + p('NEXT BLOCK'));
    const order = documentOrder(layout);
    const terminator = order.find((id) => id.endsWith('.3'))!;
    const fragment = layout.pages[0]!.fragments.find(
      (record): record is TableFragmentRecord => record.kind === 'table'
    )!;
    const rowBottom = fragment.rows[0]!.box.y + fragment.rows[0]!.box.height;
    const paragraphs = fragment.rows[0]!.cells[0]!.blocks.filter(
      (block) => block.kind === 'paragraph'
    );
    const last = paragraphs[paragraphs.length - 1]!;
    if (last.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    const caret = caretAt(layout, { paragraphId: terminator, offset: 0 }, { measurer });
    expect(caret).not.toBeNull();
    expect(caret!.height).toBeGreaterThan(0);
    // The published ascent is the fallback, and the caret ends ON the collapse point. A
    // `rowTop` lower bound would be no assertion here: the row starts at 0 in this fixture,
    // so anything passes. The case where the ascent overruns the band is its own test.
    expect(caret!.height).toBeCloseTo(last.lines[0]!.baseline, 6);
    expect(caret!.y + caret!.height).toBeCloseTo(rowBottom, 6);

    // Horizontally it follows the terminator's OWN indent and alignment, which is where the
    // text a keystroke produces would appear — not a fixed offset. `w:ind` and `w:jc` both
    // live in `w:pPr`, which the terminator test admits, so a centred or indented one puts
    // the caret over the preceding table's text; that is correct, and the invariant that
    // matters is the vertical containment.
    expect(caret!.x).toBeCloseTo(last.lines[0]!.contentX, 6);
  });

  test('a terminator whose MARK carries a tracked revision keeps its line', () => {
    // All Markup strikes a pilcrow for the mark and draws a change bar, both sized off the
    // line box. On a zero-height fragment the pilcrow lands outside the row and the bar
    // vanishes, so a tracked delete of that mark is invisible or misplaced.
    //
    // Only in All Markup, because that is the only view that publishes them: the resolved
    // view shows Word's accept-all output, where the terminator is an ordinary empty
    // paragraph after a table and takes no height at all.
    const del =
      '<w:p><w:pPr><w:rPr>' +
      '<w:del w:id="7" w:author="A" w:date="2024-01-01T00:00:00Z"/>' +
      '</w:rPr></w:pPr></w:p>';
    for (const [displayMode, expected] of [
      ['all-markup', 14 * (10 / 11)],
      ['resolved', 0],
    ] as const) {
      const layout = layoutSemanticDocument(
        part(
          `<w:document xmlns:w="${W}"><w:body>${cellWithNestedTable(del)}</w:body></w:document>`,
          '/word/document.xml'
        ),
        0,
        { measurer, displayMode }
      );
      const fragment = layout.pages[0]!.fragments.find(
        (record): record is TableFragmentRecord => record.kind === 'table'
      )!;
      const paragraphs = fragment.rows[0]!.cells[0]!.blocks.filter(
        (block) => block.kind === 'paragraph'
      );
      const last = paragraphs[paragraphs.length - 1]!;
      if (last.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
      expect(last.box.height).toBeCloseTo(expected, 6);
    }
  });

  test('a preceding table that emitted NOTHING does not license the collapse', () => {
    // `w:tbl` with no `w:tr` is schema-valid (`EG_ContentRowContent` is minOccurs=0) and
    // `emitNestedTable` returns null for it, as it does past the nesting ceiling. Collapsing
    // behind it left the row with no content and no terminator — a hairline.
    const rowless = '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr></w:tbl>';
    const cellOf = (content: string) =>
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      content +
      '</w:tc></w:tr></w:tbl>';
    expect(outerRowHeight(layoutOf(cellOf(rowless + '<w:p/>')))).toBeCloseTo(
      outerRowHeight(layoutOf(cellOf('<w:p/>'))),
      6
    );
  });

  test('the caret is clamped into the cell, however tall the paragraph MARK is', () => {
    // The caret is sized off the line's published `baseline`, and that ascent comes from the
    // terminator's own `w:pPr/w:rPr` — nothing to do with the rows above it. A 36pt mark over
    // a 6pt nested row, or any cell shorter than its own ascent, drew a caret that started
    // above the page content box and painted through whatever was there.
    const small =
      '<w:p><w:pPr><w:rPr><w:sz w:val="12"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="12"/></w:rPr><w:t>b</w:t></w:r></w:p>';
    const nested = (row: string) =>
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      row +
      '</w:tbl>';
    const outer = (content: string) =>
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      content +
      '</w:tc></w:tr></w:tbl>';
    const plainRow =
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' + small + '</w:tc></w:tr>';
    const exactRow =
      '<w:tr><w:trPr><w:trHeight w:val="40" w:hRule="exact"/></w:trPr>' +
      '<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
      small +
      '</w:tc></w:tr>';
    const cases = [
      // A 36pt paragraph mark over a 6pt nested row, with a body paragraph above the table.
      p('ABOVE') +
        outer(nested(plainRow) + '<w:p><w:pPr><w:rPr><w:sz w:val="72"/></w:rPr></w:pPr></w:p>'),
      // An exact 2pt nested row with the table first on the page: no band at all to speak of.
      outer(nested(exactRow) + '<w:p/>'),
    ];
    for (const body of cases) {
      const layout = layoutOf(body);
      const fragment = layout.pages[0]!.fragments.find(
        (record): record is TableFragmentRecord => record.kind === 'table'
      )!;
      const rowTop = fragment.rows[0]!.box.y;
      const rowBottom = rowTop + fragment.rows[0]!.box.height;
      // The cell's terminator; the body's own empty paragraph after the table comes last.
      const order = documentOrder(layout);
      const caret = caretAt(
        layout,
        { paragraphId: order[order.length - 2]!, offset: 0 },
        { measurer }
      )!;
      expect(caret.y).toBeGreaterThanOrEqual(rowTop - 0.001);
      expect(caret.y + caret.height).toBeLessThanOrEqual(rowBottom + 0.001);
      expect(caret.y).toBeGreaterThanOrEqual(0);
    }
  });

  test('a press lands in it beside the nested table, and in the table under it', () => {
    // The CONTRAST is the claim. Asserting only that some point resolves to the terminator
    // proves nothing: the nearest-block walk hands it back for almost any point, including
    // ones past the page content bottom, and for the non-collapsed variant too. What is
    // actually true is that the nested table owns the band under its own column and the
    // terminator owns the rest of the cell — so both halves are pinned at one y.
    const layout = layoutOf(cellWithNestedTable('<w:p/>'));
    // The body's own empty paragraph after the table comes last in document order. The points
    // sit below the table, so the walk runs over the table alone, as in a header that ends
    // with it; in the body they land in that paragraph.
    const order = documentOrder(layout);
    const terminator = order[order.length - 2]!;
    const nestedParagraph = order[order.length - 3]!;
    const page = layout.pages[0]!;
    const table = page.fragments.filter((fragment) => fragment.kind === 'table');
    const at = (x: number, y: number) =>
      hitTestFragments(
        layout,
        0,
        table,
        { x: page.contentBox.x + x, y: page.contentBox.y + y },
        { measurer }
      )?.position?.paragraphId;
    expect(
      hitTestPage(layout, 0, { x: 10, y: page.contentBox.y + 20 }, { measurer })?.position
        ?.paragraphId
    ).toBe(order.at(-1));
    expect(at(10, 20)).toBe(nestedParagraph);
    expect(at(240, 20)).toBe(terminator);
  });

  test('a NUMBERED terminator is not one: its marker is content, so it keeps its line', () => {
    // `w:pPr` is where `w:numPr` lives, so the structural emptiness test alone calls a
    // numbered paragraph empty — and `publishListMarker` then hands paint a marker on a
    // zero-height line, which paint centres half a line above its own row. Suppressing the
    // marker would hide something the author asked for; the honest answer is that a
    // paragraph carrying a list marker is not the terminator Word writes.
    const numbering =
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">' +
      '<w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
      '</w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    const numbered =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>';
    const numberingPart = part(
      `<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`,
      '/word/numbering.xml'
    );
    const index = buildNumberingIndex(numberingPart.root);
    const layoutWith = (bodyXml: string) =>
      layoutSemanticDocument(
        part(
          `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
          '/word/document.xml'
        ),
        0,
        { measurer, numberingIndex: index }
      );
    const rowHeight = (bodyXml: string) =>
      layoutWith(bodyXml).pages[0]!.fragments.find(
        (record): record is TableFragmentRecord => record.kind === 'table'
      )!.rows[0]!.box.height;

    const withNumbered = rowHeight(cellWithNestedTable(numbered));
    const withNone = rowHeight(cellWithNestedTable(''));
    // It keeps a full line, exactly like a terminator carrying text.
    expect(withNumbered - withNone).toBeCloseTo(14 * (10 / 11), 6);
    // And the marker it publishes has a line box to sit on.
    const fragment = layoutWith(cellWithNestedTable(numbered)).pages[0]!.fragments.find(
      (record): record is TableFragmentRecord => record.kind === 'table'
    )!;
    const paragraphs = fragment.rows[0]!.cells[0]!.blocks.filter(
      (block) => block.kind === 'paragraph'
    );
    const last = paragraphs[paragraphs.length - 1]!;
    if (last.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    expect(last.marker).toBeDefined();
    expect(last.marker!.box.height).toBeGreaterThan(0);
  });

  test('it stays addressable, so the caret and select-all still reach it', () => {
    const layout = layoutOf(cellWithNestedTable('<w:p/>'));
    const order = documentOrder(layout);
    const withNone = documentOrder(layoutOf(cellWithNestedTable('')));
    expect(order).toHaveLength(withNone.length + 1);
  });
});

test('omitted margins differ from authored TableNormal margins across compatibility modes', () => {
  const table = tableOf(ONE_CELL_TABLE());
  const source = part(WORD_STYLES, '/word/styles.xml');
  const cascade = buildStyleCascadeTable(source.root);
  for (const mode of [undefined, 11, 12, 14, 15]) {
    const read = (styles?: typeof cascade) =>
      readTableStructure(table, 468, 0, styles, 'all-markup', undefined, mode)!;
    expect(read().defaultMargins).toEqual({ top: 0, right: 0.5, bottom: 0, left: 0.5 });
    expect(read(cascade).defaultMargins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
    expect(read().defaultMargins).toEqual({ top: 0, right: 0.5, bottom: 0, left: 0.5 });
  }
});

test('omitted margins fall back per side and explicit zero overrides them across modes', () => {
  const source = tableOf(
    ONE_CELL_TABLE('<w:tblCellMar><w:left w:w="0" w:type="dxa"/></w:tblCellMar>').replace(
      '</w:tcPr>',
      '<w:tcMar><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr>'
    )
  );
  for (const mode of [undefined, 11, 12, 14, 15]) {
    const resolved = readTableStructure(source, 468, 0, undefined, 'all-markup', undefined, mode)!;
    expect(resolved.defaultMargins).toEqual({ top: 0, right: 0.5, bottom: 0, left: 0 });
    expect(resolved.rows[0]!.cells[0]!.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  }
});
