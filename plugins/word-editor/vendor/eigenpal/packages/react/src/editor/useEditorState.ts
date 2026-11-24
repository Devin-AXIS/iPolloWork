// Selector-based editor state subscription — the product of the composition layer.
//
// ONE multiplexed subscription per consumer: `change`, `selectionChange`, and `error`
// all funnel into the same store-changed signal, because the facade bumps its state
// tick on each of them and `snapshot()` is version-cached (SAME reference until state
// moves, sub-objects reference-stable). That cache is what makes this hook safe and
// cheap under `useSyncExternalStore`: getSnapshot can be called any number of times
// per event and does no work after the first.
//
// SELECTOR MEMOIZATION (the with-selector pattern, implemented directly). The hook
// caches the last (snapshot, slice) pair. On a store event it re-derives the slice
// and compares with `isEqual` (default `Object.is`); an equal result returns the
// PREVIOUS slice reference, so `useSyncExternalStore` bails out and the component does
// not re-render. A page-number consumer therefore sleeps through bold toggles. Because
// the facade keeps `formatting`/`page` sub-objects reference-stable across unrelated
// changes, `Object.is` already suffices for selectors that pick a sub-object; pass a
// custom `isEqual` when deriving fresh objects. For full effectiveness pass a stable
// selector (module-level or `useCallback`); an inline selector still renders correctly,
// it just re-primes the memo each render.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { deferredTick } from './deferred-notifier';
import { LOADING_SNAPSHOT } from './loading-snapshot';

const NOOP_UNSUBSCRIBE = () => {};

let activeEditorStateSubscriptions = 0;

/** @internal Test seam — count of mounted {@link useEditorState} multiplexed subscriptions. */
export function editorStateActiveSubscriptionCount(): number {
  return activeEditorStateSubscriptions;
}

/**
 * Notifications are COALESCED AND DEFERRED, for two reasons:
 *
 * 1. Correctness. The facade's `change` event fires mid-commit — before the layout
 *    scheduler's synchronous publish inside the same `exec` call. React's
 *    `useSyncExternalStore` reads `getSnapshot` synchronously inside a notification,
 *    and the facade's version-cached `snapshot()` would derive its formatting from the
 *    not-yet-published layout and cache that stale answer for the whole version. A
 *    microtask runs after the commit's synchronous work, so the first read of the
 *    new version sees the published layout.
 * 2. Efficiency and update-depth safety. One commit can emit `change` AND
 *    `selectionChange`; coalescing turns the burst into a single re-render pass. When
 *    the browser reports more hardware input waiting — or too many notification waves
 *    have gone by without the event loop reaching a timer — a task replaces the usual
 *    microtask, so sustained key repeat cannot chain synchronous React store updates
 *    past React's maximum-update-depth guard even though every update is legitimate.
 *    The wave policy lives in {@link deferredTick}'s module, shared with the Vue twin.
 */
export function deferredNotifier(onStoreChange: () => void): () => void {
  return deferredTick(onStoreChange);
}

/** Optional lifecycle hooks for test instrumentation. @internal */
export interface UseEditorStateOptions {
  readonly onSubscribe?: () => void;
  readonly onUnsubscribe?: () => void;
}

/**
 * Subscribe to a slice of the editor's read model. Re-renders the component ONLY when
 * `selector`'s result changes (by `isEqual`, default `Object.is`).
 *
 * Before the editor exists — outside a `DocxEditor.Root`, pre-mount, and on the
 * server — the selector receives a frozen loading snapshot (`isLoading: true`,
 * `page: {current: 0, total: 0}`), never `null`.
 *
 * @public
 */
export function useEditorState<T>(
  selector: (snapshot: EditorSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  options?: UseEditorStateOptions
): T {
  const editor = useDocxEditor();
  const onSubscribe = options?.onSubscribe;
  const onUnsubscribe = options?.onUnsubscribe;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!editor) return NOOP_UNSUBSCRIBE;
      let disposed = false;
      activeEditorStateSubscriptions++;
      onSubscribe?.();
      const notify = deferredNotifier(() => {
        if (!disposed) onStoreChange();
      });
      const unsubscribes = [
        editor.on('change', notify),
        editor.on('selectionChange', notify),
        editor.on('error', notify),
      ];
      return () => {
        disposed = true;
        activeEditorStateSubscriptions--;
        onUnsubscribe?.();
        for (const off of unsubscribes) off();
      };
    },
    [editor, onSubscribe, onUnsubscribe]
  );

  // The memoized selection function: keyed on the inputs that change its meaning, it
  // holds the last snapshot/slice pair across store events for the equality bail-out.
  const getSelection = useMemo(() => {
    let hasMemo = false;
    let memoSnapshot: EditorSnapshot;
    let memoSlice: T;
    return (snapshot: EditorSnapshot): T => {
      if (hasMemo && snapshot === memoSnapshot) return memoSlice;
      const next = selector(snapshot);
      if (hasMemo && isEqual(memoSlice, next)) {
        memoSnapshot = snapshot;
        return memoSlice;
      }
      hasMemo = true;
      memoSnapshot = snapshot;
      memoSlice = next;
      return next;
    };
  }, [editor, selector, isEqual]);

  const getSnapshot = useCallback(
    () => getSelection(editor ? editor.snapshot() : LOADING_SNAPSHOT),
    [editor, getSelection]
  );
  const getServerSnapshot = useCallback(() => getSelection(LOADING_SNAPSHOT), [getSelection]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
