// A legacy (VML-only) shape has no transparency: the Format shape pane disables the field up
// front with that reason, and still lets the fill and outline change.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { mount, p, text } from './shape-selection-fixture.ts';
import { readSelectedShape } from '../selected-shape.ts';

const RECT =
  '<w:r><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml" id="Box" ' +
  'style="position:absolute;margin-left:72pt;margin-top:120pt;width:144pt;height:72pt;z-index:2" ' +
  'fillcolor="#d9e2f3" strokecolor="#1f3864" strokeweight="1pt"/></w:pict></w:r>';

test('a legacy shape disables transparency with its reason', async () => {
  const { editor, container } = await mount(p(RECT + text('Anchor words')));
  try {
    const record = editor.surface!.layout().pages[0]!.anchoredDrawings![0]!;
    expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
    const view = readSelectedShape(editor, editor.snapshot().image);
    expect(view.format?.fill.type).toBe('solid');
    expect(view.canEditFill).toBe(true);
    expect(view.canEditOutline).toBe(true);
    expect(view.canEditTransparency).toBe(false);
    expect(view.transparencyDisabledReason).toBe('a legacy shape has no transparency');
  } finally {
    editor.destroy();
    container.remove();
  }
});
