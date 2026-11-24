import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import { readTableStructure } from '../../layout/semantic-table.ts';
import { load, lay, row, table } from '../../layout/__tests__/table-row-keep-fixtures.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

test('typing preserves unchanged row elements and matches a cold paint', () => {
  const part = load(table(Array.from({ length: 30 }, (_, i) => row(`Row${i}`))));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const layout = lay(part, 15, { session, cache });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const before = Array.from(container.querySelectorAll('.docx-table-row'));
  const paragraphs = (rowElement: Element) =>
    Array.from(rowElement.querySelectorAll('.docx-paragraph-fragment'));
  const [edited, untouched] = paragraphs(before[3]!);
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const id = readTableStructure(node, 310, 0)!.rows[3]!.cells[0]!.blocks[0]!.id;
  const op = applyTreeOp(part, { op: 'insertText', paragraphId: id, offset: 0, text: 'X' });
  if (!op.ok) throw Error(op.reason);
  const updated = lay(op.part, 15, { session, cache });
  paintSemanticLayout(container, updated, { scale: 1 });
  const after = Array.from(container.querySelectorAll('.docx-table-row'));
  expect(after[0]).toBe(before[0]);
  // The edited row keeps its element; only the edited paragraph inside it is rebuilt.
  expect(after[3]).toBe(before[3]);
  expect(paragraphs(after[3]!)[0]).not.toBe(edited);
  expect(paragraphs(after[3]!)[1]).toBe(untouched);
  expect(after[4]).toBe(before[4]);
  const cold = document.createElement('div');
  paintSemanticLayout(cold, lay(op.part), { scale: 1 });
  expect(container.innerHTML).toBe(cold.innerHTML);
  paintSemanticLayout(container, updated, { scale: 2 });
  expect(container.querySelector('.docx-table-row')).not.toBe(after[0]);
});
