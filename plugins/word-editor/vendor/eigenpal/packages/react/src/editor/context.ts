// The provider-first composition layer's one piece of shared state: the editor instance.
//
// `DocxEditorRoot` owns the facade's lifetime and publishes it here; `DocxEditorContent`
// and every hook read it. The value is `null` until the Root's mount effect has run —
// hooks answer with honest loading state rather than throwing, so a toolbar can render
// on the very first frame without guarding.

import { createContext, useContext } from 'react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

export const DocxEditorContext = createContext<DocxEditorInstance | null>(null);

/**
 * The editor instance from the nearest `DocxEditor.Root`, or `null` before the Root's
 * mount effect has created it (and outside any Root). Deliberately not a throwing
 * variant: pre-mount is a normal frame every consumer renders through, and the state
 * hooks built on this already answer it with a typed loading snapshot.
 *
 * @public
 */
export function useDocxEditor(): DocxEditorInstance | null {
  return useContext(DocxEditorContext);
}

/**
 * Whether a review rail is mounted under this Root, and how much room it wants.
 *
 * The GUTTER is the reason this exists. `DocxEditor.Viewport` reserves space beside the
 * page for the pane, and the ruler shifts by the same amount — but neither of them can see
 * whether a rail was actually composed in. Keyed on the pane's open state alone, every
 * consumer of the tier-2 `<DocxEditor>` sugar (which mounts no rail) had its page pushed
 * 158px off centre beside an empty column.
 *
 * A rail registers on mount and unregisters on unmount, so the reservation follows what is
 * really on screen. Count rather than boolean: StrictMode mounts twice, and a host may
 * legitimately compose two rails.
 */
export interface ReviewRailRegistry {
  /**
   * Review columns registered through `register`: the packaged rail, and any column that
   * serves comment drafts. The Add comment controls in the toolbar and the context menu
   * appear only while this is above zero.
   */
  readonly mounted: number;
  /**
   * Register a review column that serves comment drafts. Also reserves the review gutter.
   * Call it on mount, together with `registerCommentDraft`. Returns the unregister function.
   */
  readonly register: () => () => void;
  /**
   * Claims registered through `reserveGutter`: columns that need the review gutter but
   * serve no comment draft. The viewport reserves the gutter while `mounted + gutters` is
   * above zero.
   */
  readonly gutters?: number;
  /** Reserve the review gutter without showing comment controls. Returns the release. */
  readonly reserveGutter?: () => () => void;
  /**
   * Receive the Add comment requests. The handler takes no arguments: it reads the
   * selection's position with `getSelectionPlacement`, pins the selection with
   * `retainSelection`, and opens the pane. Release the pin with `releaseSelection` when the
   * draft closes or is cancelled. The most recently registered handler receives each request. Do not register
   * while the column cannot open a draft, such as in viewing mode: a request counts as
   * served once a handler runs. While a handler is registered, the `review.addComment`
   * control is enabled. Returns the unregister function.
   */
  readonly registerCommentDraft: (handler: () => void) => () => void;
  /**
   * Send an Add comment request through the `review.addComment` control. The most recent
   * registration receives it: a handler registered here, or one registered with
   * `useCommentDraftRequest`. Returns `true` when a handler ran, even if it then opened
   * nothing, and `false` when the control is disabled.
   */
  readonly requestCommentDraft: () => boolean;
}

/** Whether anything under the Root claims the review gutter. @internal */
export function claimsReviewGutter(registry: ReviewRailRegistry | null | undefined): boolean {
  return (registry?.mounted ?? 0) + (registry?.gutters ?? 0) > 0;
}

export const ReviewRailContext = createContext<ReviewRailRegistry | null>(null);
