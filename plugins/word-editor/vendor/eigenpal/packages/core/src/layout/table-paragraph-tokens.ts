// Per-paragraph token aggregates over a table subtree (list, drawing, semantic projection).
//
// A table's aggregate validates its prepared-block memo and enters its cache key, so it is
// rebuilt for every new table node. Typing in one cell replaces the table node but keeps every
// other row by identity, so the aggregate reuses each unchanged row's framed segment. The
// result is the same string the flat paragraph walk produces.

import { listLayoutToken } from './list-marker-reuse.ts';
import { blockHasNumberedParagraphs, type ResolvedListItem } from './list-resolve.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { framedTokenJoin } from './framed-token.ts';

/**
 * Tokens longer than this are computed transiently instead of retained. A table token embeds
 * its whole subtree, so a hostile document nesting a large payload inside ~50 table levels
 * would otherwise retain depth × payload of strings for the document's lifetime; the ceiling
 * bounds retention while leaving every realistic paragraph and table memoized.
 */
const MAX_MEMOIZED_TOKEN_LENGTH = 1 << 18;

/** One row's framed paragraph tokens, valid for the inputs it was computed under. */
interface RowTokenSegment {
  readonly scope: number;
  readonly epoch: string;
  readonly framed: string;
  /** Whether any paragraph of the row answered a non-empty token. */
  readonly any: boolean;
}

// Scope identity must not retain projector closures or old list maps through undo rows.
const scopeIdentities = new WeakMap<object, number>();
let nextScopeIdentity = 1;
function scopeIdentity(scope: object | undefined): number {
  if (scope === undefined) return 0;
  let identity = scopeIdentities.get(scope);
  if (identity === undefined) scopeIdentities.set(scope, (identity = nextScopeIdentity++));
  return identity;
}

/**
 * Row segments of ONE aggregate kind. A per-paragraph token reads its paragraph node and
 * the caller's inputs, which `scope` (by identity) and `epoch` (by value) stand for. Every
 * kind owns its own store, so two kinds never answer each other's segments.
 */
export interface TableRowTokenReuse {
  readonly rows: WeakMap<OoxmlNode, RowTokenSegment>;
  readonly scope: object | undefined;
  readonly epoch: string;
}

/**
 * The latest aggregate of one kind for a table, found through the table's first row.
 *
 * Typing in any other row gives the table a new node but keeps the first row's node. The new
 * aggregate then compares its pieces with these, in order and by value, and returns this very
 * string when every piece is equal, instead of joining an equal copy. The joined string is a
 * function of its pieces alone, so the answer is exact whatever the scope, epoch or anchor
 * were. Every table node's memo (one per undo revision) then shares one string.
 *
 * One entry per first-row node, replaced on each join: it holds strings only, and the row is
 * a weak key, so no tree, projector or history state is kept alive through it.
 */
interface LatestAggregate {
  readonly pieces: readonly string[];
  readonly token: string;
}
const latestByStore = new WeakMap<object, WeakMap<OoxmlNode, LatestAggregate>>();

function latestStoreOf(rows: object): WeakMap<OoxmlNode, LatestAggregate> {
  let latest = latestByStore.get(rows);
  if (!latest) latestByStore.set(rows, (latest = new WeakMap()));
  return latest;
}

function samePieces(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

let aggregateObserver: { joined: number; reused: number } | null = null;

/**
 * @internal Counts row-reuse aggregates joined anew and answered with the latest equal
 * string, for tests that must see the sharing (string identity is not observable).
 */
export function tableAggregateReuseTestRecorder(): {
  readonly joined: number;
  readonly reused: number;
  dispose(): void;
} {
  const counts = { joined: 0, reused: 0 };
  aggregateObserver = counts;
  return {
    get joined() {
      return counts.joined;
    },
    get reused() {
      return counts.reused;
    },
    dispose() {
      if (aggregateObserver === counts) aggregateObserver = null;
    },
  };
}

/** A fresh row-segment store for one aggregate kind. */
export function createTableRowTokenStore(): WeakMap<OoxmlNode, RowTokenSegment> {
  return new WeakMap();
}

/**
 * ONE walk for every per-paragraph token aggregate over a table subtree (list, drawing,
 * semantic projection), so framing and traversal cannot drift between copies. Empty slots
 * preserve paragraph position; netstring framing stays injective even if a future token
 * contains NUL or another file-controlled delimiter. Empty when no paragraph carries a token,
 * so token-free tables keep keying as before. Callers own their table memoization.
 *
 * With `reuse`, each row answers its framed segment from the row store when the row node,
 * scope and epoch are unchanged. `framedTokenJoin` frames each part independently and
 * concatenates the frames, so the joined row segments equal the flat join. When every piece
 * equals the latest aggregate found through the first row, that string is returned instead
 * of an equal new join (`LatestAggregate`).
 */
export function aggregateParagraphTokensForTableBlock(
  table: OoxmlNode,
  tokenForParagraph: (paragraph: OoxmlNode) => string,
  reuse?: TableRowTokenReuse
): string {
  if (!reuse) {
    const tokens: string[] = [];
    let any = false;
    for (const paragraph of tableParagraphsInOrder(table)) {
      const token = tokenForParagraph(paragraph);
      if (token) any = true;
      tokens.push(token);
    }
    return any ? framedTokenJoin(tokens) : '';
  }
  // The same document-order walk as `tableParagraphsInOrder`, stopping at rows.
  const pieces: string[] = [];
  let any = false;
  let anchor: OoxmlNode | undefined;
  const stack: OoxmlNode[] = [table];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node !== table && node.kind === 'tableRow') {
      anchor ??= node;
      const segment = rowSegment(node, tokenForParagraph, reuse);
      if (segment.any) any = true;
      pieces.push(segment.framed);
      continue;
    }
    if (node.kind === 'paragraph') {
      const token = tokenForParagraph(node);
      if (token) any = true;
      pieces.push(framedTokenJoin([token]));
      continue;
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  if (!any) return '';
  const latest = anchor && latestStoreOf(reuse.rows).get(anchor);
  if (latest && samePieces(latest.pieces, pieces)) {
    if (aggregateObserver) aggregateObserver.reused += 1;
    return latest.token;
  }
  const token = pieces.join('');
  if (aggregateObserver) aggregateObserver.joined += 1;
  if (anchor && token.length <= MAX_MEMOIZED_TOKEN_LENGTH)
    latestStoreOf(reuse.rows).set(anchor, { pieces, token });
  return token;
}

function rowSegment(
  row: OoxmlNode,
  tokenForParagraph: (paragraph: OoxmlNode) => string,
  reuse: TableRowTokenReuse
): RowTokenSegment {
  const scope = scopeIdentity(reuse.scope);
  const known = reuse.rows.get(row);
  if (known && known.scope === scope && known.epoch === reuse.epoch) return known;
  const tokens: string[] = [];
  let any = false;
  for (const paragraph of tableParagraphsInOrder(row)) {
    const token = tokenForParagraph(paragraph);
    if (token) any = true;
    tokens.push(token);
  }
  const segment: RowTokenSegment = {
    scope,
    epoch: reuse.epoch,
    framed: framedTokenJoin(tokens),
    any,
  };
  if (segment.framed.length <= MAX_MEMOIZED_TOKEN_LENGTH) reuse.rows.set(row, segment);
  return segment;
}

/**
 * The paragraphs of a table subtree in document order, not descending into a paragraph
 * (hosted text-box paragraphs are represented by their host), per immutable table node.
 *
 * Callers memoize their tokens on the table AND their own input (the list map, a drawing
 * epoch), and that input moves with edits far from the table — Enter anywhere in a section
 * mints a new list map. The walk itself only depends on the table, so it runs once per node.
 */
const tableParagraphs = new WeakMap<OoxmlNode, readonly OoxmlNode[]>();
function tableParagraphsInOrder(table: OoxmlNode): readonly OoxmlNode[] {
  const cached = tableParagraphs.get(table);
  if (cached) return cached;
  const paragraphs: OoxmlNode[] = [];
  const stack: OoxmlNode[] = [table];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node !== table && node.kind === 'tableRow') {
      for (const paragraph of tableParagraphsInOrder(node)) paragraphs.push(paragraph);
      continue;
    }
    if (node.kind === 'paragraph') {
      paragraphs.push(node);
      continue;
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  if (table.kind !== 'tableRow' || paragraphs.length <= 256) tableParagraphs.set(table, paragraphs);
  return paragraphs;
}

/**
 * Aggregate the list tokens of every paragraph a table contains, memoized per (table,
 * listItems) pair — both immutable, so the walk runs once per numbering state instead of
 * once per pass. An empty slot is retained for every unlisted paragraph, so token position
 * remains significant even when neighboring paragraphs have equal authored content.
 */
const tableListTokens = new WeakMap<object, WeakMap<object, string>>();
const rowListTokens = createTableRowTokenStore();
export function listTokenForTableBlock(
  table: OoxmlNode,
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  styleCascade?: StyleCascadeTable
): string {
  if (!listItems || listItems.size === 0) return '';
  // With the cascade the resolve used, a table with no numbered paragraph has no item: a list
  // edit elsewhere mints a new map, and this skips walking every row of such a table.
  if (
    styleCascade !== undefined &&
    table.kind !== 'textValue' &&
    !blockHasNumberedParagraphs(table, styleCascade)
  ) {
    return '';
  }
  // Nested weak keying: neither the table nor the list map is retained by the memo, and two
  // consumers preparing one table under different list maps both stay warm.
  let byListItems = tableListTokens.get(table);
  const cached = byListItems?.get(listItems);
  if (cached !== undefined) return cached;
  const token = aggregateParagraphTokensForTableBlock(
    table,
    (paragraph) => {
      const item = listItems.get(paragraph.id);
      return item ? listLayoutToken(item) : '';
    },
    { rows: rowListTokens, scope: listItems, epoch: '' }
  );
  if (token.length <= MAX_MEMOIZED_TOKEN_LENGTH) {
    if (!byListItems) {
      byListItems = new WeakMap();
      tableListTokens.set(table, byListItems);
    }
    byListItems.set(listItems, token);
  }
  return token;
}
