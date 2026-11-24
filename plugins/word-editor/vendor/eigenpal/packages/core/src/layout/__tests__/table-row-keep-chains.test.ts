// Keep chains that cross table rows (§17.3.1.15, §17.3.1.23).
//
// A table whose first row starts a new page ends a keep chain: the caption before it needs no
// room for it. Before Word 2013, a row that starts a new page ends the kept group above it,
// and the group stays on its page. From Word 2013 on, a row after a kept row does not start a
// new page: it is the group's next row, and the group moves only when it does not fit.
//
// A `w:keepNext` paragraph before a table whose body rows all keep goes on through those rows
// to the content after the table, so it moves with them. Before Word 2013, header rows do not
// keep with the body rows: the caption keeps with the header rows only, and a kept body group
// below them moves on its own under the repeated header.
//
// A kept last row prices a following keep chain for the room the row leaves, and a retained
// layout re-places the table and the caption when any block that pricing reads changes.
//
// The page shapes come from captured probes in compatibility modes 14 and 15.

import { describe, expect, test } from 'bun:test';
import { TreeDocumentStore, type OoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { keepNextFlowKeys } from '../pagination-keeps.ts';
import {
  ALL,
  lay,
  load,
  read,
  SECT,
  measurer,
  P8,
  pages,
  para,
  row,
  styleCascade,
  table,
  TAIL,
} from './table-row-keep-fixtures.ts';

const P = 'P1 P2 P3 P4 P5 P6 P7 P8';
const CAP = para('CAP', 1, { keep: true });
const breaking = (name: string, lines = 1, keep = false) =>
  para(name, lines, { keep, pageBreakBefore: true });
/** A kept caption with 10pt of space after it. */
const CAP_AFTER =
  '<w:p><w:pPr><w:keepNext/><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="200" w:line="280" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:t>CAP1</w:t></w:r></w:p>';
const mergedHeader = [
  row('HA', { header: true, firstTcPr: '<w:vMerge w:val="restart"/>' }),
  row('HB', { header: true, first: para('', 1), firstTcPr: '<w:vMerge/>' }),
];

/** A case name, the compatibility modes it holds in, the body, and the pages. */
type Case = readonly [string, readonly number[], string, readonly string[]];
const run = (cases: readonly Case[]) => {
  for (const [name, modes, body, expected] of cases) {
    for (const mode of modes) {
      test(`mode ${mode}: ${name}`, () => {
        expect(pages(lay(load(body), mode))).toEqual([...expected]);
      });
    }
  }
};

const keptFirstThenBreak =
  para('P', 11) +
  CAP +
  table([row('R1', { keep: ALL }), row('R2', { first: breaking('R2c1-') })]) +
  TAIL;

const breakingSuccessor =
  P8 +
  table([
    row('R1'),
    row('R2'),
    row('R3', { keep: ALL }),
    row('R4', { cantSplit: true, first: breaking('R4c1-', 2) }),
  ]) +
  TAIL;

describe('a row or table that starts a new page ends the keep before it', () => {
  run([
    [
      'a kept row stays when the next row starts a new page',
      [14],
      breakingSuccessor,
      [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1`, 'R4c1-1 R4c1-2 R4c2-1 TAIL1'],
    ],
    [
      'a kept row and the next row move together when they do not fit',
      [15],
      breakingSuccessor,
      [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, 'R3c1-1 R3c2-1 R4c1-1 R4c1-2 R4c2-1 TAIL1'],
    ],
    [
      'a kept row moves with a later kept row that asks for a new page',
      [15],
      P8 +
        table([
          row('R1'),
          row('R2', { keep: ALL }),
          row('R3', { keep: ALL, first: breaking('R3c1-', 1, true) }),
          row('R4', { lines: 2, cantSplit: true }),
        ]) +
        TAIL,
      [`${P} R1c1-1 R1c2-1`, 'R2c1-1 R2c2-1 R3c1-1 R3c2-1 R4c1-1 R4c1-2 R4c2-1 TAIL1'],
    ],
    [
      'a caption stays when the table starts a new page',
      [14, 15],
      para('P', 11) +
        CAP_AFTER +
        table([row('R1', { first: breaking('R1c1-') }), row('R2')]) +
        TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11 CAP1', 'R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a caption stays when the header row starts a new page',
      [14, 15],
      para('P', 11) +
        CAP +
        table([row('H', { header: true, first: breaking('Hc1-') }), row('R1'), row('R2')]) +
        TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11 CAP1', 'Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a caption moves with kept first rows and the next row when they do not fit',
      [15],
      keptFirstThenBreak,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11', 'CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a caption moves with a kept first row, and the next row starts a new page',
      [14],
      keptFirstThenBreak,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11', 'CAP1 R1c1-1 R1c2-1', 'R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a kept last row stays when the paragraph after the table starts a new page',
      [14, 15],
      para('P', 10) +
        table([row('R1'), row('R2', { keep: ALL })]) +
        para('Q', 2, { pageBreakBefore: true }) +
        TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 R1c1-1 R1c2-1 R2c1-1 R2c2-1', 'Q1 Q2 TAIL1'],
    ],
  ]);
});

const breakingRow = (name: string) =>
  row(name, { first: para(`${name}c1-`, 1, { pageBreakBefore: true }) });
/** A kept first row, a row that asks for a new page, and a plain row. */
const KB = [row('R1', { keep: ALL }), breakingRow('R2'), row('R3')];
const KB_ROWS = 'R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1';
const keptParas = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => para(`K${from + i}-`, 1, { keep: true })).join(
    ''
  );
const K_PARAS = 'K1-1 K2-1 K3-1 K4-1 K5-1 K6-1 K7-1 K8-1 K9-1';
const plainRows = (count: number) => Array.from({ length: count }, (_, i) => row(`S${i + 1}`));
const S_ROWS = Array.from({ length: 11 }, (_, i) => `S${i + 1}c1-1 S${i + 1}c2-1`).join(' ');
const HARD_BREAK =
  '<w:p><w:pPr><w:keepNext/><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:t>X1</w:t><w:br w:type="page"/><w:t>X2</w:t></w:r></w:p>';
const lastRowThenTable = (between: string) =>
  para('P', 7) +
  table([row('R0'), row('R1', { keep: ALL })]) +
  between +
  table([row('S1', { keep: ALL }), breakingRow('S2')]) +
  TAIL;
const SEVEN_R = 'P1 P2 P3 P4 P5 P6 P7 R0c1-1 R0c2-1 R1c1-1 R1c2-1 M1 S1c1-1 S1c2-1 S2c1-1 S2c2-1';

describe('from Word 2013 on, a row after a kept row does not start a new page', () => {
  run([
    [
      'the rows stay below a plain paragraph when they fit',
      [15],
      para('P', 2) + para('CAP') + table(KB) + TAIL,
      [`P1 P2 CAP1 ${KB_ROWS} TAIL1`],
    ],
    [
      'the row starts a new page before Word 2013',
      [14],
      para('P', 2) + para('CAP') + table(KB) + TAIL,
      ['P1 P2 CAP1 R1c1-1 R1c2-1', 'R2c1-1 R2c2-1 R3c1-1 R3c2-1 TAIL1'],
    ],
    [
      'the rows and a keepNext caption stay when they fit',
      [15],
      para('P', 2) + CAP + table(KB) + TAIL,
      [`P1 P2 CAP1 ${KB_ROWS} TAIL1`],
    ],
    [
      'the rows and header rows stay when they fit',
      [15],
      para('P', 2) + table([row('H', { header: true }), ...KB]) + TAIL,
      [`P1 P2 Hc1-1 Hc2-1 ${KB_ROWS} TAIL1`],
    ],
    [
      'the rows, header rows and a keepNext caption stay when they fit',
      [15],
      para('P', 2) + CAP + table([row('H', { header: true }), ...KB]) + TAIL,
      [`P1 P2 CAP1 Hc1-1 Hc2-1 ${KB_ROWS} TAIL1`],
    ],
    [
      'the rows stay after a long keep chain, and later rows go on',
      [15],
      para('P') + keptParas(1, 9) + table(KB) + TAIL,
      [`P1 ${K_PARAS} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, 'R3c1-1 R3c2-1 TAIL1'],
    ],
    [
      'the row starts a new page after a long keep chain before Word 2013',
      [14],
      para('P') + keptParas(1, 9) + table(KB) + TAIL,
      [`P1 ${K_PARAS} R1c1-1 R1c2-1`, 'R2c1-1 R2c2-1 R3c1-1 R3c2-1 TAIL1'],
    ],
    [
      'the rows stay after a keep chain whose last member does not keep',
      [15],
      para('P') + keptParas(1, 8) + para('K9-') + table(KB) + TAIL,
      [`P1 ${K_PARAS} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, 'R3c1-1 R3c2-1 TAIL1'],
    ],
    [
      'a kept last row keeps with a keepNext paragraph and the rows of the next table',
      [15],
      lastRowThenTable(para('M', 1, { keep: true })),
      [SEVEN_R, 'TAIL1'],
    ],
    [
      'a kept last row keeps with a plain paragraph, and the next table fits',
      [15],
      lastRowThenTable(para('M')),
      [SEVEN_R, 'TAIL1'],
    ],
    [
      'a caption follows the last lines of a split keepNext paragraph',
      [15],
      P8 + para('Q', 6, { keep: true, widow: true }) + CAP + table(KB) + TAIL,
      [`${P} Q1 Q2 Q3 Q4`, `Q5 Q6 CAP1 ${KB_ROWS} TAIL1`],
    ],
    [
      'a caption follows a paragraph that ends with a page break',
      [15],
      para('P', 3) + HARD_BREAK + CAP + table(KB) + TAIL,
      ['P1 P2 P3 X1', `X2 CAP1 ${KB_ROWS} TAIL1`],
    ],
    [
      'a table at the top of the document stays on one page',
      [15],
      table(KB) + TAIL,
      [`${KB_ROWS} TAIL1`],
    ],
    [
      'a table at the top of the document breaks before Word 2013',
      [14],
      table(KB) + TAIL,
      ['R1c1-1 R1c2-1', 'R2c1-1 R2c2-1 R3c1-1 R3c2-1 TAIL1'],
    ],
    [
      'a caption at the top of the document keeps the rows on its page',
      [15],
      CAP + table(KB) + TAIL,
      [`CAP1 ${KB_ROWS} TAIL1`],
    ],
    [
      'a kept row that starts a page keeps the next row below it',
      [15],
      para('P') +
        table([...plainRows(11), row('K', { keep: ALL }), breakingRow('B'), row('Z')]) +
        TAIL,
      [`P1 ${S_ROWS}`, 'Kc1-1 Kc2-1 Bc1-1 Bc2-1 Zc1-1 Zc2-1 TAIL1'],
    ],
    [
      'a kept row below repeated header rows keeps the next row below it',
      [15],
      table([
        row('H', { header: true }),
        ...plainRows(11),
        row('K', { keep: ALL }),
        breakingRow('B'),
        row('Z'),
      ]) + TAIL,
      [`Hc1-1 Hc2-1 ${S_ROWS}`, 'Hc1-1 Hc2-1 Kc1-1 Kc2-1 Bc1-1 Bc2-1 Zc1-1 Zc2-1 TAIL1'],
    ],
    [
      'a kept group taller than a page moves, and the next row follows its last row',
      [15],
      para('P', 3) +
        table([
          row('R0'),
          ...[1, 2, 3, 4, 5].map((i) => row(`K${i}`, { lines: 3, keep: ALL })),
          breakingRow('B'),
          row('Z'),
        ]) +
        TAIL,
      [
        'P1 P2 P3 R0c1-1 R0c2-1',
        [1, 2, 3, 4].map((i) => `K${i}c1-1 K${i}c1-2 K${i}c1-3 K${i}c2-1`).join(' '),
        'K5c1-1 K5c1-2 K5c1-3 K5c2-1 Bc1-1 Bc2-1 Zc1-1 Zc2-1 TAIL1',
      ],
    ],
    [
      'a kept group longer than the lookahead moves when it cannot fit',
      [15],
      para('P', 3) +
        table([
          row('R0'),
          ...Array.from({ length: 12 }, (_, i) => row(`K${i + 1}`, { keep: ALL })),
          breakingRow('B'),
          row('Z'),
        ]) +
        TAIL,
      [
        'P1 P2 P3 R0c1-1 R0c2-1',
        Array.from({ length: 12 }, (_, i) => `K${i + 1}c1-1 K${i + 1}c2-1`).join(' '),
        'Bc1-1 Bc2-1 Zc1-1 Zc2-1 TAIL1',
      ],
    ],
  ]);

  test('mode 15: a caption and the rows stay in the first of two columns when they fit', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const twoColumns = SECT.replace('w:w="7000"', 'w:w="9000"').replace(
      '</w:sectPr>',
      '<w:cols w:num="2" w:space="200"/></w:sectPr>'
    );
    const narrow = table(KB)
      .replace('w:w="6000"', 'w:w="4000"')
      .replaceAll('<w:gridCol w:w="3000"/>', '<w:gridCol w:w="2000"/>')
      .replaceAll('<w:tcW w:w="3000"', '<w:tcW w:w="2000"');
    const body = para('P', 3) + CAP + narrow + TAIL;
    const part = read(
      `<w:document xmlns:w="${W}"><w:body>${body}${twoColumns}</w:body></w:document>`,
      '/word/document.xml'
    );
    const layout = lay(part, 15);
    expect(pages(layout)).toEqual([`P1 P2 P3 CAP1 ${KB_ROWS} TAIL1`]);
    expect(layout.pages[0]!.fragments.every((fragment) => fragment.box.x < 100)).toBe(true);
  });
});

const keptHeaderBody =
  P8 +
  CAP +
  table([row('H', { header: true }), row('R1', { keep: ALL }), row('R2', { keep: ALL })]) +
  TAIL;
const mergedHeaderBody = [...mergedHeader, row('B1', { lines: 3 }), row('B2')];
const MERGED_BODY = 'B1c1-1 B1c1-2 B1c1-3 B1c2-1 B2c1-1 B2c2-1 TAIL1';

describe('a caption keeps through a table whose body rows all keep', () => {
  run([
    [
      'the caption moves with the kept rows and the paragraph after them',
      [14, 15],
      P8 +
        CAP +
        table([row('R1', { keep: ALL }), row('R2', { keep: ALL }), row('R3', { keep: ALL })]) +
        TAIL,
      [P, 'CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1 TAIL1'],
    ],
    [
      'the caption moves with a kept row and a keepLines paragraph after it',
      [14, 15],
      para('P', 10) + CAP + table([row('R1', { keep: ALL })]) + para('Q', 2, { keepLines: true }),
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10', 'CAP1 R1c1-1 R1c2-1 Q1 Q2'],
    ],
    [
      'the caption moves with the header rows and the kept body rows',
      [15],
      keptHeaderBody,
      [P, 'CAP1 Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'the caption stays with the header rows, and the kept body rows move below a repeat',
      [14],
      keptHeaderBody,
      [`${P} CAP1 Hc1-1 Hc2-1`, 'Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'the caption stays with the header rows, and a kept first row moves below a repeat',
      [14],
      P8 +
        CAP +
        table([
          row('H', { header: true }),
          row('R1', { keep: ALL }),
          row('R2', { lines: 3, cantSplit: true }),
        ]) +
        TAIL,
      [`${P} CAP1 Hc1-1 Hc2-1`, 'Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c1-2 R2c1-3 R2c2-1 TAIL1'],
    ],
    [
      'the caption moves with header rows that a vertical merge crosses',
      [15],
      para('P', 9) + CAP + table(mergedHeaderBody) + TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9', `CAP1 HAc1-1 HAc2-1 HBc2-1 ${MERGED_BODY}`],
    ],
    [
      'the caption stays with header rows that a vertical merge crosses',
      [14],
      para('P', 9) + CAP + table(mergedHeaderBody) + TAIL,
      [
        'P1 P2 P3 P4 P5 P6 P7 P8 P9 CAP1 HAc1-1 HAc2-1 HBc2-1',
        `HAc1-1 HAc2-1 HBc2-1 ${MERGED_BODY}`,
      ],
    ],
    [
      'header rows at a page top stay when the kept body group below them moves',
      [14],
      table([
        row('H', { header: true }),
        ...[1, 2, 3, 4].map((i) => row(`K${i}`, { lines: 3, keep: ALL })),
        row('R5', { lines: 2, cantSplit: true }),
      ]) + TAIL,
      [
        'Hc1-1 Hc2-1',
        'Hc1-1 Hc2-1 K1c1-1 K1c1-2 K1c1-3 K1c2-1 K2c1-1 K2c1-2 K2c1-3 K2c2-1 ' +
          'K3c1-1 K3c1-2 K3c1-3 K3c2-1 K4c1-1 K4c1-2 K4c2-1',
        'Hc1-1 Hc2-1 K4c1-3 R5c1-1 R5c1-2 R5c2-1 TAIL1',
      ],
    ],
    [
      'header rows that a vertical merge crosses stay and repeat',
      [14],
      para('P', 10) + table(mergedHeaderBody) + TAIL,
      [
        'P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 HAc1-1 HAc2-1 HBc2-1',
        `HAc1-1 HAc2-1 HBc2-1 ${MERGED_BODY}`,
      ],
    ],
    [
      'the caption moves through the first table and keeps with the second one',
      [14, 15],
      P8 +
        CAP +
        table([row('R1', { keep: ALL }), row('R2', { keep: ALL })]) +
        para('CAPB', 1, { keep: true }) +
        table([row('S1'), row('S2')]) +
        TAIL,
      [P, 'CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 CAPB1 S1c1-1 S1c2-1 S2c1-1 S2c2-1 TAIL1'],
    ],
    [
      'the caption stays when the rows it keeps with fit, and the table ends the chain',
      [14, 15],
      para('P', 7) + CAP + table([row('R1', { keep: ALL }), row('R2', { keep: ALL })]) + TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
  ]);
});

describe('a kept last row prices a following keep chain for the room it leaves', () => {
  for (const mode of [14, 15]) {
    test(`mode ${mode}: a keepNext paragraph that may split opens beside the row`, () => {
      const body =
        P8 +
        table([row('R1'), row('R2', { keep: ALL })]) +
        para('Q', 6, { keep: true, widow: true }) +
        TAIL;
      expect(pages(lay(load(body), mode))).toEqual([
        `${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 Q1 Q2`,
        'Q3 Q4 Q5 Q6 TAIL1',
      ]);
    });

    test(`mode ${mode}: a keepNext paragraph taller than a page opens beside the row`, () => {
      const body =
        P8 +
        table([row('R1'), row('R2', { keep: ALL })]) +
        para('Q', 14, { keep: true, widow: true }) +
        TAIL;
      const placed = pages(lay(load(body), mode));
      expect(placed[0]).toBe(`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 Q1 Q2`);
      expect(placed).toHaveLength(3);
    });
  }
});

describe('retained layout re-places what a table keep reads', () => {
  const bodyOf = (part: OoxmlPart) => {
    const body = part.root.children.find((child) => child.kind === 'body');
    if (body?.kind !== 'body') throw new Error('The fixture has no body.');
    return body;
  };
  const paragraphId = (part: OoxmlPart, text: string) => {
    const found = bodyOf(part).children.find(
      (child) => child.kind === 'paragraph' && JSON.stringify(child).includes(text)
    );
    if (!found) throw new Error(`The fixture has no ${text}.`);
    return found.id;
  };
  const GROWTH = 'word '.repeat(80);
  /** Seven kept one-line members after the table, then the eighth block `K7`. */
  const chain = (grown: boolean) =>
    Array.from({ length: 7 }, (_, i) => para(`K${i}_`, 1, { keep: true, keepLines: true })).join(
      ''
    ) +
    (grown
      ? `<w:p><w:pPr><w:keepLines/><w:widowControl w:val="0"/></w:pPr><w:r><w:t xml:space="preserve">${GROWTH}K7_1</w:t></w:r></w:p>`
      : para('K7_', 1, { keepLines: true }));

  /** Lay `before` out over a retained session, edit K7 to `after`, and compare with cold. */
  const edit = (head: string, grow: boolean, mode: number) => {
    const store = new TreeDocumentStore(load(head + chain(!grow) + TAIL));
    const session = createLayoutSession();
    const first = pages(lay(store.part, mode, { session }));
    const id = paragraphId(store.part, 'K7_1');
    const result = store.transact((tx) => {
      tx.apply(
        grow
          ? { op: 'insertText', paragraphId: id, offset: 0, text: GROWTH }
          : { op: 'deleteText', paragraphId: id, start: 0, end: GROWTH.length }
      );
    });
    expect(result.ok).toBe(true);
    const retained = pages(
      layoutSemanticDocument(store.part, 2, {
        measurer,
        styleCascade,
        compatibilityMode: mode,
        session,
      })
    );
    const cold = pages(lay(structuredClone(store.part), mode));
    expect(retained).toEqual(cold);
    return { first, cold };
  };

  for (const mode of [14, 15]) {
    for (const grow of [true, false]) {
      const verb = grow ? 'growing' : 'shrinking';
      test(`mode ${mode}: ${verb} the eighth block after a kept last row`, () => {
        let moved = 0;
        for (let filler = 1; filler <= 10; filler += 1) {
          const head = para('P', filler) + table([row('ROW', { keep: ALL })]);
          const { first, cold } = edit(head, grow, mode);
          const rowPage = (placed: string[]) => placed.findIndex((page) => page.includes('ROW'));
          if (rowPage(first) !== rowPage(cold)) moved += 1;
        }
        expect(moved).toBeGreaterThan(0);
      });

      test(`mode ${mode}: ${verb} a block that a caption reads through a kept table`, () => {
        let moved = 0;
        for (let filler = 1; filler <= 10; filler += 1) {
          const head = para('P', filler) + CAP + table([row('ROW', { keep: ALL })]);
          const { first, cold } = edit(head, grow, mode);
          const capPage = (placed: string[]) => placed.findIndex((page) => page.includes('CAP1'));
          if (capPage(first) !== capPage(cold)) moved += 1;
        }
        expect(moved).toBeGreaterThan(0);
      });
    }
  }
});

describe('retained layout re-places rows whose page break a kept row drops', () => {
  type Node = { readonly kind: string; readonly id?: string; readonly children?: readonly Node[] };
  /** The id of the paragraph, at any depth, whose text holds `text`. */
  const paragraphId = (node: Node, text: string): string | undefined => {
    if (node.kind === 'paragraph' && JSON.stringify(node).includes(`"${text}`)) return node.id;
    for (const child of node.children ?? []) {
      const found = paragraphId(child, text);
      if (found) return found;
    }
    return undefined;
  };
  const SPACING = [
    { localName: 'widowControl', attributes: { val: '0' } },
    {
      localName: 'spacing',
      attributes: { before: '0', after: '0', line: '280', lineRule: 'exact' },
    },
  ];
  /** Cell paragraph text, the property toggled, and whether it starts on. Retained layout
   * must equal cold layout after each edit, for captions at every height of the page. */
  const edits = [
    ['R1c1-1', 'keepNext', true],
    ['R1c1-1', 'keepNext', false],
    ['R2c1-1', 'pageBreakBefore', true],
    ['R2c1-1', 'pageBreakBefore', false],
  ] as const;
  for (const mode of [14, 15]) {
    for (const [text, property, on] of edits) {
      test(`mode ${mode}: turning ${property} ${on ? 'off' : 'on'} in ${text}`, () => {
        let moved = 0;
        for (let filler = 1; filler <= 11; filler += 1) {
          // The toggled property starts `on`; the other one is always set.
          const body =
            para('P', filler) +
            CAP +
            table([
              row('R1', {
                first: para('R1c1-', 1, { keep: property === 'keepNext' ? on : true }),
              }),
              row('R2', {
                first: para('R2c1-', 1, {
                  pageBreakBefore: property === 'pageBreakBefore' ? on : true,
                }),
              }),
              row('R3'),
            ]) +
            TAIL;
          const store = new TreeDocumentStore(load(body));
          const session = createLayoutSession();
          const before = pages(lay(store.part, mode, { session }));
          const id = paragraphId(store.part.root as Node, text);
          if (!id) throw new Error(`The fixture has no ${text}.`);
          const result = store.transact((tx) => {
            tx.apply({
              op: 'setParagraphProperties',
              paragraphId: id,
              properties: on ? SPACING : [{ localName: property }, ...SPACING],
            });
          });
          expect(result.ok).toBe(true);
          const retained = pages(
            layoutSemanticDocument(store.part, 2, {
              measurer,
              styleCascade,
              compatibilityMode: mode,
              session,
            })
          );
          const cold = pages(lay(structuredClone(store.part), mode));
          expect(retained).toEqual(cold);
          if (JSON.stringify(before) !== JSON.stringify(cold)) moved += 1;
        }
        // From Word 2013 on, the kept row decides whether the row's break applies, and a break
        // under a kept row changes nothing. Before Word 2013 the break always applies.
        expect(moved > 0).toBe((mode === 15) === (property === 'keepNext'));
      });
    }
  }
});

describe('keep-next flow keys around tables', () => {
  const keys = Array.from({ length: 20 }, (_, i) => `b${i}`);
  /** The raw keys folded into block `index`'s key, in order: each is `length:key`. */
  const reads = (flow: readonly string[], index: number): string[] => {
    const window = flow[index]!.slice(`b${index}~kn~`.length);
    const read: string[] = [];
    for (let at = 0; at < window.length;) {
      const length = /^\d+/.exec(window.slice(at))?.[0];
      if (length === undefined) {
        at += 1;
        continue;
      }
      const start = at + length.length + 1;
      read.push(window.slice(start, start + Number(length)));
      at = start + Number(length);
    }
    return read;
  };

  test('a table whose last row keeps reads the complete following chain', () => {
    const tables = new Set([2]);
    const flow = keepNextFlowKeys(
      keys,
      () => true,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(flow, 2)).toEqual(keys.slice(3));
  });

  test('a caption reads through a kept table to what the table reads', () => {
    const tables = new Set([3]);
    const flow = keepNextFlowKeys(
      keys,
      () => true,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(flow, 2)).toEqual(keys.slice(3));
  });

  test('a chain stops at a table that does not keep, and reads through one table only', () => {
    const tables = new Set([3, 6]);
    const plain = keepNextFlowKeys(
      keys,
      (at) => at !== 3,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(plain, 2)).toEqual(['b3']);
    const kept = keepNextFlowKeys(
      keys,
      () => true,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(kept, 2)).toEqual(['b3', 'b4', 'b5', 'b6']);
  });
});
