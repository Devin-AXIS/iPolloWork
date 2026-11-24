// Text-anchored floating tables near the page bottom (`table-text-float-break.ts`). The page is
// 200 pt square without margins. Every paragraph is one exact 12 pt line; `lead(h)` is a single
// line h points tall that sets where the table starts. `table()` builds a 200 pt wide table of
// exact 40 pt rows at `w:tblpY` 0 unless a test says otherwise, so `lead(100)` leaves room for
// two rows. `textRow` rows are 12 pt per line with no authored height.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>${props}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** A lead paragraph whose one exact line fills `height` points of the page. */
const lead = (height: number) =>
  p('Lead', `<w:spacing w:line="${height * 20}" w:lineRule="exact"/>`);
const row = (index: number, header = false) =>
  `<w:tr><w:trPr>${header ? '<w:tblHeader/>' : ''}<w:trHeight w:val="800" w:hRule="exact"/></w:trPr><w:tc>${p(`Row ${index}`)}</w:tc></w:tr>`;
/** A text-relative floating table of 40 pt rows. Offsets and widths are in points. */
const table = ({
  width = 200,
  offset = 0,
  rows = 4,
  header = false,
  anchor = 'w:horzAnchor="text" w:tblpX="1"',
  extra = '',
  distance = '',
  body = '',
} = {}) =>
  `<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" ${anchor} ${distance} w:tblpY="${offset * 20 + (offset < 0 ? -1 : 1)}"/>${extra}<w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="${width * 20}"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:left w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${width * 20}"/></w:tblGrid>${
    body || Array.from({ length: rows }, (_, index) => row(index, header && index === 0)).join('')
  }</w:tbl>`;
/** A row of `lines` 12 pt lines and no authored height, which may split between lines. */
const textRow = (index: number, lines: number) =>
  `<w:tr><w:tc>${p(`Row ${index}`)}${p('more').repeat(lines - 1)}</w:tc></w:tr>`;
/** A two-line row with an authored minimum height of `minimum` points. */
const minimumRow = (index: number, minimum: number) =>
  textRow(index, 2).replace(
    '<w:tr>',
    `<w:tr><w:trPr><w:trHeight w:val="${minimum * 20}" w:hRule="atLeast"/></w:trPr>`
  );
const unpositioned = (body: string) =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="4000"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${body}</w:tbl>`;
const part = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const bodyOf = (source: ReturnType<typeof part>) => {
  const body = source.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  );
  if (!body || body.kind === 'textValue') throw new Error('body');
  return body;
};
/** `source` with its first block replaced by `lead(height)`; every other node keeps its identity. */
const withLead = (source: ReturnType<typeof part>, height: number) => {
  const body = bodyOf(source);
  const replacement = bodyOf(part(lead(height))).children[0]!;
  return {
    ...source,
    root: {
      ...source.root,
      children: source.root.children.map((node) =>
        node === body
          ? {
              ...body,
              children: body.children.map((child, index) => (index === 0 ? replacement : child)),
            }
          : node
      ),
    },
  };
};
const options = {
  measurer: createFixedMeasurer(6, 12),
  geometry: { width: 200, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
};
type Layout = ReturnType<typeof layoutSemanticDocument>;
const render = (body: string): Layout => layoutSemanticDocument(part(body), 0, options);
const tablesOn = (layout: Layout, page: number) =>
  layout.pages[page]!.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table');
const paragraphsOn = (layout: Layout, page: number) =>
  layout.pages[page]!.fragments.filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph');
const lineAt = (layout: Layout, page: number, text: string) =>
  paragraphsOn(layout, page)
    .flatMap((paragraph) => paragraph.lines)
    .find((line) => line.spans.map((span) => span.text).join('') === text)!;
const rowText = (fragment: TableFragmentRecord) =>
  fragment.rows.map((placed) =>
    placed.cells[0]!.blocks.flatMap((block) =>
      block.kind === 'paragraph'
        ? block.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    ).join('')
  );

describe('a text-relative table that spans its column and misses the page bottom', () => {
  for (const [label, shape] of [
    ['text anchored', {}],
    ['margin anchored and wider than the column', { width: 210, anchor: 'w:horzAnchor="margin"' }],
    ['right to left', { extra: '<w:bidiVisual/>' }],
  ] as const) {
    test(`breaks between rows and continues at the next page top (${label})`, () => {
      const layout = render(lead(100) + table(shape) + p('Anchor') + p('Tail'));
      expect(layout.pages).toHaveLength(2);
      const [first] = tablesOn(layout, 0);
      const [rest] = tablesOn(layout, 1);
      expect(isOutOfFlowTableFragment(first!)).toBe(false);
      expect(isOutOfFlowTableFragment(rest!)).toBe(false);
      expect(first!.box.y).toBe(100);
      expect(rowText(first!)).toEqual(['Row 0', 'Row 1']);
      expect(first!.box.y + first!.box.height).toBeLessThanOrEqual(200);
      expect(rest!.box.y).toBe(0);
      expect(rowText(rest!)).toEqual(['Row 2', 'Row 3']);
      // No text can stand beside the table, so the anchor follows its last row.
      const [anchor, tail] = paragraphsOn(layout, 1);
      expect(anchor!.lines[0]!.spans[0]!.text).toBe('Anchor');
      expect(anchor!.lines[0]!.box.y).toBe(80);
      expect(tail!.lines[0]!.box.y).toBe(92);
    });
  }

  test('keeps the offset above the first row', () => {
    const layout = render(lead(60) + table({ offset: 20 }) + p('Anchor'));
    const [first] = tablesOn(layout, 0);
    expect(first!.box.y).toBe(80);
    expect(rowText(first!)).toEqual(['Row 0', 'Row 1', 'Row 2']);
    expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['Row 3']);
  });

  test('repeats a header row on the continuation page', () => {
    const layout = render(lead(100) + table({ header: true }) + p('Anchor'));
    expect(rowText(tablesOn(layout, 0)[0]!)).toEqual(['Row 0', 'Row 1']);
    const rest = tablesOn(layout, 1)[0]!;
    expect(rowText(rest)).toEqual(['Row 0', 'Row 2', 'Row 3']);
    expect(rest.rows[0]!.isHeaderRepeat).toBe(true);
  });

  test('lays out the same through a retained session when an edit moves the page bottom', () => {
    const initial = part(lead(20) + table() + p('Anchor') + p('Tail'));
    // Only the lead changes; the table and its anchor keep their node identities.
    const edited = withLead(initial, 100);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    for (const [revision, source] of [initial, edited, initial, edited].entries()) {
      const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
      expect(warm.pages).toEqual(layoutSemanticDocument(source, revision, options).pages);
      const fragments = warm.pages.flatMap((_, page) => tablesOn(warm, page));
      expect(fragments.map(isOutOfFlowTableFragment)).toEqual(
        source === edited ? [false, false] : [true]
      );
    }
  });
});

describe('a text-relative table narrower than its column that misses the page bottom', () => {
  test('breaks between rows, and the text after it wraps beside its last rows', () => {
    const layout = render(lead(100) + table({ width: 80 }) + p('Anchor') + p('Tail'));
    expect(layout.pages).toHaveLength(2);
    const [first] = tablesOn(layout, 0);
    const [rest] = tablesOn(layout, 1);
    expect(first!.box.y).toBe(100);
    expect(rowText(first!)).toEqual(['Row 0', 'Row 1']);
    expect(rest!.box.y).toBe(0);
    expect(rowText(rest!)).toEqual(['Row 2', 'Row 3']);
    expect(isOutOfFlowTableFragment(first!)).toBe(false);
    expect(isOutOfFlowTableFragment(rest!)).toBe(false);
    // Only the last fragment is an obstacle: the text after the table starts on its page.
    expect(first!.floatingWrap).toBeUndefined();
    expect(rest!.floatingWrap).toBeDefined();
    for (const [text, y] of [
      ['Anchor', 0],
      ['Tail', 12],
    ] as const) {
      const line = lineAt(layout, 1, text);
      expect(line.box.y).toBe(y);
      expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
    }
  });

  test('a table at the right edge leaves the text on its left', () => {
    const right = table({ width: 80, anchor: 'w:horzAnchor="margin" w:tblpXSpec="right"' });
    const layout = render(lead(100) + right + p('Anchor'));
    expect(tablesOn(layout, 1)[0]!.box.x).toBeGreaterThanOrEqual(120);
    const anchor = lineAt(layout, 1, 'Anchor');
    expect(anchor.box.y).toBe(0);
    expect(anchor.spans[0]!.box.x).toBe(0);
  });

  test('the space below the table extends the band the text wraps beside', () => {
    const lines = Array.from({ length: 10 }, (_, index) => p(`Line ${index}`)).join('');
    const layout = render(
      lead(100) + table({ width: 80, distance: 'w:bottomFromText="400"' }) + lines
    );
    expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['Row 2', 'Row 3']);
    // The rows end at 80 and the band 20 pt lower, so only the line at 108 returns to x 0.
    for (let index = 0; index < 10; index++) {
      const line = lineAt(layout, 1, `Line ${index}`);
      expect(line.box.y).toBe(index * 12);
      expect(line.spans[0]!.box.x).toBe(index < 9 ? 80 : 0);
    }
  });

  test('rows split as in an unpositioned table, and move when their minimum does not fit', () => {
    const rows = [0, 1, 2, 3].map((index) => textRow(index, 3)).join('');
    const split = (body: string, room = 100) => {
      const layout = render(lead(room) + body + p('Anchor'));
      return layout.pages.map((_, page) => tablesOn(layout, page).flatMap(rowText));
    };
    // Row 2 splits after its first two lines, as it does without a position.
    const expected = [
      ['Row 0moremore', 'Row 1moremore', 'Row 2more'],
      ['more', 'Row 3moremore'],
    ];
    expect(split(table({ body: rows }))).toEqual(expected);
    expect(split(unpositioned(rows))).toEqual(expected);
    // The 15 pt left below row 2 holds a first line but not a 30 pt minimum: row 3 moves whole.
    const kept = [0, 1, 2, 3].map((index) => minimumRow(index, 30)).join('');
    expect(split(table({ body: kept }), 95)).toEqual([
      ['Row 0more', 'Row 1more', 'Row 2more'],
      ['Row 3more'],
    ]);
  });

  test('a row taller than a page splits where it stands', () => {
    const layout = render(lead(100) + table({ width: 80, body: textRow(0, 20) }) + p('Anchor'));
    expect(layout.pages).toHaveLength(2);
    expect(tablesOn(layout, 0)[0]!.box.y).toBe(100);
    expect(tablesOn(layout, 1)[0]!.box.y).toBe(0);
    const anchor = lineAt(layout, 1, 'Anchor');
    expect(anchor.box.y).toBe(0);
    expect(anchor.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
  });

  for (const cantSplit of [false, true]) {
    test(`a first row whose first lines fit splits where it stands (cantSplit ${cantSplit})`, () => {
      const first = textRow(0, 4).replace(
        '<w:tr>',
        cantSplit ? '<w:tr><w:trPr><w:cantSplit/></w:trPr>' : '<w:tr>'
      );
      // 30 pt are left below the lead: room for one 12 pt line, plus the offset and borders.
      const layout = render(
        lead(170) + table({ width: 80, body: first + textRow(1, 2) }) + p('Anchor')
      );
      expect(layout.pages).toHaveLength(2);
      expect(rowText(tablesOn(layout, 0)[0]!)).toEqual(['Row 0more']);
      expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['moremore', 'Row 1more']);
      expect(lineAt(layout, 1, 'Anchor').box.y).toBe(0);
    });
  }

  test('an exact-height first row must fit whole, or the table moves with its anchor', () => {
    const exact = textRow(0, 2).replace(
      '<w:tr>',
      '<w:tr><w:trPr><w:trHeight w:val="1600" w:hRule="exact"/></w:trPr>'
    );
    const narrow = table({ width: 80, offset: 4, body: exact + row(1) });
    for (const room of [125, 130]) {
      const layout = render(lead(room) + narrow + p('Anchor'));
      expect(tablesOn(layout, 0)).toHaveLength(0);
      const [moved] = tablesOn(layout, 1);
      expect(isOutOfFlowTableFragment(moved!)).toBe(true);
      expect(moved!.box.y).toBe(4);
      expect(lineAt(layout, 1, 'Anchor').spans[0]!.box.x).toBeGreaterThanOrEqual(80);
    }
  });

  test('a row that cannot split but is taller than a page splits where it stands', () => {
    const tall = textRow(1, 20).replace('<w:tr>', '<w:tr><w:trPr><w:cantSplit/></w:trPr>');
    const layout = render(
      lead(100) + table({ width: 80, body: textRow(0, 2) + tall }) + p('Anchor')
    );
    expect(layout.pages).toHaveLength(2);
    const [first] = tablesOn(layout, 0);
    expect(first!.rows).toHaveLength(2);
    // Row 0 holds two 12 pt lines, so the tall row starts right below it.
    expect(first!.rows[1]!.box.y).toBe(124);
    expect(lineAt(layout, 1, 'Anchor').box.y).toBe(0);
  });

  test('an earlier table that shares the anchor stays behind when the table moves on', () => {
    const left = table({ width: 80, rows: 1 });
    const rows = minimumRow(0, 150) + minimumRow(1, 150);
    const right = table({
      width: 80,
      offset: 20,
      body: rows,
      anchor: 'w:horzAnchor="margin" w:tblpXSpec="right"',
    });
    const layout = render(lead(100) + left + right + p('Anchor'));
    expect(layout.pages).toHaveLength(3);
    const [waiting] = tablesOn(layout, 0);
    expect(isOutOfFlowTableFragment(waiting!)).toBe(true);
    expect(waiting!.box.y).toBe(100);
    expect(tablesOn(layout, 1)[0]!.box.y).toBe(20);
  });

  test('a table that a page holds stays whole though its offset pushes it past the bottom', () => {
    // 190 pt of rows fit the 200 pt page; with the 20 pt offset the table ends 10 pt below it.
    const layout = render(
      table({ width: 80, offset: 20, body: minimumRow(0, 190) }) + p('Anchor') + p('Tail')
    );
    expect(layout.pages).toHaveLength(1);
    const [whole] = tablesOn(layout, 0);
    expect(isOutOfFlowTableFragment(whole!)).toBe(true);
    expect(whole!.box.y).toBe(20);
    // The anchor line sits above the table; the next line wraps beside it.
    expect(lineAt(layout, 0, 'Anchor').box.y).toBe(0);
    expect(lineAt(layout, 0, 'Tail').spans[0]!.box.x).toBeGreaterThanOrEqual(80);
  });

  test('a table taller than the room with a negative offset below text opens the next page', () => {
    const tall = table({ width: 80, offset: -6, body: textRow(0, 20) });
    const layout = render(lead(100) + tall + p('Anchor'));
    expect(tablesOn(layout, 0)).toHaveLength(0);
    // The offset would reach above the page top, so the table starts there.
    expect(tablesOn(layout, 1)[0]!.box.y).toBe(0);
  });

  test('a negative offset at the page top reaches into the top margin', () => {
    // A 50 pt top margin leaves 150 pt; 30 pt above the margin, the four 40 pt rows fit whole.
    const margined = {
      ...options,
      geometry: { ...options.geometry, margin: { ...options.geometry.margin, top: 50 } },
    };
    const layout = layoutSemanticDocument(part(table({ offset: -30 }) + p('Anchor')), 0, margined);
    expect(layout.pages).toHaveLength(1);
    const [only] = tablesOn(layout, 0);
    expect(only!.box.y).toBeCloseTo(-30, 0);
    expect(rowText(only!)).toEqual(['Row 0', 'Row 1', 'Row 2', 'Row 3']);
  });

  test('opening rows that fit only a fresh page move the table there with its offset', () => {
    const rows = minimumRow(0, 150) + minimumRow(1, 150);
    const layout = render(lead(100) + table({ width: 80, offset: 20, body: rows }) + p('Anchor'));
    expect(layout.pages).toHaveLength(3);
    expect(tablesOn(layout, 0)).toHaveLength(0);
    expect(tablesOn(layout, 1)[0]!.box.y).toBe(20);
    expect(tablesOn(layout, 2)[0]!.box.y).toBe(0);
    expect(lineAt(layout, 2, 'Anchor').box.y).toBe(0);
  });

  test('lays out the same through a retained session when an edit moves the page bottom', () => {
    const initial = part(lead(20) + table({ width: 80 }) + p('Anchor') + p('Tail'));
    const edited = withLead(initial, 100);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    for (const [revision, source] of [initial, edited, initial, edited].entries()) {
      const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
      expect(warm.pages).toEqual(layoutSemanticDocument(source, revision, options).pages);
      // The lead pushes the table to break: its last fragment then wraps the text on page 1.
      const wrapping = warm.pages.flatMap((_, page) => tablesOn(warm, page));
      expect(wrapping.map((fragment) => !!fragment.floatingWrap)).toEqual(
        source === edited ? [false, true] : [true]
      );
    }
  });
});

describe('floating tables that still move whole with their anchor', () => {
  const movesWhole = (layout: Layout, rows: number) => {
    expect(layout.pages).toHaveLength(2);
    expect(tablesOn(layout, 0)).toHaveLength(0);
    const [floating] = tablesOn(layout, 1);
    expect(isOutOfFlowTableFragment(floating!)).toBe(true);
    expect(floating!.rows).toHaveLength(rows);
  };

  test('a space above the table', () => {
    movesWhole(render(lead(100) + table({ distance: 'w:topFromText="200"' }) + p('Anchor')), 4);
  });

  test('a first row that does not fit the room left', () => {
    movesWhole(render(lead(170) + table() + p('Anchor')), 4);
  });

  test('a header row that fits without the first body row', () => {
    movesWhole(render(lead(130) + table({ header: true }) + p('Anchor')), 4);
  });

  test('a negative offset that lays the table over earlier text', () => {
    movesWhole(render(lead(100) + table({ offset: -6 }) + p('Anchor')), 4);
  });
});

test('a spanning table that fits the room left stays whole on its anchor page', () => {
  const layout = render(lead(20) + table() + p('Anchor'));
  expect(layout.pages).toHaveLength(1);
  const [floating] = tablesOn(layout, 0);
  expect(isOutOfFlowTableFragment(floating!)).toBe(true);
  expect(floating!.rows).toHaveLength(4);
  expect(floating!.box.y).toBe(20);
});

const cascadeWithFlag = (content: string) => {
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${W}" xmlns:x="urn:other"><w:compat>${content}</w:compat></w:settings>`,
    { name: '/word/settings.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return buildStyleCascadeTable(null, undefined, read.part.root);
};

describe('wrapped-table compatibility setting', () => {
  for (const value of [undefined, '1', 'true', 'on', '0', 'false', 'off']) {
    test(`reads the on/off value ${String(value)}`, () => {
      const enabled = value === undefined || ['1', 'true', 'on'].includes(value);
      const cascade = cascadeWithFlag(
        `<w:doNotBreakWrappedTables${value === undefined ? '' : ` w:val="${value}"`}/>`
      );
      const result = layoutSemanticDocument(part(lead(100) + table() + p('Anchor')), 0, {
        ...options,
        styleCascade: cascade,
      });
      expect(tablesOn(result, 0)).toHaveLength(enabled ? 0 : 1);
      expect(isOutOfFlowTableFragment(tablesOn(result, 1)[0]!)).toBe(enabled);
    });
  }

  test('ignores foreign and nested compatibility elements', () => {
    for (const content of [
      '<x:doNotBreakWrappedTables/>',
      '<x:wrapper><w:doNotBreakWrappedTables/></x:wrapper>',
    ]) {
      expect(cascadeWithFlag(content).doNotBreakWrappedTables).toBeUndefined();
    }
  });

  test('changing the setting invalidates retained page placement', () => {
    const source = part(lead(100) + table() + p('Anchor'));
    const enabled = cascadeWithFlag('<w:doNotBreakWrappedTables/>');
    const disabled = cascadeWithFlag('<w:doNotBreakWrappedTables w:val="0"/>');
    expect(enabled.cacheToken).not.toBe(disabled.cacheToken);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    for (const styleCascade of [disabled, enabled, disabled]) {
      const warm = layoutSemanticDocument(source, 0, { ...options, styleCascade, session, cache });
      const fresh = layoutSemanticDocument(source, 0, { ...options, styleCascade });
      expect(warm.pages).toEqual(fresh.pages);
      expect(tablesOn(warm, 0)).toHaveLength(styleCascade === enabled ? 0 : 1);
    }
  });
});

describe('a breaking text-relative table and its anchor paragraph', () => {
  /** Rows 0 and 1 fill page 0; the anchor follows rows 2 and 3 (y 80) or opens `anchorPage`. */
  const breaksThenAnchorOn = (layout: Layout, anchorPage: number) => {
    expect(rowText(tablesOn(layout, 0)[0]!)).toEqual(['Row 0', 'Row 1']);
    expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['Row 2', 'Row 3']);
    expect(lineAt(layout, anchorPage, 'Anchor').box.y).toBe(anchorPage === 1 ? 80 : 0);
  };

  test('a page break before the anchor moves only the anchor to the next page', () => {
    const layout = render(lead(100) + table() + p('Anchor', '<w:pageBreakBefore/>'));
    expect(layout.pages).toHaveLength(3);
    breaksThenAnchorOn(layout, 2);
  });

  for (const kind of ['page', 'column']) {
    test(`an anchor that opens with a manual ${kind} break follows on the next page`, () => {
      const anchor = `<w:p><w:r><w:br w:type="${kind}"/><w:t>Anchor</w:t></w:r></w:p>`;
      const layout = render(lead(100) + table() + anchor);
      expect(layout.pages).toHaveLength(3);
      breaksThenAnchorOn(layout, 2);
    });
  }

  test('space before the anchor stays below the last row', () => {
    const layout = render(lead(100) + table() + p('Anchor', '<w:spacing w:before="400"/>'));
    expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['Row 2', 'Row 3']);
    expect(lineAt(layout, 1, 'Anchor').box.y).toBe(100);
  });

  test('space before the anchor collapses when it starts beside the last part', () => {
    const narrow = table({ width: 80 });
    const layout = render(lead(100) + narrow + p('Anchor', '<w:spacing w:before="400"/>'));
    const anchor = lineAt(layout, 1, 'Anchor');
    expect(anchor.box.y).toBe(0);
    expect(anchor.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
  });

  for (const [gap, wraps] of [
    [17, false],
    [19, true],
  ] as const) {
    test(`a ${gap} pt passage beside the last part ${wraps ? 'holds' : 'does not hold'} text`, () => {
      // A one-letter anchor (6 pt) fits any passage the rule admits.
      const layout = render(lead(100) + table({ width: 200 - gap }) + p('A'));
      expect(!!tablesOn(layout, 1)[0]!.floatingWrap).toBe(wraps);
      const anchor = lineAt(layout, 1, 'A');
      expect(anchor.box.y).toBe(wraps ? 0 : 80);
      if (wraps) expect(anchor.spans[0]!.box.x).toBeGreaterThanOrEqual(200 - gap);
    });
  }

  test('space before the anchor stays below a table that leaves no passage beside it', () => {
    // A 190 pt table leaves a 10 pt gap, narrower than the quarter-inch passage text needs.
    const layout = render(
      lead(100) + table({ width: 190 }) + p('Anchor', '<w:spacing w:before="400"/>')
    );
    expect(tablesOn(layout, 1)[0]!.floatingWrap).toBeUndefined();
    expect(lineAt(layout, 1, 'Anchor').box.y).toBe(100);
  });

  test('space below the table stays below the last row', () => {
    const layout = render(lead(100) + table({ distance: 'w:bottomFromText="200"' }) + p('Anchor'));
    expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['Row 2', 'Row 3']);
    expect(lineAt(layout, 1, 'Anchor').box.y).toBe(90);
  });

  test('a table whose rows fit stays whole when only the space below it does not', () => {
    const narrow = table({ width: 80, distance: 'w:bottomFromText="600"' });
    const layout = render(lead(20) + narrow + p('Anchor'));
    expect(layout.pages).toHaveLength(1);
    const [floating] = tablesOn(layout, 0);
    expect(isOutOfFlowTableFragment(floating!)).toBe(true);
    expect(floating!.rows).toHaveLength(4);
    expect(lineAt(layout, 0, 'Anchor').box.y).toBe(20);
  });

  test('a table whose rows fit a page stays whole when the space below it does not', () => {
    const tall = table({ width: 80, distance: 'w:bottomFromText="1200"' });
    const layout = render(tall + p('Anchor'));
    expect(layout.pages).toHaveLength(1);
    expect(isOutOfFlowTableFragment(tablesOn(layout, 0)[0]!)).toBe(true);
    expect(lineAt(layout, 0, 'Anchor').spans[0]!.box.x).toBeGreaterThanOrEqual(80);
  });

  test('an earlier table that shares the anchor stays where the body reached the breaking table', () => {
    const left = table({ width: 80, rows: 1 });
    const right = table({ width: 80, anchor: 'w:horzAnchor="margin" w:tblpXSpec="right"' });
    const layout = render(lead(100) + left + right + p('Anchor'));
    expect(layout.pages).toHaveLength(2);
    const [waiting, first] = [...tablesOn(layout, 0)].sort((a, b) => a.box.x - b.box.x);
    expect(isOutOfFlowTableFragment(waiting!)).toBe(true);
    expect([waiting!.box.y, waiting!.rows.length]).toEqual([100, 1]);
    expect(first!.box.x).toBeGreaterThanOrEqual(120);
    expect(first!.box.y).toBe(100);
    expect(rowText(first!)).toEqual(['Row 0', 'Row 1']);
    expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['Row 2', 'Row 3']);
    const anchor = lineAt(layout, 1, 'Anchor');
    expect(anchor.box.y).toBe(0);
    expect(anchor.spans[0]!.box.x).toBe(0);
  });

  test('a page-wide table in multiple columns keeps the whole-table path', () => {
    const section =
      '<w:sectPr><w:pgSz w:w="8000" w:h="4000"/>' +
      '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/>' +
      '<w:cols w:num="2" w:space="0"/></w:sectPr>';
    const result = layoutSemanticDocument(
      part(
        lead(100) + table({ width: 400, anchor: 'w:horzAnchor="margin"' }) + p('Anchor') + section
      ),
      0,
      {
        ...options,
        geometry: { ...options.geometry, width: 400 },
      }
    );
    const tables = result.pages.flatMap((_, page) => tablesOn(result, page));
    expect(tables).toHaveLength(1);
    expect(isOutOfFlowTableFragment(tables[0]!)).toBe(true);
  });
});

describe('a table that fits the page that its anchor closes with a page break before', () => {
  const anchor = p('Anchor', '<w:pageBreakBefore/>');

  for (const [label, shape] of [
    ['spans the column', {}],
    [
      'centered on the margin',
      { width: 160, anchor: 'w:horzAnchor="margin" w:tblpXSpec="center"' },
    ],
    ['narrower than the column', { width: 80 }],
  ] as const) {
    test(`stays where the body reaches it, and the anchor opens the next page (${label})`, () => {
      const layout = render(lead(20) + table({ rows: 2, ...shape }) + anchor + p('Tail'));
      expect(layout.pages).toHaveLength(2);
      const [floating] = tablesOn(layout, 0);
      expect(isOutOfFlowTableFragment(floating!)).toBe(true);
      expect(floating!.box.y).toBe(20);
      expect(rowText(floating!)).toEqual(['Row 0', 'Row 1']);
      expect(tablesOn(layout, 1)).toHaveLength(0);
      expect(lineAt(layout, 1, 'Anchor').box.y).toBe(0);
      expect(lineAt(layout, 1, 'Tail').box.y).toBe(12);
    });
  }

  test('keeps its offset below the body', () => {
    const layout = render(lead(20) + table({ rows: 2, offset: 10 }) + anchor);
    expect(tablesOn(layout, 0)[0]!.box.y).toBe(30);
  });

  test('stays when its last row ends at the page bottom', () => {
    const layout = render(lead(120) + table({ rows: 2 }) + anchor);
    expect(tablesOn(layout, 0)[0]!.box.y).toBe(120);
    expect(lineAt(layout, 1, 'Anchor').box.y).toBe(0);
  });

  test('tables that share the anchor stay together', () => {
    const pair = table({ width: 80, rows: 1 }) + table({ width: 80, rows: 1 });
    const layout = render(lead(20) + pair + anchor);
    expect(tablesOn(layout, 0).map((fragment) => fragment.box.y)).toEqual([20, 60]);
    expect(tablesOn(layout, 1)).toHaveLength(0);
  });

  test('a table whose first row does not fit moves with its anchor', () => {
    const layout = render(lead(170) + table({ rows: 2 }) + anchor);
    expect(tablesOn(layout, 0)).toHaveLength(0);
    expect(tablesOn(layout, 1)[0]!.box.y).toBe(0);
    expect(lineAt(layout, 1, 'Anchor').box.y).toBe(80);
  });

  test('a margin-positioned table moves with its anchor', () => {
    const margin = table({ rows: 2 }).replace('w:vertAnchor="text"', 'w:vertAnchor="margin"');
    const layout = render(lead(20) + margin + anchor);
    expect(tablesOn(layout, 0)).toHaveLength(0);
    expect(tablesOn(layout, 1)).toHaveLength(1);
  });
});

describe('retained floating-table anchor policy', () => {
  const frame = p(
    'Frame',
    '<w:framePr w:w="400" w:h="200" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/>'
  );
  // A 100 pt lead leaves too little room for the table; a 20 pt lead leaves enough.
  for (const [width, height] of [
    [200, 100],
    [80, 100],
    [200, 20],
  ] as const) {
    const prefix = lead(height) + table({ width });
    const keepPrefix = lead(height).replace('<w:pPr>', '<w:pPr><w:keepNext/>') + table({ width });
    const anchor = p('Anchor');
    const pageAnchor = p('Anchor', '<w:pageBreakBefore/>');
    for (const [label, before, after, changed] of [
      ['page break before', prefix + anchor, prefix + pageAnchor, 2],
      ['keep-next lead', keepPrefix + anchor, keepPrefix + pageAnchor, 2],
      ['spacing before', prefix + anchor, prefix + p('Anchor', '<w:spacing w:before="200"/>'), 2],
      [
        'manual page break',
        prefix + anchor,
        prefix + anchor.replace('<w:t ', '<w:br w:type="page"/><w:t '),
        2,
      ],
      [
        'manual column break',
        prefix + anchor,
        prefix + anchor.replace('<w:t ', '<w:br w:type="column"/><w:t '),
        2,
      ],
      ['anchor after frame', prefix + frame + anchor, prefix + frame + pageAnchor, 3],
      ['frame becomes anchor', prefix + frame + pageAnchor, prefix + p('Frame') + pageAnchor, 2],
    ] as const) {
      test(`recomputes earlier table admission when ${label} changes (${width} x ${height} pt)`, () => {
        const initial = part(before + p('Tail'));
        const body = bodyOf(initial);
        const replacement = bodyOf(part(after + p('Tail'))).children[changed]!;
        const edited = {
          ...initial,
          root: {
            ...initial.root,
            children: initial.root.children.map((node) =>
              node === body
                ? {
                    ...body,
                    children: body.children.map((child, index) =>
                      index === changed ? replacement : child
                    ),
                  }
                : node
            ),
          },
        };
        const session = createLayoutSession();
        const cache = createParagraphLayoutCache<readonly PendingLine[]>();
        for (const [revision, source] of [initial, edited, initial, edited].entries()) {
          const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
          expect(warm.pages).toEqual(layoutSemanticDocument(source, revision, options).pages);
          const unchanged = layoutSemanticDocument(source, revision + 1, {
            ...options,
            session,
            cache,
          });
          expect(unchanged.pages).toBe(warm.pages);
        }
      });
    }
  }
});

describe('a text-anchored table near the bottom of an A4 page', () => {
  // A4 with 1in margins: a 697.9 pt content box. 45 exact 12 pt lines leave 157.9 pt, and the
  // 34.2 pt rows start `w:tblpY` below the last line, so four of the seven rows fit.
  const a4 = {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 595.3, height: 841.9, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
  };
  const rows = Array.from(
    { length: 7 },
    (_, index) =>
      `<w:tr><w:trPr><w:trHeight w:val="684"/></w:trPr>${[0, 1]
        .map(
          () => `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="2000"/></w:tcPr>${p(`Row ${index}`)}</w:tc>`
        )
        .join('')}</w:tr>`
  ).join('');
  const tableOf = (tblpPr: string) =>
    `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="4000"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
  const lines = Array.from({ length: 45 }, (_, index) => p(`Line ${index}`)).join('');
  const layoutOf = (tblpPr: string) =>
    layoutSemanticDocument(part(lines + tableOf(tblpPr) + p('After')), 0, a4);
  const centered =
    '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="38"/>';

  test('breaks at the same row as the same table without a position', () => {
    const split = (layout: Layout) =>
      layout.pages.map((_, page) => tablesOn(layout, page).flatMap(rowText));
    const positioned = layoutOf(centered);
    expect(split(positioned)).toEqual(split(layoutOf('')));
    expect(split(positioned)).toEqual([
      ['Row 0', 'Row 1', 'Row 2', 'Row 3'],
      ['Row 4', 'Row 5', 'Row 6'],
    ]);
    expect(tablesOn(positioned, 0)[0]!.box.y).toBeCloseTo(541.85, 5);
    // The paragraph after the table opens the second page beside the continued rows.
    const after = lineAt(positioned, 1, 'After');
    expect(after.box.y).toBe(0);
    expect(after.spans[0]!.box.x).toBe(0);
  });
});
