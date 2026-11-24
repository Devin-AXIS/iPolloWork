import {
  createDialogParts,
  useDialogDocument,
  DialogFrame,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
// The Page Setup dialog as a context-fed part (`DocxEditor.PageSetupDialog`).
//
// Size preset, orientation and margins — the fields Word's dialog and the reference
// Google-Docs chrome expose — read from `usePageSetup()` and written back as ONE
// `setPageSetup` command on Apply, so the whole dialog is a single undo step. The host
// owns visibility (`open`/`onClose`); the engine owns everything else.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from '../i18n';
import { usePageSetup } from './usePageSetup';
import { isHTMLElementNode } from '@docx-editor.dev/core/editor';

/**
 * Common page sizes in twips, PORTRAIT-normalized (width < height). Matching tolerates
 * ±20 twips and ignores orientation, so a landscape A4 still reads as "A4".
 */
const PAGE_SIZES = [
  { labelKey: 'dialogs.pageSetup.pageSizes.letter' as const, width: 12240, height: 15840 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a4' as const, width: 11906, height: 16838 },
  { labelKey: 'dialogs.pageSetup.pageSizes.legal' as const, width: 12240, height: 20160 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a3' as const, width: 16838, height: 23811 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a5' as const, width: 8391, height: 11906 },
  { labelKey: 'dialogs.pageSetup.pageSizes.b5' as const, width: 9979, height: 14175 },
  { labelKey: 'dialogs.pageSetup.pageSizes.executive' as const, width: 10440, height: 15120 },
] as const;

const TWIPS_PER_INCH = 1440;

const twipsToInches = (twips: number): number => Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
const inchesToTwips = (inches: number): number => Math.round(inches * TWIPS_PER_INCH);

function findPageSizeIndex(w: number, h: number): number {
  const pw = Math.min(w, h);
  const ph = Math.max(w, h);
  return PAGE_SIZES.findIndex(
    (size) => Math.abs(size.width - pw) < 20 && Math.abs(size.height - ph) < 20
  );
}

/** Props for `DocxEditor.PageSetupDialog`. @public */
export interface DocxEditorPageSetupDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Apply. */
  onClose: () => void;
}

const DEFAULT_WIDTH = 12240;
const DEFAULT_HEIGHT = 15840;
const DEFAULT_MARGIN = 1440;

/**
 * Page Setup dialog: size preset, orientation, margins in inches. Reads the section
 * through `usePageSetup()` and applies the whole form as one undoable command.
 *
 * @public
 */
function PageSetupDialogRoot({
  open,
  onClose,
  className,
  style,
  children,
  preset = true,
}: DocxEditorPageSetupDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const validDocument = useDialogDocument(open, onClose);
  const { pageSetup, isEnabled, apply } = usePageSetup();
  const [pageWidth, setPageWidth] = useState(DEFAULT_WIDTH);
  const [pageHeight, setPageHeight] = useState(DEFAULT_HEIGHT);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [marginTop, setMarginTop] = useState(DEFAULT_MARGIN);
  const [marginBottom, setMarginBottom] = useState(DEFAULT_MARGIN);
  const [marginLeft, setMarginLeft] = useState(DEFAULT_MARGIN);
  const [marginRight, setMarginRight] = useState(DEFAULT_MARGIN);
  const [refused, setRefused] = useState(false);
  const [scope, setScope] = useState<'document' | 'section'>('document');
  const panelRef = useRef<HTMLDialogElement | null>(null);

  // Seed the form from the document when the dialog OPENS — not on every section tick,
  // or a concurrent edit would fight the user's typing. `'loading'` covers a dialog
  // mounted open before the document finishes loading: the first non-null section
  // re-seeds once, so Apply can never stamp placeholder defaults over a real document.
  const seeded = useRef<'no' | 'loading' | 'yes'>('no');
  useEffect(() => {
    if (!open) {
      seeded.current = 'no';
      return;
    }
    // A document unload while open (host called `load()`) drops the section to null:
    // forget the seed so the NEXT document's section re-seeds instead of the old one
    // being stamped over it.
    if (seeded.current === 'yes' && pageSetup === null) {
      seeded.current = 'no';
      return;
    }
    if (seeded.current === 'yes' || (seeded.current === 'loading' && pageSetup === null)) return;
    setRefused(false);
    setPageWidth(pageSetup?.pageWidthTwips ?? DEFAULT_WIDTH);
    setPageHeight(pageSetup?.pageHeightTwips ?? DEFAULT_HEIGHT);
    setOrientation(pageSetup?.orientation ?? 'portrait');
    setMarginTop(pageSetup?.marginsTwips.top ?? DEFAULT_MARGIN);
    setMarginBottom(pageSetup?.marginsTwips.bottom ?? DEFAULT_MARGIN);
    setMarginLeft(pageSetup?.marginsTwips.left ?? DEFAULT_MARGIN);
    setMarginRight(pageSetup?.marginsTwips.right ?? DEFAULT_MARGIN);
    setScope('document');
    seeded.current = pageSetup === null ? 'loading' : 'yes';
  }, [open, pageSetup]);

  // Focus the panel on open so Escape works before any field is clicked.

  const handlePageSizeChange = useCallback(
    (index: number) => {
      const size = PAGE_SIZES[index];
      if (!size) return;
      // Presets are portrait-normalized; the current orientation decides the stored order.
      setPageWidth(orientation === 'landscape' ? size.height : size.width);
      setPageHeight(orientation === 'landscape' ? size.width : size.height);
    },
    [orientation]
  );

  const handleOrientationChange = useCallback(
    (next: 'portrait' | 'landscape') => {
      if (next === orientation) return;
      setOrientation(next);
      setPageWidth(pageHeight);
      setPageHeight(pageWidth);
    },
    [orientation, pageWidth, pageHeight]
  );

  const handleApply = useCallback(() => {
    if (!isEnabled) return;
    if (!validDocument()) {
      onClose();
      return;
    }
    // A refused write (margins that swallow the page) keeps the dialog OPEN: `apply`
    // is honest about op-layer rejections, so closing here would claim success.
    const accepted = apply({
      pageWidthTwips: pageWidth,
      pageHeightTwips: pageHeight,
      orientation,
      marginTopTwips: marginTop,
      marginRightTwips: marginRight,
      marginBottomTwips: marginBottom,
      marginLeftTwips: marginLeft,
      scope,
    });
    setRefused(!accepted);
    if (accepted) onClose();
  }, [
    isEnabled,
    validDocument,
    apply,
    pageWidth,
    pageHeight,
    orientation,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    scope,
    onClose,
  ]);

  if (!open) return null;

  const sizeIndex = findPageSizeIndex(pageWidth, pageHeight);

  const marginRow = (
    labelKey: 'top' | 'bottom' | 'left' | 'right',
    value: number,
    set: (twips: number) => void
  ) => (
    <div
      data-docx-part="field"
      data-docx-field={`margin${labelKey[0]!.toUpperCase()}${labelKey.slice(1)}`}
      className="docx-dialog__row"
    >
      <label className="docx-dialog__label">{t(`dialogs.pageSetup.${labelKey}`)}</label>
      <input
        type="number"
        className="docx-dialog__input"
        min={0}
        max={22}
        step={0.1}
        value={twipsToInches(value)}
        onChange={(event) => set(Math.max(0, inchesToTwips(Number(event.target.value) || 0)))}
        aria-label={t(`dialogs.pageSetup.${labelKey}`)}
      />
      <span className="docx-dialog__unit">{t('dialogs.paragraph.unitInches')}</span>
    </div>
  );

  const values: PageSetupDialogFields = {
    pageWidth,
    pageHeight,
    orientation,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    scope,
  };
  const setters = {
    pageWidth: setPageWidth,
    pageHeight: setPageHeight,
    orientation: handleOrientationChange,
    marginTop: setMarginTop,
    marginBottom: setMarginBottom,
    marginLeft: setMarginLeft,
    marginRight: setMarginRight,
    scope: setScope,
  };
  const state: UsePageSetupDialogReturn = {
    values,
    setValue(name, value) {
      (setters[name] as (next: typeof value) => void)(value);
    },
    errors: refused ? { form: t('dialogs.paragraph.refused') } : {},
    isEnabled,
    apply: handleApply,
    cancel: onClose,
  };
  return (
    <DialogFrame
      kind="pageSetup"
      className={className}
      style={style}
      panelRef={panelRef}
      label={t('dialogs.pageSetup.title')}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (
          event.key === 'Enter' &&
          isHTMLElementNode(event.target) &&
          event.target.localName === 'input' &&
          isEnabled
        ) {
          event.preventDefault();
          handleApply();
        }
      }}
    >
      <parts.Composition
        state={state}
        preset={preset}
        defaults={
          <>
            <div data-docx-part="header" className="docx-dialog__header">
              <span data-docx-part="title" className="docx-dialog__title">
                {t('dialogs.pageSetup.title')}
              </span>
            </div>

            <div data-docx-part="body" className="docx-dialog__body">
              <div className="docx-dialog__section-label">{t('dialogs.pageSetup.pageSize')}</div>

              <div data-docx-part="field" data-docx-field="pageSize" className="docx-dialog__row">
                <label className="docx-dialog__label">{t('dialogs.pageSetup.sizeLabel')}</label>
                <select
                  className="docx-dialog__input"
                  value={sizeIndex}
                  onChange={(event) => handlePageSizeChange(Number(event.target.value))}
                  aria-label={t('dialogs.pageSetup.sizeLabel')}
                >
                  {PAGE_SIZES.map((size, index) => (
                    <option key={size.labelKey} value={index}>
                      {t(size.labelKey)}
                    </option>
                  ))}
                  {sizeIndex < 0 && <option value={-1}>{t('dialogs.pageSetup.custom')}</option>}
                </select>
              </div>

              <div
                data-docx-part="field"
                data-docx-field="orientation"
                className="docx-dialog__row"
              >
                <label className="docx-dialog__label">{t('dialogs.pageSetup.orientation')}</label>
                <select
                  className="docx-dialog__input"
                  value={orientation}
                  onChange={(event) =>
                    handleOrientationChange(event.target.value as 'portrait' | 'landscape')
                  }
                  aria-label={t('dialogs.pageSetup.orientation')}
                >
                  <option value="portrait">{t('dialogs.pageSetup.portrait')}</option>
                  <option value="landscape">{t('dialogs.pageSetup.landscape')}</option>
                </select>
              </div>

              <div className="docx-dialog__section-label docx-dialog__section-label--spaced">
                {t('dialogs.pageSetup.margins')}
              </div>
              {marginRow('top', marginTop, setMarginTop)}
              {marginRow('bottom', marginBottom, setMarginBottom)}
              {marginRow('left', marginLeft, setMarginLeft)}
              {marginRow('right', marginRight, setMarginRight)}

              <div data-docx-part="field" data-docx-field="scope" className="docx-dialog__row">
                <label className="docx-dialog__label">{t('dialogs.pageSetup.applyTo')}</label>
                <select
                  className="docx-dialog__input"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as 'document' | 'section')}
                  aria-label={t('dialogs.pageSetup.applyTo')}
                >
                  <option value="document">{t('dialogs.pageSetup.applyToDocument')}</option>
                  <option value="section">{t('dialogs.pageSetup.applyToSection')}</option>
                </select>
              </div>
            </div>

            <div data-docx-part="footer" className="docx-dialog__footer">
              <span data-docx-part="error" role="alert" className="docx-dialog__error">
                {refused ? t('dialogs.paragraph.refused') : null}
              </span>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="cancel"
                onClick={onClose}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="docx-dialog__button docx-dialog__apply"
                disabled={!isEnabled}
                data-docx-part="apply"
                onClick={handleApply}
              >
                {t('common.apply')}
              </button>
            </div>
          </>
        }
      >
        {children}
      </parts.Composition>
    </DialogFrame>
  );
}

/** Draft page dimensions and margins use twips. @public */
export interface PageSetupDialogFields {
  pageWidth: number;
  pageHeight: number;
  orientation: 'portrait' | 'landscape';
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  scope: 'document' | 'section';
}
/** Page Setup draft and actions. @public */
export interface UsePageSetupDialogReturn extends UseDialogReturn<PageSetupDialogFields> {}
const parts = createDialogParts<
  Exclude<keyof PageSetupDialogFields, 'pageWidth' | 'pageHeight'> | 'pageSize',
  UsePageSetupDialogReturn
>();
/**
 * Read the enclosing Page Setup dialog draft.
 *
 * Call it in a child of the dialog. It does not open the dialog. To open the dialog from your
 * own toolbar, keep its `open` state and render `DocxEditor.PageSetupDialog` with `open` and
 * `onClose`. Take the button's enabled state from `usePageSetup().isEnabled`.
 *
 * @public
 */
export function usePageSetupDialog(): UsePageSetupDialogReturn {
  return parts.useState();
}
/** Page Setup with replaceable controls and layout. @public */
export const DocxEditorPageSetupDialog = Object.assign(PageSetupDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
});
