// The drawing token of a table block: the per-paragraph drawing tokens of its cells, joined
// by the shared position-preserving walk, and memoized per table node and drawing epoch.

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { createSubtreeAggregateMemo } from '../store/package/subtree-memo-policy.ts';
import {
  aggregateParagraphTokensForTableBlock,
  createTableRowTokenStore,
} from './table-paragraph-tokens.ts';

/**
 * `drawingTokenForTableBlock` memoized per (immutable table node, drawing epoch).
 *
 * The table token exists to VALIDATE the prepass memo, so it is recomputed before every
 * memo hit — which walked every row and cell of every table on every layout pass. The
 * token is a pure function of the table subtree (node identity) and the part's drawing
 * projection/resource state, and `drawingLayoutEpoch` already stands in for the latter
 * (it moves whenever any projection or resource in the part does). No epoch means the
 * caller cannot see resource moves, so the recompute path is kept — the same rule the
 * section prepass memo follows.
 */
export function drawingTokenForTableBlockMemo(
  table: OoxmlNode,
  epoch: string | undefined,
  drawingTokenForParagraph: (paragraph: OoxmlNode) => string
): string {
  if (epoch === undefined) return drawingTokenForTableBlock(table, drawingTokenForParagraph);
  const cached = tableDrawingTokenCache.get(table);
  if (cached && cached.epoch === epoch) return cached.token;
  // Rows keep their identity across a cell edit, so their segments answer under the same epoch.
  const reuse = { rows: rowDrawingTokens, scope: undefined, epoch };
  const token = aggregateParagraphTokensForTableBlock(table, drawingTokenForParagraph, reuse);
  // A token grows with the table: about one item per 64 characters.
  tableDrawingTokenCache.set(table, { epoch, token }, token.length >> 6);
  return token;
}

/** Aggregated drawing token per immutable table node, valid for one drawing epoch. */
const tableDrawingTokenCache = createSubtreeAggregateMemo<{
  readonly epoch: string;
  readonly token: string;
}>();
const rowDrawingTokens = createTableRowTokenStore();

/**
 * Aggregate per-paragraph drawing tokens for a table subtree (cache + incremental keys).
 *
 * The shared position-preserving walk (`aggregateParagraphTokensForTableBlock`): a
 * per-paragraph token embeds file-influenced values and its own printable separators, so a
 * printable join lets a token value shift a boundary, and sorting or skipping empties lets
 * two different paragraph-to-token ASSIGNMENTS over one byte-identical subtree concatenate
 * to the same string — and the table's prepared-block memo then serves a break with stale
 * drawing layout.
 */
export function drawingTokenForTableBlock(
  table: OoxmlNode,
  drawingTokenForParagraph: (paragraph: OoxmlNode) => string
): string {
  return aggregateParagraphTokensForTableBlock(table, drawingTokenForParagraph);
}
