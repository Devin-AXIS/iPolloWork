import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { ResolvedRunStyle } from '../run-style.ts';
import {
  buildStyleCascadeTable,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  linesOf,
  type SemanticLayout,
  type TextMeasurer,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FONT = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';

const measurer: TextMeasurer = {
  measure: (text, style: ResolvedRunStyle) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 }),
};

const styles = (() => {
  const read = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="22"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Big"><w:rPr><w:sz w:val="48"/></w:rPr></w:style>` +
      `</w:styles>`,
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return buildStyleCascadeTable(read.part.root);
})();

function load(paragraphs: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${paragraphs}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

const rPr = (half?: number) =>
  `<w:rPr>${FONT}<w:i/>` +
  (half ? `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>` : '') +
  '</w:rPr>';
const eq = (props: string) =>
  `<m:oMath><m:r>${props}<m:t>x+1</m:t></m:r>` +
  `<m:f><m:num><m:r>${props}<m:t>a</m:t></m:r></m:num>` +
  `<m:den><m:r>${props}<m:t>2</m:t></m:r></m:den></m:f></m:oMath>`;
const para = (content: string, style = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}` +
  `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${content}</w:p>`;
const text = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

const shape = (layout: SemanticLayout) =>
  linesOf(layout).map((line) => ({
    box: line.box,
    baseline: line.baseline,
    spans: line.spans.map((span) => ({
      text: span.text,
      size: span.style.fontSizePt,
      eq: span.equation ? JSON.stringify(span.equation.geometry) : undefined,
    })),
  }));

const cold = (part: OoxmlPart) =>
  shape(layoutSemanticDocument(part, 1, { measurer, styleCascade: styles }));

function find(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  if (node.namespaceUri === M && node.localName === localName) return node;
  for (const child of node.children) {
    const found = find(child, localName);
    if (found) return found;
  }
  return undefined;
}

describe('incremental layout of sized equations', () => {
  const session = () => ({
    measurer,
    styleCascade: styles,
    session: createLayoutSession(),
    cache: createParagraphLayoutCache(),
  });

  test('run size change through a reload relayouts the equation', () => {
    const options = session();
    const before = para(text('A ') + eq(rPr(40)) + text(' B'));
    const after = para(text('A ') + eq(rPr(16)) + text(' B'));
    layoutSemanticDocument(load(before), 1, options);
    const warm = shape(layoutSemanticDocument(load(after), 2, options));
    expect(warm).toEqual(cold(load(after)));
    expect(warm[0]!.spans[1]!.size).toBe(8);
  });

  test('setMathEquation keeps the size and relayouts warm == cold', () => {
    const options = session();
    const part = load(para(text('A ') + eq(rPr(40)) + text(' B')));
    layoutSemanticDocument(part, 1, options);
    const result = applyTreeOp(part, {
      op: 'setMathEquation',
      equationId: find(part.root, 'oMath')!.id,
      linear: 'x/y+z',
    });
    if (!result.ok) throw new Error(result.reason);
    const warm = shape(layoutSemanticDocument(result.part, 2, options));
    expect(warm).toEqual(cold(result.part));
    expect(warm[0]!.spans.find((s) => s.eq)!.size).toBe(20);
  });

  test('paragraph style size change: sized equation stays, unsized follows', () => {
    const options = session();
    const content = text('A ') + eq(rPr(40)) + text(' B ') + eq(rPr());
    layoutSemanticDocument(load(para(content)), 1, options);
    const warm = shape(layoutSemanticDocument(load(para(content, 'Big')), 2, options));
    expect(warm).toEqual(cold(load(para(content, 'Big'))));
    const sizes = warm[0]!.spans.filter((s) => s.eq).map((s) => s.size);
    expect(sizes).toEqual([20, 24]);
  });
});

describe('equation displays', () => {
  test('display: mixed sizes remain distinct and shared sizes apply', () => {
    const display = (a: string, b: string) => para(`<m:oMathPara>${eq(a)}${eq(b)}</m:oMathPara>`);
    const mixed = cold(load(display(rPr(40), rPr(16))));
    const plain = cold(load(display(rPr(), rPr())));
    expect(mixed).not.toEqual(plain);
    const shared = cold(load(display(rPr(40), rPr(40))));
    expect(shared[0]!.spans.find((s) => s.eq)!.size).toBe(20);
    // A bare equation inherits the paragraph size beside an explicitly sized equation.
    const half = cold(load(display(rPr(40), rPr())));
    expect(half).not.toEqual(plain);
  });
});

describe('control properties do not hide the shared run size', () => {
  test('a bold m:ctrlPr keeps the 20pt run size', () => {
    const bold = `<m:ctrlPr><w:rPr>${FONT}<w:b/><w:i/></w:rPr></m:ctrlPr>`;
    const source =
      `<m:oMath><m:f><m:fPr>${bold}</m:fPr><m:num><m:r>${rPr(40)}<m:t>a</m:t></m:r></m:num>` +
      `<m:den><m:r>${rPr(40)}<m:t>2</m:t></m:r></m:den></m:f></m:oMath>`;
    const [line] = cold(load(para(text('A ') + source)));
    expect(line!.spans.find((s) => s.eq)!.size).toBe(20);
  });
});
