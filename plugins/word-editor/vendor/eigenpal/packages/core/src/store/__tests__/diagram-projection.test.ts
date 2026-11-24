// SmartArt drawings projected from their saved drawing part: placed shape geometry, diagram
// background, lowered text members, refusal of unsupported content, and memo identity.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPackage, type DrawingProjection } from '../package/drawing-projection.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import {
  simpleTextBody,
  smartArtPackage,
  type SmartArtDocxOptions,
  type SmartArtShapeSpec,
} from './smartart-fixture.ts';

type Point = Readonly<{ x: number; y: number }>;

function project(options: SmartArtDocxOptions): DrawingProjection {
  return projectOf(smartArtPackage(options));
}

function projectOf(pkg: OoxmlPackage): DrawingProjection {
  const projections = projectDrawingsInPackage(pkg);
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function bounds(points: readonly Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function close(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(1);
}

const RECT: SmartArtShapeSpec = { preset: 'rect', off: [1000, 2000], ext: [3000, 4000] };
const NO_PAINT = '<a:noFill/>';
const NO_LINE = '<a:ln><a:noFill/></a:ln>';

describe('SmartArt diagram projection', () => {
  test('a rectangle paints at its offset in the frame', () => {
    const projection = project({ shapes: [RECT] });
    const [component] = projection.vectorShape!.components;
    expect(component!.subpathsEmu[0]).toEqual([
      { x: 1000, y: 2000 },
      { x: 4000, y: 2000 },
      { x: 4000, y: 6000 },
      { x: 1000, y: 6000 },
    ]);
    expect(component!.fillHex).toBe('4F81BD');
    expect(projection.diagnostics.filter((d) => d.code === 'unsupported-graphic')).toEqual([]);
  });

  test('presets beyond the basic set come from the geometry engine', () => {
    const projection = project({
      shapes: [
        { preset: 'roundRect', off: [0, 0], ext: [2000, 1000] },
        { preset: 'rightArrow', off: [3000, 0], ext: [2000, 1000] },
      ],
    });
    const [round, arrow] = projection.vectorShape!.components;
    expect(round!.subpathsEmu[0]!.length).toBeGreaterThan(8);
    const roundBox = bounds(round!.subpathsEmu[0]!);
    close(roundBox.minX, 0);
    close(roundBox.maxX, 2000);
    close(roundBox.minY, 0);
    close(roundBox.maxY, 1000);
    // The arrow's tip is the right edge at the vertical centre.
    expect(arrow!.subpathsEmu[0]).toContainEqual({ x: 5000, y: 500 });
  });

  test('preset adjust values change the geometry', () => {
    const plain = project({ shapes: [{ preset: 'roundRect', off: [0, 0], ext: [2000, 1000] }] });
    const tight = project({
      shapes: [{ preset: 'roundRect', avLst: { adj: 0 }, off: [0, 0], ext: [2000, 1000] }],
    });
    expect(plain.vectorShape!.components[0]!.subpathsEmu[0]).not.toContainEqual({ x: 0, y: 0 });
    expect(tight.vectorShape!.components[0]!.subpathsEmu[0]).toContainEqual({ x: 0, y: 0 });
  });

  test('rotation turns a shape about its centre', () => {
    const projection = project({
      shapes: [{ preset: 'rect', off: [0, 0], ext: [4000, 2000], rot: 5_400_000 }],
    });
    const box = bounds(projection.vectorShape!.components[0]!.subpathsEmu[0]!);
    close(box.minX, 1000);
    close(box.maxX, 3000);
    close(box.minY, -1000);
    close(box.maxY, 3000);
  });

  test('flips mirror the geometry inside its box', () => {
    const projection = project({
      shapes: [{ preset: 'rightArrow', off: [0, 0], ext: [2000, 1000], flipH: true }],
    });
    expect(projection.vectorShape!.components[0]!.subpathsEmu[0]).toContainEqual({ x: 0, y: 500 });
  });

  test('the data model background and outline paint first, over the whole frame', () => {
    const projection = project({
      extent: [10000, 5000],
      shapes: [RECT],
      background: '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
      whole: '<a:ln w="12700"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln>',
    });
    const [background, shape] = projection.vectorShape!.components;
    expect(background!.fillHex).toBe('FF0000');
    expect(background!.strokeHex).toBe('00FF00');
    expect(background!.strokeWidthEmu).toBe(12700);
    expect(bounds(background!.subpathsEmu[0]!)).toEqual({
      minX: 0,
      maxX: 10000,
      minY: 0,
      maxY: 5000,
    });
    expect(shape!.fillHex).toBe('4F81BD');
  });

  test('text lays out in the text rectangle with the body insets and anchor', () => {
    const projection = project({
      shapes: [
        {
          ...RECT,
          txBody: simpleTextBody('Alpha', 2000, 'anchor="ctr" lIns="1" tIns="2" rIns="3" bIns="4"'),
          txXfrm: { off: [1100, 2100], ext: [2800, 3800] },
        },
      ],
    });
    const [member] = projection.groupTextboxes!;
    expect(member!.frameEmu).toEqual({ x: 1100, y: 2100, cx: 2800, cy: 3800 });
    expect(member!.story.verticalAnchor).toBe('center');
    expect(member!.story.insetsEmu).toEqual({ top: 2, right: 3, bottom: 4, left: 1 });
    expect(member!.story.drawingText).toBe(true);
    expect(member!.story.fillHex).toBeNull();
    expect(member!.rotationDegrees).toBe(0);
  });

  test('without a text rectangle the text takes the shape box', () => {
    const projection = project({ shapes: [{ ...RECT, txBody: simpleTextBody('Alpha') }] });
    expect(projection.groupTextboxes![0]!.frameEmu).toEqual({
      x: 1000,
      y: 2000,
      cx: 3000,
      cy: 4000,
    });
  });

  test('text turns by the shape turn plus the text rectangle and body turns', () => {
    const upright = project({
      shapes: [
        {
          ...RECT,
          rot: 5_400_000,
          txBody: simpleTextBody('Alpha'),
          txXfrm: { off: [1000, 2000], ext: [3000, 4000], rot: -5_400_000 },
        },
      ],
    });
    expect(upright.groupTextboxes![0]!.rotationDegrees).toBe(0);
    const turned = project({
      shapes: [
        {
          ...RECT,
          rot: 5_400_000,
          txBody: simpleTextBody('Alpha', 2000, 'rot="5400000"'),
          txXfrm: { off: [1000, 2000], ext: [3000, 4000] },
        },
      ],
    });
    expect(turned.groupTextboxes![0]!.rotationDegrees).toBe(180);
  });

  test('hidden shapes paint nothing and carry no text', () => {
    const projection = project({
      shapes: [RECT, { ...RECT, hidden: true, txBody: simpleTextBody('Hidden') }],
    });
    expect(projection.vectorShape!.components).toHaveLength(1);
    expect(projection.groupTextboxes).toBeUndefined();
  });

  test('a shape without fill or outline contributes its text only', () => {
    const projection = project({
      shapes: [{ ...RECT, fill: NO_PAINT, ln: NO_LINE, txBody: simpleTextBody('Only text') }],
    });
    expect(projection.vectorShape).toBeNull();
    expect(projection.groupTextboxes).toHaveLength(1);
    expect(projection.diagnostics.filter((d) => d.code === 'unsupported-graphic')).toEqual([]);
  });

  test('a missing saved drawing keeps the placeholder diagnostic', () => {
    for (const drawingRelationship of ['none', 'dangling'] as const) {
      const projection = project({ shapes: [RECT], drawingRelationship });
      expect(projection.vectorShape).toBeNull();
      expect(projection.groupTextboxes).toBeUndefined();
      expect(projection.diagnostics.some((d) => d.code === 'unsupported-graphic')).toBe(true);
    }
  });

  test('one unsupported visible shape refuses the whole diagram', () => {
    const projection = project({
      shapes: [RECT, { preset: 'notAPreset', off: [0, 0], ext: [100, 100] }],
    });
    expect(projection.vectorShape).toBeNull();
    expect(projection.diagnostics.some((d) => d.code === 'unsupported-graphic')).toBe(true);
  });

  test('nested groups scale their members from child space', () => {
    const projection = project({
      shapes: [
        {
          group: { off: [1000, 1000], ext: [2000, 2000], chOff: [0, 0], chExt: [1000, 1000] },
          children: [{ preset: 'rect', off: [0, 0], ext: [1000, 1000] }],
        },
      ],
    });
    expect(bounds(projection.vectorShape!.components[0]!.subpathsEmu[0]!)).toEqual({
      minX: 1000,
      maxX: 3000,
      minY: 1000,
      maxY: 3000,
    });
  });

  test('more shapes than the diagram bound refuse the diagram', () => {
    const shapes = Array.from({ length: 513 }, (_, index): SmartArtShapeSpec => ({
      preset: 'rect',
      off: [index, 0],
      ext: [10, 10],
    }));
    expect(project({ shapes }).vectorShape).toBeNull();
    expect(project({ shapes: shapes.slice(0, 512) }).vectorShape!.components).toHaveLength(512);
  });

  test('an anchored diagram projects the same content', () => {
    const projection = project({ anchored: true, shapes: [RECT] });
    expect(projection.kind).toBe('anchored');
    expect(projection.vectorShape!.components).toHaveLength(1);
  });

  test('theme colours resolve through the package theme', () => {
    const projection = project({
      shapes: [{ ...RECT, fill: '<a:solidFill><a:schemeClr val="accent2"/></a:solidFill>' }],
    });
    expect(projection.vectorShape!.components[0]!.fillHex).toBe('C0504D');
  });

  test('projection returns identical text stories while the diagram is unchanged', () => {
    const pkg = smartArtPackage({ shapes: [{ ...RECT, txBody: simpleTextBody('Alpha') }] });
    const first = projectOf(pkg);
    const again = projectOf(pkg);
    expect(again.groupTextboxes).toBe(first.groupTextboxes);
    // A later package revision shares the untouched parts but rebuilds every resolver.
    const revision = { ...pkg, parts: new Map(pkg.parts) } as OoxmlPackage;
    const next = projectOf(revision);
    expect(next.groupTextboxes![0]!.story.content).toBe(first.groupTextboxes![0]!.story.content);
  });
});
