// An inset outline is clipped to its geometry with the shape's own fill rule, so the half of
// the stroke it keeps matches the filled area, as in PDF export.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { applyInsetStroke } from '../vector-shape-svg.ts';

const SVG = 'http://www.w3.org/2000/svg';

function clipRule(fillRule?: 'nonzero' | 'evenodd'): string | null {
  const svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
  const path = document.createElementNS(SVG, 'path') as SVGPathElement;
  applyInsetStroke(document, svg, path, 'M0 0L10 0L10 10Z', 12_700, fillRule);
  return svg.querySelector('clipPath path')?.getAttribute('clip-rule') ?? null;
}

test('the inset clip follows the fill rule', () => {
  expect(clipRule('nonzero')).toBe('nonzero');
  expect(clipRule()).toBe('evenodd');
});
