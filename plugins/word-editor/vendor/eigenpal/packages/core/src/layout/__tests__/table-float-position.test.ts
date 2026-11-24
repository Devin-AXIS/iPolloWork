// `w:tblpPr` (17.4.57): a table positioned against an anchor box rather than at the point
// in the text where it was authored.
//
// A page- or margin-relative table is a sheet object anchored logically to the next regular
// paragraph. A text-relative table remains in body flow.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { readTableStructure, tableFloatOriginX } from '../semantic-table.ts';
import {
  bodyTableVerticalAnchorFrames,
  isOutOfFlowTableFragment,
  tableFloatOriginY,
} from '../table-float-position.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const documentOf = (bodyXml: string) =>
  part(`<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`);

function tableNode(bodyXml: string): OoxmlElement {
  const found = documentOf(bodyXml)
    .root.children.flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  if (!found) throw new Error('no table');
  return found as OoxmlElement;
}

/** Letter portrait with 1" margins, the default `layoutSemanticDocument` geometry. */
const CONTENT_WIDTH_PT = 468;
const FRAMES = {
  text: { left: 0, width: CONTENT_WIDTH_PT },
  margin: { left: 0, width: CONTENT_WIDTH_PT },
  page: { left: -72, width: 612 },
} as const;
const VERTICAL_FRAMES = {
  text: { top: 20, height: 628 },
  margin: { top: 0, height: 648 },
  page: { top: -72, height: 792 },
} as const;

const cell = () => `<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;
/** 144pt wide, leaving 324pt of slack in the text column. */
const narrow = `<w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${cell()}${cell()}</w:tr>`;
const TABLE_WIDTH_PT = 144;

const structureOf = (bodyXml: string, depth = 0) =>
  readTableStructure(tableNode(bodyXml), CONTENT_WIDTH_PT, depth)!;

const floatingTable = (tblpPr: string, rows = narrow) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="2880"/></w:tblPr>${rows}</w:tbl>`;

const layoutOf = (bodyXml: string): SemanticLayout =>
  layoutSemanticDocument(documentOf(bodyXml), 0, { measurer: createFixedMeasurer() });

function firstTable(bodyXml: string): TableFragmentRecord {
  const fragment = layoutOf(bodyXml)
    .pages.flatMap((page) => page.fragments)
    .find((item): item is TableFragmentRecord => item.kind === 'table');
  if (!fragment) throw new Error('no table fragment');
  return fragment;
}

function paragraphNamed(layout: SemanticLayout, text: string): ParagraphFragmentRecord {
  const fragment = layout.pages
    .flatMap((page) => page.fragments)
    .find(
      (item): item is ParagraphFragmentRecord =>
        item.kind === 'paragraph' &&
        item.lines
          .flatMap((line) => line.spans.map((span) => span.text))
          .join('')
          .includes(text)
    );
  if (!fragment) throw new Error(`no paragraph containing ${text}`);
  return fragment;
}

describe('w:tblpPr is read off the table', () => {
  test('an absent w:tblpPr leaves the table unfloated', () => {
    expect(structureOf(floatingTable('')).float).toBeUndefined();
  });

  test('numeric offsets remove the one-twip storage bias', () => {
    const float = structureOf(floatingTable('<w:tblpPr w:tblpX="720" w:tblpY="200"/>')).float;
    expect(float).toEqual({ horzAnchor: 'text', vertAnchor: 'margin', xPt: 35.95, yPt: 9.95 });
  });

  test('encoded zero positions differ from absent or malformed offsets; clearances are unbiased', () => {
    const float = structureOf(
      floatingTable('<w:tblpPr w:tblpX="1" w:tblpY="1" w:leftFromText="1" w:topFromText="200"/>')
    ).float!;
    expect(float.xPt).toBe(0);
    expect(float.yPt).toBe(0);
    expect(float.distances).toEqual({ left: 0.05, top: 10, right: 0, bottom: 0 });
    for (const attributes of ['', 'w:tblpX="NaN" w:tblpY="1.5"']) {
      const missing = structureOf(floatingTable(`<w:tblpPr ${attributes}/>`)).float!;
      expect(missing.xPt).toBe(0);
      expect(missing.yPt).toBe(0);
    }
    const zero = structureOf(floatingTable('<w:tblpPr w:tblpX="0" w:tblpY="0"/>')).float!;
    expect(zero.xPt).toBe(-0.05);
    expect(zero.yPt).toBe(-0.05);
  });

  test('a negative offset survives — Word pulls a table into the margin with one', () => {
    const float = structureOf(floatingTable('<w:tblpPr w:tblpX="-720"/>')).float;
    expect(float?.xPt).toBe(-36.05);
  });

  test('an unrecognised spec is dropped, leaving the offset to place the table', () => {
    const float = structureOf(
      floatingTable('<w:tblpPr w:tblpXSpec="sideways" w:tblpX="720"/>')
    ).float;
    expect(float?.xSpec).toBeUndefined();
    expect(float?.xPt).toBe(35.95);
  });

  test('a nested table stays in flow — Word floats only the top-level one', () => {
    expect(structureOf(floatingTable('<w:tblpPr w:tblpXSpec="center"/>'), 1).float).toBeUndefined();
  });
});

describe('tableFloatOriginX places the table against its anchor', () => {
  const originOf = (tblpPr: string) => {
    const structure = structureOf(floatingTable(tblpPr));
    return tableFloatOriginX(structure.float!, TABLE_WIDTH_PT, FRAMES);
  };

  test('tblpXSpec="center" centres the table in the anchor box', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="center"/>')).toBe(162);
  });

  test('tblpXSpec="right" puts the trailing edge on the anchor box edge', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="right"/>')).toBe(324);
  });

  test('a spec supersedes tblpX (17.4.57)', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="center" w:tblpX="2880"/>')).toBe(
      162
    );
  });

  test('inside/outside render as left/right without mirrored margins', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="inside"/>')).toBe(0);
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="outside"/>')).toBe(324);
  });

  test('the page anchor measures from the sheet edge, not the margin', () => {
    // 1" from the sheet edge is 1" left of the text column, whose x is 0.
    expect(originOf('<w:tblpPr w:horzAnchor="page" w:tblpX="1441"/>')).toBe(0);
    expect(originOf('<w:tblpPr w:horzAnchor="page" w:tblpXSpec="left"/>')).toBe(-72);
  });

  test('a hostile offset keeps the leading edge on the sheet', () => {
    expect(originOf('<w:tblpPr w:tblpX="999999999"/>')).toBe(540);
    expect(originOf('<w:tblpPr w:tblpX="-999999999"/>')).toBe(-72);
  });
});

describe('tableFloatOriginY places the table against its anchor', () => {
  const originOf = (tblpPr: string, tableHeightPt = 100) => {
    const structure = structureOf(floatingTable(tblpPr));
    return tableFloatOriginY(structure.float!, tableHeightPt, VERTICAL_FRAMES);
  };

  test('tblpY is measured from the physical sheet for a page anchor', () => {
    expect(originOf('<w:tblpPr w:vertAnchor="page" w:tblpY="1701"/>')).toBe(13);
  });

  test('tblpY is measured from the body margin for a margin anchor', () => {
    expect(originOf('<w:tblpPr w:vertAnchor="margin" w:tblpY="201"/>')).toBe(10);
  });

  test('tblpYSpec supersedes tblpY and uses the resolved table height', () => {
    expect(originOf('<w:tblpPr w:vertAnchor="margin" w:tblpYSpec="bottom" w:tblpY="200"/>')).toBe(
      548
    );
  });

  test('the margin frame ignores transient note reserves and follows authored margins', () => {
    const frames = bodyTableVerticalAnchorFrames(
      {
        pageHeight: 792,
        contentInsetTop: 130,
        contentHeight: 400,
        marginBottom: 72,
      },
      20,
      72
    );
    expect(frames.margin).toEqual({ top: -58, height: 648 });
  });
});

describe('a floated table lays out at its anchored position', () => {
  const paragraph = '<w:p><w:r><w:t>lead</w:t></w:r></w:p>';

  test('the fragment box and every row share the floated origin', () => {
    const fragment = firstTable(
      paragraph + floatingTable('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="center"/>')
    );
    expect(fragment.box.x).toBeCloseTo(162, 3);
    for (const row of fragment.rows) expect(row.box.x).toBeCloseTo(162, 3);
    expect(fragment.rows[0]!.cells[0]!.box.x).toBeCloseTo(162, 3);
  });

  test('an unfloated table is unaffected', () => {
    const fragment = firstTable(paragraph + floatingTable(''));
    expect(fragment.box.x).toBeCloseTo(0, 3);
  });

  test('tblpY against the text anchor moves the table down the flow', () => {
    const inFlow = firstTable(paragraph + floatingTable('')).box.y;
    const floated = firstTable(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="text" w:tblpY="201"/>')
    ).box.y;
    expect(floated - inFlow).toBeCloseTo(10, 3);
  });

  test('an omitted vertical anchor measures tblpY from the top margin', () => {
    const omitted = firstTable(paragraph + floatingTable('<w:tblpPr w:tblpY="201"/>')).box.y;
    const margin = firstTable(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="margin" w:tblpY="201"/>')
    ).box.y;
    expect(omitted).toBeCloseTo(margin, 6);
  });

  test('the comprehensive fixture §16 callout table centres on the margin', () => {
    const bytes = readFileSync(
      `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`
    );
    const opened = readOoxmlPackage(bytes);
    if (!opened.ok) throw new Error(opened.reason);
    const main = opened.package.parts.get(opened.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(main, 0, { measurer: createFixedMeasurer() });
    const table = layout.pages
      .flatMap((page) => page.fragments)
      .find(
        (fragment): fragment is TableFragmentRecord =>
          fragment.kind === 'table' &&
          fragment.rows.some((row) =>
            row.cells.some((cellRecord) =>
              cellRecord.blocks.some(
                (block) =>
                  block.kind === 'paragraph' &&
                  block.lines.some((line) =>
                    line.spans.some((span) => span.text.includes('Uptime'))
                  )
              )
            )
          )
      );
    if (!table) throw new Error('§16 floating table not found');
    // `tblpXSpec="center"` with `horzAnchor="margin"` — the table sits centred in the text
    // area, not flush left where an unfloated table lands.
    expect(table.box.x).toBeCloseTo((CONTENT_WIDTH_PT - table.box.width) / 2, 3);
    expect(table.box.x).toBeGreaterThan(1);
  });

  test('a page-anchored tblpY pins the table without advancing body flow', () => {
    const tail = '<w:p><w:r><w:t>tail</w:t></w:r></w:p>';
    const bare = layoutOf(paragraph + tail);
    const positioned = layoutOf(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="2881"/>') + tail
    );
    const table = positioned.pages[0]!.fragments.find(
      (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
    )!;
    expect(table.box.y).toBeCloseTo(72, 3);
    expect(isOutOfFlowTableFragment(table)).toBe(true);
    expect(paragraphNamed(positioned, 'tail').box.y).toBeCloseTo(
      paragraphNamed(bare, 'tail').box.y,
      3
    );
  });

  test('tblpYSpec="inline" keeps a page-anchored table in body flow', () => {
    const tail = '<w:p><w:r><w:t>inline tail</w:t></w:r></w:p>';
    const bare = layoutOf(paragraph + tail);
    const layout = layoutOf(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpYSpec="inline"/>') + tail
    );
    const table = firstTable(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpYSpec="inline"/>') + tail
    );
    expect(isOutOfFlowTableFragment(table)).toBe(false);
    expect(paragraphNamed(layout, 'inline tail').box.y).toBeGreaterThan(
      paragraphNamed(bare, 'inline tail').box.y
    );
  });

  test('a page break on the logical anchor carries the table to that paragraph sheet', () => {
    const anchor =
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>sheet anchor</w:t></w:r></w:p>';
    const layout = layoutOf(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>') + anchor
    );
    const tablePage = layout.pages.findIndex((page) =>
      page.fragments.some((fragment) => fragment.kind === 'table')
    );
    const anchorPage = layout.pages.findIndex((page) =>
      page.fragments.some(
        (fragment) =>
          fragment.kind === 'paragraph' &&
          fragment.paragraphId === paragraphNamed(layout, 'sheet anchor').paragraphId
      )
    );
    expect(tablePage).toBe(1);
    expect(tablePage).toBe(anchorPage);
  });

  test('a logical anchor that does not fit the remaining body band carries its table', () => {
    const lines = Array.from(
      { length: 52 },
      (_, index) => `<w:r><w:t>${index}</w:t><w:br/></w:r>`
    ).join('');
    const anchor =
      '<w:p><w:pPr><w:spacing w:before="480"/></w:pPr><w:r><w:t>full-page anchor</w:t></w:r></w:p>';
    const layout = layoutOf(
      `<w:p>${lines}</w:p>` +
        floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>') +
        anchor
    );
    const pageOf = (kind: 'table' | 'paragraph') =>
      layout.pages.findIndex((page) =>
        page.fragments.some(
          (fragment) =>
            fragment.kind === kind &&
            (kind === 'table' ||
              (fragment.kind === 'paragraph' &&
                fragment.paragraphId === paragraphNamed(layout, 'full-page anchor').paragraphId))
        )
      );
    expect(pageOf('table')).toBe(1);
    expect(pageOf('table')).toBe(pageOf('paragraph'));
  });

  test('consecutive sheet-positioned tables share the next regular paragraph sheet', () => {
    const anchor =
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>shared anchor</w:t></w:r></w:p>';
    const layout = layoutOf(
      paragraph +
        floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>') +
        floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="2881"/>') +
        anchor
    );
    expect(layout.pages[0]!.fragments.filter((fragment) => fragment.kind === 'table')).toHaveLength(
      0
    );
    expect(layout.pages[1]!.fragments.filter((fragment) => fragment.kind === 'table')).toHaveLength(
      2
    );
  });

  test('a framed paragraph is not the table logical anchor', () => {
    const framed = '<w:p><w:pPr><w:framePr/></w:pPr><w:r><w:t>frame text</w:t></w:r></w:p>';
    const anchor =
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>regular anchor</w:t></w:r></w:p>';
    const layout = layoutOf(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>') + framed + anchor
    );
    expect(layout.pages[0]!.fragments.some((fragment) => fragment.kind === 'table')).toBe(false);
    expect(layout.pages[1]!.fragments.some((fragment) => fragment.kind === 'table')).toBe(true);
  });

  test('a continuous section boundary keeps its logical table on the shared sheet', () => {
    const sectionMark =
      '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p>';
    const tail = '<w:p><w:r><w:t>continuous tail</w:t></w:r></w:p>';
    const end = '<w:sectPr><w:type w:val="continuous"/></w:sectPr>';
    const bare = layoutOf(paragraph + sectionMark + tail + end);
    const layout = layoutOf(
      paragraph +
        floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>') +
        sectionMark +
        tail +
        end
    );
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.fragments.some((fragment) => fragment.kind === 'table')).toBe(true);
    expect(paragraphNamed(layout, 'continuous tail').box.y).toBeCloseTo(
      paragraphNamed(bare, 'continuous tail').box.y,
      3
    );
  });

  test('a terminal suppressed anchor still opens its resolved sheet for the table', () => {
    const source = documentOf(
      paragraph +
        floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>') +
        '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>'
    );
    const anchor = source.root.children
      .flatMap((node) => (node.kind === 'textValue' ? [] : node.children))
      .find((node) => node.kind === 'paragraph')!;
    const layout = layoutSemanticDocument(source, 0, {
      measurer: createFixedMeasurer(),
      tocFieldChromeParagraphIds: new Set([anchor.id]),
    });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[1]!.fragments.some((fragment) => fragment.kind === 'table')).toBe(true);
  });

  test('bottom margin alignment is stable when footnotes reserve body flow', () => {
    const body =
      floatingTable('<w:tblpPr w:vertAnchor="margin" w:tblpYSpec="bottom"/>') +
      '<w:p><w:r><w:t>margin anchor</w:t></w:r></w:p>';
    const normal = layoutOf(body);
    const reserved = layoutSemanticDocument(documentOf(body), 0, {
      measurer: createFixedMeasurer(),
      pageBottomReserves: new Map([[0, 180]]),
    });
    const tableY = (layout: SemanticLayout) =>
      layout.pages[0]!.fragments.find(
        (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
      )!.box.y;
    expect(tableY(reserved)).toBeCloseTo(tableY(normal), 3);
  });

  test('incremental convergence cannot reuse stale deferred table content', () => {
    const table = (text: string) =>
      floatingTable(
        '<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>',
        narrow.replaceAll('>x<', `>${text}<`)
      );
    const tail =
      '<w:p><w:r><w:t>logical anchor</w:t></w:r></w:p><w:p><w:r><w:t>unchanged tail</w:t></w:r></w:p>';
    const session = createLayoutSession();
    layoutSemanticDocument(documentOf(table('old') + tail), 0, {
      measurer: createFixedMeasurer(),
      session,
    });
    const warm = layoutSemanticDocument(documentOf(table('new') + tail), 1, {
      measurer: createFixedMeasurer(),
      session,
    });
    const cold = layoutSemanticDocument(documentOf(table('new') + tail), 1, {
      measurer: createFixedMeasurer(),
    });
    const tableText = (layout: SemanticLayout) =>
      layout.pages
        .flatMap((page) => page.fragments)
        .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
        .flatMap((fragment) => fragment.rows)
        .flatMap((row) => row.cells)
        .flatMap((cellRecord) => cellRecord.blocks)
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('');
    expect(tableText(warm)).toBe('newnew');
    expect(tableText(warm)).toBe(tableText(cold));
  });

  test('incremental deletion cannot resurrect a deferred table from the reused tail', () => {
    const anchor =
      '<w:p><w:r><w:t>stable anchor</w:t></w:r></w:p><w:p><w:r><w:t>stable tail</w:t></w:r></w:p>';
    const oldPart = documentOf(
      floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="1440"/>') + anchor
    );
    const body = oldPart.root.children.find(
      (node): node is OoxmlElement =>
        node.kind !== 'textValue' && node.children.some((child) => child.kind === 'table')
    )!;
    const newBody = Object.freeze({
      ...body,
      children: body.children.filter((node) => node.kind !== 'table'),
    }) as OoxmlElement;
    const newPart = Object.freeze({
      ...oldPart,
      root: Object.freeze({
        ...oldPart.root,
        children: oldPart.root.children.map((node) => (node === body ? newBody : node)),
      }) as OoxmlElement,
    });
    const session = createLayoutSession();
    layoutSemanticDocument(oldPart, 0, { measurer: createFixedMeasurer(), session });
    const warm = layoutSemanticDocument(newPart, 1, { measurer: createFixedMeasurer(), session });
    const cold = layoutSemanticDocument(newPart, 1, { measurer: createFixedMeasurer() });
    const tableCount = (layout: SemanticLayout) =>
      layout.pages.flatMap((page) => page.fragments).filter((item) => item.kind === 'table').length;
    expect(tableCount(warm)).toBe(0);
    expect(tableCount(warm)).toBe(tableCount(cold));
  });

  test('the issue fixture shape stays on page one and leaves the title at the flow start', () => {
    const exactRow = narrow.replace(
      '<w:tr>',
      '<w:tr><w:trPr><w:trHeight w:val="10771" w:hRule="exact"/></w:trPr>'
    );
    const title = '<w:p><w:r><w:t>exam title</w:t></w:r></w:p>';
    const layout = layoutOf(
      floatingTable(
        '<w:tblpPr w:tblpX="340" w:tblpY="1700" w:horzAnchor="page" w:vertAnchor="page"/>',
        exactRow
      ) + title
    );
    const table = layout.pages[0]!.fragments.find(
      (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
    )!;
    expect(layout.pages).toHaveLength(1);
    expect(table.box.y).toBeCloseTo(12.95, 3);
    expect(table.box.height).toBeCloseTo(538.55, 2);
    expect(paragraphNamed(layout, 'exam title').box.y).toBeCloseTo(0, 3);
  });
});

test('foreign position elements and attributes do not create or move a floating table', () => {
  expect(
    structureOf(floatingTable('<x:tblpPr xmlns:x="urn:extension" w:tblpY="2000"/>')).float
  ).toBeUndefined();
  const plain = structureOf(floatingTable('<w:tblpPr w:tblpY="200"/>')).float;
  const extended = structureOf(
    floatingTable('<w:tblpPr xmlns:x="urn:extension" x:tblpY="2000" w:tblpY="200"/>')
  ).float;
  expect(extended).toEqual(plain);
});
