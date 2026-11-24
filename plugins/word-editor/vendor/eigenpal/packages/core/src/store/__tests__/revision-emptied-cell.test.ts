// Accepting a deletion of every paragraph in a table cell, its last paragraph mark too, removes
// the cell; a row with no cell left goes, and so does a table with no row left.
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
let next = 1;
const stamp = () => `w:id="${next++}" w:author="Ada" w:date="2026-10-01T10:00:00Z"`;
const gone = (text: string) =>
  `<w:p><w:pPr><w:rPr><w:del ${stamp()}/></w:rPr></w:pPr>` +
  `<w:del ${stamp()}><w:r><w:delText>${text}</w:delText></w:r></w:del></w:p>`;
const kept = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (body: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${body}</w:tc>`;
const table = (rows: string[], columns: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${3000 * columns}" w:type="dxa"/></w:tblPr><w:tblGrid>` +
  '<w:gridCol w:w="3000"/>'.repeat(columns) +
  `</w:tblGrid>${rows.map((cells) => `<w:tr>${cells}</w:tr>`).join('')}</w:tbl>`;

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${kept('Before')}${body}${kept('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
function accept(part: OoxmlPart, keys?: string[]): string {
  const plan = planRevisionBatch(part, 'accept', keys, undefined, { explicit: keys !== undefined });
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  expect(revisionItemsOf(part)).toEqual([]);
  return serializeOoxmlPart(part);
}

const cases = [
  ['the only cell', () => table([cell(gone('x'))], 1), 0, 0],
  ['one cell of two paragraphs', () => table([cell(gone('x') + gone('x2'))], 1), 0, 0],
  ['both cells of a row', () => table([cell(gone('x')) + cell(gone('y'))], 2), 0, 0],
  ['one cell of a row', () => table([cell(gone('x')) + cell(kept('y'))], 2), 1, 1],
  ['the only cell of the second row', () => table([cell(kept('a')), cell(gone('x'))], 1), 1, 1],
] as const;
for (const [name, body, rows, cells] of cases)
  for (const how of ['all', 'card'] as const)
    test(`accepting the deletion of ${name} removes it (${how})`, () => {
      const part = load(body());
      const keys = how === 'all' ? undefined : revisionItemsOf(part).map(reviewItemKey);
      const xml = accept(part, keys);
      expect(xml.match(/<w:tr[ >]/g) ?? []).toHaveLength(rows);
      expect(xml.match(/<w:tc[ >]/g) ?? []).toHaveLength(cells);
      expect(xml).toMatch(/>Before<.*>After</s);
    });

const wrapped = (inner: (text: string) => string) => () =>
  table(
    [
      cell(
        `<w:p><w:pPr><w:rPr><w:del ${stamp()}/></w:rPr></w:pPr>` +
          inner(`<w:del ${stamp()}><w:r><w:delText>x</w:delText></w:r></w:del>`) +
          '</w:p>'
      ),
    ],
    1
  );
const wrappers = [
  ['inside a hyperlink', wrapped((text) => `<w:hyperlink w:anchor="a">${text}</w:hyperlink>`)],
  [
    'inside a custom XML element',
    wrapped((text) => `<w:customXml w:element="e">${text}</w:customXml>`),
  ],
  ['inside an insertion', wrapped((text) => `<w:ins ${stamp()}>${text}</w:ins>`)],
  ['beside an empty run', wrapped((text) => `<w:r><w:rPr><w:b/></w:rPr></w:r>${text}`)],
] as const;
for (const [name, body] of wrappers)
  for (const how of ['all', 'card'] as const)
    test(`accepting a deleted cell whose text is ${name} removes the table (${how})`, () => {
      const part = load(body());
      const keys = how === 'all' ? undefined : revisionItemsOf(part).map(reviewItemKey);
      expect(accept(part, keys)).not.toContain('<w:tbl');
    });

test('a cell keeps its last paragraph when text in it stays', () => {
  const xml = accept(load(table([cell(gone('x') + kept('stay'))], 1)));
  expect(xml.match(/<w:tc[ >]/g)).toHaveLength(1);
  expect(xml).toContain('>stay<');
});

test('a cell stays when its last paragraph mark is deleted but its text is not', () => {
  const body = table(
    [
      cell(
        `<w:p><w:pPr><w:rPr><w:del ${stamp()}/></w:rPr></w:pPr><w:r><w:t>live</w:t></w:r></w:p>`
      ),
    ],
    1
  );
  const xml = accept(load(body));
  expect(xml).toContain('>live<');
});

const goneBy = (author: string, text: string) =>
  `<w:p><w:pPr><w:rPr><w:del w:id="${next++}" w:author="${author}"/></w:rPr></w:pPr>` +
  `<w:del w:id="${next++}" w:author="${author}"><w:r><w:delText>${text}</w:delText></w:r></w:del></w:p>`;
function acceptBy(part: OoxmlPart, author: string): OoxmlPart {
  const keys = revisionItemsOf(part)
    .filter((item) => item.author === author)
    .map(reviewItemKey);
  const plan = planRevisionBatch(part, 'accept', keys, undefined, { explicit: true });
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  return part;
}

for (const order of [
  ['Ada', 'Grace'],
  ['Grace', 'Ada'],
])
  test(`two authors' deletions of a whole cell remove it in either order (${order.join(' then ')})`, () => {
    let part = load(table([cell(goneBy('Ada', 'x') + goneBy('Grace', 'y')) + cell(kept('k'))], 2));
    for (const author of order) part = acceptBy(part, author);
    const xml = serializeOoxmlPart(part);
    expect(revisionItemsOf(part)).toEqual([]);
    expect(xml.match(/<w:tc[ >]/g)).toHaveLength(1);
    expect(xml).toContain('>k<');
  });

test('accepting the mark of a cell whose text is deleted inside an insertion removes the cell', () => {
  let part = load(
    table(
      [
        cell(
          `<w:p><w:pPr><w:rPr><w:del w:id="${next++}" w:author="Ada"/></w:rPr></w:pPr>` +
            `<w:ins w:id="${next++}" w:author="Ada"><w:del w:id="${next++}" w:author="Ada">` +
            '<w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:p>'
        ) + cell(kept('k')),
      ],
      2
    )
  );
  for (let step = 0; step < 4 && revisionItemsOf(part).length; step++) {
    const items = revisionItemsOf(part);
    const item = items.find((candidate) => candidate.revisionKind === 'paragraphMark') ?? items[0]!;
    const plan = planRevisionBatch(part, 'accept', [reviewItemKey(item)], undefined, {
      explicit: true,
    });
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
  }
  expect(revisionItemsOf(part)).toEqual([]);
  expect(serializeOoxmlPart(part).match(/<w:tc[ >]/g)).toHaveLength(1);
});

const lastBy = (author: string, inner: string) =>
  `<w:p><w:pPr><w:rPr><w:del w:id="${next++}" w:author="${author}"/></w:rPr></w:pPr>${inner}</w:p>`;
const deletedBy = (author: string, text: string) =>
  `<w:del w:id="${next++}" w:author="${author}"><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
const orderShapes = [
  ['a cell with no properties', () => `<w:tc>${goneBy('Ada', 'x')}${goneBy('Grace', 'y')}</w:tc>`],
  [
    'deleted text in a hyperlink',
    () =>
      cell(
        goneBy('Grace', 'x') +
          lastBy('Ada', `<w:hyperlink w:anchor="a">${deletedBy('Grace', 'y')}</w:hyperlink>`)
      ),
  ],
  [
    'an empty run',
    () =>
      cell(
        goneBy('Grace', 'x') +
          lastBy('Ada', `${deletedBy('Grace', 'y')}<w:r><w:rPr><w:b/></w:rPr></w:r>`)
      ),
  ],
] as const;
for (const [name, body] of orderShapes)
  for (const order of [
    ['Ada', 'Grace'],
    ['Grace', 'Ada'],
  ])
    test(`a whole cell deleted with ${name} goes in either order (${order.join(' then ')})`, () => {
      let part = load(table([body() + cell(kept('k'))], 2));
      for (const author of order) part = acceptBy(part, author);
      expect(revisionItemsOf(part)).toEqual([]);
      expect(serializeOoxmlPart(part).match(/<w:tc[ >]/g)).toHaveLength(1);
    });

test("joining a cell's last paragraph keeps another author's change on its properties", () => {
  const changed = `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:del w:id="${next++}" w:author="Ada"/></w:rPr><w:pPrChange w:id="${next++}" w:author="Bob"><w:pPr/></w:pPrChange></w:pPr>${deletedBy('Ada', 'y')}</w:p>`;
  const part = acceptBy(load(table([cell(kept('live') + changed)], 1)), 'Ada');
  expect(revisionItemsOf(part).map((item) => item.author)).toEqual(['Bob']);
  expect(serializeOoxmlPart(part)).toContain('w:pPrChange');
});

test('accepting the deleted last paragraph of a cell joins it into the paragraph before', () => {
  const part = acceptBy(load(table([cell(kept('live') + goneBy('Grace', 'y'))], 1)), 'Grace');
  const xml = serializeOoxmlPart(part);
  expect(xml.match(/<w:p[ >]/g)).toHaveLength(3);
  expect(xml).toMatch(/<w:tc>.*>live<\/w:t><\/w:r><\/w:p><\/w:tc>/);
});

for (const how of ['all', 'card'] as const)
  test(`rejecting an inserted last paragraph of a cell keeps an empty paragraph (${how})`, () => {
    const inserted =
      `<w:p><w:pPr><w:rPr><w:ins w:id="${next++}" w:author="Ann"/></w:rPr></w:pPr>` +
      `<w:ins w:id="${next++}" w:author="Ann"><w:r><w:t>a2</w:t></w:r></w:ins></w:p>`;
    let part = load(table([cell(kept('a') + inserted)], 1));
    const keys = how === 'all' ? undefined : revisionItemsOf(part).map(reviewItemKey);
    const plan = planRevisionBatch(part, 'reject', keys, undefined, { explicit: !!keys });
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(revisionItemsOf(part)).toEqual([]);
    expect(xml).not.toContain('a2');
    expect(xml.match(/<w:p[ >/]/g)).toHaveLength(4);
  });

test('rejecting the deletion keeps the cell and its text', () => {
  let part = load(table([cell(gone('x')) + cell(kept('y'))], 2));
  for (const op of planRevisionBatch(part, 'reject').ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  expect(serializeOoxmlPart(part).match(/<w:tc[ >]/g)).toHaveLength(2);
});
