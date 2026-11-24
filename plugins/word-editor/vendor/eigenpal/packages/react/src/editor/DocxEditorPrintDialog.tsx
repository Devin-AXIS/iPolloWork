import { useId, type CSSProperties } from 'react';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import {
  CHROME_PRINT_DISPLAY_MODES,
  isChromePrintShortcut,
  isHTMLElementNode,
  type ChromePrintSettings,
  type ResolvedChromePrintSettings,
} from '@docx-editor.dev/core/editor';
import { DialogFrame } from './dialog-parts';

/** State and presentation for the File menu print dialog. @public */
export interface DocxEditorPrintDialogProps {
  /** Controls visibility when rendering the dialog directly. */
  open: boolean;
  /** True while the PDF handler converts the document. */
  pending: boolean;
  /** Localized failure text, or an empty string. */
  error: string;
  /**
   * An object URL for the converted PDF when printing failed after conversion, such as in a
   * browser without a PDF viewer. Otherwise an empty string. The default dialog links only
   * to `blob:` URLs.
   */
  url: string;
  /** Closes the dialog. While `pending` is true, closing also cancels printing. */
  onClose(): void;
  /**
   * True while the dialog shows print settings, before conversion starts. Present only when
   * the menu's `printSettings` step is on.
   */
  choosing?: boolean;
  /** The settings the form shows. */
  settings?: ResolvedChromePrintSettings;
  /** Changes one or both settings. */
  onSettingsChange?: (change: ChromePrintSettings) => void;
  /** Starts conversion with `settings`. */
  onPrint?: () => void;
  /** Additional class on the dialog element. */
  className?: string;
  /** Inline styles on the dialog element. */
  style?: CSSProperties;
  /** Replaces the default contents while retaining the modal and focus behavior. */
  children?: DocxEditorChildren;
}

/**
 * Default progress and error dialog for `popups.print`. The editor closes it when the
 * browser print dialog opens.
 * @public
 */
export function DocxEditorPrintDialog({
  open,
  pending,
  error,
  url,
  onClose,
  choosing = false,
  settings,
  onSettingsChange,
  onPrint,
  className,
  style,
  children,
}: DocxEditorPrintDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;
  const form = choosing && settings && onSettingsChange && onPrint;
  const title = t(
    error ? 'toolbar.printFailed' : form ? 'toolbar.print' : 'toolbar.printPreparing'
  );
  // Only the editor's own object URL becomes a link.
  const openUrl = url.startsWith('blob:') ? url : '';
  return (
    <DialogFrame
      kind="print"
      label={title}
      role={error ? 'alertdialog' : 'dialog'}
      className={`docx-export-dialog docx-print-dialog${pending ? ' docx-export-dialog--pending' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      dismissOutside={false}
      onClose={onClose}
      // The dialog stops key events, so it claims the print shortcut itself. Otherwise the
      // browser prints the editor page while the PDF is prepared.
      onKeyDown={(event) => {
        if (!isChromePrintShortcut(event.nativeEvent)) return;
        event.preventDefault();
        // On the settings step a second press confirms. A held key's auto-repeat does not, or
        // the press that opened the dialog would print before the user sees the settings.
        if (form && !event.repeat) onPrint();
      }}
    >
      {children ??
        (form ? (
          <PrintSettingsForm
            title={title}
            settings={settings}
            onSettingsChange={onSettingsChange}
            onPrint={onPrint}
            onClose={onClose}
          />
        ) : (
          <>
            <header className="docx-dialog__header">
              {pending && (
                <div className="docx-export-dialog__progress" aria-hidden="true">
                  <span className="docx-export-dialog__spinner" />
                </div>
              )}
              <h2 className="docx-dialog__title">{title}</h2>
            </header>
            {error && (
              <div className="docx-dialog__body">
                <p className="docx-export-dialog__message" role="alert">
                  {error}
                </p>
              </div>
            )}
            <footer className="docx-dialog__footer">
              {error && openUrl && (
                <a
                  className="docx-dialog__link-button docx-print-dialog__open"
                  href={openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('toolbar.printOpenPdf')}
                </a>
              )}
              <button
                type="button"
                className="docx-dialog__button"
                ref={takeFocusFromForm}
                onClick={onClose}
              >
                {t(error ? 'common.close' : 'common.cancel')}
              </button>
            </footer>
          </>
        ))}
    </DialogFrame>
  );
}

/**
 * Confirming the settings form removes its focused Print button, which leaves focus on the
 * page body behind the modal. The progress view's button takes it, so Escape and Enter
 * still reach the dialog.
 */
function takeFocusFromForm(button: unknown): void {
  if (!isHTMLElementNode(button)) return;
  const active = button.ownerDocument.activeElement;
  if (!active || !button.closest('dialog')?.contains(active)) {
    button.focus({ preventScroll: true });
  }
}

/** The settings step: which markup prints, and whether comments print beside the pages. */
function PrintSettingsForm({
  title,
  settings,
  onSettingsChange,
  onPrint,
  onClose,
}: {
  title: string;
  settings: ResolvedChromePrintSettings;
  onSettingsChange(change: ChromePrintSettings): void;
  onPrint(): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const commentsInPane = settings.displayMode === 'all-markup';
  return (
    <>
      <header className="docx-dialog__header" data-docx-part="print-settings">
        <h2 className="docx-dialog__title">{title}</h2>
      </header>
      <div className="docx-dialog__body">
        <fieldset className="docx-dialog__fieldset">
          <legend className="docx-dialog__section-label">{t('toolbar.printMarkup')}</legend>
          {CHROME_PRINT_DISPLAY_MODES.map(({ mode, labelKey }) => (
            <label
              key={mode}
              data-docx-part="field"
              data-docx-field={mode}
              className="docx-dialog__checkbox-row"
            >
              <input
                type="radio"
                name={`${id}-mode`}
                checked={settings.displayMode === mode}
                onChange={() => onSettingsChange({ displayMode: mode })}
              />
              {t(labelKey)}
            </label>
          ))}
        </fieldset>
        <label
          data-docx-part="field"
          data-docx-field="comments"
          className="docx-dialog__checkbox-row"
        >
          <input
            type="checkbox"
            checked={settings.comments}
            aria-describedby={commentsInPane ? undefined : `${id}-comments-note`}
            onChange={(event) => onSettingsChange({ comments: event.target.checked })}
          />
          {t('toolbar.printComments')}
        </label>
        {!commentsInPane && (
          <p id={`${id}-comments-note`} className="docx-dialog__note">
            {t('toolbar.printCommentsNote', { mode: t('review.allMarkup') })}
          </p>
        )}
      </div>
      <footer className="docx-dialog__footer">
        <button type="button" className="docx-dialog__button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="docx-dialog__button docx-dialog__button--primary"
          onClick={onPrint}
        >
          {t('toolbar.print')}
        </button>
      </footer>
    </>
  );
}
