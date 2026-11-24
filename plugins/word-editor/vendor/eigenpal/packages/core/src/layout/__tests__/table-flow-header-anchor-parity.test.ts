// Repeated header reuse with an inline drawing layout context and parity-dependent anchors.
//
// With a drawing context, every cell paragraph a fresh header placement lays out goes through
// the row's anchor deferral and publication: `anchorFrameBase()`, `pageContentClip()` and the
// anchor sink run even when the paragraph anchors nothing. A reused header row skips them. That
// is exact only if those calls change nothing a later decision reads; the one pass-wide effect
// they could have is marking the pass as page-parity dependent, which only an anchor whose
// position reads the page's parity does (`insideMargin`, `outsideMargin`).
//
// Layout reads no `w:mirrorMargins` setting; inside and outside margin frames are how page
// parity reaches geometry. So the fixture anchors one shape to the inside margin in a body row
// on a continuation page, and a twin anchors it to the page. Both are `wrapNone`, so no wrap
// zone turns the reuse off. Each case lays out cold with the reuse off and on.

import { expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache, tableCellBreakKeysOf } from '../layout-cache.ts';
import { flowHeaderReuseTestRecorder } from '../table-header-flow-reuse.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, read, SECT, W } from './table-row-keep-fixtures.ts';

const OWNER = '/word/document.xml';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MISSING_RESOURCE: ImageResourceState = Object.freeze({
  kind: 'missing',
  partName: null,
  reason: 'no-resource',
});

// Page body: 310pt wide, 170pt tall, exact 14pt lines.
const EXACT = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';
const p = (text: string, run = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/>${EXACT}</w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${run}</w:p>`;
const tc = (content: string) => `<w:tc><w:tcPr/>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const HEADER = tr([tc(p('Head A')), tc(p('Head B'))], '<w:tblHeader/>');

/**
 * A 20pt square, wrapNone, placed against `relativeFrom` with no offset. `layoutInCell="0"`
 * keeps the page frames, so the inside margin resolves against the page's parity.
 */
const shape = (relativeFrom: 'insideMargin' | 'page') =>
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="1" behindDoc="0" locked="1" layoutInCell="0" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  `<wp:positionH relativeFrom="${relativeFrom}"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="254000" cy="254000"/><wp:wrapNone/><wp:docPr id="1" name="shape 1"/>' +
  `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="254000" cy="254000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

/** Body rows over four pages; row `ANCHOR_ROW` carries the shape, on the second page. */
const ROWS = 45;
const ANCHOR_ROW = 16;
function documentXml(relativeFrom: 'insideMargin' | 'page'): string {
  const rows = Array.from({ length: ROWS }, (_, index) =>
    tr([tc(p(`r${index}a`, index === ANCHOR_ROW ? shape(relativeFrom) : '')), tc(p(`r${index}b`))])
  );
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"><w:body>` +
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${HEADER}${rows.join('')}</w:tbl>${SECT}</w:body></w:document>`
  );
}

function drawingContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => projections.get(atomId) ?? null,
    project: (node) =>
      projections.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => MISSING_RESOURCE,
  };
}

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );

/** One cold layout with the reuse off or on, through a session so its parity flag is read. */
function run(relativeFrom: 'insideMargin' | 'page', disabled: boolean) {
  const part = read(documentXml(relativeFrom), OWNER);
  const recorder = flowHeaderReuseTestRecorder(disabled);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const result = lay(part, 15, { session, cache, inlineDrawingLayout: drawingContext(part) });
  recorder.dispose();
  return {
    result,
    pages: JSON.stringify(result.pages),
    keys: [...(tableCellBreakKeysOf(tableNode(part)) ?? [])],
    stats: cache.stats,
    lines: session.endLineCounter,
    parityDependent: session.parityDependent,
    rowsReused: recorder.rowsReused,
    plansReused: recorder.plansReused,
  };
}

for (const [relativeFrom, parity] of [
  ['insideMargin', true],
  ['page', false],
] as const) {
  test(`header reuse keeps pages and the parity flag with a ${relativeFrom} anchor`, () => {
    const off = run(relativeFrom, true);
    const on = run(relativeFrom, false);
    // Assumptions: the header repeats on several pages, the shape is published on a page whose
    // table fragment opens with a repeat, and the reuse took kept rows.
    const fragments = tables(off.result);
    // Two repeats at least: the first is placed and kept, a later one can take it.
    expect(
      fragments.filter((fragment) => fragment.rows[0]?.isHeaderRepeat).length
    ).toBeGreaterThanOrEqual(2);
    const anchored = off.result.pages.findIndex((page) => (page.anchoredDrawings?.length ?? 0) > 0);
    expect(anchored).toBeGreaterThan(0);
    expect(
      off.result.pages[anchored]!.fragments.some(
        (fragment) => fragment.kind === 'table' && fragment.rows[0]?.isHeaderRepeat
      )
    ).toBe(true);
    expect([off.rowsReused, off.plansReused]).toEqual([0, 0]);
    expect(on.rowsReused).toBeGreaterThan(0);
    // The anchor alone decides the pass's parity dependency; skipped header anchor calls do not.
    expect(off.parityDependent).toBe(parity);
    expect(on.parityDependent).toBe(off.parityDependent);
    // The same pages, key order included, and the same work.
    expect(on.pages).toBe(off.pages);
    expect(on.keys).toEqual(off.keys);
    expect(on.stats).toEqual(off.stats);
    expect(on.lines).toBe(off.lines);
  });
}
