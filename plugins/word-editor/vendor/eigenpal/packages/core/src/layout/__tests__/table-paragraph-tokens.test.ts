// Table token aggregates reuse unchanged rows after a cell edit (table-paragraph-tokens.ts,
// drawingTokenForTableBlockMemo, refTokenForTableBlock). A cell edit replaces the table node
// and one row; every other row keeps its identity. Each aggregate must equal the flat walk it
// replaces, and must re-read a row whenever the inputs its tokens depend on move.

import { describe, expect, test } from 'bun:test';
import {
  flattenContentControls,
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { collectFlowBlocks } from '../../store/package/content-control-walk.ts';
import { framedTokenJoin } from '../framed-token.ts';
import {
  aggregateParagraphTokensForTableBlock,
  createTableRowTokenStore,
  listTokenForTableBlock,
} from '../table-paragraph-tokens.ts';
import {
  drawingTokenForTableBlock,
  drawingTokenForTableBlockMemo,
} from '../inline-drawing-source.ts';
import {
  refTokenForTableBlock,
  resolveStoryRefFields,
  type RefFieldContext,
} from '../field-ref.ts';
import { storyRowParagraphs, walkStoryParagraphs } from '../story-paragraph-walk.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { ResolvedListItem } from '../list-resolve.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (...blocks: string[]): string => `<w:tc>${blocks.join('')}</w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]): string =>
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
  `${rows.join('')}</w:tbl>`;
const sdt = (content: string): string => `<w:sdt><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function bodyBlocks(xml: string): OoxmlElement[] {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  );
  if (!body || body.kind === 'textValue') throw new Error('no body');
  return body.children.filter((node): node is OoxmlElement => node.kind !== 'textValue');
}

function firstTable(xml: string): OoxmlElement {
  const found = bodyBlocks(xml).find((block) => block.kind === 'table');
  if (!found) throw new Error('no table');
  return found;
}

/** Rows a, b (nested table), c (inside a row content control), d (two paragraphs). */
function fixtureTable(prefix: string): OoxmlElement {
  return firstTable(
    table(
      row(cell(p(`${prefix}a1`)), cell(p(`${prefix}a2`))),
      row(
        cell(p(`${prefix}b1`), table(row(cell(p(`${prefix}n1`)), cell(p(`${prefix}n2`)))), p('')),
        cell(p(`${prefix}b2`))
      ),
      sdt(row(cell(p(`${prefix}c1`)), cell(p(`${prefix}c2`)))),
      row(cell(p(`${prefix}d1`), p(`${prefix}d1x`)), cell(p(`${prefix}d2`)))
    )
  );
}

/** Copy-on-write edit: a new table node whose `index`-th direct row is `replacement`. */
function withRow(source: OoxmlElement, index: number, replacement: OoxmlNode): OoxmlElement {
  const rows = source.children.filter((child) => child.kind === 'tableRow');
  const target = rows[index];
  if (!target) throw new Error('no row');
  return {
    ...source,
    children: source.children.map((child) => (child === target ? replacement : child)),
  } as OoxmlElement;
}

function directRow(source: OoxmlElement, index: number): OoxmlElement {
  const rows = source.children.filter((child) => child.kind === 'tableRow');
  return rows[index] as OoxmlElement;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(textOf).join('');
}

function counted(token: (paragraph: OoxmlNode) => string): {
  readonly fn: (paragraph: OoxmlNode) => string;
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    fn: (paragraph) => {
      calls += 1;
      return token(paragraph);
    },
    calls: () => calls,
  };
}

/** How many paragraph tokens the flat aggregate reads for a table. */
function flatCalls(node: OoxmlElement): number {
  const shape = counted(() => '');
  aggregateParagraphTokensForTableBlock(node, shape.fn);
  return shape.calls();
}

const TOKEN_SHAPES: readonly ((paragraph: OoxmlNode) => string)[] = [
  () => '',
  (paragraph) => (textOf(paragraph).includes('b') ? `drawing:${textOf(paragraph)}` : ''),
  // Digits, colons and separators inside a token cannot move a frame boundary.
  (paragraph) => `1:${textOf(paragraph)};0:`,
  (paragraph) => (textOf(paragraph) === '' ? 'empty' : ''),
];

describe('aggregateParagraphTokensForTableBlock row reuse', () => {
  test('reused rows give the flat aggregate for every token shape', () => {
    const before = fixtureTable('');
    const replacement = directRow(fixtureTable('edited-'), 1);
    const after = withRow(before, 1, replacement);
    for (const shape of TOKEN_SHAPES) {
      const reuse = { rows: createTableRowTokenStore(), scope: undefined, epoch: 'e' };
      expect(aggregateParagraphTokensForTableBlock(before, shape, reuse)).toBe(
        aggregateParagraphTokensForTableBlock(before, shape)
      );
      expect(aggregateParagraphTokensForTableBlock(after, shape, reuse)).toBe(
        aggregateParagraphTokensForTableBlock(after, shape)
      );
    }
  });

  test('a cell edit re-reads only the replaced row', () => {
    const before = fixtureTable('');
    const replacement = directRow(fixtureTable('edited-'), 2);
    const after = withRow(before, 2, replacement);
    const shape = counted(TOKEN_SHAPES[2]!);
    const reuse = { rows: createTableRowTokenStore(), scope: undefined, epoch: 'e' };
    aggregateParagraphTokensForTableBlock(before, shape.fn, reuse);
    const cold = shape.calls();
    expect(cold).toBe(flatCalls(before));
    const token = aggregateParagraphTokensForTableBlock(after, shape.fn, reuse);
    // Row d holds three paragraphs; no other row is read again.
    expect(shape.calls() - cold).toBe(3);
    expect(token).toBe(aggregateParagraphTokensForTableBlock(after, TOKEN_SHAPES[2]!));
    expect(token).toContain('edited-d1x');
  });

  test('a moved epoch or scope re-reads every row', () => {
    const tableNode = fixtureTable('');
    const rows = createTableRowTokenStore();
    const first = counted(TOKEN_SHAPES[1]!);
    aggregateParagraphTokensForTableBlock(tableNode, first.fn, {
      rows,
      scope: undefined,
      epoch: '1',
    });
    const walk = first.calls();

    // A new epoch with a different answer per paragraph must not serve the old segments.
    const changed = counted((paragraph) => `moved:${textOf(paragraph)}`);
    const atNewEpoch = aggregateParagraphTokensForTableBlock(tableNode, changed.fn, {
      rows,
      scope: undefined,
      epoch: '2',
    });
    expect(changed.calls()).toBe(walk);
    expect(atNewEpoch).toBe(
      aggregateParagraphTokensForTableBlock(tableNode, (paragraph) => `moved:${textOf(paragraph)}`)
    );

    const scope = {};
    const scoped = counted(TOKEN_SHAPES[3]!);
    const inNewScope = aggregateParagraphTokensForTableBlock(tableNode, scoped.fn, {
      rows,
      scope,
      epoch: '2',
    });
    expect(scoped.calls()).toBe(walk);
    expect(inNewScope).toBe(aggregateParagraphTokensForTableBlock(tableNode, TOKEN_SHAPES[3]!));
  });

  test('a cached row segment does not keep its scope alive', () => {
    const tableNode = fixtureTable('');
    const rows = createTableRowTokenStore();
    // Undo history keeps old rows alive. Their segments must not keep old list maps alive.
    const released = ((): WeakRef<object> => {
      const scope = new Map([['list', 'state']]);
      aggregateParagraphTokensForTableBlock(tableNode, TOKEN_SHAPES[1]!, {
        rows,
        scope,
        epoch: '',
      });
      return new WeakRef(scope);
    })();
    Bun.gc(true);
    expect(released.deref()).toBeUndefined();
    // A later scope never matches the released one's segments.
    const later = counted(TOKEN_SHAPES[1]!);
    aggregateParagraphTokensForTableBlock(tableNode, later.fn, { rows, scope: {}, epoch: '' });
    expect(later.calls()).toBe(flatCalls(tableNode));
  });
});

describe('table aggregates through their owners', () => {
  test('list tokens follow a new list map over reused rows', () => {
    const before = fixtureTable('');
    const after = withRow(before, 0, directRow(fixtureTable('edited-'), 0));
    const paragraphs = walkStoryParagraphs([before]);
    const listed = new Map([[paragraphs[3]!.id, { cacheToken: 'item:1' }]]);
    const flat = (node: OoxmlElement, items: ReadonlyMap<string, { cacheToken: string }>) =>
      aggregateParagraphTokensForTableBlock(
        node,
        (paragraph) => items.get(paragraph.id)?.cacheToken ?? ''
      );
    expect(listTokenForTableBlock(before, listed)).toBe(flat(before, listed));
    expect(listTokenForTableBlock(after, listed)).toBe(flat(after, listed));
    // Renumbering mints a new map: the reused rows answer the new marker.
    const renumbered = new Map([[paragraphs[3]!.id, { cacheToken: 'item:2' }]]);
    const token = listTokenForTableBlock(after, renumbered);
    expect(token).toBe(flat(after, renumbered));
    expect(token).toContain('item:2');
    expect(token).not.toContain('item:1');
  });

  test('with the cascade, a table with no numbered paragraph skips its rows', () => {
    const stylesRead = readOoxmlPart(`<w:styles xmlns:w="${W}"/>`, {
      name: '/word/styles.xml',
      contentType: 'app/xml',
    });
    if (!stylesRead.ok) throw new Error(stylesRead.reason);
    const cascade = buildStyleCascadeTable(stylesRead.part.root);
    const plain = fixtureTable('plain-');
    const numberedXml = table(
      row(
        cell(p('first')),
        cell('<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>')
      )
    );
    const numbered = firstTable(numberedXml);
    const item = (token: string) => ({ cacheToken: token }) as unknown as ResolvedListItem;
    const listedId = walkStoryParagraphs([numbered])[1]!.id;
    const items = new Map([
      [listedId, item('item:1')],
      [walkStoryParagraphs([plain])[0]!.id, item('stray')],
    ]);
    // No paragraph of the plain table can hold an item, so its token is empty either way.
    expect(listTokenForTableBlock(plain, items, cascade)).toBe('');
    // A numbered table answers exactly as the walk without the cascade does.
    expect(listTokenForTableBlock(numbered, items, cascade)).toBe(
      listTokenForTableBlock(numbered, items)
    );
    expect(listTokenForTableBlock(numbered, items, cascade)).toContain('item:1');
  });

  test('drawing tokens re-read only the edited row under one epoch', () => {
    const before = fixtureTable('');
    const after = withRow(before, 0, directRow(fixtureTable('edited-'), 0));
    const shape = counted(TOKEN_SHAPES[1]!);
    expect(drawingTokenForTableBlockMemo(before, 'drawing-epoch', shape.fn)).toBe(
      drawingTokenForTableBlock(before, TOKEN_SHAPES[1]!)
    );
    const cold = shape.calls();
    expect(drawingTokenForTableBlockMemo(after, 'drawing-epoch', shape.fn)).toBe(
      drawingTokenForTableBlock(after, TOKEN_SHAPES[1]!)
    );
    // The first row holds two paragraphs.
    expect(shape.calls() - cold).toBe(2);
    // An epoch-free caller keeps the full recompute path.
    drawingTokenForTableBlockMemo(after, undefined, shape.fn);
    expect(shape.calls() - cold).toBe(2 + flatCalls(after));
  });
});

/** The walk `walkStoryParagraphs` performed before rows were exposed separately. */
function previousWalk(blocks: readonly OoxmlElement[], maxTableDepth = 8): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const visit = (blockList: readonly OoxmlElement[], depth: number): void => {
    for (const block of blockList) {
      if (block.kind === 'paragraph') {
        out.push(block);
        continue;
      }
      if (block.kind !== 'table' || depth >= maxTableDepth) continue;
      for (const tableRow of flattenContentControls(block.children)) {
        if (tableRow.kind !== 'tableRow') continue;
        for (const tableCell of flattenContentControls(tableRow.children)) {
          if (tableCell.kind !== 'tableCell') continue;
          visit(collectFlowBlocks(tableCell.children), depth + 1);
        }
      }
    }
  };
  visit(blocks, 0);
  return out;
}

describe('walkStoryParagraphs', () => {
  test('keeps its order and depth limits when reading rows separately', () => {
    const blocks = bodyBlocks(
      p('lead') +
        table(
          row(cell(p('x1'), table(row(cell(table(row(cell(p('deep')))))))), cell(p('x2'))),
          sdt(row(cell(sdt(p('wrapped'))), cell(p('y2'))))
        ) +
        p('tail')
    );
    for (const depth of [0, 1, 2, 3, 8]) {
      const ids = (list: readonly OoxmlElement[]) => list.map((paragraph) => paragraph.id);
      // Twice: the second walk reads the row memo the first one filled.
      expect(ids(walkStoryParagraphs(blocks, depth))).toEqual(ids(previousWalk(blocks, depth)));
      expect(ids(walkStoryParagraphs(blocks, depth))).toEqual(ids(previousWalk(blocks, depth)));
    }
    const outer = blocks.find((block) => block.kind === 'table')!;
    const rows = flattenContentControls(outer.children).filter(
      (node): node is OoxmlElement => node.kind === 'tableRow'
    );
    expect(rows.flatMap((tableRow) => storyRowParagraphs(tableRow, 8).map(textOf))).toEqual(
      previousWalk([outer]).map(textOf)
    );
  });
});

/** A context built the way `resolveStoryRefFields` frames its values token. */
function refContext(tokens: ReadonlyMap<string, string>): {
  readonly context: RefFieldContext;
  readonly calls: () => number;
} {
  let calls = 0;
  const parts: string[] = [];
  for (const [id, token] of tokens) parts.push(id, token);
  return {
    context: {
      valuesToken: framedTokenJoin(parts),
      tokenForParagraph: (id) => {
        calls += 1;
        return tokens.get(id) ?? '';
      },
      liveValueOf: () => null,
    },
    calls: () => calls,
  };
}

/** The table REF token as the full paragraph walk folds it. */
function flatRefToken(node: OoxmlElement, context: RefFieldContext): string {
  return walkStoryParagraphs([node])
    .map((paragraph) => context.tokenForParagraph(paragraph.id))
    .filter(Boolean)
    .join(';');
}

describe('refTokenForTableBlock row reuse', () => {
  test('equals the flat fold for a resolved story', () => {
    const ref = (cached: string): string =>
      `<w:p><w:fldSimple w:instr=" REF target "><w:r><w:t>${cached}</w:t></w:r></w:fldSimple></w:p>`;
    const blocks = bodyBlocks(
      '<w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>Target</w:t></w:r>' +
        '<w:bookmarkEnd w:id="1"/></w:p>' +
        table(row(cell(ref('Old'))), row(cell(p('plain'), table(row(cell(ref('Target')))))))
    );
    const context = resolveStoryRefFields(blocks, undefined);
    if (!context) throw new Error('no REF context');
    const tableNode = blocks.find((block) => block.kind === 'table')!;
    const token = refTokenForTableBlock(tableNode, context);
    expect(token).not.toBe('');
    expect(token).toBe(flatRefToken(tableNode, context));
  });

  test('an equal values token carries rows; a moved one re-reads them', () => {
    const before = fixtureTable('');
    const paragraphs = walkStoryParagraphs([before]);
    const last = paragraphs.at(-1)!.id;
    const tokens = new Map([
      [paragraphs[0]!.id, 'l\u0001one'],
      [last, 'c\u0002two'],
    ]);
    const first = refContext(tokens);
    expect(refTokenForTableBlock(before, first.context)).toBe(
      flatRefToken(before, refContext(tokens).context)
    );
    expect(first.calls()).toBe(paragraphs.length);

    // The next pass builds a new context with the same values: only the edited row is read.
    const after = withRow(before, 0, directRow(fixtureTable('edited-'), 0));
    const second = refContext(tokens);
    expect(refTokenForTableBlock(after, second.context)).toBe(
      flatRefToken(after, refContext(tokens).context)
    );
    expect(second.calls()).toBe(2);

    // A REF value elsewhere moves the values token: every row answers the new value.
    const moved = new Map(tokens);
    moved.set(last, 'c\u0002three');
    const third = refContext(moved);
    const token = refTokenForTableBlock(after, third.context);
    expect(third.calls()).toBe(walkStoryParagraphs([after]).length);
    expect(token).toBe(flatRefToken(after, refContext(moved).context));
    expect(token).toContain('three');
    expect(token).not.toContain('two');
  });

  test('a context without REF values aggregates to the empty string', () => {
    const empty = refContext(new Map());
    expect(refTokenForTableBlock(fixtureTable(''), empty.context)).toBe('');
    expect(empty.calls()).toBe(0);
  });
});
