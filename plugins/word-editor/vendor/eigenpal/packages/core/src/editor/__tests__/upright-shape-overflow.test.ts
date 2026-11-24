// An upright shape paints its whole geometry and outline, past its extent and past a negative
// effect extent: a callout's tail shows below its box, and a press on the tail selects it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import {
  EMU,
  SCALE,
  SHAPE_URI,
  SOLID,
  anchor,
  drawingNamed,
  mount,
  p,
  pressAt,
  saved,
  text,
} from './shape-selection-fixture.ts';

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

function shape(prst: string, paint: string): string {
  return (
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
    `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${paint}</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A 144 x 72pt callout at (100, 100)pt: its default tail tip sits at (54, 81)pt in it. */
const CALLOUT = anchor({
  id: 31,
  name: 'Callout',
  x: 100 * EMU,
  y: 100 * EMU,
  cx: 144 * EMU,
  cy: 72 * EMU,
  graphic: shape('wedgeRectCallout', SOLID('FF0000')),
  uri: SHAPE_URI,
});

/** A 144 x 72pt rectangle with a 12pt outline and a 20pt negative effect extent. */
const SHRUNK = anchor({
  id: 32,
  name: 'Shrunk',
  x: 100 * EMU,
  y: 300 * EMU,
  cx: 144 * EMU,
  cy: 72 * EMU,
  graphic: shape(
    'rect',
    SOLID('FFFF00') + '<a:ln w="152400"><a:solidFill><a:srgbClr val="008080"/></a:solidFill></a:ln>'
  ),
  uri: SHAPE_URI,
}).replace('<wp:effectExtent l="0" t="0" r="0" b="0"/>', effect(-20));

function effect(pt: number): string {
  const v = pt * EMU;
  return `<wp:effectExtent l="${v}" t="${v}" r="${v}" b="${v}"/>`;
}

/** The clip inset of a painted drawing, in points per side: negative reaches past its box. */
function clipInsets(container: HTMLElement, editor: DocxEditorInstance, id: number) {
  const element = container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(drawingNamed(editor, id).drawingNodeId)}"]`
  )!;
  const match = /^inset\((\S+)px (\S+)px (\S+)px (\S+)px\)$/.exec(element.style.clipPath);
  if (!match) return null;
  const [top, right, bottom, left] = match.slice(1, 5).map((v) => Number(v) / SCALE);
  return { top: top!, right: right!, bottom: bottom!, left: left! };
}

test('an upright callout paints its tail past its box and a press there selects it', async () => {
  const { editor, container } = await mount(p(CALLOUT + SHRUNK + text('Anchor')) + FILLERS);
  try {
    const callout = drawingNamed(editor, 31);
    expect(callout.vectorShape?.overflowVisible).toBe(true);
    expect(callout.vectorShape?.rotationDegrees).toBeUndefined();
    // The tail reaches 9pt below the 72pt box: (72 * 62500 / 100000) past its centre.
    const insets = clipInsets(container, editor, 31)!;
    expect(insets.bottom).toBeCloseTo(-9, 3);
    expect(insets.top).toBeCloseTo(0, 3);
    // A press on the tail, below the box, selects the callout.
    const box = callout.geometry.contentBounds;
    pressAt(container, editor, box.x + 54, box.y + 76);
    expect(editor.getSelectedImage!()?.id).toBe(callout.drawingNodeId);
    // A press beside the tail, below the box, goes to the text.
    pressAt(container, editor, box.x + 130, box.y + 76);
    expect(editor.getSelectedImage!()).toBeNull();
    // Nothing is written back differently.
    expect(await saved(editor)).toContain('prst="wedgeRectCallout"');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a negative effect extent does not cut an upright shape or its outline', async () => {
  const { editor, container } = await mount(p(CALLOUT + SHRUNK + text('Anchor')) + FILLERS);
  try {
    // The paint box sits 20pt inside the extent; the clip reaches the 6pt outer outline half.
    const insets = clipInsets(container, editor, 32)!;
    for (const side of ['top', 'right', 'bottom', 'left'] as const)
      expect(insets[side]).toBeCloseTo(-26, 3);
  } finally {
    editor.destroy();
    container.remove();
  }
});

/** A 100 x 50pt inline rectangle with an 8pt outline and a 10pt negative top effect extent. */
const INLINE_SHRUNK =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="${100 * EMU}" cy="${50 * EMU}"/>` +
  `<wp:effectExtent l="0" t="${-10 * EMU}" r="0" b="0"/>` +
  '<wp:docPr id="51" name="Inline shrunk"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${SHAPE_URI}">` +
  `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
  `<a:ext cx="${100 * EMU}" cy="${50 * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  SOLID('FFFF00') +
  '<a:ln w="101600"><a:solidFill><a:srgbClr val="008080"/></a:solidFill></a:ln>' +
  '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

/** The top clip inset of the one painted inline drawing, in points: negative reaches above. */
function inlineTopInset(container: HTMLElement): number {
  const element = container.querySelector<HTMLElement>('.docx-page [data-drawing-node-id]')!;
  const match = /^inset\((\S+)px /.exec(element.style.clipPath);
  return match ? Number(match[1]) / SCALE : 0;
}

test('a cell top cuts an inline shape whose effect extent reaches above it, at any spacing', async () => {
  const cell = (content: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  for (const before of [0, 1]) {
    const shape = p(`<w:pPr><w:spacing w:before="${before}"/></w:pPr>${INLINE_SHRUNK}`);
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid>' +
      '<w:gridCol w:w="4000"/></w:tblGrid>' +
      `<w:tr>${cell(p(text('Row above')))}</w:tr><w:tr>${cell(shape)}</w:tr></w:tbl>`;
    const { editor, container } = await mount(table + p(text('After')));
    try {
      // The shape paints from the cell top down, never over the row above.
      expect([before, inlineTopInset(container)]).toEqual([before, expect.any(Number)]);
      expect(inlineTopInset(container)).toBeGreaterThan(-0.1);
    } finally {
      editor.destroy();
      container.remove();
    }
  }
});

test('an inline callout takes a press on its tail below its line', async () => {
  // A 144 x 72pt inline callout: its default tail tip sits at (54, 81)pt in its box.
  const inline =
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:docPr id="52" name="Inline callout"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${SHAPE_URI}">` +
    shape('wedgeRectCallout', SOLID('FF0000')) +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const { editor, container } = await mount(p(text('Before')) + p(inline) + FILLERS);
  try {
    const record = editor
      .surface!.layout()
      .pages[0]!.fragments.flatMap((block) =>
        block.kind === 'paragraph' ? block.lines.flatMap((line) => line.drawings ?? []) : []
      )[0]!;
    expect(record.vectorShape?.overflowVisible).toBe(true);
    // On the tail, below the box and over the next line: the callout.
    pressAt(container, editor, record.x + 54, record.y + 76);
    expect(editor.getSelectedImage!()?.id).toBe(record.drawingNodeId);
    // Beside the tail: the text.
    pressAt(container, editor, record.x + 130, record.y + 76);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('an exact-height row that hides an inline tail does not let a press select it there', async () => {
  // A 144 x 72pt inline callout in a 75pt exact-height row: its tail tip at 81pt is cut off.
  const inline =
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:docPr id="53" name="Cell callout"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${SHAPE_URI}">` +
    shape('wedgeRectCallout', SOLID('FF0000')) +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid>' +
    '<w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:trHeight w:val="1500" w:hRule="exact"/></w:trPr>' +
    `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${p(inline)}</w:tc></w:tr></w:tbl>`;
  const { editor, container } = await mount(table + FILLERS);
  try {
    const page = editor.surface!.layout().pages[0]!;
    const tableBlock = page.fragments.find((block) => block.kind === 'table')!;
    const cellBlock =
      tableBlock.kind === 'table' ? tableBlock.rows[0]!.cells[0]!.blocks[0]! : undefined;
    expect(cellBlock?.kind === 'paragraph' && cellBlock.clipToBox).toBe(true);
    const record = cellBlock!.kind === 'paragraph' ? cellBlock!.lines[0]!.drawings![0]! : null;
    const clip = cellBlock!.box;
    // Inside the box, the callout takes the press.
    pressAt(container, editor, record!.x + 54, record!.y + 36);
    expect(editor.getSelectedImage!()?.id).toBe(record!.drawingNodeId);
    // On the hidden tail, below the clipped paragraph: not the callout.
    const y = record!.y + 77;
    expect(y).toBeGreaterThan(clip.y + clip.height);
    pressAt(container, editor, record!.x + 54, y);
    expect(editor.getSelectedImage!()?.id).not.toBe(record!.drawingNodeId);
  } finally {
    editor.destroy();
    container.remove();
  }
});
