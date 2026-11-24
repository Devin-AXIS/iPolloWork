// A manual page break followed by an empty section mark advances one sheet, not two.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { sectionMarksJoiningBreakSheet } from '../section-mark-break.ts';
import {
  enumerateDocumentSectionsFromBlocks,
  type DocumentSection,
} from '../section-properties.ts';
import { storyBlocks } from '../story-roots.ts';
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

// 200pt wide, 300pt tall sheets with 10pt margins.
const sect = (type = '', heightTwips = 6000) =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}` +
  `<w:pgSz w:w="4000" w:h="${heightTwips}"/>` +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const textThenBreak = '<w:p><w:r><w:t>closing</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>';
const mark = (sectPr: string, pPr = '') => `<w:p><w:pPr>${pPr}${sectPr}</w:pPr></w:p>`;

const paragraphsOn = (layout: SemanticLayout, page: number): ParagraphFragmentRecord[] =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
/** Visible text only: break characters paint nothing. */
const textOf = (fragment: ParagraphFragmentRecord): string =>
  fragment.lines
    .flatMap((line) => line.spans.map((span) => span.text))
    .join('')
    .replace(/[^\w ]/g, '');
const pageTexts = (layout: SemanticLayout): string[] =>
  layout.pages.map((_, page) =>
    paragraphsOn(layout, page)
      .map(textOf)
      .filter((text) => text !== '')
      .join(' ')
  );
/** Page index of every paragraph fragment, keyed by paragraph id. */
const pageOfParagraph = (layout: SemanticLayout): Map<string, number[]> => {
  const pages = new Map<string, number[]>();
  layout.pages.forEach((_, page) => {
    for (const fragment of paragraphsOn(layout, page)) {
      pages.set(fragment.paragraphId, [...(pages.get(fragment.paragraphId) ?? []), page]);
    }
  });
  return pages;
};
/** The fragment of the paragraph at a top-level body position (`#0.0.N`). */
const fragmentAt = (layout: SemanticLayout, position: number) =>
  layout.pages
    .flatMap((_, page) => paragraphsOn(layout, page).map((fragment) => ({ fragment, page })))
    .find(({ fragment }) => fragment.paragraphId.endsWith(`#0.0.${position}`))!;

describe('a page break followed by an empty section mark', () => {
  test('advances one sheet before a next-page section', () => {
    const layout = lay(
      load(paragraph('one') + pageBreak + mark(sect()) + paragraph('two') + sect())
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    // The mark stays in the tree and on the sheet the break closed, out of the flow.
    const { fragment, page } = fragmentAt(layout, 2);
    expect(page).toBe(0);
    expect(fragment.outOfFlow).toBe(true);
    const caret = caretAt(layout, { paragraphId: fragment.paragraphId, offset: 0 });
    expect(caret?.pageIndex).toBe(0);
    expect(caret?.height).toBeGreaterThan(0);
    // The next section still starts at the top of its own sheet.
    expect(fragmentAt(layout, 3).fragment.box.y).toBe(0);
  });

  test('advances one sheet when text precedes the break in the same paragraph', () => {
    const layout = lay(
      load(paragraph('one') + textThenBreak + mark(sect()) + paragraph('two') + sect())
    );
    expect(pageTexts(layout)).toEqual(['one closing', 'two']);
    expect(fragmentAt(layout, 2).page).toBe(0);
  });

  test('ignores keep and page-break-before properties on the mark', () => {
    const layout = lay(
      load(
        paragraph('one') +
          pageBreak +
          mark(sect(), '<w:keepNext/><w:keepLines/><w:pageBreakBefore/>') +
          paragraph('two') +
          sect()
      )
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
  });

  test('advances one sheet when a mark-only section opens the next sheet', () => {
    // The second mark is a whole next-page section; the continuous section after it shares
    // that section's sheet.
    const layout = lay(
      load(
        paragraph('one') +
          pageBreak +
          mark(sect()) +
          mark(sect()) +
          paragraph('two') +
          sect('continuous')
      )
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    expect(fragmentAt(layout, 2).page).toBe(0);
    expect(fragmentAt(layout, 3).page).toBe(1);
  });

  test('advances one sheet across an intervening mark-only continuous section', () => {
    const layout = lay(
      load(
        paragraph('one') +
          pageBreak +
          mark(sect()) +
          mark(sect('continuous')) +
          paragraph('two') +
          sect()
      )
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    expect(fragmentAt(layout, 2).page).toBe(0);
    expect(fragmentAt(layout, 3).page).toBe(0);
    expect(fragmentAt(layout, 4).fragment.box.y).toBe(0);
  });

  test('keeps the second sheet when a break sits at the bottom of a full page', () => {
    // 64pt content box: five lines fill it, and the break line is the sixth.
    const layout = lay(
      load(
        ['a', 'b', 'c', 'd', 'e'].map((text) => paragraph(text)).join('') +
          pageBreak +
          mark(sect('', 1680)) +
          paragraph('two') +
          sect('', 1680)
      )
    );
    expect(pageTexts(layout)).toEqual(['a b c d e', '', 'two']);
    // The break paragraph and its mark share the sheet the break line opened.
    const pages = pageOfParagraph(layout);
    expect(pages.get(fragmentAt(layout, 5).fragment.paragraphId)).toEqual([1]);
    expect(pages.get(fragmentAt(layout, 6).fragment.paragraphId)).toEqual([1]);
  });
});

describe('explicit breaks and content that still take a sheet', () => {
  test('two page breaks before the mark keep one empty sheet', () => {
    const layout = lay(
      load(paragraph('one') + pageBreak + pageBreak + mark(sect()) + paragraph('two') + sect())
    );
    expect(pageTexts(layout)).toEqual(['one', '', 'two']);
  });

  test('a mark paragraph with text takes its own sheet', () => {
    const withText = `<w:p><w:pPr>${sect()}</w:pPr><w:r><w:t>marked</w:t></w:r></w:p>`;
    const layout = lay(load(paragraph('one') + pageBreak + withText + paragraph('two') + sect()));
    expect(pageTexts(layout)).toEqual(['one', 'marked', 'two']);
  });

  test('an empty paragraph between the break and the mark takes its own sheet', () => {
    const layout = lay(
      load(paragraph('one') + pageBreak + '<w:p/>' + mark(sect()) + paragraph('two') + sect())
    );
    expect(pageTexts(layout)).toEqual(['one', '', 'two']);
  });

  test('a trailing break at the end of the document keeps its empty sheet', () => {
    const layout = lay(load(paragraph('one') + pageBreak + '<w:p/>' + sect()));
    expect(layout.pages).toHaveLength(2);
  });

  test('a continuous section with content still starts after the break', () => {
    const layout = lay(
      load(paragraph('one') + pageBreak + mark(sect()) + paragraph('two') + sect('continuous'))
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    expect(fragmentAt(layout, 3).page).toBe(1);
  });

  test('a mark-only continuous section before a section with content stays after the break', () => {
    const layout = lay(
      load(
        paragraph('one') +
          pageBreak +
          mark(sect()) +
          mark(sect('continuous')) +
          paragraph('two') +
          sect('continuous')
      )
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    expect(fragmentAt(layout, 4).page).toBe(1);
  });
});

describe('incremental layout of a page break before an empty section mark', () => {
  const body = (markContent: string, breakParagraph = pageBreak) =>
    paragraph('one') +
    breakParagraph +
    `<w:p><w:pPr>${sect()}</w:pPr>${markContent}</w:p>` +
    paragraph('two') +
    sect();
  const warmThenCold = (before: string, after: string) => {
    const session = createLayoutSession();
    layoutSemanticDocument(load(before), 1, { measurer, session });
    const next = load(after);
    return {
      warm: layoutSemanticDocument(next, 2, { measurer, session }),
      cold: layoutSemanticDocument(next, 2, { measurer }),
    };
  };

  test('matches a cold layout after text is typed into the mark', () => {
    const { warm, cold } = warmThenCold(body(''), body('<w:r><w:t>typed</w:t></w:r>'));
    expect(warm.pages).toEqual(cold.pages);
    expect(pageTexts(warm)).toEqual(['one', 'typed', 'two']);
  });

  test('matches a cold layout after the mark text is removed', () => {
    const { warm, cold } = warmThenCold(body('<w:r><w:t>typed</w:t></w:r>'), body(''));
    expect(warm.pages).toEqual(cold.pages);
    expect(pageTexts(warm)).toEqual(['one', 'two']);
  });

  test('matches a cold layout after the break becomes text', () => {
    const { warm, cold } = warmThenCold(body(''), body('', paragraph('plain')));
    expect(warm.pages).toEqual(cold.pages);
    expect(pageTexts(warm)).toEqual(['one plain', 'two']);
  });

  test('matches a cold layout after text is typed into an intervening mark-only section', () => {
    const chain = (content: string) =>
      paragraph('one') +
      pageBreak +
      mark(sect()) +
      `<w:p><w:pPr>${sect('continuous')}</w:pPr>${content}</w:p>` +
      paragraph('two') +
      sect();
    const { warm, cold } = warmThenCold(chain(''), chain('<w:r><w:t>typed</w:t></w:r>'));
    expect(warm.pages).toEqual(cold.pages);
    expect(pageTexts(warm)).toEqual(['one', 'typed', 'two']);
  });

  test('matches a cold layout after the next section becomes continuous', () => {
    const typed = (type: string) =>
      paragraph('one') + pageBreak + mark(sect()) + paragraph('two') + sect(type);
    const { warm, cold } = warmThenCold(typed(''), typed('continuous'));
    expect(warm.pages).toEqual(cold.pages);
  });
});

describe('which section marks may stay on the break sheet', () => {
  const sectionsOf = (body: string) => {
    const part = load(body);
    const blocks = storyBlocks(part);
    return { blocks, sections: enumerateDocumentSectionsFromBlocks(part, blocks).sections };
  };
  /** Section `index` continues the sheet of the section before it. */
  const continuous = (sections: readonly DocumentSection[]) => (index: number) =>
    sections[index]!.properties.breakType === 'continuous';

  test('answers every section from the sections after it', () => {
    const { blocks, sections } = sectionsOf(
      paragraph('a', sect()) + // 0: next opens a sheet
        paragraph('b', sect()) + // 1: next is mark-only continuous, then a sheet
        mark(sect('continuous')) + // 2: next opens a sheet
        paragraph('c', sect()) + // 3: next is mark-only continuous, then content
        mark(sect('continuous')) + // 4: next continues with content
        paragraph('d', sect('continuous')) + // 5: next opens a sheet
        paragraph('e') +
        sect() // 6: last section
    );
    expect(sectionMarksJoiningBreakSheet(sections, blocks, continuous(sections))).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
      false,
    ]);
  });

  test('asks once per section boundary over a long run of mark-only sections', () => {
    const count = 4000;
    const { blocks, sections } = sectionsOf(
      mark(sect()) +
        Array.from({ length: count }, () => mark(sect('continuous'))).join('') +
        paragraph('end') +
        sect()
    );
    let asked = 0;
    const joins = sectionMarksJoiningBreakSheet(sections, blocks, (index) => {
      asked += 1;
      return continuous(sections)(index);
    });
    expect(asked).toBe(sections.length - 1);
    // Every mark in the run reaches the final next-page section; the last one has no successor.
    expect(joins.slice(0, -1).every(Boolean)).toBe(true);
    expect(joins.at(-1)).toBe(false);
  });
});
