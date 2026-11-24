import { DocxEditorRevisionMarkupDialog } from './DocxEditorRevisionMarkupDialog';
import { DocxEditorCompareDocumentsDialog } from './DocxEditorCompareDocumentsDialog';
import type {
  CompareDocumentsDialogSession,
  RevisionMarkupDialogSession,
} from '@docx-editor.dev/core/editor';
import { renderPopup } from './popup-renderer';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocxEditorPopups } from './popup-config';
import { useEditorMountGeneration } from './dialog-parts';
import type { ReactNode } from 'react';
import type { TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { DocxEditorPageSetupDialog } from './DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from './DocxEditorParagraphDialog';
import { DocxEditorWatermarkDialog } from './DocxEditorWatermark';
import { DocxEditorBookmarkDialog } from './DocxEditorBookmark';
import { DocxEditorSplitCellDialog } from './DocxEditorSplitCell';
import { DocxEditorTextFormFieldDialog } from './DocxEditorTextFormFieldDialog';
import { useChromeDir } from '../i18n';

type DialogKind = 'pageSetup' | 'paragraph' | 'watermark' | 'bookmark' | 'splitCell';
interface DialogHost {
  readonly container: HTMLElement | null;
  readonly ownsPageSetup: boolean;
  open(kind: DialogKind, returnFocusTo?: HTMLElement | null): void;
  setContainer(container: HTMLElement | null): void;
}
const Context = createContext<DialogHost | null>(null);
export const useDialogHost = () => useContext(Context);
export function DialogProvider({
  popups,
  children,
}: {
  popups?: DocxEditorPopups;
  children?: ReactNode;
}) {
  const editor = useDocxEditor();
  const generation = useEditorMountGeneration();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<DialogKind | null>(null);
  const [session, setSession] = useState<TextFormFieldDialogSession | null>(null);
  const [markupSession, setMarkupSession] = useState<RevisionMarkupDialogSession | null>(null);
  const markupSessionRef = useRef(markupSession);
  markupSessionRef.current = markupSession;
  const [compareSession, setCompareSession] = useState<CompareDocumentsDialogSession | null>(null);
  const compareSessionRef = useRef(compareSession);
  compareSessionRef.current = compareSession;
  const popupsRef = useRef(popups);
  popupsRef.current = popups;
  const opener = useRef<HTMLElement | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const close = () => setActive(null);
  useEffect(() => {
    if (active !== null) return;
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    if (!editor) return;
    return editor.setTextFormFieldChrome(
      {
        onRequest(request) {
          if (popupsRef.current?.textFormField === false) {
            request.cancel();
            return;
          }
          markupSessionRef.current?.cancel();
          compareSessionRef.current?.cancel();
          setActive(null);
          setSession(request);
          request.signal.addEventListener(
            'abort',
            () => setSession((previous) => (previous === request ? null : previous)),
            { once: true }
          );
        },
      },
      { fallback: true }
    );
  }, [editor]);
  useEffect(() => {
    if (!editor || (!container && popups?.revisionMarkup !== false)) return;
    const unregister = editor.setRevisionMarkupChrome(
      {
        onRequest(request) {
          if (popupsRef.current?.revisionMarkup === false) {
            request.cancel();
            return;
          }
          sessionRef.current?.cancel();
          compareSessionRef.current?.cancel();
          setActive(null);
          setMarkupSession(request);
          request.signal.addEventListener(
            'abort',
            () => setMarkupSession((previous) => (previous === request ? null : previous)),
            { once: true }
          );
        },
      },
      { fallback: true }
    );
    return () => {
      markupSessionRef.current?.cancel();
      unregister();
    };
  }, [editor, container, popups?.revisionMarkup === false]);
  useEffect(() => {
    if (!editor || (!container && popups?.compareDocuments !== false)) return;
    const unregister = editor.setCompareDocumentsChrome(
      {
        onRequest(request) {
          if (popupsRef.current?.compareDocuments === false) {
            request.cancel();
            return;
          }
          sessionRef.current?.cancel();
          markupSessionRef.current?.cancel();
          setActive(null);
          setCompareSession(request);
          request.signal.addEventListener(
            'abort',
            () => setCompareSession((previous) => (previous === request ? null : previous)),
            { once: true }
          );
        },
      },
      { fallback: true }
    );
    return () => {
      compareSessionRef.current?.cancel();
      unregister();
    };
  }, [editor, container, popups?.compareDocuments === false]);
  useEffect(() => {
    setActive(null);
    setSession(null);
    setMarkupSession(null);
    setCompareSession(null);
  }, [editor, generation]);
  // The `bookmark` popup answers the editor's `openBookmarkDialog` request, which the Insert
  // menu row, Ctrl/Cmd+Shift+F5 and host code all send. A `false` popup registers nothing, so
  // the command reports itself disabled instead of doing nothing.
  const bookmarkDisabled = popups?.bookmark === false;
  useEffect(() => {
    if (!editor || !container || bookmarkDisabled) return;
    return editor.setBookmarkChrome({
      onRequest() {
        sessionRef.current?.cancel();
        markupSessionRef.current?.cancel();
        compareSessionRef.current?.cancel();
        opener.current = returnFocusTarget(container.ownerDocument.activeElement);
        setActive('bookmark');
      },
    });
  }, [editor, container, bookmarkDisabled]);
  useEffect(() => {
    if (popups?.revisionMarkup === false) markupSessionRef.current?.cancel();
    if (popups?.compareDocuments === false) compareSessionRef.current?.cancel();
    if (popups?.textFormField === false) sessionRef.current?.cancel();
    if (active && popups?.[active] === false) setActive(null);
  }, [popups, active]);
  const host = useMemo<DialogHost>(
    () => ({
      container,
      setContainer,
      ownsPageSetup: popups?.pageSetup !== undefined,
      open(kind, returnFocusTo) {
        sessionRef.current?.cancel();
        markupSessionRef.current?.cancel();
        compareSessionRef.current?.cancel();
        if (popupsRef.current?.[kind] === false) return;
        opener.current =
          returnFocusTo ?? (container?.ownerDocument.activeElement as HTMLElement | null);
        setActive(kind);
      },
    }),
    [container, popups?.pageSetup]
  );
  const props = { open: true, onClose: close };
  const content =
    active === 'pageSetup' && popups?.pageSetup !== false ? (
      popups?.pageSetup ? (
        renderPopup(popups.pageSetup, props)
      ) : (
        <DocxEditorPageSetupDialog {...props} />
      )
    ) : active === 'paragraph' && popups?.paragraph !== false ? (
      popups?.paragraph ? (
        renderPopup(popups.paragraph, props)
      ) : (
        <DocxEditorParagraphDialog {...props} />
      )
    ) : active === 'watermark' && popups?.watermark !== false ? (
      popups?.watermark ? (
        renderPopup(popups.watermark, props)
      ) : (
        <DocxEditorWatermarkDialog {...props} />
      )
    ) : active === 'bookmark' && popups?.bookmark !== false ? (
      popups?.bookmark ? (
        renderPopup(popups.bookmark, props)
      ) : (
        <DocxEditorBookmarkDialog {...props} />
      )
    ) : active === 'splitCell' && popups?.splitCell !== false ? (
      popups?.splitCell ? (
        renderPopup(popups.splitCell, props)
      ) : (
        <DocxEditorSplitCellDialog {...props} />
      )
    ) : markupSession && popups?.revisionMarkup !== false ? (
      popups?.revisionMarkup ? (
        renderPopup(popups.revisionMarkup, { session: markupSession }, markupSession)
      ) : (
        <DocxEditorRevisionMarkupDialog session={markupSession} />
      )
    ) : compareSession && popups?.compareDocuments !== false ? (
      popups?.compareDocuments ? (
        renderPopup(popups.compareDocuments, { session: compareSession }, compareSession)
      ) : (
        <DocxEditorCompareDocumentsDialog session={compareSession} />
      )
    ) : session && popups?.textFormField !== false ? (
      popups?.textFormField ? (
        renderPopup(popups.textFormField, { session }, session)
      ) : (
        <DocxEditorTextFormFieldDialog session={session} />
      )
    ) : null;
  return (
    <Context.Provider value={host}>
      {children}
      {container ? createPortal(content, container) : null}
    </Context.Provider>
  );
}
/**
 * Where focus returns when a dialog a request opened closes: the focused element, or for a
 * row of a menu that closes as the dialog opens, that menu's trigger, which outlives it.
 */
function returnFocusTarget(focused: Element | null): HTMLElement | null {
  const menu = focused?.closest('[data-menu]');
  const trigger = menu?.querySelector<HTMLElement>(':scope > [role="menuitem"]');
  return trigger ?? (focused as HTMLElement | null);
}

/** The stable mount belongs to Content, outside the engine-owned DOM. */
export function DialogMount() {
  const host = useDialogHost();
  return <div className="docx-dialog-mount" ref={host?.setContainer} dir={useChromeDir()} />;
}

/** Keep triggered popups outside menu containers that hosts can hide or clip. */
export function DialogPortal({ children }: { children: ReactNode }) {
  const host = useDialogHost();
  return host?.container ? createPortal(children, host.container) : children;
}
