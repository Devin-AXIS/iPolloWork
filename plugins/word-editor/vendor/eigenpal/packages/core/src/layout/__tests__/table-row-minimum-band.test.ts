// A row with an `atLeast` minimum where the table meets a header picture's wrap band.
//
// The band is not content. When a fragment opens below the band in a column that holds nothing
// else, the row starts there even when its minimum is taller than the room left. A move would
// only open the row at the same place on a page that repeats the band, and leave this page
// blank. Content above the row keeps the ordinary rule: an authored row or a paragraph above it
// still moves the row to the next page or column.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type LayoutSession,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import {
  layoutContext,
  load as loadDrawingPart,
  squareAnchorAtLeft,
} from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const EMU_PER_PT = 12700;
const HEADER = '/word/header1.xml';

type Story = ReturnType<typeof layoutHeaderFooterStory>;
type Fragment = SemanticLayout['pages'][number]['fragments'][number];
type TableFragment = Extract<Fragment, { kind: 'table' }>;
type LayoutCache = NonNullable<Parameters<typeof layoutSemanticDocument>[2]>['cache'];

/** A header whose only content is a 150pt square-wrap picture at page (390, `pageY`). */
function pictureHeader(pageY: number): Story {
  const xml = squareAnchorAtLeft({ text: '' })
    .replace('<w:document ', '<w:hdr ')
    .replace('<w:body>', '')
    .replace('</w:body></w:document>', '</w:hdr>')
    .replace(
      'relativeFrom="column"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${390 * EMU_PER_PT}`
    )
    .replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${pageY * EMU_PER_PT}`
    )
    .replaceAll('cx="1828800"', `cx="${150 * EMU_PER_PT}"`)
    .replaceAll('cy="914400"', `cy="${150 * EMU_PER_PT}"`);
  const part = loadDrawingPart(xml, HEADER);
  return layoutHeaderFooterStory(
    part,
    468,
    measurer,
    HEADER,
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    undefined,
    layoutContext(part, HEADER),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 72,
      marginBottom: 72,
    }
  );
}

/** Band at content y -52..98, across the right part of a full-width table. */
const TOP_BAND = 20;
/** Band at content y 228..378. */
const MID_BAND = 300;

const SECT_BODY =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';
const SECT = `<w:sectPr>${SECT_BODY}</w:sectPr>`;
/** Two 216pt columns with a 36pt gap, continuing the sheet the section before it filled. */
const CONTINUOUS_TWO_COLUMNS =
  `<w:sectPr><w:type w:val="continuous"/>${SECT_BODY}` +
  '<w:cols w:num="2" w:space="720"/></w:sectPr>';

const paragraph = (text: string, lineTwips = 280) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  `<w:spacing w:before="0" w:after="0" w:line="${lineTwips}" w:lineRule="exact"/></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

interface RowSpec {
  readonly label: string;
  /** `atLeast` minimum in points. */
  readonly minimum?: number;
  readonly header?: boolean;
  /** One-line paragraphs in the first cell. */
  readonly lines?: number;
}

/** A fixed two-column table, `width` twips wide, with zero cell margins. */
function table(rows: readonly RowSpec[], width = 9360): string {
  const half = width / 2;
  const cell = (texts: readonly string[]) =>
    `<w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr>` +
    `${texts.map((text) => paragraph(text)).join('')}</w:tc>`;
  const row = (spec: RowSpec) => {
    const properties =
      (spec.header ? '<w:tblHeader/>' : '') +
      (spec.minimum ? `<w:trHeight w:val="${spec.minimum * 20}" w:hRule="atLeast"/>` : '');
    const lines = Array.from({ length: spec.lines ?? 3 }, (_, i) => `${spec.label}-${i + 1}`);
    return (
      `<w:tr>${properties ? `<w:trPr>${properties}</w:trPr>` : ''}` +
      `${cell(lines)}${cell([spec.label])}</w:tr>`
    );
  };
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${half}"/><w:gridCol w:w="${half}"/></w:tblGrid>` +
    `${rows.map(row).join('')}</w:tbl>`
  );
}

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

interface Furniture {
  readonly titlePage?: boolean;
  readonly evenAndOddHeaders?: boolean;
  /** Header variants that show the picture, each at its page y. */
  readonly headers: Partial<Record<'default' | 'first' | 'even', number>>;
}

function furniture(spec: Furniture): PageFurniture {
  const headers = new Map<'default' | 'first' | 'even', Story>();
  for (const variant of ['default', 'first', 'even'] as const) {
    const pageY = spec.headers[variant];
    if (pageY !== undefined) headers.set(variant, pictureHeader(pageY));
  }
  return {
    titlePage: spec.titlePage ?? false,
    evenAndOddHeaders: spec.evenAndOddHeaders ?? false,
    headers: headers as PageFurniture['headers'],
    footers: new Map(),
  };
}

interface LayOptions {
  readonly mode?: number;
  readonly sections?: number;
  readonly session?: LayoutSession;
  readonly cache?: LayoutCache;
  readonly revision?: number;
}

function lay(body: string, spec: Furniture, options: LayOptions = {}): SemanticLayout {
  const pageFurniture = furniture(spec);
  return layoutSemanticDocument(load(body), options.revision ?? 1, {
    measurer,
    sectionFurniture: Array.from({ length: options.sections ?? 1 }, () => pageFurniture),
    compatibilityMode: options.mode ?? 15,
    ...(options.session ? { session: options.session } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
  });
}

const tablesOn = (layout: SemanticLayout, page: number): TableFragment[] =>
  (layout.pages[page]?.fragments ?? []).filter(
    (fragment): fragment is TableFragment => fragment.kind === 'table'
  );

/** Text of the first line in the first cell of each row, with the row's column and top. */
function rowsOf(layout: SemanticLayout): string[] {
  const out: string[] = [];
  layout.pages.forEach((page, index) => {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      for (const row of fragment.rows) {
        const first = row.cells[0]?.blocks[0];
        const line = first && 'lines' in first ? first.lines[0] : undefined;
        const text = line?.spans.map((span) => span.text).join('') ?? '';
        const repeat = row.isHeaderRepeat ? 'repeat ' : '';
        out.push(`p${index + 1} x${fragment.box.x} ${repeat}${text}@${row.box.y}`);
      }
    }
  });
  return out;
}

/** Pages up to the table's last. The empty paragraph the body reads after it may take one more. */
function pagesThroughTable(layout: SemanticLayout): number {
  return (
    layout.pages.findLastIndex((page) =>
      page.fragments.some((fragment) => fragment.kind === 'table')
    ) + 1
  );
}

/** Where the first line of row `label` lands: page, column left, and top. */
function start(layout: SemanticLayout, label: string): string | undefined {
  return rowsOf(layout).find((row) => row.split(' ').at(-1)!.startsWith(`${label}-1@`));
}

const ROWS_AFTER = [{ label: 'R1' }, { label: 'R2' }];
const MODES = [14, 15];

describe('a row minimum below a header picture that repeats on every page', () => {
  for (const mode of MODES) {
    test(`a first row starts below a mid-page band, not on the next page (mode ${mode})`, () => {
      const layout = lay(
        table([{ label: 'M', minimum: 400 }, ...ROWS_AFTER]) + SECT,
        { headers: { default: MID_BAND } },
        { mode }
      );
      expect(start(layout, 'M')).toBe('p1 x0 M-1@378');
    });

    test(`a first row starts below a top band, not on the next page (mode ${mode})`, () => {
      const layout = lay(
        table([{ label: 'M', minimum: 560 }, ...ROWS_AFTER]) + SECT,
        { headers: { default: TOP_BAND } },
        { mode }
      );
      expect(start(layout, 'M')).toBe('p1 x0 M-1@98');
    });
  }

  test('a table after a page break starts below the band on that page', () => {
    const layout = lay(
      paragraph('P1') + PAGE_BREAK + table([{ label: 'M', minimum: 560 }]) + SECT,
      { headers: { default: TOP_BAND } }
    );
    expect(start(layout, 'M')).toBe('p2 x0 M-1@98');
    expect(pagesThroughTable(layout)).toBe(2);
  });

  test('two tall rows leave no blank page before the table', () => {
    const layout = lay(
      table([
        { label: 'A', minimum: 560 },
        { label: 'B', minimum: 560 },
      ]) + SECT,
      { headers: { default: TOP_BAND } }
    );
    expect(start(layout, 'A')).toBe('p1 x0 A-1@98');
    // The second row still moves: the first row is content above it.
    expect(start(layout, 'B')).toBe('p2 x0 B-1@98');
    expect(pagesThroughTable(layout)).toBe(2);
  });
});

describe('a row minimum below distinct first and even page headers', () => {
  test('the first-page header band keeps the row on the first page', () => {
    const layout = lay(table([{ label: 'M', minimum: 560 }, ...ROWS_AFTER]) + SECT, {
      titlePage: true,
      headers: { first: TOP_BAND, default: TOP_BAND },
    });
    expect(start(layout, 'M')).toBe('p1 x0 M-1@98');
  });

  test('the even-page header band keeps the row on the even page', () => {
    const layout = lay(
      paragraph('P1') + PAGE_BREAK + table([{ label: 'M', minimum: 560 }]) + SECT,
      { evenAndOddHeaders: true, headers: { default: TOP_BAND, even: TOP_BAND } }
    );
    expect(start(layout, 'M')).toBe('p2 x0 M-1@98');
    expect(pagesThroughTable(layout)).toBe(2);
  });
});

describe('a row minimum with content above it below the band', () => {
  for (const mode of MODES) {
    test(`an authored header row stays on the first page and the row moves (mode ${mode})`, () => {
      const layout = lay(
        table([{ label: 'H', header: true }, { label: 'M', minimum: 560 }, ...ROWS_AFTER]) + SECT,
        { headers: { default: TOP_BAND } },
        { mode }
      );
      expect(rowsOf(layout).filter((row) => row.startsWith('p1 '))).toEqual(['p1 x0 H-1@98']);
      expect(start(layout, 'M')?.startsWith('p2 ')).toBe(true);
    });
  }

  test('paragraphs and an authored header row stay on the first page (mode 14)', () => {
    const layout = lay(
      paragraph('P1') +
        paragraph('P2') +
        table([{ label: 'H', header: true }, { label: 'M', minimum: 540 }, ...ROWS_AFTER]) +
        SECT,
      { headers: { default: TOP_BAND } },
      { mode: 14 }
    );
    expect(tablesOn(layout, 0)).toHaveLength(1);
    expect(rowsOf(layout).filter((row) => row.startsWith('p1 '))).toEqual(['p1 x0 H-1@98']);
    expect(start(layout, 'M')?.startsWith('p2 ')).toBe(true);
  });

  test('a continuous two-column section moves the row to a next column clear of the band', () => {
    // The first section fills the sheet to 100pt. The band crosses only the second column.
    const filler = paragraph('S', 2000).replace(
      '</w:pPr>',
      `<w:sectPr>${SECT_BODY}</w:sectPr></w:pPr>`
    );
    const rows = Array.from({ length: 40 }, (_, i) => ({ label: `r${i + 1}`, lines: 1 }));
    const layout = lay(
      filler +
        table([...rows, { label: 'M', minimum: 300 }, ...ROWS_AFTER], 4320) +
        CONTINUOUS_TWO_COLUMNS,
      { headers: { default: MID_BAND } },
      { sections: 2 }
    );
    expect(start(layout, 'r40')).toBe('p1 x252 r40-1@378');
    expect(start(layout, 'M')).toBe('p2 x0 M-1@0');
    const moved = tablesOn(layout, 1)[0]!.rows[0]!;
    expect(moved.box.height).toBe(300);
  });
});

describe('an incremental pass', () => {
  const body = (label: string) =>
    table([
      { label: `${label}A`, minimum: 560 },
      { label: `${label}B`, minimum: 560 },
    ]) + SECT;

  test('places the rows below the band as a cold pass does', () => {
    const spec: Furniture = { headers: { default: TOP_BAND } };
    const session = createLayoutSession();
    const cache: LayoutCache = createParagraphLayoutCache();
    lay(body('Y'), spec, { session, cache, revision: 1 });
    const warm = lay(body('X'), spec, { session, cache, revision: 2 });
    const cold = lay(body('X'), spec);
    expect(rowsOf(warm)).toEqual(rowsOf(cold));
    expect(start(warm, 'XA')).toBe('p1 x0 XA-1@98');
  });
});
