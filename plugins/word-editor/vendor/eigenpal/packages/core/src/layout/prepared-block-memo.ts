// The per-block prepare memo of a section prepass, with what each entry was prepared under.

import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { PreparedBlock } from './section-prepass-types.ts';
import {
  createSubtreeAggregateMemo,
  LARGE_SUBTREE_ANSWER,
} from '../store/package/subtree-memo-policy.ts';

export interface PreparedBlockMemo {
  readonly contentWidth: number;
  readonly frameEnabled: boolean;
  /**
   * Whether the section that follows opens a new page, so a bare section mark drops its borders
   * and shading. A mark before a continuous section keeps them; the section type can change
   * without touching the mark paragraph.
   */
  readonly marksPageBreak: boolean;
  readonly producer: string;
  readonly drawingToken: string;
  readonly projectionToken: string;
  /**
   * The resolved list item this entry was prepared under, by its own cache token.
   *
   * The entry embeds the item's indent, its available width and its break-cache key, and none
   * of the other three validators can see a numbering change. The producer used to carry the
   * item COUNT, which hid this by going cold on any list edit — and by re-laying out every
   * paragraph in the document for one Enter in a list. With the count gone, this is the guard
   * that has to be right.
   */
  readonly listToken: string;
  /**
   * The resolved REF values this block paints, for the same reason {@link listToken} is
   * here: a renumbering or bookmark edit moves a REF's painted text while the block's node,
   * width and producer all stay identical. `''` for the common REF-free block.
   */
  readonly refToken: string;
  /**
   * Whether the inline-drawing context was present. Pass-constant, but the memo lives
   * across passes, so it must be compared here for {@link PreparedBlock.key} (which folds
   * it via `withDrawingContext`) to stay current when a caller toggles the context.
   */
  readonly drawingContext: boolean;
  readonly entry: PreparedBlock;
}

const memo = createSubtreeAggregateMemo<PreparedBlockMemo>();

/**
 * A prepared table holds every row of the table, so a table keeps an entry only for its
 * latest revision: the undo history keeps each old table node alive, and a weak entry on each
 * kept one whole prepared table per edit. Paragraph entries stay weak.
 */
export const preparedBlocks = {
  get: (block: OoxmlNode): PreparedBlockMemo | undefined => memo.get(block),
  set: (block: OoxmlNode, entry: PreparedBlockMemo): void =>
    memo.set(block, entry, block.kind === 'table' ? LARGE_SUBTREE_ANSWER : 0),
};
