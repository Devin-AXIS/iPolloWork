// `w:keepNext` chains whose members may split at a natural page break (§17.3.1.15).
//
// A kept paragraph that cannot fit whole in the space left on a page, and that its own
// `w:keepLines` and `w:widowControl` (§17.3.1.16, §17.3.1.44) allow to split, breaks there.
// Its last line then opens the next page together with its successor, so the keep holds
// without moving the paragraph. The chain is priced only to that member's shortest legal
// opening. A member that fits whole still needs its successor's opening beside it.
//
// The page shape matches the Word probes this rule was captured from: 350pt by 210pt with
// 20pt margins, so the body is 170pt and holds twelve exact 14pt lines.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  TreeDocumentStore,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import {
  DEFAULT_PARAGRAPH_KEEPS,
  keepNextGroupHeight,
  keepNextGroupNeed,
  keepNextPlan,
  keepNextTailLines,
} from '../pagination-keeps.ts';
import type { PageGeometry, PageRecord } from '../semantic-records.ts';
import { layoutContext, load as anchoredLoad } from './anchored-drawing-test-fixtures.ts';

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
const GEOMETRY: PageGeometry = {
  width: 350,
  height: 210,
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
};
const SPACING = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';
const KEEP_NEXT = '<w:keepNext/>';

/** One paragraph of `count` lines named `${name}1` to `${name}N`, via hard breaks. */
const para = (name: string, count: number, pPr = '') => {
  const runs = Array.from({ length: count }, (_, i) => `<w:t>${name}${i + 1}</w:t>`);
  return `<w:p><w:pPr>${pPr}${SPACING}</w:pPr><w:r>${runs.join('<w:br/>')}</w:r></w:p>`;
};

/** One single-line paragraph per name. */
const singles = (name: string, count: number) =>
  Array.from({ length: count }, (_, i) => para(`${name}${i + 1}_`, 1)).join('');

const lay = (part: OoxmlPart, revision = 1, extra = {}) =>
  layoutSemanticDocument(part, revision, { measurer, geometry: GEOMETRY, ...extra });

/** The visible line texts of each page, in order. */
const pageLines = (pages: readonly PageRecord[]): string[][] =>
  pages.map((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => {
            const text = line.spans
              .map((span) => span.text)
              .join('')
              .trim();
            return text === '' ? [] : [text];
          })
        : []
    )
  );

/** `names('A', 1, 4)` is `['A1', 'A2', 'A3', 'A4']`. */
const names = (name: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${name}${from + i}`);

/** A 6-line kept A, a 4-line kept B, then C of `c` lines and a one-line tail. */
const chainTail = (c: number) =>
  para('A', 6, KEEP_NEXT) + para('B', 4, KEEP_NEXT) + para('C', c) + para('TAIL', 1);

const chain = (prefix: number, a: number, aPr = KEEP_NEXT, b = 4, bPr = KEEP_NEXT) =>
  para('P', prefix) + para('A', a, aPr) + para('B', b, bPr) + para('C', 4) + para('TAIL', 1);

describe('keep-next members split at a natural page break', () => {
  test('a kept paragraph that cannot fit whole splits, and its tail opens the next page', () => {
    expect(pageLines(lay(load(chain(8, 6))).pages)).toEqual([
      [...names('P', 1, 8), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), ...names('C', 1, 4), 'TAIL1'],
    ]);
  });

  test('without widow control the head splits at the same place', () => {
    const body = chain(8, 6, `${KEEP_NEXT}<w:widowControl w:val="0"/>`);
    expect(pageLines(lay(load(body)).pages)).toEqual([
      [...names('P', 1, 8), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), ...names('C', 1, 4), 'TAIL1'],
    ]);
  });

  test('without keepNext the same paragraphs split at the same place', () => {
    expect(pageLines(lay(load(chain(8, 6, '', 4, ''))).pages)).toEqual([
      [...names('P', 1, 8), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), ...names('C', 1, 4), 'TAIL1'],
    ]);
  });

  test('keepLines forbids the split, so the kept paragraph moves whole', () => {
    expect(pageLines(lay(load(chain(8, 6, `${KEEP_NEXT}<w:keepLines/>`))).pages)).toEqual([
      names('P', 1, 8),
      [...names('A', 1, 6), ...names('B', 1, 4), ...names('C', 1, 2)],
      [...names('C', 3, 4), 'TAIL1'],
    ]);
  });

  test('a kept paragraph that fits whole moves when its successor opening does not fit', () => {
    expect(pageLines(lay(load(chain(5, 6))).pages)).toEqual([
      names('P', 1, 5),
      [...names('A', 1, 6), ...names('B', 1, 4), ...names('C', 1, 2)],
      [...names('C', 3, 4), 'TAIL1'],
    ]);
  });

  test('a one-line kept paragraph stays beside the opening of a successor that splits', () => {
    expect(pageLines(lay(load(chain(8, 1))).pages)).toEqual([
      [...names('P', 1, 8), 'A1', ...names('B', 1, 2)],
      [...names('B', 3, 4), ...names('C', 1, 4), 'TAIL1'],
    ]);
  });
});

describe('the fit boundary of a natural split', () => {
  test('a whole member and the exact two-line opening of the next member stay', () => {
    expect(pageLines(lay(load(chain(4, 6))).pages)).toEqual([
      [...names('P', 1, 4), ...names('A', 1, 6), ...names('B', 1, 2)],
      [...names('B', 3, 4), ...names('C', 1, 4), 'TAIL1'],
    ]);
  });

  test('room for exactly two lines keeps the two-line opening of the head', () => {
    expect(pageLines(lay(load(chain(10, 6))).pages)).toEqual([
      [...names('P', 1, 10), ...names('A', 1, 2)],
      [...names('A', 3, 6), ...names('B', 1, 4), ...names('C', 1, 4)],
      ['TAIL1'],
    ]);
  });

  test('room for one line cannot hold the opening, so the head moves whole', () => {
    expect(pageLines(lay(load(chain(11, 6))).pages)).toEqual([
      names('P', 1, 11),
      [...names('A', 1, 6), ...names('B', 1, 4), ...names('C', 1, 2)],
      [...names('C', 3, 4), 'TAIL1'],
    ]);
  });

  test('a three-line member cannot split under widow control, so the chain moves', () => {
    // A fits whole; B needs all three lines beside it, which leaves one line too few.
    expect(pageLines(lay(load(chain(4, 6, KEEP_NEXT, 3))).pages)).toEqual([
      names('P', 1, 4),
      [...names('A', 1, 6), ...names('B', 1, 3), ...names('C', 1, 2)],
      [...names('C', 3, 4), 'TAIL1'],
    ]);
  });
});

describe('what the natural split leaves alone', () => {
  test('members after a split member are not priced again on the next page', () => {
    // A splits 4/2. On the next page A's tail and B fill eleven lines, so C cannot open
    // beside B and moves under its own widow control.
    const body = para('P', 8) + para('A', 6, KEEP_NEXT) + para('B', 9, KEEP_NEXT) + para('C', 4);
    expect(pageLines(lay(load(body + para('TAIL', 1))).pages)).toEqual([
      [...names('P', 1, 8), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 9)],
      [...names('C', 1, 4), 'TAIL1'],
    ]);
  });

  test('a chain of unsplittable members that no page can hold is abandoned', () => {
    const lines = `${KEEP_NEXT}<w:keepLines/>`;
    const body = para('P', 8) + para('A', 6, lines) + para('B', 8, lines) + para('C', 1);
    const pages = pageLines(lay(load(body)).pages);
    // A moves for its own keepLines, and nothing is lost.
    expect(pages[0]).toEqual(names('P', 1, 8));
    expect(pages.flat()).toEqual([
      ...names('P', 1, 8),
      ...names('A', 1, 6),
      ...names('B', 1, 8),
      'C1',
    ]);
  });

  test('a short kept heading still moves to meet its successor', () => {
    const body = singles('F', 10) + para('H', 1, KEEP_NEXT) + para('B', 3);
    expect(pageLines(lay(load(body)).pages).map((page) => page.length)).toEqual([10, 4]);
  });

  test('an authored page break inside a member still prices the whole opening', () => {
    const member = para('A', 6, KEEP_NEXT).replace(
      '<w:t>A3</w:t><w:br/>',
      '<w:t>A3</w:t><w:br w:type="page"/>'
    );
    const body = para('P', 10) + member + para('B', 4);
    const pages = pageLines(lay(load(body)).pages);
    expect(pages[0]).toEqual(names('P', 1, 10));
    expect(pages[1]).toEqual(names('A', 1, 3));
  });
});

describe('the priced group height', () => {
  const block = (keepNext: boolean) => ({
    kind: 'paragraph',
    spacing: { before: 0, after: 0 },
    keeps: { ...DEFAULT_PARAGRAPH_KEEPS, keepNext },
  });
  const heights = (count: number) => Array.from({ length: count }, () => ({ height: 14 }));
  const blocks = [block(true), block(true), block(false)];
  const lines = [heights(6), heights(4), heights(4)];
  const price = (room?: number) =>
    keepNextGroupHeight(blocks, 0, 0, (at) => lines[at]!, undefined, undefined, false, room);

  test('without a room the whole chain and the last opening are priced', () => {
    expect(price()).toBe(14 * (6 + 4 + 2));
  });

  test('a head that cannot fit whole prices its two-line opening', () => {
    expect(price(14 * 4)).toBe(14 * 2);
  });

  test('a head that fits whole prices the opening of a member that does not', () => {
    expect(price(14 * 7)).toBe(14 * (6 + 2));
  });

  const at = (compatibilityMode?: number) => ({
    cursorY: 14 * 5,
    contentHeight: 14 * 12,
    lead: 0,
    pricedLead: 0,
    freshLead: 0,
    topExtent: 0,
    compatibilityMode,
  });

  test('a group that must move is priced again on a fresh page', () => {
    const rooms: number[] = [];
    const look = {
      blocks,
      start: 0,
      carry: 0,
      linesFor: (index: number) => {
        rooms.push(index);
        return lines[index]!;
      },
    };
    expect(keepNextGroupNeed(look, at())).toBe(14 * 8);
    // Priced twice: here (A whole, B opening) and on a fresh page (A, B, C opening).
    expect(rooms).toEqual([0, 1, 0, 1, 2]);
  });

  test('from Word 2013 on, a whole-fitting head stays and gives its last two lines', () => {
    const look = { blocks, start: 0, carry: 0, linesFor: (index: number) => lines[index]! };
    expect(keepNextGroupNeed(look, at(15))).toBeNull();
    expect(keepNextGroupNeed(look, at(14))).toBe(14 * 8);
    const placed = { ...look, headLead: 0 };
    expect(keepNextTailLines(placed, 14 * 7, 14 * 12, 15)).toBe(2);
    expect(keepNextTailLines(placed, 14 * 7, 14 * 12, 14)).toBe(0);
    // With room for the successor opening, nothing splits early.
    expect(keepNextTailLines(placed, 14 * 8, 14 * 12, 15)).toBe(0);
  });

  test('without widow control the Word 2013 paragraph gives one line', () => {
    const open = [{ ...blocks[0]!, keeps: { ...blocks[0]!.keeps, widowControl: false } }];
    const look = {
      blocks: [...open, blocks[1]!, blocks[2]!],
      start: 0,
      carry: 0,
      headLead: 0,
      linesFor: (index: number) => lines[index]!,
    };
    expect(keepNextTailLines(look, 14 * 7, 14 * 12, 15)).toBe(1);
  });

  test('the last priced line fits with its trailing spacing past the room', () => {
    // A's last line carries 7pt below its glyph band, so A fits 84 - 7 = 77pt whole.
    const trailing = heights(6).map((line, i) =>
      i === 5 ? { ...line, trailingSpacing: 7 } : line
    );
    const look = {
      blocks,
      start: 0,
      carry: 0,
      linesFor: (i: number) => [trailing, ...lines.slice(1)][i]!,
    };
    expect(keepNextPlan(look, 77)).toEqual({ height: 14 * 6 + 28, lastWhole: 0 });
    // One point less and A no longer fits whole, so it splits at its two-line opening.
    expect(keepNextPlan(look, 76)).toEqual({ height: 28, lastWhole: -1 });
  });

  test('the last member that fits whole before an overflow is reported', () => {
    const look = { blocks, start: 0, carry: 0, linesFor: (index: number) => lines[index]! };
    // A (6) and B (4) fit 10 lines; C's opening needs 2 more.
    expect(keepNextPlan(look, 14 * 11)).toEqual({ height: 14 * 12, lastWhole: 1 });
    expect(keepNextPlan(look, 14 * 12)).toEqual({ height: 14 * 12, lastWhole: 1 });
  });
});

describe('Word 2013 layout splits a kept head that fits whole', () => {
  const lay15 = (body: string) => lay(load(body), 1, { compatibilityMode: 15 });

  test('the head keeps all but its last two lines when the successor opening does not fit', () => {
    expect(pageLines(lay15(chain(5, 6)).pages)).toEqual([
      [...names('P', 1, 5), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), ...names('C', 1, 4), 'TAIL1'],
    ]);
  });

  test('the same split holds before a plain successor that has no room', () => {
    const body = para('P', 6) + para('A', 6, KEEP_NEXT) + para('B', 4) + para('TAIL', 1);
    expect(pageLines(lay15(body).pages)).toEqual([
      [...names('P', 1, 6), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), 'TAIL1'],
    ]);
  });

  test('space before the successor counts toward the fit', () => {
    const gap = '<w:spacing w:before="100" w:after="0" w:line="280" w:lineRule="exact"/>';
    const successor = para('B', 4, KEEP_NEXT).replace(SPACING, gap);
    const body = para('P', 5) + para('A', 6, KEEP_NEXT) + successor + para('C', 1);
    expect(pageLines(lay15(body + para('TAIL', 1)).pages)).toEqual([
      [...names('P', 1, 5), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), 'C1', 'TAIL1'],
    ]);
  });

  test('keepLines still moves the head whole', () => {
    expect(pageLines(lay15(chain(8, 6, `${KEEP_NEXT}<w:keepLines/>`)).pages)).toEqual([
      names('P', 1, 8),
      [...names('A', 1, 6), ...names('B', 1, 4), ...names('C', 1, 2)],
      [...names('C', 3, 4), 'TAIL1'],
    ]);
  });

  test('earlier layout modes move the same head whole', () => {
    const pages = lay(load(chain(5, 6)), 1, { compatibilityMode: 14 }).pages;
    expect(pageLines(pages)[0]).toEqual(names('P', 1, 5));
  });

  test('a natural split and a one-line head are unchanged', () => {
    expect(pageLines(lay15(chain(8, 6)).pages)[0]).toEqual([
      ...names('P', 1, 8),
      ...names('A', 1, 4),
    ]);
    expect(pageLines(lay15(chain(8, 1)).pages)[0]).toEqual([
      ...names('P', 1, 8),
      'A1',
      ...names('B', 1, 2),
    ]);
  });
});

describe('chains priced where placement puts them', () => {
  const lay15 = (body: string, mode = 15) => lay(load(body), 1, { compatibilityMode: mode });
  const DOUBLE = '<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/>';
  /** A 4-line kept paragraph whose double-spaced last line fits only with its trailing space. */
  const doubleKept = () =>
    para('A', 4, KEEP_NEXT)
      .replace(SPACING, DOUBLE)
      .replaceAll('<w:t>', '<w:t xml:space="preserve">');
  const autoBody = () => para('P', 5) + doubleKept() + para('B', 4) + para('TAIL', 1);

  test('a kept paragraph that fits only with its trailing space moves whole with its successor', () => {
    // Double-spaced A leaves no room for the tail line on page 2 here.
    expect(pageLines(lay(load(autoBody())).pages).slice(0, 2)).toEqual([
      names('P', 1, 5),
      [...names('A', 1, 4), ...names('B', 1, 4)],
    ]);
  });

  test('in Word 2013 layout the same paragraph gives its last two lines instead', () => {
    expect(pageLines(lay15(autoBody()).pages)).toEqual([
      [...names('P', 1, 5), ...names('A', 1, 2)],
      [...names('A', 3, 4), ...names('B', 1, 4), 'TAIL1'],
    ]);
  });

  test('a member that fits whole behind an unsplittable head gives its last lines', () => {
    const body = para('P', 4) + para('H', 1, KEEP_NEXT) + chainTail(1);
    expect(pageLines(lay15(body).pages)).toEqual([
      [...names('P', 1, 4), 'H1', ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), 'C1', 'TAIL1'],
    ]);
  });

  test('the member split applies behind a three-line head too, and not before Word 2013', () => {
    const body = para('P', 2) + para('H', 3, KEEP_NEXT) + chainTail(1);
    expect(pageLines(lay15(body).pages)).toEqual([
      [...names('P', 1, 2), ...names('H', 1, 3), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 4), 'C1', 'TAIL1'],
    ]);
    expect(pageLines(lay15(body, 14).pages)).toEqual([
      names('P', 1, 2),
      [...names('H', 1, 3), ...names('A', 1, 6), ...names('B', 1, 2)],
      [...names('B', 3, 4), 'C1', 'TAIL1'],
    ]);
  });

  test('the last whole member before the overflow is the one that splits', () => {
    const body =
      para('P', 1) +
      para('A', 6, KEEP_NEXT) +
      para('B', 4, KEEP_NEXT) +
      para('C', 4, KEEP_NEXT) +
      para('D', 3) +
      para('TAIL', 1);
    expect(pageLines(lay15(body).pages)).toEqual([
      ['P1', ...names('A', 1, 6), ...names('B', 1, 2)],
      [...names('B', 3, 4), ...names('C', 1, 4), ...names('D', 1, 3), 'TAIL1'],
    ]);
    expect(pageLines(lay(load(body)).pages)).toEqual([
      ['P1'],
      [...names('A', 1, 6), ...names('B', 1, 4), ...names('C', 1, 2)],
      [...names('C', 3, 4), ...names('D', 1, 3), 'TAIL1'],
    ]);
  });

  test('in Word 2013 layout the chain is priced again after a member splits', () => {
    const body = para('P', 8) + para('A', 6, KEEP_NEXT) + para('B', 9, KEEP_NEXT) + para('C', 4);
    expect(pageLines(lay15(body + para('TAIL', 1)).pages)).toEqual([
      [...names('P', 1, 8), ...names('A', 1, 4)],
      [...names('A', 5, 6), ...names('B', 1, 7)],
      [...names('B', 8, 9), ...names('C', 1, 4), 'TAIL1'],
    ]);
  });

  test('space before suppressed after a page break is not priced for an early split', () => {
    const opening = para('P', 3).replace('<w:t>P3</w:t>', '<w:t>P3</w:t><w:br w:type="page"/>');
    const head = para('A', 6, KEEP_NEXT).replace('w:before="0"', 'w:before="280"');
    const body = opening + head + para('B', 6, '<w:keepLines/>') + para('TAIL', 1);
    expect(pageLines(lay15(body).pages)).toEqual([
      names('P', 1, 3),
      [...names('A', 1, 6), ...names('B', 1, 6)],
      ['TAIL1'],
    ]);
  });
});

describe('a head that moves for another reason keeps no early split', () => {
  const NS =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  /** A 95pt `wrapTopAndBottom` picture `offsetPt` below the top of a one-line paragraph. */
  const band = (offsetPt: number) =>
    `<w:p><w:pPr>${SPACING}</w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" ` +
    'distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" ' +
    'relativeHeight="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">' +
    '<wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph">' +
    `<wp:posOffset>${offsetPt * 12_700}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="1270000" cy="1206500"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapTopAndBottom/><wp:docPr id="1" name="band"/><wp:cNvGraphicFramePr/><a:graphic>' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="band.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="1206500"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData>' +
    '</a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Z1</w:t></w:r></w:p>';

  // 75pt moves A before placement (its first line cannot clear the band); 84pt lets A1 fit
  // above the band, and widow control then retreats A whole from inside the line loop.
  for (const offsetPt of [75, 84]) {
    test(`a head moved by a picture band at ${offsetPt}pt places whole on the next page`, () => {
      const xml = `<w:document ${NS}><w:body>${band(offsetPt)}${para('P', 4)}${chainTail(4)}</w:body></w:document>`;
      const part = anchoredLoad(xml);
      const pages = lay(part, 1, {
        compatibilityMode: 15,
        inlineDrawingLayout: layoutContext(part),
      });
      expect(pageLines(pages.pages)).toEqual([
        ['Z1', ...names('P', 1, 4)],
        [...names('A', 1, 6), ...names('B', 1, 4), ...names('C', 1, 2)],
        [...names('C', 3, 4), 'TAIL1'],
      ]);
    });
  }
});

describe('edits, save and reopen', () => {
  /** Body paragraph ids, in order. */
  const paragraphIds = (part: OoxmlPart) => {
    const body = part.root.children.find((child) => child.kind === 'body');
    if (body?.kind !== 'body') throw new Error('The fixture has no body.');
    return body.children.flatMap((child) => (child.kind === 'paragraph' ? [child.id] : []));
  };

  /**
   * Split the filler above A three times, then join back, over one retained store. Each split
   * leaves text on both sides, so every step adds or removes exactly one line above A.
   */
  const editAboveChain = (fillers: number, extra: object, firstPageLength: number[]) => {
    const store = new TreeDocumentStore(
      load(singles('F', fillers) + para('A', 6, KEEP_NEXT) + para('B', 4, KEEP_NEXT) + para('C', 4))
    );
    const session = createLayoutSession();
    let revision = 1;
    const first = lay(store.part, revision, { ...extra, session });
    expect(pageLines(first.pages)[0]!.length).toBe(firstPageLength[0]);
    const steps: ('split' | 'join')[] = ['split', 'split', 'split', 'join', 'join', 'join'];
    for (const [step, kind] of steps.entries()) {
      const ids = paragraphIds(store.part);
      const at = ids.length - 4;
      const result = store.transact((tx) => {
        tx.apply(
          kind === 'split'
            ? { op: 'splitParagraph', paragraphId: ids[at]!, offset: 1 }
            : { op: 'joinParagraphs', firstId: ids[at - 1]!, secondId: ids[at]! }
        );
      });
      expect(result.ok).toBe(true);
      revision += 1;
      const retained = lay(store.part, revision, { ...extra, session });
      const cold = lay(structuredClone(store.part), revision, extra);
      expect(pageLines(retained.pages)).toEqual(pageLines(cold.pages));
      expect(pageLines(retained.pages)[0]!.length).toBe(firstPageLength[step + 1]);
      expect(
        pageLines(retained.pages)
          .flat()
          .filter((text) => /^[ABC]/.test(text))
      ).toEqual([...names('A', 1, 6), ...names('B', 1, 4), ...names('C', 1, 4)]);
    }
  };

  test('growing and shrinking the space above a chain matches a cold layout each time', () => {
    // 8, 9, 10, 11 lines above A: A splits 4, 3, 2, then moves whole.
    editAboveChain(8, {}, [12, 12, 12, 11, 12, 12, 12]);
  });

  test('in Word 2013 layout, edits cross between a whole-fit split and a natural split', () => {
    // 5, 6 lines above A: A fits whole and gives its last two lines. 7, 8: natural split.
    editAboveChain(5, { compatibilityMode: 15 }, [9, 10, 11, 12, 11, 10, 9]);
  });

  test('a saved and reopened document keeps the natural split', () => {
    const part = load(chain(8, 1));
    const reopened = readOoxmlPart(serializeOoxmlPart(part), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(pageLines(lay(reopened.part).pages)).toEqual(pageLines(lay(part).pages));
    expect(pageLines(lay(reopened.part).pages)[0]).toEqual([
      ...names('P', 1, 8),
      'A1',
      ...names('B', 1, 2),
    ]);
  });
});
