import type { ContentControlWidgetSession, InvalidTextFormFieldSession } from './popup-sessions.ts';
import type { TextFormFieldDialogSession } from './text-form-field-session.ts';
import type { PopupChromeRegistrationOptions } from './popup-sessions.ts';
import { createBookmarkChrome, type BookmarkChromeHost } from './bookmark-chrome.ts';
import type { EquationChromeHandlers, HyperlinkChromeHandlers } from './docx-editor-types.ts';
import { bindLinkRequests, createLinkChrome, type LinkRequests } from './link-chrome.ts';
import { createChromeHandlerStack } from './chrome-handler-stack.ts';
import {
  bindCommentDraftRequests,
  createCommentDraftChrome,
  type CommentDraftRequests,
} from './comment-draft-chrome.ts';

/**
 * Manual renderers take priority over automatic adapter fallbacks in either mount order.
 *
 * A session family whose sessions carry a `kind` can scope each registration with
 * `handlers.kinds`; `defaultKinds` is what a registration that names none takes. A session no
 * registration takes is refused, and the engine keeps its own behavior for it.
 */
export function createSessionChrome<Session extends { signal: AbortSignal; cancel(): void }>(
  defaultKinds?: readonly string[]
) {
  type Handlers = {
    readonly onRequest?: (session: Session) => void;
    readonly kinds?: readonly string[];
  };
  const registrations: { handlers: Handlers; fallback: boolean; sessions: Set<Session> }[] = [];
  const takes = (entry: { handlers: Handlers }, session: Session): boolean => {
    const kind = (session as { kind?: unknown }).kind;
    const kinds = entry.handlers.kinds ?? defaultKinds;
    return typeof kind !== 'string' || !kinds || kinds.includes(kind);
  };
  return {
    request(session: Session): boolean {
      const candidates = registrations.filter((entry) => takes(entry, session));
      const registration =
        [...candidates].reverse().find((entry) => !entry.fallback) ?? candidates.at(-1);
      if (!registration?.handlers.onRequest) return false;
      const { sessions, handlers } = registration;
      sessions.add(session);
      session.signal.addEventListener('abort', () => sessions.delete(session), { once: true });
      handlers.onRequest!(session);
      return true;
    },
    register(handlers: Handlers, options?: PopupChromeRegistrationOptions): () => void {
      const entry = {
        handlers,
        fallback: options?.fallback === true,
        sessions: new Set<Session>(),
      };
      registrations.push(entry);
      return () => {
        const index = registrations.indexOf(entry);
        if (index < 0) return;
        registrations.splice(index, 1);
        for (const session of entry.sessions) session.cancel();
      };
    },
  };
}
/** Own Field Options sessions independently of surface replacement. */
export const createTextFormFieldChrome = () => createSessionChrome<TextFormFieldDialogSession>();

/**
 * Facade wiring for host chrome: the three core-owned popup session families, and the
 * hyperlink, equation, bookmark and comment draft handlers.
 *
 * The handlers are read through their holders rather than captured: chrome mounts AFTER the
 * editor exists (the provider-first shape), and a document that reloads must not leave the
 * host's chrome wired to the surface it replaced.
 */
export function createEditorPopupChrome(host: BookmarkChromeHost = {}) {
  const hyperlink = createLinkChrome(host.changed);
  const equation = createChromeHandlerStack<EquationChromeHandlers>({});
  const bookmark = createBookmarkChrome(host);
  const commentDraft = createCommentDraftChrome(host);
  const text = createTextFormFieldChrome();
  // Checkbox and picture presses reach only renderers that ask for them: a pop-up renderer
  // written before those sessions existed keeps working, and the engine toggles the box or
  // opens its own file picker itself. A gallery session is list-shaped, so it joins the list.
  const widget = createSessionChrome<ContentControlWidgetSession>([
    'dropdown',
    'comboBox',
    'date',
    'buildingBlockGallery',
  ]);
  const invalid = createSessionChrome<InvalidTextFormFieldSession>();
  return {
    surfaceOptions: {
      onRequestTextFormField: text.request,
      onRequestContentControlWidget: widget.request,
      onRequestInvalidTextFormField: invalid.request,
      onHyperlinkPopover: (
        activation: Parameters<NonNullable<HyperlinkChromeHandlers['onPopover']>>[0]
      ) => hyperlink.current().onPopover?.(activation),
      onRequestHyperlink: (): boolean => hyperlink.open(),
      onEquationPopover: (
        activation: Parameters<NonNullable<EquationChromeHandlers['onPopover']>>[0]
      ) => equation.current().onPopover?.(activation),
      ...bookmark.surfaceOptions,
    },
    bookmarkDialog: bookmark.bookmarkDialog,
    goTo: bookmark.goTo,
    /** What the `review.addComment` control asks of the registered comment draft chrome. */
    commentDraft: commentDraft.requests,
    /** What the `text.link` control asks of the registered link chrome. */
    link: hyperlink.requests,
    setters: {
      setTextFormFieldChrome: text.register,
      setContentControlWidgetChrome: widget.register,
      setInvalidTextFormFieldChrome: invalid.register,
      setHyperlinkChrome: hyperlink.register,
      setEquationChrome: equation.push,
      ...bookmark.setters,
      ...commentDraft.setters,
    },
  };
}

/** Make a facade's comment draft and link requests reachable from the toolbar commands. */
export function bindPopupChromeRequests(
  editor: object,
  chrome: { readonly commentDraft: CommentDraftRequests; readonly link: LinkRequests }
): void {
  bindCommentDraftRequests(editor, chrome.commentDraft);
  bindLinkRequests(editor, chrome.link);
}
