// Deciding a row exception change (`w:tblPrExChange`). The exception keeps only what differs from
// the table's own properties, an exception left with nothing goes, and it stays first in the row.
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ann = (id: number) => `w:id="${id}" w:author="Ann" w:date="2026-01-01T00:00:00Z"`;
const margins =
  '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const borders = (size: number) =>
  `<w:tblBorders><w:top w:val="single" w:sz="${size}" w:space="0" w:color="000000"/></w:tblBorders>`;
const tableProperties =
  '<w:tblW w:w="0" w:type="auto"/><w:tblInd w:w="740" w:type="dxa"/>' +
  `${borders(8)}<w:tblLayout w:type="fixed"/>${margins}`;
const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const exception = (current: string, old: string) =>
  `<w:tblPrEx>${current}<w:tblPrExChange ${ann(3)}><w:tblPrEx>${old}</w:tblPrEx></w:tblPrExChange></w:tblPrEx>`;
const height =
  `<w:trPr><w:trHeight w:val="1981"/><w:trPrChange ${ann(4)}><w:trPr>` +
  '<w:trHeight w:val="718"/></w:trPr></w:trPrChange></w:trPr>';

const gridChange =
  '<w:tblGridChange w:id="9"><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/>' +
  '<w:gridCol w:w="110"/></w:tblGrid></w:tblGridChange>';

function load(rowExtras: string, grid = ''): OoxmlPart {
  const body =
    `<w:tbl><w:tblPr>${tableProperties}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/>${grid}</w:tblGrid>` +
    `<w:tr>${cell('a')}${cell('b')}</w:tr><w:tr>${rowExtras}${cell('c')}${cell('d')}</w:tr></w:tbl><w:p/>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}

function decide(part: OoxmlPart, action: 'accept' | 'reject'): string {
  const plan = planRevisionBatch(part, action);
  expect(plan.result.skipped).toEqual([]);
  let current = part;
  for (const op of plan.ops) {
    const result = applyTreeOp(current, op);
    if (!result.ok) throw Error(result.reason);
    current = result.part;
  }
  return serializeOoxmlPart(current);
}

const secondRow = (xml: string) => [...xml.matchAll(/<w:tr>(.*?)<\/w:tr>/gs)][1]![1]!;

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: an exception that only repeats the table goes, and the row keeps its order`, () => {
    const part = load(
      exception(tableProperties, `<w:tblW w:w="0" w:type="auto"/>${margins}`) + height
    );
    const row = secondRow(decide(part, action));
    expect(row).not.toContain('tblPrEx');
    expect(row.startsWith('<w:trPr>')).toBe(true);
  });
}

test('accept: an exception keeps only what differs from the table, first in the row', () => {
  const part = load(exception(`<w:tblW w:w="0" w:type="auto"/>${borders(4)}`, '') + height);
  const row = secondRow(decide(part, 'accept'));
  expect(row).toMatch(
    /^<w:tblPrEx><w:tblBorders><w:top [^>]*w:sz="4"[^>]*\/><\/w:tblBorders><\/w:tblPrEx><w:trPr>/
  );
});

test('reject: the restored exception keeps only what differs, before the row properties', () => {
  const part = load(exception(tableProperties, borders(4)) + height);
  const row = secondRow(decide(part, 'reject'));
  expect(row).toMatch(
    /^<w:tblPrEx><w:tblBorders><w:top [^>]*w:sz="4"[^>]*\/><\/w:tblBorders><\/w:tblPrEx><w:trPr>/
  );
});

test('an exception with no change record is left as it is', () => {
  const kept = `<w:tblPrEx>${tableProperties}</w:tblPrEx>`;
  const part = load(kept + height);
  expect(secondRow(decide(part, 'accept'))).toContain('<w:tblInd');
});

// A table grid change rebuilds every row; the row properties stay after the exception.
test('reject: a table grid change keeps the row exception before the row properties', () => {
  const part = load(exception(tableProperties, borders(4)) + height, gridChange);
  const row = secondRow(decide(part, 'reject'));
  expect(row.indexOf('<w:tblPrEx>')).toBe(0);
  expect(row.indexOf('<w:tblPrEx>')).toBeLessThan(row.indexOf('<w:trPr>'));
});

// A row exception records no row geometry: rejecting it restores the row as an empty row
// snapshot does, with minimum-width cells that end before the unchanged rows' grid.
test('reject: a row exception change alone restores the row with the implicit grid', () => {
  const columns = (row: string) =>
    `<w:tr>${row}${cell('x').replace('3000', '2000')}${cell('y').replace('3000', '2000')}</w:tr>`;
  const body =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblInd w:w="740" w:type="dxa"/>' +
    '<w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    columns('') +
    columns(exception('<w:tblInd w:w="900" w:type="dxa"/>', '')) +
    '</w:tbl><w:p/>';
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  const xml = decide(read.part, 'reject');
  expect(xml.match(/<w:gridCol w:w="(\d+)"\/>/g)).toEqual(
    [360, 360, 1280, 2000].map((w) => `<w:gridCol w:w="${w}"/>`)
  );
  const restored = secondRow(xml);
  expect(restored).toContain('<w:gridAfter w:val="2"/>');
  expect(restored.match(/<w:tcW w:type="dxa" w:w="360"\/>/g)).toHaveLength(2);
});
