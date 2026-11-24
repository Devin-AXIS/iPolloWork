import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { pagesToMaterialize } from '../viewport.ts';
import { terminalTextTableGroup } from '../terminal-table-anchor.ts';
import { resolveParagraphLayoutInputs } from '../style-cascade.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import { createParagraphLayoutCache, tableCellBreakKeysOf } from '../layout-cache.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (height: number, text = '', props = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:line="${Math.round(height * 20)}" w:lineRule="exact"/><w:rPr><w:sz w:val="36"/></w:rPr>${props}</w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
const table = (offset = 230, extra = '', height = 624) =>
  `<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="${offset + 1}" ${extra}/><w:tblW w:type="dxa" w:w="5528"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="5528"/></w:tblGrid>${[1, 2].map((row) => `<w:tr><w:trPr><w:trHeight w:val="${height}" w:hRule="exact"/></w:trPr><w:tc>${p(31.2, `Row ${row}`)}</w:tc></w:tr>`).join('')}</w:tbl>`;
const section = (type = '') =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1466"/></w:sectPr>`;
function part(body: string): OoxmlPart {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const fixture = (tables = table(), anchor = p(31.2), lead = 595.2) =>
  part(p(lead, 'Lead') + tables + anchor + section());
const measurer = createFixedMeasurer(6, 18);
const render = (source: OoxmlPart, options = {}) =>
  layoutSemanticDocument(source, 0, { measurer, ...options });
const tablesOf = (layout: SemanticLayout) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table');
const paragraphsOf = (layout: SemanticLayout) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph');
function bodyOf(source: OoxmlPart): OoxmlElement {
  return source.root.children.find(
    (node): node is OoxmlElement => node.kind !== 'textValue' && node.localName === 'body'
  )!;
}
function terminalGroup(source: OoxmlPart) {
  const blocks = bodyOf(source).children.flatMap((node) => {
    if (node.kind === 'table') return [{ kind: 'table' as const, table: node, key: node.id }];
    if (node.kind !== 'paragraph') return [];
    return [
      {
        kind: 'paragraph' as const,
        paragraph: node,
        key: node.id,
        props: resolveParagraphLayoutInputs(node, 450, undefined).props,
      },
    ];
  });
  return terminalTextTableGroup(blocks, 450, undefined, 'all-markup', undefined);
}

function replaceAnchor(source: OoxmlPart, replacement: OoxmlElement): OoxmlPart {
  const body = bodyOf(source);
  const anchor = body.children.at(-2)!;
  const nextBody = {
    ...body,
    children: body.children.map((node) => (node === anchor ? replacement : node)),
  };
  return {
    ...source,
    root: {
      ...source.root,
      children: source.root.children.map((node) => (node === body ? nextBody : node)),
    },
  };
}

function withBodyChildren(source: OoxmlPart, children: OoxmlElement['children']): OoxmlPart {
  const body = bodyOf(source);
  return {
    ...source,
    root: {
      ...source.root,
      children: source.root.children.map((node) => (node === body ? { ...body, children } : node)),
    },
  };
}

describe('terminal empty text-table anchors', () => {
  test('keeps the full-sized empty anchor on the table page without changing source XML', () => {
    const source = fixture();
    const before = serializeOoxmlPart(source);
    const layout = render(source);
    expect(layout.pages).toHaveLength(1);
    const [floating] = tablesOf(layout);
    const anchor = paragraphsOf(layout).at(-1)!;
    expect(floating!.box.y).toBeCloseTo(606.7, 3);
    expect(floating!.box.height).toBeCloseTo(62.4, 3);
    expect(isOutOfFlowTableFragment(floating!)).toBe(true);
    expect(anchor.box.y).toBeCloseTo(595.2, 3);
    expect(anchor.box.height).toBeCloseTo(31.2, 3);
    expect(anchor.range.start).toBe(0);
    expect(anchor.range.end).toBe(0);
    expect(anchor.lines[0]!.spans).toHaveLength(0);
    expect(serializeOoxmlPart(source)).toBe(before);
    const caret = caretAt(layout, { paragraphId: anchor.paragraphId, offset: 0 });
    expect(caret).not.toBeNull();
    expect(caret!.height).toBeGreaterThan(0);
    expect(pagesToMaterialize({ layout, viewport: { top: 0, height: 841.9 } }).size).toBe(1);
  });

  test('uses general wrapping for filled and nonterminal anchors', () => {
    for (const anchor of [p(31.2, 'TAIL'), p(31.2) + p(31.2, 'TAIL')]) {
      const layout = render(fixture(table(), anchor));
      expect(layout.pages).toHaveLength(1);
      expect(tablesOf(layout).some(isOutOfFlowTableFragment)).toBe(true);
      const tail = paragraphsOf(layout).at(-1)!;
      expect(
        tail.lines
          .flatMap((line) => line.spans)
          .map((span) => span.text)
          .join('')
      ).toBe('TAIL');
    }
  });

  test('retains genuine inline overflow', () => {
    const inline = table().replace(/<w:tblpPr[^>]+\/>/, '');
    const layout = render(fixture(inline));
    expect(layout.pages).toHaveLength(1);
    expect(tablesOf(layout).some(isOutOfFlowTableFragment)).toBe(false);
    expect(paragraphsOf(layout).at(-1)!.box.y).toBeCloseTo(657.6, 3);
    expect(render(fixture(inline, p(31.2), 606.7)).pages).toHaveLength(2);
  });

  test('declines explicit page breaks, hidden marks, revisions, and painted empty paragraphs', () => {
    for (const properties of [
      '<w:pageBreakBefore/>',
      '<w:pBdr><w:bottom w:val="single" w:sz="4"/></w:pBdr>',
      '<w:shd w:fill="FFFF00"/>',
      '<w:rPr><w:vanish/></w:rPr>',
    ]) {
      expect(terminalGroup(fixture(table(), p(31.2, '', properties)))).toBeUndefined();
    }
    const deleted = p(31.2).replace(
      '</w:p>',
      '<w:del w:id="1" w:author="A"><w:r><w:delText>hidden</w:delText></w:r></w:del></w:p>'
    );
    expect(terminalGroup(fixture(table(), deleted))).toBeUndefined();
  });

  test('positions all tables from the same anchor without charging preceding float heights', () => {
    const layout = render(fixture(table(230) + table(1700), p(31.2), 400));
    expect(layout.pages).toHaveLength(1);
    expect(tablesOf(layout).map((fragment) => fragment.box.y)).toEqual([411.5, 485]);
    expect(tablesOf(layout).every(isOutOfFlowTableFragment)).toBe(true);
    expect(paragraphsOf(layout).at(-1)!.box.y).toBe(400);
    expect(tablesOf(layout)[0]!.box.y + tablesOf(layout)[0]!.box.height).toBeLessThan(
      tablesOf(layout)[1]!.box.y
    );
  });

  test('moves a no-overlap table on the same anchor below the one it would cover', () => {
    const noOverlap = table().replace('<w:tblPr>', '<w:tblPr><w:tblOverlap w:val="never"/>');
    const layout = render(fixture(noOverlap + noOverlap, p(31.2), 400));
    const [first, second] = tablesOf(layout);
    expect(tablesOf(layout).every(isOutOfFlowTableFragment)).toBe(true);
    expect(second!.box.x).toBe(first!.box.x);
    expect(second!.box.y).toBeCloseTo(first!.box.y + first!.box.height, 3);
    expect(paragraphsOf(layout).at(-1)!.box.y).toBe(400);
  });

  test('positions text tables while a sheet-positioned table awaits publication', () => {
    const sheetTable = table(230).replace('w:vertAnchor="text"', 'w:vertAnchor="page"');
    const source = part(
      sheetTable + p(400, 'Lead') + table(230) + table(1700) + p(31.2) + section()
    );
    const layout = render(source);
    const textIds = bodyOf(source)
      .children.slice(2, 4)
      .map((node) => node.id);
    const textTables = tablesOf(layout).filter((fragment) => textIds.includes(fragment.tableId));
    expect(textTables).toHaveLength(2);
    expect(textTables.every(isOutOfFlowTableFragment)).toBe(true);
    expect(textTables[0]!.box.y + textTables[0]!.box.height).toBeLessThanOrEqual(
      textTables[1]!.box.y
    );
  });

  test('declines invalid positions in the terminal-only admission helper', () => {
    const anchors = [
      fixture(table().replace(/<w:tblpPr[^>]+\/>/, '<w:tblpPr/>')),
      fixture(table().replace(/<w:tblpPr[^>]+\/>/, '<w:tblpPr w:horzAnchor="margin"/>')),
      fixture(table().replace('w:vertAnchor="text"', 'w:vertAnchor="unknown"')),
      fixture(table().replace('w:tblpY="231"', 'w:tblpY="1.5e2"')),
      fixture(table(230, 'w:tblpYSpec="unknown"')),
      fixture(table(230, 'w:topFromText="120"')),
      fixture(table(230, 'w:bottomFromText="720"')),
    ];
    for (const source of anchors) expect(terminalGroup(source)).toBeUndefined();
  });

  test('accepts Word bookmarks, proofing boundaries and formatting-only empty runs', () => {
    for (const content of [
      '<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>',
      '<w:proofErr w:type="spellStart"/><w:proofErr w:type="spellEnd"/>',
      '<w:r><w:rPr><w:b/></w:rPr></w:r>',
    ]) {
      const source = fixture(table(), p(31.2).replace('</w:p>', content + '</w:p>'));
      const original = serializeOoxmlPart(source);
      const layout = render(source);
      expect(layout.pages).toHaveLength(1);
      expect(tablesOf(layout).every(isOutOfFlowTableFragment)).toBe(true);
      expect(serializeOoxmlPart(source)).toBe(original);
    }
    for (const content of [
      '<w:r><w:t> </w:t></w:r>',
      '<w:r><w:tab/></w:r>',
      '<w:r><w:rPr><w:vanish/></w:rPr></w:r>',
    ]) {
      const source = fixture(table(), p(31.2).replace('</w:p>', content + '</w:p>'));
      expect(terminalGroup(source)).toBeUndefined();
    }
  });

  test('keeps lead and anchor spacing whole beside the table while retaining one page', () => {
    for (const [after, before] of [
      [120, 0],
      [0, 120],
      [120, 240],
    ]) {
      const source = part(
        p(595.2, 'Lead').replace('w:lineRule="exact"', `w:lineRule="exact" w:after="${after}"`) +
          table() +
          p(31.2).replace(
            'w:lineRule="exact"',
            `w:lineRule="exact" w:before="${before}" w:after="400"`
          ) +
          section()
      );
      const layout = render(source);
      expect(layout.pages).toHaveLength(1);
      const anchor = paragraphsOf(layout).at(-1)!;
      const floating = tablesOf(layout)[0]!;
      expect(isOutOfFlowTableFragment(floating)).toBe(true);
      // A text-anchored table stands between them, so the two spaces add (17.3.1.33).
      expect(anchor.lines[0]!.box.y).toBeCloseTo(595.2 + (after! + before!) / 20, 3);
      // The offset counts from the anchor paragraph top: below the lead's space after, above
      // the anchor's own space before (17.4.57, 17.3.1.33).
      expect(floating.box.y).toBeCloseTo(595.2 + after! / 20 + 11.5, 3);
    }
  });

  test('recomputes the terminal group across spacing and bookmark edits with a warm cache', () => {
    const initial = fixture();
    const bookmarked = replaceAnchor(
      initial,
      bodyOf(
        fixture(
          table(),
          p(31.2).replace(
            '</w:p>',
            '<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/></w:p>'
          )
        )
      ).children.at(-2) as OoxmlElement
    );
    const spaced = replaceAnchor(
      bookmarked,
      bodyOf(
        fixture(table(), p(31.2).replace('w:lineRule="exact"', 'w:lineRule="exact" w:before="120"'))
      ).children.at(-2) as OoxmlElement
    );
    const session = createLayoutSession();
    const cache =
      createParagraphLayoutCache<readonly import('../paragraph-flow.ts').PendingLine[]>();
    for (const [revision, source] of [initial, bookmarked, spaced, initial].entries()) {
      const warm = layoutSemanticDocument(source, revision, { measurer, session, cache });
      const cold = layoutSemanticDocument(source, revision, { measurer });
      expect(warm.pages).toEqual(cold.pages);
      expect(warm.pages).toHaveLength(1);
    }
  });

  test('retains each table cell cache only under its own table', () => {
    const source = fixture(table(230) + table(1700), p(31.2), 400);
    render(source, { cache: createParagraphLayoutCache() });
    const [first, second] = bodyOf(source).children.filter((node) => node.kind === 'table');
    const firstKeys = new Set(tableCellBreakKeysOf(first!)!);
    const secondKeys = new Set(tableCellBreakKeysOf(second!)!);
    expect(firstKeys.size).toBeGreaterThan(0);
    expect(secondKeys.size).toBeGreaterThan(0);
    expect([...firstKeys].some((key) => secondKeys.has(key))).toBe(false);
  });

  test('declines the whole group if any table or anchor exceeds the available band', () => {
    for (const source of [
      fixture(table(1300)),
      fixture(table(230) + table(1300)),
      fixture(table(), p(130)),
      fixture(table(-100)),
    ]) {
      const layout = render(source);
      for (const page of layout.pages)
        for (const fragment of page.fragments) {
          expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(
            page.contentBox.height + 0.001
          );
        }
    }
  });

  test('an oversized exact row fills a page instead of refusing the layout', () => {
    expect(() => render(fixture(table(230, '', 16000)))).not.toThrow();
  });

  test('invalidates the group on empty-to-text edits and restores it on undo', () => {
    const empty = fixture();
    const filledAnchor = bodyOf(fixture(table(), p(31.2, 'TAIL'))).children.at(-2) as OoxmlElement;
    const filled = replaceAnchor(empty, filledAnchor);
    expect(bodyOf(filled).children[1]).toBe(bodyOf(empty).children[1]);
    const session = createLayoutSession();
    for (const [revision, source] of [empty, filled, empty].entries()) {
      const warm = layoutSemanticDocument(source, revision, { measurer, session });
      const cold = layoutSemanticDocument(source, revision, { measurer });
      expect(warm.pages).toEqual(cold.pages);
      expect(warm.pages).toHaveLength(1);
    }
  });

  test('invalidates all member keys for append, group edits, deletion, and undo', () => {
    const initial = fixture(table(230) + table(1700), p(31.2), 400);
    const originalChildren = bodyOf(initial).children;
    const changedTable = bodyOf(fixture(table(230) + table(2100), p(31.2), 400)).children[2]!;
    const changed = withBodyChildren(
      initial,
      originalChildren.map((node, index) => (index === 2 ? changedTable : node))
    );
    const appendedTail = bodyOf(
      fixture(table(230) + table(1700), p(31.2) + p(31.2, 'APPENDED'), 400)
    ).children.at(-2)!;
    const appended = withBodyChildren(initial, [
      ...originalChildren.slice(0, -1),
      appendedTail,
      originalChildren.at(-1)!,
    ]);
    const removed = withBodyChildren(
      initial,
      originalChildren.filter((_, index) => index !== 2)
    );
    const session = createLayoutSession();
    for (const [revision, source] of [
      initial,
      appended,
      initial,
      changed,
      initial,
      removed,
      initial,
    ].entries()) {
      expect(bodyOf(source).children[1]).toBe(originalChildren[1]);
      const warm = layoutSemanticDocument(source, revision, { measurer, session });
      const cold = layoutSemanticDocument(source, revision, { measurer });
      expect(warm.pages).toEqual(cold.pages);
      expect(tablesOf(warm).some(isOutOfFlowTableFragment)).toBe(true);
    }
  });

  test('preserves merged table content through general wrapping', () => {
    const merged = table().replace('<w:tc>', '<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>');
    const layout = render(fixture(table() + merged, p(31.2), 400));
    expect(tablesOf(layout).some(isOutOfFlowTableFragment)).toBe(true);
    expect(tablesOf(layout)).toHaveLength(2);
  });

  // The float stays on the shared sheet, so the continued section wraps beside it rather
  // than starting below it. Its first line keeps the flow position the section mark left.
  for (const extra of ['', 'w:bottomFromText="720"']) {
    test(`a continuous section after the empty section mark wraps beside the float ${extra}`, () => {
      const source = part(
        p(400, 'Lead') +
          table(230, extra) +
          p(31.2, '', section()) +
          p(31.2, 'FOLLOWING') +
          section('continuous')
      );
      const layout = render(source);
      expect(layout.pages).toHaveLength(1);
      const floating = tablesOf(layout)[0]!;
      expect(isOutOfFlowTableFragment(floating)).toBe(true);
      const following = paragraphsOf(layout).at(-1)!;
      const line = following.lines[0]!;
      expect(line.box.y).toBeLessThan(floating.box.y + floating.box.height);
      const span = line.spans.find((candidate) => candidate.text.includes('FOLLOWING'))!;
      const beside =
        span.box.x + span.box.width <= floating.box.x ||
        span.box.x >= floating.box.x + floating.box.width;
      expect(beside || line.box.y + line.box.height <= floating.box.y).toBe(true);
    });
  }
});
