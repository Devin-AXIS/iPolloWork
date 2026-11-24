import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { cellAddressAt, tableAnchorAt, tableContextAt } from '../semantic-cell-selection.ts';
import { planTableCommand } from '../../editor/table-command-plan.ts';
import { TreeDocumentStore } from '@docx-editor.dev/core/store';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const geometry = { width: 612, height: 720, margin: { top: 40, bottom: 40, left: 40, right: 40 } };
const measurer = {
  measure: (text: string) => [...text].length * 5,
  lineMetrics: () => ({ height: 12, baseline: 10 }),
};
const p = (runs: string, properties = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>${properties}</w:pPr>${runs}</w:p>`;
const text = (value: string) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${value}</w:t></w:r>`;
const field = (value: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> = 1 \\* ROMAN </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  text(value) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function fixture({
  exact = true,
  fields = false,
  center = false,
  count = 42,
  fitting = false,
  unknown = false,
  borders = false,
  rowTwips = 360,
  wrap = false,
  repeat = 6,
  fixed = false,
  decoration = '',
} = {}) {
  const merged = Array.from({ length: count }, (_, index) => {
    let runs =
      text(`MERGED-LINE-${String(index + 1).padStart(2, '0')} `) +
      (fields ? field('I') : text(wrap ? 'wrapped merged content '.repeat(repeat) : 'text'));
    let properties = '';
    if (decoration === 'markers')
      runs = `<w:bookmarkStart w:id="${index}" w:name="mark${index}"/><w:proofErr w:type="spellStart"/>${runs}<w:r><w:lastRenderedPageBreak/></w:r><w:proofErr w:type="spellEnd"/><w:bookmarkEnd w:id="${index}"/>`;
    if (decoration === 'hyperlink') runs = `<w:hyperlink w:anchor="target">${runs}</w:hyperlink>`;
    if (decoration === 'revision')
      runs = `<w:ins w:id="${index}" w:author="Test">${runs}</w:ins><w:del w:id="${index + 100}" w:author="Test"><w:r><w:delText>DELETED</w:delText></w:r></w:del>`;
    if (decoration === 'tab') {
      runs += '<w:r><w:tab/></w:r>' + text('tabbed');
      properties = '<w:tabs><w:tab w:val="left" w:pos="2000"/></w:tabs>';
    }
    if (decoration === 'numbering')
      properties =
        '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr><w:keepNext w:val="0"/><w:keepLines w:val="0"/>';
    return p(runs, properties);
  }).join('');
  const prefix = fitting
    ? ''
    : '<w:p><w:pPr><w:spacing w:line="4400" w:lineRule="exact"/></w:pPr>' +
      text('Introduction') +
      '</w:p>';
  const tableProperties =
    '<w:tblPr><w:tblW w:w="10000" w:type="dxa"/>' +
    (fixed ? '<w:tblLayout w:type="fixed"/>' : '') +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="${borders ? 'single' : 'nil'}" w:sz="4"/>`)
      .join('') +
    '</w:tblBorders></w:tblPr>';
  const header =
    '<w:tr><w:trPr><w:trHeight w:val="360" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
    p(text('Header')) +
    '</w:tc></w:tr>';
  const body = Array.from(
    { length: 30 },
    (_, index) =>
      '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="' +
      rowTwips +
      '" w:hRule="' +
      (exact ? 'exact' : 'atLeast') +
      '"/></w:trPr>' +
      '<w:tc><w:tcPr><w:vMerge' +
      (index === 0 ? ' w:val="restart"' : '') +
      '/><w:vAlign w:val="' +
      (center ? 'center' : 'top') +
      '"/><w:shd w:fill="D9E2F3"/></w:tcPr>' +
      (index === 0 ? (unknown ? '<w:p><w:r><w:br/></w:r></w:p>' : '') + merged : p('')) +
      '</w:tc>' +
      '<w:tc>' +
      p(text(`ROW-${String(index + 1).padStart(2, '0')}`)) +
      '</w:tc></w:tr>'
  ).join('');
  const xml = `<w:document xmlns:w="${W}"><w:body>${prefix}<w:tbl>${tableProperties}<w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5000"/></w:tblGrid>${header}${body}</w:tbl><w:p/></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function tables(layout: SemanticLayout) {
  return layout.pages.map((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

function paragraphs(
  layout: SemanticLayout
): { page: number; rowId: string; cellId: string; block: ParagraphFragmentRecord }[] {
  const result: ReturnType<typeof paragraphs> = [];
  for (const [pageIndex, fragments] of tables(layout).entries())
    for (const table of fragments)
      for (const row of table.rows)
        for (const cell of row.cells)
          for (const block of cell.blocks) {
            if (block.kind === 'paragraph')
              result.push({ page: pageIndex + 1, rowId: row.id, cellId: cell.id, block });
          }
  return result;
}

function merged(layout: SemanticLayout) {
  return paragraphs(layout).filter(({ block }) =>
    block.lines.some((line) =>
      line.spans
        .map((span) => span.text)
        .join('')
        .startsWith('MERGED-LINE-')
    )
  );
}

function rowsByPage(layout: SemanticLayout) {
  return layout.pages.map(
    (_, index) =>
      paragraphs(layout)
        .filter((item) => item.page === index + 1)
        .flatMap(({ block }) => block.lines.flatMap((line) => line.spans.map((span) => span.text)))
        .filter((value) => value.startsWith('ROW-')).length
  );
}

describe('merged text across protected physical rows', () => {
  for (const decoration of ['markers', 'hyperlink', 'revision', 'tab', 'numbering']) {
    test(`carries native ${decoration} without removing source elements`, () => {
      const part = fixture({ exact: false, rowTwips: 370, count: 50, fixed: true, decoration });
      const before = serializeOoxmlPart(part);
      const layout = layoutSemanticDocument(part, 0, {
        geometry,
        measurer,
        displayMode: 'proposed',
      });
      const content = merged(layout);
      expect(new Set(content.map(({ block }) => block.paragraphId)).size).toBe(50);
      expect(content.some(({ page }) => page > 1)).toBe(true);
      expect(new Set(content.map(({ cellId }) => cellId)).size).toBe(1);
      expect(
        content
          .flatMap(({ block }) => block.lines.flatMap((line) => line.spans))
          .some((span) => span.text.includes('DELETED'))
      ).toBe(false);
      expect(serializeOoxmlPart(part)).toBe(before);
    });
  }
  for (const wrap of [false, true]) {
    test(`remeasures carried ${wrap ? 'wrapped' : 'one-line'} text when 18.5pt rows leave a partial line`, () => {
      const count = wrap ? 20 : 50;
      const part = fixture({ exact: false, rowTwips: 370, count, wrap, fixed: true });
      const before = serializeOoxmlPart(part);
      const layout = layoutSemanticDocument(part, 0, { geometry, measurer });
      const content = paragraphs(layout).filter(({ block }) =>
        block.lines.some((line) =>
          line.spans
            .map((span) => span.text)
            .join('')
            .startsWith('MERGED-LINE-')
        )
      );
      expect(new Set(content.map(({ block }) => block.paragraphId)).size).toBe(count);
      expect(rowsByPage(layout).reduce((sum, value) => sum + value, 0)).toBe(30);
      for (let index = 1; index <= count; index++) {
        const expected =
          `MERGED-LINE-${String(index).padStart(2, '0')} ` +
          (wrap ? 'wrapped merged content '.repeat(6) : 'text');
        const start = content.find(({ block }) =>
          block.lines.some((line) =>
            line.spans
              .map((span) => span.text)
              .join('')
              .startsWith(`MERGED-LINE-${String(index).padStart(2, '0')}`)
          )
        );
        expect(start).toBeDefined();
        const actual = paragraphs(layout)
          .filter(({ block }) => block.paragraphId === start!.block.paragraphId)
          .flatMap(({ block }) =>
            block.lines.flatMap((line) => line.spans.map((span) => span.text))
          )
          .join('');
        expect(actual).toBe(expected);
      }
      expect(serializeOoxmlPart(part)).toBe(before);
      const reopened = readOoxmlPart(before, {
        name: '/word/document.xml',
        contentType: 'application/xml',
      });
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(layoutSemanticDocument(reopened.part, 0, { geometry, measurer })).toEqual(layout);
    });
  }
  test('rechecks wrapped remainder at each page height', () => {
    for (const repeat of [5, 7, 8, 9]) {
      const part = fixture({
        exact: false,
        rowTwips: 370,
        count: 20,
        wrap: true,
        repeat,
        fixed: true,
      });
      for (const height of [710, 725]) {
        const layout = layoutSemanticDocument(part, 0, {
          geometry: { ...geometry, height },
          measurer,
        });
        const content = paragraphs(layout);
        const ids = new Set(
          content
            .filter(({ block }) =>
              block.lines.some((line) =>
                line.spans
                  .map((span) => span.text)
                  .join('')
                  .startsWith('MERGED-LINE-')
              )
            )
            .map(({ block }) => block.paragraphId)
        );
        expect(ids.size).toBe(20);
        for (const id of ids) {
          const actual = content
            .filter(({ block }) => block.paragraphId === id)
            .flatMap(({ block }) =>
              block.lines.flatMap((line) => line.spans.map((span) => span.text))
            )
            .join('');
          expect(actual.endsWith('wrapped merged content '.repeat(repeat))).toBe(true);
        }
      }
    }
  });
  test('typing into a merged cell grows the remaining non-exact row after the page cut', () => {
    const store = new TreeDocumentStore(
      fixture({ exact: false, rowTwips: 370, count: 20, fixed: true })
    );
    const before = layoutSemanticDocument(store.part, store.revision, { geometry, measurer });
    const target = merged(before).at(-1)!.block.paragraphId;
    const inserted = ' typed merged content'.repeat(70);
    const result = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId: target, offset: 19, text: inserted })
    );
    expect(result.ok).toBe(true);
    const layout = layoutSemanticDocument(store.part, store.revision, { geometry, measurer });
    const actual = paragraphs(layout)
      .filter(({ block }) => block.paragraphId === target)
      .flatMap(({ block }) => block.lines.flatMap((line) => line.spans.map((span) => span.text)))
      .join('');
    expect(actual).toBe('MERGED-LINE-20 text' + inserted);
    expect(rowsByPage(layout).reduce((sum, value) => sum + value, 0)).toBe(30);
  });
  for (const count of [98, 99, 120])
    for (const fields of [false, true])
      test(`a grown final row carries all ${count} ${fields ? 'fields' : 'paragraphs'} when page cuts exceed a fresh page`, () => {
        const part = fixture({ exact: false, rowTwips: 370, count, fixed: true, fields });
        const before = serializeOoxmlPart(part);
        const layout = layoutSemanticDocument(part, 0, { geometry, measurer });
        const content = merged(layout);
        expect(content).toHaveLength(count);
        expect(new Set(content.map(({ block }) => block.paragraphId)).size).toBe(count);
        expect(rowsByPage(layout).reduce((sum, value) => sum + value, 0)).toBe(30);
        // The last row holds the remaining merged text and is taller than a
        // page, so it starts on a fresh page and splits from there.
        expect(rowsByPage(layout)).toEqual([21, 8, 1, ...Array(layout.pages.length - 3).fill(0)]);
        expect(new Set(content.map(({ cellId }) => cellId)).size).toBe(1);
        expect(new Set(content.map(({ rowId }) => rowId)).size).toBe(1);
        for (const { page, block } of content) {
          expect(block.box.y + block.box.height).toBeLessThanOrEqual(640.001);
          expect(caretAt(layout, { paragraphId: block.paragraphId, offset: 0 })?.pageIndex).toBe(
            page - 1
          );
          if (fields) {
            const atom = block.lines.flatMap((line) => line.spans).find((span) => span.fieldAtom)!;
            expect(atom.range.end - atom.range.start).toBe(1);
          }
        }
        expect(serializeOoxmlPart(part)).toBe(before);
        const reopened = readOoxmlPart(before, {
          name: '/word/document.xml',
          contentType: 'application/xml',
        });
        if (!reopened.ok) throw new Error(reopened.reason);
        expect(layoutSemanticDocument(reopened.part, 0, { geometry, measurer })).toEqual(layout);
      });

  test('a nonbreaking grown final row that fits a fresh page moves whole', () => {
    // Rows 22-29 hold 12 lines on page 2. The 44 remaining lines (528pt) need
    // more than the 492pt left below them but fit on an empty page.
    const part = fixture({ exact: false, rowTwips: 370, count: 88, fixed: true });
    const layout = layoutSemanticDocument(part, 0, { geometry, measurer });
    const content = merged(layout);
    expect(content).toHaveLength(88);
    expect(rowsByPage(layout)).toEqual([21, 8, 1]);
    const last = tables(layout).map((fragments) =>
      fragments
        .flatMap((table) => table.rows)
        .filter((row) =>
          row.cells.some((cell) =>
            cell.blocks.some(
              (block) =>
                block.kind === 'paragraph' &&
                block.lines.some(
                  (line) => line.spans.map((span) => span.text).join('') === 'ROW-30'
                )
            )
          )
        )
    );
    expect(last.map((rows) => rows.length)).toEqual([0, 0, 1]);
    expect(last[2]![0]!.hasContinuation ?? false).toBe(false);
    const final = content.filter(({ page }) => page === 3);
    expect(final).toHaveLength(44);
    expect(final[0]!.block.lines[0]!.spans.map((span) => span.text).join('')).toStartWith(
      'MERGED-LINE-45'
    );
  });

  test('exact spans that lose a partial line at the page cut still lay out', () => {
    // 46 lines (552pt) fit the unbroken 555pt span. The page cut after row 21
    // leaves 4.5pt unused, so one line no longer fits the fixed-height rows.
    const part = fixture({ exact: true, rowTwips: 370, count: 46, fixed: true });
    const before = serializeOoxmlPart(part);
    const layout = layoutSemanticDocument(part, 0, { geometry, measurer });
    expect(rowsByPage(layout)).toEqual([21, 9]);
    const content = merged(layout);
    expect(content.filter(({ page }) => page === 1)).toHaveLength(32);
    expect(content.length).toBeGreaterThanOrEqual(45);
    for (const { block } of content)
      expect(block.box.y + block.box.height).toBeLessThanOrEqual(640.001);
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('exact spans too short for the head carry it and clip at the last row', () => {
    // 50 lines (600pt) in a 555pt span of fixed rows: the text continues on the next page
    // and is clipped at the bottom of the span. Page 2 holds 166.5pt: 13 lines and the
    // top of the line the span bottom cuts.
    const part = fixture({ exact: true, rowTwips: 370, count: 50, fixed: true });
    const before = serializeOoxmlPart(part);
    const layout = layoutSemanticDocument(part, 0, { geometry, measurer });
    expect(rowsByPage(layout)).toEqual([21, 9]);
    const content = merged(layout);
    expect(content.filter(({ page }) => page === 1)).toHaveLength(32);
    expect(content.filter(({ page, block }) => page === 1 && block.clipToBox)).toHaveLength(0);
    const tail = content.filter(({ page }) => page === 2);
    const first = tail[0]!.block.lines[0]!.spans.map((span) => span.text).join('');
    expect(first.startsWith('MERGED-LINE-33 ')).toBe(true);
    expect(tail).toHaveLength(14);
    const spanBottom = tables(layout)[1]!.at(-1)!.rows.at(-1)!;
    const last = tail.at(-1)!.block;
    expect(last.clipToBox).toBe(true);
    expect(last.box.y + last.box.height).toBeCloseTo(spanBottom.box.y + spanBottom.box.height, 3);
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('all-markup carries inserted and deleted text through the native revision projection', () => {
    const layout = layoutSemanticDocument(
      fixture({ exact: false, rowTwips: 370, count: 50, fixed: true, decoration: 'revision' }),
      0,
      {
        geometry,
        measurer,
        displayMode: 'all-markup',
      }
    );
    expect(merged(layout)).toHaveLength(50);
    expect(
      merged(layout).every(({ block }) =>
        block.lines.flatMap((line) => line.spans).some((span) => span.text === 'DELETED')
      )
    ).toBe(true);
  });
  for (const exact of [true, false])
    for (const fields of [true, false]) {
      test(`${exact ? 'exact' : 'atLeast'} rows carry every ${fields ? 'field' : 'paragraph'} without changing the tree`, () => {
        const part = fixture({ exact, fields });
        const before = serializeOoxmlPart(part);
        const layout = layoutSemanticDocument(part, 0, { geometry, measurer });
        const content = merged(layout);
        expect(rowsByPage(layout)).toEqual([22, 8]);
        expect(content).toHaveLength(42);
        expect(new Set(content.map((item) => item.block.paragraphId)).size).toBe(42);
        expect(content.filter((item) => item.page === 1)).toHaveLength(33);
        expect(content.filter((item) => item.page === 2)).toHaveLength(9);
        expect(new Set(content.map((item) => item.cellId)).size).toBe(1);
        expect(new Set(content.map((item) => item.rowId)).size).toBe(1);
        for (const { page, block } of content) {
          const cursor = caretAt(layout, { paragraphId: block.paragraphId, offset: 0 });
          expect(cursor?.pageIndex).toBe(page - 1);
          expect(block.box.y).toBeGreaterThanOrEqual(0);
          expect(block.box.y + block.box.height).toBeLessThanOrEqual(640.001);
          const atom = block.lines.flatMap((line) => line.spans).find((span) => span.fieldAtom);
          if (fields) {
            expect(atom?.range.end! - atom?.range.start!).toBe(1);
            expect(atom?.projected).toBe(true);
            expect(atom?.fieldAtom?.formField).toBe(false);
            const beforeAtom = caretAt(
              layout,
              { paragraphId: block.paragraphId, offset: atom!.range.start },
              measurer
            );
            const afterAtom = caretAt(
              layout,
              { paragraphId: block.paragraphId, offset: atom!.range.end },
              measurer
            );
            expect(beforeAtom?.pageIndex).toBe(page - 1);
            expect(afterAtom?.pageIndex).toBe(page - 1);
            expect(afterAtom!.x - beforeAtom!.x).toBeCloseTo(atom!.box.width, 4);
          }
        }
        expect(serializeOoxmlPart(part)).toBe(before);
        const reopened = readOoxmlPart(before, {
          name: '/word/document.xml',
          contentType: 'application/xml',
        });
        if (!reopened.ok) throw new Error(reopened.reason);
        expect(layoutSemanticDocument(reopened.part, 0, { geometry, measurer })).toEqual(layout);
      });
    }

  test('centers short content within the current fragment and keeps shading on both pages', () => {
    const layout = layoutSemanticDocument(fixture({ center: true, count: 1 }), 0, {
      geometry,
      measurer,
    });
    const content = merged(layout);
    expect(content).toHaveLength(1);
    const fragment = tables(layout)[0]![0]!;
    const row = fragment.rows.find((row) =>
      row.cells.some((cell) => cell.id === content[0]!.cellId)
    )!;
    const cell = row.cells.find((cell) => cell.id === content[0]!.cellId)!;
    expect(content[0]!.block.box.y - cell.box.y).toBeCloseTo((cell.box.height - 12) / 2, 4);
    for (const fragments of tables(layout)) {
      const head = fragments[0]!.rows
        .flatMap((row) => row.cells)
        .find((cell) => cell.id === content[0]!.cellId)!;
      expect(head.shading).toBe('D9E2F3');
      expect(head.paintInert).toBe(false);
      expect(head.box.height).toBeGreaterThan(0);
    }
  });

  test('keeps the ordinary whole-span layout when every row fits this page', () => {
    const layout = layoutSemanticDocument(
      fixture({ fitting: true, center: true, fields: true }),
      0,
      { geometry, measurer }
    );
    expect(rowsByPage(layout)).toEqual([30]);
    expect(merged(layout)).toHaveLength(42);
    expect(
      tables(layout)[0]![0]!.rows.some((row) => row.isContinuation && row.box.height === 0)
    ).toBe(false);
  });

  test('leaves manual-break content on the existing conservative path', () => {
    const layout = layoutSemanticDocument(fixture({ unknown: true }), 0, { geometry, measurer });
    expect(
      tables(layout)
        .flat()
        .flatMap((table) => table.rows)
        .some((row) => row.isContinuation && row.box.height === 0)
    ).toBe(false);
  });

  test('paints the carried head rules without an extra zero-height bottom rule', () => {
    const layout = layoutSemanticDocument(fixture({ borders: true, center: true }), 0, {
      geometry,
      measurer,
    });
    expect(merged(layout)).toHaveLength(42);
    const carried = tables(layout)[1]![0]!.rows[0]!;
    expect(carried.isContinuation).toBe(true);
    expect(carried.box.height).toBe(0);
    const head = carried.cells.find((cell) => cell.blocks.length > 0)!;
    expect(head.id).toBe(merged(layout)[0]!.cellId);
    expect(head.box.height).toBeGreaterThan(0);
    expect(head.borders?.edgeSegments?.some((edge) => edge.side === 'left')).toBe(true);
    for (const cell of carried.cells.filter((cell) => cell.box.height === 0)) {
      expect(cell.borders?.edgeSegments?.some((edge) => edge.side === 'bottom') ?? false).toBe(
        false
      );
    }
  });

  test('commands and selections in later text retain the authored head address', () => {
    const part = fixture({ fields: true });
    const layout = layoutSemanticDocument(part, 0, { geometry, measurer });
    const head = merged(layout)[0]!;
    const tail = merged(layout).at(-1)!;
    expect(tail.page).toBe(2);
    expect(tableAnchorAt(layout, tail.block.paragraphId)).toMatchObject({
      rowId: head.rowId,
      cellId: head.cellId,
    });
    expect(tableContextAt(layout, tail.block.paragraphId)?.rowIndex).toBe(1);
    expect(cellAddressAt(layout, tail.block.paragraphId)).toMatchObject({
      rowId: head.rowId,
      cellId: head.cellId,
      rowIndex: 1,
    });
    const at = { paragraphId: tail.block.paragraphId, offset: 0 };
    const plan = planTableCommand({
      command: { type: 'insertRow', where: 'above' },
      part,
      layout,
      storeRevision: layout.revision,
      selection: { anchor: at, head: at },
      cellSelection: null,
      themeColors: [],
      editable: true,
      viewing: false,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.ops[0]).toMatchObject({ op: 'insertTableRow', rowId: head.rowId });
  });
});

test.each([40, 160])('carried tails retain cell-spacing inset (%s)', (spacing) => {
  const raw = serializeOoxmlPart(fixture({ exact: false, count: 100, fixed: true })).replace(
    '<w:tblPr>',
    `<w:tblPr><w:tblCellSpacing w:w="${spacing}" w:type="dxa"/>`
  );
  const parsed = readOoxmlPart(raw, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, { geometry, measurer });
  for (const pages of tables(result))
    for (const table of pages)
      for (const row of table.rows) {
        for (const cell of row.cells) {
          if (cell.rowSpan > 1 || row.box.height === 0) continue;
          expect(cell.box.y + cell.box.height).toBeLessThanOrEqual(
            row.box.y + row.box.height + 0.001
          );
        }
      }
});
