import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { describe, expect, test } from 'bun:test';
import { keptRowGroup, type KeptRowSource } from '../table-row-keeps.ts';
import { measureKeptMergeRows } from '../table-kept-merge-measure.ts';
import { readTableStructure } from '../semantic-table.ts';
import { measureRowHeight } from '../semantic-table-layout.ts';
import type { SemanticTableRow } from '../semantic-table.ts';
import {
  lay,
  read,
  SECT,
  W,
  para,
  row,
  table,
  pages,
  ALL,
  measurer,
} from './table-row-keep-fixtures.ts';

const caption = para('Caption', 1, { keep: true });
const load = (body: string) =>
  read(
    `<w:document xmlns:w="${W}"><w:body>${body}${SECT.replace('4200', '9200')}</w:body></w:document>`,
    '/word/document.xml'
  );
const rows = (count: number, merged: boolean, headLines = 1) =>
  Array.from({ length: count }, (_, index) =>
    row(`R${index}-`, {
      keep: index < count - 1 ? ALL : undefined,
      first:
        merged && index > 0
          ? para('', 1, { keep: index < count - 1 }).replace('<w:t>1</w:t>', '<w:t/>')
          : para(`H${index}-`, index === 0 ? headLines : 1, { keep: index < count - 1 }),
      firstTcPr: merged ? (index === 0 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '',
    })
  );

for (const mode of [14, 15]) {
  describe(`kept merge groups in mode ${mode}`, () => {
    for (const [count, merged] of [
      [4, true],
      [14, false],
      [14, true],
    ] as const) {
      test(`${count} rows, merged=${merged}: the caption and complete group move`, () => {
        const body =
          para('P', count === 4 ? 26 : 17) + caption + table(rows(count, merged)) + para('Tail');
        const result = pages(lay(load(body), mode));
        expect(result).toHaveLength(2);
        expect(result[0]).not.toContain('Caption');
        expect(result[1]).toContain('Caption1');
        expect(result[1]).toContain(`R${count - 1}-c2-1`);
        expect(result[1]).toContain('Tail1');
        const words = result.join(' ').split(' ');
        expect(new Set(words).size).toBe(words.length);
      });
    }
    test('merged content is charged once when the group fits', () => {
      const result = pages(lay(load(para('P', 23) + caption + table(rows(4, true, 5))), mode));
      // The empty paragraph the body reads after the table takes the next page.
      expect(result.slice(1).join('').trim()).toBe('');
      expect(result[0]).toContain('H0-5');
      expect(result[0]).toContain('R3-c2-1');
    });
    for (const merged of [false, true])
      test(`an oversized group makes progress, merged=${merged}`, () => {
        const result = pages(
          lay(load(para('P') + caption + table(rows(34, merged)) + para('Tail')), mode)
        );
        expect(result).toHaveLength(mode === 14 ? 3 : 4);
        expect(result[0]).toBe('P1');
        expect(result[1]).toContain('Caption1');
        expect(result[mode === 14 ? 1 : 2]).toContain('H0-1');
        expect(result.at(-1)).toContain('R33-c2-1');
        expect(result.at(-1)).toContain('Tail1');
        const words = result.join(' ').split(' ');
        expect(new Set(words).size).toBe(words.length);
      });
  });
}

test('table measurement stops at its work ceiling, independently of paragraph lookahead', () => {
  let probes = 0;
  const source: KeptRowSource = {
    rows: Array.from(
      { length: 300 },
      (_, i) => ({ id: `r${i}`, cells: [] }) as unknown as SemanticTableRow
    ),
    keepsAt: () => true,
    breaksAt: () => false,
    heightOf: () => {
      probes += 1;
      return 1;
    },
    placesWhole: () => true,
    openingOf: () => 1,
    opensWithin: () => true,
    following: () => 0,
  };
  expect(keptRowGroup(source, 0)).toEqual({ end: 255, kept: 256, successor: 1, truncated: true });
  expect(probes).toBe(257);
  for (let start = 1; start < source.rows.length; start += 1) {
    expect(keptRowGroup(source, start)).toBeNull();
  }
  expect(probes).toBe(257);
});

for (const merged of [false, true]) {
  test(`a 300-row chain remains bounded and retains all rows, merged=${merged}`, () => {
    const result = pages(lay(load(para('P') + caption + table(rows(300, merged)) + para('Tail'))));
    if (merged) expect(result.length).toBeLessThanOrEqual(12);
    else {
      expect(result).toHaveLength(13);
      expect(result.slice(0, 2)).toEqual(['P1', 'Caption1']);
    }
    expect(result.join(' ')).toContain('R299-c2-1');
    const words = result.join(' ').split(' ');
    expect(new Set(words).size).toBe(words.length);
  });
}

test('merge admission probes do not spend live identifiers or publish callbacks', () => {
  const part = load(table(rows(4, true, 5)));
  const body = part.root.children.find((n) => n.kind === 'body')!;
  if (body.kind !== 'body') throw new Error('body');
  const tableNode = body.children.find((n) => n.kind === 'table')!;
  const structure = readTableStructure(tableNode, 310, 0)!;
  let spent = 0;
  const deps = {
    measurer,
    producer: 'test',
    nextLineId: () => {
      spent++;
      return 'live';
    },
    collectAnchoredDrawings: () => {
      spent++;
    },
    onCellBreakKey: () => {
      spent++;
    },
  };
  const heights = measureKeptMergeRows(structure, structure.rows, 0, 3, 0, deps, (index) =>
    measureRowHeight(structure.rows[index]!, structure.columnWidthsPt, 0, 0, deps)
  );
  expect(heights?.reduce((a, b) => a + b, 0)).toBeCloseTo(70, 4);
  expect(spent).toBe(0);
});

test('closed merge admission preserves source and retained layout', () => {
  const part = load(para('P', 17) + caption + table(rows(14, true)) + para('Tail'));
  const before = serializeOoxmlPart(part);
  const session = createLayoutSession();
  const cold = pages(lay(part, 15, { session }));
  expect(pages(lay(part, 15, { session }))).toEqual(cold);
  expect(serializeOoxmlPart(part)).toBe(before);
  expect(pages(lay(read(before, '/word/document.xml')))).toEqual(cold);
});
