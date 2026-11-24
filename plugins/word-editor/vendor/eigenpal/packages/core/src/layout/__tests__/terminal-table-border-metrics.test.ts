import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import { prepareTerminalBorderPlan } from '../table-terminal-border-plan.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (side: string, width: number, text: string, extra = '', style = 'single') =>
  `<w:tc><w:tcPr><w:tcBorders><w:${side} w:val="${style}" w:sz="${width * 8}"/></w:tcBorders>${extra}</w:tcPr>${paragraph(text)}</w:tc>`;
function fixture(
  options: {
    rule?: string;
    prefix?: boolean;
    header?: boolean;
    ownStyle?: string;
    ownWidth?: number;
    nextWidth?: number;
  } = {}
) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${options.prefix ? paragraph('Prefix') : ''}
    <w:tbl><w:tblPr><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr>
    <w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>
    ${options.header ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('bottom', 2, 'Header')}</w:tr>` : ''}
    <w:tr><w:trPr><w:cantSplit/>${options.rule ? `<w:trHeight w:val="400" w:hRule="${options.rule}"/>` : ''}</w:trPr>${cell('bottom', options.ownWidth ?? 0.5, 'Before', '<w:vAlign w:val="bottom"/>', options.ownStyle)}</w:tr>
    <w:tr><w:trPr><w:cantSplit/></w:trPr>${cell('top', options.nextWidth ?? 6, 'After')}</w:tr>
    </w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const measurer = createFixedMeasurer(5, 12);
function run(part: ReturnType<typeof fixture>, height: number) {
  const before = serializeOoxmlPart(part);
  const options = {
    measurer,
    session: createLayoutSession(),
    geometry: { width: 150, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  };
  const result = layoutSemanticDocument(part, 0, options);
  expect(layoutSemanticDocument(part, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(part)).toBe(before);
  for (const page of result.pages)
    for (const fragment of page.fragments)
      expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(height + 0.001);
  return result;
}
function tables(result: ReturnType<typeof run>, page: number) {
  return result.pages[page]!.fragments.filter((f) => f.kind === 'table');
}
for (const rule of [undefined, 'atLeast', 'exact']) {
  test(`the last ${rule ?? 'auto'} row clears its own border and retains vertical alignment`, () => {
    const result = run(fixture({ rule }), rule ? 34 : 29);
    expect(result.pages).toHaveLength(2);
    const before = tables(result, 0)[0]!.rows[0]!.cells[0]!;
    // An exact row keeps its authored 20pt and closes the page with its 0.5pt rule below it.
    expect(before.box.height).toBeCloseTo(rule ? 20.5 : 12.5, 6);
    const block = before.blocks[0]!;
    expect(before.box.y + before.box.height - block.box.y - block.box.height).toBeCloseTo(0.5, 6);
    expect(before.borders!.bottom!.widthPt).toBe(0.5);
    const after = tables(result, 1)[0]!.rows[0]!.cells[0]!;
    expect(after.blocks[0]!.box.y - after.box.y).toBeCloseTo(6, 6);
  });
}
test('terminal-edge admission retains a row after preceding body content', () => {
  const result = run(fixture({ prefix: true }), 25);
  // Pages through the table; the empty paragraph the body reads after it may take one more.
  expect(
    result.pages.findLastIndex((page) => page.fragments.some((f) => f.kind === 'table')) + 1
  ).toBe(2);
  expect(tables(result, 0)[0]!.rows[0]!.box.y).toBe(12);
  const texts = result.pages.map((page) =>
    page.fragments
      .flatMap((f) =>
        f.kind === 'table' ? f.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks)) : [f]
      )
      .flatMap((b) =>
        b.kind === 'paragraph' ? b.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
      )
  );
  // The last page holds only the empty paragraph the body reads after the table.
  expect(texts).toEqual([['Prefix', 'Before'], ['After'], []]);
});
test('terminal clearance preserves the incoming repeated-header boundary', () => {
  const result = run(fixture({ header: true }), 39);
  expect(
    result.pages.findLastIndex((page) => page.fragments.some((f) => f.kind === 'table')) + 1
  ).toBe(2);
  const cell = tables(result, 0)[0]!.rows[1]!.cells[0]!;
  // The row under the header authors no top rule of its own, so it inherits the rule the
  // grid resolves for it — the header's 2pt bottom — and carries the whole band.
  expect(cell.blocks[0]!.box.y - cell.box.y).toBeCloseTo(2, 6);
  expect(cell.box.height).toBeCloseTo(14.5, 6);
  expect(tables(result, 1)[0]!.rows[0]!.isHeaderRepeat).toBe(true);
});
test('a wider own patterned edge can grow the terminal row within the page', () => {
  const result = run(fixture({ ownStyle: 'dotted', ownWidth: 12, nextWidth: 0.5 }), 24);
  expect(result.pages).toHaveLength(2);
  const cell = tables(result, 0)[0]!.rows[0]!.cells[0]!;
  expect(cell.box.height).toBeCloseTo(24, 6);
  expect(cell.borders!.bottom!.widthPt).toBe(12);
});
test('terminal probes neither publish nor spend live identifiers and budgets', () => {
  const part = fixture();
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body')!;
  if (body.kind === 'textValue') throw new Error('body');
  const table = body.children.find((n) => n.kind === 'table')!;
  const structure = readTableStructure(table, 150, 0)!;
  let spent = 0;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const cacheBefore = { ...cache.stats };
  const borders = { intervalsRemaining: 100 },
    merges = { cellsRemaining: 100 };
  const deps = {
    measurer,
    producer: 'test',
    cache,
    borderOwnershipBudget: borders,
    vMergeResolveBudget: merges,
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
  expect(prepareTerminalBorderPlan(structure, structure.rows[0]!, 0, 0, 13, deps)!.height).toBe(
    12.5
  );
  expect(prepareTerminalBorderPlan(structure, structure.rows[0]!, 0, 0, 11, deps)).toBeUndefined();
  expect(spent).toBe(0);
  expect(borders.intervalsRemaining).toBe(100);
  expect(merges.cellsRemaining).toBe(100);
  expect(cache.stats).toEqual(cacheBefore);
});
