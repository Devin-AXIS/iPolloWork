import { expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import {
  createEquationLayouter,
  equationRunStyle,
  layoutEquation,
  type EquationGeometry,
  type EquationTextGeometry,
} from '../equation-layout.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { resolveRunStyle, withFontFamily } from '../run-style.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const fixed = createFixedMeasurer(6, 14);
const run = (text: string, properties = '') => `<m:r>${properties}<m:t>${text}</m:t></m:r>`;
const face = (family: string, properties = '') =>
  `<w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/>${properties}</w:rPr>`;

function read(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function project(body: string) {
  const part = read(`<m:oMath xmlns:w="${w}" xmlns:m="${m}">${body}</m:oMath>`);
  return { part, projection: projectOmmlEquation(part.root as OoxmlGenericElementNode) };
}

function texts(node: EquationGeometry): EquationTextGeometry[] {
  if (node.kind === 'text' || node.kind === 'fallback') return [node];
  if (node.kind === 'row') return node.items.flatMap(texts);
  if (node.kind === 'script')
    return [node.base, node.subscript, node.superscript].flatMap((item) =>
      item ? texts(item) : []
    );
  throw new Error('Unexpected test geometry');
}

test.each([
  ['', false],
  ['<w:b/>', true],
] as const)('uses the authored text face for italic equation digits (%s)', (bold, expected) => {
  const { part, projection } = project(run('123', face('Arial', bold)));
  const before = canonicalOoxmlFingerprint(part);
  const measured: { text: string; family: string | null; bold: boolean; italic: boolean }[] = [];
  const result = layoutEquation(
    projection,
    {
      ...fixed,
      measure: (text, style) => {
        measured.push({ text, family: style.fontFamily, bold: style.bold, italic: style.italic });
        return fixed.measure(text, style);
      },
    },
    resolveRunStyle([])
  );
  expect(measured).toEqual([{ text: '123', family: 'Arial', bold: expected, italic: true }]);
  expect(texts(result.geometry)[0]?.runStyle).toMatchObject({
    fontFamily: 'Arial',
    bold: expected,
    italic: true,
  });
  expect(canonicalOoxmlFingerprint(part)).toBe(before);
  const saved = serializeOoxmlPart(part);
  expect(saved).toContain('<m:t>123</m:t>');
  expect(canonicalOoxmlFingerprint(read(saved))).toBe(before);
});

const slotFonts =
  '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="East Face" w:cs="Complex Face"/>';

test.each([
  ['', '1234', '1234', 'Arial', true],
  ['<m:rPr><m:nor/></m:rPr>', ' if ', ' if ', 'Arial', false],
  ['<m:rPr><m:sty m:val="b"/></m:rPr>', '1234', '𝟏𝟐𝟑𝟒', 'Cambria Math', false],
] as const)(
  'keeps the Latin face and size when other font slots name other faces (%s)',
  (mathProperties, text, expected, family, italic) => {
    const { part, projection } = project(
      run(text, `${mathProperties}<w:rPr>${slotFonts}<w:sz w:val="36"/></w:rPr>`) + run('x')
    );
    const before = canonicalOoxmlFingerprint(part);
    const nodes = texts(layoutEquation(projection, fixed, resolveRunStyle([])).geometry);
    expect(nodes[0]).toMatchObject({ kind: 'text', text: expected, fontSizePt: 18 });
    expect(nodes[0]?.runStyle).toMatchObject({ fontFamily: family, italic });
    expect(nodes[1]).toMatchObject({ kind: 'text', text: '𝑥' });
    expect(canonicalOoxmlFingerprint(part)).toBe(before);
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('w:eastAsia="East Face"');
    expect(canonicalOoxmlFingerprint(read(saved))).toBe(before);
  }
);

test('keeps the bounded fallback for a run whose text needs two authored faces', () => {
  const { projection } = project(run('1中', `<w:rPr>${slotFonts}</w:rPr>`));
  expect(projection?.expression).toMatchObject({ kind: 'fallback' });
});

test('keeps mathematical letters and symbols in the math face beside authored-face digits', () => {
  const { projection } = project(run('x12+α', face('Arial', '<w:b/>')));
  const geometry = layoutEquation(projection, fixed, resolveRunStyle([])).geometry;
  expect(
    texts(geometry).map((node) => [
      node.text,
      node.runStyle?.fontFamily,
      node.runStyle?.bold,
      node.runStyle?.italic,
    ])
  ).toEqual([
    ['𝑥', 'Cambria Math', false, false],
    ['12', 'Arial', true, true],
    ['+', 'Cambria Math', false, false],
    ['𝛼', 'Cambria Math', false, false],
  ]);
});

test.each([
  ['x12\u0305+α3\u0301', ['𝑥', '12\u0305', '+', '𝛼', '3\u0301']],
  ['𝟙2\u0301', ['𝟙', '2\u0301']],
] as const)('keeps combining marks attached to authored-face digits in %s', (source, expected) => {
  const { part, projection } = project(run(source, face('Arial')));
  const before = canonicalOoxmlFingerprint(part);
  const nodes = texts(layoutEquation(projection, fixed, resolveRunStyle([])).geometry);
  expect(nodes.map((node) => node.text)).toEqual([...expected]);
  for (const node of nodes) {
    const digits = /^[0-9]/u.test(node.text);
    expect(node.runStyle?.fontFamily).toBe(digits ? 'Arial' : 'Cambria Math');
    expect(node.runStyle?.italic).toBe(digits);
  }
  expect(canonicalOoxmlFingerprint(part)).toBe(before);
});

test('uses explicit math style i for authored-face digits', () => {
  const { projection } = project(run('12', `<m:rPr><m:sty m:val="i"/></m:rPr>${face('Arial')}`));
  const [node] = texts(layoutEquation(projection, fixed, resolveRunStyle([])).geometry);
  expect(node?.text).toBe('12');
  expect(node?.runStyle).toMatchObject({ fontFamily: 'Arial', bold: false, italic: true });
});

test.each(['b', 'bi'] as const)(
  'keeps mathematical bold digits in the math face for math style %s',
  (style) => {
    const { projection } = project(
      run('123', `<m:rPr><m:sty m:val="${style}"/></m:rPr>${face('Arial')}`)
    );
    const [node] = texts(layoutEquation(projection, fixed, resolveRunStyle([])).geometry);
    expect(node?.text).toBe('𝟏𝟐𝟑');
    expect(node?.runStyle).toMatchObject({
      fontFamily: 'Cambria Math',
      bold: false,
      italic: false,
    });
  }
);

test.each([
  ['b', '𝐱𝟏𝟐'],
  ['bi', '𝒙𝟏𝟐'],
] as const)('keeps a mixed run with math style %s in one math-face node', (style, expected) => {
  const { part, projection } = project(
    run('x12', `<m:rPr><m:sty m:val="${style}"/></m:rPr>${face('Arial', '<w:b/>')}`)
  );
  const before = canonicalOoxmlFingerprint(part);
  const nodes = texts(layoutEquation(projection, fixed, resolveRunStyle([])).geometry);
  expect(nodes.map((node) => [node.text, node.runStyle?.fontFamily])).toEqual([
    [expected, 'Cambria Math'],
  ]);
  expect(canonicalOoxmlFingerprint(part)).toBe(before);
});

test.each(['Cambria Math', 'CAMBRIA MATH'])(
  'keeps digits of the math face %s upright without a synthetic italic face',
  (family) => {
    const { projection } = project(run('123', face(family, '<w:b/>')));
    const [node] = texts(layoutEquation(projection, fixed, resolveRunStyle([])).geometry);
    expect(node?.text).toBe('123');
    expect(node?.runStyle).toMatchObject({
      fontFamily: 'Cambria Math',
      bold: false,
      italic: false,
    });
  }
);

test.each([
  ['<m:sty m:val="p"/>', '<w:b/>', true, false],
  ['<m:nor/>', '<w:i/>', false, true],
] as const)(
  'keeps explicit plain and normal-text formatting (%s)',
  (mathProperties, wordProperties, bold, italic) => {
    const { projection } = project(
      run('x12', `<m:rPr>${mathProperties}</m:rPr>${face('Arial', wordProperties)}`)
    );
    const [node] = texts(layoutEquation(projection, fixed, resolveRunStyle([])).geometry);
    expect(node?.text).toBe('x12');
    expect(node?.runStyle).toMatchObject({ fontFamily: 'Arial', bold, italic });
  }
);

test('uses the paragraph face for normal text without run font properties', () => {
  const styles = read(
    `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `${face('Paragraph Face')}</w:style></w:styles>`,
    '/word/styles.xml'
  );
  const part = read(
    `<w:document xmlns:w="${w}" xmlns:m="${m}"><w:body><w:p>` +
      `<w:pPr>${face('Mark Face')}</w:pPr>` +
      `<m:oMath>${run('normal 123', '<m:rPr><m:nor/></m:rPr>')}` +
      `${run('x')}</m:oMath></w:p></w:body></w:document>`
  );
  const before = canonicalOoxmlFingerprint(part);
  const spans = linesOf(
    layoutSemanticDocument(part, 1, {
      measurer: fixed,
      styleCascade: buildStyleCascadeTable(styles.root),
    })
  ).flatMap((line) => line.spans);
  const equation = spans.find((span) => span.equation);
  if (!equation?.equation) throw new Error('Missing equation span');
  expect(equation.range.end - equation.range.start).toBe(1);
  expect(equation.style.fontFamily).toBe('Cambria Math');
  expect(
    texts(equation.equation.geometry).map((node) => [node.text, node.runStyle?.fontFamily])
  ).toEqual([
    ['normal 123', 'Paragraph Face'],
    ['𝑥', 'Cambria Math'],
  ]);
  expect(canonicalOoxmlFingerprint(part)).toBe(before);
});

test('normal text takes the caller paragraph face without changing inherited styles', () => {
  const { projection } = project(run('normal', '<m:rPr><m:nor/></m:rPr>'));
  const style = Object.freeze({
    ...withFontFamily(resolveRunStyle([]), 'Paragraph Face'),
    italic: true,
  });
  const [node] = texts(layoutEquation(projection, fixed, style).geometry);
  expect(node?.runStyle).toMatchObject({ fontFamily: 'Paragraph Face', italic: false });
  expect(style.italic).toBe(true);
  expect(style.fontFamily).toBe('Paragraph Face');
});

test('cached equations keep distinct paragraph faces after math-style derivation', () => {
  const { projection } = project(run('normal', '<m:rPr><m:nor/></m:rPr>'));
  const layout = createEquationLayouter(fixed, 'authored-equation-run-fonts');
  const firstStyle = equationRunStyle(withFontFamily(resolveRunStyle([]), 'First Face'));
  const secondStyle = equationRunStyle(withFontFamily(resolveRunStyle([]), 'Second Face'));
  const first = layout(projection, firstStyle);
  const second = layout(projection, secondStyle);
  expect(texts(first.geometry)[0]?.runStyle?.fontFamily).toBe('First Face');
  expect(texts(second.geometry)[0]?.runStyle?.fontFamily).toBe('Second Face');
  expect(second).not.toBe(first);
  expect(layout(projection, firstStyle)).toBe(first);
  expect(layout(projection, secondStyle)).toBe(second);
});

test.each(['ordinary-first', 'equation-first'])(
  'keeps explicit math styles separate from equation derivation (%s)',
  (order) => {
    const { projection } = project(run('normal', '<m:rPr><m:nor/></m:rPr>'));
    const paragraph = Object.freeze({
      ...withFontFamily(resolveRunStyle([]), 'Paragraph Face'),
    });
    const ordinary = withFontFamily(paragraph, 'Cambria Math');
    const derive = () => equationRunStyle(paragraph);
    const layout = createEquationLayouter(fixed, `equation-style-identity-${order}`);
    if (order === 'ordinary-first') layout(projection, ordinary);
    const derived = derive();
    expect(derived).not.toBe(ordinary);
    expect(derive()).toBe(derived);
    expect(equationRunStyle(derived)).toBe(derived);
    expect(Object.isFrozen(derived)).toBe(true);
    const original = layout(projection, ordinary);
    const inherited = layout(projection, derived);
    expect(texts(original.geometry)[0]?.runStyle?.fontFamily).toBe('Cambria Math');
    expect(texts(inherited.geometry)[0]?.runStyle?.fontFamily).toBe('Paragraph Face');
    expect(layout(projection, ordinary)).toBe(original);
    expect(layout(projection, derived)).toBe(inherited);
  }
);
