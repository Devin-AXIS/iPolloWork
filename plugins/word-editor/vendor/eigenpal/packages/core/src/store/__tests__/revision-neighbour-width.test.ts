// Rejecting an inserted cell beside a neighbour whose width change makes room for it: the two
// decide together, so any single decision gives the row that rejecting both gives.
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  reviewItemKey,
  revisionItemsOf,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const width = (twips: number) => `<w:tcW w:w="${twips}" w:type="dxa"/>`;
const cell = (pr: string, text: string) =>
  `<w:tc><w:tcPr>${pr}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

function load(neighbourAuthor: string, gridHistory: boolean): OoxmlPart {
  const grid = gridHistory
    ? '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/><w:gridCol w:w="3000"/>' +
      `<w:tblGridChange w:id="9"><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid></w:tblGridChange></w:tblGrid>`
    : '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';
  const history = (id: number) =>
    `<w:tcPrChange w:id="${id}" w:author="${neighbourAuthor}"><w:tcPr>${width(3000)}</w:tcPr></w:tcPrChange>`;
  const first = gridHistory ? cell(width(2000) + history(2), 'a') : cell(width(3000), 'a');
  const inserted =
    `<w:tc><w:tcPr>${width(2500)}<w:cellIns w:id="4" w:author="Ann"/></w:tcPr>` +
    '<w:p><w:pPr><w:rPr><w:ins w:id="5" w:author="Ann"/></w:rPr></w:pPr>' +
    '<w:ins w:id="6" w:author="Ann"><w:r><w:t>c</w:t></w:r></w:ins></w:p></w:tc>';
  const body =
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>${grid}` +
    `<w:tr>${first}${cell(width(3500) + history(3), 'b')}${inserted}</w:tr>` +
    `<w:tr>${cell(width(3000), 'x')}${cell(width(3000), 'y')}${cell(width(3000), 'z')}</w:tr></w:tbl><w:p/>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}

function reject(part: OoxmlPart, keys?: string[]): OoxmlPart {
  const plan = planRevisionBatch(part, 'reject', keys, undefined, { explicit: keys !== undefined });
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  return part;
}

test('rejecting a table alignment change never removes an inserted cell through a width pair', () => {
  const base = serializeOoxmlPart(load('Ann', false));
  const aligned = base.replace(
    '<w:tblLayout w:type="fixed"/></w:tblPr>',
    '<w:tblLayout w:type="fixed"/><w:jc w:val="center"/><w:tblPrChange w:id="20" w:author="Cy"><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr></w:tblPrChange></w:tblPr>'
  );
  const read = readOoxmlPart(aligned, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  expect(aligned).not.toBe(base);
  // The alignment and the cell history beside it are one entry, named after the row history.
  const alignment = revisionItemsOf(read.part).find(
    (item) => item.formattingKind === 'tblPrChange'
  )!;
  expect(alignment.addresses.map((address) => address.author).sort()).toEqual(['Ann', 'Cy']);
  const plan = planRevisionBatch(read.part, 'reject', [reviewItemKey(alignment)], undefined, {
    explicit: true,
  });
  let part = read.part;
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  expect(plan.result.skipped).toEqual([]);
  expect(plan.result.resolved.map((entry) => entry.author)).toEqual(['Ann']);
  expect(serializeOoxmlPart(part)).toContain('>c<');
  expect(plan.result.resolved.every((entry) => entry.revisionKind !== 'structural')).toBe(true);
});

test("rejecting another author's width beside an inserted cell keeps the inserted cell", () => {
  const part = load('Bob', false);
  const width = revisionItemsOf(part).find((item) => item.author === 'Bob')!;
  const after = reject(part, [reviewItemKey(width)]);
  expect(revisionItemsOf(after).every((item) => item.author === 'Ann')).toBe(true);
  expect(serializeOoxmlPart(after)).toContain('>c<');
});

for (const [neighbourAuthor, gridHistory] of [
  ['Ann', false],
  ['Ann', true],
] as const)
  for (const first of ['format', 'structural'] as const)
    test(`rejecting the ${first} card first gives the reject-all row (${neighbourAuthor}, grid history ${gridHistory})`, () => {
      const all = serializeOoxmlPart(reject(load(neighbourAuthor, gridHistory)));
      let part = load(neighbourAuthor, gridHistory);
      for (let step = 0; step < 4 && revisionItemsOf(part).length; step++) {
        const items = revisionItemsOf(part);
        const item = items.find((candidate) => candidate.revisionKind === first) ?? items[0]!;
        part = reject(part, [reviewItemKey(item)]);
      }
      expect(revisionItemsOf(part)).toEqual([]);
      expect(serializeOoxmlPart(part)).toBe(all);
      expect(all).not.toContain('gridSpan');
    });

test('rejecting an inserted row takes along a formatting change it removes in part', () => {
  // One formatting change records the old grid and the spans of the inserted row's cells.
  const stamp = 'w:author="Au"';
  const span = (id: number) =>
    `<w:tcPrChange w:id="${id}" ${stamp}><w:tcPr><w:gridSpan w:val="2"/></w:tcPr></w:tcPrChange>`;
  const body =
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="2000"/>' +
    `<w:tblGridChange w:id="1" ${stamp}><w:tblGrid>${'<w:gridCol w:w="750"/>'.repeat(4)}</w:tblGrid></w:tblGridChange></w:tblGrid>` +
    `<w:tr><w:trPr><w:ins w:id="2" ${stamp}/></w:trPr>${cell(span(3), 'a')}${cell(span(4), 'b')}</w:tr>` +
    `<w:tr>${cell('', 'x')}${cell('', 'y')}</w:tr></w:tbl><w:p/>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  const all = serializeOoxmlPart(reject(read.part));
  const row = revisionItemsOf(read.part).find((item) => item.revisionKind === 'structural')!;
  const part = reject(read.part, [reviewItemKey(row)]);
  expect(revisionItemsOf(part)).toEqual([]);
  expect(serializeOoxmlPart(part)).toBe(all);
});

for (const action of ['accept', 'reject'] as const)
  test(`a row decision (${action}) leaves another author's change outside the row pending`, () => {
    // One insertion, by one shared identity, spans a paragraph, both rows, and a paragraph.
    const bot = 'w:id="1" w:author="Bot"';
    const inserted = (text: string) =>
      `<w:p><w:pPr><w:rPr><w:ins ${bot}/></w:rPr></w:pPr><w:ins ${bot}><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
    const mark = action === 'accept' ? 'del' : 'ins';
    const body =
      `${inserted('P1')}<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>` +
      `<w:tr><w:tc>${inserted('R1')}</w:tc></w:tr>` +
      `<w:tr><w:trPr><w:${mark} w:id="2" w:author="Ann"/></w:trPr><w:tc>${inserted('R2')}</w:tc></w:tr>` +
      `</w:tbl>${inserted('P2')}<w:p/>`;
    const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!read.ok) throw Error(read.reason);
    const row = revisionItemsOf(read.part).find((item) => item.author === 'Ann')!;
    const plan = planRevisionBatch(read.part, action, [reviewItemKey(row)], undefined, {
      explicit: true,
    });
    expect(plan.result.resolved.map((entry) => entry.author)).not.toContain('Bot');
    let part = read.part;
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(xml).toContain('>P1<');
    expect(xml).toContain('>P2<');
    expect(revisionItemsOf(part).some((item) => item.author === 'Bot')).toBe(true);
  });

test('rejecting shading history beside an inserted cell keeps the inserted cell', () => {
  const shading = (fill: string) => `<w:shd w:val="clear" w:fill="${fill}"/>`;
  const body =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
    cell(
      `${width(3000)}${shading('FF0000')}<w:tcPrChange w:id="2" w:author="Bob"><w:tcPr>${width(3000)}</w:tcPr></w:tcPrChange>`,
      'b'
    ) +
    `<w:tc><w:tcPr>${width(3000)}<w:cellIns w:id="4" w:author="Ann"/></w:tcPr><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc>` +
    '</w:tr></w:tbl><w:p/>';
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  const shadingCard = revisionItemsOf(read.part).find((item) => item.author === 'Bob')!;
  const part = reject(read.part, [reviewItemKey(shadingCard)]);
  expect(revisionItemsOf(part).map((item) => item.author)).toEqual(['Ann']);
  expect(serializeOoxmlPart(part)).toContain('>c<');
});
