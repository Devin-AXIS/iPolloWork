import type { SectionPrepass } from '../section-prepass-types.ts';
import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { load, lay, row, table } from './table-row-keep-fixtures.ts';

for (const position of [0, 3, 17, 29]) {
  for (const text of ['X', 'long content '.repeat(30)]) {
    test(`incremental table edit equals cold layout at row ${position}, length ${text.length}`, () => {
      const part = load(table(Array.from({ length: 30 }, (_, i) => row(`Row${i}`))));
      const session = createLayoutSession();
      const cache = createParagraphLayoutCache();
      const before = lay(part, 15, { session, cache });
      const beforeOrder = (session.prepass as SectionPrepass).paragraphDocumentOrder;
      const body = part.root.children.find((n) => n.kind === 'body')!;
      const node = body.children.find((n) => n.kind === 'table')! as OoxmlElement;
      const structure = readTableStructure(node, 310, 0)!;
      const paragraphId = structure.rows[position]!.cells[0]!.blocks[0]!.id;
      const op = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text });
      if (!op.ok) throw Error(op.reason);
      const edited = lay(op.part, 15, { session, cache });
      expect((session.prepass as SectionPrepass).paragraphDocumentOrder).toBe(beforeOrder);
      expect(edited.pages).toEqual(lay(op.part).pages);
      if (position === 3 && text === 'X') {
        expect(edited.pages.slice(1).every((page, i) => page === before.pages[i + 1])).toBe(true);
      }
      const restored = lay(part, 15, { session, cache });
      expect(restored.pages).toEqual(lay(part).pages);
    });
  }
}

test('a row text update reuses other pages by identity', async () => {
  const { updateTableText } = await import('../table-text-update.ts');
  const { measurer, styleCascade } = await import('./table-row-keep-fixtures.ts');
  const part = load(table(Array.from({ length: 30 }, (_, i) => row(`Row${i}`))));
  const before = lay(part);
  const body = part.root.children.find((n) => n.kind === 'body')!;
  const node = body.children.find((n) => n.kind === 'table')! as OoxmlElement;
  const structure = readTableStructure(node, 310, 0, styleCascade)!;
  const paragraphId = structure.rows[3]!.cells[0]!.blocks[0]!.id;
  const op = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text: 'X' });
  if (!op.ok) throw Error(op.reason);
  const next = op.part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const updated = updateTableText(node, next, before.pages, 310, {
    measurer,
    styleCascade,
    producer: 'test',
    nextLineId: () => '',
    displayMode: 'all-markup',
    compatibilityMode: 15,
  });
  expect(updated).not.toBeNull();
  expect(updated!.pages).toEqual(lay(op.part).pages);
});

test('wrapping within an existing row height preserves later checkpoint counters', async () => {
  const { para } = await import('./table-row-keep-fixtures.ts');
  const part = load(
    table(Array.from({ length: 30 }, (_, i) => row(`Row${i}`, { first: para('long', 4) })))
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  const source = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const structure = readTableStructure(source, 310, 0)!;
  const id = structure.rows[3]!.cells[1]!.blocks[0]!.id;
  const edited = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: id,
    offset: 0,
    text: 'extra words that wrap into another line ',
  });
  if (!edited.ok) throw Error(edited.reason);
  expect(lay(edited.part, 15, { session, cache }).pages).toEqual(lay(edited.part).pages);
  const cold = createLayoutSession();
  lay(edited.part, 15, { session: cold });
  expect(session.endLineCounter).toBe(cold.endLineCounter);
  expect(session.checkpoints.map((c) => c.lineCounter)).toEqual(
    cold.checkpoints.map((c) => c.lineCounter)
  );
});

test('a split row text update matches a cold layout on every continuation page', async () => {
  const { updateTableText } = await import('../table-text-update.ts');
  const { measurer, styleCascade } = await import('./table-row-keep-fixtures.ts');
  const part = load(table([row('Long', { lines: 30 }), row('Tail')]));
  const before = lay(part);
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const structure = readTableStructure(node, 310, 0, styleCascade)!;
  const paragraphId = structure.rows[0]!.cells[0]!.blocks[0]!.id;
  const op = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text: 'X' });
  if (!op.ok) throw Error(op.reason);
  const next = op.part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  expect(before.pages.length).toBeGreaterThan(2);
  const updated = updateTableText(node, next, before.pages, 310, {
    measurer,
    styleCascade,
    producer: 'test',
    nextLineId: () => '',
    displayMode: 'all-markup',
    compatibilityMode: 15,
  });
  expect(updated).not.toBeNull();
  expect(updated!.pages).toEqual(lay(op.part).pages);
});

test('successive AutoFit width changes match separately parsed layouts', async () => {
  const { para } = await import('./table-row-keep-fixtures.ts');
  const { serializeOoxmlPart, readOoxmlPart } = await import('@docx-editor.dev/core/store');
  const borders =
    '<w:tblBorders>' +
    ['left', 'right', 'insideV'].map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`).join('') +
    '</w:tblBorders>';
  let part = load(
    table(
      Array.from({ length: 30 }, (_, i) =>
        row(`Row${i}`, i === 3 ? { first: para('X'.repeat(45)) } : {})
      ),
      borders
    ).replace('<w:tblLayout w:type="fixed"/>', '')
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const paragraphId = readTableStructure(node, 310, 0)!.rows[3]!.cells[0]!.blocks[0]!.id;
  let previous = lay(part, 15, { session, cache });
  let widthChanges = 0;
  for (const character of 'Width changes ') {
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text: character });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const updated = lay(part, 15, { session, cache });
    const parsed = readOoxmlPart(serializeOoxmlPart(part), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!parsed.ok) throw Error(parsed.reason);
    expect(updated.pages).toEqual(lay(parsed.part).pages);
    const oldTable = previous.pages[0]!.fragments.find((f) => f.kind === 'table')!;
    const newTable = updated.pages[0]!.fragments.find((f) => f.kind === 'table')!;
    if (JSON.stringify(oldTable.columnEdges) !== JSON.stringify(newTable.columnEdges))
      widthChanges++;
    previous = updated;
  }
  expect(widthChanges).toBeGreaterThan(1);
});
