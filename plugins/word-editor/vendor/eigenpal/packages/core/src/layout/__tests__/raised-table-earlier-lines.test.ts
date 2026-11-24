// A floating table that leaves no passage beside it moves the earlier lines it covers on its page
// below it: a page- or margin-positioned one, and a text-anchored one raised above its anchor by
// a negative offset. The table keeps its place; the anchor follows the moved lines.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
/** A 60pt-tall table, `twips` wide; the default text column is 9360 twips. */
const table = (tblpPr: string, twips = 9360) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="${twips}"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1200" ` +
  `w:hRule="exact"/></w:trPr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
const RAISED = '<w:tblpPr w:vertAnchor="text" w:tblpY="-600"/>';
const document = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const lay = (body: string) =>
  layoutSemanticDocument(document(body), 0, { measurer: createFixedMeasurer() });

/** Each block on the first page by its text (`T` for the table), with its top and bottom. */
function blocks(layout: SemanticLayout): Record<string, readonly [number, number]> {
  const out: Record<string, readonly [number, number]> = {};
  for (const fragment of layout.pages[0]!.fragments) {
    const name =
      fragment.kind === 'table'
        ? 'T'
        : fragment.lines.map((line) => line.spans.map((span) => span.text).join('')).join('');
    out[name] = [fragment.box.y, fragment.box.y + fragment.box.height];
  }
  return out;
}

test('a raised text table keeps its offset and moves the earlier lines it covers below it', () => {
  const plain = blocks(lay(p('A') + p('B') + p('C') + p('Head')));
  const raised = blocks(lay(p('A') + p('B') + p('C') + table(RAISED) + p('Head')));
  // The table starts 30pt above where its anchor started before anything moved.
  expect(raised.T![0]).toBeCloseTo(plain.Head![0] - 30, 0);
  // Every earlier line it covers, and the anchor after them, follow it in order.
  expect(raised.A![0]).toBeCloseTo(raised.T![1], 1);
  expect(raised.B![0]).toBeCloseTo(raised.A![1], 1);
  expect(raised.Head![0]).toBeCloseTo(raised.C![1], 1);
});

test('lines above the raised table stay', () => {
  const lines = ['A', 'B', 'C', 'D', 'E'].map(p).join('');
  const raised = blocks(lay(lines + table(RAISED) + p('Head')));
  // The table starts inside C, so C is the first line it moves.
  expect([raised.A![0], raised.B![0]]).toEqual([0, raised.A![1]]);
  expect(raised.C![0]).toBeCloseTo(raised.T![1], 1);
});

test('a page-positioned table moves the earlier lines it covers below it', () => {
  const placed = blocks(
    lay(p('A') + p('B') + table('<w:tblpPr w:vertAnchor="page" w:tblpY="1500"/>') + p('Head'))
  );
  expect(placed.A![0]).toBeCloseTo(placed.T![1], 1);
  expect(placed.Head![0]).toBeCloseTo(placed.B![1], 1);
});

test('a raised table with room for text beside it moves nothing', () => {
  const narrow = blocks(lay(p('A') + p('B') + p('C') + table(RAISED, 2880) + p('Head')));
  expect(narrow.A![0]).toBe(0);
  expect(narrow.C![1]).toBeCloseTo(narrow.Head![0], 1);
});

test('a warm pass after an edit above the table lays out like a cold one', () => {
  const session = createLayoutSession();
  const options = { measurer: createFixedMeasurer(), session };
  layoutSemanticDocument(document(p('A') + p('B') + table(RAISED) + p('Head')), 0, options);
  const edited = document(p('Z') + p('A') + p('B') + table(RAISED) + p('Head'));
  const warm = blocks(layoutSemanticDocument(edited, 1, options));
  const cold = blocks(layoutSemanticDocument(edited, 1, { measurer: createFixedMeasurer() }));
  expect(warm).toEqual(cold);
});

/** Every block as `page:name@top`, in paint order; `T` is a table, `¶` an empty paragraph. */
function placed(layout: SemanticLayout): string[] {
  return layout.pages.flatMap((page, index) =>
    page.fragments.map((fragment) => {
      const text =
        fragment.kind === 'table'
          ? 'T'
          : fragment.lines.map((line) => line.spans.map((span) => span.text).join('')).join('') ||
            '¶';
      return `${index}:${text}@${fragment.box.y.toFixed(1)}`;
    })
  );
}
const lines = (count: number) => Array.from({ length: count }, (_, i) => p(`L${i}`)).join('');

test('covered empty paragraphs move below a raised table too', () => {
  const empties = placed(lay('<w:p/><w:p/><w:p/>' + table(RAISED) + p('Head')));
  // The table covers all three empty lines, so the anchor lands three lines below it.
  expect(empties).toEqual(['0:¶@68.1', '0:¶@80.9', '0:¶@93.6', '0:T@8.1', '0:Head@106.3']);
});

test('covered empty paragraphs move below a page-positioned table that leaves no passage', () => {
  // The table leaves a 3pt passage at the right, too narrow for any line.
  const page = '<w:tblpPr w:vertAnchor="page" w:tblpY="1500"/>';
  const empties = placed(lay('<w:p/><w:p/><w:p/>' + table(page, 9300) + p('Head')));
  expect(empties).toEqual(['0:¶@63.0', '0:¶@75.7', '0:¶@88.4', '0:T@3.0', '0:Head@101.1']);
});

test('another table on the same anchor keeps its own offset below the moved anchor', () => {
  const narrow = '<w:tblpPr w:vertAnchor="text" w:tblpY="200" w:tblpXSpec="right"/>';
  const body = p('A') + p('B') + p('C') + table(RAISED) + table(narrow, 2000) + p('Head');
  const shared = placed(lay(body));
  expect(shared).toEqual([
    '0:A@68.1',
    '0:B@80.9',
    '0:C@93.6',
    '0:T@8.1',
    '0:T@116.3',
    '0:Head@106.3',
  ]);
});

test('near the page bottom the table stays while the moved lines and the anchor fit', () => {
  // 44 lines leave room below the band for the three lines it covers and the anchor.
  const fits = placed(lay(lines(44) + table(RAISED) + p('Head')));
  expect(fits).toContain('0:T@530.0');
  expect(fits).toContain('0:L41@590.0');
  expect(fits.at(-1)).toBe('0:Head@628.1');
});

test('near the page bottom the anchor and its table open the next page when they would not fit', () => {
  // With 46 lines the moved lines would carry the anchor off the page: the earlier lines stay
  // and the table rises above its anchor at the top of the next page.
  const moved = placed(lay(lines(46) + table(RAISED) + p('Head')));
  expect(moved).toContain('0:L45@572.7');
  expect(moved.slice(-2)).toEqual(['1:T@-30.1', '1:Head@29.9']);
});

test('near the page bottom the table stays and its anchor moves on alone when only the anchor misses', () => {
  // With 45 lines the two moved lines fit below the table, but the anchor does not.
  const alone = placed(lay(lines(45) + table(RAISED) + p('Head')));
  expect(alone).toContain('0:T@542.7');
  expect(alone).toContain('0:L44@628.1');
  expect(alone.at(-1)).toBe('1:Head@0.0');
});

test('in two columns no anchor lands under its table at a column bottom', () => {
  const columns = '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>';
  for (const count of [44, 45, 46, 47, 48, 94, 95, 96, 97]) {
    const layout = lay(lines(count) + table(RAISED, 4320) + p('Head') + p('After') + columns);
    for (const page of layout.pages) {
      const tables = page.fragments.filter((fragment) => fragment.kind === 'table');
      for (const fragment of page.fragments) {
        if (fragment.kind !== 'paragraph') continue;
        for (const other of tables) {
          const box = fragment.box;
          const under =
            box.x < other.box.x + other.box.width &&
            box.x + box.width > other.box.x &&
            box.y < other.box.y + other.box.height - 0.5 &&
            box.y + box.height > other.box.y + 0.5;
          expect(under).toBe(false);
        }
      }
    }
  }
});

test('a warm pass near the page bottom lays out like a cold one after an edit or a deletion', () => {
  for (let count = 40; count <= 50; count += 1) {
    for (const edited of [p('Z') + lines(count), lines(count - 1)]) {
      const session = createLayoutSession();
      const options = { measurer: createFixedMeasurer(), session };
      layoutSemanticDocument(document(lines(count) + table(RAISED) + p('Head')), 0, options);
      const source = document(edited + table(RAISED) + p('Head'));
      const warm = placed(layoutSemanticDocument(source, 1, options));
      const cold = placed(layoutSemanticDocument(source, 1, { measurer: createFixedMeasurer() }));
      expect(warm).toEqual(cold);
    }
  }
});

test('earlier lines wrap beside a narrow page-positioned table', () => {
  const words = p(Array.from({ length: 60 }, (_, i) => `w${i}`).join(' '));
  const narrow =
    '<w:tblpPr w:vertAnchor="page" w:tblpY="1440" w:horzAnchor="margin" w:tblpXSpec="right"/>';
  const lineCount = (layout: SemanticLayout) => {
    const first = layout.pages[0]!.fragments[0]!;
    return first.kind === 'paragraph' ? first.lines.length : 0;
  };
  // The paragraph keeps its place, and its lines narrow beside the table.
  const beside = lay(words + table(narrow, 2880) + p('Head'));
  expect(beside.pages[0]!.fragments[0]!.box.y).toBe(0);
  expect(lineCount(beside)).toBeGreaterThan(lineCount(lay(words + p('Head'))));
});

test('in two columns a raised table as wide as its column moves the earlier lines too', () => {
  const columns = '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>';
  const raised = placed(lay(p('A') + p('B') + p('C') + table(RAISED, 4320) + p('Head') + columns));
  // The table keeps the place its anchor had (38.2 less the 30 pt rise); A, B and C move below.
  expect(raised).toEqual(['0:A@68.1', '0:B@80.9', '0:C@93.6', '0:T@8.1', '0:Head@106.3']);
});

test('in two columns a warm pass near a column bottom lays out like a cold one', () => {
  const columns = '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>';
  const body = (count: number) => lines(count) + table(RAISED, 4320) + p('Head') + columns;
  for (const count of [44, 45, 46, 47, 48, 94, 95, 96, 97]) {
    const session = createLayoutSession();
    const options = { measurer: createFixedMeasurer(), session };
    layoutSemanticDocument(document(body(count)), 0, options);
    const source = document(p('Z') + body(count));
    const warm = placed(layoutSemanticDocument(source, 1, options));
    const cold = placed(layoutSemanticDocument(source, 1, { measurer: createFixedMeasurer() }));
    expect(warm).toEqual(cold);
  }
});

test('an ordinary table between a raised table and its anchor does not count as moved', () => {
  // The band moves only paragraph lines, so the ordinary table it covers stays where it is and
  // the anchor still fits on the page.
  const ordinary =
    '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="9360"/></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/>' +
    '</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="exact"/></w:trPr><w:tc><w:p/>' +
    '</w:tc></w:tr></w:tbl>';
  const layout = lay(lines(38) + table(RAISED) + ordinary + p('Head'));
  expect(layout.pages).toHaveLength(1);
});

test('a warm pass after a deletion near the page bottom matches a cold one for long anchors', () => {
  // Page-positioned tables follow their anchor; raised text tables stay while their band pushes
  // the anchor on. Either way the edited layout must not keep a stale placement.
  const long = Array.from({ length: 40 }, () => 'word').join(' ');
  const anchors = [
    p(`Head ${long}`),
    `<w:p><w:pPr><w:keepLines/></w:pPr><w:r><w:t>Head ${long}</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:widowControl/></w:pPr><w:r><w:t>Head ${long}</w:t></w:r></w:p>`,
  ];
  const tables = [table(RAISED), table('<w:tblpPr w:vertAnchor="page" w:tblpY="13000"/>')];
  for (const anchor of anchors) {
    for (const floating of tables) {
      const body = (count: number) => lines(count) + floating + anchor + p('After');
      const session = createLayoutSession();
      const options = { measurer: createFixedMeasurer(), session };
      layoutSemanticDocument(document(body(45)), 0, options);
      const edited = document(body(44));
      const warm = placed(layoutSemanticDocument(edited, 1, options));
      const cold = placed(layoutSemanticDocument(edited, 1, { measurer: createFixedMeasurer() }));
      expect(warm).toEqual(cold);
    }
  }
});
