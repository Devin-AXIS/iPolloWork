// A turned group paints every member turned about its extent centre, past its extent, and a
// press on a painted member selects the group. Its frame rings the turned extent. A second
// press keeps the group: its members have no upright boxes to select one by.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import {
  EMU,
  GROUP_URI,
  SOLID,
  anchor,
  drawingNamed,
  mount,
  p,
  pressAt,
  saved,
  text,
  wsp,
} from './shape-selection-fixture.ts';

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

/** A 144 x 72pt group of two squares turned 30 degrees, at (100, 200)pt from the margins. */
const TURNED_GROUP = anchor({
  id: 41,
  name: 'Turned group',
  x: 100 * EMU,
  y: 200 * EMU,
  cx: 144 * EMU,
  cy: 72 * EMU,
  graphic:
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm rot="1800000"><a:off x="0" y="0"/>' +
    `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/><a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${144 * EMU}" cy="${72 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
    wsp(72 * EMU, 72 * EMU, 'rect', SOLID('FF0000')) +
    wsp(72 * EMU, 72 * EMU, 'rect', SOLID('0000FF')).replace(
      '<a:off x="0" y="0"/>',
      `<a:off x="${72 * EMU}" y="0"/>`
    ) +
    '</wpg:wgp>',
  uri: GROUP_URI,
});

test('a turned group paints turned, selects by a member past its box, and rings turned', async () => {
  const { editor, container } = await mount(p(TURNED_GROUP + text('Anchor')) + FILLERS);
  try {
    const record = drawingNamed(editor, 41);
    expect(record.vectorShape?.rotationDegrees).toBe(30);
    expect(record.placeholderGraphicKind).not.toBeNull();
    const painted = container.querySelector<HTMLElement>(
      `[data-drawing-node-id="${CSS.escape(record.drawingNodeId)}"]`
    )!;
    expect(painted.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    // The clip reaches past the extent where the turned corners do.
    expect(painted.style.clipPath).toContain('-');
    const box = record.geometry.contentBounds;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Inside the turned red square, above the unturned box: the press reaches the page.
    pressAt(container, editor, c.x - 40, c.y - 40);
    expect(editor.getSelectedImage!()?.id).toBe(record.drawingNodeId);
    const frame = selectedDrawingOverlayTargetOf(editor.surface!)!;
    expect(frame.turn).toEqual({ rotationDegrees: 30, width: 144, height: 72 });
    // A second press on the same member keeps the whole group selected.
    pressAt(container, editor, c.x - 40, c.y - 40);
    expect(editor.getSelectedImage!()?.id).toBe(record.drawingNodeId);
    expect(selectedDrawingOverlayTargetOf(editor.surface!)?.turn?.rotationDegrees).toBe(30);
    // The unturned box corner, off the turned members, goes to the text.
    pressAt(container, editor, c.x + 70, c.y - 34, painted);
    expect(editor.getSelectedImage!()).toBeNull();
    // Saving writes the group's turn back unchanged.
    expect(await saved(editor)).toContain('<a:xfrm rot="1800000">');
  } finally {
    editor.destroy();
    container.remove();
  }
});
