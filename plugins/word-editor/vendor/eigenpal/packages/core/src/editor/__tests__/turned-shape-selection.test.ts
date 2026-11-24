// A turned top-level shape or line paints turned about its extent centre, past its extent, and
// a press on what it paints selects it, even outside its unturned box. Its frame rings the
// turned extent; fill and outline edits keep the turn and flips on save.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';
import {
  findDrawingOverlayFrameInLayout,
  hitTestFragments,
} from '../../layout/semantic-hit-test.ts';
import { type ImageInteractionSession } from '../docx-editor-images.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import {
  finalizeImageOverlayInteraction,
  overlayFrameCssBox,
} from '../surface-overlay-coordinates.ts';
import {
  EMU,
  SHAPE_URI,
  anchor,
  drawingNamed,
  mount,
  p,
  pressAt,
  saved,
  text,
} from './shape-selection-fixture.ts';

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');
const RED = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>';
const OUTLINE = '<a:ln w="25400"><a:solidFill><a:srgbClr val="000080"/></a:solidFill></a:ln>';

function graphic(cx: number, cy: number, xfrm: string, prst: string, paint: string): string {
  return (
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm${xfrm}><a:off x="0" y="0"/>` +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `${paint}</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A 144 x 72pt red rectangle turned 30 degrees, at (100, 200)pt from the margins. */
const TURNED_RECT = anchor({
  id: 21,
  name: 'Turned',
  x: 100 * EMU,
  y: 200 * EMU,
  cx: 144 * EMU,
  cy: 72 * EMU,
  graphic: graphic(144 * EMU, 72 * EMU, ' rot="1800000" flipH="1"', 'rect', RED),
  uri: SHAPE_URI,
});

/** A 144pt line turned a quarter turn, upright through its centre at (172, 400)pt. */
const TURNED_LINE = anchor({
  id: 22,
  name: 'Upright line',
  x: 100 * EMU,
  y: 400 * EMU,
  cx: 144 * EMU,
  cy: 0,
  graphic: graphic(144 * EMU, 0, ' rot="5400000"', 'line', `<a:noFill/>${OUTLINE}`),
  uri: SHAPE_URI,
});

/** A line with no width and no height at (300, 400)pt: it paints nothing. */
const POINT_LINE = anchor({
  id: 23,
  name: 'Point',
  x: 300 * EMU,
  y: 400 * EMU,
  cx: 0,
  cy: 0,
  graphic: graphic(0, 0, ' rot="2700000"', 'line', `<a:noFill/>${OUTLINE}`),
  uri: SHAPE_URI,
});

async function withEditor(
  body: string,
  run: (editor: DocxEditorInstance, container: HTMLElement) => Promise<void> | void,
  header?: string
) {
  const { editor, container } = await mount(body, header);
  try {
    await run(editor, container);
  } finally {
    editor.destroy();
    container.remove();
  }
}

const centreOf = (editor: DocxEditorInstance, id: number) => {
  const box = drawingNamed(editor, id).geometry.contentBounds;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const painted = (container: HTMLElement, editor: DocxEditorInstance, id: number) =>
  container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(drawingNamed(editor, id).drawingNodeId)}"]`
  );

const selectedId = (editor: DocxEditorInstance) => editor.getSelectedImage!()?.id ?? null;

test('a turned shape paints past its box and a press on its turned corner selects it', async () => {
  await withEditor(p(TURNED_RECT + text('Anchor')) + FILLERS, (editor, container) => {
    const record = drawingNamed(editor, 21);
    expect(record.vectorShape?.rotationDegrees).toBe(30);
    expect(record.placeholderGraphicKind).not.toBeNull();
    // The paint clip reaches past the extent on every side the turned corners reach.
    expect(painted(container, editor, 21)!.style.clipPath).toContain('-');
    const c = centreOf(editor, 21);
    // Inside the turned rectangle and left of its unturned box: the press reaches the page.
    pressAt(container, editor, c.x - 78, c.y - 4.8);
    expect(selectedId(editor)).toBe(record.drawingNodeId);
    // The frame rings the turned extent: 144 x 72pt turned 30 degrees.
    const frame = selectedDrawingOverlayTargetOf(editor.surface!)!;
    expect(frame.width).toBeCloseTo(160.71, 1);
    expect(frame.height).toBeCloseTo(134.35, 1);
    expect(frame.x).toBeCloseTo(c.x - 80.35, 1);
    expect(frame.y).toBeCloseTo(c.y - 67.18, 1);
    // The overlay rings the unturned extent, turned about the frame centre, at any zoom.
    expect(frame.turn).toEqual({ rotationDegrees: 30, width: 144, height: 72 });
    const css = overlayFrameCssBox(
      { left: 10, top: 20, width: 321.42, height: 268.7 },
      frame.turn,
      2
    );
    expect(css).toMatchObject({ width: 288, height: 144, transform: 'rotate(30deg)' });
    expect(css.left).toBeCloseTo(26.71, 6);
    expect(css.top).toBeCloseTo(82.35, 6);
    const upright = { left: 1, top: 2, width: 3, height: 4 };
    expect(overlayFrameCssBox(upright, undefined, 2)).toBe(upright);
    // The unturned box corner, off the turned geometry, goes to the text.
    pressAt(container, editor, c.x - 70, c.y - 34, painted(container, editor, 21)!);
    expect(selectedId(editor)).toBeNull();
  });
});

test('a press on a turned corner in the page margin selects the shape', async () => {
  // At 40pt from the top of the page, the turned top corner reaches into the top margin.
  const nearTop = anchor({
    id: 24,
    name: 'Near top',
    relativeFrom: 'page',
    x: 100 * EMU,
    y: 40 * EMU,
    cx: 144 * EMU,
    cy: 72 * EMU,
    graphic: graphic(144 * EMU, 72 * EMU, ' rot="1800000"', 'rect', RED),
    uri: SHAPE_URI,
  });
  await withEditor(p(nearTop + text('Anchor')) + FILLERS, (editor, container) => {
    const c = centreOf(editor, 24);
    expect(c.y - 50).toBeLessThan(0);
    pressAt(container, editor, c.x - 30, c.y - 50);
    expect(selectedId(editor)).toBe(drawingNamed(editor, 24).drawingNodeId);
  });
});

test('fill and outline edits on a turned shape keep its turn and flip on save', async () => {
  await withEditor(p(TURNED_RECT + text('Anchor')) + FILLERS, async (editor, container) => {
    const c = centreOf(editor, 21);
    pressAt(container, editor, c.x, c.y, painted(container, editor, 21)!);
    expect(editor.getSelectedImage!()?.shapeFormat?.fill).toMatchObject({ color: 'FF0000' });
    expect(editor.getSelectedImage!()?.rotationDegrees).toBe(30);
    expect(editor.getSelectedImage!()?.canResize).toBe(false);
    expect(editor.getSelectedImage!()?.canMove).toBe(true);
    expect(editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    expect(editor.exec({ type: 'setShapeOutline', color: 'C00000', widthPt: 2 })).toMatchObject({
      ok: true,
    });
    const xml = await saved(editor);
    expect(xml).toMatch(/<a:xfrm (flipH="1" rot="1800000"|rot="1800000" flipH="1")>/);
    expect(xml).toContain('<a:srgbClr val="00B050"/>');
    expect(xml).toContain('<a:ln w="25400"><a:solidFill><a:srgbClr val="C00000"/>');
    // The edited shape still paints turned.
    expect(drawingNamed(editor, 21).vectorShape?.rotationDegrees).toBe(30);
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await saved(editor)).toContain('<a:srgbClr val="FF0000"/>');
    // Delete removes the selected turned shape.
    pressAt(container, editor, c.x, c.y, painted(container, editor, 21)!);
    expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(await saved(editor)).not.toContain('rot="1800000"');
  });
});

test('a turned line takes a press on its turned path, not on its unturned one', async () => {
  await withEditor(p(TURNED_LINE + POINT_LINE + text('Anchor')) + FILLERS, (editor, container) => {
    const line = drawingNamed(editor, 22);
    const c = centreOf(editor, 22);
    pressAt(container, editor, c.x + 1, c.y + 50);
    expect(selectedId(editor)).toBe(line.drawingNodeId);
    const frame = selectedDrawingOverlayTargetOf(editor.surface!)!;
    expect(frame.width).toBeCloseTo(0, 3);
    expect(frame.height).toBeCloseTo(144, 3);
    pressAt(container, editor, c.x + 50, c.y);
    expect(selectedId(editor)).toBeNull();
  });
});

test('a line with no width and no height paints nothing and still selects', async () => {
  await withEditor(
    p(TURNED_LINE + POINT_LINE + text('Anchor')) + FILLERS,
    async (editor, container) => {
      const point = drawingNamed(editor, 23);
      expect(point.vectorShape?.components).toEqual([]);
      expect(painted(container, editor, 23)?.querySelector('path') ?? null).toBeNull();
      const box = point.geometry.contentBounds;
      pressAt(container, editor, box.x + 1, box.y + 1);
      expect(selectedId(editor)).toBe(point.drawingNodeId);
      expect(await saved(editor)).toContain('<a:ext cx="0" cy="0"/>');
    }
  );
});

/** Every inline drawing record on the first page, in fragment order. */
function inlineDrawings(editor: DocxEditorInstance): InlineDrawingRecord[] {
  const found: InlineDrawingRecord[] = [];
  const walk = (blocks: readonly BlockFragmentRecord[]) => {
    for (const block of blocks) {
      if (block.kind !== 'paragraph') continue;
      for (const line of block.lines) found.push(...(line.drawings ?? []));
    }
  };
  walk(editor.surface!.layout().pages[0]!.fragments);
  return found;
}

test('a turned inline shape takes a press where it paints over the line above', async () => {
  const inline =
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:docPr id="31" name="Inline turned"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${SHAPE_URI}">` +
    graphic(144 * EMU, 72 * EMU, ' rot="1800000"', 'rect', RED) +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const body = p(text('Line above the shape')) + p(inline + text('after')) + FILLERS;
  await withEditor(body, (editor, container) => {
    const [drawing] = inlineDrawings(editor);
    expect(drawing?.vectorShape?.rotationDegrees).toBe(30);
    const box = drawing!.geometry.contentBounds;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Near the top corner, above the shape's own line: on the line above.
    expect(c.y - 50).toBeLessThan(drawing!.y);
    pressAt(container, editor, c.x - 30, c.y - 50);
    expect(selectedId(editor)).toBe(drawing!.drawingNodeId);
  });
});

test('a turned header shape frames its turned extent', async () => {
  const header = p(TURNED_RECT + text('Header'));
  await withEditor(
    p(text('Body')) + FILLERS,
    (editor) => {
      const layout = editor.surface!.layout();
      const drawing = layout.pages[0]!.header?.anchoredDrawings?.[0];
      expect(drawing?.vectorShape?.rotationDegrees).toBe(30);
      const frame = findDrawingOverlayFrameInLayout(layout, drawing!.drawingNodeId, 0)!;
      expect(frame.width).toBeCloseTo(160.71, 1);
      expect(frame.height).toBeCloseTo(134.35, 1);
    },
    header
  );
});

test('a move drag of a turned shape shifts its offsets by the drag, from its turned frame', async () => {
  await withEditor(p(TURNED_RECT + text('Anchor')) + FILLERS, async (editor, container) => {
    const c = centreOf(editor, 21);
    pressAt(container, editor, c.x, c.y, painted(container, editor, 21)!);
    const target = selectedDrawingOverlayTargetOf(editor.surface!)!;
    const start = target.position!;
    expect(start).toMatchObject({ mode: 'frame', horizontalEmu: 100 * EMU });
    const session = {
      startBounds: { x: target.x, y: target.y, width: target.width, height: target.height },
      startWidthEmu: target.widthEmu,
      startHeightEmu: target.heightEmu,
      startPosition: start,
      transform: target.transform,
      mode: 'move',
      handle: null,
    } as unknown as ImageInteractionSession;
    const move = (startPosition: typeof start) =>
      finalizeImageOverlayInteraction({
        session: { ...session, startPosition },
        deltaXPt: 10,
        deltaYPt: 20,
        accumulatedScrollPt: 0,
        aspectLocked: true,
        shiftKey: false,
        anchorFrameOrigin: target.anchorFrameOrigin,
      }).position!;
    expect(move(start)).toMatchObject({ horizontalEmu: 110 * EMU, verticalEmu: 220 * EMU });
    // An aligned axis has no offset: the turned frame's own shift cancels out of the origin.
    const aligned = { mode: 'frame', relativeToH: 'margin', relativeToV: 'margin' };
    const fromFrame = move(aligned as typeof start) as {
      horizontalEmu: number;
      verticalEmu: number;
    };
    expect(fromFrame.horizontalEmu).toBeCloseTo(110 * EMU, -1);
    expect(fromFrame.verticalEmu).toBeCloseTo(220 * EMU, -1);
    expect(
      editor.exec({ type: 'setImagePosition', horizontalEmu: 110 * EMU, verticalEmu: 220 * EMU })
    ).toMatchObject({ ok: true });
    expect(centreOf(editor, 21).x).toBeCloseTo(c.x + 10, 3);
    expect(drawingNamed(editor, 21).vectorShape?.rotationDegrees).toBe(30);
    expect(await saved(editor)).toMatch(
      /<a:xfrm (flipH="1" rot="1800000"|rot="1800000" flipH="1")>/
    );
  });
});

test('a turned shape that paints nothing takes a press inside its turned frame', async () => {
  const empty = anchor({
    id: 25,
    name: 'Unpainted',
    x: 100 * EMU,
    y: 200 * EMU,
    cx: 144 * EMU,
    cy: 72 * EMU,
    graphic: graphic(
      144 * EMU,
      72 * EMU,
      ' rot="1800000"',
      'rect',
      '<a:noFill/><a:ln><a:noFill/></a:ln>'
    ),
    uri: SHAPE_URI,
  });
  await withEditor(p(empty + text('Anchor')) + FILLERS, (editor, container) => {
    const record = drawingNamed(editor, 25);
    expect(record.vectorShape?.components).toEqual([]);
    const c = centreOf(editor, 25);
    // Inside the turned frame, left of the unturned box.
    pressAt(container, editor, c.x - 78, c.y - 4.8);
    expect(selectedId(editor)).toBe(record.drawingNodeId);
    // Inside the unturned box corner, outside the turned frame.
    pressAt(container, editor, c.x - 70, c.y - 34, painted(container, editor, 25)!);
    expect(selectedId(editor)).toBeNull();
  });
});

/** A header with a line of text above a 144 x 72pt inline rectangle turned 30 degrees. */
const TURNED_INLINE_HEADER =
  p(text('Header line above')) +
  p(
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      '<wp:docPr id="32" name="Header inline turned"/><wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData uri="${SHAPE_URI}">` +
      graphic(144 * EMU, 72 * EMU, ' rot="1800000"', 'rect', RED) +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>' +
      text('after')
  );

function headerInlineDrawing(editor: DocxEditorInstance) {
  const story = editor.surface!.layout().pages[0]!.header!;
  const drawing = story.fragments
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.drawings ?? [])[0]!;
  return { story, drawing };
}

test('a turned inline header shape takes a press over the header line above it', async () => {
  await withEditor(
    p(text('Body')) + FILLERS,
    (editor) => {
      const layout = editor.surface!.layout();
      const { story, drawing } = headerInlineDrawing(editor);
      expect(drawing.vectorShape?.rotationDegrees).toBe(30);
      const box = drawing.geometry.contentBounds;
      const point = { x: box.x + box.width / 2 - 30, y: box.y + box.height / 2 - 50 };
      expect(point.y).toBeLessThan(drawing.y);
      const hit = hitTestFragments(layout, 0, story.fragments, point);
      expect(hit?.drawing?.drawingNodeId).toBe(drawing.drawingNodeId);
    },
    TURNED_INLINE_HEADER
  );
});

test('a press on a turned inline header shape selects it only while the header is open', async () => {
  await withEditor(
    p(text('Body')) + FILLERS,
    async (editor, container) => {
      const page = editor.surface!.layout().pages[0]!;
      const { story, drawing } = headerInlineDrawing(editor);
      const box = drawing.geometry.contentBounds;
      // Story points, pressed in page-content points. Measured turned corners give the points
      // past the band: the top corner pokes above the story, the bottom one into the body.
      const points = {
        centre: { x: box.x + 72, y: box.y + 36 },
        overLineAbove: { x: box.x + 42, y: box.y - 14 },
        aboveBand: { x: box.x + 27.64, y: box.y - 28.18 },
        belowBand: { x: box.x + 116.36, y: box.y + 100.18 },
      };
      expect(story.box.y + points.aboveBand.y).toBeLessThan(story.box.y);
      expect(story.box.y + points.belowBand.y).toBeGreaterThan(page.contentBox.y);
      const press = async (point: { x: number; y: number }, open: boolean) => {
        pressAt(container, editor, 0, page.contentBox.height / 2);
        if (open) editor.exec({ type: 'editHeaderFooter', position: 'header' });
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          editor.surface!.layout();
        }
        pressAt(
          container,
          editor,
          story.box.x - page.contentBox.x + point.x,
          story.box.y - page.contentBox.y + point.y
        );
        return selectedId(editor);
      };
      for (const [name, point] of Object.entries(points)) {
        expect(`${name}: ${await press(point, false)}`).toBe(`${name}: null`);
        expect(`${name}: ${await press(point, true)}`).toBe(`${name}: ${drawing.drawingNodeId}`);
      }
    },
    TURNED_INLINE_HEADER
  );
});
