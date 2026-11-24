// Host chrome for bookmarks: the Bookmark dialog the host registers, and the options that
// shape Show bookmarks' marks.
//
// Both live on the editor, not on a surface: chrome mounts after the editor exists, and a
// document that reloads must keep the host's registration. The surface reads them on use.

import type {
  BookmarkChromeHandlers,
  BookmarkMarkOptions,
  GoToChromeHandlers,
} from './docx-editor-types.ts';
import { createChromeHandlerStack } from './chrome-handler-stack.ts';

/** What the bookmark chrome tells the editor. */
export interface BookmarkChromeHost {
  /** A dialog registered or went away: `openBookmarkDialog` changed whether it can run. */
  readonly changed?: () => void;
  /** A host `decorate` callback threw. The mark keeps its default element. */
  readonly error?: (error: unknown) => void;
}

/**
 * The surface's view of the mark options.
 *
 * @public
 */
export interface BookmarkMarkOptionsSource {
  readonly current: () => BookmarkMarkOptions;
  /** Name the repaint to run when the options change. One slot: a remount replaces it. */
  readonly onChange: (repaint: (() => void) | null) => void;
  /** Report an error a host callback threw while marks were painted. */
  readonly reportError: (error: unknown) => void;
}

/** What every kind of request chrome registers. */
export interface RequestChromeHandlers {
  readonly onRequest?: () => void;
  readonly shortcut?: boolean;
}

/**
 * One kind of host UI the editor opens on request: the Bookmark dialog, Go To, a comment
 * draft, or the link popover.
 *
 * Whether one is registered is published as a change, so chrome that asks `can` re-renders. A
 * registration publishes at once. A removal waits for the end of the task: a host that
 * registers again (a prop change re-runs its effect) removes and registers in one task, the
 * answer does not change, and nothing is published.
 */
export function createRequestChrome<Handlers extends RequestChromeHandlers = RequestChromeHandlers>(
  changed: (() => void) | undefined
) {
  const stack = createChromeHandlerStack<Handlers>({} as Handlers);
  let published = false;
  let pending = false;
  const canOpen = (): boolean => stack.current().onRequest !== undefined;
  const publish = (): void => {
    if (canOpen() === published) return;
    published = canOpen();
    changed?.();
  };
  return {
    canOpen,
    /** Ask the host's UI to open; false when none is registered. */
    open(): boolean {
      const request = stack.current().onRequest;
      request?.();
      return request !== undefined;
    },
    /** Whether the current UI takes its shortcut: false when it turned it off. */
    shortcutOn: (): boolean => stack.current().shortcut !== false,
    /** The keyboard's request: refused when the current UI turned its shortcut off. */
    openFromShortcut(): boolean {
      if (stack.current().shortcut === false) return false;
      const request = stack.current().onRequest;
      request?.();
      return request !== undefined;
    },
    /** The registration that answers now, for handlers beyond `onRequest`. */
    current: (): Handlers => stack.current(),
    register(handlers: Handlers): () => void {
      const dispose = stack.push(handlers);
      publish();
      return () => {
        dispose();
        if (pending) return;
        pending = true;
        globalThis.queueMicrotask(() => {
          pending = false;
          publish();
        });
      };
    },
  };
}

export function createBookmarkChrome(host: BookmarkChromeHost = {}) {
  const dialog = createRequestChrome(host.changed);
  const goTo = createRequestChrome(host.changed);
  const marks = createChromeHandlerStack<BookmarkMarkOptions>({});
  let repaintMarks: (() => void) | null = null;
  const bookmarkMarks: BookmarkMarkOptionsSource = {
    current: marks.current,
    onChange: (repaint) => {
      repaintMarks = repaint;
    },
    reportError: (error) => host.error?.(error),
  };
  return {
    surfaceOptions: {
      onRequestBookmark: dialog.open,
      onRequestGoTo: goTo.openFromShortcut,
      bookmarkMarks,
    },
    /** The `openBookmarkDialog` command: open the host's dialog, if a host shows one. */
    bookmarkDialog: dialog,
    /** The `openGoTo` command: open the host's Go To UI, if a host shows one. */
    goTo,
    setters: {
      setBookmarkChrome: (handlers: BookmarkChromeHandlers): (() => void) =>
        dialog.register(handlers),
      setGoToChrome: (handlers: GoToChromeHandlers): (() => void) => goTo.register(handlers),
      setBookmarkMarks(options: BookmarkMarkOptions): () => void {
        const dispose = marks.push(options);
        repaintMarks?.();
        return () => {
          dispose();
          repaintMarks?.();
        };
      },
    },
  };
}
