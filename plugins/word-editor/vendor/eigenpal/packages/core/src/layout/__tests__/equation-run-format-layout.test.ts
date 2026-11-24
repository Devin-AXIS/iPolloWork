import { expect, test } from 'bun:test';
import type { EquationExpression, OmmlEquationProjection } from '@docx-editor.dev/core/store';
import { layoutEquation } from '../equation-layout.ts';
import { resolveRunStyle } from '../run-style.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import type { ResolvedRunStyle } from '../run-style.ts';

const projection = (expression: EquationExpression): OmmlEquationProjection => ({
  sourceNodeId: 'public-equation',
  expression,
  fallbackText: 'Q4al',
  truncated: false,
  visitedNodes: 12,
});

test('measures source text with the face and upright override carried to paint', () => {
  const measured: ResolvedRunStyle[] = [];
  const fixed = createFixedMeasurer(6, 14);
  const measurer = {
    ...fixed,
    measure: (text: string, style: ResolvedRunStyle) => {
      measured.push(style);
      return fixed.measure(text, style);
    },
  };
  const sourceStyle = Object.freeze({ ...resolveRunStyle([]), italic: true });
  const result = layoutEquation(
    projection({
      kind: 'text',
      value: 'al',
      format: { fontFamily: 'Public Face', normalText: true, bold: true },
    }),
    measurer,
    sourceStyle
  );
  expect(result.geometry.kind).toBe('text');
  if (result.geometry.kind !== 'text') throw new Error('missing text');
  expect(measured.length).toBeGreaterThan(0);
  expect(result.geometry.runStyle).toBe(measured[0]);
  expect(result.geometry.runStyle?.fontFamily).toBe('Public Face');
  expect(result.geometry.runStyle?.italic).toBe(false);
  expect(result.geometry.runStyle?.bold).toBe(true);
  expect(sourceStyle.italic).toBe(true);
});

test('script sub/sup positions remain separate while sharing the script column', () => {
  const result = layoutEquation(
    projection({
      kind: 'script',
      base: { kind: 'text', value: 'Q' },
      subscript: { kind: 'text', value: '4' },
      superscript: { kind: 'text', value: 'al' },
    }),
    createFixedMeasurer(6, 14),
    resolveRunStyle([])
  );
  const geometry = result.geometry;
  if (geometry.kind !== 'script' || !geometry.subscript || !geometry.superscript)
    throw new Error('missing script geometry');
  expect(geometry.subscript.box.x).toBe(geometry.superscript.box.x);
  expect(geometry.subscript.box.y).toBeGreaterThan(geometry.base.box.y);
  expect(geometry.superscript.box.y).toBeLessThan(geometry.base.box.y);
});

test.each(['top', 'bottom'] as const)(
  'places a %s bar outside the body without changing its advance',
  (position) => {
    const result = layoutEquation(
      projection({ kind: 'bar', position, body: { kind: 'text', value: 'N' } }),
      createFixedMeasurer(6, 14),
      resolveRunStyle([])
    );
    const geometry = result.geometry;
    if (geometry.kind !== 'bar') throw new Error('missing bar');
    expect(geometry.box.width).toBe(geometry.body.box.width);
    expect(geometry.box.height).toBeGreaterThan(geometry.body.box.height);
    if (position === 'top')
      expect(geometry.bar.y + geometry.bar.height).toBeLessThan(geometry.body.box.y);
    else expect(geometry.bar.y).toBeGreaterThan(geometry.body.box.height);
  }
);

test('draws operator glyphs of structures with control properties in the default math face', () => {
  const nary = (controlProperties?: true): EquationExpression => ({
    kind: 'nary',
    operator: '∑',
    body: {
      kind: 'radical',
      radicand: { kind: 'text', value: 'x' },
      ...(controlProperties ? { controlProperties } : {}),
    },
    ...(controlProperties ? { controlProperties } : {}),
  });
  const layout = (expression: EquationExpression) =>
    layoutEquation(projection(expression), createFixedMeasurer(6, 14), resolveRunStyle([]));
  const controlled = layout(nary(true));
  expect(controlled.geometry.kind).toBe('nary');
  expect(controlled.geometry).toEqual(layout(nary()).geometry);
});
