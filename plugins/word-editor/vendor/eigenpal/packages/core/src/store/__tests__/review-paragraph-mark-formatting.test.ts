// A formatting change recorded on a run and on the paragraph mark it reaches is one review
// decision (fixes #1458). Each expected count below was measured against reference documents
// with the same structure.
import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const FIRST = '2026-10-21T13:32:00Z';
const LATER = '2026-08-01T09:00:00Z';
let nextId = 1;
const BOLD = '<w:b/><w:bCs/>';
const ITALIC = '<w:i/><w:iCs/>';
const change = (author = 'Ada', date = FIRST, old = '') =>
  `<w:rPrChange w:id="${nextId++}" w:author="${author}" w:date="${date}"><w:rPr>${old}</w:rPr></w:rPrChange>`;
const run = (text: string, properties = '', record = '') =>
  `<w:r><w:rPr>${properties}${record}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const mark = (properties = '', record = '') =>
  `<w:pPr><w:rPr>${properties}${record}</w:rPr></w:pPr>`;
const paragraph = (properties: string, ...runs: string[]) =>
  `<w:p>${properties}${runs.join('')}</w:p>`;
const bold = (text: string) => paragraph(mark(BOLD, change()), run(text, BOLD, change()));
const ins = (author: string, content: string) =>
  `<w:ins w:id="${nextId++}" w:author="${author}" w:date="${FIRST}">${content}</w:ins>`;
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const table = (...rows: string[]) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${rows
    .map((row) => `<w:tr>${row}</w:tr>`)
    .join('')}</w:tbl>`;
const plain = (text: string) => paragraph('', run(text));

function part(body: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const formatCards = (body: string) =>
  revisionItemsOf(part(body)).filter((item) => item.revisionKind === 'format');

describe('formatting on text and its paragraph mark', () => {
  const cases: [string, string, number][] = [
    ['run and mark', bold('Hello'), 1],
    [
      'run and mark months apart',
      paragraph(mark(BOLD, change('Ada', LATER)), run('Hello', BOLD, change())),
      1,
    ],
    ['different authors', paragraph(mark(BOLD, change('Grace')), run('Hello', BOLD, change())), 2],
    ['different changes', paragraph(mark(ITALIC, change()), run('Hello', BOLD, change())), 2],
    [
      'unchanged text between',
      paragraph(mark(BOLD, change()), run('Hello', BOLD, change()), run(' world')),
      2,
    ],
    [
      'two runs and the mark',
      paragraph(mark(BOLD, change()), run('Hel', BOLD, change()), run('lo', BOLD, change())),
      1,
    ],
    [
      'the mark and the next paragraph',
      bold('Hello') + paragraph(mark(), run('World', BOLD, change())),
      1,
    ],
    ['two whole paragraphs', bold('Hello') + bold('World'), 1],
    ['an empty paragraph after', bold('Hello') + paragraph(mark(BOLD, change())), 1],
    [
      'the same change from another starting format',
      paragraph(mark(BOLD, change()), run('Hello', BOLD + ITALIC, change('Ada', FIRST, ITALIC))),
      1,
    ],
    [
      'properties that do not change',
      paragraph(
        mark(BOLD, change()),
        run(
          'Hello',
          BOLD + '<w:lang w:val="sv-SE"/>',
          change('Ada', FIRST, '<w:lang w:val="sv-SE"/>')
        )
      ),
      1,
    ],
    [
      'text inside another author’s insertion',
      paragraph(
        mark(BOLD, change()),
        run('Hi', BOLD, change()),
        ins('Grace', run('Hello', BOLD, change()))
      ),
      1,
    ],
    ['cells of one row', table(cell(bold('a')) + cell(bold('b'))), 1],
    [
      'a paragraph and the first cell after it',
      bold('Before') + table(cell(bold('a')) + cell(plain('b'))),
      1,
    ],
    [
      'the last cell and the next row',
      table(cell(plain('a')) + cell(bold('b')), cell(bold('c')) + cell(plain('d'))),
      2,
    ],
    [
      'the last cell and the paragraph after the table',
      table(cell(plain('a')) + cell(bold('b'))) + bold('After'),
      2,
    ],
  ];
  for (const [name, body, expected] of cases)
    test(`${name}: ${expected} decision${expected === 1 ? '' : 's'}`, () => {
      expect(formatCards(body)).toHaveLength(expected);
    });

  for (const action of ['accept', 'reject'] as const)
    test(`one ${action} resolves the text and the mark`, () => {
      const document = part(bold('Hello'));
      const [card] = revisionItemsOf(document);
      const plan = planRevisionBatch(document, action, [reviewItemKey(card!)]);
      expect(plan.result.skipped).toEqual([]);
      const applied = applyTreeOp(document, plan.ops[0]!);
      if (!applied.ok) throw new Error(applied.reason);
      expect(revisionItemsOf(applied.part)).toEqual([]);
      const xml = serializeOoxmlPart(applied.part);
      expect(xml).not.toContain('rPrChange');
      expect(xml.includes('<w:b/>')).toBe(action === 'accept');
    });
});
