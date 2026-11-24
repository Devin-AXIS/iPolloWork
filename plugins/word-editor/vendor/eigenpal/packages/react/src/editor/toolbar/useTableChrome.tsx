import type { ReactNode } from 'react';
// Shared React-owned table chrome draft state and command dispatch.
//
// Core owns command building and can-before-exec; this provider owns the draft that persists
// across target/color/style/width picks and forwards every pick through
// `runTableChromeCommand`. One editor subscription serves visibility; command states derive
// only when table admission or editing mode changes.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { DocumentEditingMode, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DEFAULT_TABLE_CHROME_DRAFT,
  runTableChromeCommand,
  tableChromeToolbarState,
  type TableChromeDraft,
  type TableChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorEvent } from '../useEditorEvent';
import { useEditorState } from '../useEditorState';

const TABLE_CHROME_SLOT_IDS = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
] as const satisfies readonly TableChromeSlotId[];

interface TableChromeCommandSlice {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

type TableChromeSlotStates = Record<TableChromeSlotId, TableChromeCommandSlice>;

interface TableChromeContextValue {
  readonly visible: boolean;
  readonly draft: TableChromeDraft;
  readonly setDraft: (draft: TableChromeDraft) => void;
  readonly slotState: (slot: TableChromeSlotId) => TableChromeCommandSlice;
  readonly apply: (slot: TableChromeSlotId, value: unknown) => void;
}

const TableChromeContext = createContext<TableChromeContextValue | null>(null);

let tableChromeProviderMounts = 0;
let tableChromeProviderSubscriptions = 0;
let tableChromeStateDerivations = 0;

/** @internal Test seam — mounted {@link TableChromeProvider} instances. */
export function tableChromeProviderMountCount(): number {
  return tableChromeProviderMounts;
}

/** @internal Test seam — active {@link TableChromeProvider} editor subscriptions. */
export function tableChromeProviderSubscriptionCount(): number {
  return tableChromeProviderSubscriptions;
}

/** @internal Test seam — times table slot states were re-derived from the draft. */
export function tableChromeStateDerivationCount(): number {
  return tableChromeStateDerivations;
}

/** @internal Test seam — reset {@link tableChromeStateDerivationCount}. */
export function resetTableChromeStateDerivationCount(): void {
  tableChromeStateDerivations = 0;
}

/** Read contextual visibility from the shared provider (no fallback subscription). @internal */
export function useTableChromeProviderVisible(): boolean {
  const ctx = useContext(TableChromeContext);
  if (!ctx) {
    throw new Error('table chrome group must render inside TableChromeProvider');
  }
  return ctx.visible;
}

/** Props for the provider that wraps all toolbar children. @internal */
export interface TableChromeProviderProps {
  readonly children: ReactNode;
}

/** @internal @deprecated Use {@link TableChromeProvider}. */
export const TableChromeDraftProvider = TableChromeProvider;

interface TableAdmissionSlice {
  readonly tableKey: string;
  readonly selectionKey: string;
  readonly cellSelectionKey: string;
  readonly editable: boolean;
  readonly editingMode: DocumentEditingMode;
}

function buildTableAdmissionSlice(
  editor: DocxEditorInstance | null,
  snapshot: EditorSnapshot
): TableAdmissionSlice {
  const tableCtx = snapshot.table;
  const selectedTable = editor?.getSelectedTable() ?? null;
  const tableId = selectedTable?.blockId ?? '';
  const tableKey = tableCtx
    ? `${tableId}|${tableCtx.rows}|${tableCtx.columns}|${tableCtx.rowIndex}|${tableCtx.columnIndex}`
    : '';
  const selection = snapshot.selection;
  const selectionKey = selection
    ? `${selection.from && 'paraId' in selection.from ? selection.from.paraId : ''}|${selection.to && 'paraId' in selection.to ? selection.to.paraId : ''}|${snapshot.selectionCollapsed}`
    : '';
  const cellSel = editor?.getTableCellSelection() ?? null;
  const cellSelectionKey = cellSel
    ? `${cellSel.tableId}|${cellSel.rows.from}-${cellSel.rows.to}|${cellSel.columns.from}-${cellSel.columns.to}|${cellSel.cellIds.join(',')}`
    : '';
  return {
    tableKey,
    selectionKey,
    cellSelectionKey,
    editable: snapshot.editable,
    editingMode: snapshot.editingMode ?? 'editing',
  };
}

interface SnapshotAdmissionGate {
  readonly table: EditorSnapshot['table'];
  readonly editable: boolean;
  readonly editingMode: DocumentEditingMode;
  readonly headParagraphId: string;
}

function snapshotAdmissionGateEqual(a: SnapshotAdmissionGate, b: SnapshotAdmissionGate): boolean {
  return (
    a.table === b.table &&
    a.editable === b.editable &&
    a.editingMode === b.editingMode &&
    a.headParagraphId === b.headParagraphId
  );
}

function tableAdmissionEqual(a: TableAdmissionSlice, b: TableAdmissionSlice): boolean {
  return (
    a.tableKey === b.tableKey &&
    a.selectionKey === b.selectionKey &&
    a.cellSelectionKey === b.cellSelectionKey &&
    a.editable === b.editable &&
    a.editingMode === b.editingMode
  );
}

const EMPTY_ADMISSION: TableAdmissionSlice = {
  tableKey: '',
  selectionKey: '',
  cellSelectionKey: '',
  editable: false,
  editingMode: 'editing',
};

/** @internal Test seam — admission inputs derived like {@link TableChromeProvider}. */
export function tableAdmissionSliceForTest(
  editor: DocxEditorInstance | null,
  snapshot: EditorSnapshot
): TableAdmissionSlice {
  return buildTableAdmissionSlice(editor, snapshot);
}

function deriveTableChromeSlotStates(
  editor: NonNullable<ReturnType<typeof useDocxEditor>>,
  draft: TableChromeDraft
): TableChromeSlotStates {
  tableChromeStateDerivations++;
  const states = {} as TableChromeSlotStates;
  for (const slot of TABLE_CHROME_SLOT_IDS) {
    const state = tableChromeToolbarState(editor, slot, draft);
    states[slot] = { enabled: state.enabled, disabledReason: state.disabledReason };
  }
  return states;
}

/**
 * One draft and one editor subscription for all table chrome parts.
 *
 * @internal
 */
export function TableChromeProvider({ children }: TableChromeProviderProps) {
  const editor = useDocxEditor();
  const [draft, setDraft] = useState<TableChromeDraft>(DEFAULT_TABLE_CHROME_DRAFT);
  const [admission, setAdmission] = useState<TableAdmissionSlice>(EMPTY_ADMISSION);

  useEffect(() => {
    tableChromeProviderMounts++;
    return () => {
      tableChromeProviderMounts--;
    };
  }, []);

  const snapshotGate = useEditorState(
    useCallback(
      (snapshot: EditorSnapshot): SnapshotAdmissionGate => ({
        table: snapshot.table,
        editable: snapshot.editable,
        editingMode: snapshot.editingMode ?? 'editing',
        headParagraphId:
          snapshot.selection?.to && 'paraId' in snapshot.selection.to
            ? snapshot.selection.to.paraId
            : snapshot.selection?.from && 'paraId' in snapshot.selection.from
              ? snapshot.selection.from.paraId
              : '',
      }),
      []
    ),
    snapshotAdmissionGateEqual,
    {
      onSubscribe: () => {
        tableChromeProviderSubscriptions++;
      },
      onUnsubscribe: () => {
        tableChromeProviderSubscriptions--;
      },
    }
  );

  const syncAdmission = useCallback(() => {
    if (!editor) {
      setAdmission(EMPTY_ADMISSION);
      return;
    }
    const next = buildTableAdmissionSlice(editor, editor.snapshot());
    setAdmission((prev) => (tableAdmissionEqual(prev, next) ? prev : next));
  }, [editor]);

  useEffect(() => {
    syncAdmission();
  }, [syncAdmission, snapshotGate]);

  useEditorEvent(
    'selectionChange',
    useCallback(() => {
      syncAdmission();
    }, [syncAdmission])
  );

  const visible = admission.tableKey !== '';

  const states = useMemo(
    () => (editor ? deriveTableChromeSlotStates(editor, draft) : ({} as TableChromeSlotStates)),
    [
      editor,
      draft,
      admission.tableKey,
      admission.selectionKey,
      admission.cellSelectionKey,
      admission.editable,
      admission.editingMode,
    ]
  );

  const apply = useCallback(
    (slot: TableChromeSlotId, value: unknown) => {
      if (!editor) return;
      const { result, nextDraft } = runTableChromeCommand(editor, slot, value, draft);
      if (result.ok && nextDraft) setDraft(nextDraft);
    },
    [editor, draft]
  );

  const value = useMemo<TableChromeContextValue>(
    () => ({
      visible,
      draft,
      setDraft,
      slotState: (slot) =>
        states[slot] ?? { enabled: false, disabledReason: 'editor is not ready' },
      apply,
    }),
    [visible, draft, states, apply]
  );

  return <TableChromeContext.Provider value={value}>{children}</TableChromeContext.Provider>;
}

function useTableChromeContext(): TableChromeContextValue {
  const value = useContext(TableChromeContext);
  if (!value) {
    throw new Error('table chrome parts must render inside TableChromeProvider');
  }
  return value;
}

/**
 * One table chrome slot: engine enabled state for the current draft, plus an apply helper
 * that updates the draft on success.
 *
 * @internal
 */
export function useTableChromeSlot(slot: TableChromeSlotId): {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly draft: TableChromeDraft;
  readonly apply: (value: unknown) => void;
} {
  const ctx = useTableChromeContext();
  const slice = ctx.slotState(slot);
  return useMemo(
    () => ({
      visible: ctx.visible,
      enabled: slice.enabled,
      disabledReason: slice.disabledReason,
      draft: ctx.draft,
      apply: (value: unknown) => ctx.apply(slot, value),
    }),
    [ctx, slot, slice]
  );
}
