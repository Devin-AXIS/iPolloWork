import { expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  projectOmmlEquation,
  readOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { equationLowercaseTop } from '../equation-ink.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { buildStyleCascadeTable, layoutSemanticDocument, linesOf } from '../index.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const fixed = createFixedMeasurer(6, 14);
/** Reports glyph ink: lowercase-height letters and digits, and taller ascenders for b, d, h, k, l. */
const inked: TextMeasurer = {
  ...fixed,
  textOutline: (text, style) => ({
    path: null,
    ink: {
      left: 0,
      top: -style.fontSizePt * (/[0-9bdhkl]/u.test(text.normalize('NFKD')) ? 0.7 : 0.48),
      right: fixed.measure(text, style),
      bottom: 0,
    },
  }),
};

const run = (text: string, halfPoints: number) =>
  `<m:r><w:rPr><w:sz w:val="${halfPoints}"/></w:rPr><m:t>${text}</m:t></m:r>`;
const control = (halfPoints?: number) =>
  halfPoints === undefined
    ? ''
    : `<m:ctrlPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/><w:sz w:val="${halfPoints}"/></w:rPr></m:ctrlPr>`;
const superscript = (halfPoints: number, controlSize?: number) =>
  `<m:sSup><m:sSupPr>${control(controlSize)}</m:sSupPr><m:e>${run('x', halfPoints)}</m:e>` +
  `<m:sup>${run('2', halfPoints)}</m:sup></m:sSup>`;
const subscript = (text: string, halfPoints: number, controlSize?: number) =>
  `<m:sSub><m:sSubPr>${control(controlSize)}</m:sSubPr><m:e>${run('x', halfPoints)}</m:e>` +
  `<m:sub>${run(text, halfPoints)}</m:sub></m:sSub>`;
const bar = (halfPoints: number, controlSize?: number) =>
  `<m:bar><m:barPr><m:pos m:val="top"/>${control(controlSize)}</m:barPr>` +
  `<m:e>${run('xa', halfPoints)}</m:e></m:bar>`;

function project(body: string) {
  const read = readOoxmlPart(
    `<m:oMath xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">${body}</m:oMath>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const projection = projectOmmlEquation(read.part.root as OoxmlGenericElementNode);
  if (!projection) throw new Error('missing projection');
  return projection;
}

/** Lay out `body` inside text of `aroundPt` points. */
function layout(body: string, aroundPt: number, measurer: TextMeasurer = fixed): EquationGeometry {
  const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: aroundPt });
  return layoutEquation(project(body), measurer, style).geometry;
}

function script(geometry: EquationGeometry) {
  if (geometry.kind !== 'script') throw new Error(`expected a script, got ${geometry.kind}`);
  return geometry;
}

const rise = (geometry: EquationGeometry) => {
  const node = script(geometry);
  return node.baseline - (node.superscript!.box.y + node.superscript!.baseline);
};
const drop = (geometry: EquationGeometry) => {
  const node = script(geometry);
  return node.subscript!.box.y + node.subscript!.baseline - node.baseline;
};
const em = (units: number) => units / 2048;

test('projects the m:ctrlPr size of a structure, also when it is tracked', () => {
  expect(project(superscript(48, 48)).expression).toMatchObject({ controlFontSizePt: 24 });
  expect(project(superscript(48)).expression).not.toHaveProperty('controlFontSizePt');
  const tracked =
    '<m:f><m:fPr><m:ctrlPr><w:ins w:id="1" w:author="Public Author"><w:rPr><w:sz w:val="30"/></w:rPr>' +
    `</w:ins></m:ctrlPr></m:fPr><m:num>${run('a', 30)}</m:num><m:den>${run('b', 30)}</m:den></m:f>`;
  expect(project(tracked).expression).toMatchObject({
    kind: 'fraction',
    controlFontSizePt: 15,
    controlProperties: true,
  });
});

test('a superscript rises from the control size, not the run size', () => {
  // Runs of 24 pt in 12 pt text: without m:ctrlPr the structure size is 12 pt.
  const plain = layout(superscript(48), 12);
  expect(rise(plain)).toBeCloseTo(equationLowercaseTop(script(plain).base) - em(460) * 12, 9);
  // The same runs with a 24 pt control rise the minimum shift of 24 pt.
  expect(rise(layout(superscript(48, 48), 12))).toBeCloseTo(em(750) * 24, 9);
  // Runs of 12 pt with a 24 pt control rise as far.
  expect(rise(layout(superscript(24, 48), 12))).toBeCloseTo(em(750) * 24, 9);
  // A control size equal to the text around the equation changes nothing.
  expect(layout(superscript(48, 48), 24)).toEqual(layout(superscript(48), 24));
});

test('a structure without m:ctrlPr takes the size of the text around the equation', () => {
  expect(rise(layout(superscript(48), 20))).toBeCloseTo(em(750) * 20, 9);
});

test('a subscript drops a fifth of the control size', () => {
  expect(drop(layout(subscript('i', 24, 48), 12, inked))).toBeCloseTo(0.2 * 24, 9);
  expect(drop(layout(subscript('i', 24), 12, inked))).toBeCloseTo(0.2 * 12, 9);
});

test('a tall subscript drops until its ink top meets the subscript top limit', () => {
  // A 17.5 pt k reaches 0.7 of its size above its baseline, which passes 760/2048 em of 12 pt.
  expect(drop(layout(subscript('k', 48), 12, inked))).toBeCloseTo(0.7 * 17.5 - em(760) * 12, 9);
  // With a 24 pt control the limit is higher, and the plain drop wins.
  expect(drop(layout(subscript('k', 48, 48), 12, inked))).toBeCloseTo(0.2 * 24, 9);
});

test('a bar strokes and spaces from the control size', () => {
  const thickness = (geometry: EquationGeometry) => {
    if (geometry.kind !== 'bar') throw new Error('expected a bar');
    return geometry.bar.height;
  };
  expect(thickness(layout(bar(48), 12, inked))).toBeCloseTo(em(133) * 12, 9);
  expect(thickness(layout(bar(48, 48), 12, inked))).toBeCloseTo(em(133) * 24, 9);
  expect(thickness(layout(bar(24, 48), 12, inked))).toBeCloseTo(em(133) * 24, 9);
  const gap = (geometry: EquationGeometry) => {
    if (geometry.kind !== 'bar') throw new Error('expected a bar');
    const body = geometry.body;
    const inkTop = body.box.y + body.baseline - 0.48 * 24;
    return inkTop - (geometry.bar.y + geometry.bar.height);
  };
  expect(gap(layout(bar(48), 12, inked))).toBeCloseTo(em(345) * 12, 9);
  expect(gap(layout(bar(48, 48), 12, inked))).toBeCloseTo(em(345) * 24, 9);
});

test('a script level reduces the control size like a run size', () => {
  // A superscript inside a 24 pt superscript sizes its own rise from 17.5 pt.
  const nested =
    `<m:sSup><m:sSupPr>${control(48)}</m:sSupPr><m:e>${run('x', 48)}</m:e><m:sup>` +
    `<m:sSup><m:sSupPr>${control(48)}</m:sSupPr><m:e>${run('y', 48)}</m:e>` +
    `<m:sup>${run('2', 48)}</m:sup></m:sSup></m:sup></m:sSup>`;
  const inner = script(script(layout(nested, 12)).superscript!);
  expect(rise(inner)).toBeCloseTo(
    Math.max(em(750) * 17.5, equationLowercaseTop(inner.base) - em(460) * 17.5),
    9
  );
});

// Document defaults give the text around the equation 12 pt Arial.
const styles = readOoxmlPart(
  `<w:styles xmlns:w="${WML_NAMESPACE_URI}"><w:docDefaults><w:rPrDefault><w:rPr>` +
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/>' +
    '<w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
  { name: '/word/styles.xml', contentType: 'app/xml' }
);
if (!styles.ok) throw new Error(styles.reason);
const styleCascade = buildStyleCascadeTable(styles.part.root);

/** The equation span of a one-paragraph document laid out in full. */
function equationInParagraph(paragraph: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body>${paragraph}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const spans = linesOf(
    layoutSemanticDocument(read.part, 1, { measurer: fixed, styleCascade })
  ).flatMap((line) => line.spans);
  const equation = spans.find((span) => span.equation)?.equation;
  if (!equation) throw new Error('missing equation span');
  return equation.geometry;
}

const text = (value: string, rtl = false) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${rtl ? '<w:rtl/>' : ''}` +
  `<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${value}</w:t></w:r>`;
const bidi = '<w:pPr><w:bidi/></w:pPr>';

test('a bidi paragraph keeps the size of the text around the equation', () => {
  // Runs share 24 pt in 12 pt text, so the superscript rises from 12 pt in every direction.
  // Bidi resolution rebuilds the piece style, so only the shaping of the runs differs.
  const math = `<m:oMath>${superscript(48)}</m:oMath>`;
  const ltr = equationInParagraph(`<w:p>${text('A ')}${math}</w:p>`);
  expect(rise(ltr)).toBeCloseTo(equationLowercaseTop(script(ltr).base) - em(460) * 12, 9);
  for (const paragraph of [
    `<w:p>${bidi}${text('A ')}${math}</w:p>`,
    `<w:p>${bidi}${text('\u05d0 ', true)}${math}</w:p>`,
  ]) {
    const geometry = equationInParagraph(paragraph);
    expect(geometry.box).toEqual(ltr.box);
    expect(rise(geometry)).toBeCloseTo(rise(ltr), 9);
  }
});

test('normal text in a bidi paragraph keeps the paragraph font', () => {
  const math = '<m:oMath><m:r><m:rPr><m:nor/></m:rPr><m:t>if</m:t></m:r></m:oMath>';
  const family = (geometry: EquationGeometry): string | null | undefined =>
    geometry.kind === 'text' ? geometry.runStyle?.fontFamily : undefined;
  const ltr = equationInParagraph(`<w:p>${text('A ')}${math}</w:p>`);
  expect(family(ltr)).toBe('Arial');
  expect(family(equationInParagraph(`<w:p>${bidi}${text('A ')}${math}</w:p>`))).toBe('Arial');
});
