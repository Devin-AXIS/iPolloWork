// A page break directly followed by a line break breaks no page, and a paragraph that opens
// with a column break keeps that break line on a full page or column.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
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

// 200pt wide, 310pt tall sheets with 10pt margins: a 290pt content box holds fourteen 20pt
// lines and leaves 10pt, less than one more line.
const sect = (columns = '') =>
  '<w:sectPr><w:pgSz w:w="4000" w:h="6200"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  `w:header="0" w:footer="0" w:gutter="0"/>${columns}</w:sectPr>`;
const exact = '<w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/>';

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const paragraph = (runs: string) => `<w:p><w:pPr>${exact}</w:pPr>${runs}</w:p>`;
const fill = (count: number) =>
  Array.from({ length: count }, (_, line) => paragraph(run(`line${line}`))).join('');
const page = '<w:r><w:br w:type="page"/></w:r>';
const column = '<w:r><w:br w:type="column"/></w:r>';
const line = '<w:r><w:br/></w:r>';

/** Each word's page and line slot, in document order. */
function wordsAt(layout: SemanticLayout): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  layout.pages.forEach((sheet, index) => {
    for (const fragment of sheet.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const placed of (fragment as ParagraphFragmentRecord).lines) {
        const text = placed.spans
          .map((span) => span.text)
          .join('')
          .replace(/\W/g, '');
        if (text) out[text] = [index, Math.round(placed.box.y / 20)];
      }
    }
  });
  return out;
}

describe('a page break directly followed by a line break', () => {
  test('breaks no page: the text after the pair continues on the next line', () => {
    const layout = lay(
      load(
        paragraph(run('S')) + paragraph(page + line + run('AA')) + paragraph(run('NEXT')) + sect()
      )
    );
    expect(layout.pages).toHaveLength(1);
    expect(wordsAt(layout)).toMatchObject({ S: [0, 0], AA: [0, 2], NEXT: [0, 3] });
  });

  test('breaks no page after text on the same line', () => {
    const layout = lay(
      load(paragraph(run('XX') + page + line + run('YY')) + paragraph(run('NEXT')) + sect())
    );
    expect(layout.pages).toHaveLength(1);
    expect(wordsAt(layout)).toMatchObject({ XX: [0, 0], YY: [0, 1], NEXT: [0, 2] });
  });

  test('after a full page, the paragraph and the next one share the next sheet', () => {
    const layout = lay(load(fill(14) + paragraph(page + line) + paragraph(run('NEXT')) + sect()));
    expect(layout.pages).toHaveLength(2);
    expect(wordsAt(layout).NEXT).toEqual([1, 2]);
  });

  test('a page break before text, or after a line break, still breaks the page', () => {
    const text = lay(load(paragraph(run('S')) + paragraph(page + run('AA')) + sect()));
    expect(wordsAt(text).AA).toEqual([1, 0]);
    const reversed = lay(
      load(paragraph(run('S')) + paragraph(line + page) + paragraph(run('NEXT')) + sect())
    );
    expect(wordsAt(reversed).NEXT).toEqual([1, 0]);
  });
});

describe('space before a paragraph that opens with a break', () => {
  // 40pt space before (800 twips); lines are 20pt slots.
  const spaced = (runs: string) =>
    `<w:p><w:pPr><w:spacing w:before="800" w:after="0" w:line="400" w:lineRule="exact"/></w:pPr>${runs}</w:p>`;

  test('goes to the text in the next column, not to the break line', () => {
    const layout = lay(
      load(
        paragraph(run('S')) +
          spaced(column + run('AA')) +
          paragraph(run('NEXT')) +
          sect('<w:cols w:num="2" w:space="0"/>')
      )
    );
    expect(wordsAt(layout)).toMatchObject({ S: [0, 0], AA: [0, 2], NEXT: [0, 3] });
  });

  test('goes to the text on the next page after a page break, as before', () => {
    const layout = lay(load(paragraph(run('S')) + spaced(page + run('AA')) + sect()));
    expect(wordsAt(layout).AA).toEqual([1, 2]);
  });
});

describe('a paragraph that opens with a column break', () => {
  test('keeps the break line on a full page, with nothing after the break', () => {
    const layout = lay(load(fill(14) + paragraph(column) + paragraph(run('NEXT')) + sect()));
    expect(layout.pages).toHaveLength(2);
    expect(wordsAt(layout).NEXT).toEqual([1, 1]);
  });

  test('keeps it before a second column or page break', () => {
    for (const second of [column, page]) {
      const layout = lay(
        load(fill(14) + paragraph(column + second) + paragraph(run('NEXT')) + sect())
      );
      expect(layout.pages).toHaveLength(3);
    }
  });

  test('keeps it at the bottom of a full first column', () => {
    const layout = lay(
      load(
        fill(14) +
          paragraph(column + run('AA')) +
          paragraph(run('NEXT')) +
          sect('<w:cols w:num="2" w:space="0"/>')
      )
    );
    expect(layout.pages).toHaveLength(1);
    expect(wordsAt(layout)).toMatchObject({ AA: [0, 0], NEXT: [0, 1] });
  });

  test('a lone page break after a full page keeps the ordinary fit', () => {
    const layout = lay(load(fill(14) + paragraph(page) + paragraph(run('NEXT')) + sect()));
    expect(layout.pages).toHaveLength(3);
  });
});
