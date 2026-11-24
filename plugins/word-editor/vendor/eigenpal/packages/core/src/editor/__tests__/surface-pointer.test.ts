// Pointer gestures over the painted pages.
//
// The surface claims pointer input because the browser cannot answer where a point is: the
// painted pages are shrink-to-fit line boxes, so the margin, the indent and the leading
// between lines are outside every box it knows about. These are the clicks that used to go
// wherever its fallback chose.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { setPaginatedSurfaceScale, type PaginatedSurface } from '../paginated-surface.ts';
import { absorbAtomicControls } from '../surface-atomic-controls.ts';
import {
  clientOf,
  MARGIN,
  mount,
  move,
  offsets,
  paragraph,
  pointer,
  press,
  release,
  stubRect,
} from './surface-pointer-harness.ts';

const cell = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const row = (cells: string) => `<w:tr>${cells}</w:tr>`;
/** Two by two, so a drag can leave a cell in either direction. */
const TABLE =
  `<w:tbl>${row(cell(paragraph('A1')) + cell(paragraph('B1')))}` +
  `${row(cell(paragraph('A2')) + cell(paragraph('B2')))}</w:tbl>`;

/** Page-content coordinates of a point inside the given cell of that fixture. */
const inCell = (rowIndex: number, column: number): [number, number] => [
  column * 234 + 10,
  rowIndex * 20 + 5,
];

describe('a press beside the text', () => {
  test('left of the first glyph puts the caret at the START of the line', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, -40, 5);
    expect(offsets(mounted.surface)).toEqual([0, 0]);
    mounted.surface.destroy();
  });

  test('right of the last glyph puts the caret at the END of the line', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 500, 5);
    expect(offsets(mounted.surface)).toEqual([11, 11]);
    mounted.surface.destroy();
  });

  test('below the last line lands in the last paragraph', () => {
    const mounted = mount(paragraph('one') + paragraph('two'));
    press(mounted, 500, 400);
    const { head } = mounted.surface.state().selection;
    expect(head.paragraphId).toBe(mounted.surface.session.paragraphIds()[1]!);
    expect(head.offset).toBe(3);
    mounted.surface.destroy();
  });

  test('the press is claimed, so the browser does not also place a caret of its own', () => {
    const mounted = mount(paragraph('hello'));
    expect(press(mounted, -40, 5).defaultPrevented).toBe(true);
    mounted.surface.destroy();
  });

  test('and focus is taken explicitly, because preventing the press cancels it', () => {
    const mounted = mount(paragraph('hello'));
    press(mounted, -40, 5);
    expect(document.activeElement).toBe(mounted.pages);
    mounted.surface.destroy();
  });

  test('the layer origin is subtracted, not assumed to be zero', () => {
    const mounted = mount(paragraph('hello world'));
    // The same client point read against an origin 40 further right is 40 further LEFT in the
    // document, which here is the difference between a glyph and the margin.
    stubRect(mounted.pages, { left: 140, top: 50 });
    mounted.pages.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 100 + MARGIN + 30,
        clientY: 50 + MARGIN + 5,
      })
    );
    // 30 in the old frame is -10 in the new one: the margin, so the start of the line.
    expect(offsets(mounted.surface)).toEqual([0, 0]);
    mounted.surface.destroy();
  });

  test('a click at the newly scaled glyph still lands on the same semantic offset', () => {
    const mounted = mount(paragraph('hello world'));
    expect(setPaginatedSurfaceScale(mounted.surface, 2)).toBe(true);
    mounted.pages.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 100 + MARGIN * 2 + 36 * 2,
        clientY: 50 + MARGIN * 2 + 5 * 2,
      })
    );
    expect(offsets(mounted.surface)).toEqual([6, 6]);
    mounted.surface.destroy();
  });
});

describe('what the engine does NOT claim', () => {
  test('a single press on page furniture in the margin places the body caret there', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 30, 5);

    const furniture = document.createElement('div');
    furniture.dataset.docxHf = 'header';
    mounted.pages.append(furniture);
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      ...clientOf(-40, 5),
    });
    furniture.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(offsets(mounted.surface)).toEqual([0, 0]);
    mounted.surface.destroy();
  });

  test('touch keeps the browser panning, which matters more than an exact caret', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 30, 5);
    const before = offsets(mounted.surface);
    const event = press(mounted, 500, 5, { pointerType: 'touch' });
    expect(event.defaultPrevented).toBe(false);
    expect(offsets(mounted.surface)).toEqual(before);
    mounted.surface.destroy();
  });

  test("'native' binds nothing at all", () => {
    const mounted = mount(paragraph('hello world'), { pointer: 'native' });
    const event = press(mounted, -40, 5);
    expect(event.defaultPrevented).toBe(false);
    expect(offsets(mounted.surface)).toEqual([0, 0]);
    mounted.surface.destroy();
  });
});

describe('dragging', () => {
  test('a drag extends from where it started', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 0, 5);
    document.dispatchEvent(pointer('pointermove', 36, 5));
    expect(offsets(mounted.surface)).toEqual([0, 6]);
    release(36, 5);
    mounted.surface.destroy();
  });

  test('dragging backwards keeps the anchor where the press was', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 36, 5);
    document.dispatchEvent(pointer('pointermove', 0, 5));
    expect(offsets(mounted.surface)).toEqual([6, 0]);
    release(0, 5);
    mounted.surface.destroy();
  });

  test('the browser does not get to overrule the gesture halfway through it', async () => {
    // A contenteditable keeps reporting its own idea of the selection while a drag runs.
    // Adopting one mid-gesture snaps the caret back to whatever the DOM guessed.
    const mounted = mount(paragraph('hello world'));
    press(mounted, 0, 5);
    document.dispatchEvent(pointer('pointermove', 36, 5));

    // A DIFFERENT selection, planted in the DOM, after the surface's own echo guard has
    // lapsed. Without both of those the report would either match the model or be ignored as
    // an echo, and the test would pass without the drag guard existing at all.
    await Promise.resolve();
    const span = mounted.pages.querySelector<HTMLElement>('[data-paragraph-id][data-start]')!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 2);
    range.setEnd(span.firstChild!, 3);
    const domSelection = document.getSelection()!;
    domSelection.removeAllRanges();
    domSelection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(offsets(mounted.surface)).toEqual([0, 6]);
    release(36, 5);
    mounted.surface.destroy();
  });

  test('and the same report IS adopted once the gesture is over', async () => {
    // The other half of the guard: outside a gesture the DOM is still how keyboard selection,
    // Select All and assistive technology reach the model.
    const mounted = mount(paragraph('hello world'));
    press(mounted, 0, 5);
    release(0, 5);

    await Promise.resolve();
    const span = mounted.pages.querySelector<HTMLElement>('[data-paragraph-id][data-start]')!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 2);
    range.setEnd(span.firstChild!, 3);
    const domSelection = document.getSelection()!;
    domSelection.removeAllRanges();
    domSelection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(offsets(mounted.surface)).toEqual([2, 3]);
    mounted.surface.destroy();
  });

  test('a move after the gesture ends changes nothing', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 0, 5);
    release(0, 5);
    document.dispatchEvent(pointer('pointermove', 500, 5));
    expect(offsets(mounted.surface)).toEqual([0, 0]);
    mounted.surface.destroy();
  });

  /** A drag to `clientY` inside a viewport running from 0 to 200, and what it scrolled. */
  async function dragToward(clientY: number): Promise<number> {
    const mounted = mount(paragraph('hello world'));
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    scroller.append(mounted.container);
    stubRect(scroller, { left: 0, top: 0, bottom: 200 });
    scroller.scrollTop = 0;

    press(mounted, 0, 5);
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 100 + MARGIN,
        clientY,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const scrolled = scroller.scrollTop;
    release(0, 5);
    scroller.remove();
    mounted.surface.destroy();
    return scrolled;
  }

  test('a drag past the edge of the view pulls the view after it', async () => {
    expect(await dragToward(199)).toBeGreaterThan(0);
  });

  test('and a drag nowhere near the edge does not', async () => {
    // Without this the test above would pass just as well for a controller that scrolled on
    // every move, which would make a drag through the middle of the page unusable.
    expect(await dragToward(100)).toBe(0);
  });
});

describe('click count', () => {
  test('a second click selects the word under it', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 12, 5);
    press(mounted, 12, 5);
    expect(offsets(mounted.surface)).toEqual([0, 5]);
    mounted.surface.destroy();
  });

  test('a double-click at the END of a word takes the word, not the space after it', () => {
    // The caret sits between characters, so the edge is ambiguous. Preferring the character
    // on the right and falling back to the left is what resolves it the way Word does.
    const mounted = mount(paragraph('hello world'));
    press(mounted, 30, 5);
    press(mounted, 30, 5);
    expect(offsets(mounted.surface)).toEqual([0, 5]);
    mounted.surface.destroy();
  });

  test('a second press on a picture or a chart never selects the word beside it', () => {
    // An inline drawing lets the press through to the page, so the surface counts it.
    const mounted = mount(paragraph('hello world'));
    const drawing = document.createElement('span');
    drawing.setAttribute('data-drawing-node-id', 'drawing-1');
    mounted.pages.append(drawing);
    for (let i = 0; i < 2; i++) {
      drawing.dispatchEvent(pointer('pointerdown', 12, 5));
      release(12, 5);
    }
    const [anchor, head] = offsets(mounted.surface);
    expect(anchor).toBe(head);
    mounted.surface.destroy();
  });

  test('a second press in a text box still selects a word', () => {
    const mounted = mount(paragraph('hello world'));
    const drawing = document.createElement('span');
    drawing.setAttribute('data-drawing-node-id', 'drawing-1');
    const box = document.createElement('span');
    box.className = 'docx-drawing-textbox';
    drawing.append(box);
    mounted.pages.append(drawing);
    for (let i = 0; i < 2; i++) {
      box.dispatchEvent(pointer('pointerdown', 12, 5));
      release(12, 5);
    }
    expect(offsets(mounted.surface)).toEqual([0, 5]);
    mounted.surface.destroy();
  });

  test('a third click takes the whole paragraph', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 12, 5);
    press(mounted, 12, 5);
    press(mounted, 12, 5);
    expect(offsets(mounted.surface)).toEqual([0, 11]);
    mounted.surface.destroy();
  });

  test('a click somewhere else starts counting again', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 12, 5);
    press(mounted, 60, 5);
    expect(offsets(mounted.surface)).toEqual([10, 10]);
    mounted.surface.destroy();
  });

  test('dragging after a double-click keeps taking whole words', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 12, 5);
    press(mounted, 12, 5);
    document.dispatchEvent(pointer('pointermove', 40, 5));
    expect(offsets(mounted.surface)).toEqual([0, 11]);
    release(40, 5);
    mounted.surface.destroy();
  });
});

describe('shift-click', () => {
  test('extends from the anchor the selection already has', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 0, 5);
    release(0, 5);
    press(mounted, 60, 5, { shiftKey: true });
    expect(offsets(mounted.surface)).toEqual([0, 10]);
    mounted.surface.destroy();
  });

  test('from a caret in a paragraph layout removed, extends from where that caret shows', () => {
    // An empty paragraph with a hidden mark leaves the flow; its caret shows at the start of
    // the paragraph after it, and the extension has to start there too.
    const hidden = '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr></w:p>';
    const mounted = mount(hidden + paragraph('hello world'));
    const [removed, visible] = mounted.surface.session.paragraphIds();
    mounted.surface.setSelection({
      anchor: { paragraphId: removed!, offset: 0 },
      head: { paragraphId: removed!, offset: 0 },
    });
    press(mounted, 60, 5, { shiftKey: true });
    expect(mounted.surface.state().selection).toEqual({
      anchor: { paragraphId: visible, offset: 0 },
      head: { paragraphId: visible, offset: 10 },
    });
    mounted.surface.destroy();
  });

  test('and pivots around it rather than around the visible start', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 36, 5);
    document.dispatchEvent(pointer('pointermove', 60, 5));
    release(60, 5);
    expect(offsets(mounted.surface)).toEqual([6, 10]);
    press(mounted, 0, 5, { shiftKey: true });
    expect(offsets(mounted.surface)).toEqual([6, 0]);
    mounted.surface.destroy();
  });
});

describe('dragging across table cells', () => {
  test('a drag that leaves its cell selects the RECTANGLE, not the text between', () => {
    // The text range from A1 to B2 runs through B1 on the way. Selecting that would highlight
    // a cell the drag never covered, and one delete would act on it.
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));

    const cells = mounted.surface.state().cellSelection!;
    expect(cells.kind).toBe('cells');
    expect(cells.cellIds).toHaveLength(4);
    expect(cells.rows).toEqual({ from: 0, to: 1 });
    expect(cells.columns).toEqual({ from: 0, to: 1 });
    release(...inCell(1, 1));
    mounted.surface.destroy();
  });

  test('a drag INSIDE one cell stays an ordinary text selection', () => {
    // No pixel threshold decides this — leaving the cell does. A drag that stays put selects
    // characters however far it travels.
    const mounted = mount(TABLE);
    press(mounted, 0, 5);
    move(...inCell(0, 0));
    expect(mounted.surface.state().cellSelection).toBeNull();
    const { anchor, head } = mounted.surface.state().selection;
    expect(anchor.paragraphId).toBe(head.paragraphId);
    expect(head.offset).toBeGreaterThan(anchor.offset);
    release(...inCell(0, 0));
    mounted.surface.destroy();
  });

  test('once promoted it stays promoted, even back in the cell it started in', () => {
    // A gesture that flipped type under the pointer would be unusable: the same drag would
    // mean one thing on the way out and another on the way back.
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(0, 1));
    move(...inCell(0, 0));

    const cells = mounted.surface.state().cellSelection!;
    expect(cells.cellIds).toHaveLength(1);
    expect(cells.kind).toBe('cells');
    release(...inCell(0, 0));
    mounted.surface.destroy();
  });

  test('the selected cells are painted, since a native selection cannot show them', () => {
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));

    const overlay = mounted.container.querySelector<HTMLElement>('.docx-selection-overlay')!;
    expect(overlay.querySelectorAll('.docx-cell-selection-rect')).toHaveLength(4);
    // Beside the pages, never inside them: the page painter sweeps its own subtree.
    expect(overlay.parentElement).toBe(mounted.container);
    expect(mounted.pages.contains(overlay)).toBe(false);
    release(...inCell(1, 1));
    mounted.surface.destroy();
  });

  test('and the native selection is collapsed, not run through the cells between', () => {
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    const domSelection = document.getSelection()!;
    expect(domSelection.isCollapsed).toBe(true);
    release(...inCell(1, 1));
    mounted.surface.destroy();
  });

  test('a plain click afterwards clears the rectangle', () => {
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));
    expect(mounted.surface.state().cellSelection).not.toBeNull();

    press(mounted, ...inCell(1, 1));
    expect(mounted.surface.state().cellSelection).toBeNull();
    expect(mounted.container.querySelectorAll('.docx-cell-selection-rect')).toHaveLength(0);
    mounted.surface.destroy();
  });

  test('the release does not collapse the rectangle back to a text selection', () => {
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));
    expect(mounted.surface.state().cellSelection!.cellIds).toHaveLength(4);
    mounted.surface.destroy();
  });

  test('a rectangle still names a text range, so deleting one works untouched', () => {
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));

    expect(mounted.surface.deleteSelection()).toBe(true);
    // The table survives; only its text went.
    expect(mounted.container.querySelectorAll('.docx-table-cell')).toHaveLength(4);
    mounted.surface.destroy();
  });

  test('painted cells carry their identity, so a highlight can name what it is over', () => {
    const mounted = mount(TABLE);
    const cells = [...mounted.pages.querySelectorAll<HTMLElement>('.docx-table-cell')];
    expect(cells).toHaveLength(4);
    for (const element of cells) {
      expect(element.dataset.cellId).toBeTruthy();
      expect(element.dataset.gridColumn).toMatch(/^[01]$/);
    }
    mounted.surface.destroy();
  });
});

describe('what a rectangle means to everything downstream', () => {
  test('it copies as a grid, not as one run of characters', () => {
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));
    expect(mounted.surface.selectedText()).toBe('A1\tB1\nA2\tB2');
    mounted.surface.destroy();
  });

  test('formatting reads the CELLS, not the text range they stand in for', () => {
    // A rectangle down column one has a text range that runs through column two on the way.
    // Reading the range would report the formatting of cells the drag never covered.
    const bold =
      `<w:tbl>${row(cell(paragraph('A1')) + cell(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>B1</w:t></w:r></w:p>`))}` +
      `${row(cell(paragraph('A2')) + cell(paragraph('B2')))}</w:tbl>`;
    const mounted = mount(bold);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 0));
    release(...inCell(1, 0));

    expect(mounted.surface.state().cellSelection!.columns).toEqual({ from: 0, to: 0 });
    // Column one is not bold anywhere. The range from A1 to A2 passes through bold B1.
    expect(mounted.surface.formatting().bold).toBe(false);
    mounted.surface.destroy();
  });
});

describe('a promoted drag that leaves the table', () => {
  test('keeps the cells it had, rather than throwing them away', () => {
    // Sweeping a couple of cells and letting the pointer stray past the last column is an
    // ordinary way to select them. Falling back to a text selection there loses the whole
    // rectangle at the moment of release.
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    expect(mounted.surface.state().cellSelection!.cellIds).toHaveLength(4);

    move(9999, 9999);
    expect(mounted.surface.state().cellSelection!.cellIds).toHaveLength(4);
    release(9999, 9999);
    expect(mounted.surface.state().cellSelection!.cellIds).toHaveLength(4);
    mounted.surface.destroy();
  });

  test('but a drag that never left its cell is still ordinary text', () => {
    // Out of the cell and straight into the paragraph below the table, without ever crossing
    // into a second cell: nothing promoted it, so it stays a text selection.
    const mounted = mount(TABLE + paragraph('after'));
    press(mounted, ...inCell(0, 0));
    move(9999, 9999);
    expect(mounted.surface.state().cellSelection).toBeNull();
    expect(mounted.surface.state().selection.head.paragraphId).toBe(
      mounted.surface.session.paragraphIds().at(-1)!
    );
    release(9999, 9999);
    mounted.surface.destroy();
  });
});

describe('a rectangle survives the browser reporting its own selection', () => {
  test('the collapsed native selection does not clear it after the drag ends', async () => {
    // The DOM deliberately holds a COLLAPSED selection while a rectangle is live, so it
    // disagrees with the model by construction. Adopting that disagreement cleared the whole
    // rectangle on the first report after release.
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));

    await Promise.resolve();
    document.dispatchEvent(new Event('selectionchange'));
    expect(mounted.surface.state().cellSelection!.cellIds).toHaveLength(4);
    expect(mounted.container.querySelectorAll('.docx-cell-selection-rect')).toHaveLength(4);
    mounted.surface.destroy();
  });
});

describe('a rectangle is not the text range it stands in for', () => {
  test('deleting one column does NOT empty the columns beside it', async () => {
    // The range from A1 to A2 runs through B1 on the way. Deleting through it emptied cells
    // the drag never covered — the exact failure the rectangle exists to prevent.
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 0));
    release(...inCell(1, 0));
    expect(mounted.surface.state().cellSelection!.columns).toEqual({ from: 0, to: 0 });

    expect(mounted.surface.deleteSelection()).toBe(true);
    await Promise.resolve();
    const painted = [...mounted.pages.querySelectorAll('.docx-table-cell')].map(
      (cell) => cell.textContent
    );
    expect(painted).toEqual(['', 'B1', '', 'B2']);
    mounted.surface.destroy();
  });

  test('a repaint while a rectangle is live does not collapse the model selection', async () => {
    // The DOM deliberately holds a COLLAPSED selection while a rectangle is live, so it
    // disagrees with the model by construction. The pre-paint reader adopted that
    // disagreement, leaving the overlay painting four cells while Delete edited one
    // character.
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));

    await Promise.resolve();
    mounted.surface.type('');
    const before = mounted.surface.state();
    expect(before.cellSelection).toBeNull();

    // And again, this time forcing a repaint that is NOT an edit.
    const second = mount(TABLE);
    press(second, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));
    await Promise.resolve();
    second.surface.setCellSelection(second.surface.state().cellSelection);
    expect(second.surface.state().cellSelection!.cellIds).toHaveLength(4);
    expect(second.surface.deleteSelection()).toBe(true);
    await Promise.resolve();
    expect(
      [...second.pages.querySelectorAll('.docx-table-cell')].map((cell) => cell.textContent)
    ).toEqual(['', '', '', '']);
    second.surface.destroy();
    mounted.surface.destroy();
  });

  test('an edit clears the rectangle rather than leaving a stale one painted', () => {
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));
    mounted.surface.deleteSelection();
    expect(mounted.surface.state().cellSelection).toBeNull();
    expect(mounted.container.querySelectorAll('.docx-cell-selection-rect')).toHaveLength(0);
    mounted.surface.destroy();
  });

  test('formatting a rectangle actually formats it, and keeps it selected', () => {
    // The read side reported the cells; the write side refused every multi-paragraph range,
    // so pressing Bold over selected cells was a silent no-op.
    const mounted = mount(TABLE);
    press(mounted, ...inCell(0, 0));
    move(...inCell(1, 1));
    release(...inCell(1, 1));
    expect(mounted.surface.formatting().bold).toBe(false);

    mounted.surface.toggleRunProperty('b');
    expect(mounted.surface.formatting().bold).toBe(true);
    expect(mounted.surface.state().cellSelection!.cellIds).toHaveLength(4);
    mounted.surface.destroy();
  });
});

describe('the gesture cannot be stranded', () => {
  test('a second pointer does not inherit the first one’s gesture', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 0, 5);
    mounted.pages.dispatchEvent(pointer('pointerdown', 30, 5, { pointerId: 2 }));
    // The first pointer's release must not leave a live gesture behind.
    release(0, 5);
    document.dispatchEvent(pointer('pointerup', 30, 5, { pointerId: 2 }));
    document.dispatchEvent(pointer('pointermove', 500, 5, { pointerId: 2 }));
    expect(offsets(mounted.surface)).toEqual([5, 5]);
    mounted.surface.destroy();
  });

  test('a slow second click is a fresh click, not a double', async () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 12, 5);
    await new Promise((resolve) => setTimeout(resolve, 520));
    press(mounted, 12, 5);
    expect(offsets(mounted.surface)).toEqual([2, 2]);
    mounted.surface.destroy();
  });

  test('a click then a shift-click extends, it does not select a word', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, 12, 5);
    release(12, 5);
    press(mounted, 12, 5, { shiftKey: true });
    expect(offsets(mounted.surface)).toEqual([2, 2]);
    mounted.surface.destroy();
  });
});

describe('showingPlcHdr placeholder selection is atomic', () => {
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const inlinePlc = (prompt: string) =>
    `<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>` +
    `<w:sdtContent>${run(prompt)}</w:sdtContent></w:sdt>`;
  const blockPlc = (inner: string) =>
    `<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

  function controlCenter(surface: PaginatedSurface, index = 0): { x: number; y: number } {
    const control = surface.layout().contentControls?.[index];
    if (!control || control.fragments.length === 0) throw new Error('no control fragment');
    const box = control.fragments[0]!.box;
    return { x: box.x + Math.max(1, box.width / 2), y: box.y + Math.max(1, box.height / 2) };
  }

  test('click inside a placeholder selects the whole prompt', () => {
    const mounted = mount(`<w:p>${run('aa')}${inlinePlc('Enter name')}${run('zz')}</w:p>`);
    const { x, y } = controlCenter(mounted.surface);
    press(mounted, x, y);
    // "aa" (2) + "Enter name" (10) → whole prompt [2, 12)
    expect(offsets(mounted.surface)).toEqual([2, 12]);
    mounted.surface.destroy();
  });

  test('right-click inside a placeholder selects the whole prompt', () => {
    const mounted = mount(`<w:p>${run('aa')}${inlinePlc('Enter name')}${run('zz')}</w:p>`);
    const { x, y } = controlCenter(mounted.surface);
    const event = press(mounted, x, y, { button: 2 });
    expect(event.defaultPrevented).toBe(false);
    expect(offsets(mounted.surface)).toEqual([2, 12]);
    mounted.surface.destroy();
  });

  test('drag through a placeholder selects the control as a unit', () => {
    const mounted = mount(`<w:p>${run('aa')}${inlinePlc('Enter name')}${run('zz')}</w:p>`);
    const { x, y } = controlCenter(mounted.surface);
    press(mounted, 0, y);
    move(x, y);
    // Anchor before the prompt; head inside expands to absorb the whole unit.
    expect(offsets(mounted.surface)).toEqual([0, 12]);
    release(x, y);
    mounted.surface.destroy();
  });

  test('shift-click into a placeholder absorbs the whole prompt', () => {
    const mounted = mount(`<w:p>${run('aa')}${inlinePlc('Enter name')}${run('zz')}</w:p>`);
    const { x, y } = controlCenter(mounted.surface);
    press(mounted, 0, y);
    release(0, y);
    press(mounted, x, y, { shiftKey: true });
    expect(offsets(mounted.surface)).toEqual([0, 12]);
    mounted.surface.destroy();
  });

  test('keyboard-style extend absorbs a placeholder the caret enters', () => {
    const mounted = mount(`<w:p>${run('aa')}${inlinePlc('Enter name')}${run('zz')}</w:p>`);
    const paragraphId = mounted.surface.session.paragraphIds()[0]!;
    // Simulate Shift+Arrow landing mid-prompt: a partial range must snap to the unit.
    const absorbed = absorbAtomicControls(mounted.surface.layout(), {
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    expect([absorbed.anchor.offset, absorbed.head.offset]).toEqual([0, 12]);
    mounted.surface.destroy();
  });

  test('keyboard absorb descends into a table cell inline placeholder', () => {
    const mounted = mount(
      `<w:tbl>${row(
        cell(`<w:p>${run('aa')}${inlinePlc('Enter name')}${run('zz')}</w:p>`) +
          cell(paragraph('B1'))
      )}</w:tbl>`
    );
    const paragraphId = mounted.surface.session.paragraphIds()[0]!;
    const absorbed = absorbAtomicControls(mounted.surface.layout(), {
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    expect([absorbed.anchor.offset, absorbed.head.offset]).toEqual([0, 12]);
    expect(absorbed.anchor.paragraphId).toBe(paragraphId);
    expect(absorbed.head.paragraphId).toBe(paragraphId);
    mounted.surface.destroy();
  });

  test('keyboard absorb covers a block placeholder wrapping a table', () => {
    const mounted = mount(
      paragraph('before') +
        blockPlc(
          `<w:tbl>${row(cell(paragraph('A1')) + cell(paragraph('B1')))}` +
            `${row(cell(paragraph('A2')) + cell(paragraph('B2')))}</w:tbl>`
        ) +
        paragraph('after')
    );
    const ids = mounted.surface.session.paragraphIds();
    expect(ids.length).toBeGreaterThanOrEqual(6);
    const firstCell = ids[1]!;
    const lastCell = ids[4]!;
    const absorbed = absorbAtomicControls(mounted.surface.layout(), {
      anchor: { paragraphId: firstCell, offset: 0 },
      head: { paragraphId: firstCell, offset: 1 },
    });
    expect(absorbed.anchor.paragraphId).toBe(firstCell);
    expect(absorbed.anchor.offset).toBe(0);
    expect(absorbed.head.paragraphId).toBe(lastCell);
    expect(absorbed.head.offset).toBe(2); // "B2"
    mounted.surface.destroy();
  });

  test('keyboard absorb covers nested block controls that contain a table', () => {
    const mounted = mount(
      blockPlc(
        blockPlc(
          `<w:tbl>${row(cell(`<w:p>${run('aa')}${inlinePlc('Enter name')}${run('zz')}</w:p>`))}</w:tbl>`
        )
      )
    );
    const paragraphId = mounted.surface.session.paragraphIds()[0]!;
    const absorbed = absorbAtomicControls(mounted.surface.layout(), {
      anchor: { paragraphId, offset: 3 },
      head: { paragraphId, offset: 6 },
    });
    // Mid-prompt intersects the inline unit, then the nested block wrappers absorb the
    // whole cell paragraph so table-contained placeholders cannot stay partial.
    expect([absorbed.anchor.offset, absorbed.head.offset]).toEqual([0, 14]);
    expect(absorbed.anchor.paragraphId).toBe(paragraphId);
    mounted.surface.destroy();
  });
});

test('engine pointer double click opens legacy text form options', () => {
  const mounted = mount(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="InputA"/><w:textInput><w:default w:val="Sample"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Sample</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
  try {
    for (let click = 0; click < 2; click++) {
      const field = mounted.pages.querySelector<HTMLElement>('[data-field-atom="form"]')!;
      field.dispatchEvent(pointer('pointerdown', 3, 5));
      document.dispatchEvent(pointer('pointerup', 3, 5));
    }
    const dialog = mounted.container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector('input')!.value).toBe('Sample');
  } finally {
    mounted.surface.destroy();
    mounted.container.remove();
  }
});

test('engine pointer release selects an unprotected field without a DOM click event', () => {
  const mounted = mount(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="InputA"/><w:textInput><w:default w:val="Sample"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Sample</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
  try {
    const field = mounted.pages.querySelector<HTMLElement>('[data-field-atom="form"]')!;
    field.dispatchEvent(pointer('pointerdown', 3.4, 5.4));
    document.dispatchEvent(pointer('pointerup', 3.4, 5.4));
    const selection = mounted.surface.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([0, 6]);
    expect(document.getSelection()!.toString()).toBe('Sample');
  } finally {
    mounted.surface.destroy();
    mounted.container.remove();
  }
});
