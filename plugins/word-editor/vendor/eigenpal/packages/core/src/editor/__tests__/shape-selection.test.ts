// Shapes, lines and groups select as objects. A drawing behind the text takes a press where
// no glyph lies under it; a press on text over it places the caret. `wp:anchor/@locked` fixes
// only the anchor paragraph, so a locked drawing still selects, moves and deletes. A shape
// moves and deletes but does not resize: its size also lives in its own geometry.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { passDrawingFramePress } from '../drawing-overlay-press.ts';
import {
  BEHIND,
  EMU,
  SCALE,
  SPACED,
  drawingNamed,
  firstLineBox,
  gapY,
  mount,
  p,
  pressAt,
  pressOn,
  saved,
  text,
} from './shape-selection-fixture.ts';

test('a press on a shape behind the text, away from any glyph, selects it', async () => {
  const { editor, container } = await mount();
  try {
    const background = drawingNamed(editor, 1);
    // Right of "Short" on the first line, inside the rectangle.
    const event = pressAt(container, editor, 380, gapY(editor));
    expect(event.defaultPrevented).toBe(true);
    const selected = editor.getSelectedImage!();
    expect(selected).toMatchObject({ id: background.drawingNodeId, canMove: true });
    // Its size also lives in its own geometry, so it offers no resize.
    expect(selected!.canResize).toBe(false);
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toMatchObject({
      id: background.drawingNodeId,
      canMove: true,
      canResize: false,
    });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a press on text over a shape behind it places the caret there', async () => {
  const { editor, container } = await mount();
  try {
    const event = pressAt(container, editor, 2, firstLineBox(editor).y + 4);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('none');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a line and a group in front of the text select as objects', async () => {
  const { editor, container } = await mount();
  try {
    for (const id of [2, 3]) {
      const record = drawingNamed(editor, id);
      pressOn(container, editor, record);
      expect(editor.getSelectedImage!()).toMatchObject({
        id: record.drawingNodeId,
        canMove: true,
        canResize: false,
        canCrop: false,
      });
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a selected shape deletes whole and comes back on undo; its anchor stays locked', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.can({ type: 'deleteImage' })).toEqual({ ok: true });
    expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
    expect(await saved(editor)).not.toContain('Background');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    const restored = await saved(editor);
    expect(restored).toContain('name="Background"');
    expect(restored).toContain('locked="1"');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a select lock still keeps a shape behind the text from taking the press', async () => {
  const locked = BEHIND.replace(
    '<wp:cNvGraphicFramePr/>',
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noSelect="1"/></wp:cNvGraphicFramePr>`
  );
  const { editor, container } = await mount(p(SPACED + locked + text('Short')) + p(text('Second')));
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('none');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a locked anchor stays in its paragraph when the shape moves down the page', async () => {
  const { editor, container } = await mount();
  try {
    const before = drawingNamed(editor, 1);
    pressAt(container, editor, 380, gapY(editor));
    const verticalEmu = Math.round(240 * EMU);
    expect(editor.exec({ type: 'setImagePosition', verticalEmu })).toMatchObject({ ok: true });
    const after = drawingNamed(editor, 1);
    expect(after.y).toBeGreaterThan(before.y + 200);
    expect(after.anchorParagraphId).toBe(before.anchorParagraphId);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a press just off a straight line still reaches it; one further away does not', async () => {
  const { editor, container } = await mount();
  try {
    const line = drawingNamed(editor, 2);
    const painted = container.querySelector<HTMLElement>(
      `[data-drawing-node-id="${CSS.escape(line.drawingNodeId)}"]`
    )!;
    pressAt(container, editor, line.x + 50, line.y + 2, painted);
    expect(editor.getSelectedImage!()).toMatchObject({ id: line.drawingNodeId });
    pressAt(container, editor, line.x + 50, line.y + 12);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('Delete removes a shape selected behind the text', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    const key = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    container.querySelector<HTMLElement>('.docx-page-content')!.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    const xml = await saved(editor);
    expect(xml).not.toContain('Background');
    expect(xml).toContain('Short');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('with the shape behind the text selected, a press on its frame over text places the caret', async () => {
  const { editor, container } = await mount();
  try {
    const page = editor.surface!.layout().pages[0]!;
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.getSelectedImage!()).not.toBeNull();
    // The frame an adapter paints over the drawing: off the pages, as in a portal.
    const frame = document.createElement('div');
    container.append(frame);
    const results: ReturnType<typeof passDrawingFramePress>[] = [];
    frame.addEventListener('pointerdown', (event) =>
      results.push(passDrawingFramePress(editor, event))
    );
    const press = (x: number, y: number) =>
      frame.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX: (page.contentBox.x + x) * SCALE,
          clientY: (page.contentBox.y + y) * SCALE,
        })
      );
    // Outside every line, the frame keeps the press, to move the shape.
    press(380, gapY(editor));
    expect(results).toEqual(['frame']);
    // On "Short", the text takes it: the caret lands there and the shape is no longer selected.
    press(2, firstLineBox(editor).y + 4);
    expect(results).toEqual(['frame', 'text']);
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.state().selection.head.offset).toBeLessThan(3);
  } finally {
    editor.destroy();
    container.remove();
  }
});
