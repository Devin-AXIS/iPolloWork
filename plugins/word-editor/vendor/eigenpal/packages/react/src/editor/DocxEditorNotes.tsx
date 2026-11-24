import { renderPopup } from './popup-renderer';
import { usePopupConfig } from './popup-config';
import {
  DocxEditorNotePreview,
  DocxEditorNotesContextMenu,
  type DocxEditorNotesContextMenuProps,
} from './note-popup-parts';
export { DocxEditorNotePreview, DocxEditorNotesContextMenu } from './note-popup-parts';
export type {
  DocxEditorNotePreviewProps,
  DocxEditorNotesContextMenuProps,
} from './note-popup-parts';
// Thin React note chrome: hover preview, context menu, properties dialog.
//
// No model/layout logic — reads engine state and dispatches Editor.exec / setActiveScope.
// Hover preview mousedown is prevented so it cannot steal the caret. Touch skips preview
// and navigates only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { Z_INDEX } from '../styles/zIndex';
import { useDocxEditor } from './context';
import { guardToolbarMousedown } from './toolbar/ToolbarButton';
import { useNotePropertiesState, useNoteScopeState } from './useNoteScopeState';
import { useScopedChromeAnchor } from './useScopedChromeAnchor';
import {
  hostWindowOf,
  listenForMenuDismiss,
  listenForOutsidePress,
  noteMenuScopeOf,
} from '@docx-editor.dev/core/editor';

const NOTE_SCOPE_RE = /^(footnote|endnote):(-?\d{1,10})$/;

function parseNoteScopeId(
  id: string
): { readonly noteKind: 'footnote' | 'endnote'; readonly noteId: number } | null {
  const match = NOTE_SCOPE_RE.exec(id);
  if (!match) return null;
  const noteId = Number(match[2]);
  if (!Number.isInteger(noteId)) return null;
  return { noteKind: match[1] as 'footnote' | 'endnote', noteId };
}

/** Props for `DocxEditor.NotesChrome`. @public */
export interface DocxEditorNotesChromeProps {
  className?: string;
}

type NotePreview = {
  readonly scopeId: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
};

function isTouchPrimary(node: Node | null): boolean {
  const view = hostWindowOf(node);
  if (typeof view.matchMedia !== 'function') return false;
  return view.matchMedia('(pointer: coarse)').matches;
}

function useCommandGate(command: EditorCommand): { enabled: boolean; reason: string | null } {
  const editor = useDocxEditor();
  return useMemo(() => {
    if (!editor) return { enabled: false, reason: 'editor is not ready' };
    const result = editor.can(command);
    return result.ok ? { enabled: true, reason: null } : { enabled: false, reason: result.reason };
  }, [editor, command]);
}

function NoteStoryOptions(props: {
  readonly onOpenProperties: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    return listenForOutsidePress({ popup: menuRef.current, close: () => setOpen(false) });
  }, [open]);

  return (
    <div ref={menuRef} className="docx-hf-chrome__options">
      <button
        type="button"
        className="docx-context-bar__options-trigger"
        data-testid="docx-notes-options"
        aria-expanded={open}
        aria-haspopup="menu"
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((value) => !value)}
      >
        {t('headerFooter.options')}
      </button>
      {open ? (
        <div
          className="docx-hf-chrome__options-menu"
          role="menu"
          onMouseDown={guardToolbarMousedown}
        >
          <button
            type="button"
            role="menuitem"
            className="docx-hf-chrome__menu-item"
            data-testid="docx-notes-properties"
            onClick={() => {
              props.onOpenProperties();
              setOpen(false);
            }}
          >
            {t('dialogs.footnoteProperties.title')}
          </button>
          <div className="docx-hf-chrome__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="docx-hf-chrome__menu-item"
            data-testid="docx-notes-close"
            onClick={() => {
              props.onClose();
              setOpen(false);
            }}
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DocxEditorNotesChrome({
  className,
}: DocxEditorNotesChromeProps): ReactElement | null {
  const popups = usePopupConfig();
  const popupsRef = useRef(popups);
  popupsRef.current = popups;
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const menuHostRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const noteScope = useNoteScopeState();
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [menu, setMenu] = useState<{
    scopeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [propsOpen, setPropsOpen] = useState(false);
  // The handle and the window that issued it: a note in a pop-out window owns its timer.
  const hideTimer = useRef<{ win: Window; handle: number } | null>(null);
  const findActiveNoteArea = useCallback(
    (viewport: HTMLElement) => {
      if (!noteScope) return null;
      const candidates = viewport.querySelectorAll<HTMLElement>('[data-docx-note-scope]');
      const active =
        [...candidates].find(
          (candidate) =>
            candidate.matches('[data-docx-note]') &&
            candidate.dataset.docxNoteScope === noteScope.id
        ) ?? null;
      return active?.closest<HTMLElement>('[data-docx-notes]') ?? active;
    },
    [noteScope]
  );
  const anchor = useScopedChromeAnchor(findActiveNoteArea, 'story-label');

  const clearPreview = useCallback(() => {
    if (hideTimer.current) hideTimer.current.win.clearTimeout(hideTimer.current.handle);
    hideTimer.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!editor) return undefined;
    const root =
      chromeRef.current?.closest('.docx-editor__scroll-container') ??
      chromeRef.current?.closest('.docx-editor');
    if (!root) return undefined;

    const onClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const ref = target.closest<HTMLElement>('[data-docx-note-ref]');
      if (ref?.dataset.docxNoteScope) {
        event.preventDefault();
        clearPreview();
        setMenu(null);
        editor.setActiveScope({ kind: 'note', id: ref.dataset.docxNoteScope });
        return;
      }
      const mark = target.closest<HTMLElement>('[data-docx-note-mark-back]');
      if (mark) {
        event.preventDefault();
        clearPreview();
        setMenu(null);
        editor.setActiveScope({ kind: 'body' });
      }
    };

    // Capture, so the claim lands before the document menu's own listener on the scroller.
    // A press in the note being edited is left to the document menu: one press, one menu.
    const onContextMenu = (event: Event) => {
      if (popupsRef.current?.notesContextMenu === false) return;
      const mouse = event as globalThis.MouseEvent;
      const scopeId = noteMenuScopeOf(mouse.target, editor.getActiveScope());
      if (!scopeId) return;
      mouse.preventDefault();
      clearPreview();
      setMenu({ scopeId, x: mouse.clientX, y: mouse.clientY });
    };

    const onPointerOver = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (isTouchPrimary(target)) return;
      const ref = target?.closest<HTMLElement>('[data-docx-note-ref]');
      if (!ref?.dataset.docxNoteScope) {
        clearPreview();
        return;
      }
      const scopeId = ref.dataset.docxNoteScope;
      const engineText = editor.getNotePreviewText(scopeId);
      const text = engineText ?? ref.getAttribute('aria-description') ?? t('notes.previewFallback');
      const rect = ref.getBoundingClientRect();
      if (hideTimer.current) hideTimer.current.win.clearTimeout(hideTimer.current.handle);
      const win = hostWindowOf(ref);
      const handle = win.setTimeout(() => {
        setPreview({ scopeId, text, x: rect.left, y: rect.bottom + 4 });
      }, 400);
      hideTimer.current = { win, handle };
    };

    root.addEventListener('click', onClick);
    root.addEventListener('contextmenu', onContextMenu, true);
    root.addEventListener('pointerover', onPointerOver);
    root.addEventListener('scroll', clearPreview, true);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('contextmenu', onContextMenu, true);
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('scroll', clearPreview, true);
      clearPreview();
    };
  }, [editor, clearPreview, t]);

  // Close the menu when the user moves on: a press outside, Escape, Tab, a scroll, or the
  // window losing focus. The host wraps a custom menu too, so it closes the same way.
  const menuOpen = menu !== null;
  useEffect(() => {
    if (!menuOpen) return undefined;
    return listenForMenuDismiss({
      host: menuHostRef.current ?? chromeRef.current,
      contains: (node) => menuHostRef.current?.contains(node) === true,
      close: (restoreFocus) => {
        setMenu(null);
        if (restoreFocus) editor?.focus();
      },
    });
  }, [menuOpen, editor]);

  const runNoteCommand = useCallback(
    (command: EditorCommand) => {
      if (!editor) return;
      editor.exec(command);
      setMenu(null);
    },
    [editor]
  );

  const menuParsed = menu ? parseNoteScopeId(menu.scopeId) : null;

  const deleteCmd = useMemo(
    () =>
      menuParsed
        ? {
            type: 'deleteNote' as const,
            noteKind: menuParsed.noteKind,
            noteId: menuParsed.noteId,
          }
        : null,
    [menuParsed]
  );
  const convertCmd = useMemo(
    () =>
      menuParsed
        ? {
            type: 'convertNote' as const,
            fromKind: menuParsed.noteKind,
            noteId: menuParsed.noteId,
          }
        : null,
    [menuParsed]
  );
  const convertAllCmd = useMemo(
    () =>
      menuParsed
        ? {
            type: 'convertAllNotes' as const,
            fromKind: menuParsed.noteKind,
          }
        : null,
    [menuParsed]
  );

  const deleteGate = useCommandGate(
    deleteCmd ?? { type: 'deleteNote', noteKind: 'footnote', noteId: 0 }
  );
  const convertGate = useCommandGate(
    convertCmd ?? { type: 'convertNote', fromKind: 'footnote', noteId: 0 }
  );
  const convertAllGate = useCommandGate(
    convertAllCmd ?? { type: 'convertAllNotes', fromKind: 'footnote' }
  );

  const parsedActive = noteScope ? parseNoteScopeId(noteScope.id) : null;
  const regionLabel = parsedActive
    ? t('notes.editingRegion', {
        kind:
          parsedActive.noteKind === 'footnote' ? t('notes.footnoteKind') : t('notes.endnoteKind'),
        number: parsedActive.noteId,
      })
    : null;

  const menuProps: DocxEditorNotesContextMenuProps | null =
    menu && menuParsed
      ? {
          ...menu,
          ...menuParsed,
          onDelete: () => {
            if (deleteCmd) runNoteCommand(deleteCmd);
          },
          onConvert: () => {
            if (convertCmd) runNoteCommand(convertCmd);
          },
          onConvertAll: () => {
            if (convertAllCmd) runNoteCommand(convertAllCmd);
          },
          onOpenProperties: () => {
            setMenu(null);
            setPropsOpen(true);
          },
          onClose: () => setMenu(null),
          deleteEnabled: deleteGate.enabled,
          convertEnabled: convertGate.enabled,
          convertAllEnabled: convertAllGate.enabled,
          deleteDisabledReason: deleteGate.reason ?? undefined,
          convertDisabledReason: convertGate.reason ?? undefined,
          convertAllDisabledReason: convertAllGate.reason ?? undefined,
        }
      : null;
  const propertiesProps: DocxEditorNotePropertiesDialogProps = {
    onClose: () => setPropsOpen(false),
    onApply: (command) => {
      runNoteCommand(command);
      setPropsOpen(false);
    },
  };
  if (!editor) return null;

  return (
    <div
      className={className}
      ref={chromeRef}
      data-docx-notes-chrome=""
      data-testid="docx-notes-chrome"
      aria-hidden={noteScope || menu || propsOpen ? undefined : true}
    >
      {noteScope && parsedActive ? (
        <div
          ref={anchor.ref}
          className="docx-context-bar docx-notes-chrome__banner"
          role="region"
          aria-label={t('notes.chromeAriaLabel')}
          data-testid="docx-notes-banner"
          data-note-scope={noteScope.id}
          style={{ ...anchor.style, zIndex: Z_INDEX.chrome }}
        >
          <span className="docx-context-bar__title">{regionLabel}</span>
          <NoteStoryOptions
            onOpenProperties={() => setPropsOpen(true)}
            onClose={() => editor.setActiveScope({ kind: 'body' })}
          />
        </div>
      ) : null}

      {preview && popups?.notePreview !== false ? (
        popups?.notePreview ? (
          renderPopup(popups.notePreview, preview)
        ) : (
          <DocxEditorNotePreview {...preview} />
        )
      ) : null}
      {menuProps && popups?.notesContextMenu !== false ? (
        <div ref={menuHostRef} data-docx-notes-menu-host="" style={{ display: 'contents' }}>
          {popups?.notesContextMenu ? (
            renderPopup(popups.notesContextMenu, menuProps)
          ) : (
            <DocxEditorNotesContextMenu {...menuProps} />
          )}
        </div>
      ) : null}

      {propsOpen && popups?.noteProperties !== false ? (
        popups?.noteProperties ? (
          renderPopup(popups.noteProperties, propertiesProps)
        ) : (
          <DocxEditorNotePropertiesDialog {...propertiesProps} />
        )
      ) : null}
    </div>
  );
}

/** Properties actions for a note settings dialog. @public */
export interface DocxEditorNotePropertiesDialogProps {
  readonly onClose: () => void;
  readonly onApply: (command: EditorCommand) => void;
}
/** Default note properties dialog. @public */
export function DocxEditorNotePropertiesDialog(
  props: DocxEditorNotePropertiesDialogProps
): ReactElement {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const engineState = useNotePropertiesState();
  const [scope, setScope] = useState<'document' | 'section'>('document');
  const [footnoteFmt, setFootnoteFmt] = useState('decimal');
  const [footnoteRestart, setFootnoteRestart] = useState('continuous');
  const [footnotePosition, setFootnotePosition] = useState('pageBottom');
  const [endnoteFmt, setEndnoteFmt] = useState('decimal');
  const [endnoteRestart, setEndnoteRestart] = useState('continuous');
  const [endnotePosition, setEndnotePosition] = useState('docEnd');

  useEffect(() => {
    if (!engineState) return;
    setFootnoteFmt(engineState.footnote.resolved.numFmt);
    setFootnoteRestart(engineState.footnote.resolved.numRestart);
    setFootnotePosition(engineState.footnote.resolved.pos);
    setEndnoteFmt(engineState.endnote.resolved.numFmt);
    setEndnoteRestart(engineState.endnote.resolved.numRestart);
    setEndnotePosition(engineState.endnote.resolved.pos);
  }, [engineState]);

  // Numbering comes from the section alone; the document only supplies the endnote position.
  const footnoteInherited = !engineState?.footnote.sectionAuthored;
  const endnoteInherited =
    !engineState?.endnote.sectionAuthored &&
    engineState?.endnote.documentAuthored?.pos === undefined;

  return (
    <div
      className="docx-note-properties"
      role="dialog"
      aria-modal="true"
      data-docx-modal=""
      aria-label={t('dialogs.footnoteProperties.title')}
      data-testid="docx-notes-properties-dialog"
      style={{ zIndex: Z_INDEX.modal }}
      onClick={props.onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onClose();
      }}
    >
      <div
        className="docx-note-properties__panel"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="docx-note-properties__title">{t('dialogs.footnoteProperties.title')}</h2>
        <div className="docx-note-properties__body">
          <label className="docx-note-properties__scope">
            <span>{t('notes.scope')}</span>
            <select
              className="docx-note-properties__select"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'document' | 'section')}
            >
              <option value="document">{t('notes.scopeDocument')}</option>
              <option value="section">{t('notes.scopeSection')}</option>
            </select>
          </label>
          <fieldset className="docx-note-properties__section">
            <legend className="docx-note-properties__legend">
              <span>{t('dialogs.footnoteProperties.footnotes')}</span>
              {footnoteInherited ? (
                <span className="docx-note-properties__badge">{t('notes.inheritedValue')}</span>
              ) : null}
            </legend>
            <div className="docx-note-properties__fields">
              <label className="docx-note-properties__field">
                <span>{t('dialogs.footnoteProperties.numberFormat')}</span>
                <select
                  className="docx-note-properties__select"
                  value={footnoteFmt}
                  onChange={(e) => setFootnoteFmt(e.target.value)}
                >
                  <option value="decimal">{t('dialogs.footnoteProperties.formats.decimal')}</option>
                  <option value="lowerRoman">
                    {t('dialogs.footnoteProperties.formats.lowerRoman')}
                  </option>
                  <option value="upperRoman">
                    {t('dialogs.footnoteProperties.formats.upperRoman')}
                  </option>
                </select>
              </label>
              <label className="docx-note-properties__field">
                <span>{t('dialogs.footnoteProperties.numbering')}</span>
                <select
                  className="docx-note-properties__select"
                  value={footnoteRestart}
                  onChange={(e) => setFootnoteRestart(e.target.value)}
                >
                  <option value="continuous">
                    {t('dialogs.footnoteProperties.numberingOptions.continuous')}
                  </option>
                  <option value="eachSect">
                    {t('dialogs.footnoteProperties.numberingOptions.restartSection')}
                  </option>
                  <option value="eachPage">
                    {t('dialogs.footnoteProperties.numberingOptions.restartPage')}
                  </option>
                </select>
              </label>
              <label className="docx-note-properties__field">
                <span>{t('dialogs.footnoteProperties.position')}</span>
                <select
                  className="docx-note-properties__select"
                  value={footnotePosition}
                  onChange={(e) => setFootnotePosition(e.target.value)}
                >
                  <option value="pageBottom">
                    {t('dialogs.footnoteProperties.footnotePositions.bottomOfPage')}
                  </option>
                  <option value="beneathText">
                    {t('dialogs.footnoteProperties.footnotePositions.belowText')}
                  </option>
                </select>
              </label>
            </div>
          </fieldset>
          <fieldset className="docx-note-properties__section">
            <legend className="docx-note-properties__legend">
              <span>{t('dialogs.footnoteProperties.endnotes')}</span>
              {endnoteInherited ? (
                <span className="docx-note-properties__badge">{t('notes.inheritedValue')}</span>
              ) : null}
            </legend>
            <div className="docx-note-properties__fields">
              <label className="docx-note-properties__field">
                <span>{t('dialogs.footnoteProperties.numberFormat')}</span>
                <select
                  className="docx-note-properties__select"
                  value={endnoteFmt}
                  onChange={(e) => setEndnoteFmt(e.target.value)}
                >
                  <option value="decimal">{t('dialogs.footnoteProperties.formats.decimal')}</option>
                  <option value="lowerRoman">
                    {t('dialogs.footnoteProperties.formats.lowerRoman')}
                  </option>
                  <option value="upperRoman">
                    {t('dialogs.footnoteProperties.formats.upperRoman')}
                  </option>
                </select>
              </label>
              <label className="docx-note-properties__field">
                <span>{t('dialogs.footnoteProperties.numbering')}</span>
                <select
                  className="docx-note-properties__select"
                  value={endnoteRestart}
                  onChange={(e) => setEndnoteRestart(e.target.value)}
                >
                  <option value="continuous">
                    {t('dialogs.footnoteProperties.numberingOptions.continuous')}
                  </option>
                  <option value="eachSect">
                    {t('dialogs.footnoteProperties.numberingOptions.restartSection')}
                  </option>
                  <option value="eachPage">
                    {t('dialogs.footnoteProperties.numberingOptions.restartPage')}
                  </option>
                </select>
              </label>
              <label className="docx-note-properties__field">
                <span>{t('dialogs.footnoteProperties.position')}</span>
                <select
                  className="docx-note-properties__select"
                  value={endnotePosition}
                  data-testid="docx-notes-endnote-position"
                  onChange={(e) => setEndnotePosition(e.target.value)}
                >
                  <option value="docEnd">
                    {t('dialogs.footnoteProperties.endnotePositions.endOfDocument')}
                  </option>
                  <option value="sectEnd">
                    {t('dialogs.footnoteProperties.endnotePositions.endOfSection')}
                  </option>
                </select>
              </label>
            </div>
          </fieldset>
        </div>
        <div className="docx-note-properties__footer">
          <button className="docx-note-properties__button" type="button" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="docx-note-properties__button docx-note-properties__button--primary"
            type="button"
            data-testid="docx-notes-properties-apply"
            onClick={() => {
              if (!editor) return;
              const command: EditorCommand = {
                type: 'setNoteProperties',
                scope,
                sectionIndex: scope === 'section' ? engineState?.sectionIndex : undefined,
                footnote: {
                  numFmt: footnoteFmt,
                  numRestart: footnoteRestart,
                  position: footnotePosition,
                },
                endnote: {
                  numFmt: endnoteFmt,
                  numRestart: endnoteRestart,
                  position: endnotePosition,
                },
              };
              const can = editor.can(command);
              if (!can.ok) return;
              props.onApply(command);
            }}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Selector probe for reference-stability tests. @internal */
export function useNoteScopeProbe(): ReturnType<typeof useNoteScopeState> {
  return useNoteScopeState();
}
