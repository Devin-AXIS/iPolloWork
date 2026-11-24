// Rotate and flip apply to pictures only. Every kind of selected shape and text box refuses them with the
// same code and reason from `can` and from `exec`, and leaves the document as it was.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import {
  EMU,
  GROUP,
  LINE,
  MC,
  SHAPE_URI,
  SOLID,
  anchor,
  mount,
  p,
  saved,
  text,
  wsp,
} from './shape-selection-fixture.ts';

const VML = 'urn:schemas-microsoft-com:vml';

const TURNED = anchor({
  id: 11,
  name: 'Turned',
  x: 100 * EMU,
  y: 120 * EMU,
  cx: 144 * EMU,
  cy: 72 * EMU,
  graphic: wsp(144 * EMU, 72 * EMU, 'rect', SOLID('FF0000')).replace(
    '<a:xfrm>',
    '<a:xfrm rot="1800000" flipH="1">'
  ),
  uri: SHAPE_URI,
});

const UPRIGHT = anchor({
  id: 12,
  name: 'Upright',
  x: 300 * EMU,
  y: 120 * EMU,
  cx: 100 * EMU,
  cy: 50 * EMU,
  graphic: wsp(100 * EMU, 50 * EMU, 'ellipse', SOLID('00B050')),
  uri: SHAPE_URI,
});

/** A shape with a VML fallback copy, as DOCX producers write it. */
const WITH_FALLBACK = anchor({
  id: 13,
  name: 'With fallback',
  x: 300 * EMU,
  y: 400 * EMU,
  cx: 100 * EMU,
  cy: 50 * EMU,
  graphic: wsp(100 * EMU, 50 * EMU, 'ellipse', SOLID('0070C0')),
  uri: SHAPE_URI,
})
  .replace(
    '<w:r><w:drawing>',
    `<w:r><mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="wps"><w:drawing>`
  )
  .replace(
    '</w:drawing></w:r>',
    `</w:drawing></mc:Choice><mc:Fallback><w:pict><v:oval xmlns:v="${VML}" ` +
      'style="position:absolute;width:100pt;height:50pt" fillcolor="#0070c0"/></w:pict>' +
      '</mc:Fallback></mc:AlternateContent></w:r>'
  );

/** A standalone VML shape with no DrawingML copy. */
const LEGACY =
  `<w:r><w:pict><v:rect xmlns:v="${VML}" id="Box" ` +
  'style="position:absolute;margin-left:72pt;margin-top:520pt;width:144pt;height:72pt;' +
  'z-index:2" fillcolor="#d9e2f3" strokecolor="#1f3864" strokeweight="1pt"/></w:pict></w:r>';

const INLINE =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="${100 * EMU}" cy="${50 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  '<wp:docPr id="14" name="Inline"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${SHAPE_URI}">` +
  wsp(100 * EMU, 50 * EMU, 'rect', SOLID('FFC000')) +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

const TEXTBOX = anchor({
  id: 15,
  name: 'Text box',
  x: 300 * EMU,
  y: 250 * EMU,
  cx: 144 * EMU,
  cy: 72 * EMU,
  graphic:
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
    `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${SOLID('FFFF00')}</wps:spPr>` +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
    '<wps:bodyPr/></wps:wsp>',
  uri: SHAPE_URI,
});

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');
const BODY =
  p(TURNED + UPRIGHT + LINE + GROUP + WITH_FALLBACK + LEGACY + TEXTBOX + text('Anchor')) +
  p(INLINE + text(' inline')) +
  FILLERS;

function drawings(editor: DocxEditorInstance): (InlineDrawingRecord | AnchoredDrawingRecord)[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) => [
      ...(page.anchoredDrawings ?? []),
      ...page.fragments.flatMap((block) =>
        block.kind === 'paragraph' ? block.lines.flatMap((line) => line.drawings ?? []) : []
      ),
    ]);
}

const ACTIONS = ['rotateCW', 'rotateCCW', 'flipH', 'flipV'] as const;

test('every kind of shape refuses rotate and flip from can and exec alike', async () => {
  const { editor, container } = await mount(BODY);
  try {
    const before = await saved(editor);
    const all = drawings(editor);
    // Turned, upright, line, group, fallback copy, legacy VML, text box, and inline.
    expect(all).toHaveLength(8);
    expect(all.filter((record) => 'textboxStory' in record && record.textboxStory)).toHaveLength(1);
    for (const record of all) {
      expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
      expect(editor.getSelectedImage!()?.id).toBe(record.drawingNodeId);
      for (const action of ACTIONS) {
        const refusal = {
          ok: false,
          code: 'unsupported',
          reason: `rotate and flip are not supported for ${
            'textboxStory' in record && record.textboxStory ? 'text boxes' : 'shapes'
          }`,
        };
        expect(editor.can({ type: 'transformImage', action })).toEqual(refusal);
        expect(editor.exec({ type: 'transformImage', action })).toEqual(refusal);
        // The same refusal when the command names the selected shape.
        const named = { type: 'transformImage', action, drawingNodeId: record.drawingNodeId };
        expect(editor.exec(named as Parameters<typeof editor.exec>[0])).toEqual(refusal);
      }
    }
    expect(await saved(editor)).toBe(before);
  } finally {
    editor.destroy();
    container.remove();
  }
});
