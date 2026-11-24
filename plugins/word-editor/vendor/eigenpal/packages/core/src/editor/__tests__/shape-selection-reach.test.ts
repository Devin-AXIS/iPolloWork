// Where a press reaches a shape, and where it goes to the text instead. A shape with no fill
// takes a press only on its outline, a line only near its path. A drawing behind the text takes
// a press only outside every text line and never on a header or footer band. A shape refuses
// the picture commands up front.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { passDrawingFramePress } from '../drawing-overlay-press.ts';
import {
  BEHIND,
  EMU,
  SCALE,
  SHAPE_URI,
  anchor,
  drawingNamed,
  firstLineBox,
  gapY,
  mount,
  p,
  pressAt,
  text,
  wsp,
} from './shape-selection-fixture.ts';

const WORDS = 'Inside the frame there is a line of words that runs on';
/** A rectangle with no fill, in front of the text, around the first line. */
const OUTLINE = anchor({
  id: 4,
  name: 'Outline',
  x: 100 * EMU,
  y: 0,
  cx: 200 * EMU,
  cy: 60 * EMU,
  graphic: wsp(200 * EMU, 60 * EMU, 'rect', '<a:noFill/>'),
  uri: SHAPE_URI,
});
/** A diagonal line from the top left to the bottom right of a 400 by 100 frame. */
const DIAGONAL = anchor({
  id: 5,
  name: 'Diagonal',
  x: 0,
  y: 200 * EMU,
  cx: 400 * EMU,
  cy: 100 * EMU,
  graphic: wsp(400 * EMU, 100 * EMU, 'line', ''),
  uri: SHAPE_URI,
});
const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

/** A press at page-content points on a drawing's painted element, as a browser targets it. */
function pressDrawing(
  container: HTMLElement,
  editor: Parameters<typeof pressAt>[1],
  id: number,
  x: number,
  y: number
) {
  const record = drawingNamed(editor, id);
  const painted = container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(record.drawingNodeId)}"]`
  )!;
  return pressAt(container, editor, x, y, painted);
}

test('a shape with no fill takes a press on its outline, not on the text inside it', async () => {
  const { editor, container } = await mount(p(OUTLINE + text(WORDS)) + FILLERS);
  try {
    const shape = drawingNamed(editor, 4);
    // On the words inside the outline: the caret goes there.
    pressDrawing(container, editor, 4, 150, firstLineBox(editor).y + 4);
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('none');
    // On its right edge: the shape selects, and its frame is labelled a shape.
    pressDrawing(container, editor, 4, shape.x + shape.width, shape.y + 30);
    expect(editor.getSelectedImage!()).toMatchObject({ id: shape.drawingNodeId });
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toMatchObject({ shape: true });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a diagonal line takes a press near its path, not at the far corner of its frame', async () => {
  const { editor, container } = await mount(p(DIAGONAL + text('Line anchor')) + FILLERS);
  try {
    const line = drawingNamed(editor, 5);
    pressDrawing(container, editor, 5, line.x + line.width - 2, line.y + 2);
    expect(editor.getSelectedImage!()).toBeNull();
    pressDrawing(container, editor, 5, line.x + line.width / 2, line.y + line.height / 2);
    expect(editor.getSelectedImage!()).toMatchObject({ id: line.drawingNodeId });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a press in a line of text over a shape behind it, past the words or empty, is text', async () => {
  const tall = BEHIND.replace(`cy="${60 * EMU}"`, `cy="${200 * EMU}"`).replaceAll(
    `cy="${60 * EMU}"`,
    `cy="${200 * EMU}"`
  );
  const { editor, container } = await mount(
    p(tall + text('Short')) + '<w:p/>' + p(text('Third')) + FILLERS
  );
  try {
    const line = firstLineBox(editor);
    // Right of "Short", in its line.
    pressAt(container, editor, 380, line.y + 4);
    expect(editor.getSelectedImage!()).toBeNull();
    // In the empty paragraph below it.
    const empty = editor.surface!.layout().pages[0]!.fragments[1]! as unknown as {
      readonly lines: readonly { readonly box: { readonly y: number } }[];
    };
    pressAt(container, editor, 200, empty.lines[0]!.box.y + 4);
    expect(editor.getSelectedImage!()).toBeNull();
    const ids = editor.surface!.session.paragraphIds();
    expect(editor.surface!.state().selection.head.paragraphId).toBe(ids[1]!);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a page background behind the text leaves the header band to the header', async () => {
  const page = anchor({
    id: 6,
    name: 'Page',
    x: -72 * EMU,
    y: -72 * EMU,
    cx: 612 * EMU,
    cy: 792 * EMU,
    graphic: wsp(
      612 * EMU,
      792 * EMU,
      'rect',
      '<a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill>'
    ),
    uri: SHAPE_URI,
    behind: true,
  });
  const { editor, container } = await mount(p(page + text('Body')) + FILLERS, 'Header text');
  try {
    // On the header band, above the body.
    pressAt(container, editor, 10, -30);
    expect(editor.getSelectedImage!()).toBeNull();
    // In the left margin, beside the body text: the background selects.
    pressAt(container, editor, -40, 200);
    expect(editor.getSelectedImage!()).toMatchObject({ id: drawingNamed(editor, 6).drawingNodeId });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a selected shape refuses picture commands up front', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.getSelectedImage!()).not.toBeNull();
    for (const [command, reason] of [
      [{ type: 'transformImage', action: 'rotateCW' }, 'rotate and flip are'],
      [{ type: 'replaceImage', data: new Uint8Array([1]) }, 'replacing the picture is'],
      [{ type: 'setImageProperties', hyperlink: 'https://example.com' }, 'hyperlinks are'],
    ] as const) {
      expect(editor.can(command as Parameters<typeof editor.can>[0])).toMatchObject({
        ok: false,
        code: 'unsupported',
        reason: `${reason} not supported for shapes`,
      });
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});

/** The frame an adapter paints over the selected drawing, off the pages as in a portal. */
function frameOver(container: HTMLElement, editor: Parameters<typeof pressAt>[1]) {
  const frame = document.createElement('div');
  frame.className = 'docx-image-selection-overlay__frame';
  container.append(frame);
  const results: ReturnType<typeof passDrawingFramePress>[] = [];
  frame.addEventListener('pointerdown', (event) =>
    results.push(passDrawingFramePress(editor, event))
  );
  const page = editor.surface!.layout().pages[0]!;
  const press = (x: number, y: number, pointerType: string) => {
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType,
      clientX: (page.contentBox.x + x) * SCALE,
      clientY: (page.contentBox.y + y) * SCALE,
    });
    frame.dispatchEvent(event);
    return event;
  };
  return { frame, results, press };
}

test('a touch press on the frame over text lets the tap through to the text', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    const { frame, results, press } = frameOver(container, editor);
    const event = press(2, firstLineBox(editor).y + 4, 'touch');
    expect(results).toEqual(['text']);
    // Not taken: the browser's own tap lands on the text under the frame.
    expect(event.defaultPrevented).toBe(false);
    expect(frame.style.pointerEvents).toBe('none');
    window.dispatchEvent(new Event('click'));
    expect(frame.style.pointerEvents).toBe('');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a mouse press on the frame over text goes on to the element under the frame', async () => {
  const { editor, container } = await mount();
  const original = document.elementsFromPoint;
  try {
    pressAt(container, editor, 380, gapY(editor));
    const { frame, results, press } = frameOver(container, editor);
    const run = container.querySelector<HTMLElement>('.docx-pages .layout-run')!;
    document.elementsFromPoint = () => [frame, run];
    const targets: EventTarget[] = [];
    run.addEventListener('pointerdown', (event) => targets.push(event.target!));
    press(2, firstLineBox(editor).y + 4, 'mouse');
    expect(results).toEqual(['text']);
    expect(targets).toEqual([run]);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    document.elementsFromPoint = original;
    editor.destroy();
    container.remove();
  }
});

test('a shape that paints nothing takes a press anywhere on its frame', async () => {
  const invisible = anchor({
    id: 6,
    name: 'Invisible',
    x: 0,
    y: 200 * EMU,
    cx: 200 * EMU,
    cy: 80 * EMU,
    graphic: wsp(200 * EMU, 80 * EMU, 'rect', '<a:noFill/><a:ln><a:noFill/></a:ln>'),
    uri: SHAPE_URI,
  });
  const { editor, container } = await mount(p(invisible + text('Anchor')) + FILLERS);
  try {
    const shape = drawingNamed(editor, 6);
    pressDrawing(container, editor, 6, shape.x + shape.width / 2, shape.y + shape.height / 2);
    expect(editor.getSelectedImage!()).toMatchObject({ id: shape.drawingNodeId });
  } finally {
    editor.destroy();
    container.remove();
  }
});
