// A section's empty closing mark never opens a sheet, so a `w:keepNext` paragraph before it is
// priced alone. With room for the kept paragraph but not for the mark, the kept paragraph stays
// on its page, and a new-page section starts on the very next sheet, with no blank one between.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
// A 200pt content height holds ten 18pt lines and 20pt more.
const PAGE =
  '<w:pgSz w:w="6000" w:h="4880"/><w:pgMar w:top="440" w:right="440" w:bottom="440" w:left="440" w:header="0" w:footer="0" w:gutter="0"/>';
const EXACT = '<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/>';

const para = (text: string, ppr = ''): string =>
  `<w:p><w:pPr>${ppr}${EXACT}</w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

function parse(kept: string, type: string): OoxmlPart {
  const body =
    Array.from({ length: 10 }, (_, index) => para(`Line ${index}`)).join('') +
    para(kept, '<w:keepNext/>') +
    `<w:p><w:pPr>${EXACT}<w:sectPr>${PAGE}</w:sectPr></w:pPr></w:p>` +
    para('Next');
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:type w:val="${type}"/>${PAGE}</w:sectPr></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** The page index of the first fragment holding `text`. */
function pageOf(part: OoxmlPart, text: string): number {
  const layout = layoutSemanticDocument(part, 1, { measurer });
  return layout.pages.findIndex((page) =>
    page.fragments.some(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.some((span) => span.text === text))
    )
  );
}

describe('keep with next before a section mark', () => {
  for (const type of ['nextPage', 'continuous']) {
    test(`the kept paragraph stays above a ${type} section mark`, () => {
      const part = parse('Kept', type);
      expect(pageOf(part, 'Kept')).toBe(0);
      expect(pageOf(part, 'Next')).toBe(1);
    });
  }

  test('an empty kept paragraph opens no blank sheet before a new-page section', () => {
    const part = parse('', 'nextPage');
    expect(layoutSemanticDocument(part, 1, { measurer }).pages).toHaveLength(2);
    expect(pageOf(part, 'Next')).toBe(1);
  });
});
