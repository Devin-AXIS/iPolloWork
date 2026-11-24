// Where a wrapping object positioned from its paragraph or line measures from, and how table
// cells keep such an object on the page.
//
// - Each part of a paragraph publishes the objects its own lines hold: an object on a later
//   page measures from the top of the paragraph's part there.
// - A paragraph frame starts where the paragraph would begin without the wrapping bands that
//   pushed its first line down. A line frame on the first line starts at the top of the space
//   and border above it: after the band push, or before it in legacy modes.
// - In a table cell, a line whose object would cross the page waits for the row's next page in
//   modern modes, and the whole row moves in legacy modes. The cell grows to hold the object.

import { describe, expect, test } from 'bun:test';
import {
  anchor,
  drawings,
  exactLine,
  filler,
  lineAt,
  linesParagraph,
  render,
  text,
} from './anchor-page-fit-fixtures.ts';

const line = (value: string, pPr = exactLine(14)) =>
  `<w:p>${pPr}<w:r><w:t>${value}</w:t></w:r></w:p>`;
const withObject = (object: string, value: string, pPr = exactLine(14)) =>
  `<w:p>${pPr}${object}<w:r><w:t>${value}</w:t></w:r></w:p>`;
const table = (cell: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc>' +
  `<w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl>`;

describe('a paragraph split across pages', () => {
  test('frames an object on a later page by that page’s part, from paragraph or line', () => {
    for (const frame of ['paragraph', 'line'] as const) {
      const object = anchor({ y: 5, height: 20, x: 368, frame });
      const layout = render(linesParagraph(object, 85, 100) + text('After'));
      const held = lineAt(layout, 'Line 85')!;
      expect(held.page).toBe(1);
      const y = frame === 'line' ? held.y + 5 : 5;
      expect(drawings(layout)).toEqual([{ page: 1, y }]);
    }
  });
});

describe('the frame origin of a paragraph a band pushed down', () => {
  // The band (320 to 420) comes from the paragraph above, which ends at 314; it pushes the
  // next paragraph's first line from 314 to 420.
  const band = anchor({ y: 20, height: 100, x: 368, wrap: 'topAndBottom' });
  const pushed = (frame: 'paragraph' | 'line') =>
    filler(300) +
    withObject(band, 'Prev') +
    withObject(anchor({ y: 0, height: 50, x: 368, frame }), 'Text') +
    text('After');

  for (const mode of [15, 14]) {
    test(`a paragraph frame starts before the push in mode ${mode}`, () => {
      const layout = render(pushed('paragraph'), mode);
      expect(lineAt(layout, 'Text')).toEqual({ page: 0, y: 420 });
      expect(drawings(layout)[1]).toEqual({ page: 0, y: 314 });
    });
  }

  test('a line frame starts after the push in modern modes and before it in legacy modes', () => {
    expect(drawings(render(pushed('line'), 15))[1]).toEqual({ page: 0, y: 420 });
    expect(drawings(render(pushed('line'), 14))[1]).toEqual({ page: 0, y: 314 });
  });
});

describe('the first line frame', () => {
  const object = anchor({ y: 0, height: 50, x: 368, frame: 'line' });
  test('starts at the top of the space before', () => {
    const spaced =
      '<w:pPr><w:spacing w:before="240" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>';
    const layout = render(filler(300) + withObject(object, 'Text', spaced));
    expect(lineAt(layout, 'Text')).toEqual({ page: 0, y: 312 });
    expect(drawings(layout)).toEqual([{ page: 0, y: 300 }]);
  });

  test('starts at the top of the paragraph border', () => {
    const bordered =
      '<w:pPr><w:pBdr><w:top w:val="single" w:sz="24" w:space="4" w:color="000000"/></w:pBdr>' +
      '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>';
    const layout = render(filler(300) + withObject(object, 'Text', bordered));
    expect(lineAt(layout, 'Text')).toEqual({ page: 0, y: 307 });
    expect(drawings(layout)).toEqual([{ page: 0, y: 300 }]);
  });
});

describe('a wrapping object in a table cell near the page bottom', () => {
  // The row starts at 500; three 14pt lines end at 542, where a 300pt object cannot fit.
  const cell = (frame: 'paragraph' | 'line') =>
    table(
      line('Line 1') +
        line('Line 2') +
        line('Line 3') +
        withObject(anchor({ y: 8, height: 300, x: 300, frame }), 'Text') +
        line('Line 5')
    ) + text('After');

  for (const frame of ['paragraph', 'line'] as const) {
    test(`splits the row before the line that holds it in modern modes (${frame})`, () => {
      const layout = render(filler(500) + cell(frame));
      expect(lineAt(layout, 'Line 3')!.page).toBe(0);
      const held = lineAt(layout, 'Text')!;
      expect(held.page).toBe(1);
      expect(drawings(layout)).toEqual([{ page: 1, y: held.y + 8 }]);
      // The cell grows to hold the object, so the next paragraph starts below it.
      expect(lineAt(layout, 'After')!.y).toBeGreaterThanOrEqual(held.y + 308);
    });
  }

  test('moves the whole row in legacy modes', () => {
    const layout = render(filler(500) + cell('paragraph'), 14);
    expect(lineAt(layout, 'Line 1')!.page).toBe(1);
    const held = lineAt(layout, 'Text')!;
    expect(drawings(layout)).toEqual([{ page: 1, y: held.y + 8 }]);
  });

  test('keeps the content of a fixed-height row, which clips the object instead', () => {
    const exact = (cellXml: string) =>
      table(cellXml).replace(
        '<w:tr>',
        '<w:tr><w:trPr><w:trHeight w:val="1000" w:hRule="exact"/></w:trPr>'
      );
    const object = anchor({ y: 5, height: 150, x: 300 });
    const layout = render(filler(100) + exact(withObject(object, 'Text')) + text('After'));
    expect(lineAt(layout, 'Text')!.page).toBe(0);
    expect(drawings(layout)).toEqual([{ page: 0, y: lineAt(layout, 'Text')!.y + 5 }]);
  });

  test('frames a line-relative object from its line, and grows the cell to hold it', () => {
    const spaced =
      '<w:pPr><w:spacing w:before="600" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>';
    const object = anchor({ y: 0, height: 100, x: 300, frame: 'line' });
    const layout = render(filler(300) + table(withObject(object, 'Text', spaced)) + text('After'));
    const held = lineAt(layout, 'Text')!;
    expect(drawings(layout)).toEqual([{ page: 0, y: held.y }]);
    expect(lineAt(layout, 'After')!.y).toBeGreaterThanOrEqual(held.y + 100);
  });

  test('leaves a row at the page top alone', () => {
    const layout = render(cell('paragraph'));
    expect(lineAt(layout, 'Text')!.page).toBe(0);
  });
});
