import {
  createDialogParts,
  useDialogDocument,
  DialogFrame,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
// The Split cells dialog as a context-fed part (`DocxEditor.SplitCellDialog`).
//
// Two counts, columns and rows. The limits come from the `splitCellConfig` query, and every
// change asks the engine whether that split would be honoured, so the dialog shows the
// engine's own reason (a merged cell splits only into a divisor of its rows, a narrow cell
// into few columns) before the user presses Split.

import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  initialSplitCellCounts,
  isHTMLElementNode,
  readSplitCellCounts,
  SPLIT_CELL_FALLBACK_MAX,
  type SplitCellLimits,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** Props for `DocxEditor.SplitCellDialog`. @public */
export interface DocxEditorSplitCellDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Split. */
  onClose: () => void;
}

/** The Split cells dialog's draft, as typed. @public */
export interface SplitCellDialogFields {
  /** The number of columns, as typed. */
  columns: string;
  /** The number of rows, as typed. */
  rows: string;
}

/** Split cells dialog draft and actions. `apply` is Split. @public */
export interface UseSplitCellDialogReturn extends UseDialogReturn<SplitCellDialogFields> {
  /** The most columns and rows the cell splits into, or null outside a cell that splits. */
  readonly limits: SplitCellLimits | null;
}

const FALLBACK_MAX = SPLIT_CELL_FALLBACK_MAX;

function SplitCellDialogRoot(props: DocxEditorSplitCellDialogProps): ReactElement | null {
  return props.open ? <OpenSplitCellDialog {...props} /> : null;
}

const selectRevision = (snapshot: EditorSnapshot): unknown => snapshot;

function OpenSplitCellDialog({
  open,
  onClose,
  className,
  style,
  children,
  preset = true,
}: DocxEditorSplitCellDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const validDocument = useDialogDocument(open, onClose);
  // Read once per opening: the dialog is modal, so the cell under the caret stays put.
  const limits = useMemo(() => editor?.query({ type: 'splitCellConfig' }) ?? null, [editor]);
  // The first split the engine honours: two columns, else two rows, else the merged rows.
  const [initial] = useState(() =>
    initialSplitCellCounts(limits, (command) =>
      editor ? editor.can(command) : { ok: false, code: 'unsupported', reason: '' }
    )
  );
  const [columns, setColumns] = useState(initial.columns);
  const [rows, setRows] = useState(initial.rows);
  const [refusal, setRefusal] = useState<string | null>(null);
  const columnsId = useId();
  const rowsId = useId();
  const messageId = useId();

  const { counts, problem } = readSplitCellCounts(columns, rows, limits);
  const cols = counts?.cols ?? null;
  const rowCount = counts?.rows ?? null;
  // Asked again on every editor change, so a peer's edit that makes the split impossible
  // greys Split out instead of leaving a press that is refused.
  useEditorState(selectRevision);
  const verdict = editor && counts ? editor.can({ type: 'splitCell', ...counts }) : null;
  const reason =
    problem?.kind === 'range'
      ? t('dialogs.splitCell.range', { max: problem.max })
      : problem?.kind === 'oneCell'
        ? t('dialogs.splitCell.oneCell')
        : verdict && !verdict.ok
          ? localizeDisabledReason(verdict.reason ?? null, t)
          : null;
  const canSplit = verdict?.ok === true;
  const message = refusal ?? reason;
  const invalidField = problem?.kind === 'range' ? problem.field : null;

  const handleSplit = useCallback(() => {
    if (!canSplit || !editor) return;
    if (!validDocument()) {
      onClose();
      return;
    }
    const result = editor.exec({ type: 'splitCell', rows: rowCount!, cols: cols! });
    if (result.ok) onClose();
    else setRefusal(localizeDisabledReason(result.reason ?? null, t));
  }, [canSplit, editor, validDocument, onClose, rowCount, cols, t]);

  const state: UseSplitCellDialogReturn = {
    values: { columns, rows },
    setValue(field, value) {
      if (field === 'columns') setColumns(value);
      else setRows(value);
      setRefusal(null);
    },
    errors: message ? { form: message } : {},
    isEnabled: canSplit,
    apply: handleSplit,
    cancel: onClose,
    limits,
  };
  const field = (
    name: keyof SplitCellDialogFields,
    id: string,
    labelKey: 'dialogs.splitCell.columns' | 'dialogs.splitCell.rows',
    value: string,
    max: number
  ) => (
    <div data-docx-part="field" data-docx-field={name} className="docx-dialog__row">
      <label className="docx-dialog__label" htmlFor={id}>
        {t(labelKey)}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className="docx-dialog__input"
        min={1}
        max={max}
        step={1}
        value={value}
        aria-invalid={invalidField === name ? true : undefined}
        aria-describedby={messageId}
        onChange={(event) => state.setValue(name, event.target.value)}
      />
    </div>
  );
  return (
    <DialogFrame
      kind="splitCell"
      className={className}
      style={style}
      label={t('table.splitCell')}
      onClose={onClose}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          event.keyCode !== 229 &&
          isHTMLElementNode(event.target) &&
          event.target.localName === 'input'
        ) {
          event.preventDefault();
          handleSplit();
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
                {t('table.splitCell')}
              </span>
            </div>
            <div data-docx-part="body" className="docx-dialog__body">
              {field(
                'columns',
                columnsId,
                'dialogs.splitCell.columns',
                columns,
                limits?.maxCols ?? FALLBACK_MAX
              )}
              {field(
                'rows',
                rowsId,
                'dialogs.splitCell.rows',
                rows,
                limits?.maxRows ?? FALLBACK_MAX
              )}
              <div className="docx-dialog__row">
                <span
                  id={messageId}
                  data-docx-part="error"
                  role="status"
                  className="docx-dialog__error"
                >
                  {message}
                </span>
              </div>
            </div>
            <div data-docx-part="footer" className="docx-dialog__footer">
              <button
                type="button"
                className="docx-dialog__button docx-dialog__apply"
                data-docx-part="apply"
                disabled={!canSplit}
                onClick={handleSplit}
              >
                {t('dialogs.splitCell.submit')}
              </button>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="cancel"
                onClick={onClose}
              >
                {t('common.cancel')}
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

const parts = createDialogParts<'columns' | 'rows', UseSplitCellDialogReturn>();

/** Read the enclosing Split cells dialog draft. @public */
export function useSplitCellDialog(): UseSplitCellDialogReturn {
  return parts.useState();
}

/** The Split cells dialog with replaceable controls and layout. @public */
export const DocxEditorSplitCellDialog = Object.assign(SplitCellDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  /** Split: divide the cell at the selection into the typed counts. */
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
});
