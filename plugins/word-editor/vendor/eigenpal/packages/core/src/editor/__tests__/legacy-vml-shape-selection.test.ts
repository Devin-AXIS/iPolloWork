// A standalone VML shape in `w:pict`, with no modern copy, selects as a shape: it gives the
// image state, keeps its frame, and refuses the picture frame edits up front.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { mount, p, saved, text } from './shape-selection-fixture.ts';

const RECT =
  '<w:r><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml" id="Box" ' +
  'style="position:absolute;margin-left:72pt;margin-top:120pt;width:144pt;height:72pt;z-index:2" ' +
  'fillcolor="#d9e2f3" strokecolor="#1f3864" strokeweight="1pt"/></w:pict></w:r>';

test('a standalone VML shape gives the image state and keeps its frame', async () => {
  const { editor, container } = await mount(p(RECT + text('Anchor words')));
  try {
    const drawings = editor.surface!.layout().pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(drawings).toHaveLength(1);
    const record = drawings[0]!;
    expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
    expect(editor.getSelectedImage!()).toMatchObject({
      id: record.drawingNodeId,
      canResize: false,
      canMove: false,
    });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a standalone VML shape takes fill and outline edits', async () => {
  const { editor, container } = await mount(p(RECT + text('Anchor words')));
  try {
    const record = editor.surface!.layout().pages[0]!.anchoredDrawings![0]!;
    expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
    expect(editor.exec({ type: 'setShapeFill', color: 'FF0000' })).toMatchObject({ ok: true });
    expect(editor.exec({ type: 'setShapeOutline', visible: false })).toMatchObject({ ok: true });
    const xml = await saved(editor);
    expect(xml).toContain('fillcolor="#ff0000"');
    expect(xml).toContain('stroked="f"');
  } finally {
    editor.destroy();
    container.remove();
  }
});
