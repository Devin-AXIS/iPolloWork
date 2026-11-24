// A text box with "Resize shape to fit text" (`a:spAutoFit`), as Word often writes one, takes the
// height of its text. A resize that changes its height turns the fit off (`a:noAutofit`), so the
// box keeps the height it was given instead of snapping back. A width-only resize keeps the fit.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import {
  EMU,
  MC,
  SHAPE_URI,
  SOLID,
  anchor,
  mount,
  p,
  saved,
  text,
} from './shape-selection-fixture.ts';

const VML = 'urn:schemas-microsoft-com:vml';

const FITTED = anchor({
  id: 21,
  name: 'Fitted',
  x: 0,
  y: 100 * EMU,
  cx: 200 * EMU,
  cy: 150 * EMU,
  graphic:
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
    `<a:ext cx="${200 * EMU}" cy="${150 * EMU}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${SOLID('FFFF00')}</wps:spPr>` +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>One line</w:t></w:r></w:p></w:txbxContent>' +
    '</wps:txbx><wps:bodyPr><a:spAutoFit/></wps:bodyPr></wps:wsp>',
  uri: SHAPE_URI,
});

/** The same box as Word writes it: DrawingML in `mc:Choice`, a VML copy in `mc:Fallback`. */
const WORD_FITTED = FITTED.replace(
  '<w:r><w:drawing>',
  `<w:r><mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="wps"><w:drawing>`
).replace(
  '</w:drawing></w:r>',
  `</w:drawing></mc:Choice><mc:Fallback><w:pict><v:rect xmlns:v="${VML}" ` +
    'style="position:absolute;width:200pt;height:150pt;mso-fit-shape-to-text:t" ' +
    'fillcolor="yellow"><v:textbox><w:txbxContent><w:p><w:r><w:t>One line</w:t></w:r></w:p>' +
    '</w:txbxContent></v:textbox></v:rect></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
);

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

function box(editor: DocxEditorInstance): AnchoredDrawingRecord {
  const found = editor.surface!.layout().pages[0]!.anchoredDrawings?.[0];
  if (!found) throw new Error('no anchored drawing');
  return found;
}

function select(editor: DocxEditorInstance): void {
  const record = box(editor);
  expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
}

for (const [label, drawing] of [
  ['a DrawingML text box', FITTED],
  ['a text box with a VML fallback', WORD_FITTED],
] as const) {
  test(`${label} that fits its text keeps a new height and drops the fit`, async () => {
    const { editor, container } = await mount(p(drawing + text('Anchor')) + FILLERS);
    try {
      const fitted = box(editor).height;
      // The box takes the height of its one line, not its 150pt extent.
      expect(fitted).toBeLessThan(60);
      select(editor);
      const image = editor.getSelectedImage!()!;
      expect(image.canResize).toBe(true);
      // The selection and a drag both read the painted height, not the 150pt extent.
      const painted = Math.round(fitted * EMU);
      expect(image.heightEmu).toBe(painted);
      expect(selectedDrawingOverlayTargetOf(editor.surface)!.heightEmu).toBe(painted);
      const before = await saved(editor);

      // A width-only resize keeps the fit: the height still follows the text.
      expect(editor.exec({ type: 'setImageProperties', widthEmu: 240 * EMU })).toMatchObject({
        ok: true,
      });
      expect(await saved(editor)).toContain('<a:spAutoFit/>');
      expect(box(editor).width).toBeCloseTo(240, 0);
      expect(box(editor).height).toBeCloseTo(fitted, 0);

      // Keeping the painted height, as a side-handle drag does, keeps the fit too.
      select(editor);
      expect(
        editor.exec({ type: 'setImageProperties', widthEmu: 260 * EMU, heightEmu: painted })
      ).toMatchObject({ ok: true });
      expect(await saved(editor)).toContain('<a:spAutoFit/>');
      expect(box(editor).height).toBeCloseTo(fitted, 0);

      // A height change turns the fit off, and the box keeps the new height. The saved extent's
      // own height counts as a change, because the box does not paint at it.
      select(editor);
      expect(
        editor.exec({ type: 'setImageProperties', widthEmu: 240 * EMU, heightEmu: 150 * EMU })
      ).toMatchObject({ ok: true });
      const resized = await saved(editor);
      expect(resized).not.toContain('<a:spAutoFit/>');
      expect(resized).toContain('<a:noAutofit/>');
      expect(box(editor).height).toBeCloseTo(150, 0);
      select(editor);
      expect(editor.getSelectedImage!()!.heightEmu).toBe(150 * EMU);

      // Undo brings back the fit with the size.
      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
      expect(await saved(editor)).toBe(before);
      expect(box(editor).height).toBeCloseTo(fitted, 0);
    } finally {
      editor.destroy();
      container.remove();
    }
  });
}
