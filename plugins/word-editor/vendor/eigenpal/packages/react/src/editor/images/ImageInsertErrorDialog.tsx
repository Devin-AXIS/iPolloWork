import type { CSSProperties } from 'react';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useTranslation } from '../../i18n';
import { DialogFrame } from '../dialog-parts';

/**
 * Why a picture could not be inserted. Replace it through `popups.imageInsertError`, or pass
 * `false` there to show nothing.
 * @public
 */
export interface DocxEditorImageInsertErrorDialogProps {
  /** The translated reason the picture was refused. */
  message: string;
  /** Close the dialog. */
  onClose(): void;
  className?: string;
  style?: CSSProperties;
  /** Replaces the packaged header, message and button. */
  children?: DocxEditorChildren;
}

/** The packaged picture refusal: an editor dialog, never a page-blocking browser alert. @public */
export function DocxEditorImageInsertErrorDialog({
  message,
  onClose,
  className,
  style,
  children,
}: DocxEditorImageInsertErrorDialogProps) {
  const { t } = useTranslation();
  return (
    <DialogFrame
      kind="imageInsertError"
      role="alertdialog"
      label={t('imageInsert.errors.title')}
      className={className}
      style={style}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {children ?? (
        <>
          <header className="docx-dialog__header">
            <h2 className="docx-dialog__title">{t('imageInsert.errors.title')}</h2>
          </header>
          <div className="docx-dialog__body" data-docx-part="message">
            {message}
          </div>
          <footer className="docx-dialog__footer">
            <button
              type="button"
              className="docx-dialog__button docx-dialog__button--primary"
              onClick={onClose}
            >
              {t('common.close')}
            </button>
          </footer>
        </>
      )}
    </DialogFrame>
  );
}
