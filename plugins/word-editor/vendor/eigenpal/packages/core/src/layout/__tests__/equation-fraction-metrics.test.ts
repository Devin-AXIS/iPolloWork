import { expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  projectOmmlEquation,
  readOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { equationInk } from '../equation-ink.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument, linesOf } from '../index.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const fixed = createFixedMeasurer(6, 14);
/** Reports glyph ink: lowercase-height letters and digits, with a descender for g, j, y. */
const inked: TextMeasurer = {
  ...fixed,
  textOutline: (text, style) => ({
    path: null,
    ink: {
      left: 0,
      top: -style.fontSizePt * (/[0-9bdhkl]/u.test(text.normalize('NFKD')) ? 0.7 : 0.48),
      right: fixed.measure(text, style),
      bottom: style.fontSizePt * (/[gjy]/u.test(text.normalize('NFKD')) ? 0.21 : 0),
    },
  }),
};
const em = (units: number) => units / 2048;
const run = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;
const fraction = (numerator: string, denominator: string) =>
  `<m:f><m:num>${numerator}</m:num><m:den>${denominator}</m:den></m:f>`;

function layout(body: string, sizePt = 11): EquationGeometry {
  const read = readOoxmlPart(
    `<m:oMath xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">${body}</m:oMath>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const projection = projectOmmlEquation(read.part.root as OoxmlGenericElementNode);
  if (!projection) throw new Error('missing projection');
  const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: sizePt });
  return layoutEquation(projection, inked, style).geometry;
}

function stack(geometry: EquationGeometry) {
  if (geometry.kind !== 'fraction') throw new Error(`expected a fraction, got ${geometry.kind}`);
  return geometry;
}

/** How far a part's baseline sits above (positive) the fraction baseline. */
const shift = (whole: EquationGeometry, part: EquationGeometry) =>
  whole.baseline - (part.box.y + part.baseline);

test('centres the rule on the math axis with the math rule thickness', () => {
  const geometry = stack(layout(fraction(run('2'), run('3'))));
  expect(geometry.bar.height).toBeCloseTo(em(133) * 11, 9);
  expect(geometry.baseline - (geometry.bar.y + geometry.bar.height / 2)).toBeCloseTo(
    em(585) * 11,
    9
  );
});

test('places the parts at the inline shifts of the fraction size', () => {
  const geometry = stack(layout(fraction(run('2'), run('3'))));
  expect(shift(geometry, geometry.numerator)).toBeCloseTo(em(1200) * 11, 9);
  expect(-shift(geometry, geometry.denominator)).toBeCloseTo(em(1030) * 11, 9);
});

test('a fraction alone claims the font box of its size and the ink of its parts', () => {
  const geometry = stack(layout(fraction(run('2'), run('3'))));
  // The 14pt font box of the 11pt structure size, with its baseline at 80 percent.
  const band = { ascent: 14 * 0.8, descent: 14 * 0.2 };
  // The parts draw at 8 pt: 73 percent of 11 pt, rounded down to a half point. The numerator
  // claims its digit ink, 0.7 em high, and the math leading of its own smaller size above it,
  // up to the ascent of its 8pt font box (14 * 8 / 11 * 0.8), not its typographic box.
  expect(geometry.baseline).toBeCloseTo(
    Math.max(band.ascent, em(1200) * 11 + Math.min(((14 * 8) / 11) * 0.8, 0.7 * 8 + em(300) * 8)),
    9
  );
  // The denominator digits have no ink below their baseline.
  expect(geometry.box.height - geometry.baseline).toBeCloseTo(
    Math.max(band.descent, em(1030) * 11),
    9
  );
});

test('is as wide as its wider part, with the rule across it', () => {
  const geometry = stack(layout(fraction(run('2'), run('345'))));
  expect(geometry.box.width).toBeCloseTo(geometry.denominator.box.width, 9);
  expect(geometry.bar.x).toBe(0);
  expect(geometry.bar.width).toBeCloseTo(geometry.box.width, 9);
  expect(geometry.numerator.box.x).toBeCloseTo(
    (geometry.box.width - geometry.numerator.box.width) / 2,
    9
  );
});

test('moves a deep numerator up to keep the least gap above the rule', () => {
  const geometry = stack(layout(fraction(fraction(run('a'), run('y')), run('c'))));
  const numerator = geometry.numerator;
  const inkBelow = equationInk(numerator, inked).descent;
  expect(shift(geometry, numerator)).toBeCloseTo(
    em(585) * 11 + em(133) * 11 * 0.5 + em(133) * 11 + inkBelow,
    9
  );
  expect(shift(geometry, numerator)).toBeGreaterThan(em(1200) * 11);
});

test('moves a tall denominator down to keep the least gap below the rule', () => {
  const geometry = stack(layout(fraction(run('a'), fraction(run('b'), run('c')))));
  const denominator = geometry.denominator;
  const inkAbove = equationInk(denominator, inked).ascent;
  expect(-shift(geometry, denominator)).toBeCloseTo(
    em(133) * 11 + em(133) * 11 * 0.5 - em(585) * 11 + inkAbove,
    9
  );
});

/** The equation of a one-paragraph document laid out in full, with every run at 24 pt. */
function layoutInParagraph(math: string): EquationGeometry {
  const sized = math.replaceAll('<m:r>', '<m:r><w:rPr><w:sz w:val="48"/></w:rPr>');
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body><w:p>${sized}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const spans = linesOf(layoutSemanticDocument(read.part, 1, { measurer: inked })).flatMap(
    (line) => line.spans
  );
  const equation = spans.find((span) => span.equation)?.equation;
  if (!equation) throw new Error('missing equation span');
  return equation.geometry;
}

test('keeps the padded placement for a fraction in a display equation', () => {
  // Display style is not modelled. A display fraction takes the inline part size, 17.5 pt at
  // 24 pt, with full font boxes, a padded rule, and fixed gaps of 0.08 em around a 0.055 em
  // rule. Changing this placement is a deliberate change to display equations.
  const display = stack(
    layoutInParagraph(
      `<m:oMathPara><m:oMath>${fraction(run('2'), run('3'))}</m:oMath></m:oMathPara>`
    )
  );
  const part = { width: (6 * 17.5) / 11, height: (14 * 17.5) / 11 };
  expect(display.numerator.box.height).toBeCloseTo(part.height, 9);
  expect(display.box.width).toBeCloseTo(part.width + 2 * 1.92, 9);
  expect(display.bar).toEqual(
    expect.objectContaining({ x: 0.96, width: part.width + 1.92, height: 1.32 })
  );
  expect(display.bar.y).toBeCloseTo(part.height + 1.92, 9);
  expect(display.denominator.box.y).toBeCloseTo(part.height + 1.92 + 1.32 + 1.92, 9);
  expect(display.box.height).toBeCloseTo(2 * part.height + 1.92 + 1.32 + 1.92, 9);
  expect(display.baseline).toBeCloseTo(part.height + 1.92 + 0.66 + 24 * 0.22, 9);
  // An equation alone in its paragraph is a display equation without m:oMathPara too.
  expect(stack(layoutInParagraph(`<m:oMath>${fraction(run('2'), run('3'))}</m:oMath>`))).toEqual(
    display
  );
  // The same fraction after text is inline and takes the typographic placement.
  const inline = stack(
    layoutInParagraph(`<w:r><w:t>A</w:t></w:r><m:oMath>${fraction(run('2'), run('3'))}</m:oMath>`)
  );
  expect(inline.bar.height).toBeCloseTo(em(133) * 24, 9);
  expect(inline.box.width).toBeCloseTo(part.width, 9);
});
