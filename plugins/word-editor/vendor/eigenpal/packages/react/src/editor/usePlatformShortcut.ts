// Shortcut labels that name the reader's own modifier keys, without breaking hydration.
//
// `platformShortcut` reads `navigator`, which does not exist on a server. Called straight
// from render, that makes the server emit "Bold (Ctrl+B)" and a Mac client render "Bold
// (⌘+B)" — a hydration mismatch on an `aria-label`, a `title` and a menu row's text node.
//
// `useSyncExternalStore` is the shape React provides for exactly this: the server snapshot
// is what the first (hydrating) render uses, and the client snapshot takes over immediately
// after, as a normal update rather than as a mismatch. The store never changes — a keyboard
// does not become a different platform — so `subscribe` has nothing to do.

import { useCallback, useSyncExternalStore } from 'react';
import { platformShortcut } from '@docx-editor.dev/i18n';

/** Nothing to subscribe to: the platform is fixed for the life of the page. */
const NEVER = () => () => {};
const CLIENT = () => true;
const SERVER = () => false;

/**
 * A label formatter that names the modifier keys this reader's keyboard has.
 *
 * Identity-stable, so it can sit in a dependency array.
 *
 * @internal
 */
export function usePlatformShortcut(): (text: string) => string {
  const resolved = useSyncExternalStore(NEVER, CLIENT, SERVER);
  return useCallback((text: string) => (resolved ? platformShortcut(text) : text), [resolved]);
}
