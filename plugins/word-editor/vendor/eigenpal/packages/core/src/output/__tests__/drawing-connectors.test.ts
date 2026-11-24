import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { buildInlineDrawingRecord } from '../../layout/drawing-layout.ts';
import { paintDrawingRecord, DEFAULT_DRAWING_PAINT_STRINGS } from '../semantic-paint-drawings.ts';

function fixture(
  options: {
    flip?: string;
    geom?: string;
    ends?: string;
    commands?: string;
    closed?: boolean;
    wrap?: boolean;
  } = {}
) {
  const geometry = options.geom
    ? `<a:prstGeom prst="${options.geom}"><a:avLst/></a:prstGeom>`
    : `<a:custGeom><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>${options.commands ?? '<a:lnTo><a:pt x="1000" y="1000"/></a:lnTo>'}${options.closed ? '<a:close/>' : ''}</a:path></a:pathLst></a:custGeom>`;
  let drawing = `<w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Synthetic connector"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr><a:xfrm ${options.flip ?? ''}><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>${geometry}<a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>${options.ends ?? '<a:tailEnd type="triangle" w="sm" len="lg"/>'}</a:ln></wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  if (options.wrap)
    drawing = `<mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice><mc:Fallback><w:pict><v:shape id="unchanged-fallback"/></w:pict></mc:Fallback></mc:AlternateContent>`;
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p><w:r>${drawing}</w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const projections = [...indexInlineDrawingProjectionsInPart(parsed.part).values()];
  expect(projections).toHaveLength(1);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return { projection: projections[0]!, part: parsed.part };
}

test('a flipped MC two-point connector and its triangle share projected coordinates', () => {
  const { projection, part } = fixture({ flip: 'flipH="1"', wrap: true });
  const component = projection.vectorShape!.components[0]!;
  // The line stops at the triangle's base, less half the line width: a 1 pt line sizes its
  // end as a 2 pt line does, so the large triangle is 10 pt long.
  const [start, end] = component.subpathsEmu[0]!;
  expect(start).toEqual({ x: 1270000, y: 0 });
  expect(Math.hypot(end!.x, end!.y - 635000)).toBeCloseTo(127000 - 6350, 6);
  expect(component.subpathsClosed).toEqual([false]);
  expect(component.arrowheadsEmu).toHaveLength(1);
  expect(component.arrowheadsEmu![0]![0]).toEqual({ x: 0, y: 635000 });
  expect(component.arrowheadsEmu![0]![1]!.x).toBeGreaterThan(0);
  expect(Object.isFrozen(component.subpathsClosed)).toBe(true);
  expect(Object.isFrozen(component.arrowheadsEmu![0]![0])).toBe(true);
  expect(serializeOoxmlPart(part)).toContain('unchanged-fallback');
});

test('straight connector presets stay open and double flips mirror both axes', () => {
  for (const geom of ['line', 'straightConnector1']) {
    const component = fixture({ geom, flip: 'flipH="true" flipV="1"', ends: '' }).projection
      .vectorShape!.components[0]!;
    expect(component.subpathsEmu).toEqual([
      [
        { x: 1270000, y: 635000 },
        { x: 0, y: 0 },
      ],
    ]);
    expect(component.subpathsClosed).toEqual([false]);
    expect(component.arrowheadsEmu).toBeUndefined();
  }
});

test('close commands keep closed shapes and do not add open-line decorations', () => {
  const component = fixture({ closed: true }).projection.vectorShape!.components[0]!;
  expect(component.subpathsClosed).toEqual([true]);
  expect(component.arrowheadsEmu).toBeUndefined();
});

test('unsupported visible ends, invalid flips and unknown presets remain refused', () => {
  for (const options of [
    { flip: 'flipH="yes"' },
    { geom: 'notAPreset' },
    { ends: '<a:tailEnd type="spiral"/>' },
    { ends: '<a:tailEnd type="triangle" w="url(x)"/>' },
  ]) {
    expect(fixture(options).projection.vectorShape).toBeNull();
  }
});

test('repeated terminal vertices use the last nonzero tangent and stay finite', () => {
  const { projection } = fixture({
    commands:
      '<a:lnTo><a:pt x="1000" y="1000"/></a:lnTo><a:lnTo><a:pt x="1000" y="1000"/></a:lnTo>',
    ends: '<a:headEnd type="triangle"/><a:tailEnd type="triangle"/>',
  });
  const arrows = projection.vectorShape!.components[0]!.arrowheadsEmu!;
  expect(arrows).toHaveLength(2);
  expect(arrows.flat().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
});

test('semantic painter leaves an open path open and fills its separate arrowhead', () => {
  const { projection } = fixture({ flip: 'flipH="1"' });
  const record = buildInlineDrawingRecord({
    input: {
      drawingNodeId: projection.drawingNodeId,
      ownerPartName: projection.ownerPartName,
      projection,
      resource: { kind: 'missing', partName: null, reason: 'no-resource' },
    },
    paragraphId: 'p',
    start: 0,
    slotX: 0,
    y: 0,
    baseline: 50,
    contentLeft: 0,
    contentRight: 200,
  });
  const element = paintDrawingRecord(
    document,
    record,
    { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
    null
  )!;
  expect(element.querySelector('path')!.getAttribute('d')).toMatch(/^M1270000 0L[\d.]+ [\d.]+$/);
  const arrow = element.querySelector('[data-docx-line-end]')!;
  expect(arrow.getAttribute('fill')).toBe('#FF0000');
  expect(element.querySelectorAll('path')).toHaveLength(2);
  expect(element.querySelector('image')).toBeNull();
  // The triangle's wings reach past the authored extent; the outer box at `paintBounds`
  // is the only clip, so the svg itself must not cut them off.
  expect(element.querySelector('svg')!.style.overflow).toBe('visible');
});

test('generated arrowhead vertices count against the existing per-drawing point budget', () => {
  const commands = '<a:lnTo><a:pt x="1000" y="1000"/></a:lnTo>'.repeat(1020);
  expect(fixture({ commands, ends: '' }).projection.vectorShape).not.toBeNull();
  expect(
    fixture({ commands, ends: '<a:headEnd type="triangle"/><a:tailEnd type="triangle"/>' })
      .projection.vectorShape
  ).toBeNull();
});
