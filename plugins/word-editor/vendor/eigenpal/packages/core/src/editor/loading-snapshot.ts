import { DEFAULT_REVISION_MARKUP } from '../contracts/revision-markup.ts';
import { DEFAULT_REVIEW_PANE } from '../contracts/review-pane.ts';
// The one pre-mount read model, shared by every path that answers "no editor yet".
// Framework-free — both adapters re-export it.

import type { EditorSnapshot } from '../contracts/editor.ts';

/**
 * What `snapshot()` reports before an editor exists: loading, not editable, nothing
 * selected, nothing undoable — never invented state.
 *
 * @public
 */
export const LOADING_SNAPSHOT: EditorSnapshot = Object.freeze({
  revisionMarkup: DEFAULT_REVISION_MARKUP,
  reviewPane: DEFAULT_REVIEW_PANE,
  scope: Object.freeze({ kind: 'body' as const }),
  isLoading: true,
  isOpening: false,
  parseError: null,
  openFailure: null,
  editable: false,
  zoom: 1,
  selection: null,
  selectionCollapsed: true,
  selectionRange: null,
  formatting: null,
  table: null,
  tocContext: null,
  image: null,
  chart: null,
  page: Object.freeze({ current: 0, total: 0 }),
  canUndo: false,
  canRedo: false,
  collaborationStatus: 'inactive',
});
