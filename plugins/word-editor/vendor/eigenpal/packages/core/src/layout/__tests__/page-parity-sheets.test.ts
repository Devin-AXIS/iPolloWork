// Blank parity sheets between sections.
//
// An `oddPage` / `evenPage` section starts on a page whose DISPLAYED number has that parity,
// and under `w:evenAndOddHeaders` a section that restarts its numbering starts on a sheet whose
// continued number has the parity of its restarted number. When the next sheet has the wrong
// parity, layout inserts one blank sheet in front of the section. The blank sheet carries no
// body, header, footer or drawing. NUMPAGES counts it; SECTIONPAGES does not.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type LayoutSession,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import { hitTestSheet } from '../semantic-hit-test.ts';
import { moveCaret } from '../semantic-interaction.ts';
import { nearestPageWithStops } from '../caret-page-step.ts';
import { registerParityPlan, resettleParitySheets } from '../page-parity-sheet.ts';

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

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function sectPr(type?: string, start?: number): string {
  return (
    '<w:sectPr>' +
    (type ? `<w:type w:val="${type}"/>` : '') +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
    (start !== undefined ? `<w:pgNumType w:start="${start}"/>` : '') +
    '</w:sectPr>'
  );
}

/** A paragraph that ends a section. */
const ending = (text: string, type?: string, start?: number) =>
  `<w:p><w:pPr>${sectPr(type, start)}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function story(root: 'hdr' | 'ftr', body: string, name: string) {
  const part = readOoxmlPart(`<w:${root} xmlns:w="${W}">${body}</w:${root}>`, {
    name,
    contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${
      root === 'hdr' ? 'header' : 'footer'
    }+xml`,
  });
  if (!part.ok) throw new Error(part.reason);
  return layoutHeaderFooterStory(part.part, 400, measurer, name);
}

const field = (instr: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>0</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';

/** Odd and even headers plus a footer that prints PAGE, NUMPAGES and SECTIONPAGES. */
function furniture(evenAndOddHeaders: boolean): PageFurniture {
  const footer = story(
    'ftr',
    `<w:p><w:r><w:t xml:space="preserve">P</w:t></w:r>${field('PAGE')}` +
      `<w:r><w:t xml:space="preserve"> N</w:t></w:r>${field('NUMPAGES')}` +
      `<w:r><w:t xml:space="preserve"> S</w:t></w:r>${field('SECTIONPAGES')}</w:p>`,
    '/word/footer1.xml'
  );
  return {
    titlePage: false,
    evenAndOddHeaders,
    headers: new Map([
      ['default', story('hdr', p('ODD'), '/word/header1.xml')],
      ['even', story('hdr', p('EVEN'), '/word/header2.xml')],
    ]),
    footers: new Map([
      ['default', footer],
      ['even', footer],
    ]),
  };
}

function lay(
  body: string,
  options: { evenAndOdd?: boolean; furnished?: boolean; session?: LayoutSession } = {}
): SemanticLayout {
  const part = load(body);
  const furnished = options.furnished ?? options.evenAndOdd ?? false;
  const shared = furnished ? furniture(options.evenAndOdd === true) : undefined;
  return layoutSemanticDocument(part, 1, {
    measurer,
    ...(options.session ? { session: options.session } : {}),
    ...(shared ? { sectionFurniture: [shared, shared, shared, shared] } : {}),
  });
}

const bodyText = (page: SemanticLayout['pages'][number]): string =>
  page.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');

const storyText = (page: SemanticLayout['pages'][number], edge: 'header' | 'footer'): string =>
  (page[edge]?.fragments ?? [])
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');

/** Body text per sheet, with `|` for a blank parity sheet. */
const sheets = (layout: SemanticLayout): string[] =>
  layout.pages.map((page) => (page.parityBlank ? '|' : bodyText(page).replace(/\W/g, '')));

function expectBlank(page: SemanticLayout['pages'][number]): void {
  expect(page.parityBlank).toBe(true);
  expect(page.fragments).toHaveLength(0);
  expect(page.header).toBeUndefined();
  expect(page.footer).toBeUndefined();
  expect(page.anchoredDrawings).toBeUndefined();
  expect(page.pageBorders).toBeUndefined();
  expect(page.footnotes).toBeUndefined();
  expect(page.endnotes).toBeUndefined();
}

describe('oddPage and evenPage sections start on a displayed number of that parity', () => {
  test('oddPage after one page inserts a blank sheet that takes number 2', () => {
    const layout = lay(ending('First') + p('Second') + sectPr('oddPage'), { furnished: true });
    expect(sheets(layout)).toEqual(['First', '|', 'Second']);
    expectBlank(layout.pages[1]!);
    expect(layout.pages[2]!.pageFieldSource?.pageNumber).toBe(3);
    // NUMPAGES counts every sheet, the blank one too; the section count excludes it.
    expect(storyText(layout.pages[2]!, 'footer')).toBe('P3 N3 S1');
    expect(storyText(layout.pages[0]!, 'footer')).toBe('P1 N3 S1');
  });

  test('evenPage after one page needs no blank sheet', () => {
    const layout = lay(ending('First') + p('Second') + sectPr('evenPage'));
    expect(sheets(layout)).toEqual(['First', 'Second']);
  });

  test('oddPage after two pages needs no blank sheet', () => {
    const layout = lay(p('One') + pageBreak + ending('Two') + p('Second') + sectPr('oddPage'));
    expect(layout.pages.some((page) => page.parityBlank)).toBe(false);
    expect(layout.pages).toHaveLength(3);
  });

  test('evenPage after two pages inserts a blank sheet', () => {
    const layout = lay(p('One') + pageBreak + ending('Two') + p('Second') + sectPr('evenPage'));
    expect(sheets(layout).slice(-2)).toEqual(['|', 'Second']);
    expect(layout.pages).toHaveLength(4);
    expect(layout.pages[3]!.pageFieldSource?.pageNumber).toBe(4);
  });

  test('a restarted odd number satisfies oddPage without evenAndOddHeaders', () => {
    const layout = lay(ending('First') + p('Second') + sectPr('oddPage', 1));
    expect(sheets(layout)).toEqual(['First', 'Second']);
    expect(layout.pages[1]!.pageFieldSource?.pageNumber).toBe(1);
  });

  test('an empty final oddPage section still gets its blank parity sheet first', () => {
    const layout = lay(ending('First') + sectPr('oddPage'));
    expect(sheets(layout)).toEqual(['First', '|', '']);
    expect(layout.pages[2]!.parityBlank).toBeUndefined();
  });
});

describe('restarted numbering under evenAndOddHeaders aligns with continued numbering', () => {
  test('a restart at 1 on the second sheet inserts a blank sheet', () => {
    const layout = lay(ending('First', undefined, 1) + p('Second') + sectPr(undefined, 1), {
      evenAndOdd: true,
    });
    expect(sheets(layout)).toEqual(['First', '|', 'Second']);
    expectBlank(layout.pages[1]!);
    expect(layout.pages[2]!.pageFieldSource?.pageNumber).toBe(1);
    expect(storyText(layout.pages[2]!, 'header')).toBe('ODD');
    expect(storyText(layout.pages[2]!, 'footer')).toBe('P1 N3 S1');
  });

  test('the same restart without evenAndOddHeaders keeps two sheets', () => {
    const layout = lay(ending('First', undefined, 1) + p('Second') + sectPr(undefined, 1), {
      furnished: true,
    });
    expect(sheets(layout)).toEqual(['First', 'Second']);
  });

  test('a restart whose parity already matches the sheet needs no blank sheet', () => {
    const layout = lay(ending('First', undefined, 1) + p('Second') + sectPr(undefined, 2), {
      evenAndOdd: true,
    });
    expect(sheets(layout)).toEqual(['First', 'Second']);
    expect(storyText(layout.pages[1]!, 'header')).toBe('EVEN');
  });

  test('an oddPage restart followed by a nextPage restart inserts two blank sheets', () => {
    const layout = lay(
      ending('First', undefined, 1) +
        ending('Second', 'oddPage', 1) +
        p('Third') +
        sectPr(undefined, 1),
      { evenAndOdd: true }
    );
    expect(sheets(layout)).toEqual(['First', '|', 'Second', '|', 'Third']);
    expectBlank(layout.pages[1]!);
    expectBlank(layout.pages[3]!);
    expect(storyText(layout.pages[2]!, 'header')).toBe('ODD');
    expect(storyText(layout.pages[4]!, 'header')).toBe('ODD');
    expect(layout.pages.map((page) => page.index)).toEqual([0, 1, 2, 3, 4]);
    for (let index = 1; index < layout.pages.length; index += 1) {
      expect(layout.pages[index]!.box.y).toBeGreaterThan(layout.pages[index - 1]!.box.y);
    }
  });

  test('a continuous section never receives a blank sheet', () => {
    const layout = lay(ending('First', undefined, 1) + p('Second') + sectPr('continuous', 1), {
      evenAndOdd: true,
    });
    expect(layout.pages.some((page) => page.parityBlank)).toBe(false);
  });
});

describe('restarted numbering after an even initial number', () => {
  test.each([0, 2])('continues from initial %i to an odd restart without a blank', (start) => {
    const layout = lay(ending('First', undefined, start) + p('Second') + sectPr(undefined, 1), {
      evenAndOdd: true,
    });
    expect(sheets(layout)).toEqual(['First', 'Second']);
    expect(layout.pages.map((page) => page.pageFieldSource?.pageNumber)).toEqual([start, 1]);
    expect(storyText(layout.pages[1]!, 'footer')).toBe('P1 N2 S1');
    expect(storyText(layout.pages[0]!, 'header')).toBe('EVEN');
    expect(storyText(layout.pages[1]!, 'header')).toBe('ODD');
  });

  test('inserts a blank when an even restart differs from the continued odd number', () => {
    const layout = lay(ending('First', undefined, 0) + p('Second') + sectPr(undefined, 2), {
      evenAndOdd: true,
    });
    expect(sheets(layout)).toEqual(['First', '|', 'Second']);
    expectBlank(layout.pages[1]!);
    expect(layout.pages[2]!.pageFieldSource?.pageNumber).toBe(2);
  });

  test.each([
    [0, 'oddPage', 2, true, true],
    [0, 'evenPage', 1, true, false],
    [1, 'evenPage', 1, true, false],
    [1, 'oddPage', 2, true, true],
    [0, 'evenPage', 1, false, false],
    [0, 'oddPage', 2, false, false],
  ] as const)(
    'explicit break after %i: %s restart %i, alternating %s',
    (start, type, restart, evenAndOdd, blank) => {
      const layout = lay(ending('First', undefined, start) + p('Second') + sectPr(type, restart), {
        evenAndOdd,
        furnished: true,
      });
      expect(sheets(layout)).toEqual(blank ? ['First', '|', 'Second'] : ['First', 'Second']);
      expect(layout.pages.at(-1)!.pageFieldSource?.pageNumber).toBe(restart);
    }
  );

  test('save and reopen preserves numbering and parity', () => {
    const source = load(ending('First', undefined, 0) + p('Second') + sectPr(undefined, 1));
    const saved = serializeOoxmlPart(source);
    const reopened = readOoxmlPart(saved, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!reopened.ok) throw new Error(reopened.reason);
    const shared = furniture(true);
    const options = { measurer, sectionFurniture: [shared, shared] };
    const before = layoutSemanticDocument(source, 1, options);
    const after = layoutSemanticDocument(reopened.part, 1, options);
    expect(sheets(after)).toEqual(['First', 'Second']);
    expect(after.pages.map((page) => page.pageFieldSource?.pageNumber)).toEqual(
      before.pages.map((page) => page.pageFieldSource?.pageNumber)
    );
  });

  test('retained layout follows changes to the initial numbering', () => {
    const session = createLayoutSession();
    for (const start of [0, 1, 2, 0]) {
      const body = ending('First', undefined, start) + p('Second') + sectPr(undefined, 1);
      const retained = lay(body, { evenAndOdd: true, session });
      const fresh = lay(body, { evenAndOdd: true });
      expect(sheets(retained)).toEqual(sheets(fresh));
      expect(retained.pages.map((page) => page.header?.variant)).toEqual(
        fresh.pages.map((page) => page.header?.variant)
      );
      expect(retained.pages.map((page) => page.pageFieldSource?.pageNumber)).toEqual(
        fresh.pages.map((page) => page.pageFieldSource?.pageNumber)
      );
    }
  });
});

describe('NUMPAGES on reused sheets', () => {
  test('NUMPAGES stays the sheet count when a blank sheet replaces a numbered one', () => {
    const session = createLayoutSession();
    const two = p('One') + pageBreak + ending('Two') + p('Second') + sectPr('oddPage');
    // The same block count, so section 2's sheet is reused by identity.
    const one = p('One') + '<w:p/>' + ending('Two') + p('Second') + sectPr('oddPage');
    const before = lay(two, { session, furnished: true });
    expect(sheets(before)).toEqual(['One', 'Two', 'Second']);
    expect(storyText(before.pages[2]!, 'footer')).toBe('P3 N3 S1');
    const after = lay(one, { session, furnished: true });
    expect(sheets(after)).toEqual(['OneTwo', '|', 'Second']);
    expect(storyText(after.pages[2]!, 'footer')).toBe('P3 N3 S1');
    expect(storyText(after.pages[0]!, 'footer')).toBe('P1 N3 S1');
    // Fresh layout agrees with the retained one.
    const fresh = lay(one, { furnished: true });
    expect(after.pages.map((page) => storyText(page, 'footer'))).toEqual(
      fresh.pages.map((page) => storyText(page, 'footer'))
    );
  });
});

describe('parity after the notes pass inserts sheets', () => {
  const geometry = {
    width: 612,
    height: 792,
    margin: { top: 72, right: 72, bottom: 72, left: 72 },
  };
  const sheet = (
    index: number,
    pageNumber: number,
    extra: Partial<SemanticLayout['pages'][number]> = {}
  ): SemanticLayout['pages'][number] => ({
    id: `page-${index}`,
    index,
    box: { x: 0, y: 0, width: 612, height: 792 },
    contentBox: { x: 72, y: 72, width: 468, height: 648 },
    fragments: [],
    pageFieldSource: { pageNumber, sectionPageCount: 1 },
    ...extra,
  });
  const shape = (pages: readonly SemanticLayout['pages'][number][]) =>
    pages.map((page) => (page.parityBlank ? 'B' : page.pageFieldSource?.pageNumber));

  test('drops a blank sheet that an inserted sheet made unnecessary and renumbers', () => {
    const layout: SemanticLayout = { revision: 1, pages: [] } as unknown as SemanticLayout;
    registerParityPlan(
      layout,
      false,
      [
        { pageIndex: 0, breakType: 'nextPage', restart: undefined, runningBefore: 1, geometry },
        { pageIndex: 2, breakType: 'oddPage', restart: undefined, runningBefore: 2, geometry },
        { pageIndex: 4, breakType: 'continuous', restart: 7, runningBefore: 5, geometry },
      ],
      new Map()
    );
    const pages = [
      sheet(0, 1),
      sheet(1, 2, { noteStream: 'endnote-overflow' }),
      sheet(1, 0, { parityBlank: true, pageFieldSource: undefined }),
      sheet(2, 3),
      sheet(3, 4),
      // A continuous section's own sheet after its restarted host keeps its number.
      sheet(4, 8),
    ];
    expect(shape(resettleParitySheets(pages, layout))).toEqual([1, 2, 3, 4, 8]);
  });

  test('adds a blank sheet that an inserted sheet made necessary', () => {
    const layout: SemanticLayout = { revision: 1, pages: [] } as unknown as SemanticLayout;
    registerParityPlan(
      layout,
      true,
      [
        { pageIndex: 0, breakType: 'nextPage', restart: undefined, runningBefore: 1, geometry },
        { pageIndex: 2, breakType: 'oddPage', restart: undefined, runningBefore: 3, geometry },
        { pageIndex: 3, breakType: 'nextPage', restart: 1, runningBefore: 4, geometry },
      ],
      new Map()
    );
    const pages = [
      sheet(0, 1),
      sheet(1, 2),
      sheet(1, 3, { noteStream: 'endnote-overflow' }),
      sheet(2, 3),
      sheet(3, 1),
    ];
    const settled = resettleParitySheets(pages, layout);
    expect(shape(settled)).toEqual([1, 2, 3, 'B', 5, 'B', 1]);
    expect(settled[3]!.header).toBeUndefined();
  });

  test('a restart that ended on a shared sheet sets the running number', () => {
    const layout: SemanticLayout = { revision: 1, pages: [] } as unknown as SemanticLayout;
    // Sheet 0 hosts a continuous section restarted at 4, so the running number after it is 5.
    registerParityPlan(
      layout,
      false,
      [
        { pageIndex: 0, breakType: 'nextPage', restart: undefined, runningBefore: 1, geometry },
        { pageIndex: 1, breakType: 'oddPage', restart: undefined, runningBefore: 5, geometry },
      ],
      new Map([[0, 5]])
    );
    // A note sheet after the target moves nothing in front of it.
    const after = [sheet(0, 1), sheet(1, 5), sheet(1, 6, { noteStream: 'endnote-overflow' })];
    expect(shape(resettleParitySheets(after, layout))).toEqual([1, 5, 6]);
    // A note sheet on the shared sheet's far side takes 5, and the section moves to 7.
    const before = [sheet(0, 1), sheet(0, 2, { noteStream: 'endnote-overflow' }), sheet(1, 5)];
    expect(shape(resettleParitySheets(before, layout))).toEqual([1, 5, 'B', 7]);
  });

  test('notes preserve physical progression after a shared continuous restart', () => {
    const layout = { revision: 1, pages: [] } as unknown as SemanticLayout;
    registerParityPlan(
      layout,
      true,
      [
        { pageIndex: 0, breakType: 'nextPage', restart: 1, runningBefore: 1, geometry },
        { pageIndex: 2, breakType: 'nextPage', restart: 1, runningBefore: 2, geometry },
      ],
      new Map([[1, 2]])
    );
    expect(shape(resettleParitySheets([sheet(0, 1), sheet(1, 2), sheet(2, 1)], layout))).toEqual([
      1, 2, 1,
    ]);
    expect(
      shape(
        resettleParitySheets(
          [sheet(0, 1), sheet(1, 2), sheet(1, 2, { noteStream: 'endnote-overflow' }), sheet(2, 1)],
          layout
        )
      )
    ).toEqual([1, 2, 2, 'B', 1]);
  });

  test('an inserted note sheet changes parity after an even initial number', () => {
    const layout = { revision: 1, pages: [] } as unknown as SemanticLayout;
    registerParityPlan(
      layout,
      true,
      [
        { pageIndex: 0, breakType: 'nextPage', restart: 0, runningBefore: 1, geometry },
        { pageIndex: 1, breakType: 'nextPage', restart: 1, runningBefore: 1, geometry },
      ],
      new Map()
    );
    expect(shape(resettleParitySheets([sheet(0, 0), sheet(1, 1)], layout))).toEqual([0, 1]);
    const inserted = [sheet(0, 0), sheet(0, 1, { noteStream: 'endnote-overflow' }), sheet(1, 1)];
    expect(shape(resettleParitySheets(inserted, layout))).toEqual([0, 1, 'B', 1]);
  });

  test('a layout without a plan is returned as it is', () => {
    const pages = [sheet(0, 1)];
    const layout = { revision: 1, pages } as unknown as SemanticLayout;
    expect(resettleParitySheets(pages, layout)).toBe(pages);
  });
});

describe('parity after an unrestarted continuous section', () => {
  // Section 2 is continuous: it shares sheet 1, or fills it and overflows `extra` lines.
  const lines = (count: number) =>
    Array.from({ length: count }, (_, index) => p(`B${index}`)).join('');
  const body = (bodyLines: number, type: 'oddPage' | 'evenPage') =>
    ending('A') + lines(bodyLines) + ending('B', 'continuous') + p('C') + sectPr(type);
  const numbers = (layout: SemanticLayout) =>
    layout.pages.map((page) => (page.parityBlank ? '|' : page.pageFieldSource?.pageNumber));
  const lastIsC = (layout: SemanticLayout) =>
    expect(bodyText(layout.pages[layout.pages.length - 1]!)).toBe('C');

  test('evenPage after a merged continuous section starts on page 2 without a blank', () => {
    const layout = lay(body(0, 'evenPage'));
    expect(numbers(layout)).toEqual([1, 2]);
    lastIsC(layout);
  });

  test('oddPage after a merged continuous section gets its blank sheet', () => {
    const layout = lay(body(0, 'oddPage'));
    expect(numbers(layout)).toEqual([1, '|', 3]);
    lastIsC(layout);
  });

  test('oddPage after a continuous section with one overflow sheet needs no blank', () => {
    const layout = lay(body(60, 'oddPage'));
    expect(numbers(layout)).toEqual([1, 2, 3]);
    lastIsC(layout);
  });

  test('evenPage after a continuous section with one overflow sheet gets its blank sheet', () => {
    const layout = lay(body(60, 'evenPage'));
    expect(numbers(layout)).toEqual([1, 2, '|', 4]);
    lastIsC(layout);
  });

  test('retained layout agrees with a fresh layout when the overflow comes and goes', () => {
    const session = createLayoutSession();
    const shape = (layout: SemanticLayout) =>
      layout.pages.map((page) => [
        page.parityBlank === true,
        page.pageFieldSource?.pageNumber,
        page.box.y,
      ]);
    for (const bodyLines of [0, 60, 0]) {
      const retained = lay(body(bodyLines, 'oddPage'), { session });
      expect(shape(retained)).toEqual(shape(lay(body(bodyLines, 'oddPage'))));
    }
  });
});

describe('PageDown and PageUp across a blank parity sheet', () => {
  // Three sheets on each side of the blank sheet: [A0 A1 A2 | S0 S1 S2].
  const body =
    p('A0') +
    pageBreak +
    p('A1') +
    pageBreak +
    ending('A2') +
    p('S0') +
    pageBreak +
    p('S1') +
    pageBreak +
    p('S2') +
    sectPr('oddPage');
  const at = (layout: SemanticLayout, text: string) => {
    const page = layout.pages.find((candidate) => bodyText(candidate).startsWith(text))!;
    const fragment = page.fragments.find((candidate) => candidate.kind === 'paragraph')!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
    return { paragraphId: fragment.paragraphId, offset: 0 };
  };
  const landing = (layout: SemanticLayout, position: { paragraphId: string }) =>
    bodyText(
      layout.pages.find((page) =>
        page.fragments.some(
          (fragment) =>
            fragment.kind === 'paragraph' && fragment.paragraphId === position.paragraphId
        )
      )!
    ).replace(/\W/g, '');

  test('steps over the blank sheet to the next and previous sheet with text', () => {
    const layout = lay(body);
    expect(sheets(layout)).toEqual(['A0', 'A1', 'A2', '|', 'S0', 'S1', 'S2']);
    const down = moveCaret(layout, at(layout, 'A2'), 'pageDown');
    expect(landing(layout, down!.position)).toBe('S0');
    const up = moveCaret(layout, at(layout, 'S0'), 'pageUp');
    expect(landing(layout, up!.position)).toBe('A2');
  });

  test('the page step skips every sheet without stops in either direction', () => {
    const stops = [0, 0, 1, 4, 4, 6].map((pageIndex) => ({ pageIndex }));
    expect(nearestPageWithStops(stops, 1, 1)).toBe(4);
    expect(nearestPageWithStops(stops, 4, -1)).toBe(1);
    expect(nearestPageWithStops(stops, 6, 1)).toBeUndefined();
    expect(nearestPageWithStops(stops, 0, -1)).toBeUndefined();
  });

  test('the document edges still answer past the first and last sheet', () => {
    const layout = lay(body);
    expect(landing(layout, moveCaret(layout, at(layout, 'S2'), 'pageDown')!.position)).toBe('S2');
    expect(landing(layout, moveCaret(layout, at(layout, 'A0'), 'pageUp')!.position)).toBe('A0');
  });
});

describe('editing around a blank parity sheet', () => {
  test.each([
    ['top', 5, 'end of the text before it'],
    ['middle above half', 250, 'end of the text before it'],
    ['middle below half', 400, 'start of the text after it'],
    ['bottom', 640, 'start of the text after it'],
  ] as const)('a press at the %s of the blank sheet (y %d) lands at the %s', (_label, y, where) => {
    const first = Array.from({ length: 12 }, (_, index) => p(`A${index}`)).join('');
    const layout = lay(first + ending('Aend') + p('Second') + sectPr('oddPage'));
    expect(sheets(layout)).toEqual([expect.any(String), '|', 'Second']);
    const blank = layout.pages[1]!;
    const hit = hitTestSheet(layout, { x: blank.contentBox.x + 10, y: blank.contentBox.y + y });
    const paragraphOf = (pageIndex: number, pick: 'first' | 'last') => {
      const paragraphs = layout.pages[pageIndex]!.fragments.filter(
        (fragment) => fragment.kind === 'paragraph'
      );
      const fragment = pick === 'first' ? paragraphs[0]! : paragraphs[paragraphs.length - 1]!;
      return fragment.kind === 'paragraph' ? fragment.paragraphId : '';
    };
    if (where === 'end of the text before it') {
      expect(hit!.pageIndex).toBe(0);
      expect(hit!.position).toEqual({ paragraphId: paragraphOf(0, 'last'), offset: 4 });
    } else {
      expect(hit!.pageIndex).toBe(2);
      expect(hit!.position).toEqual({ paragraphId: paragraphOf(2, 'first'), offset: 0 });
    }
  });

  test('incremental passes agree with a fresh layout when the parity changes', () => {
    const session = createLayoutSession();
    const one = ending('First') + p('Second') + sectPr('oddPage');
    const two = p('One') + pageBreak + ending('Two') + p('Second') + sectPr('oddPage');
    expect(sheets(lay(one, { session }))).toEqual(['First', '|', 'Second']);
    const grown = lay(two, { session });
    expect(sheets(grown)).toEqual(sheets(lay(two)));
    expect(grown.pages.some((page) => page.parityBlank)).toBe(false);
    const back = lay(one, { session });
    expect(sheets(back)).toEqual(['First', '|', 'Second']);
    expect(back.pages.map((page) => page.box)).toEqual(lay(one).pages.map((page) => page.box));
    // A no-change pass keeps the blank sheet by identity.
    const again = lay(one, { session });
    expect(again.pages[1]).toBe(back.pages[1]!);
  });
});

describe('continuous restarts preserve sheet parity', () => {
  test.each([false, true])('shared restart with overflow %s', (overflow) => {
    const body =
      p('One') +
      pageBreak +
      ending('Two', undefined, 1) +
      (overflow ? p('Shared') + pageBreak : '') +
      ending('Continued', 'continuous', 1) +
      p('Final') +
      sectPr(undefined, 1);
    const session = createLayoutSession();
    for (let pass = 0; pass < 2; pass++) {
      const layout = lay(body, { evenAndOdd: true, session });
      expect(sheets(layout)).toEqual(
        overflow
          ? ['One', 'TwoShared', 'Continued', '|', 'Final']
          : ['One', 'TwoContinued', 'Final']
      );
      expect(layout.pages.at(-1)?.pageFieldSource?.pageNumber).toBe(1);
    }
    const reopened = serializeOoxmlPart(load(body));
    const parsed = readOoxmlPart(reopened, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(
      layoutSemanticDocument(parsed.part, 2, { measurer, evenAndOddHeaders: true }).pages.length
    ).toBe(overflow ? 5 : 3);
  });

  test('ordinary restarts retain the numbering after an explicit restarted break', () => {
    const body =
      ending('One', undefined, 1) +
      ending('Two', 'evenPage', 1) +
      p('Final') +
      sectPr(undefined, 1);
    const layout = lay(body, { evenAndOdd: true });
    expect(sheets(layout)).toEqual(['One', 'Two', '|', 'Final']);
    expect(layout.pages.map((page) => page.pageFieldSource?.pageNumber)).toEqual([
      1,
      1,
      undefined,
      1,
    ]);
  });

  test('an explicit even restart uses physical sheet parity after an even initial number', () => {
    const layout = lay(
      p('One') +
        pageBreak +
        p('Two') +
        pageBreak +
        ending('Three', undefined, 916) +
        p('Final') +
        sectPr('evenPage', 916),
      { evenAndOdd: true }
    );
    expect(sheets(layout)).toEqual(['One', 'Two', 'Three', 'Final']);
    expect(layout.pages.at(-1)?.pageFieldSource?.pageNumber).toBe(916);
  });
});
