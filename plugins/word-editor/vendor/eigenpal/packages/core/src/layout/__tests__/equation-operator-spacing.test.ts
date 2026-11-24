import { expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  projectOmmlEquation,
  readOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { equationCharClass } from '../equation-spacing.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

// Every grapheme is half an em wide, so any extra width is operator spacing.
const measurer: TextMeasurer = {
  measure: (text, style) => Array.from(text.normalize('NFC')).length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt * 0.9 }),
};
const THIN = 3 / 18;
const MEDIUM = 4 / 18;
const THICK = 5 / 18;

const run = (text: string, properties = '') =>
  `<m:r>${properties}<m:t xml:space="preserve">${text}</m:t></m:r>`;
const sized = (text: string, halfPoints: number) =>
  run(text, `<w:rPr><w:sz w:val="${halfPoints}"/></w:rPr>`);
const normal = (text: string) => run(text, '<m:rPr><m:nor/></m:rPr>');
const fraction = (numerator: string, denominator: string) =>
  `<m:f><m:num>${numerator}</m:num><m:den>${denominator}</m:den></m:f>`;

function layout(body: string, sizePt = 12): EquationGeometry {
  const read = readOoxmlPart(
    `<m:oMath xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">${body}</m:oMath>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const projection = projectOmmlEquation(read.part.root as OoxmlGenericElementNode);
  if (!projection) throw new Error('missing projection');
  const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: sizePt });
  return layoutEquation(projection, measurer, style).geometry;
}

/** The direct items of the top row, with the space before each one. */
function spacing(geometry: EquationGeometry): [string, number][] {
  const items = geometry.kind === 'row' ? geometry.items : [geometry];
  return items.map((item, index) => {
    const previous = items[index - 1];
    const space = previous ? item.box.x - (previous.box.x + previous.box.width) : item.box.x;
    const label = item.kind === 'text' ? item.text : item.kind;
    return [label, Number(space.toFixed(6))];
  });
}

const round = (value: number) => Number(value.toFixed(6));

test.each([
  ['a relation', 'x=y', [0, THICK * 12, THICK * 12]],
  ['a binary operator', 'x+y', [0, MEDIUM * 12, MEDIUM * 12]],
  ['a minus sign', 'x−y', [0, MEDIUM * 12, MEDIUM * 12]],
  ['an arrow', 'x→y', [0, THICK * 12, THICK * 12]],
  ['a multiplication dot', 'x⋅y', [0, MEDIUM * 12, MEDIUM * 12]],
  ['an ordinary slash', 'x/y', null],
  ['a comma', 'x,y', [0, 0, THIN * 12]],
  ['a colon', 'x:y', [0, 0, THIN * 12]],
  ['an ellipsis', 'x…y', [0, THIN * 12, THIN * 12]],
] as const)('spaces %s by its class', (_name, source, expected) => {
  const geometry = layout(run(source));
  if (expected === null) {
    expect(geometry.kind).toBe('text');
    return;
  }
  expect(spacing(geometry).map(([, space]) => space)).toEqual(expected.map(round));
});

// A sign with no spaced neighbour leaves the run as one text item.
test.each([
  ['the start of an argument', '−x', [0]],
  ['a relation', 'x=−y', [0, THICK * 12, THICK * 12, 0]],
  ['a binary operator', 'x+−y', [0, MEDIUM * 12, MEDIUM * 12, 0]],
  ['an opening bracket', '(−x)', [0]],
  ['punctuation', 'x,−y', [0, 0, THIN * 12, 0]],
] as const)('gives a sign after %s no space', (_name, source, expected) => {
  expect(spacing(layout(run(source))).map(([, space]) => space)).toEqual(expected.map(round));
});

test('keeps the space of a binary operator after a leading sign', () => {
  expect(spacing(layout(run('−−x'))).map(([, space]) => space)).toEqual(
    [0, MEDIUM * 12, MEDIUM * 12].map(round)
  );
});

test('spaces only the inner side of an operator at an end of the argument', () => {
  expect(spacing(layout(run('x+'))).map(([, space]) => space)).toEqual([0, round(MEDIUM * 12)]);
  expect(spacing(layout(run('=x'))).map(([, space]) => space)).toEqual([0, round(THICK * 12)]);
});

test('a binary operator before a relation, closing bracket, or punctuation takes no space', () => {
  expect(spacing(layout(run('x+=y'))).map(([, space]) => space)).toEqual(
    [0, 0, 0, THICK * 12].map(round)
  );
  expect(layout(run('(x+)')).kind).toBe('text');
  expect(spacing(layout(run('x+,y'))).map(([, space]) => space)).toEqual(
    [0, 0, 0, THIN * 12].map(round)
  );
});

test('adjacent relations take no space between them', () => {
  expect(spacing(layout(run('x=≈y'))).map(([, space]) => space)).toEqual(
    [0, THICK * 12, 0, THICK * 12].map(round)
  );
});

test('a comma or period between digits belongs to the number, across runs too', () => {
  expect(layout(run('1,000')).kind).toBe('text');
  expect(layout(run('3.14')).kind).toBe('text');
  expect(spacing(layout(run('1') + run(',') + run('2'))).map(([, space]) => space)).toEqual([
    0, 0, 0,
  ]);
  expect(spacing(layout(run('1,x'))).map(([, space]) => space)).toEqual([0, 0, round(THIN * 12)]);
});

test('an operator in its own run is spaced like one inside a longer run', () => {
  const split = layout(run('x') + run('+') + run('y'));
  const whole = layout(run('x+y'));
  expect(split.box.width).toBeCloseTo(whole.box.width, 9);
  expect(spacing(split)).toEqual(spacing(whole));
});

test('the space beside an operator takes the size of its neighbour', () => {
  const geometry = layout(sized('x', 48) + sized('+', 24) + sized('y', 48));
  expect(spacing(geometry).map(([, space]) => space)).toEqual(
    [0, MEDIUM * 24, MEDIUM * 24].map(round)
  );
  const relation = layout(sized('x', 24) + sized('=', 48) + sized('y', 24));
  expect(spacing(relation).map(([, space]) => space)).toEqual(
    [0, THICK * 12, THICK * 12].map(round)
  );
});

test('scripts and fraction parts take no operator spacing', () => {
  const script = layout(`<m:sSup><m:e>${run('x')}</m:e><m:sup>${run('i+1')}</m:sup></m:sSup>`);
  if (script.kind !== 'script' || script.superscript?.kind !== 'text') {
    throw new Error('expected an unsplit superscript');
  }
  expect(script.superscript.text).toBe('𝑖+1');
  const parts = layout(fraction(run('a+b'), run('c')));
  if (parts.kind !== 'fraction' || parts.numerator.kind !== 'text') {
    throw new Error('expected an unsplit numerator');
  }
  expect(parts.numerator.text).toBe('𝑎+𝑏');
});

test('the base of a script and the body of a bar are spaced arguments', () => {
  const script = layout(`<m:sSup><m:e>${run('x+y')}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`);
  if (script.kind !== 'script') throw new Error('expected a script');
  expect(spacing(script.base).map(([, space]) => space)).toEqual(
    [0, MEDIUM * 12, MEDIUM * 12].map(round)
  );
  const bar = layout(
    `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${run('x=y')}</m:e></m:bar>`
  );
  if (bar.kind !== 'bar') throw new Error('expected a bar');
  expect(spacing(bar.body).map(([, space]) => space)).toEqual(
    [0, THICK * 12, THICK * 12].map(round)
  );
});

test('normal text takes no operator spacing but spaces its math neighbours', () => {
  expect(layout(normal('x+y')).kind).toBe('text');
  expect(spacing(layout(run('x+') + normal('y'))).map(([, space]) => space)).toEqual(
    [0, MEDIUM * 12, MEDIUM * 12].map(round)
  );
});

test('a fraction takes a thin space beside ordinary atoms and an operator space beside operators', () => {
  expect(spacing(layout(run('x') + fraction(run('a'), run('b')) + run('y')))).toEqual([
    ['𝑥', 0],
    ['fraction', round(THIN * 12)],
    ['𝑦', round(THIN * 12)],
  ]);
  expect(spacing(layout(fraction(run('a'), run('b')) + run('=y'))).map(([, s]) => s)).toEqual(
    [0, THICK * 12, THICK * 12].map(round)
  );
});

test('an n-ary structure takes a thin space beside ordinary atoms', () => {
  const nary = `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub/><m:sup/><m:e>${run('y')}</m:e></m:nary>`;
  expect(spacing(layout(run('x') + nary + run('z'))).map(([, space]) => space)).toEqual(
    [0, THIN * 12, THIN * 12].map(round)
  );
  expect(spacing(layout(nary + run('+z'))).map(([, space]) => space)).toEqual(
    [0, MEDIUM * 12, MEDIUM * 12].map(round)
  );
});

test('the spacing scales with the run size', () => {
  expect(spacing(layout(sized('x=y', 48), 24)).map(([, space]) => space)).toEqual(
    [0, THICK * 24, THICK * 24].map(round)
  );
});

test('an operator keeps its combining marks', () => {
  expect(spacing(layout(run('a≠b')))).toEqual([
    ['𝑎', 0],
    ['≠', round(THICK * 12)],
    ['𝑏', round(THICK * 12)],
  ]);
});

test('math text draws a hyphen-minus and an asterisk as operator glyphs', () => {
  expect(spacing(layout(run('x-y*z')))).toEqual([
    ['𝑥', 0],
    ['−', round(MEDIUM * 12)],
    ['𝑦', round(MEDIUM * 12)],
    ['∗', round(MEDIUM * 12)],
    ['𝑧', round(MEDIUM * 12)],
  ]);
  const plainText = layout(normal('x-y'));
  expect(plainText.kind === 'text' && plainText.text).toBe('x-y');
});

test('the equation box includes the operator spacing', () => {
  const geometry = layout(run('x=y+1'));
  expect(geometry.box.width).toBeCloseTo(5 * 6 + 2 * THICK * 12 + 2 * MEDIUM * 12, 9);
});

test.each([
  ['=', 'rel'],
  ['<', 'rel'],
  ['≤', 'rel'],
  ['⇒', 'rel'],
  ['⟶', 'rel'],
  ['∈', 'rel'],
  ['⋮', 'rel'],
  ['+', 'bin'],
  ['-', 'bin'],
  ['×', 'bin'],
  ['∩', 'bin'],
  ['⊕', 'bin'],
  [',', 'punct'],
  [';', 'punct'],
  ['(', 'open'],
  [')', 'close'],
  ['…', 'inner'],
  ['⋯', 'inner'],
  ['x', 'ord'],
  ['/', 'ord'],
  ['!', 'ord'],
  ['∑', 'ord'],
  ['∫', 'ord'],
] as const)('classes %s as %s', (character, expected) => {
  expect(equationCharClass(character.codePointAt(0)!)).toBe(expected);
});
