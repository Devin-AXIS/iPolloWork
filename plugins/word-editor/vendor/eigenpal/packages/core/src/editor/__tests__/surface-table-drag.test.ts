// Dragging a table by its select handle: where it lands, and when it does not move at all.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, paragraph as p } from './paginated-surface-fixtures.ts';
import { paragraphTextFromLayout } from '../../layout/semantic-interaction.ts';
import { SUGGESTING_TABLE_MOVE_REFUSAL } from '../surface-suggesting-structure.ts';
import { nearestTableDropSlot, type TableDropSlot } from '../surface-table-drop-slots.ts';

const table = (props = '') =>
  `<w:tbl>${props}<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${p('cell')}</w:tc></w:tr></w:tbl>`;
const BODY = p('one') + table() + p('two') + p('three');

const mountedContainers: HTMLElement[] = [];
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  for (const container of mountedContainers.splice(0)) container.remove();
});

function mount(body = BODY) {
  const container = document.createElement('div');
  document.body.append(container);
  mountedContainers.push(container);
  const result = mountPaginatedSurface(container, docx(body), { scale: 1, author: 'Mover' });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const surface = result.surface;
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }),
  });
  const paragraphWith = (text: string) =>
    surface.session
      .paragraphIds()
      .find((id) => paragraphTextFromLayout(surface.layout(), id) === text)!;
  const caretIn = (text: string) => {
    const paragraphId = paragraphWith(text);
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
  };
  caretIn('cell');
  const handle = () => container.querySelector<HTMLButtonElement>('.docx-table-select-handle')!;
  const indicator = () => container.querySelector('.docx-table-drop-indicator');
  return { surface, handle, indicator, paragraphWith, caretIn };
}

/** Body-level blocks, tables as `[T]`. */
function order(surface: PaginatedSurface): string[] {
  return surface
    .layout()
    .pages[0]!.fragments.map((fragment) =>
      fragment.kind === 'table'
        ? '[T]'
        : paragraphTextFromLayout(surface.layout(), fragment.paragraphId)
    );
}

/** Sheet y of a body paragraph's top edge, the line a drop before it is drawn on. */
function topOf(surface: PaginatedSurface, paragraphId: string): number {
  const page = surface.layout().pages[0]!;
  const fragment = page.fragments.find(
    (candidate) => candidate.kind === 'paragraph' && candidate.paragraphId === paragraphId
  )!;
  return page.contentBox.y + fragment.box.y;
}

function pointer(target: Element, type: string, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 10,
      clientY,
    })
  );
}

describe('dragging a table by its handle', () => {
  test('drops the table before the nearest sibling, keeps its id, and undoes in one step', () => {
    const { surface, handle, indicator, paragraphWith } = mount();
    const tableId = handle().dataset.tableId!;
    const target = topOf(surface, paragraphWith('three'));
    pointer(handle(), 'pointerdown', 100);
    pointer(handle(), 'pointermove', 110);
    pointer(handle(), 'pointermove', target + 2);
    expect(indicator()).not.toBeNull();
    expect(parseFloat((indicator() as HTMLElement).style.top)).toBeCloseTo(target - 1);
    pointer(handle(), 'pointerup', target + 2);

    expect(order(surface)).toEqual(['one', 'two', '[T]', 'three']);
    expect(handle().dataset.tableId).toBe(tableId);
    expect(indicator()).toBeNull();
    surface.undo();
    expect(order(surface)).toEqual(['one', '[T]', 'two', 'three']);
  });

  test('a drag that ends where the table is leaves it in place', () => {
    const { surface, handle, indicator } = mount();
    const revision = surface.session.packageRevision();
    const page = surface.layout().pages[0]!;
    const table = page.fragments.find((fragment) => fragment.kind === 'table')!;
    const top = page.contentBox.y + table.box.y;
    pointer(handle(), 'pointerdown', 100);
    pointer(handle(), 'pointermove', top + 40);
    pointer(handle(), 'pointermove', top + 1);
    expect(indicator()).toBeNull();
    pointer(handle(), 'pointerup', top + 1);
    expect(surface.session.packageRevision()).toBe(revision);
    expect(order(surface)).toEqual(['one', '[T]', 'two', 'three']);
  });

  test('a press that barely moves is a click, not a drag', () => {
    const { surface, handle, indicator } = mount();
    const revision = surface.session.packageRevision();
    pointer(handle(), 'pointerdown', 100);
    pointer(handle(), 'pointermove', 102);
    expect(indicator()).toBeNull();
    pointer(handle(), 'pointerup', 102);
    expect(surface.session.packageRevision()).toBe(revision);
  });

  test('Escape cancels the drag where it stands', () => {
    const { surface, handle, indicator, paragraphWith } = mount();
    const revision = surface.session.packageRevision();
    pointer(handle(), 'pointerdown', 100);
    pointer(handle(), 'pointermove', topOf(surface, paragraphWith('three')) + 2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(indicator()).toBeNull();
    pointer(handle(), 'pointerup', 400);
    expect(surface.session.packageRevision()).toBe(revision);
  });

  test('suggesting mode draws no drop line and refuses with a reason', () => {
    const { surface, handle, indicator, paragraphWith } = mount();
    surface.setEditingMode('suggest');
    const revision = surface.session.packageRevision();
    expect(handle().dataset.draggable).toBe('false');
    const target = topOf(surface, paragraphWith('three')) + 2;
    pointer(handle(), 'pointerdown', 100);
    pointer(handle(), 'pointermove', target);
    expect(indicator()).toBeNull();
    pointer(handle(), 'pointerup', target);
    expect(surface.session.packageRevision()).toBe(revision);
    expect(String(surface.state().lastRejection)).toContain(SUGGESTING_TABLE_MOVE_REFUSAL);
  });

  test('a floating table selects but does not drag', () => {
    const floating = table(
      '<w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="200"/></w:tblPr>'
    );
    const { surface, handle, indicator, paragraphWith } = mount(
      p('one') + floating + p('two') + p('three')
    );
    expect(handle().dataset.draggable).toBe('false');
    const revision = surface.session.packageRevision();
    pointer(handle(), 'pointerdown', 100);
    pointer(handle(), 'pointermove', topOf(surface, paragraphWith('three')) + 2);
    expect(indicator()).toBeNull();
    pointer(handle(), 'pointerup', 400);
    expect(surface.session.packageRevision()).toBe(revision);
  });

  test('still shows for the caret after the table moves to another page', async () => {
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const { surface, handle, paragraphWith, caretIn } = mount(
      p('one') + table() + p('two') + pageBreak + p('three')
    );
    const pageOf = (text: string) =>
      surface
        .layout()
        .pages.findIndex((page) =>
          page.fragments.some(
            (fragment) =>
              fragment.kind === 'paragraph' && fragment.paragraphId === paragraphWith(text)
          )
        );
    const sheetTopOf = (text: string) => {
      const page = surface.layout().pages[pageOf(text)]!;
      const fragment = page.fragments.find(
        (candidate) =>
          candidate.kind === 'paragraph' && candidate.paragraphId === paragraphWith(text)
      )!;
      return page.contentBox.y + fragment.box.y;
    };
    expect(pageOf('three')).toBe(1);
    // The pointer crosses the table on page 1 to reach the handle, and rests there.
    const page = surface.layout().pages[0]!;
    const tableBox = page.fragments.find((fragment) => fragment.kind === 'table')!.box;
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: page.contentBox.x + tableBox.x + 5,
        clientY: page.contentBox.y + tableBox.y + 5,
      })
    );
    handle().dispatchEvent(new PointerEvent('pointerenter'));
    const target = sheetTopOf('three');
    const tableId = handle().dataset.tableId;
    pointer(handle(), 'pointerdown', 100);
    pointer(handle(), 'pointermove', 110);
    pointer(handle(), 'pointermove', target + 2);
    pointer(handle(), 'pointerup', target + 2);
    expect(order(surface)).not.toContain('[T]');

    // The table is on page 2 now. With the caret in it, its handle shows at its new corner.
    caretIn('cell');
    const moved = surface.layout().pages[1]!;
    const movedTable = moved.fragments.find((fragment) => fragment.kind === 'table');
    expect(movedTable).toBeDefined();
    expect(handle()).not.toBeNull();
    expect(handle().dataset.tableId).toBe(tableId);
    const top = moved.contentBox.y + movedTable!.box.y;
    expect(parseFloat(handle().style.top)).toBeCloseTo(top - 18);

    // Hover tracking resumes: the pointer leaves for empty space and the caret moves out of the
    // table, then a hover over the moved table shows its handle again.
    caretIn('one');
    document.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 2, clientY: 2 })
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(handle()).toBeNull();
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: moved.contentBox.x + movedTable!.box.x + 5,
        clientY: top + 5,
      })
    );
    expect(handle()).not.toBeNull();
  });
});

describe('choosing a drop slot', () => {
  const origin = { x: 0, y: 0, width: 600, height: 800 };
  const slot = (beforeBlockId: string, x: number, y: number): TableDropSlot => ({
    beforeBlockId,
    stays: false,
    pageIndex: 0,
    x,
    y,
    width: 250,
    origin,
  });

  test('prefers a slot in the column under the pointer over a nearer one beside it', () => {
    const slots = [slot('left', 0, 100), slot('right', 300, 300)];
    expect(nearestTableDropSlot(slots, 350, 110, () => 0)?.beforeBlockId).toBe('right');
    expect(nearestTableDropSlot(slots, 50, 290, () => 0)?.beforeBlockId).toBe('left');
  });

  test('falls back to the nearest slot when no line spans the pointer', () => {
    const slots = [slot('left', 0, 100), slot('right', 300, 300)];
    expect(nearestTableDropSlot(slots, 275, 290, () => 0)?.beforeBlockId).toBe('right');
  });
});
