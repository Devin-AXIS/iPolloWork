import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  canonicalOoxmlFingerprint,
  equationExpressionToLinearMath,
  projectOmmlAtom,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  createEquationLayouter,
  layoutEquation,
  type EquationGeometry,
  type EquationTextGeometry,
} from '../equation-layout.ts';
import {
  buildStyleCascadeTable,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  linesOf,
  type TextMeasurer,
} from '../index.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const measurer: TextMeasurer = {
  measure: (text, style) => Array.from(text).length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 }),
};

function read(content: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p><w:pPr>` +
      '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
      `<w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function find(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  if (node.namespaceUri === M && node.localName === localName) return node;
  for (const child of node.children) {
    const found = find(child, localName);
    if (found) return found;
  }
  return undefined;
}

const run = (value: string, size?: number, other = '') =>
  `<m:r>${other}<w:rPr>${size === undefined ? '' : `<w:sz w:val="${size * 2}"/>`}` +
  `</w:rPr><m:t>${value}</m:t></m:r>`;
const equation = (content: string) => `<m:oMath>${content}</m:oMath>`;
const projection = (content: string, display = false) =>
  projectOmmlAtom(find(read(content).root, display ? 'oMathPara' : 'oMath')!)!;
const style = (size = 11) => Object.freeze({ ...resolveRunStyle([]), fontSizePt: size });

function glyphs(node: EquationGeometry): EquationTextGeometry[] {
  switch (node.kind) {
    case 'text':
    case 'fallback':
      return [node];
    case 'row':
      return node.items.flatMap(glyphs);
    case 'fraction':
      return [...glyphs(node.numerator), ...glyphs(node.denominator)];
    case 'bar':
      return glyphs(node.body);
    case 'radical':
      return [
        ...glyphs(node.sign),
        ...glyphs(node.radicand),
        ...(node.degree ? glyphs(node.degree) : []),
      ];
    case 'script':
      return [
        ...glyphs(node.base),
        ...(node.subscript ? glyphs(node.subscript) : []),
        ...(node.superscript ? glyphs(node.superscript) : []),
      ];
    case 'nary':
      return [
        ...glyphs(node.operator),
        ...glyphs(node.body),
        ...(node.lowerLimit ? glyphs(node.lowerLimit) : []),
        ...(node.upperLimit ? glyphs(node.upperLimit) : []),
      ];
  }
}

const geometry = (content: string, size = 11, display = false) =>
  layoutEquation(projection(content, display), measurer, style(size)).geometry;

test('measures each source run at its own size and aligns their baselines', () => {
  const result = geometry(equation(run('1', 8) + run('2', 24) + run('3')));
  const runs = glyphs(result);
  expect(runs.map((node) => node.fontSizePt)).toEqual([8, 24, 11]);
  expect(runs.map((node) => node.box.width)).toEqual([4, 12, 5.5]);
  expect(runs.map((node) => node.runStyle?.fontSizePt)).toEqual([8, 24, 11]);
  for (const node of runs) expect(node.box.y + node.baseline).toBeCloseTo(21.6, 8);
  expect(result.box.height).toBeCloseTo(27.6, 8);
});

test('keeps each equation size when a display combines differently sized equations', () => {
  const result = geometry(
    `<m:oMathPara>${equation(run('1', 8))}${equation(run('2', 24))}${equation(run('3'))}</m:oMathPara>`,
    11,
    true
  );
  expect(
    glyphs(result)
      .filter((node) => node.text.trim())
      .map((node) => node.fontSizePt)
  ).toEqual([8, 24, 11]);
  expect(result.box.height).toBeCloseTo(27.6, 8);
});

test('combines an authored size with normal text and Word bold', () => {
  const source =
    '<m:oMath><m:r><m:rPr><m:nor/></m:rPr>' +
    '<w:rPr><w:sz w:val="48"/><w:b/></w:rPr><m:t>2</m:t></m:r></m:oMath>';
  const [text] = glyphs(geometry(source));
  expect(text!.kind).toBe('text');
  expect(text!.fontSizePt).toBe(24);
  expect(text!.runStyle?.bold).toBe(true);
});

test('scales each script and fraction run from its own authored size', () => {
  const content =
    `<m:sSubSup><m:e>${run('1', 24)}</m:e><m:sub>${run('2', 10)}</m:sub>` +
    `<m:sup>${run('3', 20)}</m:sup></m:sSubSup>` +
    `<m:f><m:num>${run('4', 30)}</m:num><m:den>${run('5', 10)}</m:den></m:f>`;
  const sizes = glyphs(geometry(equation(content))).map((node) => node.fontSizePt);
  expect(sizes).toEqual([24, 7, 14.5, 21.5, 7]);
});

test.each(['top', 'bottom'] as const)(
  'keeps the %s bar outside a large authored run',
  (position) => {
    const result = geometry(
      equation(
        `<m:bar><m:barPr><m:pos m:val="${position === 'bottom' ? 'bot' : position}"/></m:barPr><m:e>${run('1', 30)}</m:e></m:bar>`
      )
    );
    if (result.kind !== 'bar') throw new Error('missing bar');
    expect(glyphs(result.body)[0]!.fontSizePt).toBe(30);
    expect(result.box.height).toBeGreaterThan(34.5);
    expect(result.bar.width).toBe(15);
    if (position === 'top')
      expect(result.bar.y + result.bar.height).toBeLessThan(result.body.box.y);
    else expect(result.bar.y).toBeGreaterThan(result.body.box.height);
  }
);

test('caches authored sizes independently from inherited sizes', () => {
  const projected = projection(equation(run('1', 8) + run('2')));
  const lay = createEquationLayouter(measurer, 'mixed-size-cache');
  const small = lay(projected, style(11));
  const large = lay(projected, style(20));
  expect(glyphs(small.geometry).map((node) => node.fontSizePt)).toEqual([8, 11]);
  expect(glyphs(large.geometry).map((node) => node.fontSizePt)).toEqual([8, 20]);
  expect(lay(projected, style(11))).toBe(small);
  expect(lay(projected, style(20))).toBe(large);
});

describe('document layout and preserved source', () => {
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  const options = { measurer, styleCascade: buildStyleCascadeTable(styles.part.root) };

  test('without glyph ink, the largest equation run sets the text line height', () => {
    const part = read(`<w:r><w:t>A</w:t></w:r>${equation(run('1', 8) + run('2', 24))}`);
    const [line] = linesOf(layoutSemanticDocument(part, 1, options));
    expect(line!.box.height).toBeCloseTo(27.6, 8);
    expect(
      glyphs(line!.spans.find((span) => span.equation)!.equation!.geometry).map(
        (node) => node.fontSizePt
      )
    ).toEqual([8, 24]);
  });

  test('exact line spacing keeps its authored height around a larger equation', () => {
    const part = read(equation(run('1', 8) + run('2', 24)));
    const exact = readOoxmlPart(
      serializeOoxmlPart(part).replace('w:lineRule="auto"', 'w:lineRule="exact"'),
      { name: part.name, contentType: part.contentType }
    );
    if (!exact.ok) throw new Error(exact.reason);
    const [line] = linesOf(layoutSemanticDocument(exact.part, 1, options));
    expect(line!.box.height).toBe(12);
    expect(line!.spans.find((span) => span.equation)!.equation!.geometry.box.height).toBeCloseTo(
      27.6,
      8
    );
  });

  test('a changed authored size gives the same warm and cold layout', () => {
    const warmOptions = {
      ...options,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(read(equation(run('1', 8) + run('2', 24))), 1, warmOptions);
    const part = read(equation(run('1', 8) + run('2', 32)));
    const warm = linesOf(layoutSemanticDocument(part, 2, warmOptions));
    const cold = linesOf(layoutSemanticDocument(part, 2, options));
    expect(warm).toEqual(cold);
    expect(warm[0]!.box.height).toBeCloseTo(36.8, 8);
  });

  test('save and reopen keep mixed sizes and the compact editor remains unavailable', () => {
    const part = read(equation(run('1', 8) + run('2', 24)));
    const node = find(part.root, 'oMath')!;
    expect(equationExpressionToLinearMath(projectOmmlAtom(node)!.expression)).toBe('');
    layoutSemanticDocument(part, 1, options);
    const reopened = readOoxmlPart(serializeOoxmlPart(part), {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(part));
    expect(
      glyphs(
        layoutEquation(projectOmmlAtom(find(reopened.part.root, 'oMath')!)!, measurer, style())
          .geometry
      ).map((item) => item.fontSizePt)
    ).toEqual([8, 24]);
  });

  test('compact replacement keeps the uniform default run size', () => {
    const part = read(equation(run('1', 24) + run('2', 24)));
    const node = find(part.root, 'oMath')!;
    expect(equationExpressionToLinearMath(projectOmmlAtom(node)!.expression)).toBe('12');
    const replaced = applyTreeOp(part, {
      op: 'setMathEquation',
      equationId: node.id,
      linear: '3+4',
    });
    if (!replaced.ok) throw new Error(replaced.reason);
    const xml = serializeOoxmlPart(replaced.part);
    expect(xml).toContain('w:val="48"');
    const reopened = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
    if (!reopened.ok) throw new Error(reopened.reason);
    const projected = projectOmmlAtom(find(reopened.part.root, 'oMath')!)!;
    expect(equationExpressionToLinearMath(projected.expression)).toBe('3+4');
    expect(
      glyphs(layoutEquation(projected, measurer, style()).geometry).map((item) => item.fontSizePt)
    ).toEqual([24, 24, 24]);
  });

  test('complex-script-only size differences still prevent compact replacement', () => {
    const part = read(
      equation('<m:r><w:rPr><w:szCs w:val="48"/></w:rPr><m:t>1</m:t></m:r>' + run('2'))
    );
    const projected = projectOmmlAtom(find(part.root, 'oMath')!)!;
    expect(equationExpressionToLinearMath(projected.expression)).toBe('');
    expect(
      glyphs(layoutEquation(projected, measurer, style()).geometry).map((item) => item.fontSizePt)
    ).toEqual([11, 11]);
  });
});
