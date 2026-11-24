// An empty paragraph that carries a section mark before a continuous section takes no flow height.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { caretAt } from '../semantic-interaction.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart) => layoutSemanticDocument(part, 1, { measurer });

// 200pt wide sheets with 10pt margins; the height varies per test.
const sect = (heightTwips: number, type = '', cols = '') =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}` +
  `<w:pgSz w:w="4000" w:h="${heightTwips}"/>` +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  `w:header="0" w:footer="0" w:gutter="0"/>${cols}</w:sectPr>`;
const TALL = 6000;

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

/** An empty paragraph with 24pt exact line height, 100pt after, white shading, and a mark. */
const spacedMark = (sectPr: string, extra = '') =>
  '<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>' +
  `${extra}<w:spacing w:after="2000" w:line="480" w:lineRule="exact"/>${sectPr}</w:pPr></w:p>`;

const paragraphs = (layout: SemanticLayout, page = 0): ParagraphFragmentRecord[] =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
const textOf = (fragment: ParagraphFragmentRecord): string =>
  fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
const byText = (layout: SemanticLayout, text: string, page = 0) =>
  paragraphs(layout, page).find((fragment) => textOf(fragment) === text)!;
const markOf = (layout: SemanticLayout, page = 0) =>
  paragraphs(layout, page).find((fragment) => fragment.paragraphId.endsWith('#0.0.1'))!;

describe('an empty section mark before a continuous section', () => {
  test('takes no line, spacing, or shading, and keeps its fragment for the caret', () => {
    const part = load(
      paragraph('one') + spacedMark(sect(TALL)) + paragraph('two') + sect(TALL, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    // The next section starts where the previous content ended.
    expect(byText(layout, 'two').box.y).toBe(14);
    const mark = markOf(layout);
    expect(mark.outOfFlow).toBe(true);
    expect(mark.spacing).toEqual({ before: 0, after: 0 });
    expect(mark.shading).toBeUndefined();
    expect(mark.lines).toHaveLength(1);
    expect(mark.lines[0]!.box.y).toBe(14);
    const caret = caretAt(layout, { paragraphId: mark.paragraphId, offset: 0 });
    expect(caret?.pageIndex).toBe(0);
    expect(caret?.height).toBeGreaterThan(0);
  });

  test('carries the previous paragraph after-spacing into the next section', () => {
    const part = load(
      paragraph('one', '<w:spacing w:after="240"/>') +
        spacedMark(sect(TALL)) +
        paragraph('two') +
        sect(TALL, 'continuous')
    );
    expect(byText(lay(part), 'two').box.y).toBe(14 + 12);
  });

  test('does not push the next section to a new page', () => {
    // 88pt content: three 14pt lines leave 46pt, less than the mark's 24pt line plus 100pt.
    const short = 2160;
    const part = load(
      paragraph('a') +
        paragraph('b') +
        paragraph('c') +
        spacedMark(sect(short)) +
        paragraph('two') +
        sect(short, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    expect(byText(layout, 'two').box.y).toBe(42);
  });

  test('balances a two-column section without a line for the mark', () => {
    const cols = '<w:cols w:num="2" w:space="240"/>';
    const part = load(
      paragraph('first', sect(TALL)) +
        paragraph('A') +
        paragraph('B') +
        paragraph('C') +
        paragraph('D') +
        spacedMark(sect(TALL, 'continuous', cols)) +
        paragraph('tail') +
        sect(TALL, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    const columnTops = ['A', 'B', 'C', 'D'].map((text) => byText(layout, text).box.y);
    expect(columnTops).toEqual([14, 28, 14, 28]);
    expect(byText(layout, 'tail').box.y).toBe(42);
  });

  test('does not price the mark into a keep-with-next chain', () => {
    // 88pt content: five lines leave 18pt, room for the keep line but not for the mark too.
    const short = 2160;
    const part = load(
      ['a', 'b', 'c', 'd', 'e'].map((text) => paragraph(text)).join('') +
        paragraph('keep', '<w:keepNext/>') +
        spacedMark(sect(short)) +
        paragraph('two') +
        sect(short, 'continuous')
    );
    const layout = lay(part);
    expect(byText(layout, 'keep').box.y).toBe(70);
  });

  test('leaves a press below the next section line to that line', () => {
    const part = load(
      paragraph('one') + spacedMark(sect(TALL)) + paragraph('two') + sect(TALL, 'continuous')
    );
    const layout = lay(part);
    // The mark's 24pt line box covers y=14..38; the next section's only line covers y=14..28.
    for (const y of [16, 30, 34, 40]) {
      const hit = hitTestPage(layout, 0, { x: 20, y });
      expect(hit?.position.paragraphId).toBe(byText(layout, 'two').paragraphId);
    }
  });

  test('matches a cold layout after the next section changes type', () => {
    const body = (type: string) =>
      paragraph('one') + spacedMark(sect(TALL)) + paragraph('two') + sect(TALL, type);
    const session = createLayoutSession();
    layoutSemanticDocument(load(body('')), 1, { measurer, session });
    const toggled = load(body('continuous'));
    const warm = layoutSemanticDocument(toggled, 2, { measurer, session });
    const cold = layoutSemanticDocument(toggled, 2, { measurer });
    expect(warm.pages).toEqual(cold.pages);
    expect(byText(warm, 'two').box.y).toBe(14);
  });
});

describe('a section mark that stays in flow', () => {
  test('keeps its line when it is the only paragraph of its section', () => {
    // A continuous section that holds nothing but its empty mark still takes one line, so the
    // following section starts below it.
    const cols = '<w:cols w:num="3" w:space="240"/>';
    const bareMark = (sectPr: string) =>
      `<w:p><w:pPr><w:rPr><w:sz w:val="22"/></w:rPr>${sectPr}</w:pPr></w:p>`;
    const part = load(
      paragraph('one', sect(TALL)) +
        bareMark(sect(TALL, 'continuous', cols)) +
        paragraph('A') +
        paragraph('B') +
        paragraph('C') +
        sect(TALL, 'continuous', cols)
    );
    const layout = lay(part);
    const mark = paragraphs(layout).find((fragment) => fragment.paragraphId.endsWith('#0.0.1'))!;
    expect(mark.outOfFlow).toBeUndefined();
    expect(mark.box.y).toBe(14);
    expect(byText(layout, 'A').box.y).toBe(28);
  });

  test('keeps its line and spacing before a next-page section', () => {
    const part = load(
      paragraph('one') + spacedMark(sect(TALL)) + paragraph('two') + sect(TALL, 'nextPage')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(2);
    const mark = markOf(layout);
    expect(mark.outOfFlow).toBeUndefined();
    expect(mark.spacing.after).toBe(100);
    expect(mark.box.height).toBe(124);
  });

  test('keeps its line when the mark paragraph has text', () => {
    const withText =
      '<w:p><w:pPr><w:spacing w:after="2000"/>' +
      `${sect(TALL)}</w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>mark</w:t></w:r></w:p>`;
    const part = load(paragraph('one') + withText + paragraph('two') + sect(TALL, 'continuous'));
    expect(byText(lay(part), 'two').box.y).toBe(14 + 14 + 100);
  });

  test('keeps its line when the mark paragraph draws a border', () => {
    const border =
      '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/></w:pBdr>';
    const part = load(
      paragraph('one') +
        spacedMark(sect(TALL), border) +
        paragraph('two') +
        sect(TALL, 'continuous')
    );
    const layout = lay(part);
    expect(markOf(layout).outOfFlow).toBeUndefined();
    expect(byText(layout, 'two').box.y).toBeGreaterThan(14 + 24 + 100);
  });

  test('keeps its line when the mark paragraph shows a list number', () => {
    const numbering = readOoxmlPart(
      `<w:numbering xmlns:w="${W}"><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/>' +
        '<w:lvlText w:val="%1."/></w:lvl></w:abstractNum></w:numbering>',
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!numbering.ok) throw new Error(numbering.reason);
    const numPr = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
    const part = load(
      paragraph('one') + spacedMark(sect(TALL), numPr) + paragraph('two') + sect(TALL, 'continuous')
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: buildNumberingIndex(numbering.part.root),
    });
    expect(markOf(layout).outOfFlow).toBeUndefined();
    expect(byText(layout, 'two').box.y).toBe(14 + 24 + 100);
  });
});
