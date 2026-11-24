// The hyperlink popover's behavior, UI-free.
//
// Everything `DocxEditor.HyperLink` does lives here, so a host that wants a completely
// different link UI takes this hook and ignores the parts — the same shape `useFontFamily`
// established for the font picker.
//
// The engine decides WHEN. A click on an external link and Ctrl/Cmd+K are gestures the
// surface classifies (a drag that merely ended on a link is not a click on it), so this hook
// registers with `setHyperlinkChrome` rather than binding listeners of its own. What it owns
// is the popover's own state: open or closed, reading or editing, and where it sits.
//
// The engine decides WHAT IS SAFE. `href` is always the sanitized projection, and the only
// path to opening one is `surface.navigation.openExternal` — the engine's single
// `window.open` gate. Nothing here builds a URL.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SurfaceHyperlink } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { useNavigationViewportElement } from './navigation/navigation-layout';
import type { Editor, EditorSnapshot, SelectionPin } from '@docx-editor.dev/core/contracts/editor';
import { hostDocumentOf, hostWindowOf, isElementNode } from '@docx-editor.dev/core/editor';

/** Where the popover sits, in viewport coordinates. */
export interface HyperlinkPopupAnchor {
  readonly left: number;
  readonly top: number;
}

/** What the popover is showing. @public */
export type HyperlinkPopupMode =
  /** Not shown. */
  | 'closed'
  /** An existing link: its target, plus copy / edit / unlink. */
  | 'reading'
  /** Text + URL fields, for a new link or a change to an existing one. */
  | 'editing';

/** The popover's observable state. @public */
export interface HyperlinkPopupState {
  readonly mode: HyperlinkPopupMode;
  /** The link being read or edited, or null while inserting a new one. */
  readonly link: SurfaceHyperlink | null;
  /** Viewport position for the panel; null means "the host places it". */
  readonly anchor: HyperlinkPopupAnchor | null;
  /** Draft display text, in edit mode. */
  readonly text: string;
  /** Draft target, in edit mode. */
  readonly url: string;
  /** True after a copy, until the next state change — for a "Copied" confirmation. */
  readonly copied: boolean;
  /** True when the last Apply was refused, so the panel can say so instead of sitting there. */
  readonly error: boolean;
  /** Whether the document can be edited right now; read-only trims the actions. */
  readonly canEdit: boolean;
}

/** What `useHyperlinkPopup` answers. @public */
export interface UseHyperlinkPopupResult {
  readonly state: HyperlinkPopupState;
  /** Open in reading mode over a link, or in editing mode when there is none. */
  open: (link?: SurfaceHyperlink | null, anchor?: HyperlinkPopupAnchor | null) => void;
  /**
   * Open insert-or-edit for the SELECTION — what Ctrl/Cmd+K and the toolbar's link button
   * do. Anchors itself at the caret, seeds the display text from the selection, and opens
   * edit mode pre-filled when the caret is already inside a link.
   */
  openAtCaret: () => void;
  close: () => void;
  /** Copy the sanitized target. Answers false when there is nothing safe to copy. */
  copy: () => Promise<boolean>;
  /** Switch to editing, seeded from the link at the caret. */
  beginEdit: () => void;
  setText: (text: string) => void;
  setUrl: (url: string) => void;
  /** Apply the draft. Answers false when the engine refused it (a bad scheme, no text). */
  commitEdit: () => boolean;
  /** Take the link off, keeping its text. */
  unlink: () => boolean;
  /**
   * Open the target in a new tab, through the engine's single `window.open` gate. Answers
   * false for an inert link — there is nothing to open, and this never invents a URL.
   */
  openTarget: () => boolean;
}

/**
 * A field-derived link (a `HYPERLINK` field's instruction) rather than a typed
 * `w:hyperlink`. Structurally signalled: the field registry mints every record with no
 * addressable range (`paragraphId` stays empty), because no `w:hyperlink` node backs it.
 * The typed editing lane (edit / unlink) can never resolve its id, so chrome offers neither
 * action. Caret dismissal DOES apply: the field is a one-unit atom, and `fieldLinkAtCaret`
 * resolves the caret onto it (boundary-inclusive) so the panel closes when the caret leaves.
 */
export function isFieldLink(link: SurfaceHyperlink): boolean {
  return link.paragraphId === '';
}

/**
 * The longest target the per-update check reads. `selectedText` builds the whole selected
 * string, so a select-all panel in a long document would pay for it on every remote keystroke.
 * Longer targets are checked once, at Apply.
 */
const TARGET_CHECK_LIMIT = 4096;

const CLOSED: HyperlinkPopupState = Object.freeze({
  mode: 'closed' as const,
  link: null,
  anchor: null,
  text: '',
  url: '',
  copied: false,
  error: false,
  canEdit: true,
});

const selectTick = (snapshot: EditorSnapshot) => snapshot;

/**
 * Where the caret is on screen, for anchoring a keyboard-opened panel.
 *
 * A click supplies its own rect; Ctrl/Cmd+K has none, and an UNANCHORED panel is not
 * merely misplaced — it falls to the top of the scroll container, and focusing its URL
 * input then scrolls the whole document up to reach it. So the keyboard path reads the
 * caret's own rect.
 *
 * The surface mirrors its model selection into the DOM, so the browser's range is the
 * engine's caret rather than a second opinion about where the caret is. A collapsed range
 * can report a zero-size rect at the start of a line; the fallback is the containing
 * element's box, and a total miss leaves the panel unanchored rather than mis-anchored.
 */
function caretViewportAnchor(owner: Node | null): HyperlinkPopupAnchor | null {
  const usable = (rect: DOMRect | undefined): rect is DOMRect =>
    !!rect && (rect.width > 0 || rect.height > 0);

  // FIRST the engine's OWN painted caret. It is the authoritative insertion point — the
  // surface paints it from layout and suppresses the native one — so it has a real rect at
  // an empty paragraph, at a line end, and everywhere the browser's range does not.
  // The editor's own document: a pop-out window or an iframe is not the script's.
  const doc = hostDocumentOf(owner);
  if (doc) {
    const painted = doc.querySelector('[data-docx-caret]');
    const rect = painted?.getBoundingClientRect();
    if (usable(rect)) return { left: rect.left, top: rect.bottom };
  }

  // Then the browser's range, which the surface mirrors the model selection into.
  const selection = doc ? doc.getSelection() : null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (usable(rect)) return { left: rect.left, top: rect.bottom };
    const node = range.startContainer;
    const element = isElementNode(node) ? node : node.parentElement;
    const fallback = element?.getBoundingClientRect();
    if (usable(fallback)) return { left: fallback.left, top: fallback.bottom };
  }

  // Nothing measurable. The panel places itself by flow rather than at a made-up point —
  // and, because its input focuses with `preventScroll`, that no longer moves the document.
  return null;
}

/**
 * ONE popover state per editor, published by `DocxEditor.HyperLink`.
 *
 * The compound and every consumer of the hook must see the SAME open/closed state, or a
 * toolbar button and a mounted popover would each hold their own and only one of them would
 * ever be showing.
 */
export const HyperlinkPopupContext = createContext<UseHyperlinkPopupResult | null>(null);

/**
 * Counts what shows the shared popover state: `DocxEditor.HyperLink`, or a host panel that
 * reads `useHyperlinkPopup()`. The shared state answers link clicks, Ctrl/Cmd+K and the
 * `text.link` control only while one is mounted, so with nothing to show the panel those
 * controls are disabled instead of opening a panel no one sees.
 */
export const HyperlinkPopupViewsContext = createContext<(() => () => void) | null>(null);

/** Count the calling component as a view of the shared popover state while it is mounted. */
export function useHyperlinkPopupView(): void {
  const attach = useContext(HyperlinkPopupViewsContext);
  useEffect(() => attach?.(), [attach]);
}

/**
 * The hyperlink popover's behavior.
 *
 * Inside `DocxEditor.Root` this is the SHARED state that `DocxEditor.HyperLink` renders, so
 * a custom panel and the toolbar agree. Calling it marks the component as a view of that
 * state: while one is mounted, link clicks, Ctrl/Cmd+K and the Insert link controls open
 * it. Outside a root it is a standalone instance that registers with the engine itself — a
 * host building its own link UI from scratch needs nothing else.
 *
 * @public
 */
export function useHyperlinkPopup(): UseHyperlinkPopupResult {
  const provided = useContext(HyperlinkPopupContext);
  useHyperlinkPopupView();
  // Both hooks run every render, in the same order: `standalone` only decides whether the
  // instance below registers with the engine, never whether it exists.
  const own = useHyperlinkPopupInstance(provided === null);
  return provided ?? own;
}

/**
 * A popover instance. `active` gates ENGINE REGISTRATION only — an instance created inside
 * a provider still exists, it just does not compete for the surface's chrome handlers.
 *
 * @public
 */
export function useHyperlinkPopupInstance(active = true): UseHyperlinkPopupResult {
  const editor = useDocxEditor();
  const viewport = useNavigationViewportElement();
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [state, setState] = useState<HyperlinkPopupState>(CLOSED);
  const selectionPinRef = useRef<{ editor: Editor; pin: SelectionPin } | null>(null);
  // The words a create panel opened over; empty for a panel opened at a bare caret.
  const targetTextRef = useRef('');
  // Whether those words were already a pending deletion when the panel opened. Linking struck
  // words the user selected is allowed; words struck after the panel opened are gone.
  const struckAtOpenRef = useRef(false);
  // The engine's gestures fire from listeners registered ONCE; reading the live state
  // through a ref keeps that registration off the render path, so opening the popover does
  // not tear down and rebind the surface's chrome handlers.
  const stateRef = useRef(state);
  stateRef.current = state;
  // The snapshot's identity is the engine's "something moved" signal. A committed edit, an
  // undo or a caret move all invalidate what an open popover is describing.
  const snapshot = useEditorState(selectTick);
  const canEdit = editor ? editor.can({ type: 'insertText', text: '' }).ok : false;

  const releaseSelectionPin = useCallback(() => {
    targetTextRef.current = '';
    struckAtOpenRef.current = false;
    const retained = selectionPinRef.current;
    if (!retained) return;
    retained.editor.releaseSelection(retained.pin);
    selectionPinRef.current = null;
  }, []);

  // Whether the words a create panel is about to link are gone: another participant deleted
  // or rewrote them, or an undo took them out. The selection maps through those edits, so it
  // no longer holds the same text, and Apply would insert the draft as a NEW link at the
  // collapsed caret instead of linking what the user selected. A peer that strikes the words
  // in suggesting mode leaves the text in place, so the engine says whether it is a pending
  // deletion now that was not one when the panel opened.
  // `everyUpdate` bounds the cost on the per-update path; see `TARGET_CHECK_LIMIT`.
  const targetGone = useCallback(
    (everyUpdate = false) => {
      const target = targetTextRef.current;
      if (target === '' || !editor) return false;
      const struck =
        !struckAtOpenRef.current &&
        editor.surface?.hyperlinks.selectionIsPendingDeletion() === true;
      if (struck) return true;
      if (everyUpdate && target.length > TARGET_CHECK_LIMIT) return false;
      return editor.query({ type: 'selectedText' }) !== target;
    },
    [editor]
  );

  const open = useCallback(
    (link?: SurfaceHyperlink | null, anchor?: HyperlinkPopupAnchor | null) => {
      releaseSelectionPin();
      setState({
        // A link to read; nothing to read means the user is creating one.
        mode: link ? 'reading' : 'editing',
        link: link ?? null,
        anchor: anchor ?? null,
        text: link?.text ?? '',
        // The AUTHORED target seeds the field, not the sanitized projection: the user is
        // editing what the document says, and showing them a rewritten value would make an
        // untouched save look like a change.
        url: link ? (link.kind === 'internal' ? `#${link.anchor ?? ''}` : link.authored) : '',
        copied: false,
        error: false,
        canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
      });
    },
    [editor, releaseSelectionPin]
  );

  const close = useCallback(() => {
    releaseSelectionPin();
    setState(CLOSED);
  }, [releaseSelectionPin]);

  useEffect(() => releaseSelectionPin, [releaseSelectionPin]);

  /**
   * Open for the caret's own link, or for a new one — what Ctrl/Cmd+K and the toolbar
   * button do. Reading mode when the caret is already inside a link (Word reopens the
   * dialog on it), editing mode otherwise.
   */
  const openAtCaret = useCallback(() => {
    const anchor = caretViewportAnchor(viewportRef.current);
    releaseSelectionPin();
    const link =
      editor?.surface?.hyperlinks.linkAtCaret() ??
      editor?.surface?.hyperlinks.fieldLinkAtCaret() ??
      null;
    if (link && isFieldLink(link)) {
      // A FIELD link has no editable tree node — Edit and Unlink cannot apply to it — so Ctrl+K
      // opens the same READING panel a click produces (Open / Copy only), never an edit panel.
      open(link, anchor);
      return;
    }
    if (link) {
      // Ctrl+K on an existing TYPED link goes straight to EDIT — the user pressed the key to
      // change it, and making them press Edit as well is a step for nothing.
      setState({
        mode: 'editing',
        link,
        anchor,
        text: link.text,
        url: link.kind === 'internal' ? `#${link.anchor ?? ''}` : link.authored,
        copied: false,
        error: false,
        canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
      });
      return;
    }
    // A caret inside a word links that word: it becomes the selection and the display text.
    const word = editor?.surface?.hyperlinks.wordAtCaret() ?? null;
    if (word) editor?.surface?.setSelection({ anchor: word.from, head: word.to });
    const selected = editor?.query({ type: 'selectedText' }) ?? '';
    // The text stays SELECTED while the panel is up. Focusing the URL field moves the
    // browser's one selection into it, so without this the highlight the user is about to
    // turn into a link vanishes exactly when they need to see it. The engine draws it on its
    // own overlay and releases the pin when the caret leaves — which is what closes us below.
    const pin = editor?.retainSelection() ?? null;
    if (editor && pin) selectionPinRef.current = { editor, pin };
    targetTextRef.current = selected;
    struckAtOpenRef.current = editor?.surface?.hyperlinks.selectionIsPendingDeletion() === true;
    setState({
      mode: 'editing',
      link: null,
      anchor,
      text: selected,
      url: '',
      copied: false,
      error: false,
      canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
    });
  }, [editor, open, releaseSelectionPin]);

  // Register with the engine: a plain click on an external link opens the popover under it,
  // Ctrl/Cmd+K opens insert-or-edit. The cleanup restores whatever was registered before, so
  // nested hosts unwind in order.
  useEffect(() => {
    if (!editor || !active) return undefined;
    return editor.setHyperlinkChrome({
      onPopover: (activation) =>
        open(activation.link, { left: activation.rect.left, top: activation.rect.bottom }),
      onRequest: openAtCaret,
    });
  }, [editor, active, open, openAtCaret]);

  // Dismiss when the CARET LEAVES the link the panel is describing — not on any state tick.
  //
  // "Something moved" is the wrong question, and asking it made the popover unusable: a
  // click on a link queues a `selectionchange`, the surface adopts it a turn later, and that
  // tick landed after the panel had opened and closed it again. The panel appeared and
  // vanished on every click, and only a synthetic click (which skips the pointer path) ever
  // seemed to work.
  //
  // The honest question is whether what the panel SAYS is still true. It is exactly as
  // strict — an edit that removes the link, or a caret that moves out of it, still closes
  // the panel — and it is immune to ticks that change nothing it shows. Editing mode is
  // exempt: the user is mid-keystroke there, and the commit itself moves the caret.
  useEffect(() => {
    const current = stateRef.current;
    if (current.mode !== 'reading' || !current.link) return;
    // A FIELD link is a painted atom, not a tree node, so `linkAtCaret` (the typed tree walk)
    // never returns one. `fieldLinkAtCaret` resolves it from the layout at the caret, and it is
    // boundary-INCLUSIVE: a field atom is `[start, start + 1)`, and the click that opens the
    // panel lands the caret on that boundary. The inclusive test keeps the panel open on the
    // opening tick and closes it only once the caret truly moves off the atom. Escape and an
    // outside mousedown still dismiss through paths that never ask the caret.
    const atCaret = isFieldLink(current.link)
      ? (editor?.surface?.hyperlinks.fieldLinkAtCaret() ?? null)
      : (editor?.surface?.hyperlinks.linkAtCaret() ?? null);
    if (atCaret && atCaret.id === current.link.id) return;
    setState(CLOSED);
  }, [snapshot, editor]);

  // A CREATE panel closes when the caret leaves the range it is about to link.
  //
  // The same question as above — "is what the panel says still true" — asked of a panel that
  // has no link yet: what it says is "these words are about to become a link", and clicking
  // somewhere else makes that false. The engine owns the comparison (it releases the pin when
  // the caret escapes, either edge counting as inside), so this reads a fact rather than
  // recomputing document order in the adapter, and Vue gets the same rule from the same place.
  //
  // Only a panel that RETAINED something is governed by this: an edit panel opened on an
  // existing link is covered by the effect above, and typing in the URL field moves no caret.
  //
  // The same holds when the words themselves disappear while the caret stays put: a peer that
  // deletes the selected text leaves the pin in place, so `targetGone` asks the document.
  useEffect(() => {
    const current = stateRef.current;
    if (current.mode !== 'editing' || current.link) return;
    const surface = editor?.surface;
    if (!surface) return;
    if (surface.retainedSelection() && !targetGone(true)) return;
    close();
  }, [snapshot, editor, targetGone, close]);

  const copy = useCallback(async () => {
    const href = stateRef.current.link?.href;
    if (!href) return false;
    try {
      // The editor's window: an unfocused opener's clipboard refuses the write.
      await hostWindowOf(viewportRef.current).navigator.clipboard.writeText(href);
    } catch {
      // A denied clipboard permission is not an error worth throwing at a user who clicked
      // a copy button; the confirmation simply does not appear.
      return false;
    }
    setState((previous) => ({ ...previous, copied: true }));
    return true;
  }, []);

  const beginEdit = useCallback(() => {
    setState((previous) => ({ ...previous, mode: 'editing', copied: false, error: false }));
  }, []);

  const setText = useCallback((text: string) => {
    setState((previous) => ({ ...previous, text, copied: false, error: false }));
  }, []);

  const setUrl = useCallback((url: string) => {
    setState((previous) => ({ ...previous, url, copied: false, error: false }));
  }, []);

  const commitEdit = useCallback(() => {
    const current = stateRef.current;
    const hyperlinks = editor?.surface?.hyperlinks;
    if (!hyperlinks) return false;
    // The effect above closes the panel on the tick that removed its target; this covers an
    // Apply that lands before that tick renders.
    if (!current.link && targetGone()) {
      close();
      return false;
    }
    const url = current.url.trim();
    if (url.length === 0) {
      setState((previous) => ({ ...previous, error: true }));
      return false;
    }
    // `#name` is a bookmark in this document; anything else goes through the package's URL
    // allowlist, which refuses what `sanitizeHref` refuses.
    const internal = url.startsWith('#');
    const applied = hyperlinks.applyHyperlink({
      ...(internal ? { anchor: url.slice(1) } : { url }),
      ...(current.text.trim().length > 0 ? { text: current.text } : {}),
    });
    if (!applied) {
      // The engine refused: a scheme it will not write, a selection spanning paragraphs, or
      // nothing to link. Stay open so the value can be corrected, and SAY so.
      setState((previous) => ({ ...previous, error: true }));
      return false;
    }
    // Through `close`, not a bare `setState`: applying must also drop the retained
    // highlight, or the words stay lit over a link that already exists.
    close();
    return true;
  }, [editor, close, targetGone]);

  const unlink = useCallback(() => {
    const hyperlinks = editor?.surface?.hyperlinks;
    const link = stateRef.current.link;
    if (!hyperlinks) return false;
    const removed = hyperlinks.removeHyperlink(link?.id);
    if (removed) close();
    return removed;
  }, [editor, close]);

  const openTarget = useCallback(() => {
    const navigation = editor?.surface?.navigation;
    const link = stateRef.current.link;
    if (!navigation || !link) return false;
    // Internal links are a scroll, not a tab.
    if (link.kind === 'internal') {
      const jumped = link.anchor ? navigation.goToBookmark(link.anchor) : false;
      if (jumped) setState(CLOSED);
      return jumped;
    }
    // THE gate. `link.href` is the sanitized projection; an inert link carries null and is
    // refused inside `openExternal` regardless of what is asked here.
    const opened = navigation.openExternal(link.href);
    if (opened) setState(CLOSED);
    return opened;
  }, [editor]);

  return useMemo(
    () => ({
      state: state.mode === 'closed' ? CLOSED : { ...state, canEdit },
      open,
      openAtCaret,
      close,
      copy,
      beginEdit,
      setText,
      setUrl,
      commitEdit,
      unlink,
      openTarget,
    }),
    [
      state,
      canEdit,
      open,
      openAtCaret,
      close,
      copy,
      beginEdit,
      setText,
      setUrl,
      commitEdit,
      unlink,
      openTarget,
    ]
  );
}
