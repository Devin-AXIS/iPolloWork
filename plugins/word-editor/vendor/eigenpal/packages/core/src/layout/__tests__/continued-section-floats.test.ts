// A `continuous` section shares its sheet with the floats the section before it placed there.
//
// The continued section's text wraps beside a floating table or a wrapping picture of the
// earlier section, and moves below it only where no room is left. It does not restart below
// the float. This holds when the new section changes its columns or margins too. An in-flow
// table that would cover the float starts below it; a narrower one stays beside it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS =
  `xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const measurer = createFixedMeasurer(6, 14);
const LINE = '<w:spacing w:after="0" w:line="280" w:lineRule="exact"/>';

const p = (text = '', extra = '') =>
  `<w:p><w:pPr>${LINE}${extra}</w:pPr>${text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : ''}</w:p>`;
const words = (label: string) => `${label} ${'word '.repeat(40)}`;

/** A 144pt-wide, 216pt-tall table floated at the right margin, 11.2pt below its anchor. */
const RIGHT_FLOAT =
  'w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="225"';
function table(width: number, rows: number, position?: string): string {
  const tblpPr = position ? `<w:tblpPr ${position}/>` : '';
  const row = `<w:tr><w:trPr><w:trHeight w:val="360" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${p('cell')}</w:tc></w:tr>`;
  return (
    `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>${row.repeat(rows)}</w:tbl>`
  );
}
function section(type?: string, margins = { left: 1440, right: 1440 }, columns = 1): string {
  return (
    `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="1440" w:right="${margins.right}" w:bottom="1440" w:left="${margins.left}" w:header="720" w:footer="720"/>` +
    `<w:cols w:num="${columns}" w:space="720"/></w:sectPr>`
  );
}
function part(body: string): OoxmlPart {
  const parsed = readOoxmlPart(`<w:document ${NS}><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

/** Lead paragraph, the floating table and its empty anchor, then the first section's mark. */
function document(options: {
  readonly float?: string;
  readonly second?: string;
  readonly following?: string;
}): OoxmlPart {
  return part(
    p('Lead') +
      (options.float ?? table(2880, 12, RIGHT_FLOAT) + p()) +
      p('', section()) +
      (options.following ?? p(words('First')) + p(words('Second'))) +
      (options.second ?? section('continuous'))
  );
}

/** A 144pt by 216pt square-wrapped picture at the right margin. */
const PICTURE =
  '<w:p><w:pPr>' +
  LINE +
  '</w:pPr><w:r><w:drawing>' +
  '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="1828800" cy="2743200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
  '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="pic"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';

const fragments = (layout: SemanticLayout, page = 0) => layout.pages[page]!.fragments;
const floatOf = (layout: SemanticLayout): TableFragmentRecord =>
  fragments(layout).find(
    (fragment): fragment is TableFragmentRecord =>
      fragment.kind === 'table' && isOutOfFlowTableFragment(fragment)
  )!;
function paragraphStarting(layout: SemanticLayout, label: string): ParagraphFragmentRecord {
  for (const page of layout.pages)
    for (const fragment of page.fragments)
      if (
        fragment.kind === 'paragraph' &&
        fragment.lines[0]?.spans.some((span) => span.text.startsWith(label))
      )
        return fragment;
  throw new Error(`no paragraph ${label}`);
}
const lineRight = (fragment: ParagraphFragmentRecord, index: number) =>
  Math.max(...fragment.lines[index]!.spans.map((span) => span.box.x + span.box.width));

describe('continuous section beside an earlier float', () => {
  test('starts at the flow position and wraps beside a text-anchored floating table', () => {
    const layout = layoutSemanticDocument(document({}), 0, { measurer });
    expect(layout.pages).toHaveLength(1);
    const float = floatOf(layout);
    const first = paragraphStarting(layout, 'First');
    // Lead and the empty anchor: the section mark before a continuous section takes no room.
    expect(first.box.y).toBe(28);
    expect(first.box.y).toBeLessThan(float.box.y + float.box.height);
    // Beside the float, every line ends before its wrap distance.
    expect(lineRight(first, 0)).toBeLessThanOrEqual(float.box.x - 9 + 0.001);
  });

  for (const [name, second] of [
    ['two columns', section('continuous', undefined, 2)],
    ['a wider left margin', section('continuous', { left: 2160, right: 1440 })],
  ] as const) {
    test(`still wraps beside the float when the new section has ${name}`, () => {
      const layout = layoutSemanticDocument(document({ second }), 0, { measurer });
      const float = floatOf(layout);
      const first = paragraphStarting(layout, 'First');
      expect(first.box.y).toBeLessThan(float.box.y + float.box.height);
    });
  }

  test('a next-page section is not affected', () => {
    const layout = layoutSemanticDocument(document({ second: section('nextPage') }), 0, {
      measurer,
    });
    expect(layout.pages).toHaveLength(2);
    expect(paragraphStarting(layout, 'First').box.y).toBe(0);
  });

  test('an in-flow table that would cover the float starts below it', () => {
    const narrow = table(4320, 2);
    const wide = table(9000, 2);
    for (const [inFlow, beside] of [
      [narrow, true],
      [wide, false],
    ] as const) {
      const layout = layoutSemanticDocument(
        document({ following: p('Short') + inFlow + p('After') }),
        0,
        { measurer }
      );
      const float = floatOf(layout);
      const table = fragments(layout).find(
        (fragment): fragment is TableFragmentRecord =>
          fragment.kind === 'table' && !isOutOfFlowTableFragment(fragment)
      )!;
      const floatBottom = float.box.y + float.box.height;
      if (beside) expect(table.box.y).toBeLessThan(floatBottom);
      else expect(table.box.y).toBeGreaterThanOrEqual(floatBottom - 0.001);
    }
  });

  test('wraps beside a square-wrapped picture of the earlier section', () => {
    const source = document({ float: PICTURE });
    const layout = layoutSemanticDocument(source, 0, {
      measurer,
      inlineDrawingLayout: layoutContext(source),
    });
    expect(layout.pages).toHaveLength(1);
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    const first = paragraphStarting(layout, 'First');
    expect(first.box.y).toBeLessThan(drawing.y + drawing.height);
    expect(lineRight(first, 0)).toBeLessThanOrEqual(drawing.x - 9 + 0.001);
  });

  test('moving the float re-lays the continued section exactly as a cold layout', () => {
    const variants = [
      document({}),
      document({ float: table(2880, 6, RIGHT_FLOAT) + p() }),
      document({ float: table(4320, 12, RIGHT_FLOAT) + p() }),
      document({
        float: table(2880, 12, RIGHT_FLOAT.replace('w:tblpY="225"', 'w:tblpY="2000"')) + p(),
      }),
      document({ float: p() }),
      document({}),
    ];
    const session = createLayoutSession();
    for (const [revision, source] of variants.entries()) {
      const warm = layoutSemanticDocument(source, revision, { measurer, session });
      const cold = layoutSemanticDocument(source, revision, { measurer });
      expect(warm.pages).toEqual(cold.pages);
    }
  });

  test('an earlier picture keeps a table it wraps in row flow, on the shared page only', () => {
    const floating = table(
      2880,
      2,
      'w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="1"'
    );
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    for (const [lead, floats] of [
      ['', false],
      [pageBreak, true],
    ] as const) {
      const source = document({ float: PICTURE, following: lead + floating + p('Anchor') });
      const layout = layoutSemanticDocument(source, 0, {
        measurer,
        inlineDrawingLayout: layoutContext(source),
      });
      const placed = layout.pages
        .flatMap((page) => page.fragments)
        .find((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')!;
      expect(isOutOfFlowTableFragment(placed)).toBe(floats);
    }
  });

  test('a no-overlap table of the continued section moves off the earlier float', () => {
    const noOverlap = table(
      2880,
      4,
      'w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:tblpX="4320" w:tblpY="1"'
    ).replace('<w:tblW', '<w:tblOverlap w:val="never"/><w:tblW');
    const layout = layoutSemanticDocument(
      document({ following: noOverlap + p('Anchor') + p(words('First')) }),
      0,
      { measurer, compatibilityMode: 15 }
    );
    const tables = fragments(layout).filter(
      (fragment): fragment is TableFragmentRecord =>
        fragment.kind === 'table' && isOutOfFlowTableFragment(fragment)
    );
    expect(tables).toHaveLength(2);
    const [float, moved] = tables;
    // No room on the right of the earlier float, so the table moves left of it.
    expect(moved!.box.x + moved!.box.width).toBeLessThanOrEqual(float!.box.x - 18 + 0.001);
  });
});
