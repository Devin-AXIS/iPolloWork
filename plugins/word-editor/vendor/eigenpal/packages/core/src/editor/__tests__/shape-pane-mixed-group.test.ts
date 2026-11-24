// A whole group whose members have different fills reads as mixed in the Format shape pane,
// not as a shape with no solid fill, and a pick still sets every member.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { GROUP, drawingNamed, mount, p, saved, text } from './shape-selection-fixture.ts';
import { editSelectedShape, readSelectedShape } from '../selected-shape.ts';

test('a group with mixed fills reads as mixed and a pick sets every member', async () => {
  const { editor, container } = await mount(p(GROUP + text('Anchor words')));
  try {
    const group = drawingNamed(editor, 3);
    expect(editor.surface!.selectDrawing(group.drawingNodeId, group.paragraphId)).toBe(true);
    const image = editor.snapshot().image;
    const view = readSelectedShape(editor, image);
    expect(view.format?.fill.type).toBe('mixed');
    expect(view.canEditFill).toBe(true);
    expect(view.canEditTransparency).toBe(false);
    expect(view.transparencyDisabledReason).toBe(
      'the shapes in this group have different fills; pick a color to set them all'
    );
    expect(editSelectedShape(editor, image, { type: 'fillColor', color: '#C00000' })).toMatchObject(
      { ok: true, changed: true }
    );
    expect((await saved(editor)).match(/<a:srgbClr val="C00000"\/>/g)).toHaveLength(2);
  } finally {
    editor.destroy();
    container.remove();
  }
});
