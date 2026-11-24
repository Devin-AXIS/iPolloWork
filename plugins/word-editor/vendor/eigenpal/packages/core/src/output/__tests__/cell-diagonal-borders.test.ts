import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import {
  resolveTableCellBorderGrid,
  EMPTY_CELL_BORDER_BOX,
  EMPTY_TABLE_BORDER_BOX,
} from '../../layout/table-borders.ts';
import { applyCellBorders } from '../semantic-paint-table-borders.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
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
test('diagonal DOM is clipped inert SVG with real line endpoints', () => {
  const host = document.createElement('div');
  applyCellBorders(document, host, grid(box({ tl2br: edge() })), 2);
  const svg = host.querySelector('svg')!;
  expect(svg.getAttribute('viewBox')).toBe('0 0 80 30');
  expect(svg.getAttribute('width')).toBe('160');
  expect(svg.style.overflow).toBe('hidden');
  expect(svg.style.pointerEvents).toBe('none');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  const line = svg.querySelector('line')!;
  expect(line.getAttribute('x2')).toBe('80');
  expect(line.getAttribute('y2')).toBe('30');
  expect(line.getAttribute('stroke-width')).toBe('0.5');
  expect(host.textContent).toBe('');
});

test('diagonal DOM patterns and scale do not mutate layout coordinates', () => {
  const b = grid(box({ tr2bl: edge('dashed', '123456', 1) }));
  const old = JSON.stringify(b);
  for (const scale of [0.5, 1, 2]) {
    const h = document.createElement('div');
    applyCellBorders(document, h, b, scale);
    const line = h.querySelector('line')!;
    expect(line.getAttribute('stroke-dasharray')).toBe('3 2');
    expect(line.getAttribute('y1')).toBe('30');
  }
  expect(JSON.stringify(b)).toBe(old);
});

test('diagonal retained DOM changes direction without leaving stale line nodes', () => {
  const a = lay(table('<w:tr>' + cell('same', diag) + cell('b') + '</w:tr>'));
  const b = lay(
    table(
      '<w:tr>' + cell('same', borders('<w:tr2bl w:val="single" w:sz="4"/>')) + cell('b') + '</w:tr>'
    )
  );
  const host = document.createElement('div');
  paintSemanticLayout(host, a, { scale: 1 });
  expect(host.querySelectorAll('[data-diagonal="tl2br"]')).toHaveLength(1);
  paintSemanticLayout(host, b, { scale: 1 });
  expect(host.querySelectorAll('[data-diagonal="tl2br"]')).toHaveLength(0);
  expect(host.querySelectorAll('[data-diagonal="tr2bl"]')).toHaveLength(1);
});

const physicalEdge = { state: 'edge', style: 'single', widthPt: 0.5, color: null } as const;
const physical = {
  top: physicalEdge,
  left: physicalEdge,
  bottom: physicalEdge,
  right: physicalEdge,
};
function resolve(extra: any = {}) {
  return resolveTableCellBorderGrid(
    [[{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: { ...physical, ...extra } }]],
    EMPTY_TABLE_BORDER_BOX,
    1,
    {
      collapsedHorizontal: false,
      columnWidthsPt: [80],
      rowBands: [{ y: 0, height: 30 }],
      cellBoxes: [[{ width: 80, height: 30 }]],
    }
  )[0]![0]!;
}
test('visible diagonal publishes every physical side so CSS cannot move its padding origin', () => {
  for (const direction of ['tl2br', 'tr2bl'] as const) {
    const borders = resolve({ [direction]: physicalEdge });
    expect(borders.diagonals).toHaveLength(1);
    expect(new Set(borders.strokes!.map((x) => x.side))).toEqual(
      new Set(['top', 'left', 'bottom', 'right'])
    );
    expect(borders.strokes!.find((x) => x.side === 'top')).toMatchObject({
      x: 0,
      y: 0,
      width: 80,
      height: 0.5,
    });
    expect(borders.strokes!.find((x) => x.side === 'left')).toMatchObject({
      x: 0,
      y: 0,
      width: 0.5,
      height: 30,
    });
    expect(borders.strokes!.find((x) => x.side === 'bottom')).toMatchObject({
      x: 0,
      y: 29.5,
      width: 80,
      height: 0.5,
    });
    for (const scale of [0.5, 1, 4 / 3, 2]) {
      const host = document.createElement('div');
      host.style.border = 'none';
      host.style.width = `${80 * scale}px`;
      host.style.height = `${30 * scale}px`;
      host.style.boxSizing = 'border-box';
      const strokes = applyCellBorders(document, host, borders, scale);
      expect(strokes).toHaveLength(4);
      for (const side of ['Top', 'Left', 'Bottom', 'Right'])
        expect(host.style[`border${side}Style` as 'borderTopStyle']).toBe('none');
      const svg = host.querySelector('svg')!;
      expect(svg.style.left).toBe('0px');
      expect(svg.style.top).toBe('0px');
      expect(svg.style.overflow).toBe('hidden');
      expect(svg.style.pointerEvents).toBe('none');
      expect(svg.getAttribute('viewBox')).toBe('0 0 80 30');
      expect(svg.getAttribute('width')).toBe(String(80 * scale));
      expect(svg.getAttribute('height')).toBe(String(30 * scale));
      const line = svg.querySelector('line')!;
      expect(Number(line.getAttribute('x1'))).toBeCloseTo(0, 12);
      expect(Number(line.getAttribute('x2'))).toBe(80);
      expect(Number(line.getAttribute('y1'))).toBe(direction === 'tl2br' ? 0 : 30);
      expect(Number(line.getAttribute('y2'))).toBe(direction === 'tl2br' ? 30 : 0);
    }
  }
});
test('omitted or suppressed diagonals retain the existing CSS physical-border path', () => {
  const base = resolve();
  expect(base.diagonals).toBeUndefined();
  expect(base.strokes!.map((x) => x.side)).toEqual(['right']);
  for (const extra of [
    {},
    { tl2br: { state: 'omitted' } },
    { tr2bl: { state: 'none' } },
    { tl2br: { state: 'none' }, tr2bl: { state: 'none' } },
  ]) {
    const borders = resolve(extra);
    expect(borders).toEqual(base);
    const host = document.createElement('div');
    host.style.border = 'none';
    applyCellBorders(document, host, borders, 4 / 3);
    expect(host.querySelector('svg')).toBeNull();
    expect(host.style.borderTopStyle).toBe('solid');
    expect(host.style.borderLeftStyle).toBe('solid');
    expect(host.style.borderBottomStyle).toBe('solid');
    expect(host.style.borderRightStyle).toBe('none');
  }
});
