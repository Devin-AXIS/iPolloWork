import type { DocxEditorChildren } from '../../docx-editor-children';
// The nine Word wrap choices — value-typed chrome over `setImageWrapType`.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ImageWrapTarget } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { PanelRowContent, triggerClassName, usePanelRow } from '../toolbar/panel-row';
import { hostDocumentOf, isDomNode } from '@docx-editor.dev/core/editor';

const WRAP_OPTIONS: readonly {
  readonly value: ImageWrapTarget;
  readonly labelKey: TranslationKey;
  readonly iconName: string;
}[] = [
  { value: 'inline', labelKey: 'imageWrap.menu.inLineWithText', iconName: 'wrap_text' },
  { value: 'square', labelKey: 'imageWrap.square', iconName: 'crop_square' },
  { value: 'squareLeft', labelKey: 'imageWrap.menu.squareLeft', iconName: 'format_image_left' },
  { value: 'squareRight', labelKey: 'imageWrap.menu.squareRight', iconName: 'format_image_right' },
  { value: 'tight', labelKey: 'imageWrap.tight', iconName: 'wrap_text' },
  { value: 'through', labelKey: 'imageWrap.through', iconName: 'wrap_text' },
  { value: 'topAndBottom', labelKey: 'imageWrap.topAndBottom', iconName: 'vertical_align_center' },
  { value: 'behind', labelKey: 'imageWrap.behindText', iconName: 'flip_to_back' },
  { value: 'inFront', labelKey: 'imageWrap.inFrontOfText', iconName: 'flip_to_front' },
];

/** Props for `DocxEditorToolbar.ImageWrap`. @public */
export interface ImageWrapProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/**
 * Wrap-text dropdown presenting all nine Word choices.
 *
 * @public
 */
export function ImageWrap({ className, hidden, asChild, children }: ImageWrapProps) {
  const { t } = useTranslation();
  const label = useToolbarLabel();
  const { execute, value, isEnabled, disabledReason } = useEditorValueCommand('image.wrap');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const panelRow = usePanelRow(asChild, children);

  const current = useMemo(
    () => WRAP_OPTIONS.find((option) => option.value === value) ?? WRAP_OPTIONS[0]!,
    [value]
  );

  const control = chromeControlForSlot('image.wrap');
  const tooltip = label(control?.labelKey ?? 'formattingBar.imageWrap');

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root && isDomNode(event.target) && root.contains(event.target)) return;
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
  }, [open]);

  const choose = useCallback(
    (target: ImageWrapTarget) => {
      setOpen(false);
      execute(target);
    },
    [execute]
  );

  if (hidden) return null;

  const triggerLabel = t('imageWrap.tooltipPrefix', { label: t(current.labelKey) });
  const shared = {
    type: 'button' as const,
    ref: triggerRef,
    className: `${triggerClassName(panelRow)} docx-toolbar__image-wrap-trigger${className ? ` ${className}` : ''}`,
    'data-slot': 'image.wrap',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    'aria-label': tooltip,
    title: disabledReason ?? triggerLabel,
    onMouseDown: guardToolbarMousedown,
    onClick: () => setOpen((was) => !was),
  };

  return (
    <div ref={rootRef} className="docx-toolbar__image-wrap">
      {asChild ? (
        <Slot {...shared}>{children}</Slot>
      ) : (
        <button {...shared}>
          {panelRow ? (
            <PanelRowContent icon={chromeIcon(control?.paths)} label={tooltip} />
          ) : (
            (children ?? chromeIcon(control?.paths))
          )}
        </button>
      )}
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="docx-toolbar__image-wrap-menu"
          aria-label={t('imageWrap.menu.ariaLabel')}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {WRAP_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              className="docx-toolbar__image-wrap-item"
              aria-checked={value === option.value}
              {...(value === option.value ? { 'data-active': '' } : {})}
              onMouseDown={guardToolbarMousedown}
              onClick={() => choose(option.value)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

ImageWrap.docxSlot = 'image.wrap' as const;

/** @public */
export interface ImageWrapPartComponent {
  (props: ImageWrapProps): ReactElement | null;
  readonly docxSlot: 'image.wrap';
}

export const ToolbarImageWrap: ImageWrapPartComponent = Object.assign(ImageWrap, {
  docxSlot: 'image.wrap' as const,
});
