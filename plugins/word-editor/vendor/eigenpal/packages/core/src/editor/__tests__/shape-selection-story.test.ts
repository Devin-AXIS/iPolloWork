// Presses on header and footer drawings placed against the page, a watermark that reaches into
// the body while its header is open, and a press the selected frame hands to another drawing.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { drawingFramePressTarget, passDrawingFramePress } from '../drawing-overlay-press.ts';
import type { DocxEditorInstance } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import { headerFooterAnchoredDrawingOrigin } from '../../layout/header-footer-drawing-origin.ts';
import type { HeaderFooterStoryRecord, PageRecord } from '../../layout/semantic-records.ts';
import {
  BEHIND,
  EMU,
  SCALE,
  SHAPE_URI,
  SOLID,
  anchor,
  drawingNamed,
  gapY,
  mount,
  p,
  pressAt,
  text,
  wsp,
} from './shape-selection-fixture.ts';

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

/** A solid rectangle placed against the page, not the margins. */
function pageShape(id: number, x: number, y: number, cx: number, cy: number, behind = false) {
  return anchor({
    id,
    name: `Shape ${id}`,
    x: x * EMU,
    y: y * EMU,
    cx: cx * EMU,
    cy: cy * EMU,
    graphic: wsp(cx * EMU, cy * EMU, 'rect', SOLID('9DC3E6')),
    uri: SHAPE_URI,
    behind,
    relativeFrom: 'page',
  });
}

/** The middle of a story drawing, in page-content points, where the page paints it. */
function middleOf(
  page: PageRecord,
  story: HeaderFooterStoryRecord,
  drawing: AnchoredDrawingRecord
) {
  const origin = headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box);
  return {
    x: origin.x + drawing.width / 2 - page.contentBox.x,
    y: origin.y + drawing.height / 2 - page.contentBox.y,
  };
}

/** The painted element of a drawing: the press target in front of everything else. */
function paintedOf(container: HTMLElement, record: AnchoredDrawingRecord): HTMLElement {
  return container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(record.drawingNodeId)}"]`
  )!;
}

function storyDrawing(
  story: HeaderFooterStoryRecord | undefined,
  id: number
): AnchoredDrawingRecord {
  const drawing = story?.anchoredDrawings?.find((record) => record.relativeHeight === id);
  if (!drawing) throw new Error(`no story drawing ${id}`);
  return drawing;
}

test('header and footer drawings placed against the page select where they paint', async () => {
  // Off the story box on both axes: right of the margin and above the header's top.
  const logo = pageShape(11, 460, 12, 100, 40);
  const mark = pageShape(12, 470, 750, 100, 30);
  const { editor, container } = await mount(
    p(text('Body')) + FILLERS,
    `<w:p>${logo}<w:r><w:t>Header</w:t></w:r></w:p>`,
    `<w:p>${mark}<w:r><w:t>Footer</w:t></w:r></w:p>`
  );
  try {
    const surface = editor.surface!;
    for (const [rId, kind, id] of [
      ['rIdH', 'header', 11],
      ['rIdF', 'footer', 12],
    ] as const) {
      expect(surface.enterHeaderFooter({ rId })).toBe(true);
      const page = surface.layout().pages[0]!;
      const story = page[kind]!;
      const record = storyDrawing(story, id);
      expect(record.horizontalFrame).toBe('page');
      expect(record.verticalFrame).toBe('page');
      const at = middleOf(page, story, record);
      pressAt(container, editor as DocxEditorInstance, at.x, at.y, paintedOf(container, record));
      expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId });
      surface.exitHeaderFooter();
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a header watermark reaching into the body selects while the header is open', async () => {
  const watermark = pageShape(13, 150, 300, 300, 300, true);
  const { editor, container } = await mount(
    p(text('Body')) + FILLERS,
    `<w:p>${watermark}<w:r><w:t>Header</w:t></w:r></w:p>`
  );
  try {
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: 'rIdH' })).toBe(true);
    const page = surface.layout().pages[0]!;
    const record = storyDrawing(page.header, 13);
    const at = middleOf(page, page.header!, record);
    // Well below the header band, over the body.
    expect(at.y).toBeGreaterThan(200);
    pressAt(container, editor as DocxEditorInstance, at.x, at.y);
    expect(surface.activeScope()).toMatchObject({ kind: 'headerFooter', rId: 'rIdH' });
    expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId });
  } finally {
    editor.destroy();
    container.remove();
  }
});

for (const [behind, locked] of [
  [true, false],
  [false, false],
  [true, true],
  [false, true],
] as const)
  test(`a ${locked ? 'locked ' : ''}header ${behind ? 'watermark' : 'logo'} on another page`, async () => {
    const shape = pageShape(13, 150, 300, 300, 300, behind);
    // A drawing that does not select leaves the open header on its page.
    const lock = '<wp:cNvGraphicFramePr><a:graphicFrameLocks noSelect="1"/></wp:cNvGraphicFramePr>';
    const watermark = locked ? shape.replace('<wp:cNvGraphicFramePr/>', lock) : shape;
    const lines = Array.from({ length: 90 }, (_, i) => p(text(`Line ${i}`))).join('');
    const { editor, container } = await mount(
      p(text('Body')) + lines,
      `<w:p>${watermark}<w:r><w:t>Header</w:t></w:r></w:p>`
    );
    try {
      const surface = editor.surface!;
      expect(surface.enterHeaderFooter({ rId: 'rIdH', pageIndex: 0 })).toBe(true);
      const page = surface.layout().pages[1]!;
      const record = storyDrawing(page.header, 13);
      const origin = headerFooterAnchoredDrawingOrigin(record, page.header!.box, page.box);
      // Behind the text, the press lands on the text layer; in front, on the page's painted copy.
      const painted = [
        ...container.querySelectorAll<HTMLElement>(
          `[data-drawing-node-id="${CSS.escape(record.drawingNodeId)}"]`
        ),
      ].find(
        (element) => element.closest('[data-page-index]')?.getAttribute('data-page-index') === '1'
      );
      const target = behind
        ? container.querySelector<HTMLElement>('.docx-page-content')!
        : painted!;
      expect(target).toBeTruthy();
      // The programmatic entry scrolls the band into view; a press must not move the page.
      let programmaticEntries = 0;
      const enter = surface.enterHeaderFooter.bind(surface);
      surface.enterHeaderFooter = (args) => {
        programmaticEntries += 1;
        return enter(args);
      };
      target.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX: (origin.x + record.width / 2) * SCALE,
          clientY: (origin.y + record.height / 2) * SCALE,
        })
      );
      expect(surface.activeScope()).toMatchObject({ kind: 'headerFooter', rId: 'rIdH' });
      expect(programmaticEntries).toBe(0);
      if (locked) {
        expect(editor.getSelectedImage!()).toBeNull();
        expect(surface.currentPage('caret')).toBe(1);
        return;
      }
      expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId });
      // The edit moved to the page pressed, so the frame sits over that page's watermark.
      expect(surface.currentPage('caret')).toBe(2);
      expect(selectedDrawingOverlayTargetOf(surface)?.pageIndex).toBe(1);
    } finally {
      editor.destroy();
      container.remove();
    }
  });

test('a press on the selected frame over another drawing selects that drawing', async () => {
  // In front of the text, inside the frame of the shape behind it.
  const badge = anchor({
    id: 14,
    name: 'Badge',
    x: 300 * EMU,
    y: 30 * EMU,
    cx: 60 * EMU,
    cy: 20 * EMU,
    graphic: wsp(60 * EMU, 20 * EMU, 'rect', SOLID('A9D18E')),
    uri: SHAPE_URI,
  });
  const spaced = '<w:pPr><w:spacing w:after="600"/></w:pPr>';
  const elementsFromPoint = document.elementsFromPoint;
  const { editor, container } = await mount(p(spaced + BEHIND + badge + text('Short')) + FILLERS);
  try {
    pressAt(container, editor, 380, gapY(editor));
    const behind = drawingNamed(editor, 1);
    expect(editor.getSelectedImage!()).toMatchObject({ id: behind.drawingNodeId });
    const other = drawingNamed(editor, 14);
    const page = editor.surface!.layout().pages[0]!;
    // A frame over the pages, as an adapter paints it, over the other drawing's painted box.
    const frame = document.createElement('div');
    container.append(frame);
    const painted = paintedOf(container, other);
    document.elementsFromPoint = () => [frame, painted];
    let result: ReturnType<typeof passDrawingFramePress> | undefined;
    let asked: ReturnType<typeof drawingFramePressTarget> | undefined;
    frame.addEventListener('pointerdown', (event) => {
      asked = drawingFramePressTarget(editor, event);
      result = passDrawingFramePress(editor, event);
    });
    frame.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: (page.contentBox.x + other.x + other.width / 2) * SCALE,
        clientY: (page.contentBox.y + other.y + other.height / 2) * SCALE,
      })
    );
    // The frame names the drawing, so an adapter hands it the keyboard, and the press selects it.
    expect(asked).toEqual({ drawingNodeId: other.drawingNodeId });
    expect(result).toEqual({ drawingNodeId: other.drawingNodeId });
    expect(editor.getSelectedImage!()).toMatchObject({ id: other.drawingNodeId });
  } finally {
    document.elementsFromPoint = elementsFromPoint;
    editor.destroy();
    container.remove();
  }
});
