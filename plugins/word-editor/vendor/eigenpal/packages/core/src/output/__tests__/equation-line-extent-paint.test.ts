import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  readOoxmlPart,
} from '@docx-editor.dev/core/store';
import { layoutSemanticDocument, linesOf, type TextMeasurer } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

const ASCENT = 1946 / 2048;
const DESCENT = 455 / 2048;
/** Every glyph reaches the lowercase top and does not descend. */
const LOWERCASE_TOP = 973 / 2048;
const fontBox: TextMeasurer = {
  measure: (text, style) => Array.from(text).length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({
    height: style.fontSizePt * (ASCENT + DESCENT),
    baseline: style.fontSizePt * ASCENT,
  }),
};
const inked: TextMeasurer = {
  ...fontBox,
  textOutline: (text, style) => ({
    path: null,
    ink: {
      left: 0,
      top: -style.fontSizePt * LOWERCASE_TOP,
      right: fontBox.measure(text, style),
      bottom: 0,
    },
  }),
};

const run = (text: string, points: number) =>
  `<m:r><w:rPr><w:sz w:val="${points * 2}"/></w:rPr><m:t>${text}</m:t></m:r>`;

test('only the host of a fitted equation takes presses', () => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}"><w:body>` +
      `<w:p><w:r><w:t>A</w:t></w:r><m:oMath>${run('x', 12)}${run('x', 48)}</m:oMath></w:p>` +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: inked });
  const geometry = linesOf(layout)[0]!.spans.find((span) => span.equation)!.equation!.geometry;
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const host = container.querySelector<HTMLElement>('[data-docx-equation]')!;
  expect(host.style.pointerEvents).toBe('auto');
  expect(Number.parseFloat(host.style.height)).toBeCloseTo(geometry.box.height, 5);
  const nodes = [...host.querySelectorAll<HTMLElement>('.docx-equation-node')];
  expect(nodes.length).toBe(2);
  for (const node of nodes) expect(node.style.pointerEvents).toBe('none');
  // The larger run's font box reaches above the host, which claims only its glyphs.
  expect(Math.min(...nodes.map((node) => Number.parseFloat(node.style.top)))).toBeLessThan(0);
});
