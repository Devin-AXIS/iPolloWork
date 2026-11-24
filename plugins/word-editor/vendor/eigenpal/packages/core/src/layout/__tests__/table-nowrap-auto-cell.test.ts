// A `w:noWrap` cell with an `auto` width keeps its text on one line: its column holds the
// unwrapped text with the cell margins. The other columns give way when they can, and the table
// grows past `w:tblW` when they hold their own widths. A `w:noWrap` cell with a `dxa` width
// holds that width, and its text still wraps.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LETTER =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const GRID = [3136, 900, 990, 900, 900, 810, 900, 900, 1015];
// Wider unwrapped than the 156.8pt grid column.
const LABEL = 'Renewable Generation Connections';
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function table(first: string, others: string): string {
  const cell = (props: string, text: string) => `<w:tc><w:tcPr>${props}</w:tcPr>${p(text)}</w:tc>`;
  const row = (label: string) =>
    '<w:tr>' +
    cell(first, label) +
    GRID.slice(1)
      .map((width) => cell(`<w:tcW w:w="${width}" w:type="dxa"/>${others}`, '1'))
      .join('') +
    '</w:tr>';
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="10451" w:type="dxa"/></w:tblPr><w:tblGrid>' +
    GRID.map((width) => `<w:gridCol w:w="${width}"/>`).join('') +
    `</w:tblGrid>${row(LABEL)}${row('Short')}</w:tbl>`
  );
}

function layTable(body: string): TableFragmentRecord {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${LETTER}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 12) });
  return layout.pages[0]!.fragments.find((f) => f.kind === 'table') as TableFragmentRecord;
}

const AUTO = '<w:tcW w:w="0" w:type="auto"/>';
const GRID_FIRST = GRID[0]! / 20;
const TABLE_WIDTH = 10451 / 20;
const column = (fragment: TableFragmentRecord, index: number) =>
  fragment.columnEdges[index + 1]! - fragment.columnEdges[index]!;
/** The label row is as tall as the one-word row: its text stayed on one line. */
const labelOnOneLine = (fragment: TableFragmentRecord) =>
  Math.abs(fragment.rows[0]!.box.height - fragment.rows[1]!.box.height) < 0.01;

test('an auto-width noWrap column holds its unwrapped text and the table grows', () => {
  const fragment = layTable(table(`${AUTO}<w:noWrap/>`, '<w:noWrap/>'));
  expect(labelOnOneLine(fragment)).toBe(true);
  expect(column(fragment, 0)).toBeGreaterThan(GRID_FIRST + 1);
  for (let index = 1; index < GRID.length; index++)
    expect(column(fragment, index)).toBeCloseTo(GRID[index]! / 20, 1);
  expect(fragment.box.width).toBeCloseTo(TABLE_WIDTH + column(fragment, 0) - GRID_FIRST, 1);
});

test('the other columns give way when they hold no width of their own', () => {
  const held = column(layTable(table(`${AUTO}<w:noWrap/>`, '<w:noWrap/>')), 0);
  const fragment = layTable(table(`${AUTO}<w:noWrap/>`, ''));
  expect(labelOnOneLine(fragment)).toBe(true);
  expect(column(fragment, 0)).toBeCloseTo(held, 1);
  expect(fragment.box.width).toBeCloseTo(TABLE_WIDTH, 1);
});

test('without noWrap the auto-width label wraps in its grid column', () => {
  const fragment = layTable(table(AUTO, '<w:noWrap/>'));
  expect(labelOnOneLine(fragment)).toBe(false);
  expect(column(fragment, 0)).toBeCloseTo(GRID_FIRST, 1);
});

test('a dxa-width noWrap cell holds its width and its text wraps', () => {
  const fragment = layTable(table('<w:tcW w:w="3136" w:type="dxa"/><w:noWrap/>', '<w:noWrap/>'));
  expect(labelOnOneLine(fragment)).toBe(false);
  expect(column(fragment, 0)).toBeCloseTo(GRID_FIRST, 1);
});
