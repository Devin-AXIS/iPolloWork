// Host chrome for links: the UI that Ctrl/Cmd+K and the `text.link` control ask to open.
//
// The press runs no engine command. A link needs a target first, and only a link UI can supply
// one: the link popover when it mounts, or a host's own through `setHyperlinkChrome`. So the
// control is enabled only while such a UI is registered with an `onRequest`, and opening it
// goes through the same handler as Ctrl/Cmd+K. Without one, an enabled control would do
// nothing.
//
// The registration lives on the editor, not on a surface: chrome mounts after the editor
// exists, and a document that reloads must keep it.

import type { Editor, EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import type { HyperlinkChromeHandlers } from './docx-editor-types.ts';
import { createRequestChrome } from './bookmark-chrome.ts';

/** What the `text.link` control asks of the registered link chrome. */
export interface LinkRequests {
  /** Whether any chrome is registered to open the link UI. */
  readonly canOpen: () => boolean;
  /** Ask the registered chrome to open insert-or-edit; false when none is registered. */
  readonly open: () => boolean;
}

/** The refusal while no chrome is registered to open the link UI. */
export const NO_LINK_VIEW = 'no link view is registered';

/**
 * Asks whether the selection could become a link. The target is a placeholder: the real one
 * comes from the link UI, and this command never runs.
 */
export const LINK_PROBE: EditorCommand = {
  type: 'insertHyperlink',
  href: 'https://example.com',
};

// Keyed by facade, so the toolbar can reach the requests without a member on the public
// instance type.
const requestsByEditor = new WeakMap<object, LinkRequests>();

export function createLinkChrome(changed: (() => void) | undefined) {
  const chrome = createRequestChrome<HyperlinkChromeHandlers>(changed);
  const requests: LinkRequests = { canOpen: chrome.canOpen, open: chrome.open };
  return {
    requests,
    /** The handlers that answer now, for the surface's link clicks. */
    current: chrome.current,
    /** Ctrl/Cmd+K: the same request the `text.link` control sends. */
    open: chrome.open,
    register: (handlers: HyperlinkChromeHandlers): (() => void) => chrome.register(handlers),
  };
}

/** Make a facade's link requests reachable from `linkRequestsOf`. */
export function bindLinkRequests(editor: object, requests: LinkRequests): void {
  requestsByEditor.set(editor, requests);
}

/** The link requests of a facade, or null for an editor that has none. */
export function linkRequestsOf(editor: object): LinkRequests | null {
  return requestsByEditor.get(editor) ?? null;
}

/** The `text.link` control's state, with the same shape as every other toolbar state. */
export interface LinkControlState {
  readonly id: 'text.link';
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly active: false;
}

/**
 * Whether the `text.link` control can open the link UI: the engine would accept a link at the
 * selection, and a link UI is registered. The engine's refusal comes first, because it is the
 * reason a person can act on.
 */
export function linkControlState(editor: Editor): LinkControlState {
  const refuse = (reason: string): LinkControlState => ({
    id: 'text.link',
    enabled: false,
    disabledReason: reason,
    active: false,
  });
  const judged = editor.can(LINK_PROBE);
  if (!judged.ok) return refuse(judged.reason);
  if (!linkRequestsOf(editor)?.canOpen()) return refuse(NO_LINK_VIEW);
  return { id: 'text.link', enabled: true, disabledReason: null, active: false };
}
