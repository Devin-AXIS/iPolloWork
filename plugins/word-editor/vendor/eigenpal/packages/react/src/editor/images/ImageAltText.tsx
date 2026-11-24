import { renderPopup } from '../popup-renderer';
import { usePopupConfig } from '../popup-config';
import type { RefObject } from '../../docx-editor-ref-object';
import type { DocxEditorChildren } from '../../docx-editor-children';
// Alt-text authoring: description and title, never `@name` fallback.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from '../../i18n';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { PanelRowContent, triggerClassName, usePanelRow } from '../toolbar/panel-row';
import { hostDocumentOf, isDomNode } from '@docx-editor.dev/core/editor';

/** Props for `DocxEditorToolbar.ImageAltText`. @public */
export interface ImageAltTextProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/**
 * Opens a small panel to edit image description (and optional title).
 *
 * @public
 */
export function ImageAltText({ className, hidden, asChild, children }: ImageAltTextProps) {
  const popups = usePopupConfig();
  const label = useToolbarLabel();
  const { execute, value, isEnabled, disabledReason } = useEditorValueCommand('image.altText');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const panelRow = usePanelRow(asChild, children);

  useEffect(() => {
    if (open) setDraft(value ?? '');
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (
        isDomNode(event.target) &&
        (root?.contains(event.target) ||
          root?.ownerDocument.getElementById(panelId)?.contains(event.target))
      )
        return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const doc = hostDocumentOf(rootRef.current);
    doc.addEventListener('mousedown', onMouseDown, true);
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('mousedown', onMouseDown, true);
      doc.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panelId]);

  const apply = useCallback(() => {
    execute(draft);
    setOpen(false);
  }, [draft, execute]);

  if (hidden) return null;

  const control = chromeControlForSlot('image.altText');
  const text = label(control?.labelKey ?? 'formattingBar.altText');
  const shared = {
    type: 'button' as const,
    ref: triggerRef,
    className: `${triggerClassName(panelRow)} docx-toolbar__alt-text-trigger${className ? ` ${className}` : ''}`,
    'data-slot': 'image.altText',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => setOpen((was) => !was),
  };

  const popupProps: DocxEditorImageAltTextPopupProps = {
    id: panelId,
    value: draft,
    onValueChange: setDraft,
    onApply: apply,
    onClose: () => setOpen(false),
    isEnabled,
    anchorRef: triggerRef,
  };

  return (
    <div ref={rootRef} className="docx-toolbar__alt-text">
      {asChild ? (
        <Slot {...shared}>{children}</Slot>
      ) : (
        <button {...shared}>
          {/* The bar shows the label as text; the panel row has no icon for it. */}
          {panelRow ? <PanelRowContent icon={null} label={text} /> : (children ?? text)}
        </button>
      )}
      {open && popups?.imageAltText !== false ? (
        popups?.imageAltText ? (
          renderPopup(popups.imageAltText, popupProps)
        ) : (
          <DocxEditorImageAltTextPopup {...popupProps} />
        )
      ) : null}
    </div>
  );
}

ImageAltText.docxSlot = 'image.altText' as const;

/** @public */
export interface ImageAltTextPartComponent {
  (props: ImageAltTextProps): ReactElement | null;
  readonly docxSlot: 'image.altText';
}

export const ToolbarImageAltText: ImageAltTextPartComponent = Object.assign(ImageAltText, {
  docxSlot: 'image.altText' as const,
});

/** State and actions for the image alt-text panel. @public */
export interface DocxEditorImageAltTextPopupProps {
  id: string;
  value: string;
  onValueChange(value: string): void;
  onApply(): void;
  onClose(): void;
  isEnabled: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
}
/** Default image alt-text panel. @public */
export function DocxEditorImageAltTextPopup({
  id,
  value,
  onValueChange,
  onApply,
  onClose,
  isEnabled,
  className,
}: DocxEditorImageAltTextPopupProps) {
  const { t } = useTranslation();
  return (
    <div
      id={id}
      role="dialog"
      aria-label={t('imageAltText.panelTitle')}
      className={`docx-toolbar__alt-text-panel${className ? ` ${className}` : ''}`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <label className="docx-dialog__label" htmlFor={`${id}-description`}>
        {t('imageAltText.description')}
      </label>
      <textarea
        id={`${id}-description`}
        className="docx-dialog__textarea"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={t('dialogs.imageProperties.altTextPlaceholder')}
      />
      <div className="docx-dialog__footer">
        <button type="button" className="docx-dialog__button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="docx-dialog__button docx-dialog__button--primary"
          disabled={!isEnabled}
          onClick={onApply}
        >
          {t('common.apply')}
        </button>
      </div>
    </div>
  );
}
