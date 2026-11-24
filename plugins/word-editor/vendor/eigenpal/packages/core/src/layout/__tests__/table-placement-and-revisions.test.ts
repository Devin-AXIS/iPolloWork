// Where a table sits in the text column (`w:tblInd` 17.4.50, `w:jc` 17.4.29,
// `w:tblCellSpacing` 17.4.45), and which paragraphs a tracked revision removes from it.
//
// A `w:del` on the paragraph MARK (17.13.5.15) joins a paragraph to the next one. When the
// paragraph's content is deleted too, nothing survives the join and Word shows no line —
// but layout still measured a full line box for it, because deleted runs contribute no
// spans and an empty paragraph is still a paragraph.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';
import { revisionRemovesParagraph } from '../revision-visibility.ts';
import { revisionAuthorFilter } from '../revision-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REV = 'w:id="1" w:author="a" w:date="2020-01-01T00:00:00Z"';

function part(xml: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const documentOf = (bodyXml: string) =>
  part(`<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`);

function tableNode(bodyXml: string): OoxmlElement {
  const found = documentOf(bodyXml)
    .root.children.flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  if (!found) throw new Error('no table');
  return found as OoxmlElement;
}

const CONTENT_WIDTH_PT = 468;
const cell = (tcPr = '') => `<w:tc>${tcPr}<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;
const grid = (...cols: number[]) =>
  `<w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
/** 144pt wide, leaving 324pt of slack in the text column. */
const sized = '<w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr><w:p/></w:tc>';
const narrow = `${grid(1440, 1440)}<w:tr>${sized}${sized}</w:tr>`;

const structureOf = (bodyXml: string) =>
  readTableStructure(tableNode(bodyXml), CONTENT_WIDTH_PT, 0)!;

function layoutBody(
  bodyXml: string,
  displayMode: 'all-markup' | 'proposed' | 'original' = 'all-markup'
) {
  return layoutSemanticDocument(documentOf(bodyXml), 0, {
    measurer: createFixedMeasurer(),
    displayMode,
  });
}

function firstTable(
  bodyXml: string,
  displayMode: 'all-markup' | 'proposed' | 'original' = 'all-markup'
): TableFragmentRecord {
  const fragment = layoutBody(bodyXml, displayMode)
    .pages.flatMap((page) => page.fragments)
    .find((item): item is TableFragmentRecord => item.kind === 'table');
  if (!fragment) throw new Error('no table fragment');
  return fragment;
}

describe('w:tblInd and w:jc place the table in the text column', () => {
  test('an absent w:jc leaves the table flush at the leading margin', () => {
    const structure = structureOf(`<w:tbl><w:tblPr/>${narrow}</w:tbl>`);
    expect(structure.alignment).toBe('left');
    expect(structure.indentPt).toBe(0);
    expect(tableOriginX(structure, CONTENT_WIDTH_PT)).toBe(0);
  });

  test('w:tblInd shifts a left-aligned table', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblInd w:w="1440" w:type="dxa"/></w:tblPr>${narrow}</w:tbl>`
    );
    expect(structure.indentPt).toBe(72);
    expect(tableOriginX(structure, CONTENT_WIDTH_PT)).toBe(72);
  });

  test('w:jc="center" centres the table in the column, ignoring the indent', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:jc w:val="center"/><w:tblInd w:w="1440" w:type="dxa"/></w:tblPr>${narrow}</w:tbl>`
    );
    expect(structure.alignment).toBe('center');
    expect(tableOriginX(structure, CONTENT_WIDTH_PT)).toBeCloseTo((468 - 144) / 2, 6);
  });

  test('w:jc="right" pushes the table to the trailing margin', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:jc w:val="right"/></w:tblPr>${narrow}</w:tbl>`
    );
    expect(tableOriginX(structure, CONTENT_WIDTH_PT)).toBeCloseTo(468 - 144, 6);
  });

  test('the strict-conformant start/end spellings are read as left/right', () => {
    expect(
      structureOf(`<w:tbl><w:tblPr><w:jc w:val="start"/></w:tblPr>${narrow}</w:tbl>`).alignment
    ).toBe('left');
    expect(
      structureOf(`<w:tbl><w:tblPr><w:jc w:val="end"/></w:tblPr>${narrow}</w:tbl>`).alignment
    ).toBe('right');
  });

  test('a wider centered table keeps its center relative to the text column', () => {
    const wide = `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr>`;
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:jc w:val="center"/><w:tblLayout w:type="fixed"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(tableOriginX(structure, CONTENT_WIDTH_PT)).toBe((CONTENT_WIDTH_PT - 720) / 2);
  });

  test('an indent wider than the slack applies in full, within its bound', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblInd w:w="20000" w:type="dxa"/></w:tblPr>${narrow}</w:tbl>`
    );
    expect(tableOriginX(structure, CONTENT_WIDTH_PT)).toBe(1000);
    const hostile = structureOf(
      `<w:tbl><w:tblPr><w:tblInd w:w="999999999" w:type="dxa"/></w:tblPr>${narrow}</w:tbl>`
    );
    expect(tableOriginX(hostile, CONTENT_WIDTH_PT)).toBe(1584);
  });

  test('placement reaches the laid-out cells and the fragment box together', () => {
    const fragment = firstTable(
      `<w:tbl><w:tblPr><w:jc w:val="center"/></w:tblPr>${narrow}</w:tbl>`
    );
    const expected = (468 - 144) / 2;
    expect(fragment.box.x).toBeCloseTo(expected, 6);
    expect(fragment.rows[0]!.cells[0]!.box.x).toBeCloseTo(expected, 6);
    // The box still describes exactly the span its cells cover.
    const right = Math.max(
      ...fragment.rows.flatMap((row) => row.cells.map((c) => c.box.x + c.box.width))
    );
    expect(fragment.box.x + fragment.box.width).toBeCloseTo(right, 6);
  });

  test('a table style can state the placement for every table that names it', () => {
    const styles =
      `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="Centred">` +
      '<w:name w:val="Centred"/><w:tblPr><w:jc w:val="center"/></w:tblPr></w:style></w:styles>';
    const structure = readTableStructure(
      tableNode(`<w:tbl><w:tblPr><w:tblStyle w:val="Centred"/></w:tblPr>${narrow}</w:tbl>`),
      CONTENT_WIDTH_PT,
      0,
      buildStyleCascadeTable(part(styles, '/word/styles.xml').root)
    )!;
    expect(structure.alignment).toBe('center');
  });
});

describe('w:tblCellSpacing separates adjacent cells', () => {
  test('cells sit twice the spacing apart and from the table edge, within its width', () => {
    const fragment = firstTable(
      `<w:tbl><w:tblPr><w:tblCellSpacing w:w="120" w:type="dxa"/></w:tblPr>${narrow}</w:tbl>`
    );
    const [first, second] = fragment.rows[0]!.cells;
    // 120tw = 6pt on each side of every cell: 12pt gaps at the three column edges. A table
    // that states no width keeps its 72pt cells and grows by the gaps (measured).
    expect(first!.box.x).toBeCloseTo(12, 6);
    expect(first!.box.width).toBeCloseTo(72, 6);
    expect(second!.box.x - (first!.box.x + first!.box.width)).toBeCloseTo(12, 6);
    expect(fragment.box.width).toBeCloseTo(144 + 36, 6);
  });

  test('spacing wider than the column still leaves a positive cell box', () => {
    const fragment = firstTable(
      `<w:tbl><w:tblPr><w:tblCellSpacing w:w="5000" w:type="dxa"/></w:tblPr>${narrow}</w:tbl>`
    );
    for (const c of fragment.rows[0]!.cells) expect(c.box.width).toBeGreaterThan(0);
  });

  test('no spacing leaves cells flush, as before', () => {
    const fragment = firstTable(`<w:tbl><w:tblPr/>${narrow}</w:tbl>`);
    const [first, second] = fragment.rows[0]!.cells;
    expect(first!.box.x).toBe(0);
    expect(second!.box.x).toBeCloseTo(first!.box.x + first!.box.width, 6);
  });
});

describe('tracked table rows respect reviewer visibility', () => {
  const trackedRow = (kind: 'ins' | 'del', author: string, text: string) =>
    `<w:tr><w:trPr><w:${kind} w:id="1" w:author="${author}"/></w:trPr>` +
    `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;

  test('a hidden deletion is removed and a hidden insertion becomes an ordinary row', () => {
    const table = tableNode(
      `<w:tbl><w:tblPr/>${grid(1440)}` +
        trackedRow('del', 'Ada', 'gone') +
        trackedRow('ins', 'Ada', 'accepted') +
        trackedRow('del', 'Grace', 'shown') +
        '</w:tbl>'
    );
    const structure = readTableStructure(
      table,
      CONTENT_WIDTH_PT,
      0,
      undefined,
      'all-markup',
      revisionAuthorFilter(['Ada'])
    )!;
    expect(structure.rows).toHaveLength(2);
    expect(structure.rows[0]!.revisionKind).toBeUndefined();
    expect(structure.rows[1]!.revisionKind).toBe('delete');
    expect(structure.rows[1]!.revisionAuthor).toBe('Grace');
  });

  test('filtered and canonical table projections keep separate cache entries', () => {
    const table = tableNode(
      `<w:tbl><w:tblPr/>${grid(1440)}` +
        trackedRow('del', 'Ada', 'gone') +
        trackedRow('ins', 'Ada', 'accepted') +
        '</w:tbl>'
    );
    const canonical = readTableStructure(table, CONTENT_WIDTH_PT, 0);
    const filter = revisionAuthorFilter(['Ada']);
    const filtered = readTableStructure(
      table,
      CONTENT_WIDTH_PT,
      0,
      undefined,
      'all-markup',
      filter
    );

    expect(readTableStructure(table, CONTENT_WIDTH_PT, 0)).toBe(canonical);
    expect(readTableStructure(table, CONTENT_WIDTH_PT, 0, undefined, 'all-markup', filter)).toBe(
      filtered
    );
  });

  test('the empty reviewer hides revisions whose row author is absent', () => {
    const row = (kind: 'ins' | 'del', text: string) =>
      `<w:tr><w:trPr><w:${kind} w:id="1"/></w:trPr>` +
      `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
    const table = tableNode(
      `<w:tbl><w:tblPr/>${grid(1440)}` + row('del', 'gone') + row('ins', 'accepted') + '</w:tbl>'
    );
    const structure = readTableStructure(
      table,
      CONTENT_WIDTH_PT,
      0,
      undefined,
      'all-markup',
      revisionAuthorFilter([''])
    )!;
    expect(structure.rows).toHaveLength(1);
    expect(structure.rows[0]!.revisionKind).toBeUndefined();
    expect(structure.rows[0]!.revisionAuthor).toBeUndefined();
  });

  test('foreign revision names and attributes do not control row visibility', () => {
    const table = tableNode(
      `<w:tbl><w:tblPr/>${grid(1440)}` +
        '<w:tr><w:trPr><x:del xmlns:x="urn:foreign" x:author="Ada"/></w:trPr>' +
        '<w:tc><w:p><w:r><w:t>ordinary</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:trPr><w:del xmlns:x="urn:foreign" x:author="Ada" w:id="2" w:author="Grace"/></w:trPr>' +
        '<w:tc><w:p><w:r><w:t>Grace deletion</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    );
    const structure = readTableStructure(
      table,
      CONTENT_WIDTH_PT,
      0,
      undefined,
      'all-markup',
      revisionAuthorFilter(['Ada'])
    )!;

    expect(structure.rows).toHaveLength(2);
    expect(structure.rows[0]!.revisionKind).toBeUndefined();
    expect(structure.rows[1]!.revisionAuthor).toBe('Grace');
  });
});

describe('a tracked revision can remove a paragraph from the rendered document', () => {
  const markDeleted = (content: string) =>
    `<w:p><w:pPr><w:rPr><w:del ${REV}/></w:rPr></w:pPr>${content}</w:p>`;
  const deletedRun = (text: string) =>
    `<w:del ${REV}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;

  test('a deleted mark over deleted content removes the paragraph', () => {
    expect(revisionRemovesParagraph(paragraphOf(markDeleted(deletedRun('gone'))))).toBe(true);
  });

  test('a deleted mark over VISIBLE content keeps it — that content is still shown', () => {
    expect(revisionRemovesParagraph(paragraphOf(markDeleted('<w:r><w:t>kept</w:t></w:r>')))).toBe(
      false
    );
  });

  test('deleted content under a SURVIVING mark keeps the empty line Word shows', () => {
    expect(revisionRemovesParagraph(paragraphOf(`<w:p>${deletedRun('gone')}</w:p>`))).toBe(false);
  });

  test('an ordinary empty paragraph is untouched', () => {
    expect(revisionRemovesParagraph(paragraphOf('<w:p/>'))).toBe(false);
  });

  test('a deleted mark over a tab or a break keeps the paragraph, since those occupy a line', () => {
    expect(revisionRemovesParagraph(paragraphOf(markDeleted('<w:r><w:tab/></w:r>')))).toBe(false);
    expect(revisionRemovesParagraph(paragraphOf(markDeleted('<w:r><w:br/></w:r>')))).toBe(false);
  });

  test('the removed paragraph claims no line box in the body flow', () => {
    // In the PROPOSED result, which is the view this suppression describes: the mark deletion
    // is accepted there, so the join actually happens. All-markup still shows the paragraph
    // with its text struck through, and the case below pins that.
    const layout = layoutBody(
      `<w:p><w:r><w:t>above</w:t></w:r></w:p>` +
        markDeleted(deletedRun('gone')) +
        `<w:p><w:r><w:t>below</w:t></w:r></w:p>`,
      'proposed'
    );
    const paragraphs = layout.pages
      .flatMap((page) => page.fragments)
      .filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph');
    expect(paragraphs).toHaveLength(2);
    const text = paragraphs.map((p) =>
      p.lines
        .flatMap((l) => l.spans)
        .map((s) => s.text)
        .join('')
    );
    expect(text).toEqual(['above', 'below']);
    // "below" sits directly under "above" — no blank line reserved between them.
    expect(paragraphs[1]!.box.y).toBeCloseTo(paragraphs[0]!.box.y + paragraphs[0]!.box.height, 6);
  });

  test('all-markup keeps the paragraph, because the struck words are still on the page', () => {
    // The suppression describes the accepted view only. A reviewer reading the markup has to
    // see what is being removed, so the paragraph renders with its text struck through.
    const layout = layoutBody(
      `<w:p><w:r><w:t>above</w:t></w:r></w:p>` +
        markDeleted(deletedRun('gone')) +
        `<w:p><w:r><w:t>below</w:t></w:r></w:p>`
    );
    const text = layout.pages
      .flatMap((page) => page.fragments)
      .filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph')
      .map((p) =>
        p.lines
          .flatMap((l) => l.spans)
          .map((s) => s.text)
          .join('')
      );
    expect(text).toEqual(['above', 'gone', 'below']);
  });

  test('a cell of removed paragraphs collapses instead of stacking blank lines', () => {
    const dead = markDeleted(deletedRun('gone')).repeat(8);
    const tall = firstTable(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}` +
        `<w:tr><w:tc>${dead}<w:p><w:r><w:t>real</w:t></w:r></w:p></w:tc>${cell()}</w:tr></w:tbl>`,
      'proposed'
    );
    const plain = firstTable(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}` +
        `<w:tr><w:tc><w:p><w:r><w:t>real</w:t></w:r></w:p></w:tc>${cell()}</w:tr></w:tbl>`,
      'proposed'
    );
    expect(tall.box.height).toBeCloseTo(plain.box.height, 6);
  });
});

function paragraphOf(paragraphXml: string): OoxmlElement {
  const found = documentOf(paragraphXml)
    .root.children.flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found as OoxmlElement;
}
