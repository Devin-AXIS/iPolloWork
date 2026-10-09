export type EditHistoryKind = "manual" | "motion" | "timeline" | "source";

export interface EditHistoryFileSnapshot {
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
}

export interface EditHistoryEntry {
  id: string;
  projectId: string;
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  /** Per-entry coalesce window override (ms). Falls back to the reducer default. */
  coalesceMs?: number;
  createdAt: number;
  files: Record<string, EditHistoryFileSnapshot>;
}

/** Read-only IndexedDB v1 format, retained until existing user history migrates. */
export interface EditHistoryState {
  version: 1;
  updatedAt: number;
  undo: EditHistoryEntry[];
  redo: EditHistoryEntry[];
}
