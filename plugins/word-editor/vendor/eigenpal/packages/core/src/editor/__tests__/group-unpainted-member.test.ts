// A group with one member that has no fill and no outline: the other member still paints, the
// group keeps its frame and selects, and a press on the painted member reaches the group.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import {
  EMU,
  GROUP_URI,
  SOLID,
  anchor,
  drawingNamed,
  mount,
  p,
  pressOn,
  text,
} from './shape-selection-fixture.ts';

const member = (x: number, fill: string, line: string) =>
  `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="${x}" y="0"/>` +
  `<a:ext cx="${100 * EMU}" cy="${80 * EMU}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}</wps:spPr><wps:bodyPr/></wps:wsp>`;

/** Two members side by side; the right one paints nothing. */
export const GROUP_WITH_UNPAINTED_MEMBER =
  '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${200 * EMU}" cy="${80 * EMU}"/><a:chOff x="0" y="0"/>` +
  `<a:chExt cx="${200 * EMU}" cy="${80 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
  member(0, SOLID('C00000'), '<a:ln><a:noFill/></a:ln>') +
  member(100 * EMU, '<a:noFill/>', '<a:ln><a:noFill/></a:ln>') +
  '</wpg:wgp>';

const GROUP = anchor({
  id: 9,
  name: 'Group',
  x: 50 * EMU,
  y: 100 * EMU,
  cx: 200 * EMU,
  cy: 80 * EMU,
  graphic: GROUP_WITH_UNPAINTED_MEMBER,
  uri: GROUP_URI,
});

test('a group paints its other members around a member that paints nothing', async () => {
  const { editor, container } = await mount(p(GROUP + text('Anchor words')));
  try {
    const group = drawingNamed(editor, 9);
    expect(group.vectorShape?.components).toHaveLength(1);
    expect(group.vectorShape!.components[0]!.fillHex).toBe('C00000');
    expect({ width: group.width, height: group.height }).toEqual({ width: 200, height: 80 });
    const painted = container.querySelector(
      `[data-drawing-node-id="${CSS.escape(group.drawingNodeId)}"]`
    )!;
    expect(painted.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(painted.innerHTML.toLowerCase()).toContain('#c00000');
    pressOn(container, editor, { ...group, width: 100 });
    expect(editor.getSelectedImage!()).toMatchObject({ id: group.drawingNodeId });
  } finally {
    editor.destroy();
    container.remove();
  }
});
