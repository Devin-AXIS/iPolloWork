// `w:pageBreakBefore` on a table row next to vertical merges. A row that continues a merge in
// any column ignores the property: merged text does not paginate across a row break, so the
// row keeps the placement it has without the property. A merge head row and a row after a
// merge ends still start a new page.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type SemanticLayoutOptions,
} from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const EPSILON = 0.001;
// 200pt wide, 300pt tall sheets with 10pt margins: a 180pt by 280pt content box.
const CONTENT_HEIGHT = 280;

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const load = (body: string) =>
  read(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, '/word/document.xml');

const options = (extra: Partial<SemanticLayoutOptions> = {}): SemanticLayoutOptions => ({
  measurer: createFixedMeasurer(6, 14),
  ...extra,
});
const lay = (body: string) => layoutSemanticDocument(load(body), 1, options());

const sect =
  '<w:sectPr><w:pgSz w:w="4000" w:h="6000"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const breakBefore = '<w:pageBreakBefore/>';
const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}` +
  `${text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : ''}</w:p>`;
const lead = (count: number) =>
  Array.from({ length: count }, (_, index) => paragraph(`lead${index}`)).join('');

interface Merge {
  readonly col: number;
  readonly from: number;
  readonly to: number;
  readonly lines: number;
}
interface Shape {
  readonly rows: number;
  readonly merges: readonly Merge[];
  /** Row whose first cell's first paragraph asks for a page break before. */
  readonly breakAt?: number;
  /** `w:trPr` content for each row. */
  readonly trPr?: (row: number) => string;
  readonly tblPr?: string;
}

/** Three 60pt columns. Merged heads hold `C{col}m{n}` lines; other cells hold `C{col}r{row}`. */
function mergeTable(shape: Shape): string {
  const rows: string[] = [];
  for (let r = 0; r < shape.rows; r += 1) {
    const cells: string[] = [];
    for (let c = 0; c < 3; c += 1) {
      const pPr = c === 0 && r === shape.breakAt ? breakBefore : '';
      const merge = shape.merges.find((m) => m.col === c && r >= m.from && r <= m.to);
      let vMerge = '';
      let content: string;
      if (merge && r === merge.from) {
        vMerge = '<w:vMerge w:val="restart"/>';
        content = Array.from({ length: merge.lines }, (_, n) =>
          paragraph(`C${c}m${n}`, n === 0 ? pPr : '')
        ).join('');
      } else if (merge) {
        vMerge = '<w:vMerge/>';
        content = paragraph('', pPr);
      } else {
        content = paragraph(`C${c}r${r}`, pPr);
      }
      cells.push(
        `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/>${vMerge}</w:tcPr>${content}</w:tc>`
      );
    }
    const trPr = shape.trPr?.(r) ?? '';
    rows.push(`<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`);
  }
  return (
    `<w:tbl><w:tblPr>${shape.tblPr ?? ''}<w:tblW w:w="3600" w:type="dxa"/>` +
    '<w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>' +
    `${rows.join('')}</w:tbl>`
  );
}

/** Every word the shape authors, in no particular order. */
function authoredWords(shape: Shape): string[] {
  const words: string[] = [];
  for (let r = 0; r < shape.rows; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const merge = shape.merges.find((m) => m.col === c && r >= m.from && r <= m.to);
      if (!merge) words.push(`C${c}r${r}`);
      else if (r === merge.from) {
        for (let n = 0; n < merge.lines; n += 1) words.push(`C${c}m${n}`);
      }
    }
  }
  return words;
}

const blockText = (block: BlockFragmentRecord): string[] =>
  block.kind === 'paragraph'
    ? block.lines.flatMap((line) =>
        line.spans
          .map((span) => span.text)
          .join('')
          .split(/\s+/)
      )
    : block.rows.flatMap((placed) => placed.cells.flatMap((c) => c.blocks.flatMap(blockText)));
const pageWords = (layout: SemanticLayout): string[][] =>
  layout.pages.map((page) => page.fragments.flatMap(blockText).filter((word) => word !== ''));
const tablesOf = (layout: SemanticLayout, pageIndex: number): TableFragmentRecord[] =>
  layout.pages[pageIndex]!.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );

/**
 * Every authored word is painted exactly once, every table fragment stays in the content box,
 * and every cell line stays inside its cell box.
 */
function expectEveryWordInsideItsBoxes(layout: SemanticLayout, words: readonly string[]): void {
  const painted = pageWords(layout).flat();
  for (const word of words) expect(painted.filter((seen) => seen === word)).toEqual([word]);
  for (let index = 0; index < layout.pages.length; index += 1) {
    for (const fragment of tablesOf(layout, index)) {
      expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(CONTENT_HEIGHT + EPSILON);
      for (const placed of fragment.rows) {
        for (const cell of placed.cells) {
          for (const block of cell.blocks) {
            if (block.kind !== 'paragraph') continue;
            for (const line of block.lines) {
              expect(line.box.y).toBeGreaterThanOrEqual(cell.box.y - EPSILON);
              expect(line.box.y + line.box.height).toBeLessThanOrEqual(
                cell.box.y + cell.box.height + EPSILON
              );
            }
          }
        }
      }
    }
  }
}

/**
 * Page records without each paragraph's authored property list, the only record the break
 * property itself changes.
 */
const placement = (layout: SemanticLayout): unknown =>
  JSON.parse(JSON.stringify(layout.pages, (key, value) => (key === 'props' ? undefined : value)));

/** The shape with the break property, and the same shape without it. */
function withAndWithout(shape: Shape, leadCount = 1) {
  const body = (breakAt: number | undefined) =>
    lead(leadCount) + mergeTable({ ...shape, breakAt }) + paragraph('tail') + sect;
  return { breaking: lay(body(shape.breakAt)), plain: lay(body(undefined)) };
}

const exactRow = '<w:trHeight w:val="400" w:hRule="exact"/>';

describe('a row page break before next to a vertical merge', () => {
  test('starts an ordinary row on a new page', () => {
    const shape: Shape = { rows: 4, merges: [], breakAt: 2 };
    const layout = lay(lead(1) + mergeTable(shape) + sect);
    expect(pageWords(layout)).toEqual([
      ['lead0', 'C0r0', 'C1r0', 'C2r0', 'C0r1', 'C1r1', 'C2r1'],
      ['C0r2', 'C1r2', 'C2r2', 'C0r3', 'C1r3', 'C2r3'],
    ]);
  });

  test('starts a merge head row on a new page with the whole merge', () => {
    const shape: Shape = { rows: 5, merges: [{ col: 1, from: 2, to: 4, lines: 5 }], breakAt: 2 };
    const layout = lay(lead(1) + mergeTable(shape) + sect);
    expect(pageWords(layout)).toEqual([
      ['lead0', 'C0r0', 'C1r0', 'C2r0', 'C0r1', 'C1r1', 'C2r1'],
      ['C0r2', 'C1m0', 'C1m1', 'C1m2', 'C1m3', 'C1m4', 'C2r2', 'C0r3', 'C2r3', 'C0r4', 'C2r4'],
    ]);
    expectEveryWordInsideItsBoxes(layout, [...authoredWords(shape), 'lead0']);
    // The rows the merge covers share its height: the head row does not take all of it.
    const [moved] = tablesOf(layout, 1);
    const [head, , last] = moved!.rows;
    expect(head!.box.height).toBeLessThan(last!.box.height);
  });

  test('starts the first row, a merge head, on a new page', () => {
    const shape: Shape = { rows: 4, merges: [{ col: 1, from: 0, to: 3, lines: 6 }], breakAt: 0 };
    const layout = lay(lead(1) + mergeTable(shape) + sect);
    expect(pageWords(layout)[0]).toEqual(['lead0']);
    expect(layout.pages).toHaveLength(2);
    expectEveryWordInsideItsBoxes(layout, [...authoredWords(shape), 'lead0']);
    const [moved] = tablesOf(layout, 1);
    expect(moved!.rows[0]!.box.height).toBeLessThan(20);
  });

  test('starts a row after a merge ends on a new page', () => {
    const shape: Shape = { rows: 5, merges: [{ col: 1, from: 0, to: 1, lines: 3 }], breakAt: 2 };
    const layout = lay(lead(1) + mergeTable(shape) + sect);
    expect(pageWords(layout)).toEqual([
      ['lead0', 'C0r0', 'C1m0', 'C1m1', 'C1m2', 'C2r0', 'C0r1', 'C2r1'],
      ['C0r2', 'C1r2', 'C2r2', 'C0r3', 'C1r3', 'C2r3', 'C0r4', 'C1r4', 'C2r4'],
    ]);
    expectEveryWordInsideItsBoxes(layout, [...authoredWords(shape), 'lead0']);
  });

  test('breaks a table style row break at merge heads and after merges only', () => {
    const tableStyle = buildStyleCascadeTable(
      read(
        `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="RowBreak">` +
          '<w:pPr><w:pageBreakBefore/></w:pPr></w:style></w:styles>',
        '/word/styles.xml'
      ).root
    );
    const shape: Shape = {
      rows: 4,
      merges: [{ col: 2, from: 1, to: 2, lines: 2 }],
      tblPr: '<w:tblStyle w:val="RowBreak"/>',
    };
    const layout = layoutSemanticDocument(
      load(lead(1) + mergeTable(shape) + sect),
      1,
      options({ styleCascade: tableStyle })
    );
    expect(pageWords(layout)).toEqual([
      ['lead0'],
      ['C0r0', 'C1r0', 'C2r0'],
      ['C0r1', 'C1r1', 'C2m0', 'C2m1', 'C0r2', 'C1r2'],
      ['C0r3', 'C1r3', 'C2r3'],
    ]);
  });
});

describe('a row page break before inside a vertical merge', () => {
  // Each shape crosses a merge at `breakAt`. The property is ignored, so the layout equals
  // the layout without it, and no merged line is lost or painted outside its cell.
  const crossing: Record<string, Shape> = {
    'merge in a later column, auto rows': {
      rows: 6,
      merges: [{ col: 1, from: 0, to: 5, lines: 6 }],
      breakAt: 2,
    },
    'merge in the first column, break on a continuation cell': {
      rows: 6,
      merges: [{ col: 0, from: 0, to: 3, lines: 4 }],
      breakAt: 2,
    },
    'merge on its last covered row': {
      rows: 4,
      merges: [{ col: 2, from: 0, to: 2, lines: 5 }],
      breakAt: 2,
    },
    'exact head row': {
      rows: 4,
      merges: [{ col: 1, from: 0, to: 3, lines: 2 }],
      breakAt: 2,
      trPr: (row) => (row === 0 ? exactRow : ''),
    },
    'every row exact': {
      rows: 4,
      merges: [{ col: 1, from: 0, to: 3, lines: 2 }],
      breakAt: 2,
      trPr: () => exactRow,
    },
    'exact rows above the break': {
      rows: 4,
      merges: [{ col: 1, from: 0, to: 3, lines: 4 }],
      breakAt: 2,
      trPr: (row) => (row < 2 ? exactRow : ''),
    },
    'long merge head over auto rows': {
      rows: 4,
      merges: [{ col: 1, from: 0, to: 3, lines: 6 }],
      breakAt: 2,
    },
    'nested merges, break crosses both': {
      rows: 6,
      merges: [
        { col: 1, from: 0, to: 5, lines: 6 },
        { col: 2, from: 1, to: 3, lines: 4 },
      ],
      breakAt: 2,
    },
    'nested merges, break crosses the outer merge only': {
      rows: 6,
      merges: [
        { col: 1, from: 0, to: 5, lines: 6 },
        { col: 2, from: 1, to: 3, lines: 4 },
      ],
      breakAt: 4,
    },
    'nested merges, break on the inner head row': {
      rows: 6,
      merges: [
        { col: 1, from: 0, to: 5, lines: 6 },
        { col: 2, from: 1, to: 3, lines: 4 },
      ],
      breakAt: 1,
    },
    'partial overlap': {
      rows: 5,
      merges: [
        { col: 1, from: 0, to: 2, lines: 3 },
        { col: 2, from: 1, to: 4, lines: 5 },
      ],
      breakAt: 3,
    },
  };

  for (const [name, shape] of Object.entries(crossing)) {
    test(`is ignored: ${name}`, () => {
      const { breaking, plain } = withAndWithout(shape);
      expect(placement(breaking)).toEqual(placement(plain));
      expectEveryWordInsideItsBoxes(breaking, [...authoredWords(shape), 'lead0', 'tail']);
    });
  }

  test('is ignored when the table starts at different heights on the page', () => {
    const shape = crossing['nested merges, break crosses both']!;
    const pageCounts: number[] = [];
    for (const leadCount of [0, 5, 12, 14, 16, 18]) {
      const { breaking, plain } = withAndWithout(shape, leadCount);
      pageCounts.push(breaking.pages.length);
      expect(placement(breaking)).toEqual(placement(plain));
      const leads = Array.from({ length: leadCount }, (_, index) => `lead${index}`);
      expectEveryWordInsideItsBoxes(breaking, [...authoredWords(shape), ...leads, 'tail']);
    }
    // The two lowest starts cross the page end, the last one inside the merged text.
    expect(pageCounts).toEqual([1, 1, 1, 1, 2, 2]);
  });
});

describe('retained layout of a row page break before next to a vertical merge', () => {
  const shapeAt = (breakAt: number | undefined): string =>
    lead(1) +
    mergeTable({
      rows: 6,
      merges: [
        { col: 1, from: 1, to: 3, lines: 5 },
        { col: 2, from: 1, to: 2, lines: 3 },
      ],
      breakAt,
    }) +
    paragraph('tail') +
    sect;

  test('matches a cold layout as the break moves in and out of the merge', () => {
    // None, head row, crossing, after the merge, first row, and back to none.
    const steps = [undefined, 1, 2, 4, 0, 3, undefined];
    const session = createLayoutSession();
    layoutSemanticDocument(load(shapeAt(steps[0])), 1, options({ session }));
    for (let index = 1; index < steps.length; index += 1) {
      const next = load(shapeAt(steps[index]));
      const warm = layoutSemanticDocument(next, index + 1, options({ session }));
      const cold = layoutSemanticDocument(next, index + 1, options());
      expect(warm.pages).toEqual(cold.pages);
    }
  });
});
