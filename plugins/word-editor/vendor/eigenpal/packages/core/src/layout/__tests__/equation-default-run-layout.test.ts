import { describe, expect, test } from 'bun:test';
import {
  projectOmmlEquation,
  readOoxmlPart,
  type EquationExpression,
  type OoxmlNode,
  type OmmlEquationProjection,
} from '@docx-editor.dev/core/store';
import { layoutEquation } from '../equation-layout.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { resolveRunStyle, type ResolvedRunStyle } from '../run-style.ts';
import {
  buildStyleCascadeTable,
  layoutSemanticDocument,
  linesOf,
  type TextMeasurer,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FONT = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';

function equationOf(body: string): OoxmlNode {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p>` +
      `<m:oMath>${body}</m:oMath></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.namespaceUri === M && node.localName === 'oMath') return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  return find(parsed.part.root)!;
}

// Letters, digits, an operator, and a Greek letter: every glyph class the math style maps.
const body = (properties: string) => {
  const run = (text: string) => `<m:r>${properties}<m:t>${text}</m:t></m:r>`;
  return (
    `${run('x+1')}<m:f><m:num>${run('αb')}</m:num><m:den>${run('2')}</m:den></m:f>` +
    `<m:sSup><m:e>${run('y')}</m:e><m:sup>${run('n')}</m:sup></m:sSup>`
  );
};

function geometry(projection: OmmlEquationProjection) {
  return layoutEquation(projection, createFixedMeasurer(6, 14), resolveRunStyle([])).geometry;
}

test.each([
  ['the math font', `<w:rPr>${FONT}</w:rPr>`],
  ['the math font and italic', `<w:rPr>${FONT}<w:i/><w:iCs/></w:rPr>`],
  ['default properties without a size', `<w:rPr>${FONT}<w:i/><w:lang w:val="en-US"/></w:rPr>`],
])('default run properties with %s lay out like runs without them', (_name, properties) => {
  const plain = projectOmmlEquation(equationOf(body('')))!;
  const formatted = projectOmmlEquation(equationOf(body(properties)))!;
  expect(formatted.expression).toEqual(plain.expression);
  expect(geometry(formatted)).toEqual(geometry(plain));
});

// Runs whose default properties differ stay read-only and keep their own sizes.
test('runs with different default sizes keep those sizes', () => {
  const sized = (size: string) => `<w:rPr>${FONT}<w:sz w:val="${size}"/></w:rPr>`;
  const mixed = `<m:r>${sized('24')}<m:t>x+1</m:t></m:r><m:r>${sized('28')}<m:t>y</m:t></m:r>`;
  const formatted = projectOmmlEquation(equationOf(mixed))!;
  expect(JSON.stringify(formatted.expression)).toContain('format');
  const result = geometry(formatted);
  if (result.kind !== 'row') throw new Error('missing row');
  expect(result.items.map((item) => (item.kind === 'text' ? item.fontSizePt : undefined))).toEqual([
    12, 12, 12, 14,
  ]);
});

// The run format that the projection carried before default run properties were recognized.
// Without `m:rPr`, layout ignores the math font and `w:i`: the default italic math style
// already maps letters to mathematical italic glyphs and leaves digits and operators upright.
test('the math font and italic do not change the geometry of a run without m:rPr', () => {
  const projection = (format?: { fontFamily: string; italic: boolean }) =>
    ({
      sourceNodeId: 'public-equation',
      expression: Object.freeze({
        kind: 'text',
        value: 'x+1α',
        ...(format ? { format } : {}),
      }) as EquationExpression,
      fallbackText: 'x+1α',
      truncated: false,
      visitedNodes: 3,
    }) satisfies OmmlEquationProjection;
  expect(geometry(projection({ fontFamily: 'Cambria Math', italic: true }))).toEqual(
    geometry(projection())
  );
});

// Document layout: one `w:sz` shared by every run sizes the equation and its line.
describe('the shared size of default run properties', () => {
  const measurer: TextMeasurer = {
    measure: (text, style: ResolvedRunStyle) => text.length * style.fontSizePt * 0.5,
    lineMetrics: (style) => ({ height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 }),
  };
  const styles = (halfPoints: number) => {
    const read = readOoxmlPart(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
        `<w:rPr><w:sz w:val="${halfPoints}"/></w:rPr></w:style></w:styles>`,
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    return buildStyleCascadeTable(read.part.root);
  };
  /** The width and height of each line, with a 1pt mark so the mark cannot set the height. */
  const lay = (content: string, halfPoints: number) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p><w:pPr>` +
        '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
        `<w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${content}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const layout = layoutSemanticDocument(read.part, 1, {
      measurer,
      styleCascade: styles(halfPoints),
    });
    return linesOf(layout).map((line) => [line.box.width, line.box.height]);
  };
  const properties = (halfPoints?: number) =>
    `<w:rPr>${FONT}<w:i/>` +
    (halfPoints ? `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>` : '') +
    '</w:rPr>';
  const equation = (runProperties: string) =>
    `<m:oMath><m:r>${runProperties}<m:t>x+1</m:t></m:r>` +
    `<m:f><m:num><m:r>${runProperties}<m:t>a</m:t></m:r></m:num>` +
    `<m:den><m:r>${runProperties}<m:t>2</m:t></m:r></m:den></m:f></m:oMath>`;

  test('a 20pt run size lays an inline equation out at 20pt in 11pt text', () => {
    expect(lay(equation(properties(40)), 22)).toEqual(lay(equation(properties()), 40));
    expect(lay(equation(properties(40)), 22)).not.toEqual(lay(equation(properties()), 22));
  });

  test('a display takes the size that its equations share', () => {
    const display = (runProperties: string) =>
      `<m:oMathPara>${equation(runProperties)}${equation(runProperties)}</m:oMathPara>`;
    expect(lay(display(properties(16)), 22)).toEqual(lay(display(properties()), 16));
  });

  test('runs without one shared size differ from unsized text', () => {
    const run = (runProperties: string, text: string) =>
      `<m:r>${runProperties}<m:t>${text}</m:t></m:r>`;
    const mixed = `<m:oMath>${run(properties(40), 'x')}${run(properties(28), 'y')}</m:oMath>`;
    const plain = `<m:oMath>${run('', 'x')}${run('', 'y')}</m:oMath>`;
    expect(lay(mixed, 22)).not.toEqual(lay(plain, 22));
    expect(lay(mixed, 22)[0]![1]).toBeCloseTo(23, 8);
  });
});
