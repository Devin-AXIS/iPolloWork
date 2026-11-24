import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { glyphSizeFactorOf } from '../run-style.ts';

import { runBorderStrokesForLine, textBandHeightWithBorders } from '../run-border-strokes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * 5 * glyphSizeFactorOf(style),
  lineMetrics: (style) => ({
    height: 12 * glyphSizeFactorOf(style),
    baseline: 9 * glyphSizeFactorOf(style),
  }),
};
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const run = (text: string, props = '') =>
  `<w:r><w:rPr><w:sz w:val="24"/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
function fixture(content: string, spacing = '', stylePosition = 6) {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${spacing}</w:pPr>${content}</w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const styleCascade = buildStyleCascadeTable(
    part(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="character" w:styleId="Raised"><w:name w:val="Raised"/><w:rPr><w:position w:val="${stylePosition}"/><w:vertAlign w:val="superscript"/><w:sz w:val="16"/></w:rPr></w:style></w:styles>`,
      '/word/styles.xml'
    ).root
  );
  return {
    document,
    options: {
      measurer,
      styleCascade,
      geometry: { width: 120, height: 200, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    },
  };
}
function layout(content: string, spacing = '', width = 120) {
  const f = fixture(content, spacing);
  return linesOf(
    layoutSemanticDocument(f.document, 1, {
      ...f.options,
      geometry: { ...f.options.geometry, width },
    })
  );
}
for (const [position, height, baseline] of [
  [6, 15, 12],
  [-6, 15, 9],
  [0, 12, 9],
]) {
  test(`authored position ${position} grows only its translated extent`, () => {
    const line = layout(
      run('Body ') + run('x', `<w:position w:val="${position}"/>`) + run(' tail')
    )[0]!;
    expect(line.box.height).toBe(height!);
    expect(line.baseline).toBe(baseline!);
    expect(line.spans.find((s) => s.text === 'x')!.box.height).toBe(12);
  });
}
for (const [vertical, position, height, baseline] of [
  ['superscript', 6, 15.81, 12.81],
  ['superscript', -6, 12, 9],
  ['subscript', 6, 12, 9],
  ['subscript', -6, 15.87, 9],
] as const) {
  test(`${vertical} with position ${position} translates the already scaled face`, () => {
    const line = layout(
      run('Body ') +
        run('x', `<w:vertAlign w:val="${vertical}"/><w:position w:val="${position}"/>`) +
        run(' tail')
    )[0]!;
    expect(line.box.height).toBeCloseTo(height, 8);
    expect(line.baseline).toBeCloseTo(baseline, 8);
    expect(line.spans.find((s) => s.text === 'x')!.box.height).toBeCloseTo(7.8, 8);
  });
}
test('inherited position and superscript use the final direct font size', () => {
  const line = layout(run('Body ') + run('x', '<w:rStyle w:val="Raised"/>') + run(' tail'))[0]!;
  expect(line.box.height).toBeCloseTo(15.81, 8);
  expect(line.spans.find((s) => s.text === 'x')!.style.fontSizePt).toBe(12);
});
test('direct zero clears inherited position without changing ordinary superscript layout', () => {
  const inherited = layout(
    run('Body ') + run('x', '<w:rStyle w:val="Raised"/><w:position w:val="0"/>')
  )[0]!;
  const direct = layout(run('Body ') + run('x', '<w:vertAlign w:val="superscript"/>'))[0]!;
  expect(inherited.box.height).toBe(12);
  expect(inherited.box.height).toBe(direct.box.height);
});
// Double spacing adds one unshifted 12pt line to the 15pt raised line; the 3pt raise is not scaled.
for (const [rule, value, height] of [
  ['auto', 480, 27],
  ['atLeast', 280, 15],
  ['exact', 280, 14],
] as const) {
  test(`${rule} spacing applies after translated run extents`, () => {
    const line = layout(
      run('Body ') + run('x', '<w:position w:val="6"/>'),
      `<w:spacing w:line="${value}" w:lineRule="${rule}"/>`
    )[0]!;
    expect(line.box.height).toBe(height);
  });
}
test('carrying a shifted word restores the old line and regrows the destination', () => {
  const lines = layout(run('aa ') + run('x', '<w:position w:val="6"/>') + run('yyy'), '', 30);
  expect(lines.map((l) => l.spans.map((s) => s.text).join(''))).toEqual(['aa ', 'xyyy']);
  expect(lines.map((l) => l.box.height)).toEqual([12, 15]);
});
test('chopped shifted text translates each baseline without rescaling the face', () => {
  const lines = layout(run('ABCDEFGHIJK', '<w:position w:val="6"/>'), '', 25);
  expect(lines.map((l) => l.box.height)).toEqual([12, 12, 12]);
  expect(lines.map((l) => l.baseline)).toEqual([12, 12, 12]);
});
test('hidden and heightless whitespace do not add shifted extents', () => {
  expect(layout(run('Body') + run('x', '<w:vanish/><w:position w:val="60"/>'))[0]!.box.height).toBe(
    12
  );
  expect(layout(run('Body') + run(' ', '<w:position w:val="60"/>'))[0]!.box.height).toBe(12);
});
test('inherited shift changes invalidate warm paragraph geometry', () => {
  const f = fixture(run('Body ') + run('x', '<w:rStyle w:val="Raised"/>'));
  const session = createLayoutSession();
  for (const position of [6, -6, 6]) {
    const styleCascade = fixture('', '', position).options.styleCascade;
    const options = { ...f.options, styleCascade };
    const warm = layoutSemanticDocument(f.document, 1, { ...options, session });
    const cold = layoutSemanticDocument(f.document, 1, options);
    expect(warm.pages).toEqual(cold.pages);
  }
});

for (const position of [6, -6]) {
  test(`position ${position} reserves painted border extents`, () => {
    const line = layout(
      run('Body ') +
        run('x', `<w:position w:val="${position}"/><w:bdr w:val="single" w:sz="4" w:space="1"/>`)
    )[0]!;
    for (const stroke of runBorderStrokesForLine(line)) {
      expect(stroke.box.y).toBeGreaterThanOrEqual(line.box.y);
      expect(stroke.box.y + stroke.box.height).toBeLessThanOrEqual(line.box.y + line.box.height);
    }
  });
}
test('drawing text band retains shifted ascent and descent', () => {
  const line = layout(run('Body ') + run('x', '<w:position w:val="6"/>'))[0]!;
  expect(textBandHeightWithBorders([...line.spans], measurer, 12)).toBe(15);
});
for (const position of [9999999, -9999999]) {
  test(`extreme position ${position} makes bounded progress`, () => {
    const lines = layout(run('Body ') + run('x', `<w:position w:val="${position}"/>`));
    expect(lines).toHaveLength(1);
    expect(Number.isFinite(lines[0]!.box.height)).toBe(true);
    expect(Number.isFinite(lines[0]!.baseline)).toBe(true);
    expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('Body x');
  });
}
