// A top-level table row does not wrap its cell text beside a float that crosses the table. The
// row moves below the float's wrap band, with the rows after it, on the first page and on every
// continuation page. Paragraphs still wrap beside the same float, and a table that stays clear
// of the float horizontally does not move.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
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

interface Picture {
  /** Page x of the picture's left edge. */
  readonly x: number;
  /** Page y of the picture's top edge. */
  readonly y: number;
  readonly size: number;
  readonly wrap?: 'square' | 'topAndBottom' | 'none' | 'tightTopHalf';
  readonly distB?: number;
  readonly distL?: number;
}

/** A header whose only content is one picture anchored to page coordinates. */
function pictureHeader(picture: Picture): Story {
  let xml = squareAnchorAtLeft({ text: '' })
    .replace('<w:document ', '<w:hdr ')
    .replace('<w:body>', '')
    .replace('</w:body></w:document>', '</w:hdr>')
    .replace(
      'relativeFrom="column"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${picture.x * EMU_PER_PT}`
    )
    .replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${picture.y * EMU_PER_PT}`
    )
    .replaceAll('cx="1828800"', `cx="${picture.size * EMU_PER_PT}"`)
    .replaceAll('cy="914400"', `cy="${picture.size * EMU_PER_PT}"`);
  if (picture.distB !== undefined)
    xml = xml.replaceAll('distB="0" distL="0"', `distB="${picture.distB * EMU_PER_PT}" distL="0"`);
  if (picture.distL !== undefined)
    xml = xml.replaceAll('distL="0"', `distL="${picture.distL * EMU_PER_PT}"`);
  if (picture.wrap === 'topAndBottom')
    xml = xml.replace(/<wp:wrapSquare [^>]*\/>/, '<wp:wrapTopAndBottom/>');
  if (picture.wrap === 'none') xml = xml.replace(/<wp:wrapSquare [^>]*\/>/, '<wp:wrapNone/>');
  if (picture.wrap === 'tightTopHalf')
    xml = xml.replace(
      /<wp:wrapSquare [^>]*\/>/,
      '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/>' +
        '<wp:lineTo x="0" y="10800"/><wp:lineTo x="21600" y="10800"/><wp:lineTo x="21600" y="0"/>' +
        '<wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>'
    );
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

const SECT =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
  '</w:sectPr>';
/** Two 216pt columns with a 36pt gap. */
const TWO_COLUMNS = SECT.replace('</w:sectPr>', '<w:cols w:num="2" w:space="720"/></w:sectPr>');

const paragraph = (text: string) =>
  `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const cell = (width: number, texts: readonly string[], properties = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${properties}</w:tcPr>` +
  `${texts.map(paragraph).join('')}</w:tc>`;

interface TableOptions {
  readonly rows: number;
  /** Total width in twips, split over two equal columns. */
  readonly width?: number;
  readonly headerRow?: boolean;
  readonly cantSplit?: boolean;
  /** One-line paragraphs in each body row's first cell. */
  readonly linesPerRow?: number;
  /** First and last body row of a vertical merge in the second column. */
  readonly merge?: readonly [number, number];
}

function table(options: TableOptions): string {
  const width = options.width ?? 9360;
  const half = width / 2;
  const rowXml = (index: number, header: boolean) => {
    const properties =
      (header ? '<w:tblHeader/>' : '') + (options.cantSplit && !header ? '<w:cantSplit/>' : '');
    const label = header ? 'head' : `r${index}`;
    const lines = Array.from({ length: header ? 1 : (options.linesPerRow ?? 1) }, () => label);
    const [first, last] = options.merge ?? [0, -1];
    const merged = !header && index >= first && index <= last;
    const mergeXml = merged ? `<w:vMerge${index === first ? ' w:val="restart"' : ''}/>` : '';
    return (
      `<w:tr>${properties ? `<w:trPr>${properties}</w:trPr>` : ''}` +
      cell(half, lines) +
      cell(half, merged && index !== first ? [''] : [label], mergeXml) +
      '</w:tr>'
    );
  };
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${half}"/><w:gridCol w:w="${half}"/></w:tblGrid>` +
    (options.headerRow ? rowXml(0, true) : '') +
    Array.from({ length: options.rows }, (_unused, index) => rowXml(index + 1, false)).join('') +
    '</w:tbl>'
  );
}

function load(body: string, sect = SECT): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${sect}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function lay(
  body: string,
  header?: Story,
  compatibilityMode?: number,
  sect = SECT
): SemanticLayout {
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(header ? [['default', header]] : []) as PageFurniture['headers'],
    footers: new Map(),
  };
  return layoutSemanticDocument(load(body, sect), 1, {
    measurer,
    sectionFurniture: [furniture],
    ...(compatibilityMode ? { compatibilityMode } : {}),
  });
}

function tablesOn(layout: SemanticLayout, page: number): TableFragment[] {
  return layout.pages[page]!.fragments.filter(
    (fragment): fragment is TableFragment => fragment.kind === 'table'
  );
}

/** Rows follow each other with no gap inside the fragment. */
function expectContiguous(fragment: TableFragment): void {
  for (let index = 1; index < fragment.rows.length; index += 1) {
    const above = fragment.rows[index - 1]!.box;
    expect(fragment.rows[index]!.box.y).toBeCloseTo(above.y + above.height, 3);
  }
}

/** The one square picture every case uses: page x 390..540, page y 20..170 (content -52..98). */
const RIGHT_LOGO: Picture = { x: 390, y: 20, size: 150 };
const LOGO_BOTTOM = 98;

describe('a table that crosses a wrapping float', () => {
  test('starts below the header picture on the first page', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader(RIGHT_LOGO));
    const [fragment] = tablesOn(layout, 0);
    expect(fragment!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    expect(fragment!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  test('continues below the header picture on every continuation page', () => {
    const layout = lay(table({ rows: 90 }), pictureHeader(RIGHT_LOGO));
    expect(layout.pages.length).toBeGreaterThan(2);
    for (let page = 0; page < layout.pages.length; page += 1) {
      for (const fragment of tablesOn(layout, page))
        expect(fragment.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    }
  });

  test('places a repeated header row below the picture', () => {
    const layout = lay(table({ rows: 90, headerRow: true }), pictureHeader(RIGHT_LOGO));
    const [continued] = tablesOn(layout, 1);
    expect(continued!.rows[0]!.isHeaderRepeat).toBe(true);
    expect(continued!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  test('never paints a row across the picture band', () => {
    const layout = lay(
      table({ rows: 90, cantSplit: true, linesPerRow: 40 }),
      pictureHeader(RIGHT_LOGO)
    );
    for (let page = 0; page < layout.pages.length; page += 1) {
      for (const fragment of tablesOn(layout, page))
        for (const row of fragment.rows)
          expect(row.box.y).toBeGreaterThanOrEqual(LOGO_BOTTOM - 0.001);
    }
  });

  test('keeps the wrap distance below the picture', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, distB: 12 }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM + 12, 3);
  });

  test('clears a top-and-bottom picture the same way', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, wrap: 'topAndBottom' }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  test('moves the table below the band when its first row after paragraphs reaches it', () => {
    // Five 14pt lines end at 70; the first row (70..84) crosses the band that ends at 98.
    const body = [1, 2, 3, 4, 5].map((index) => paragraph(`p${index}`)).join('');
    const layout = lay(body + table({ rows: 10 }), pictureHeader(RIGHT_LOGO));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  for (const mode of [undefined, 14, 15])
    test(`moves an authored header row that advances a page below the picture (mode ${mode})`, () => {
      // 49 lines of 12.727pt leave 24.4pt, and the two-line header row needs 25.5pt.
      const filler = Array.from({ length: 49 }, (_unused, index) => paragraph(`f${index}`));
      const body =
        filler.join('') +
        table({ rows: 20, headerRow: true }).replace(
          '<w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>' +
            paragraph('head'),
          '<w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>' +
            paragraph('head') +
            paragraph('head')
        );
      const layout = lay(body, pictureHeader(RIGHT_LOGO), mode);
      expect(tablesOn(layout, 0)).toHaveLength(0);
      const [fragment] = tablesOn(layout, 1);
      expect(fragment!.rows[0]!.isHeaderRow).toBe(true);
      expect(fragment!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
      expect(fragment!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
      expectContiguous(fragment!);
    });

  test('counts the wrap distance beside the picture', () => {
    // 6200 twips = 310pt ends 8pt left of the picture, inside an 18pt left wrap distance.
    const near = table({ rows: 10, width: 6200 });
    const layout = lay(near, pictureHeader({ ...RIGHT_LOGO, distL: 18 }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    const clear = lay(near, pictureHeader(RIGHT_LOGO));
    expect(tablesOn(clear, 0)[0]!.box.y).toBeCloseTo(0, 3);
  });
});

describe('a table below a body float', () => {
  /** A paragraph with a 144pt by 72pt square picture at content x 0, then `after`. */
  function withBodyFloat(
    after: string,
    mutate: (xml: string) => string = (xml) => xml,
    sect = SECT
  ): SemanticLayout {
    const xml = mutate(squareAnchorAtLeft({ text: 'lead' })).replace(
      '</w:body>',
      `${after}${sect}</w:body>`
    );
    const part = loadDrawingPart(xml);
    return layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: layoutContext(part) });
  }

  test('starts below a float anchored before it', () => {
    const layout = withBodyFloat(table({ rows: 4 }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(72, 3);
  });

  test('stays beside the float when it starts clear of it horizontally', () => {
    const narrow = table({ rows: 4, width: 4000 }).replace(
      '<w:tblLayout',
      '<w:tblInd w:w="4000" w:type="dxa"/><w:tblLayout'
    );
    const layout = withBodyFloat(narrow);
    expect(tablesOn(layout, 0)[0]!.box.y).toBeLessThan(72);
  });

  /** The picture 60pt below its paragraph top: content y 60..132. */
  const lower = (xml: string) =>
    xml.replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      `relativeFrom="paragraph"><wp:posOffset>${60 * EMU_PER_PT}`
    );

  test('moves the whole table below a float that its later rows reach', () => {
    const layout = withBodyFloat(table({ rows: 20 }), lower);
    const [fragment] = tablesOn(layout, 0);
    expect(fragment!.box.y).toBeCloseTo(132, 3);
    expect(fragment!.rows).toHaveLength(20);
    expectContiguous(fragment!);
  });

  test('keeps a table that ends above the float in place', () => {
    const layout = withBodyFloat(table({ rows: 2 }), lower);
    const [fragment] = tablesOn(layout, 0);
    expect(fragment!.box.y).toBeLessThan(20);
    expect(fragment!.box.y + fragment!.box.height).toBeLessThan(60);
  });

  test('moves a table with a vertical merge as one piece', () => {
    const layout = withBodyFloat(table({ rows: 10, merge: [2, 6] }), lower);
    const [fragment] = tablesOn(layout, 0);
    expect(fragment!.box.y).toBeCloseTo(132, 3);
    expectContiguous(fragment!);
  });

  test('a picture in the first column does not move a table in the second', () => {
    // A 100pt by 72pt top-and-bottom picture at page y 300 (content 228..300) in column 1.
    const inColumnOne = (xml: string) =>
      xml
        .replace(/<wp:wrapSquare [^>]*\/>/, '<wp:wrapTopAndBottom/>')
        .replace(
          'relativeFrom="paragraph"><wp:posOffset>0',
          `relativeFrom="page"><wp:posOffset>${300 * EMU_PER_PT}`
        )
        .replaceAll('cx="1828800"', `cx="${100 * EMU_PER_PT}"`);
    const columnBreak =
      '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:br w:type="column"/></w:r></w:p>';
    const layout = withBodyFloat(
      columnBreak + table({ rows: 30, width: 3000 }),
      inColumnOne,
      TWO_COLUMNS
    );
    const [fragment] = tablesOn(layout, 0);
    expect(fragment!.box.x).toBeGreaterThan(216);
    expect(fragment!.box.y).toBeLessThan(20);
    expect(fragment!.rows).toHaveLength(30);
    expectContiguous(fragment!);
  });
});

describe('a kept row taller than a page below a header picture', () => {
  // 70 lines of 12.727pt: taller than the 648pt page, so the row splits wherever it starts.
  const overTall = (headerRow: boolean) =>
    table({ rows: 2, cantSplit: true, linesPerRow: 70, headerRow });

  test('starts below the picture on the first page and splits there', () => {
    const layout = lay(overTall(false), pictureHeader(RIGHT_LOGO));
    const [first] = tablesOn(layout, 0);
    expect(first!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    expect(first!.rows[0]!.hasContinuation).toBe(true);
    const [rest] = tablesOn(layout, 1);
    expect(rest!.rows[0]!.isContinuation).toBe(true);
    expect(rest!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  test('below an authored header row, leaves the header row alone on the first page', () => {
    const layout = lay(overTall(true), pictureHeader(RIGHT_LOGO));
    const [first] = tablesOn(layout, 0);
    expect(first!.rows).toHaveLength(1);
    expect(first!.rows[0]!.isHeaderRow).toBe(true);
    expect(first!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    const body = tablesOn(layout, 1)[0]!.rows.find((row) => !row.isHeaderRow)!;
    expect(body.isContinuation ?? false).toBe(false);
    expect(body.hasContinuation).toBe(true);
  });
});

describe('a header picture in the middle of the page', () => {
  // Page y 400..500 is content y 328..428.
  const MIDDLE: Picture = { x: 390, y: 400, size: 100 };

  test('starts every fragment below it until the rest of the table ends above it', () => {
    const layout = lay(table({ rows: 60 }), pictureHeader(MIDDLE));
    expect(layout.pages).toHaveLength(4);
    for (let page = 0; page < 3; page += 1) {
      const [fragment] = tablesOn(layout, page);
      expect(fragment!.box.y).toBeCloseTo(428, 3);
      expectContiguous(fragment!);
    }
    const [last] = tablesOn(layout, 3);
    expect(last!.box.y).toBeCloseTo(0, 3);
    expect(last!.box.y + last!.box.height).toBeLessThan(328);
  });
});

describe('bounded clearance', () => {
  test('a tight outline ends the band at its polygon, not at the picture extent', () => {
    // The polygon covers the top half: page y 20..95, content y -52..23.
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, wrap: 'tightTopHalf' }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(23, 3);
  });

  test('a band that reaches the page bottom moves nothing', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, size: 750 }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(0, 3);
  });

  test('splits a kept row below the picture when the reduced page cannot hold it', () => {
    // 45 lines of 12.727pt exceed the 550pt below the picture but fit the 648pt page.
    const layout = lay(
      table({ rows: 3, cantSplit: true, linesPerRow: 45 }),
      pictureHeader(RIGHT_LOGO)
    );
    expect(layout.pages).toHaveLength(6);
    for (let page = 0; page < 6; page += 1)
      expect(tablesOn(layout, page)[0]!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });
});

describe('a table carried into the second column below a header picture', () => {
  // Fifty lines fill the first column but for 11.6pt, so the table opens in the second one,
  // whose top is as fresh as a page top. The picture crosses the second column only.
  const filler = Array.from({ length: 50 }, (_unused, index) => paragraph(`f${index}`)).join('');
  const carried = (tableXml: string) =>
    lay(filler + tableXml, pictureHeader(RIGHT_LOGO), 15, TWO_COLUMNS);
  const secondColumn = (layout: SemanticLayout) => {
    const fragments = tablesOn(layout, 0);
    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.box.x).toBeGreaterThan(216);
    return fragments[0]!;
  };

  test('splits a kept row below the picture in a later column', () => {
    // 45 lines of 12.727pt: taller than the 550pt below the picture, shorter than the column.
    const layout = carried(table({ rows: 1, width: 4000, cantSplit: true, linesPerRow: 45 }));
    expect(layout.pages).toHaveLength(2);
    const row = secondColumn(layout).rows[0]!;
    expect(row.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    expect(row.hasContinuation).toBe(true);
  });

  test('an exact-height row taller than the room below the picture keeps the column top', () => {
    const exact = table({ rows: 3, width: 4000 }).replace(
      '<w:tr><w:tc>',
      '<w:tr><w:trPr><w:trHeight w:val="11200" w:hRule="exact"/></w:trPr><w:tc>'
    );
    const layout = carried(exact);
    expect(layout.pages).toHaveLength(1);
    const fragment = secondColumn(layout);
    expect(fragment.rows).toHaveLength(3);
    expect(fragment.rows[0]!.box.y).toBeCloseTo(0, 3);
    expect(fragment.rows[0]!.box.height).toBeCloseTo(560, 3);
    expectContiguous(fragment);
  });

  test('a kept row taller than a page starts below the picture and splits there', () => {
    const layout = carried(table({ rows: 1, width: 4000, cantSplit: true, linesPerRow: 70 }));
    const row = secondColumn(layout).rows[0]!;
    expect(row.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    expect(row.hasContinuation).toBe(true);
  });

  test('ordinary rows start below the picture', () => {
    const fragment = secondColumn(carried(table({ rows: 3, width: 4000 })));
    expect(fragment.rows).toHaveLength(3);
    expect(fragment.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    expectContiguous(fragment);
  });
});

describe('controls that keep their layout', () => {
  test('a table clear of the picture horizontally starts at the content top', () => {
    // 4000 twips = 200pt wide; the picture starts at content x 318.
    const layout = lay(table({ rows: 10, width: 4000 }), pictureHeader(RIGHT_LOGO));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(0, 3);
  });

  test('a wrap-none picture does not move the table', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, wrap: 'none' }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(0, 3);
  });

  test('paragraphs still wrap beside the picture', () => {
    const body = [1, 2, 3].map((index) => paragraph(`p${index}`)).join('');
    const layout = lay(body, pictureHeader(RIGHT_LOGO));
    const first = layout.pages[0]!.fragments[0]!;
    expect(first.kind).toBe('paragraph');
    expect(first.box.y).toBeCloseTo(0, 3);
  });

  test('a table without a wrapping float keeps the content top', () => {
    const layout = lay(table({ rows: 90 }));
    for (let page = 0; page < layout.pages.length; page += 1)
      expect(tablesOn(layout, page)[0]!.box.y).toBeCloseTo(0, 3);
  });
});

describe('header admission after wrapping picture clearance', () => {
  const exactParagraph = (text: string) =>
    paragraph(text).replace(
      '<w:spacing w:after="0"/>',
      '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>'
    );
  const rows = (minimum: number) => {
    const row = (label: string, properties = '') =>
      `<w:tr><w:trPr>${properties}</w:trPr><w:tc>` +
      `<w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>` +
      [1, 2, 3].map((n) => exactParagraph(`${label}${n}`)).join('') +
      '</w:tc></w:tr>';
    return (
      '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar>' +
      '<w:top w:w="0"/><w:bottom w:w="0"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>' +
      row('Header', '<w:tblHeader/>') +
      row('Minimum', `<w:trHeight w:val="${minimum * 20}" w:hRule="atLeast"/>`) +
      row('Following') +
      '</w:tbl>'
    );
  };

  test('moves the authored group and omits a repeat that displaces its row minimum', () => {
    const result = lay(exactParagraph('Before') + rows(540), pictureHeader(RIGHT_LOGO), 15);
    expect(result.pages).toHaveLength(4);
    expect(tablesOn(result, 0)).toHaveLength(0);
    expect(tablesOn(result, 1)[0]!.rows).toHaveLength(1);
    expect(tablesOn(result, 1)[0]!.rows[0]!.isHeaderRow).toBe(true);
    expect(tablesOn(result, 2)[0]!.rows).toHaveLength(1);
    expect(tablesOn(result, 2)[0]!.rows[0]!.isHeaderRepeat).toBeFalsy();
    expect(tablesOn(result, 2)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    expect(tablesOn(result, 2)[0]!.rows[0]!.box.height).toBeCloseTo(540, 3);
    expect(tablesOn(result, 3)[0]!.rows[0]!.isHeaderRepeat).toBe(true);
  });

  for (const picture of [undefined, RIGHT_LOGO]) {
    test(`omits the repeat for a minimum taller than the page, picture=${!!picture}`, () => {
      const result = lay(
        exactParagraph('Before') + rows(700),
        picture ? pictureHeader(picture) : undefined,
        15
      );
      expect(result.pages).toHaveLength(4);
      expect(tablesOn(result, 0)).toHaveLength(0);
      expect(tablesOn(result, 1)[0]!.rows).toHaveLength(1);
      expect(tablesOn(result, 2)[0]!.rows).toHaveLength(1);
      expect(tablesOn(result, 2)[0]!.rows[0]!.isHeaderRepeat).toBeFalsy();
      expect(tablesOn(result, 2)[0]!.box.y).toBeCloseTo(picture ? LOGO_BOTTOM : 0, 3);
      expect(tablesOn(result, 3)[0]!.rows[0]!.isHeaderRepeat).toBe(true);
    });
  }

  test('retains the earlier header admission rule in compatibility mode 14', () => {
    const result = lay(exactParagraph('Before') + rows(540), pictureHeader(RIGHT_LOGO), 14);
    expect(result.pages).toHaveLength(3);
    expect(tablesOn(result, 0)[0]!.rows).toHaveLength(1);
    expect(tablesOn(result, 1)[0]!.rows).toHaveLength(2);
    expect(tablesOn(result, 1)[0]!.rows[0]!.isHeaderRepeat).toBe(true);
    expect(tablesOn(result, 2)[0]!.rows[0]!.isHeaderRepeat).toBe(true);
  });

  test('keeps the authored group on its page when no picture reduces the band', () => {
    const result = lay(exactParagraph('Before') + rows(540), undefined, 15);
    // The empty paragraph the body reads after the table may take the next page.
    expect(
      result.pages.filter((page) => page.fragments.some((f) => f.kind === 'table'))
    ).toHaveLength(1);
    expect(tablesOn(result, 0)[0]!.rows).toHaveLength(3);
  });

  test('does not create a blank page when the table opens below the picture', () => {
    const result = lay(rows(540), pictureHeader(RIGHT_LOGO), 15);
    expect(result.pages).toHaveLength(3);
    expect(tablesOn(result, 0)[0]!.rows[0]!.isHeaderRow).toBe(true);
  });

  test('retains a row minimum that fits below the picture and authored header', () => {
    const result = lay(exactParagraph('Before') + rows(500), pictureHeader(RIGHT_LOGO), 15);
    expect(tablesOn(result, 0)[0]!.rows).toHaveLength(2);
    expect(tablesOn(result, 1)[0]!.rows[0]!.isHeaderRepeat).toBe(true);
  });
});
