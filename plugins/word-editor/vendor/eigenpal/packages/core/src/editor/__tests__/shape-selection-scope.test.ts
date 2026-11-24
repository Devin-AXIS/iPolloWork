// Presses on drawings outside the plain body case: an outlined picture whose image is missing,
// a drawing in an open header, a repeated press inside a shape with no fill, and a press the
// selected frame hands to the text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { drawingFramePressTarget } from '../drawing-overlay-press.ts';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import {
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

const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

/** The painted element of a drawing. */
function paintedOf(container: HTMLElement, record: AnchoredDrawingRecord): HTMLElement {
  return container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(record.drawingNodeId)}"]`
  )!;
}

test('an outlined picture whose image is missing selects by its middle', async () => {
  const picture =
    `<pic:pic xmlns:pic="${PIC_URI}"><pic:nvPicPr><pic:cNvPr id="7" name="Linked"/>` +
    `<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="${R}" r:embed="rIdMissing"/>` +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${200 * EMU}" cy="${100 * EMU}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></pic:spPr>' +
    '</pic:pic>';
  const linked = anchor({
    id: 7,
    name: 'Linked',
    x: 50 * EMU,
    y: 200 * EMU,
    cx: 200 * EMU,
    cy: 100 * EMU,
    graphic: picture,
    uri: PIC_URI,
  });
  const { editor, container } = await mount(p(linked + text('Anchor')) + FILLERS);
  try {
    const record = drawingNamed(editor, 7);
    expect(record.resource.kind).not.toBe('ready');
    const { x, y, width, height } = record;
    pressAt(container, editor, x + width / 2, y + height / 2, paintedOf(container, record));
    expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a drawing in an open header selects on a press and moves', async () => {
  const badge = anchor({
    id: 8,
    name: 'Badge',
    x: 300 * EMU,
    y: -50 * EMU,
    cx: 100 * EMU,
    cy: 30 * EMU,
    graphic: wsp(
      100 * EMU,
      30 * EMU,
      'rect',
      '<a:solidFill><a:srgbClr val="9DC3E6"/></a:solidFill>'
    ),
    uri: SHAPE_URI,
  });
  const header = `<w:p>${badge}<w:r><w:t>Header text</w:t></w:r></w:p>`;
  const { editor, container } = await mount(p(text('Body')) + FILLERS, header);
  try {
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: 'rIdH' })).toBe(true);
    const page = surface.layout().pages[0]!;
    const story = page.header!;
    const record = story.anchoredDrawings!.find((drawing) => drawing.relativeHeight === 8)!;
    // Story points to page-content points, the space a press is given in.
    const x = story.box.x + record.x + record.width / 2 - page.contentBox.x;
    const y = story.box.y + record.y + record.height / 2 - page.contentBox.y;
    pressAt(container, editor as DocxEditorInstance, x, y, paintedOf(container, record));
    expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId, canMove: true });
    expect(editor.exec({ type: 'setImagePosition', horizontalEmu: 100 * EMU })).toMatchObject({
      ok: true,
    });
    const moved = surface
      .layout()
      .pages[0]!.header!.anchoredDrawings!.find((drawing) => drawing.relativeHeight === 8)!;
    expect(moved.x).toBeLessThan(record.x - 100);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a double press on a word inside a shape with no fill selects the word', async () => {
  const outline = anchor({
    id: 4,
    name: 'Outline',
    x: 100 * EMU,
    y: 0,
    cx: 200 * EMU,
    cy: 60 * EMU,
    graphic: wsp(200 * EMU, 60 * EMU, 'rect', '<a:noFill/>'),
    uri: SHAPE_URI,
  });
  const words = 'Inside the frame there is a line of words that runs on';
  const { editor, container } = await mount(p(outline + text(words)) + FILLERS);
  try {
    const record = drawingNamed(editor, 4);
    const painted = paintedOf(container, record);
    const page = editor.surface!.layout().pages[0]!;
    const at = { x: 150, y: firstLineBox(editor).y + 4 };
    for (let press = 0; press < 2; press += 1) {
      pressAt(container, editor, at.x, at.y, painted);
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: (page.contentBox.x + at.x) * SCALE,
          clientY: (page.contentBox.y + at.y) * SCALE,
        })
      );
    }
    const { anchor: from, head: to } = editor.surface!.state().selection;
    // The drawing holds the paragraph's first offset, so the words start at 1.
    const selected = words.slice(
      Math.min(from.offset, to.offset) - 1,
      Math.max(from.offset, to.offset) - 1
    );

    expect(selected.trim().length).toBeGreaterThan(1);
    expect(selected.trim()).not.toContain(' ');
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('the frame names the presses it hands to the text, so adapters keep the keyboard there', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.getSelectedImage!()).not.toBeNull();
    const page = editor.surface!.layout().pages[0]!;
    const press = (x: number, y: number) =>
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: (page.contentBox.x + x) * SCALE,
        clientY: (page.contentBox.y + y) * SCALE,
      });
    expect(drawingFramePressTarget(editor, press(2, firstLineBox(editor).y + 4))).toBe('text');
    expect(drawingFramePressTarget(editor, press(380, gapY(editor)))).toBe('frame');
    // Only asked, not acted on: the shape stays selected.
    expect(editor.getSelectedImage!()).not.toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});
