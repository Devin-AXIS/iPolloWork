// An empty section mark that follows content in its own section ignores its own
// `w:pageBreakBefore`, so it never opens a blank sheet before the next section.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type SemanticLayoutOptions,
} from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const load = (body: string) =>
  read(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, '/word/document.xml');

// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

// `Break` inherits the page break and keep through `basedOn`; `Listed` adds numbering.
const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Base"><w:basedOn w:val="Normal"/>' +
      '<w:pPr><w:keepNext/><w:pageBreakBefore/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Break"><w:basedOn w:val="Base"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Listed"><w:basedOn w:val="Break"/>' +
      '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
      '</w:styles>',
    '/word/styles.xml'
  ).root
);
const numberingIndex = buildNumberingIndex(
  read(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
      '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
      '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    '/word/numbering.xml'
  ).root
);

const measurer = createFixedMeasurer(6, 14);
const options = (extra: Partial<SemanticLayoutOptions> = {}): SemanticLayoutOptions => ({
  measurer,
  styleCascade,
  numberingIndex,
  ...extra,
});
const lay = (body: string) => layoutSemanticDocument(load(body), 1, options());

// 200pt wide, 300pt tall sheets with 10pt margins: a 280pt content box holds 20 lines.
const sect = (type = '', size = '<w:pgSz w:w="4000" w:h="6000"/>', extra = '') =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}${size}` +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  `w:header="0" w:footer="0" w:gutter="0"/>${extra}</w:sectPr>`;
const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const style = (id: string) => `<w:pStyle w:val="${id}"/>`;
const mark = (sectPr: string, pPr = style('Break'), content = '') =>
  `<w:p><w:pPr>${pPr}${sectPr}</w:pPr>${content}</w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const paragraphsOn = (layout: SemanticLayout, page: number): ParagraphFragmentRecord[] =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
const pageTexts = (layout: SemanticLayout): string[] =>
  layout.pages.map((_, page) =>
    paragraphsOn(layout, page)
      .map((fragment) =>
        fragment.lines
          .flatMap((line) => line.spans.map((span) => span.text))
          .join('')
          .replace(/[^\w ]/g, '')
      )
      .filter((text) => text !== '')
      .join(' ')
  );
/** The fragment of the paragraph at a top-level body position (`#0.0.N`). */
const fragmentAt = (layout: SemanticLayout, position: number) =>
  layout.pages
    .flatMap((_, page) => paragraphsOn(layout, page).map((fragment) => ({ fragment, page })))
    .find(({ fragment }) => fragment.paragraphId.endsWith(`#0.0.${position}`))!;

describe('an empty section mark with its own page break before', () => {
  test('stays after the content of its section before a next-page section', () => {
    const layout = lay(paragraph('one') + mark(sect()) + paragraph('two') + sect());
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    // The mark keeps its line and a caret on the sheet of its section.
    const { fragment, page } = fragmentAt(layout, 1);
    expect(page).toBe(0);
    const one = fragmentAt(layout, 0).fragment.box;
    expect(fragment.box.y).toBe(one.y + one.height);
    const caret = caretAt(layout, { paragraphId: fragment.paragraphId, offset: 0 });
    expect(caret?.pageIndex).toBe(0);
    expect(caret?.height).toBeGreaterThan(0);
    expect(fragmentAt(layout, 2).fragment.box.y).toBe(0);
  });

  test('ignores a direct page break before the same way', () => {
    const layout = lay(
      paragraph('one') + mark(sect(), '<w:pageBreakBefore/>') + paragraph('two') + sect()
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    expect(fragmentAt(layout, 1).page).toBe(0);
  });

  test('takes no flow height before a continuous section', () => {
    const layout = lay(paragraph('one') + mark(sect()) + paragraph('two') + sect('continuous'));
    expect(pageTexts(layout)).toEqual(['one two']);
    expect(fragmentAt(layout, 1).fragment.outOfFlow).toBe(true);
    const one = fragmentAt(layout, 0).fragment.box;
    expect(fragmentAt(layout, 2).fragment.box.y).toBe(one.y + one.height);
  });

  test('stays when the next section starts on an odd or even page', () => {
    // Page 2 is even: an odd-page section still inserts its parity sheet.
    const odd = lay(paragraph('one') + mark(sect()) + paragraph('two') + sect('oddPage'));
    expect(odd.pages).toHaveLength(3);
    expect(odd.pages[1]!.parityBlank).toBe(true);
    expect(fragmentAt(odd, 1).page).toBe(0);
    expect(fragmentAt(odd, 2).page).toBe(2);
    const even = lay(paragraph('one') + mark(sect()) + paragraph('two') + sect('evenPage'));
    expect(pageTexts(even)).toEqual(['one', 'two']);
  });

  test('stays when the next section changes the page size', () => {
    const wide = '<w:pgSz w:w="6000" w:h="4000" w:orient="landscape"/>';
    for (const type of ['', 'continuous']) {
      const layout = lay(paragraph('one') + mark(sect()) + paragraph('two') + sect(type, wide));
      expect(pageTexts(layout)).toEqual(['one', 'two']);
      expect(fragmentAt(layout, 1).page).toBe(0);
    }
  });

  test('stays before a mark-only continuous section and a next-page section', () => {
    const layout = lay(
      paragraph('one') + mark(sect()) + mark(sect('continuous'), '') + paragraph('two') + sect()
    );
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    expect(fragmentAt(layout, 1).page).toBe(0);
    expect(fragmentAt(layout, 2).page).toBe(0);
  });

  test('ignores the break when the mark holds only bookmarks or empty runs', () => {
    for (const content of [
      '<w:bookmarkStart w:id="0" w:name="b"/><w:bookmarkEnd w:id="0"/>',
      '<w:r><w:rPr><w:b/></w:rPr></w:r>',
    ]) {
      const layout = lay(
        paragraph('one') + mark(sect(), style('Break'), content) + paragraph('two') + sect()
      );
      expect(pageTexts(layout)).toEqual(['one', 'two']);
    }
  });

  test('ignores the break when the mark holds only inert markers or zero-length text', () => {
    for (const content of [
      '<w:r><w:t/></w:r>',
      '<w:r><w:t xml:space="preserve"></w:t></w:r>',
      '<w:proofErr w:type="gramStart"/><w:proofErr w:type="gramEnd"/>',
      '<w:permStart w:id="1" w:edGrp="everyone"/><w:permEnd w:id="1"/>',
      '<w:commentRangeStart w:id="0"/>',
      '<w:commentRangeEnd w:id="0"/>',
      '<w:r><w:lastRenderedPageBreak/></w:r>',
      '<w:proofErr w:type="spellStart"/><w:r><w:rPr><w:b/></w:rPr>' +
        '<w:lastRenderedPageBreak/><w:t/></w:r><w:proofErr w:type="spellEnd"/>',
    ]) {
      const layout = lay(
        paragraph('one') + mark(sect(), style('Break'), content) + paragraph('two') + sect()
      );
      expect(pageTexts(layout)).toEqual(['one', 'two']);
      expect(fragmentAt(layout, 1).page).toBe(0);
    }
  });

  test('collapses a mark with inert markers before a continuous section', () => {
    const layout = lay(
      paragraph('one') +
        mark(sect(), style('Break'), '<w:proofErr w:type="gramStart"/><w:r><w:t/></w:r>') +
        paragraph('two') +
        sect('continuous')
    );
    expect(pageTexts(layout)).toEqual(['one two']);
    expect(fragmentAt(layout, 1).fragment.outOfFlow).toBe(true);
  });

  test('ignores the break when the mark has a border, shading, or list numbering', () => {
    for (const pPr of [
      `${style('Break')}<w:pBdr><w:top w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr>`,
      `${style('Break')}<w:shd w:val="clear" w:color="auto" w:fill="CCCCCC"/>`,
      style('Listed'),
    ]) {
      const layout = lay(paragraph('one') + mark(sect(), pPr) + paragraph('two') + sect());
      expect(layout.pages).toHaveLength(2);
      expect(fragmentAt(layout, 1).page).toBe(0);
    }
  });

  test('ignores the break after a table, an empty paragraph, or a broken paragraph', () => {
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const afterTable = lay(table + mark(sect()) + paragraph('two') + sect());
    expect(afterTable.pages).toHaveLength(2);
    expect(fragmentAt(afterTable, 1).page).toBe(0);
    expect(
      pageTexts(lay(paragraph('one') + '<w:p/>' + mark(sect()) + paragraph('two') + sect()))
    ).toEqual(['one', 'two']);
    // The earlier paragraph's own break still opens its sheet; the mark follows it there.
    const broken = lay(
      paragraph('one') +
        paragraph('broken', '<w:pageBreakBefore/>') +
        mark(sect()) +
        paragraph('two') +
        sect()
    );
    expect(pageTexts(broken)).toEqual(['one', 'broken', 'two']);
    expect(fragmentAt(broken, 2).page).toBe(1);
  });

  test('stays at the bottom of a full sheet', () => {
    const fill = Array.from({ length: 20 }, (_, index) => paragraph(`fill${index}`)).join('');
    const layout = lay(fill + mark(sect()) + paragraph('two') + sect());
    expect(layout.pages).toHaveLength(2);
    expect(fragmentAt(layout, 20).page).toBe(0);
    expect(pageTexts(layout)[1]).toBe('two');
  });

  test('keeps page numbering of the next section', () => {
    const field = (instr: string) => `<w:fldSimple w:instr=" ${instr} "/>`;
    const numbered =
      '<w:p><w:r><w:t xml:space="preserve">two </w:t></w:r>' +
      `${field('PAGE')}<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES')}</w:p>`;
    const layout = layoutSemanticDocument(
      load(
        paragraph('one') +
          mark(sect()) +
          numbered +
          sect('', undefined, '<w:pgNumType w:start="5"/>')
      ),
      1,
      options({ producer: 'test' })
    );
    expect(pageTexts(layout)).toEqual(['one', 'two 5 of 2']);
  });
});

describe('section marks whose page break before still applies', () => {
  test('a mark that is its section only block breaks before a continued sheet', () => {
    const layout = lay(
      paragraph('one') + mark(sect(), '') + mark(sect('continuous')) + paragraph('two') + sect()
    );
    expect(layout.pages).toHaveLength(3);
    expect(fragmentAt(layout, 2).page).toBe(1);
    expect(pageTexts(layout)[2]).toBe('two');
  });

  test('two marks in a row: the second is its own next-page section', () => {
    const layout = lay(paragraph('one') + mark(sect()) + mark(sect()) + paragraph('two') + sect());
    expect(layout.pages).toHaveLength(3);
    expect(fragmentAt(layout, 1).page).toBe(0);
    expect(fragmentAt(layout, 2).page).toBe(1);
  });

  test('a mark with text, a tab, hidden text, or a field breaks', () => {
    for (const content of [
      '<w:r><w:t>marked</w:t></w:r>',
      '<w:r><w:t xml:space="preserve"> </w:t></w:r>',
      '<w:r><w:tab/></w:r>',
      '<w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r>',
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>',
    ]) {
      const layout = lay(
        paragraph('one') + mark(sect(), style('Break'), content) + paragraph('two') + sect()
      );
      expect(layout.pages).toHaveLength(3);
      expect(fragmentAt(layout, 1).page).toBe(1);
    }
  });

  test('a mark with inert markers beside text, a space, hidden text, or a field breaks', () => {
    for (const content of [
      '<w:proofErr w:type="spellStart"/><w:r><w:t>marked</w:t></w:r><w:proofErr w:type="spellEnd"/>',
      '<w:r><w:lastRenderedPageBreak/><w:t xml:space="preserve"> </w:t></w:r>',
      '<w:r><w:t/><w:tab/></w:r>',
      '<w:r><w:rPr><w:vanish/></w:rPr><w:lastRenderedPageBreak/><w:t>hidden</w:t></w:r>',
      '<w:permStart w:id="1" w:edGrp="everyone"/>' +
        '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:permEnd w:id="1"/>',
    ]) {
      const layout = lay(
        paragraph('one') + mark(sect(), style('Break'), content) + paragraph('two') + sect()
      );
      expect(layout.pages).toHaveLength(3);
      expect(fragmentAt(layout, 1).page).toBe(1);
    }
  });

  test('a mark with inert markers that is its section only block breaks', () => {
    const layout = lay(
      paragraph('one') +
        mark(sect(), '') +
        mark(sect('continuous'), style('Break'), '<w:proofErr w:type="gramStart"/>') +
        paragraph('two') +
        sect()
    );
    expect(layout.pages).toHaveLength(3);
    expect(fragmentAt(layout, 2).page).toBe(1);
  });

  test('an empty paragraph that carries no section mark breaks', () => {
    const layout = lay(
      paragraph('one') + `<w:p><w:pPr>${style('Break')}</w:pPr></w:p>` + paragraph('two') + sect()
    );
    expect(layout.pages).toHaveLength(2);
    expect(fragmentAt(layout, 1).page).toBe(1);
  });

  test('a page break before the mark still advances one sheet', () => {
    const layout = lay(paragraph('one') + pageBreak + mark(sect()) + paragraph('two') + sect());
    expect(pageTexts(layout)).toEqual(['one', 'two']);
    expect(fragmentAt(layout, 2).page).toBe(0);
  });
});

describe('incremental layout of a section mark with a page break before', () => {
  const body = (content: string, pPr = style('Break')) =>
    paragraph('one') + mark(sect(), pPr, content) + paragraph('two') + sect();
  const warmThenCold = (before: string, after: string) => {
    const session = createLayoutSession();
    layoutSemanticDocument(load(before), 1, options({ session }));
    const next = load(after);
    return {
      warm: layoutSemanticDocument(next, 2, options({ session })),
      cold: layoutSemanticDocument(next, 2, options()),
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

  test('matches a cold layout after typed text leaves a zero-length text run', () => {
    const inert = '<w:proofErr w:type="gramStart"/>';
    const typed = warmThenCold(
      body(`${inert}<w:r><w:t/></w:r>`),
      body(`${inert}<w:r><w:t/><w:t>typed</w:t></w:r>`)
    );
    expect(typed.warm.pages).toEqual(typed.cold.pages);
    expect(pageTexts(typed.warm)).toEqual(['one', 'typed', 'two']);
    const removed = warmThenCold(
      body(`${inert}<w:r><w:t>typed</w:t></w:r>`),
      body(`${inert}<w:r><w:t/></w:r>`)
    );
    expect(removed.warm.pages).toEqual(removed.cold.pages);
    expect(pageTexts(removed.warm)).toEqual(['one', 'two']);
  });

  test('matches a cold layout after the page break before is set on the mark', () => {
    const { warm, cold } = warmThenCold(body('', ''), body(''));
    expect(warm.pages).toEqual(cold.pages);
    expect(pageTexts(warm)).toEqual(['one', 'two']);
  });
});
