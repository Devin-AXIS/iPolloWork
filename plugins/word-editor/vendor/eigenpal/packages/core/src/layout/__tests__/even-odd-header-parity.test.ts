// `w:evenAndOddHeaders` alternates by DOCUMENT page number (ECMA-376 17.10.1).
//
// Header/footer variants are chosen while a section is laid out in isolation, and
// `remapPage` renumbers a page without re-picking its variant. A section that begins on an
// even page therefore has to be told where it starts, or every multi-section book-style
// document restarts the alternation at each section break.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
} from '../index.ts';
import type { PageFurniture } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function story(name: string, text: string) {
  const part = readOoxmlPart(
    `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`,
    {
      name: `/word/${name}.xml`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    }
  );
  if (!part.ok) throw new Error(part.reason);
  return layoutHeaderFooterStory(part.part, 400, measurer, 'test');
}

const alternating = (): PageFurniture => ({
  titlePage: false,
  evenAndOddHeaders: true,
  headers: new Map([
    ['default', story('odd', 'ODD')],
    ['even', story('even', 'EVEN')],
  ]),
  footers: new Map(),
});

const sectPr = () =>
  '<w:sectPr><w:pgSz w:w="6000" w:h="2000"/><w:pgMar w:top="200" w:right="200" ' +
  'w:bottom="200" w:left="200" w:header="100" w:footer="100"/></w:sectPr>';
const paragraph = (text: string, inSection = false) =>
  `<w:p>${inSection ? `<w:pPr>${sectPr()}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const variants = (part: OoxmlPart, furniture: readonly PageFurniture[]) =>
  layoutSemanticDocument(part, 1, {
    measurer,
    sectionFurniture: furniture,
  }).pages.map((page) => page.header?.variant);

describe('evenAndOddHeaders alternates by document page, not section page', () => {
  test('a second section starting on page 2 opens with the EVEN header', () => {
    const part = load(paragraph('one', true) + paragraph('two') + sectPr());
    // Two sections, one page each: document pages 1 and 2.
    expect(variants(part, [alternating(), alternating()])).toEqual(['default', 'even']);
  });

  test('alternation continues across the boundary rather than restarting', () => {
    // Three sections of one page each: the third must be odd again, not restart at odd.
    const part = load(
      paragraph('one', true) + paragraph('two', true) + paragraph('three') + sectPr()
    );
    expect(variants(part, [alternating(), alternating(), alternating()])).toEqual([
      'default',
      'even',
      'default',
    ]);
  });

  test('a single section still alternates from page 1', () => {
    const part = load(
      `${paragraph('one')}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${paragraph('two')}${sectPr()}`
    );
    expect(variants(part, [alternating()])).toEqual(['default', 'even']);
  });
});

test('single-section numbering controls header variants and retained layout', () => {
  const session = createLayoutSession();
  for (const start of [0, 1, 2, 0]) {
    const part = load(
      paragraph('one') +
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
        paragraph('two') +
        sectPr().replace('</w:sectPr>', `<w:pgNumType w:start="${start}"/></w:sectPr>`)
    );
    const furniture = alternating();
    const layout = layoutSemanticDocument(part, 1, { measurer, furniture, session });
    expect(layout.pages.map((page) => page.header?.variant)).toEqual(
      start % 2 === 0 ? ['even', 'default'] : ['default', 'even']
    );
  }
});
