// A text box whose outline reaches past its frame, such as a callout's tail, takes a press on
// the tail: the press selects the text box. A press inside the frame still edits its text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import { headerFooterAnchoredDrawingOrigin } from '../../layout/header-footer-drawing-origin.ts';
import { textboxOutlineHit, textboxPressReaches } from '../../layout/vector-shape-hit.ts';
import {
  EMU,
  SHAPE_URI,
  SOLID,
  anchor,
  drawingNamed,
  mount,
  p,
  pressAt,
  SCALE,
  text,
  wsp,
} from './shape-selection-fixture.ts';

const LINE = '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>';
const GRADIENT =
  '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000">' +
  '<a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>';
const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

/**
 * A 144 x 72pt callout text box at (100, 100)pt from the margins, or from the page: its tail
 * tip sits at (42, 81)pt in it.
 */
function callout(
  xfrm = '',
  relativeFrom: 'margin' | 'page' = 'margin',
  paint = `${SOLID('00AA00')}${LINE}`,
  behind = false
): string {
  return anchor({
    id: 41,
    name: 'Text callout',
    relativeFrom,
    behind,
    x: 100 * EMU,
    y: 100 * EMU,
    cx: 144 * EMU,
    cy: 72 * EMU,
    graphic:
      `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm${xfrm}><a:off x="0" y="0"/>` +
      `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/></a:xfrm>` +
      `<a:prstGeom prst="wedgeRectCallout"><a:avLst/></a:prstGeom>${paint}</wps:spPr>` +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
      '<wps:bodyPr/></wps:wsp>',
    uri: SHAPE_URI,
  });
}

test('a press on a text box callout tail selects the text box', async () => {
  const { editor, container } = await mount(p(callout() + text('Anchor')) + FILLERS);
  try {
    const box = drawingNamed(editor, 41);
    expect(box.textboxStory).toBeDefined();
    const frame = box.geometry.contentBounds;
    const painted = container.querySelector<HTMLElement>(
      `.docx-drawing-textbox[data-drawing-node-id="${CSS.escape(box.drawingNodeId)}"]`
    )!;
    // On the tail, below the frame: the painted box covers it.
    pressAt(container, editor, frame.x + 42, frame.y + 77, painted);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
    // Beside the tail, below the frame: the text under it.
    pressAt(container, editor, frame.x + 130, frame.y + 77, painted);
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.activeScope().kind).toBe('body');
    // On the frame's border, inside the frame: the text box.
    pressAt(container, editor, frame.x + 1, frame.y + 60, painted);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
    // Inside the frame, on its text: the caret goes into the text box.
    const content = painted.querySelector<HTMLElement>('.docx-drawing-textbox-content')!;
    pressAt(container, editor, frame.x + 12, frame.y + 10, content);
    expect(editor.surface!.activeScope().kind).toBe('frame');
  } finally {
    editor.destroy();
    container.remove();
  }
});

/** The painted box of the callout. */
function paintedOf(container: HTMLElement, record: AnchoredDrawingRecord): HTMLElement {
  return container.querySelector<HTMLElement>(
    `.docx-drawing-textbox[data-drawing-node-id="${CSS.escape(record.drawingNodeId)}"]`
  )!;
}

test('a turned or flipped callout takes a press on its tail where it paints', async () => {
  // Offsets from the frame centre (72, 36): on the tail, and beside it, in the unturned box.
  // A half turn and a vertical flip both put the tail above the frame.
  for (const xfrm of [' rot="10800000"', ' flipV="1"']) {
    const { editor, container } = await mount(p(callout(xfrm) + text('Anchor')) + FILLERS);
    try {
      const box = drawingNamed(editor, 41);
      const frame = box.geometry.contentBounds;
      const painted = paintedOf(container, box);
      const on = xfrm.includes('rot') ? { x: 72 + 30, y: 36 - 41 } : { x: 72 - 30, y: 36 - 41 };
      const beside = xfrm.includes('rot') ? { x: 72 + 60, y: 36 - 41 } : { x: 72 - 60, y: -5 };
      // The painted box holds the tail above the frame, and half the 1pt outline.
      expect(box.paintBounds.y).toBeCloseTo(frame.y - 9 - 0.5, 6);
      pressAt(container, editor, frame.x + on.x, frame.y + on.y, painted);
      expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
      pressAt(container, editor, frame.x + beside.x, frame.y + beside.y, painted);
      expect(editor.getSelectedImage!()).toBeNull();
    } finally {
      editor.destroy();
      container.remove();
    }
  }
});

test('a header callout takes a press on its tail while the header is open', async () => {
  const { editor, container } = await mount(
    p(text('Body')) + FILLERS,
    `<w:p>${callout('', 'page')}<w:r><w:t>Header</w:t></w:r></w:p>`
  );
  try {
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: 'rIdH' })).toBe(true);
    const page = surface.layout().pages[0]!;
    const story = page.header!;
    const record = story.anchoredDrawings!.find((d) => d.relativeHeight === 41)!;
    expect(record.textboxStory).toBeDefined();
    const origin = headerFooterAnchoredDrawingOrigin(record, story.box, page.box);
    const at = (x: number, y: number) =>
      pressAt(
        container,
        editor as DocxEditorInstance,
        origin.x + x - page.contentBox.x,
        origin.y + y - page.contentBox.y,
        paintedOf(container, record)
      );
    at(42, 77);
    expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId });
    at(130, 77);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a callout whose fill paints as a vector shape takes a press on its tail', async () => {
  // A gradient fill paints the chrome through the shape's components, with and without an
  // outline.
  for (const line of [LINE, '<a:ln><a:noFill/></a:ln>']) {
    const { editor, container } = await mount(
      p(callout('', 'margin', GRADIENT + line) + text('Anchor')) + FILLERS
    );
    try {
      const box = drawingNamed(editor, 41);
      expect(box.textboxStory?.chromeByVector).toBe(true);
      const frame = box.geometry.contentBounds;
      const painted = paintedOf(container, box);
      for (const [x, y] of [
        [42, 77],
        [42, 74],
      ] as const) {
        pressAt(container, editor, frame.x + x, frame.y + y, painted);
        expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
        pressAt(container, editor, 5, 600);
      }
      pressAt(container, editor, frame.x + 130, frame.y + 77, painted);
      expect(editor.getSelectedImage!()).toBeNull();
    } finally {
      editor.destroy();
      container.remove();
    }
  }
});

test('a callout behind the text takes a press that lands inside its frame', async () => {
  const { editor, container } = await mount(
    p(callout('', 'margin', `${SOLID('00AA00')}${LINE}`, true) + text('Anchor')) + FILLERS
  );
  try {
    const box = drawingNamed(editor, 41);
    expect(box.behindDocument).toBe(true);
    const frame = box.geometry.contentBounds;
    const painted = paintedOf(container, box);
    // The browser maps the press through the painted box, as it lays it out.
    const page = editor.surface!.layout().pages[0]!;
    const paint = box.paintBounds;
    painted.getBoundingClientRect = () =>
      new DOMRect(
        (page.contentBox.x + paint.x) * SCALE,
        (page.contentBox.y + paint.y) * SCALE,
        paint.width * SCALE,
        paint.height * SCALE
      );
    // Inside the frame, where a filler line runs: a press the browser lands on the box goes
    // to the box, as it does for a box without a tail.
    const line = editor
      .surface!.layout()
      .pages[0]!.fragments.find(
        (fragment) =>
          fragment.kind === 'paragraph' &&
          fragment.box.y > frame.y + 10 &&
          fragment.box.y + fragment.box.height < frame.y + frame.height
      )!;
    pressAt(container, editor, frame.x + 140, line.box.y + line.box.height / 2, painted);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
    // On the tail, and beside it.
    pressAt(container, editor, frame.x + 42, frame.y + 77, painted);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
    pressAt(container, editor, frame.x + 130, frame.y + 77, painted);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

/**
 * A press at (x, y)pt in the content box, as a browser that lays the painted box out at
 * `left`, `top` in client pixels, `pixelsPerPoint` to a point, maps it.
 */
function pressThroughClientBox(
  painted: HTMLElement,
  record: AnchoredDrawingRecord,
  x: number,
  y: number,
  { left, top, pixelsPerPoint }: { left: number; top: number; pixelsPerPoint: number }
): void {
  const paint = record.paintBounds;
  painted.getBoundingClientRect = () =>
    new DOMRect(left, top, paint.width * pixelsPerPoint, paint.height * pixelsPerPoint);
  painted.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      clientX: left + (x - paint.x) * pixelsPerPoint,
      clientY: top + (y - paint.y) * pixelsPerPoint,
    })
  );
}

test('a callout tail press maps through the client box the browser lays out', async () => {
  // Offsets from the frame's origin: on the tail, and beside it. A half turn puts the tail
  // above the frame, mirrored.
  const plain = `${SOLID('00AA00')}${LINE}`;
  const cases = [
    { name: 'outline', xfrm: '', paint: plain, on: [42, 77], beside: [130, 77] },
    { name: 'vector chrome', xfrm: '', paint: GRADIENT + LINE, on: [42, 77], beside: [130, 77] },
    { name: 'half turn', xfrm: ' rot="10800000"', paint: plain, on: [102, -5], beside: [132, -5] },
  ] as const;
  for (const { name, xfrm, paint, on, beside } of cases) {
    const { editor, container } = await mount(
      p(callout(xfrm, 'margin', paint) + text('Anchor')) + FILLERS
    );
    try {
      const box = drawingNamed(editor, 41);
      const frame = box.geometry.contentBounds;
      const painted = paintedOf(container, box);
      const page = editor.surface!.layout().pages[0]!;
      // The layout's own scale and origin, and a zoomed, scrolled box elsewhere.
      const clientBoxes = [
        {
          left: (page.contentBox.x + box.paintBounds.x) * SCALE,
          top: (page.contentBox.y + box.paintBounds.y) * SCALE,
          pixelsPerPoint: SCALE,
        },
        { left: 37, top: -200, pixelsPerPoint: 0.8 },
      ];
      for (const client of clientBoxes) {
        const label = `${name} at ${client.pixelsPerPoint}`;
        pressThroughClientBox(painted, box, frame.x + on[0], frame.y + on[1], client);
        expect([label, editor.getSelectedImage!()?.id]).toEqual([label, box.drawingNodeId]);
        pressThroughClientBox(painted, box, frame.x + beside[0], frame.y + beside[1], client);
        expect([label, editor.getSelectedImage!()]).toEqual([label, null]);
      }
    } finally {
      editor.destroy();
      container.remove();
    }
  }
});

test('a press beside a callout tail reaches a drawing behind the text there', async () => {
  // A 60 x 40pt square behind the text, under the point beside the tail.
  const behind = anchor({
    id: 42,
    name: 'Behind square',
    behind: true,
    x: 200 * EMU,
    y: 160 * EMU,
    cx: 60 * EMU,
    cy: 40 * EMU,
    graphic: wsp(60 * EMU, 40 * EMU, 'rect', SOLID('0000FF')),
    uri: SHAPE_URI,
  });
  const { editor, container } = await mount(p(callout() + behind + text('Anchor')) + FILLERS);
  try {
    const box = drawingNamed(editor, 41);
    const square = drawingNamed(editor, 42);
    const frame = box.geometry.contentBounds;
    const painted = paintedOf(container, box);
    pressAt(container, editor, frame.x + 130, frame.y + 77, painted);
    expect(editor.getSelectedImage!()?.id).toBe(square.drawingNodeId);
    // On the tail, the callout still takes the press.
    pressAt(container, editor, frame.x + 42, frame.y + 77, painted);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a turned text box with only an outline takes a press on its turned text', async () => {
  // A quarter turn about the frame centre (72, 36): the turned frame spans y from -36 to 108.
  const { editor, container } = await mount(
    p(callout(' rot="5400000"', 'margin', `<a:noFill/>${LINE}`) + text('Anchor')) + FILLERS
  );
  try {
    const box = drawingNamed(editor, 41);
    const frame = box.geometry.contentBounds;
    const painted = paintedOf(container, box);
    const page = editor.surface!.layout().pages[0]!;
    const client = {
      left: (page.contentBox.x + box.paintBounds.x) * SCALE,
      top: (page.contentBox.y + box.paintBounds.y) * SCALE,
      pixelsPerPoint: SCALE,
    };
    // Above the unturned frame, inside the turned one, off its outline.
    pressThroughClientBox(painted, box, frame.x + 72, frame.y - 20, client);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a turned text box with upright text takes a press anywhere on its text area', async () => {
  // A 200 x 50pt box turned 60 degrees with upright text: its text area swaps its width and
  // height and stays upright, so it reaches past both the unturned frame and the turned shape.
  const turned = anchor({
    id: 43,
    name: 'Upright text',
    x: 150 * EMU,
    y: 150 * EMU,
    cx: 200 * EMU,
    cy: 50 * EMU,
    graphic:
      `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm rot="3600000"><a:off x="0" y="0"/>` +
      `<a:ext cx="${200 * EMU}" cy="${50 * EMU}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${LINE}</wps:spPr>` +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>A note long enough to fill several lines' +
      '</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr upright="1"/></wps:wsp>',
    uri: SHAPE_URI,
  });
  const { editor, container } = await mount(p(turned + text('Anchor')) + FILLERS);
  try {
    const box = drawingNamed(editor, 43);
    const story = box.textboxStory!;
    const frame = box.geometry.contentBounds;
    expect(story.contentRotation).toBeUndefined();
    expect(story.contentHeight).toBeGreaterThan(frame.height);
    const area = {
      x: frame.x + story.contentOffset.x,
      y: frame.y + story.contentOffset.y,
      width: story.contentWidth,
      height: story.contentHeight,
    };
    // Every point on the text area reaches the box.
    let outside: { x: number; y: number } | null = null;
    for (let i = 1; i < 20; i += 1) {
      for (let j = 1; j < 20; j += 1) {
        const point = { x: area.x + (area.width * i) / 20, y: area.y + (area.height * j) / 20 };
        expect([point, textboxPressReaches(box, point)]).toEqual([point, true]);
        if (point.y > frame.y + frame.height + 5 && textboxOutlineHit(box, point) === false)
          outside ??= point;
      }
    }
    // A press there, below the frame and off the turned shape, selects the box.
    expect(outside).not.toBeNull();
    const page = editor.surface!.layout().pages[0]!;
    pressThroughClientBox(paintedOf(container, box), box, outside!.x, outside!.y, {
      left: (page.contentBox.x + box.paintBounds.x) * SCALE,
      top: (page.contentBox.y + box.paintBounds.y) * SCALE,
      pixelsPerPoint: SCALE,
    });
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a callout whose effect extent covers its tail still passes a press beside the tail', async () => {
  // A 10pt bottom effect extent reserves the band the tail paints in.
  const covered = (relativeFrom: 'margin' | 'page') =>
    callout('', relativeFrom).replace(
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
      `<wp:effectExtent l="0" t="0" r="0" b="${10 * EMU}"/>`
    );
  const body = await mount(p(covered('margin') + text('Anchor')) + FILLERS);
  try {
    const { editor, container } = body;
    const box = drawingNamed(editor, 41);
    const frame = box.geometry.contentBounds;
    const painted = paintedOf(container, box);
    pressAt(container, editor, frame.x + 42, frame.y + 77, painted);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
    pressAt(container, editor, frame.x + 130, frame.y + 77, painted);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    body.editor.destroy();
    body.container.remove();
  }
  const header = await mount(
    p(text('Body')) + FILLERS,
    `<w:p>${covered('page')}<w:r><w:t>Header</w:t></w:r></w:p>`
  );
  try {
    const { editor, container } = header;
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: 'rIdH' })).toBe(true);
    const page = surface.layout().pages[0]!;
    const story = page.header!;
    const record = story.anchoredDrawings!.find((d) => d.relativeHeight === 41)!;
    const origin = headerFooterAnchoredDrawingOrigin(record, story.box, page.box);
    const at = (x: number, y: number) =>
      pressAt(
        container,
        editor as DocxEditorInstance,
        origin.x + x - page.contentBox.x,
        origin.y + y - page.contentBox.y,
        paintedOf(container, record)
      );
    at(42, 77);
    expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId });
    at(130, 77);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    header.editor.destroy();
    header.container.remove();
  }
});

test('a turned text box passes a press past its frames, even inside its effect extent', async () => {
  // A 144 x 72pt rectangle box turned 30 degrees with only an outline, and a 20pt effect
  // extent on every side that covers its turned corners.
  const turned = callout(' rot="1800000"', 'margin', `<a:noFill/>${LINE}`)
    .replace('prst="wedgeRectCallout"', 'prst="rect"')
    .replace(
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
      `<wp:effectExtent l="${20 * EMU}" t="${20 * EMU}" r="${20 * EMU}" b="${20 * EMU}"/>`
    );
  const { editor, container } = await mount(p(turned + text('Anchor')) + FILLERS);
  try {
    const box = drawingNamed(editor, 41);
    const frame = box.geometry.contentBounds;
    const painted = paintedOf(container, box);
    // Left of the frame, inside the effect extent, off the turned frame and its outline: the
    // press goes to the text, as it does beside an unfilled shape.
    pressAt(container, editor, frame.x - 15, frame.y + 36, painted);
    expect(editor.getSelectedImage!()).toBeNull();
    // Inside the unturned frame, in a corner the turned frame leaves empty: the box.
    pressAt(container, editor, frame.x + 2, frame.y + 2, painted);
    expect(editor.getSelectedImage!()?.id).toBe(box.drawingNodeId);
  } finally {
    editor.destroy();
    container.remove();
  }
});
