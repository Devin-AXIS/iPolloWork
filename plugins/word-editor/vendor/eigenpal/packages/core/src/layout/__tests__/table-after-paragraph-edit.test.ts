import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { movedRowsTestRecorder, shiftedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import { load, lay, para, row, table } from './table-row-keep-fixtures.ts';

const fixture = () =>
  load(para('Before') + table(Array.from({ length: 36 }, (_, i) => row(`R${i}`))) + para('After'));
const firstParagraph = (part: ReturnType<typeof fixture>) =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'paragraph')!.id;

function split(part: ReturnType<typeof fixture>, id: string) {
  const result = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id, offset: 1 });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}

test('repeated paragraph splits and undo reuse following table rows with exact geometry', () => {
  let part = fixture();
  const initial = part;
  const id = firstParagraph(part);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  // Establish the settled cache producer before changing the document.
  lay(part, 15, { session, cache });
  const moved = movedRowsTestRecorder();
  const shifted = shiftedRowsTestRecorder();
  try {
    for (let index = 0; index < 3; index++) {
      const before = moved.moved + shifted.moved;
      part = split(part, id);
      const result = lay(part, 15, { session, cache });
      expect(moved.moved + shifted.moved - before).toBeGreaterThan(12);
      expect(JSON.stringify(result.pages)).toBe(JSON.stringify(lay(part).pages));
    }
    const before = moved.moved + shifted.moved;
    const restored = lay(initial, 15, { session, cache });
    expect(moved.moved + shifted.moved - before).toBeGreaterThan(12);
    expect(JSON.stringify(restored.pages)).toBe(JSON.stringify(lay(initial).pages));
  } finally {
    moved.dispose();
    shifted.dispose();
  }
});

test("another session cannot consume the first session's unchanged table rows", () => {
  const part = fixture();
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  lay(part, 15, { session, cache });
  const edited = split(part, firstParagraph(part));
  lay(edited, 15, { session, cache });
  const moved = movedRowsTestRecorder();
  const shifted = shiftedRowsTestRecorder();
  try {
    const other = lay(edited, 15, {
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    });
    expect(moved.moved + shifted.moved).toBe(0);
    expect(JSON.stringify(other.pages)).toBe(JSON.stringify(lay(edited).pages));
  } finally {
    moved.dispose();
    shifted.dispose();
  }
});

test('a changed producer disables row reuse after a paragraph split', () => {
  const part = fixture();
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  lay(part, 15, { session, cache });
  const edited = split(part, firstParagraph(part));
  const moved = movedRowsTestRecorder();
  const shifted = shiftedRowsTestRecorder();
  try {
    const result = lay(edited, 15, { session, cache, producer: 'different-producer' });
    expect(moved.moved + shifted.moved).toBe(0);
    expect(JSON.stringify(result.pages)).toBe(
      JSON.stringify(lay(edited, 15, { producer: 'different-producer' }).pages)
    );
  } finally {
    moved.dispose();
    shifted.dispose();
  }
});

test('a changed table node is not reused after a paragraph split', () => {
  const part = fixture();
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const initial = lay(part, 15, { session, cache });
  lay(part, 15, { session, cache });
  const tableRecord = initial.pages
    .flatMap((page) => page.fragments)
    .find((block) => block.kind === 'table')!;
  if (tableRecord.kind !== 'table') throw Error('Missing table');
  const edited = split(part, firstParagraph(part));
  const change = applyTreeOp(edited, {
    op: 'setTableCellFill',
    tableId: tableRecord.tableId,
    cellIds: [tableRecord.rows[0]!.cells[0]!.id],
    color: { kind: 'hex', value: 'FFFF00' },
  });
  if (!change.ok) throw Error(change.reason);
  const moved = movedRowsTestRecorder();
  const shifted = shiftedRowsTestRecorder();
  try {
    const result = lay(change.part, 15, { session, cache });
    expect(moved.moved + shifted.moved).toBe(0);
    expect(JSON.stringify(result.pages)).toBe(JSON.stringify(lay(change.part).pages));
  } finally {
    moved.dispose();
    shifted.dispose();
  }
});

test.each([false, true])(
  'numbered splits preserve table geometry and list labels (table list=%s)',
  async (tableList) => {
    const { buildNumberingIndex } = await import('../numbering-index.ts');
    const { read, W } = await import('./table-row-keep-fixtures.ts');
    const numberingIndex = buildNumberingIndex(
      read(
        `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
        '/word/numbering.xml'
      ).root
    );
    const numbered = (xml: string) =>
      xml.replaceAll(
        '<w:pPr>',
        '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
      );
    const rows = table(Array.from({ length: 36 }, (_, i) => row(`R${i}`)));
    const part = load(numbered(para('Before')) + (tableList ? numbered(rows) : rows));
    const session = createLayoutSession(),
      cache = createParagraphLayoutCache();
    const options = { session, cache, numberingIndex };
    lay(part, 15, options);
    lay(part, 15, options);
    const moved = movedRowsTestRecorder(),
      shifted = shiftedRowsTestRecorder();
    try {
      const edited = split(part, firstParagraph(part));
      const result = lay(edited, 15, options);
      expect(JSON.stringify(result.pages)).toBe(
        JSON.stringify(lay(edited, 15, { numberingIndex }).pages)
      );
      if (!tableList) expect(moved.moved + shifted.moved).toBeGreaterThan(12);
      else expect(moved.moved + shifted.moved).toBe(0);
    } finally {
      moved.dispose();
      shifted.dispose();
    }
  }
);
