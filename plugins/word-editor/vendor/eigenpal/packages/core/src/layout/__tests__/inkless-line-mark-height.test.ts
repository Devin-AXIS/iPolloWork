// A line that draws no ink takes the paragraph mark's height, like an empty paragraph: spaces,
// a soft hyphen, or a zero-width space alone on the line. A line with a visible glyph keeps
// its run's height.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const RUN = '<w:rPr><w:sz w:val="20"/></w:rPr>';

/** The height of the middle paragraph, whose mark is 24pt and whose run is 10pt. */
function height(content: string): number {
  const p = (inner: string, mark = '') =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${mark}</w:pPr>${inner}</w:p>`;
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>` +
      p('<w:r><w:t>Top</w:t></w:r>') +
      p(content, '<w:rPr><w:sz w:val="48"/></w:rPr>') +
      p('<w:r><w:t>After</w:t></w:r>') +
      '<w:sectPr/></w:body></w:document>',
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  const fragments = layoutSemanticDocument(read.part, 1, { measurer }).pages[0]!.fragments;
  return fragments[1]!.box.height;
}

describe('lines that draw no ink', () => {
  const empty = height('');

  test('a soft hyphen or a zero-width space alone takes the mark height', () => {
    expect(height(`<w:r>${RUN}<w:softHyphen/></w:r>`)).toBeCloseTo(empty, 3);
    expect(height(`<w:r>${RUN}<w:t>​</w:t></w:r>`)).toBeCloseTo(empty, 3);
    expect(height(`<w:r>${RUN}<w:t xml:space="preserve">  </w:t></w:r>`)).toBeCloseTo(empty, 3);
  });

  test('a visible glyph keeps the run height', () => {
    expect(height(`<w:r>${RUN}<w:noBreakHyphen/></w:r>`)).toBeLessThan(empty);
    expect(height(`<w:r>${RUN}<w:t>x</w:t></w:r>`)).toBeLessThan(empty);
  });
});
