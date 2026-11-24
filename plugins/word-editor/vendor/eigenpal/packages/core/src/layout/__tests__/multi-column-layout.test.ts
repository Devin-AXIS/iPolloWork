import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  layoutSemanticDocument,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

function packageWithBody(body: string) {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function fragmentText(
  fragment: ReturnType<typeof layoutSemanticDocument>['pages'][number]['fragments'][number]
): string {
  return fragment.kind === 'paragraph'
    ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
    : '';
}

describe('multi-column section layout', () => {
  test('parses unequal widths, per-column gaps, and separator intent', () => {
    const part = packageWithBody(
      paragraph('columns') +
        '<w:sectPr>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="3" w:equalWidth="0" w:sep="1">' +
        '<w:col w:w="1200" w:space="240"/>' +
        '<w:col w:w="1800" w:space="360"/>' +
        '<w:col w:w="2400"/>' +
        '</w:cols>' +
        '</w:sectPr>'
    );

    const columns = enumerateDocumentSections(part)[0]!.properties.columns as {
      count: number;
      equalWidth?: boolean;
      separator?: boolean;
      definitions?: readonly { widthTwips: number; gapTwips: number }[];
    };
    expect(columns).toEqual({
      count: 3,
      gapTwips: 720,
      equalWidth: false,
      separator: true,
      definitions: [
        { widthTwips: 1200, gapTwips: 240 },
        { widthTwips: 1800, gapTwips: 360 },
        { widthTwips: 2400, gapTwips: 0 },
      ],
    });
  });

  test('an explicit column break advances to the next unequal column on the same page', () => {
    const part = packageWithBody(
      paragraph('FIRST COLUMN') +
        '<w:p><w:r><w:br w:type="column"/></w:r></w:p>' +
        paragraph('SECOND COLUMN') +
        '<w:sectPr>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:equalWidth="0" w:sep="true">' +
        '<w:col w:w="1800" w:space="600"/><w:col w:w="3000"/>' +
        '</w:cols>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    expect(layout.pages).toHaveLength(1);
    const first = layout.pages[0]!.fragments.find((item) => fragmentText(item) === 'FIRST COLUMN');
    const second = layout.pages[0]!.fragments.find(
      (item) => fragmentText(item) === 'SECOND COLUMN'
    );
    expect(first?.box.x).toBe(0);
    expect(second?.box.x).toBe(120);
    // Column one holds FIRST plus the break line; column two holds the empty remainder
    // plus SECOND. Both columns therefore reach two line heights with this measurer.
    expect(
      (
        layout.pages[0] as (typeof layout.pages)[number] & {
          columnSeparators?: readonly { x: number; y: number; width: number; height: number }[];
        }
      ).columnSeparators
    ).toEqual([{ x: 104.625, y: 0, width: 0.75, height: 25.454545454545453 }]);
  });

  test('a column break in an otherwise empty paragraph leaves an empty line in the next column', () => {
    // Word authoring form for an explicit column cut: a paragraph whose only run is the
    // break. After the break advances the flow, the paragraph's remainder still occupies a
    // line at the top of the new column — the empty line visible above "After Column Break"
    // in section 19 of the comprehensive fixture.
    const part = packageWithBody(
      paragraph('FIRST COLUMN') +
        '<w:p><w:r><w:br w:type="column"/></w:r></w:p>' +
        paragraph('SECOND COLUMN') +
        '<w:sectPr>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:space="600"/>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const first = layout.pages[0]!.fragments.find((item) => fragmentText(item) === 'FIRST COLUMN');
    const second = layout.pages[0]!.fragments.find(
      (item) => fragmentText(item) === 'SECOND COLUMN'
    );
    const breakRemnant = layout.pages[0]!.fragments.find(
      (item) =>
        item.kind === 'paragraph' &&
        item.box.x === second?.box.x &&
        fragmentText(item) === '' &&
        item.paragraphId !== second?.paragraphId
    );
    expect(breakRemnant).toBeDefined();
    expect(breakRemnant!.box.y).toBe(first!.box.y);
    expect(second!.box.y).toBeGreaterThan(breakRemnant!.box.y);
    expect(second!.box.y - breakRemnant!.box.y).toBe(breakRemnant!.box.height);
  });

  test('inline content after a column break is rebroken in the new column', () => {
    const part = packageWithBody(
      '<w:p><w:r><w:t>FIRST</w:t><w:br w:type="column"/>' +
        '<w:t>SECOND COLUMN HAS A DIFFERENT WIDTH</w:t></w:r></w:p>' +
        '<w:sectPr>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:equalWidth="0">' +
        '<w:col w:w="1800" w:space="600"/><w:col w:w="3000"/>' +
        '</w:cols>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const fragments = layout.pages[0]!.fragments.filter(
      (fragment) => fragment.kind === 'paragraph'
    );
    expect(fragments.map((fragment) => fragment.box.x)).toEqual([0, 120]);
    expect(fragments[0]!.paragraphId).toBe(fragments[1]!.paragraphId);
    expect(fragmentText(fragments[1]!)).toBe('SECOND COLUMN HAS A DIFFERENT WIDTH');
  });

  test('natural overflow fills the next column before opening another page', () => {
    const part = packageWithBody(
      paragraph(
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen'
      ) +
        '<w:sectPr>' +
        '<w:pgSz w:w="4800" w:h="1440"/>' +
        '<w:pgMar w:top="240" w:right="240" w:bottom="240" w:left="240"/>' +
        '<w:cols w:num="2" w:space="240"/>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    expect(layout.pages).toHaveLength(1);
    const fragments = layout.pages[0]!.fragments.filter(
      (fragment) => fragment.kind === 'paragraph'
    );
    expect(fragments).toHaveLength(2);
    expect(fragments.map((fragment) => fragment.box.x)).toEqual([0, 114]);
    expect(fragments.map((fragment) => fragment.fragmentIndex)).toEqual([0, 1]);
  });

  test('a continuation is rebroken to the next unequal column width', () => {
    const part = packageWithBody(
      '<w:p><w:pPr><w:widowControl w:val="0"/></w:pPr><w:r><w:t>' +
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen' +
        '</w:t></w:r></w:p>' +
        '<w:sectPr>' +
        '<w:pgSz w:w="7200" w:h="760"/>' +
        '<w:pgMar w:top="240" w:right="720" w:bottom="240" w:left="720"/>' +
        '<w:cols w:num="2" w:equalWidth="0">' +
        '<w:col w:w="1800" w:space="600"/><w:col w:w="3000"/>' +
        '</w:cols>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const firstPage = layout.pages[0]!;
    const fragments = firstPage.fragments.filter((fragment) => fragment.kind === 'paragraph');
    expect(fragments.map((fragment) => fragment.box.x)).toEqual([0, 120]);
    const lineTexts = fragments.map((fragment) =>
      fragment.lines[0]!.spans.map((span) => span.text).join('')
    );
    expect(lineTexts[1]!.length).toBeGreaterThan(lineTexts[0]!.length);
    expect(
      fragments[1]!.lines[0]!.spans.at(-1)!.box.x + fragments[1]!.lines[0]!.spans.at(-1)!.box.width
    ).toBeLessThanOrEqual(270);
  });

  test('an unchanged multi-column pass preserves physical page identity', () => {
    const part = packageWithBody(
      paragraph('one two three four five six seven eight nine ten') +
        '<w:sectPr><w:pgSz w:w="4800" w:h="1440"/>' +
        '<w:pgMar w:top="240" w:right="240" w:bottom="240" w:left="240"/>' +
        '<w:cols w:num="2" w:space="240"/></w:sectPr>'
    );
    const session = createLayoutSession();
    const options = { measurer: createFixedMeasurer(6, 14), session };

    const first = layoutSemanticDocument(part, 1, options);
    const second = layoutSemanticDocument(part, 2, options);

    expect(second.pages).toBe(first.pages);
    expect(session.stats.placed).toBe(0);
  });

  test('a two-column section ending in a continuous break balances across its columns', () => {
    // §17.6.4: the continuous break that ENDS the two-column section balances it. Page
    // content is 288pt wide; two columns of 138pt at x=0 and x=150.
    const part = packageWithBody(
      paragraph('INTRO') +
        '<w:p><w:pPr><w:sectPr>' +
        '<w:type w:val="continuous"/>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:space="240"/>' +
        '</w:sectPr></w:pPr></w:p>' +
        paragraph('ALPHA') +
        paragraph('BETA') +
        paragraph('GAMMA') +
        paragraph('DELTA') +
        '<w:p><w:pPr><w:sectPr>' +
        '<w:type w:val="continuous"/>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:space="240"/>' +
        '</w:sectPr></w:pPr></w:p>' +
        paragraph('TAIL') +
        '<w:sectPr>' +
        '<w:type w:val="continuous"/>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:space="240"/>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    expect(layout.pages).toHaveLength(1);
    const at = (text: string) =>
      layout.pages[0]!.fragments.find((fragment) => fragmentText(fragment) === text)!;
    // The empty section-mark paragraph takes no height before a continuous section, so four
    // lines balance 2/2 instead of stacking all four in column one.
    expect([at('ALPHA').box.x, at('BETA').box.x]).toEqual([0, 0]);
    expect([at('GAMMA').box.x, at('DELTA').box.x]).toEqual([150, 150]);
    expect(at('GAMMA').box.y).toBe(at('ALPHA').box.y);
    // The section after the balanced region resumes directly below the WHOLE region.
    expect(at('TAIL').box.x).toBe(0);
    expect(at('TAIL').box.y).toBeCloseTo(at('BETA').box.y + at('BETA').box.height, 3);
  });

  test('a page-positioned table does not stretch its balanced two-column section', () => {
    const floatingTable =
      '<w:tbl><w:tblPr>' +
      '<w:tblW w:w="1200" w:type="dxa"/>' +
      '<w:tblpPr w:horzAnchor="page" w:vertAnchor="page" w:tblpX="3600" w:tblpY="5000"/>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>' +
      `<w:tr><w:tc>${paragraph('FLOAT')}</w:tc></w:tr></w:tbl>`;
    const body = (floating: string): string =>
      paragraph('INTRO') +
      '<w:p><w:pPr><w:sectPr>' +
      '<w:type w:val="continuous"/>' +
      '<w:pgSz w:w="7200" w:h="7200"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
      '<w:cols w:space="240"/>' +
      '</w:sectPr></w:pPr></w:p>' +
      floating +
      paragraph('ALPHA') +
      paragraph('BETA') +
      paragraph('GAMMA') +
      paragraph('DELTA') +
      '<w:p><w:pPr><w:sectPr>' +
      '<w:type w:val="continuous"/>' +
      '<w:pgSz w:w="7200" w:h="7200"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
      '<w:cols w:num="2" w:space="240"/>' +
      '</w:sectPr></w:pPr></w:p>' +
      paragraph('TAIL') +
      '<w:sectPr><w:type w:val="continuous"/>' +
      '<w:pgSz w:w="7200" w:h="7200"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
      '<w:cols w:space="240"/></w:sectPr>';
    const coordinates = (floating: string) => {
      const layout = layoutSemanticDocument(packageWithBody(body(floating)), 1, {
        measurer: createFixedMeasurer(6, 14),
      });
      const textBoxes = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'TAIL'].map((text) => {
        const fragment = layout.pages[0]!.fragments.find((item) => fragmentText(item) === text)!;
        return { text, x: fragment.box.x, y: fragment.box.y };
      });
      return { layout, textBoxes };
    };

    const baseline = coordinates('');
    const floated = coordinates(floatingTable);
    const table = floated.layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');

    expect(table).toMatchObject({ kind: 'table', outOfFlow: true });
    expect(table!.box.y).toBeGreaterThan(floated.textBoxes.at(-1)!.y);
    expect(floated.textBoxes).toEqual(baseline.textBoxes);
  });

  test('the last section of the document does not balance', () => {
    const part = packageWithBody(
      paragraph('ALPHA') +
        paragraph('BETA') +
        paragraph('GAMMA') +
        paragraph('DELTA') +
        '<w:sectPr>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:space="240"/>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const fragments = layout.pages[0]!.fragments.filter(
      (fragment) => fragment.kind === 'paragraph'
    );
    expect(fragments.map((fragment) => fragment.box.x)).toEqual([0, 0, 0, 0]);
  });

  test('a table in a balanced section splits at a row boundary across columns', () => {
    // Two paragraphs per cell: one row is 25.45pt, so the pair cannot balance into a single
    // column and the split has to fall on the row boundary between them.
    const cell = (text: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(text)}${paragraph(`${text} CONT`)}</w:tc>`;
    const part = packageWithBody(
      paragraph('INTRO') +
        '<w:p><w:pPr><w:sectPr>' +
        '<w:type w:val="continuous"/>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:space="240"/>' +
        '</w:sectPr></w:pPr></w:p>' +
        '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="1380"/></w:tblGrid>' +
        `<w:tr>${cell('ROW ONE')}</w:tr>` +
        `<w:tr>${cell('ROW TWO')}</w:tr>` +
        '</w:tbl>' +
        '<w:p><w:pPr><w:sectPr>' +
        '<w:type w:val="continuous"/>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:space="240"/>' +
        '</w:sectPr></w:pPr></w:p>' +
        paragraph('TAIL') +
        '<w:sectPr>' +
        '<w:type w:val="continuous"/>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:space="240"/>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const tables = layout.pages[0]!.fragments.filter((fragment) => fragment.kind === 'table');
    expect(tables).toHaveLength(2);
    expect(tables.map((fragment) => Math.round(fragment.box.x))).toEqual([0, 150]);
    // Both fragments open at the shared-sheet column REGION top, below the INTRO section.
    // A continuation anchored at 0 stretched its box over the section above the region,
    // and the oversized invisible fragment swallowed pointer hits on that text.
    expect(tables[1]!.box.y).toBe(tables[0]!.box.y);
    expect(tables[0]!.box.y).toBeGreaterThan(0);
  });

  test('an unchanged balanced pass preserves physical page identity', () => {
    const part = packageWithBody(
      paragraph('ALPHA') +
        paragraph('BETA') +
        paragraph('GAMMA') +
        '<w:p><w:pPr><w:sectPr>' +
        '<w:type w:val="continuous"/>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:space="240"/>' +
        '</w:sectPr></w:pPr></w:p>' +
        paragraph('TAIL') +
        '<w:sectPr>' +
        '<w:pgSz w:w="7200" w:h="7200"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:space="240"/>' +
        '</w:sectPr>'
    );
    const session = createLayoutSession();
    const options = { measurer: createFixedMeasurer(6, 14), session };

    const first = layoutSemanticDocument(part, 1, options);
    const second = layoutSemanticDocument(part, 2, options);

    // A continuous section rebuilds its host sheet each pass, so top-level page identity
    // cannot hold here; the balanced geometry must, and the pass must place nothing —
    // the remembered balance limit early-exits without re-running the balance search.
    expect(second.pages).toEqual(first.pages);
    expect(session.stats.placed).toBe(0);
  });

  test('the comprehensive fixture puts section 19 after its column break in column two', () => {
    const loaded = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });

    const sectionPage = layout.pages.find((page) =>
      page.fragments.some((fragment) => fragmentText(fragment).includes('19. Multi-Column Layout'))
    );
    expect(sectionPage).toBeDefined();
    const heading = sectionPage!.fragments.find((fragment) =>
      fragmentText(fragment).includes('19. Multi-Column Layout')
    );
    const afterBreak = sectionPage!.fragments.find((fragment) =>
      fragmentText(fragment).includes('After Column Break:')
    );
    expect(heading?.box.x).toBeLessThan(200);
    expect(afterBreak?.box.x).toBeGreaterThan(200);
    // The break paragraph's empty remainder sits above "After Column Break" in column two,
    // so that text starts one line below the heading rather than flush with it.
    expect(afterBreak!.box.y).toBeGreaterThan(heading!.box.y);
    expect(
      (
        sectionPage as typeof sectionPage & {
          columnSeparators?: readonly unknown[];
        }
      )?.columnSeparators
    ).toHaveLength(1);
  });

  test('keepNext lookahead prices the group at the placed column width', () => {
    // Column 0 is 300pt (one line holds 50 chars); column 1 is 36pt (6 chars). The body
    // paragraph is 1 line at column 0's width but 2 at column 1's, so a lookahead that
    // measures at the prepass width (column 0) under-prices the group by one line.
    //
    // Content height is 145pt; the default 10pt run makes each line 12.73pt. Eleven filler
    // lines fill column 0; nine more leave column 1 at y=114.5 with 30.4pt free when the
    // heading arrives. The true group — the heading line plus the body's two
    // widow-controlled lines, 38.2pt — must move the heading; the under-priced 25.5pt
    // group left it stranded at the column bottom while the body opened the next page.
    const filler = Array.from({ length: 20 }, (_, index) => paragraph(`f${index}`)).join('');
    const part = packageWithBody(
      filler +
        '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>hh</w:t></w:r></w:p>' +
        paragraph('aaaa bbbb') +
        '<w:sectPr>' +
        '<w:pgSz w:w="8400" w:h="4340"/>' +
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '<w:cols w:num="2" w:equalWidth="0">' +
        '<w:col w:w="6000" w:space="240"/><w:col w:w="720"/>' +
        '</w:cols>' +
        '</w:sectPr>'
    );

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });

    const pageOf = (text: string): number =>
      layout.pages.findIndex((page) =>
        page.fragments.some((fragment) => fragmentText(fragment).includes(text))
      );
    // The filler ends on page one; the keep moves the heading WITH its paragraph.
    expect(layout.pages).toHaveLength(2);
    expect(pageOf('f19')).toBe(0);
    expect(pageOf('hh')).toBe(1);
    expect(pageOf('hh')).toBe(pageOf('aaaa'));
  });
});
