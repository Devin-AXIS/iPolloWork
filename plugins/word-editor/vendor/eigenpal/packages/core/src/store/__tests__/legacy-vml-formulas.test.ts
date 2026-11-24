// VML template formulas and straight-segment paths: the values a preset text box reads.

import { describe, expect, test } from 'bun:test';
import {
  isFullRectangle,
  vmlFormulaValues,
  vmlOperands,
  vmlPolygonPath,
} from '../package/legacy-vml-formulas.ts';

const SIZE = { width: 21600, height: 21600 };

describe('VML formulas', () => {
  test('a down-arrow template resolves its adjust values and formulas in order', () => {
    const values = vmlFormulaValues(
      [
        'val #0',
        'val #1',
        'sum height 0 #1',
        'sum 10800 0 #1',
        'sum width 0 #0',
        'prod @4 @3 10800',
        'sum width 0 @5',
      ],
      { ...SIZE, adjust: [16200, 5400] }
    );
    expect(values).toEqual([16200, 5400, 16200, 5400, 5400, 2700, 18900]);
  });

  test('every operation reads its arguments', () => {
    const at = (eqn: string, adjust: number[] = []) =>
      vmlFormulaValues([eqn], { ...SIZE, adjust })?.[0];
    expect(at('mid 10 20')).toBe(15);
    expect(at('abs -4')).toBe(4);
    expect(at('min 3 9')).toBe(3);
    expect(at('max 3 9')).toBe(9);
    expect(at('if 1 7 8')).toBe(7);
    expect(at('if 0 7 8')).toBe(8);
    expect(at('mod 3 4 0')).toBe(5);
    expect(at('sqrt 81')).toBe(9);
    expect(at('val xcenter')).toBe(10800);
    expect(at('sumangle 0 90 0')).toBe(90 * 65536);
    expect(at('cos 100 0')).toBeCloseTo(100, 9);
    expect(at('sin 100 5898240')).toBeCloseTo(100, 9);
    expect(at('ellipse 0 10 7')).toBe(7);
  });

  test('unknown operations, names and references refuse the template', () => {
    expect(vmlFormulaValues(['frob 1 2'], { ...SIZE, adjust: [] })).toBeNull();
    expect(vmlFormulaValues(['constructor 1'], { ...SIZE, adjust: [] })).toBeNull();
    expect(vmlFormulaValues(['__proto__ 1'], { ...SIZE, adjust: [] })).toBeNull();
    expect(vmlFormulaValues(['val pixelWidth'], { ...SIZE, adjust: [] })).toBeNull();
    expect(vmlFormulaValues(['val @0'], { ...SIZE, adjust: [] })).toBeNull();
    expect(vmlFormulaValues(['val #3'], { ...SIZE, adjust: [1] })).toBeNull();
    expect(vmlFormulaValues(['prod 1 2 0'], { ...SIZE, adjust: [] })).toBeNull();
    expect(vmlFormulaValues(['sum 1 2 3 4'], { ...SIZE, adjust: [] })).toBeNull();
    expect(vmlFormulaValues(Array(129).fill('val 1'), { ...SIZE, adjust: [] })).toBeNull();
  });
});

describe('VML paths', () => {
  test('operand runs read empty slots, spaces and run-together references', () => {
    expect(vmlOperands(',')).toEqual(['', '']);
    expect(vmlOperands('0@0')).toEqual(['0', '@0']);
    expect(vmlOperands('@1@0@1,0')).toEqual(['@1', '@0', '@1', '0']);
    expect(vmlOperands(' 10 20 ')).toEqual(['10', '20']);
    expect(vmlOperands('   ')).toEqual([]);
  });

  test('both rectangle spellings close one full rectangle', () => {
    for (const path of ['m,l,21600r21600,l21600,xe', 'm0,0l0,21600,21600,21600,21600,0xe']) {
      const polygons = vmlPolygonPath(path, []);
      expect(polygons).toHaveLength(1);
      expect(polygons![0]!.closed).toBe(true);
      expect(isFullRectangle(polygons!, 21600, 21600)).toBe(true);
    }
    expect(isFullRectangle(vmlPolygonPath('m10800,l,21600r21600,xe', [])!, 21600, 21600)).toBe(
      false
    );
    // Four corners without a close are three edges, not a rectangle.
    expect(
      isFullRectangle(vmlPolygonPath('m0,0l21600,0,21600,21600,0,21600e', [])!, 21600, 21600)
    ).toBe(false);
  });

  test('a formula path traces its points', () => {
    const polygons = vmlPolygonPath(
      'm0@0l@1@0@1,0@2,0@2@0,21600@0,10800,21600xe',
      [16200, 5400, 16200]
    );
    expect(polygons![0]!.points).toEqual([
      { x: 0, y: 16200 },
      { x: 5400, y: 16200 },
      { x: 5400, y: 0 },
      { x: 16200, y: 0 },
      { x: 16200, y: 16200 },
      { x: 21600, y: 16200 },
      { x: 10800, y: 21600 },
    ]);
  });

  test('closing returns the pen to the start of the subpath', () => {
    const polygons = vmlPolygonPath('m0,0l10,0,10,10xr5,5e', []);
    expect(polygons![1]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  test('curves, arcs and unknown commands are not traced', () => {
    expect(vmlPolygonPath('m0,0c1,1,2,2,3,3xe', [])).toBeNull();
    expect(vmlPolygonPath('m0,0qx10,10xe', [])).toBeNull();
    expect(vmlPolygonPath('m0,0at0,0,10,10,0,0,10,10xe', [])).toBeNull();
    expect(vmlPolygonPath('m0,0l@9,0xe', [])).toBeNull();
    expect(vmlPolygonPath('m0,0l10,0,10,10nfnsxe', [])).toHaveLength(1);
  });
});
