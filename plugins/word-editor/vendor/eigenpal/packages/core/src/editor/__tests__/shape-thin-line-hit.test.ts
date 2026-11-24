// A straight line has a frame with no height (or no width): a press a few points from it still
// selects it, whatever element the browser reports under the press.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import {
  EMU,
  SHAPE_URI,
  anchor,
  drawingNamed,
  mount,
  p,
  pressAt,
  text,
} from './shape-selection-fixture.ts';

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

/** A line with no fill and a hairline outline, in front of the text, at y 200pt. */
function line(id: number, cx: number, cy: number, rot = 0): string {
  const graphic =
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm${rot ? ` rot="${rot * 60000}"` : ''}>` +
    `<a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>' +
    '<a:ln w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>' +
    '<wps:bodyPr/></wps:wsp>';
  return anchor({
    id,
    name: `Line ${id}`,
    x: 100 * EMU,
    y: 200 * EMU,
    cx,
    cy,
    graphic,
    uri: SHAPE_URI,
  });
}

async function selectsAt(drawing: string, id: number, dx: number, dy: number) {
  const { editor, container } = await mount(p(drawing + text('Anchor')) + FILLERS);
  try {
    const record = drawingNamed(editor, id);
    // A browser reports the page under a press beside a line with no height.
    pressAt(container, editor, record.x + record.width / 2 + dx, record.y + record.height / 2 + dy);
    return editor.getSelectedImage!()?.id === record.drawingNodeId;
  } finally {
    editor.destroy();
    container.remove();
  }
}

test('a horizontal line with no height takes a press a few points above or below it', async () => {
  expect(await selectsAt(line(11, 200 * EMU, 0), 11, 0, 2)).toBe(true);
  expect(await selectsAt(line(11, 200 * EMU, 0), 11, 0, -2)).toBe(true);
  expect(await selectsAt(line(11, 200 * EMU, 0), 11, 0, 12)).toBe(false);
});

test('a vertical line with no width takes a press a few points beside it', async () => {
  expect(await selectsAt(line(12, 0, 100 * EMU), 12, 2, 0)).toBe(true);
  expect(await selectsAt(line(12, 0, 100 * EMU), 12, -12, 0)).toBe(false);
});
