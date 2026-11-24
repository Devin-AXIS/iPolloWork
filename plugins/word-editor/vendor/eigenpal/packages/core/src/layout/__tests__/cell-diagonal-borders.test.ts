import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  buildStyleCascadeTable,
  readTableStructure,
} from '../index.ts';
import {
  readCellBorders,
  resolveTableCellBorderGrid,
  EMPTY_CELL_BORDER_BOX,
  EMPTY_TABLE_BORDER_BOX,
} from '../table-borders.ts';
import { mergeCellBorders } from '../table-border-cascade.ts';
import { cellDiagonalRecords } from '../table-cell-diagonals.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const omitted = { state: 'omitted' } as const;
const edge = (style = 'single', color: string | null = null, widthPt = 0.5) =>
  ({ state: 'edge', style, color, widthPt }) as any;
const box = (extra: any = {}) => ({ ...EMPTY_CELL_BORDER_BOX, ...extra });
function part(xml: string, name = '/word/document.xml') {
  const r = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!r.ok) throw Error(r.reason);
  return r.part;
}
function find(root: any, name: string): any {
  if (root.localName === name) return root;
  for (const c of root.children ?? []) {
    const found = find(c, name);
    if (found) return found;
  }
}
const cell = (text = 'x', properties = '', content = '') =>
  `<w:tc><w:tcPr>${properties}</w:tcPr>${content || `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`}</w:tc>`;
const borders = (xml: string) => `<w:tcBorders>${xml}</w:tcBorders>`;
const diag = borders('<w:tl2br w:val="single" w:sz="4"/>');
const table = (rows: string, pr = '') =>
  `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblLayout w:type="fixed"/>${pr}</w:tblPr><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>${rows}</w:tbl>`;
const doc = (xml: string, sect = '') =>
  part(`<w:document xmlns:w="${W}"><w:body>${xml}${sect}</w:body></w:document>`);
const lay = (xml: string, sect = '') =>
  layoutSemanticDocument(doc(xml, sect), 1, { measurer: createFixedMeasurer(6, 14) });
function tables(layout: any) {
  return layout.pages.flatMap((p: any) => p.fragments.filter((x: any) => x.kind === 'table'));
}
function grid(b: any, w = 80, h = 30) {
  return resolveTableCellBorderGrid(
    [[{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: b }]],
    EMPTY_TABLE_BORDER_BOX,
    1,
    { columnWidthsPt: [w], rowBands: [{ y: 0, height: h }], cellBoxes: [[{ width: w, height: h }]] }
  )[0]![0]!;
}
test('diagonal parser preserves both directions and validated border metadata', () => {
  const p = doc(
    table(
      '<w:tr>' +
        cell(
          'a',
          borders(
            '<w:tl2br w:val="single" w:sz="4" w:color="auto"/><w:tr2bl w:val="dashed" w:sz="8" w:color="12AB34"/>'
          )
        ) +
        '</w:tr>'
    )
  );
  const b = readCellBorders(find(p.root, 'tcPr'));
  expect(b.tl2br).toEqual(edge());
  expect(b.tr2bl).toEqual(edge('dashed', '12AB34', 1));
});

test('diagonal cascade distinguishes omitted and explicit nil independently', () => {
  const base = box({ tl2br: edge(), tr2bl: edge('dotted') });
  const inherited = mergeCellBorders(base, box({ tl2br: omitted }));
  expect(inherited.tl2br).toEqual(edge());
  const none = readCellBorders(
    find(
      doc(
        table(
          '<w:tr>' + cell('', borders('<w:tl2br w:val="nil"/><w:tr2bl w:val="none"/>')) + '</w:tr>'
        )
      ).root,
      'tcPr'
    )
  );
  const hidden = mergeCellBorders(base, none);
  expect(cellDiagonalRecords(hidden, 80, 30)).toEqual([]);
  expect(hidden.top).toEqual(omitted);
});

test('diagonal omission never inherits a neighbouring or table rule', () => {
  const r = resolveTableCellBorderGrid(
    [
      [
        { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: box({ tl2br: edge() }) },
        { gridColumn: 1, gridSpan: 1, vMergeContinue: false, borders: box() },
      ],
    ],
    { ...EMPTY_TABLE_BORDER_BOX, insideV: edge(), top: edge() },
    2,
    {
      columnWidthsPt: [40, 40],
      rowBands: [{ y: 0, height: 20 }],
      cellBoxes: [
        [
          { width: 40, height: 20 },
          { width: 40, height: 20 },
        ],
      ],
    }
  );
  expect(r[0]![0]!.diagonals).toHaveLength(1);
  expect(r[0]![1]!.diagonals).toBeUndefined();
});

test('diagonal endpoints follow both physical directions without affecting edges', () => {
  const r = grid(box({ tl2br: edge(), tr2bl: edge() }));
  for (const d of r.diagonals!) {
    expect(Number.isFinite(d.x1)).toBe(true);
    expect(d.x1).toBeCloseTo(0, 12);
  }
  expect(r.diagonals).toMatchObject([
    { direction: 'tl2br', y1: 0, x2: 80, y2: 30, clipWidth: 80, clipHeight: 30 },
    { direction: 'tr2bl', y1: 30, x2: 80, y2: 0 },
  ]);
  expect(r.edgeSegments).toBeUndefined();
});

test('diagonal compound strokes have bounded parallel geometry and authored thickness', () => {
  const r = cellDiagonalRecords(box({ tl2br: edge('double'), tr2bl: edge('triple') }), 80, 30);
  expect(r).toHaveLength(5);
  for (const s of r) {
    expect(s.widthPt).toBe(0.5);
    expect(s.x2 - s.x1).toBeCloseTo(80, 9);
    expect(Math.abs(s.y2 - s.y1)).toBeCloseTo(30, 9);
    expect(s.clipWidth).toBe(80);
  }
  expect(r[0]!.x1).not.toBe(r[1]!.x1);
});

test('diagonal patterned strokes retain CSS style and hostile color is discarded', () => {
  const p = doc(
    table(
      '<w:tr>' +
        cell('', borders('<w:tl2br w:val="dotted" w:color="url(x)"/><w:tr2bl w:val="dashed"/>')) +
        '</w:tr>'
    )
  );
  const r = cellDiagonalRecords(readCellBorders(find(p.root, 'tcPr')), 80, 30);
  expect(r.map((x) => x.cssStyle)).toEqual(['dotted', 'dashed']);
  expect(r[0]!.color).toBeNull();
});

test('diagonal invalid physical extents publish no nonfinite geometry', () => {
  for (const [w, h] of [
    [0, 30],
    [-1, 30],
    [80, NaN],
    [Infinity, 30],
  ])
    expect(cellDiagonalRecords(box({ tl2br: edge() }), w!, h!)).toEqual([]);
});

test('diagonal geometry-free border probes do not invent cell dimensions', () => {
  const r = resolveTableCellBorderGrid(
    [[{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: box({ tl2br: edge() }) }]],
    EMPTY_TABLE_BORDER_BOX,
    1
  );
  expect(r[0]![0]!.diagonals).toBeUndefined();
});

test('diagonal style basedOn whole-cell and conditional layers yield to direct nil', () => {
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="Base"><w:tcPr>${diag}</w:tcPr><w:tblStylePr w:type="firstRow"><w:tcPr>${borders('<w:tr2bl w:val="dotted"/>')}</w:tcPr></w:tblStylePr></w:style><w:style w:type="table" w:styleId="Derived"><w:basedOn w:val="Base"/><w:tblStylePr w:type="firstRow"><w:tcPr><w:shd w:fill="FFFFFF"/></w:tcPr></w:tblStylePr></w:style></w:styles>`,
    '/word/styles.xml'
  );
  const t = find(
    doc(
      table(
        '<w:tr>' + cell('a') + cell('b', borders('<w:tl2br w:val="nil"/>')) + '</w:tr>',
        '<w:tblStyle w:val="Derived"/><w:tblLook w:firstRow="1"/>'
      )
    ).root,
    'tbl'
  );
  const s = readTableStructure(t, 468, 0, buildStyleCascadeTable(styles.root))!;
  expect(s.rows[0]!.cells[0]!.borders.tl2br?.state).toBe('edge');
  expect(s.rows[0]!.cells[0]!.borders.tr2bl?.state).toBe('edge');
  expect(s.rows[0]!.cells[1]!.borders.tl2br?.state).toBe('none');
});

test('diagonal real merged layout paints one whole restart rectangle', () => {
  const l = lay(
    table(
      '<w:tr>' +
        cell('a', diag + '<w:vMerge w:val="restart"/>') +
        cell('b') +
        '</w:tr><w:tr>' +
        cell('', diag + '<w:vMerge/>') +
        cell('c') +
        '</w:tr>'
    )
  );
  const t = tables(l)[0]!;
  const first = t.rows[0].cells[0];
  expect(first.rowSpan).toBe(2);
  expect(first.borders.diagonals).toHaveLength(1);
  expect(first.borders.diagonals[0].y2).toBe(first.box.height);
  expect(first.box.height).toBeGreaterThan(t.rows[0].box.height);
  expect(t.rows[1].cells[0].borders.diagonals).toBeUndefined();
});

test('diagonal repeated headers publish local endpoints for each occurrence', () => {
  const rows =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    cell('h', diag) +
    cell('h') +
    '</w:tr>' +
    Array.from(
      { length: 12 },
      (_, i) => '<w:tr>' + cell(String(i)) + cell('body') + '</w:tr>'
    ).join('');
  const ts = tables(
    lay(
      table(rows),
      '<w:sectPr><w:pgSz w:w="6000" w:h="2600"/><w:pgMar w:top="100" w:bottom="100" w:left="100" w:right="100"/></w:sectPr>'
    )
  );
  expect(ts.length).toBeGreaterThan(1);
  let repeat = 0;
  for (const t of ts)
    for (const row of t.rows)
      if (row.isHeaderRow) {
        if (row.isHeaderRepeat) repeat++;
        const c = row.cells[0];
        expect(Number.isFinite(c.borders.diagonals[0].x1)).toBe(true);
        expect(c.borders.diagonals[0].x1).toBeCloseTo(0, 12);
        expect(c.borders.diagonals[0]).toMatchObject({ y1: 0, x2: c.box.width, y2: c.box.height });
      }
  expect(repeat).toBeGreaterThan(0);
});

test('diagonal layout dimensions and source text are unchanged by border presence', () => {
  const a = lay(table('<w:tr>' + cell('same', diag) + cell('text') + '</w:tr>'));
  const b = lay(table('<w:tr>' + cell('same') + cell('text') + '</w:tr>'));
  const ca = tables(a)[0].rows[0].cells[0];
  const cb = tables(b)[0].rows[0].cells[0];
  expect(ca.box).toEqual(cb.box);
  expect(a.pages.length).toBe(b.pages.length);
  expect(ca.blocks[0].lines.map((x: any) => x.spans.map((s: any) => s.text).join(''))).toEqual(
    cb.blocks[0].lines.map((x: any) => x.spans.map((s: any) => s.text).join(''))
  );
});
