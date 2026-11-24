import { describe, expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  equationExpressionToLinearMath,
  projectOmmlEquation,
  readOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument, linesOf } from '../index.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const fixed = createFixedMeasurer(6, 14);
/** Reports glyph ink: lowercase-height letters, and taller ascenders for k and the operators. */
const inked: TextMeasurer = {
  ...fixed,
  textOutline: (text, style) => ({
    path: null,
    ink: {
      left: 0,
      top: -style.fontSizePt * (/[k∑∫]/u.test(text) ? 0.7 : 0.48),
      right: fixed.measure(text, style),
      bottom: style.fontSizePt * (/[q∑∫]/u.test(text) ? 0.2 : 0),
    },
  }),
};

const run = (text: string) => `<m:r><w:rPr><w:sz w:val="48"/></w:rPr><m:t>${text}</m:t></m:r>`;
const nary = (operator: string, location?: string) =>
  `<m:nary><m:naryPr><m:chr m:val="${operator}"/>` +
  (location ? `<m:limLoc m:val="${location}"/>` : '') +
  `</m:naryPr><m:sub>${run('q')}</m:sub><m:sup>${run('k')}</m:sup><m:e>${run('x')}</m:e></m:nary>`;
const subSup = (operator: string) =>
  `<m:sSubSup><m:e>${run(operator)}</m:e><m:sub>${run('q')}</m:sub>` +
  `<m:sup>${run('k')}</m:sup></m:sSubSup>`;

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

/** An inline equation in 24 pt text. */
function inline(body: string): EquationGeometry {
  const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: 24 });
  return layoutEquation(project(body), inked, style).geometry;
}

/** The equation of a display paragraph, laid out in full. */
function display(body: string): EquationGeometry {
  return inParagraph(`<m:oMathPara><m:oMath>${body}</m:oMath></m:oMathPara>`);
}

/** The equation of a one-paragraph document with the content `content`, laid out in full. */
function inParagraph(content: string): EquationGeometry {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}"><w:body>` +
      `<w:p>${content}</w:p></w:body></w:document>`,
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

function operatorOf(geometry: EquationGeometry) {
  if (geometry.kind !== 'nary') throw new Error(`expected an n-ary, got ${geometry.kind}`);
  return geometry;
}

/** Limit offsets from the operator: left edges and baselines, relative to its own. */
function limitOffsets(geometry: EquationGeometry) {
  const node = operatorOf(geometry);
  const baseline = node.operator.box.y + node.operator.baseline;
  const lower = node.lowerLimit!;
  const upper = node.upperLimit!;
  return {
    lowerX: lower.box.x - node.operator.box.x,
    lowerDrop: lower.box.y + lower.baseline - baseline,
    upperX: upper.box.x - node.operator.box.x,
    upperRise: baseline - (upper.box.y + upper.baseline),
  };
}

/** True when both limits start to the right of the operator. */
function beside(geometry: EquationGeometry): boolean {
  const node = operatorOf(geometry);
  const right = node.operator.box.x + node.operator.box.width;
  return node.lowerLimit!.box.x >= right && node.upperLimit!.box.x >= right;
}

test('inline limits attach to the operator as a subscript and a superscript do', () => {
  const limits = limitOffsets(inline(nary('∑')));
  const scripts = inline(subSup('∑'));
  if (scripts.kind !== 'script') throw new Error('expected a script');
  const baseline = scripts.base.box.y + scripts.base.baseline;
  expect(limits.lowerX).toBeCloseTo(scripts.subscript!.box.x - scripts.base.box.x, 9);
  expect(limits.upperX).toBeCloseTo(scripts.superscript!.box.x - scripts.base.box.x, 9);
  expect(limits.lowerDrop).toBeCloseTo(
    scripts.subscript!.box.y + scripts.subscript!.baseline - baseline,
    9
  );
  expect(limits.upperRise).toBeCloseTo(
    baseline - (scripts.superscript!.box.y + scripts.superscript!.baseline),
    9
  );
});

test('inline limits sit beside the operator whatever m:limLoc says', () => {
  for (const body of [nary('∑'), nary('∑', 'undOvr'), nary('∑', 'subSup'), nary('∫')]) {
    const geometry = inline(body);
    expect(beside(geometry)).toBe(true);
    // The operator draws at the size of its runs, and the body follows the limits.
    const node = operatorOf(geometry);
    expect(node.operator.fontSizePt).toBe(24);
    expect(node.body.box.x).toBeGreaterThan(node.upperLimit!.box.x + node.upperLimit!.box.width);
  }
});

test('display limits follow m:limLoc, and without it sit beside integrals only', () => {
  expect(beside(display(nary('∑')))).toBe(false);
  expect(beside(display(nary('∑', 'undOvr')))).toBe(false);
  expect(beside(display(nary('∑', 'subSup')))).toBe(true);
  expect(beside(display(nary('∫')))).toBe(true);
  expect(beside(display(nary('∫', 'undOvr')))).toBe(false);
  // Limits below and above centre on the enlarged operator.
  const stacked = operatorOf(display(nary('∑')));
  expect(stacked.operator.fontSizePt).toBe(30);
  expect(stacked.upperLimit!.box.y + stacked.upperLimit!.box.height).toBeLessThanOrEqual(
    stacked.operator.box.y
  );
  expect(stacked.lowerLimit!.box.y).toBeGreaterThanOrEqual(
    stacked.operator.box.y + stacked.operator.box.height
  );
});

test('a bare m:oMath alone in its paragraph is a display equation', () => {
  // No m:oMathPara: the paragraph holds the equation and nothing else that is visible.
  const alone = inParagraph(
    `<w:pPr/><w:bookmarkStart w:id="0" w:name="b"/><m:oMath>${nary('∑')}</m:oMath>`
  );
  expect(beside(alone)).toBe(false);
  expect(operatorOf(alone).operator.fontSizePt).toBe(30);
  expect(alone).toEqual(display(nary('∑')));
  expect(beside(inParagraph(`<m:oMath>${nary('∫')}</m:oMath>`))).toBe(true);
});

test('a bare m:oMath beside text keeps its limits beside the operator', () => {
  for (const content of [
    `<w:r><w:t>A</w:t></w:r><m:oMath>${nary('∑')}</m:oMath>`,
    `<m:oMath>${nary('∑')}</m:oMath><w:r><w:t>A</w:t></w:r>`,
    `<m:oMath>${nary('∑')}</m:oMath><m:oMath>${run('y')}</m:oMath>`,
  ]) {
    const geometry = inParagraph(content);
    expect(beside(geometry)).toBe(true);
    expect(operatorOf(geometry).operator.fontSizePt).toBe(24);
  }
});

test('an n-ary with m:limLoc subSup projects its location and keeps its source', () => {
  expect(project(nary('∑', 'subSup')).expression).toMatchObject({
    kind: 'nary',
    limitLocation: 'subSup',
  });
  expect(project(nary('∑', 'undOvr')).expression).toMatchObject({ limitLocation: 'undOvr' });
  expect(project(nary('∑')).expression).not.toHaveProperty('limitLocation');
  // Compact syntax writes limits below and above, so it cannot rewrite a subSup source.
  expect(equationExpressionToLinearMath(project(nary('∑', 'subSup')).expression)).toBe('');
  expect(equationExpressionToLinearMath(project(nary('∑', 'undOvr')).expression)).toBe(
    '∑[q]^[k]{x}'
  );
});

describe('an n-ary operator without m:chr', () => {
  const unnamed = (properties: string) =>
    `<m:nary>${properties}<m:sub>${run('q')}</m:sub><m:sup>${run('k')}</m:sup>` +
    `<m:e>${run('x')}</m:e></m:nary>`;

  test('draws an integral and places its limits as an integral does', () => {
    for (const properties of ['<m:naryPr/>', '']) {
      expect(operatorOf(inline(unnamed(properties))).operator.text).toBe('∫');
      expect(inline(unnamed(properties))).toEqual(inline(nary('∫')));
      expect(beside(display(unnamed(properties)))).toBe(true);
      expect(display(unnamed(properties))).toEqual(display(nary('∫')));
    }
    // Without m:chr, m:limLoc still decides where display limits sit.
    const stacked = unnamed('<m:naryPr><m:limLoc m:val="undOvr"/></m:naryPr>');
    expect(beside(display(stacked))).toBe(false);
    expect(display(stacked)).toEqual(display(nary('∫', 'undOvr')));
  });

  test('has no compact linear text, because that syntax spells only the sum', () => {
    const projected = project(unnamed('<m:naryPr/>'));
    expect(projected.expression).toMatchObject({ kind: 'nary', operator: '∫' });
    expect(projected.fallbackText).toBe('∫qkx');
    expect(equationExpressionToLinearMath(projected.expression)).toBe('');
    // The text spelling of every n-ary structure includes the operator it draws.
    expect(project(nary('∑', 'subSup')).fallbackText).toBe('∑qkx');
  });

  test('outside the supported subset, its text fallback paints the integral', () => {
    for (const hidden of ['<m:subHide m:val="1"/>', '<m:grow m:val="1"/>']) {
      const body = unnamed(`<m:naryPr>${hidden}</m:naryPr>`);
      const projected = project(body);
      expect(projected.expression).toEqual({ kind: 'fallback', text: '∫qkx' });
      expect(inline(body)).toMatchObject({ kind: 'fallback', text: '∫qkx' });
    }
    // A named operator paints in the fallback text too.
    const named = nary('∑').replace('</m:naryPr>', '<m:subHide m:val="1"/></m:naryPr>');
    expect(project(named).expression).toEqual({ kind: 'fallback', text: '∑qkx' });
  });
});
