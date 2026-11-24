import { sharedCellContentInsets, widenedCellContentInsets } from './cell-content-insets-memo.ts';
import { autofitReuseScope } from './autofit-context-reuse.ts';
import { verifiedAutofitScope } from './autofit-verified-scope.ts';
import type { AutofitView, TableAutofitContext } from './table-autofit-widths.ts';
import type { SemanticTableCell } from './semantic-table.ts';
import { listItemToken } from './list-marker-reuse.ts';

export interface AutofitCellWidths {
  readonly least: number;
  /** {@link least} once the column has to widen (`ContentWidths.minWidened`). */
  readonly leastWidened: number;
  readonly most: number;
  readonly left: number;
  readonly right: number;
  readonly wideLeft: number;
  readonly wideRight: number;
}
interface Memo {
  verifiedScope: string | undefined;
  readonly scope: object;
  readonly cascade: AutofitView['styleCascade'];
  readonly mode: AutofitView['displayMode'];
  readonly authors: string;
  readonly collapsed: boolean;
  /** The cell's paragraphs' tokens: a scope can outlive a change to their inputs. */
  readonly lists: string;
  readonly value: AutofitCellWidths;
}

/**
 * Each paragraph's token: its list, REF, projection and drawing inputs, the same token the
 * per-paragraph minimums key on. A scope can outlive a change to any of them, so each cell
 * proves its own.
 */
function cellParagraphTokens(cell: SemanticTableCell, context: TableAutofitContext): string {
  const tokenOf = context.paragraphToken;
  let token = '';
  for (const block of cell.blocks) {
    token += tokenOf
      ? `${tokenOf(block)}\0`
      : `${listItemToken(context.listItems?.get(block.id))}\0`;
  }
  return token;
}
const memos = new WeakMap<SemanticTableCell, Memo>();

/** Reuse cell measurements only within a section's proven unchanged projection scope. */
export function cachedAutofitCellWidths(
  cell: SemanticTableCell,
  collapsed: boolean,
  context: TableAutofitContext,
  view: AutofitView,
  read: () => AutofitCellWidths
): AutofitCellWidths {
  const scope = autofitReuseScope(context);
  // Nested table reads also depend on their depth and reader. Keep their regular path.
  if (!scope || cell.blocks.some((block) => block.kind === 'table')) return read();
  const known = memos.get(cell);
  const authors = view.authorFilter?.cacheKey ?? '';
  const verifiedScope = verifiedAutofitScope(context);
  const sameInputs =
    known?.scope === scope &&
    known.cascade === view.styleCascade &&
    known.mode === view.displayMode &&
    known.authors === authors &&
    known.collapsed === collapsed;
  if (sameInputs && verifiedScope !== undefined && known.verifiedScope === verifiedScope)
    return known.value;
  const lists = cellParagraphTokens(cell, context);
  if (sameInputs && known.lists === lists) {
    known.verifiedScope = verifiedScope;
    return known.value;
  }
  const value = read();
  memos.set(cell, {
    verifiedScope,
    scope,
    cascade: view.styleCascade,
    mode: view.displayMode,
    authors,
    collapsed,
    lists,
    value,
  });
  return value;
}

/**
 * The cell's horizontal insets after widening. A narrow table may share its grid lines or
 * keep legacy content alignment, and widening can end either; the larger insets of the two
 * geometries keep the word that widened the column whole in both.
 */
export function widenedCellInsets(
  cell: SemanticTableCell,
  collapsed: boolean,
  current: { readonly left: number; readonly right: number },
  /** A flag-free copy from the same row, retained for width-dependent side-rule retargeting. */
  widenedCell?: SemanticTableCell
) {
  if (!cell.centeredSideRules && !cell.legacyContentAlignment) return current;
  const fullStroke =
    widenedCell && !widenedCell.legacyContentAlignment && !widenedCell.centeredSideRules
      ? sharedCellContentInsets(widenedCell, collapsed)
      : widenedCellContentInsets(cell, collapsed);
  return {
    left: Math.max(current.left, fullStroke.left),
    right: Math.max(current.right, fullStroke.right),
  };
}
