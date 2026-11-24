// Focus in and out of the navigation pane, Escape, and the Ctrl/Cmd+F shortcut.
//
// Focus requests are REFS answered by the next render. The pane may be controlled, so a
// request is made before the host has opened (or closed) the pane, and the render that
// follows is the host's answer: a request the pane now satisfies is honoured, and one the
// host declined is dropped there, so it cannot fire on some unrelated later open. A host
// that declines without rendering at all gets the same answer from a zero-delay timer,
// which runs after React has flushed the event's updates.
//
// Refs rather than state also keep a click on the disc of a controlled, declining pane from
// re-rendering anything.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useDocxEditor } from '../context';
import type { NavigationIntents } from './navigation-context';
import { useNavigationViewportElement } from './navigation-layout';
import {
  focusPaneEntry,
  coverPage,
  isFindShortcut,
  isGoToShortcut,
  ownsShortcutTarget,
  paneEntryTarget,
  publishViewportSize,
  returnFocus,
} from './navigation-keys';
import type {
  NavigationTab as NavigationTabId,
  UseNavigationPaneResult,
} from './useNavigationPane';
import { hostWindowOf, isHTMLElementNode } from '@docx-editor.dev/core/editor';

/** @internal */
export interface NavigationFocus {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly intents: NavigationIntents;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** @internal */
export function useNavigationFocus(
  pane: UseNavigationPaneResult,
  findShortcut = true,
  goToShortcut = true
): NavigationFocus {
  const editor = useDocxEditor();
  const viewport = useNavigationViewportElement();
  const rootRef = useRef<HTMLDivElement>(null);
  // Who opened the pane: an element to return focus to, or null for the disc.
  const opener = useRef<HTMLElement | null>(null);
  const focusRequest = useRef(false);
  const restoreRequest = useRef(false);
  // A pick from an overlaying pane asked to close it; the document takes focus once it has.
  const pickRequest = useRef(false);
  const requestToken = useRef(0);
  // Drop whatever is still pending once the event's updates have flushed.
  const expireRequests = useCallback(() => {
    const token = ++requestToken.current;
    hostWindowOf(rootRef.current).setTimeout(() => {
      if (requestToken.current !== token) return;
      focusRequest.current = false;
      restoreRequest.current = false;
      pickRequest.current = false;
    }, 0);
  }, []);

  const paneRef = useRef(pane);
  paneRef.current = pane;

  const focusEntry = useCallback(() => {
    focusRequest.current = false;
    const target = paneEntryTarget(rootRef.current, paneRef.current.tab);
    if (target) focusPaneEntry(target);
  }, []);

  const restoreFocus = useCallback(() => {
    restoreRequest.current = false;
    const back = opener.current;
    opener.current = null;
    const disc = rootRef.current?.querySelector<HTMLElement>('.docx-nav__toggle') ?? null;
    returnFocus(back, disc, editor ? () => editor.focus() : null);
  }, [editor]);

  // A host may answer a close by unmounting the pane in `onOpenChange(false)`. No render
  // of this component follows, so the unmount answers the pending return of focus instead.
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  useEffect(
    () => () => {
      if (restoreRequest.current) restoreFocusRef.current();
    },
    []
  );

  const close = useCallback(() => {
    focusRequest.current = false;
    restoreRequest.current = true;
    paneRef.current.setOpen(false);
    expireRequests();
  }, [expireRequests]);

  // Open the pane on `tab` and focus its entry. `opener` gets focus back when it closes.
  const openTab = useCallback(
    (tab: NavigationTabId, opener_: HTMLElement | null) => {
      if (opener_ && !rootRef.current?.contains(opener_)) opener.current = opener_;
      restoreRequest.current = false;
      const current = paneRef.current;
      // Already open on the tab: nothing re-renders, so focus the entry now.
      if (current.open && current.tab === tab) {
        focusEntry();
        return;
      }
      focusRequest.current = true;
      if (current.tab !== tab) current.setTab(tab);
      if (!current.open) current.setOpen(true);
      expireRequests();
    },
    [focusEntry, expireRequests]
  );

  const intents = useMemo<NavigationIntents>(
    () => ({
      openTab: (tab) => {
        const active = rootRef.current?.ownerDocument.activeElement;
        openTab(tab, isHTMLElementNode(active) ? active : null);
      },
      toggle: () => {
        if (paneRef.current.open) {
          close();
          return;
        }
        opener.current = null;
        restoreRequest.current = false;
        focusRequest.current = true;
        paneRef.current.setOpen(true);
        expireRequests();
      },
      close,
      picked: () => {
        const current = paneRef.current;
        if (!current.overlay) return;
        // The chosen row turns inert once the pane closes; the document it pointed at takes
        // focus then. A host that keeps the pane open keeps the page inert and focus here.
        const active = rootRef.current?.ownerDocument.activeElement;
        pickRequest.current = !!active && !!rootRef.current?.contains(active);
        current.setOpen(false);
        expireRequests();
      },
    }),
    [close, expireRequests, openTab]
  );

  const intentsRef = useRef(intents);
  intentsRef.current = intents;

  // Ctrl/Cmd+F and the Go To chord, on the document so they reach the toolbar and the pane as
  // well as the pages. Bubble phase: the engine's keymap and the viewport's zoom capture see
  // them first, and an event either of them claimed (default prevented) is left alone.
  useEffect(() => {
    const doc = rootRef.current?.ownerDocument;
    if (!doc || (!findShortcut && !goToShortcut)) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const tab: NavigationTabId | null =
        findShortcut && isFindShortcut(event)
          ? 'find'
          : goToShortcut && isGoToShortcut(event)
            ? 'goto'
            : null;
      if (!tab || !ownsShortcutTarget(event.target, rootRef.current, viewport)) return;
      // Go To goes through the editor as the shortcut does: a host's own Go To UI on top
      // answers it, and one that turned its shortcut off leaves the chord to the browser.
      if (tab === 'goto' && editor?.can({ type: 'openGoTo' }).ok) {
        if (editor.exec({ type: 'openGoTo', fromShortcut: true }).ok) event.preventDefault();
        return;
      }
      event.preventDefault();
      const active = doc.activeElement;
      openTab(tab, isHTMLElementNode(active) ? active : null);
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [viewport, findShortcut, goToShortcut, openTab, editor]);

  // Every render answers the requests made before it (see the header).
  useEffect(() => {
    if (focusRequest.current) {
      if (paneRef.current.open) focusEntry();
      else focusRequest.current = false;
    }
    if (restoreRequest.current) {
      if (!paneRef.current.open) restoreFocus();
      else restoreRequest.current = false;
    }
    if (pickRequest.current) {
      pickRequest.current = false;
      // The close is answered: the page's `inert` went in the cleanup below, before this runs.
      if (!paneRef.current.open) editor?.focus();
    }
  });

  // An overlaying pane hides the page, so the page leaves the tab order while it does.
  const covering = pane.open && pane.overlay;
  useEffect(() => {
    const root = rootRef.current;
    if (!covering || !root || !viewport) return undefined;
    // A press on the page it leaves visible closes the pane, as a press outside any popup does.
    return coverPage(root, viewport, () => intentsRef.current.close());
  }, [covering, viewport]);

  // A pane inside the scroll container is sticky and sizes itself from these properties.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !viewport || !viewport.contains(root)) return undefined;
    return publishViewportSize(root, viewport);
  }, [viewport]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) {
        return;
      }
      if (!paneRef.current.open) return;
      event.preventDefault();
      close();
    },
    [close]
  );

  return { rootRef, intents, onKeyDown };
}
