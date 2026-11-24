import { useLayoutEffect, useRef, useState } from 'react';
import { focusMenuItemForKey, hostWindowOf, placeContextMenu } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../i18n';
import { Z_INDEX } from '../styles/zIndex';
import { guardToolbarMousedown } from './toolbar/ToolbarButton';

/** Note hover preview content and viewport coordinates. @public */
export interface DocxEditorNotePreviewProps {
  scopeId: string;
  text: string;
  x: number;
  y: number;
  className?: string;
}
/** Default informational note preview. @public */
export function DocxEditorNotePreview({ text, x, y, className }: DocxEditorNotePreviewProps) {
  return (
    <div
      role="tooltip"
      className={className}
      data-testid="docx-notes-preview"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: Z_INDEX.popover,
        maxWidth: 280,
        maxHeight: '40vh',
        overflowY: 'auto',
        padding: '8px 10px',
        background: 'var(--doc-popover-bg)',
        color: 'var(--doc-popover-fg)',
        border: '1px solid var(--doc-border)',
        boxShadow: '0 4px 16px var(--doc-shadow)',
        fontSize: 12,
        lineHeight: 1.4,
        // A preview is informational, never an interaction surface. Large attacker-authored
        // notes must not cover the viewport or intercept pointer input.
        pointerEvents: 'none',
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {text}
    </div>
  );
}

/** Note menu target, viewport coordinates, command gates, and actions. @public */
export interface DocxEditorNotesContextMenuProps {
  scopeId: string;
  noteKind: 'footnote' | 'endnote';
  noteId: number;
  x: number;
  y: number;
  onDelete(): void;
  onConvert(): void;
  onConvertAll(): void;
  onOpenProperties(): void;
  onClose(): void;
  deleteEnabled: boolean;
  convertEnabled: boolean;
  convertAllEnabled: boolean;
  deleteDisabledReason?: string;
  convertDisabledReason?: string;
  convertAllDisabledReason?: string;
  className?: string;
}
/** Default note context menu. @public */
export function DocxEditorNotesContextMenu({
  noteKind,
  x,
  y,
  onDelete,
  onConvert,
  onConvertAll,
  onOpenProperties,
  onClose,
  deleteEnabled,
  convertEnabled,
  convertAllEnabled,
  deleteDisabledReason,
  convertDisabledReason,
  convertAllDisabledReason,
  className,
}: DocxEditorNotesContextMenuProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof placeContextMenu> | null>(null);

  // Keep the menu inside the window: below the pointer, above it, or moved up.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    const view = hostWindowOf(panel);
    const rtl = view.getComputedStyle(panel).direction === 'rtl';
    setPlacement(
      placeContextMenu(
        { x, y },
        { width, height },
        { width: view.innerWidth, height: view.innerHeight },
        rtl
      )
    );
  }, [x, y]);

  // Focus the first row once the menu is placed, so the arrow keys and Escape work at once.
  useLayoutEffect(() => {
    if (placement) focusMenuItemForKey(panelRef.current, 'Home');
  }, [placement]);

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={t('notes.menuAriaLabel')}
      className={`docx-notes-menu${className ? ` ${className}` : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        else if (focusMenuItemForKey(panelRef.current, event.key)) event.preventDefault();
      }}
      data-testid="docx-notes-menu"
      style={{
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        maxHeight: placement?.maxHeight,
        // Hidden until measured, so the menu is never seen at a position it then leaves.
        visibility: placement ? undefined : 'hidden',
        zIndex: Z_INDEX.popover,
      }}
      onMouseDown={guardToolbarMousedown}
    >
      <button
        type="button"
        role="menuitem"
        className="docx-hf-chrome__menu-item"
        data-testid="docx-notes-menu-delete"
        disabled={!deleteEnabled}
        title={deleteDisabledReason}
        onClick={onDelete}
      >
        {t('notes.delete')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="docx-hf-chrome__menu-item"
        data-testid="docx-notes-menu-convert"
        disabled={!convertEnabled}
        title={convertDisabledReason}
        onClick={onConvert}
      >
        {noteKind === 'footnote' ? t('notes.convertToEndnote') : t('notes.convertToFootnote')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="docx-hf-chrome__menu-item"
        data-testid="docx-notes-menu-convert-all"
        disabled={!convertAllEnabled}
        title={convertAllDisabledReason}
        onClick={onConvertAll}
      >
        {noteKind === 'footnote' ? t('notes.convertAllFootnotes') : t('notes.convertAllEndnotes')}
      </button>
      <div className="docx-hf-chrome__menu-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="docx-hf-chrome__menu-item"
        data-testid="docx-notes-menu-properties"
        onClick={onOpenProperties}
      >
        {t('dialogs.footnoteProperties.title')}
      </button>
    </div>
  );
}
