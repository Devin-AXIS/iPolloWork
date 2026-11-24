// The table select handle: when it shows, which table it names, and what clicking it selects.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceOptions,
} from '../paginated-surface.ts';
import { docx, paragraph as p } from './paginated-surface-fixtures.ts';
import { paragraphTextFromLayout } from '../../layout/semantic-interaction.ts';

const tc = (content: string) => `<w:tc>${content}</w:tc>`;
const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;
const grid = (...widths: number[]) =>
  `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

const TABLE = `<w:tbl>${grid(3000, 3000)}${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>`;
const NESTED = `<w:tbl>${grid(4000, 2000)}${tr(
  tc(`<w:tbl>${grid(1500, 1500)}${tr(tc(p('I1')) + tc(p('I2')))}</w:tbl>${p('outer')}`) +
    tc(p('right'))
)}</w:tbl>`;

const mountedContainers: HTMLElement[] = [];
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  for (const container of mountedContainers.splice(0)) container.remove();
});

function mount(body: string, options: PaginatedSurfaceOptions = {}, scale = 1) {
  const container = document.createElement('div');
  document.body.append(container);
  mountedContainers.push(container);
  const result = mountPaginatedSurface(container, docx(body), { scale, ...options });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const surface = result.surface;
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }),
  });
  const handle = () => container.querySelector<HTMLButtonElement>('.docx-table-select-handle');
  const caretAtText = (text: string) => {
    const paragraphId = surface.session
      .paragraphIds()
      .find((id) => paragraphTextFromLayout(surface.layout(), id) === text)!;
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
  };
  return { surface, container, pages, handle, caretAtText };
}

function outerTable(surface: PaginatedSurface) {
  const table = surface.layout().pages[0]!.fragments.find((f) => f.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table');
  return table;
}

function moveTo(surface: PaginatedSurface, contentX: number, contentY: number): void {
  const page = surface.layout().pages[0]!;
  document.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: page.contentBox.x + contentX,
      clientY: page.contentBox.y + contentY,
    })
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('table select handle', () => {
  test('shows while the caret is in the table, labelled and placed at its top-left corner', () => {
    const { surface, handle, caretAtText } = mount(`${p('before')}${TABLE}`);
    caretAtText('before');
    expect(handle()).toBeNull();

    caretAtText('B2');
    const shown = handle()!;
    const table = outerTable(surface);
    const page = surface.layout().pages[0]!;
    expect(shown.dataset.tableId).toBe(table.tableId);
    expect(shown.getAttribute('aria-label')).toBe('Select entire table');
    expect(shown.querySelector('svg path')).not.toBeNull();
    expect(shown.textContent).toBe('');
    expect(parseFloat(shown.style.left)).toBeCloseTo(page.contentBox.x + table.box.x - 18);
    expect(parseFloat(shown.style.top)).toBeCloseTo(page.contentBox.y + table.box.y - 18);
  });

  test('keeps the same 2px gap to the table at any zoom', () => {
    const { surface, handle, caretAtText } = mount(TABLE, {}, 2);
    caretAtText('A1');
    const table = outerTable(surface);
    const page = surface.layout().pages[0]!;
    expect(parseFloat(handle()!.style.left)).toBeCloseTo(
      (page.contentBox.x + table.box.x) * 2 - 18
    );
    expect(parseFloat(handle()!.style.top)).toBeCloseTo((page.contentBox.y + table.box.y) * 2 - 18);
  });

  test('shows on hover and hides after the pointer leaves the table', async () => {
    const { surface, handle, caretAtText } = mount(`${p('before')}${TABLE}${p('after')}`);
    caretAtText('before');
    const table = outerTable(surface);
    moveTo(surface, table.box.x + 20, table.box.y + 5);
    expect(handle()?.dataset.tableId).toBe(table.tableId);

    moveTo(surface, table.box.x + 20, table.box.y + table.box.height + 60);
    expect(handle()).not.toBeNull();
    await sleep(200);
    expect(handle()).toBeNull();
  });

  test('names the outermost table from a nested one', () => {
    const { surface, handle, caretAtText } = mount(NESTED);
    caretAtText('I2');
    expect(handle()?.dataset.tableId).toBe(outerTable(surface).tableId);
  });

  test('click selects every cell of the table and keeps the document unchanged', () => {
    const { surface, handle, caretAtText } = mount(NESTED);
    const revision = surface.session.packageRevision();
    caretAtText('I1');
    handle()!.click();
    const cells = surface.state().cellSelection;
    expect(cells?.tableId).toBe(outerTable(surface).tableId);
    expect(cells?.cellIds).toHaveLength(2);
    expect(surface.session.packageRevision()).toBe(revision);
    expect(handle()).not.toBeNull();
  });

  test('hides in view mode', () => {
    const { surface, handle, caretAtText } = mount(TABLE);
    caretAtText('A1');
    expect(handle()).not.toBeNull();
    surface.setEditingMode('view');
    expect(handle()).toBeNull();
  });

  test('takes its label from the host translator', () => {
    const { surface, handle, caretAtText } = mount(TABLE, {
      tableInteractionLabel: (key) => `t:${key}`,
    });
    caretAtText('A1');
    expect(handle()?.getAttribute('aria-label')).toBe('t:table.selectTable');
    surface.setTableInteractionLabel((key) => `u:${key}`);
    expect(handle()?.getAttribute('aria-label')).toBe('u:table.selectTable');
  });
});
