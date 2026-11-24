// A page- or margin-positioned table that reaches below the bottom margin breaks across pages
// in the body flow (`table-pinned-break.ts`). Letter page, 1in margins: the content box is
// 648pt tall and the bottom page edge sits at 720pt in content coordinates. Every line is an
// exact 12pt line, and cells have no margins or borders, so positions are whole lines. Layout
// runs in mode 15 unless a test says otherwise.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SECT =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
const EXACT =
  '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>';

function part(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const documentOf = (body: string) =>
  part(
    `<w:document xmlns:w="${W}"><w:body>${body}${SECT}</w:body></w:document>`,
    '/word/document.xml'
  );

const paragraph = (text: string) => `<w:p>${EXACT}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const paragraphs = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => paragraph(`${label} ${index}`)).join('');

interface TableShape {
  readonly tblpPr: string;
  readonly rows?: number;
  readonly lines?: number;
  readonly trPr?: string;
  readonly width?: number;
  /** Lines per row, by row index; rows past the list use `lines`. */
  readonly rowLines?: readonly number[];
}

function table({
  tblpPr,
  rows = 1,
  lines = 110,
  trPr = '',
  width = 9360,
  rowLines = [],
}: TableShape): string {
  const row = (index: number) =>
    `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${width}"/></w:tcPr>` +
    paragraphs(`row ${index} line`, rowLines[index] ?? lines) +
    '</w:tc></w:tr>';
  return (
    `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="${width}"/>` +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>` +
    Array.from({ length: rows }, (_, index) => row(index)).join('') +
    '</w:tbl>'
  );
}

/** `tblpY` 5957 twips (one twip of storage bias): 297.8pt from the page top, 225.8pt down the content box. */
const PAGE =
  '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="page" w:horzAnchor="margin" w:tblpY="5957"/>';
const lead = paragraphs('lead', 2);
const tail = paragraph('tail');

function layoutOf(body: string, options: Parameters<typeof layoutSemanticDocument>[2] = {}) {
  return layoutSemanticDocument(documentOf(body), 0, {
    measurer: createFixedMeasurer(),
    compatibilityMode: 15,
    ...options,
  });
}

function tableFragments(layout: SemanticLayout) {
  return layout.pages.flatMap((page, pageIndex) =>
    page.fragments
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .map((fragment) => ({ pageIndex, fragment }))
  );
}

function paragraphAt(layout: SemanticLayout, text: string) {
  for (const [pageIndex, page] of layout.pages.entries()) {
    const fragment = page.fragments.find(
      (item): item is ParagraphFragmentRecord =>
        item.kind === 'paragraph' &&
        item.lines.some((line) => line.spans.some((span) => span.text === text))
    );
    if (fragment) return { pageIndex, y: fragment.box.y };
  }
  throw new Error(`no paragraph ${text}`);
}

const shape = (layout: SemanticLayout) =>
  tableFragments(layout).map(({ pageIndex, fragment }) => [
    pageIndex,
    Math.round(fragment.box.y * 100) / 100,
    Math.round(fragment.box.height * 100) / 100,
  ]);

describe('a page-positioned table taller than the room below it', () => {
  test('starts where its leading part ends at the page edge and continues on later pages', () => {
    // Room below the cursor: 648 - 24 = 624, all 52 lines of the one row's leading part.
    // Top: min(authored 225.8, 720 - 624) = 96. The first fragment ends at the bottom margin.
    const layout = layoutOf(lead + table({ tblpPr: PAGE }) + tail);
    expect(shape(layout)).toEqual([
      [0, 96, 552],
      [1, 0, 648],
      [2, 0, 120],
    ]);
    for (const { fragment } of tableFragments(layout))
      expect(isOutOfFlowTableFragment(fragment)).toBe(false);
    expect(paragraphAt(layout, 'tail')).toEqual({ pageIndex: 2, y: 120 });
  });

  test('a margin anchor and bottom alignment place the table the same way', () => {
    const expected = shape(layoutOf(lead + table({ tblpPr: PAGE }) + tail));
    const margin = '<w:tblpPr w:vertAnchor="margin" w:horzAnchor="margin" w:tblpY="4001"/>';
    const bottom = '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpYSpec="bottom"/>';
    expect(shape(layoutOf(lead + table({ tblpPr: margin }) + tail))).toEqual(expected);
    expect(shape(layoutOf(lead + table({ tblpPr: bottom }) + tail))).toEqual(expected);
  });

  test('keeps its authored top when its box ends above the page edge', () => {
    // 40 lines end at 225.8 + 480 = 705.8: below the margin, above the page edge.
    const layout = layoutOf(lead + table({ tblpPr: PAGE, lines: 40 }) + tail);
    expect(shape(layout)).toEqual([
      [0, 225.8, 420],
      [1, 0, 60],
    ]);
    expect(paragraphAt(layout, 'tail')).toEqual({ pageIndex: 1, y: 60 });
  });

  test('opens the next page when its start would cover earlier body text', () => {
    // Twenty lead lines reach 240, below the 225.8 authored top: the table starts page 2 at
    // min(225.8, 720 - 648) = 72, and the lead stays alone on page 1.
    const layout = layoutOf(paragraphs('lead', 20) + table({ tblpPr: PAGE }) + tail);
    expect(shape(layout)).toEqual([
      [1, 72, 576],
      [2, 0, 648],
      [3, 0, 96],
    ]);
    expect(paragraphAt(layout, 'tail')).toEqual({ pageIndex: 3, y: 96 });
  });

  test('splits rows that cannot split, adds the bottom wrap distance after the last row', () => {
    const tblpPr = PAGE.replace('w:vertAnchor', 'w:bottomFromText="720" w:vertAnchor');
    const layout = layoutOf(
      lead + table({ tblpPr, rows: 30, lines: 4, trPr: '<w:cantSplit/>' }) + tail
    );
    const fragments = tableFragments(layout);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments[0]!.fragment.rows.at(-1)!.hasContinuation).toBe(true);
    const last = fragments.at(-1)!;
    const tailAt = paragraphAt(layout, 'tail');
    expect(tailAt.pageIndex).toBe(last.pageIndex);
    expect(tailAt.y).toBeCloseTo(last.fragment.box.y + last.fragment.box.height + 36, 6);
  });

  test('starts high enough for a tall header row to open on the anchor page', () => {
    // The 50-line header row cannot split. Placed by the leading part alone, it would start at
    // 720 - 600 = 120 and leave it 528 of band; the opening rule lifts the table to 648 - 612.
    const header = table({ tblpPr: PAGE, rows: 3, lines: 50 }).replace(
      '<w:tr><w:tc>',
      '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>'
    );
    const layout = layoutOf(lead + header + tail);
    const [first] = tableFragments(layout);
    expect(first!.pageIndex).toBe(0);
    expect(first!.fragment.box.y).toBeCloseTo(36, 6);
    expect(first!.fragment.rows[0]!.isHeaderRow).toBe(true);
    expect(first!.fragment.rows[1]!.hasContinuation).toBe(true);
  });

  test('a header row taller than the page band never lifts the table above the page', () => {
    const header = table({ tblpPr: PAGE, rows: 3, lines: 60 }).replace(
      '<w:tr><w:tc>',
      '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>'
    );
    const [first] = tableFragments(layoutOf(lead + header + tail));
    expect(first!.pageIndex).toBe(0);
    expect(first!.fragment.box.y).toBeGreaterThanOrEqual(24);
  });

  test('starts high enough for a nested table row, which moves whole, to open the table', () => {
    // A 600pt nested row opens the first cell. Its whole height bounds the start: 648 - 600.
    const nested = table({ tblpPr: '', lines: 50 });
    const outer = table({
      tblpPr: '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpY="9001"/>',
      rows: 2,
      lines: 60,
    }).replace('</w:tcPr>', `</w:tcPr>${nested}`);
    const [first] = shape(layoutOf(lead + outer + tail));
    expect(first).toEqual([0, 48, 600]);
  });

  test('moves a row whose minimum height does not fit to the next page', () => {
    // Four 150pt rows fit the room below the cursor, so the table starts at 720 - 600 = 120.
    // The first fragment ends at the bottom margin: the fourth row moves whole, 150pt kept.
    const atLeast = '<w:trHeight w:val="3000" w:hRule="atLeast"/>';
    const layout = layoutOf(
      lead + table({ tblpPr: PAGE, rows: 5, lines: 2, trPr: atLeast }) + tail
    );
    expect(shape(layout)).toEqual([
      [0, 120, 450],
      [1, 0, 300],
    ]);
    expect(paragraphAt(layout, 'tail')).toEqual({ pageIndex: 1, y: 300 });
  });

  test('a first row whose minimum ends below the margin opens the next page from mode 15', () => {
    // A 400pt first row is the leading part: the table starts at 720 - 400 = 320. Earlier
    // modes run the first fragment to the page edge and keep the row there; from mode 15 the
    // fragment ends at the margin, so the row moves to the next page.
    const atLeast = '<w:trHeight w:val="8000" w:hRule="atLeast"/>';
    const tblpPr = '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpY="9000"/>';
    const body = lead + table({ tblpPr, rows: 2, lines: 2, trPr: atLeast }) + tail;
    expect(shape(layoutOf(body, { compatibilityMode: 14 }))[0]).toEqual([0, 320, 400]);
    const modern = tableFragments(layoutOf(body)).filter(({ fragment }) => fragment.rows.length);
    expect(modern[0]!.pageIndex).toBe(1);
  });

  test('legacy modes run the first fragment to the page edge', () => {
    const layout = layoutOf(lead + table({ tblpPr: PAGE }) + tail, { compatibilityMode: 14 });
    expect(shape(layout)[0]).toEqual([0, 96, 624]);
  });

  test('the leading part counts the lines of the next row that fit below whole rows', () => {
    // 624pt of room below the cursor hold the 360pt first row and 22 lines of the second, so
    // the 624pt leading part ends at the page edge: the table starts at 720 - 624 = 96.
    const body = lead + table({ tblpPr: PAGE, rows: 2, rowLines: [30, 40] }) + tail;
    expect(shape(layoutOf(body, { compatibilityMode: 14 }))[0]).toEqual([0, 96, 624]);
    // From mode 15 the first part ends at the bottom margin: 552pt below the same top.
    expect(shape(layoutOf(body))[0]).toEqual([0, 96, 552]);
  });

  test('text after a narrow table wraps beside its last part', () => {
    const narrow = table({ tblpPr: PAGE, width: 4000 });
    const layout = layoutOf(lead + narrow + tail);
    const [last] = tableFragments(layout).slice(-1);
    expect(last!.fragment.floatingWrap).toBeDefined();
    expect(paragraphAt(layout, 'tail')).toEqual({ pageIndex: last!.pageIndex, y: 0 });
  });

  test('warm reuse matches a cold layout', () => {
    const document = documentOf(lead + table({ tblpPr: PAGE }) + tail);
    const options = { measurer: createFixedMeasurer(), compatibilityMode: 15 };
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    const cold = layoutSemanticDocument(document, 0, options);
    for (let pass = 0; pass < 2; pass++)
      expect(layoutSemanticDocument(document, 0, { ...options, session, cache }).pages).toEqual(
        cold.pages
      );
  });
});

describe('positioned tables that keep their sheet position', () => {
  const pinned = (layout: SemanticLayout) => {
    const fragments = tableFragments(layout);
    expect(fragments).toHaveLength(1);
    expect(isOutOfFlowTableFragment(fragments[0]!.fragment)).toBe(true);
    return fragments[0]!;
  };

  test('a table that ends above the bottom margin stays out of the flow', () => {
    const layout = layoutOf(lead + table({ tblpPr: PAGE, lines: 30 }) + tail);
    expect(pinned(layout).fragment.box.y).toBeCloseTo(225.8, 6);
    expect(paragraphAt(layout, 'tail')).toEqual({ pageIndex: 0, y: 24 });
  });

  test('exact-height rows, a text anchor, and the no-break compatibility option are unchanged', () => {
    const exact = '<w:trHeight w:val="12000" w:hRule="exact"/>';
    pinned(layoutOf(lead + table({ tblpPr: PAGE, lines: 3, trPr: exact }) + tail));
    const settings = part(
      `<w:settings xmlns:w="${W}"><w:compat><w:doNotBreakWrappedTables/></w:compat></w:settings>`,
      '/word/settings.xml'
    );
    const styleCascade = buildStyleCascadeTable(null, undefined, settings.root);
    expect(styleCascade.doNotBreakWrappedTables).toBe(true);
    pinned(layoutOf(lead + table({ tblpPr: PAGE }) + tail, { styleCascade }));
    const text = '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="1"/>';
    const flowing = tableFragments(layoutOf(lead + table({ tblpPr: text }) + tail));
    expect(flowing[0]!.fragment.box.y).toBeCloseTo(24, 6);
  });

  test('an anchor that keeps whole-table placement keeps it for a tall table', () => {
    const anchor = `<w:p><w:pPr><w:pageBreakBefore/>${EXACT.slice(7, -8)}</w:pPr><w:r><w:t>tail</w:t></w:r></w:p>`;
    pinned(layoutOf(lead + table({ tblpPr: PAGE }) + anchor));
  });

  test('one exact-height row taller than the page keeps the whole table pinned', () => {
    const exactRow = table({
      tblpPr: PAGE,
      lines: 1,
      trPr: '<w:trHeight w:val="14000" w:hRule="exact"/>',
    }).replace(/<\/w:tbl>$/, '');
    const ordinaryRow =
      '<w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="9360"/></w:tcPr>' +
      paragraphs('body', 5) +
      '</w:tc></w:tr></w:tbl>';
    pinned(layoutOf(lead + exactRow + ordinaryRow + tail));
  });

  test('legacy modes keep a table that ends above the page edge pinned', () => {
    // 40 lines end at 705.8: below the bottom margin, above the page edge.
    const layout = layoutOf(lead + table({ tblpPr: PAGE, lines: 40 }) + tail, {
      compatibilityMode: 14,
    });
    expect(pinned(layout).fragment.box.y).toBeCloseTo(225.8, 6);
    expect(paragraphAt(layout, 'tail')).toEqual({ pageIndex: 0, y: 24 });
  });

  test('content taller than the page band keeps the table pinned instead of failing', () => {
    const huge =
      '<w:p><w:pPr><w:spacing w:line="15000" w:lineRule="exact"/></w:pPr><w:r><w:t>huge</w:t></w:r></w:p>';
    const hugeLine = table({ tblpPr: PAGE, lines: 1 }).replace('</w:tc>', `${huge}</w:tc>`);
    pinned(layoutOf(lead + hugeLine + tail));
    const tallRow = '<w:trHeight w:val="14000" w:hRule="atLeast"/>';
    pinned(layoutOf(lead + table({ tblpPr: PAGE, lines: 1, trPr: tallRow }) + tail));
    const nested = table({ tblpPr: '', lines: 60, trPr: '<w:cantSplit/>' });
    const nestedRow = table({ tblpPr: PAGE, lines: 1 }).replace(
      '</w:tc>',
      `${nested}<w:p/></w:tc>`
    );
    pinned(layoutOf(lead + nestedRow + tail));
  });

  test('a table entirely outside the text column keeps its sheet position', () => {
    const margin =
      '<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="100" w:tblpY="1000"/>';
    pinned(layoutOf(lead + table({ tblpPr: margin, width: 1000, lines: 70 }) + tail));
  });
});
