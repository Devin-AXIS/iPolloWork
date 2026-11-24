// `setShapeFill` and `setShapeOutline` on a selected shape, line or group: each is one undo
// step, the selected image state reads the result back, and `can` refuses what exec refuses.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import {
  BODY,
  drawingNamed,
  gapY,
  mount,
  pressAt,
  pressOn,
  saved,
  THEME_XML,
} from './shape-selection-fixture.ts';
import { editSelectedShape } from '../selected-shape.ts';

test('a fill and an outline each apply as one undo step and read back', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.getSelectedImage!()?.shapeFormat).toEqual({
      fill: { type: 'solid', color: 'FFE699', transparency: 0 },
      outline: { visible: true, color: '000000', widthPt: 1, dash: 'solid' },
    });
    expect(editor.can({ type: 'setShapeFill', color: '#4472c4', transparency: 0.4 })).toEqual({
      ok: true,
    });
    expect(
      editor.exec({ type: 'setShapeFill', color: '#4472c4', transparency: 0.4 })
    ).toMatchObject({ ok: true, changed: true });
    expect(editor.exec({ type: 'setShapeOutline', color: 'C00000', widthPt: 3 })).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(editor.snapshot().image?.shapeFormat).toEqual({
      fill: { type: 'solid', color: '4472C4', transparency: 0.4 },
      outline: { visible: true, color: 'C00000', widthPt: 3, dash: 'solid' },
    });
    const xml = await saved(editor);
    expect(xml).toContain('<a:srgbClr val="4472C4"><a:alpha val="60000"/></a:srgbClr>');
    expect(xml).toContain('<a:ln w="38100"><a:solidFill><a:srgbClr val="C00000"/>');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.outline.color).toBe('000000');
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.color).toBe('4472C4');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await saved(editor)).toContain('<a:srgbClr val="FFE699"/>');
    expect(editor.exec({ type: 'setShapeFill', visible: false })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.type).toBe('none');
    expect(editor.exec({ type: 'setShapeFill', visible: true })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.color).toBe('FFE699');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a theme colour writes a theme reference that reads back as a theme', async () => {
  const { editor, container } = await mount(BODY, undefined, undefined, THEME_XML);
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(
      editor.exec({ type: 'setShapeFill', color: { theme: 'accent1', shift: 40 } })
    ).toMatchObject({ ok: true, changed: true });
    expect(editor.snapshot().image?.shapeFormat?.fill).toEqual({
      type: 'solid',
      color: '8FAADC',
      transparency: 0,
      theme: { name: 'accent1', shift: 40 },
    });
    expect(
      editor.exec({ type: 'setShapeOutline', color: { theme: 'accent1', shift: -25 } })
    ).toMatchObject({ ok: true });
    const xml = await saved(editor);
    expect(xml).toContain(
      '<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>'
    );
    expect(xml).toContain('<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>');
    // A theme pick in the pane sends the theme colour; the same pick again sends nothing.
    const image = editor.snapshot().image;
    expect(editSelectedShape(editor, image, { type: 'fillColor', color: 'accent1' })).toMatchObject(
      { ok: true, changed: true }
    );
    expect(editor.snapshot().image?.shapeFormat?.fill.theme).toEqual({ name: 'accent1', shift: 0 });
    const now = editor.snapshot().image;
    expect(editSelectedShape(editor, now, { type: 'fillColor', color: 'accent1' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(editSelectedShape(editor, now, { type: 'fillColor', color: '#4472c4' })).toMatchObject({
      ok: true,
      changed: true,
    });
    // Typed RGB replaces the reference, so the fill is no longer named as a theme colour.
    expect(editor.snapshot().image?.shapeFormat?.fill.theme).toBeUndefined();
    expect(
      editor.can({ type: 'setShapeFill', color: { theme: 'accent1', shift: 120 } })
    ).toMatchObject({ ok: false, reason: 'the fill or outline value is out of range' });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a theme colour in a document with no theme writes the default theme RGB', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.exec({ type: 'setShapeFill', color: { theme: 'accent2' } })).toMatchObject({
      ok: true,
    });
    expect(editor.snapshot().image?.shapeFormat?.fill).toEqual({
      type: 'solid',
      color: 'ED7D31',
      transparency: 0,
    });
    expect(await saved(editor)).toContain('<a:srgbClr val="ED7D31"/>');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a group takes the fill on every shape; bad values and stale ids refuse in can and exec', async () => {
  const { editor, container } = await mount();
  try {
    const group = drawingNamed(editor, 3);
    pressOn(container, editor, group);
    expect(editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill).toEqual({
      type: 'solid',
      color: '00B050',
      transparency: 0,
    });
    // A CSS color name writes its hex value, as `Shape.fill` takes it.
    expect(editor.exec({ type: 'setShapeFill', color: 'teal' })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.color).toBe('008080');
    expect(editor.exec({ type: 'setShapeFill', color: 'RebeccaPurple' })).toMatchObject({
      ok: true,
    });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.color).toBe('663399');
    for (const command of [
      { type: 'setShapeFill', color: 'greenish' },
      { type: 'setShapeFill', transparency: 1.5 },
      { type: 'setShapeFill' },
      { type: 'setShapeOutline', widthPt: 0 },
      { type: 'setShapeOutline', visible: false, color: '000000' },
    ] as const) {
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'invalidArgs' });
    }
    expect(editor.can({ type: 'setShapeFill', color: '000000', drawingNodeId: 'x' })).toMatchObject(
      { ok: false, code: 'notFound' }
    );
    const line = drawingNamed(editor, 2);
    pressOn(container, editor, line);
    expect(editor.exec({ type: 'setShapeOutline', visible: false })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.outline.visible).toBe(false);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('with nothing selected the commands refuse', async () => {
  const { editor, container } = await mount();
  try {
    expect(editor.can({ type: 'setShapeOutline', color: '000000' })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
  } finally {
    editor.destroy();
    container.remove();
  }
});
