export type WorkspaceFeature = 'markdown-editor' | 'excel-editor' | 'conversation-export';
declare const __IPOLLO_WORKSPACE_FEATURE__: WorkspaceFeature | 'workspace-tools';
export const feature: WorkspaceFeature | 'workspace-tools' = typeof __IPOLLO_WORKSPACE_FEATURE__ === 'undefined'
  ? 'workspace-tools' : __IPOLLO_WORKSPACE_FEATURE__;
export const packageName = `@ipollo/dsh-${feature}`;
export const endpoint = 'ipollo-' + feature;
export const hasFeature = (candidate: WorkspaceFeature) => feature === 'workspace-tools' || feature === candidate;
export const limit = 16 * 1024 * 1024;
export const documentPattern = feature === 'markdown-editor' ? /\.(?:md|markdown)$/i
  : feature === 'excel-editor' ? /\.xlsx$/i : /\.(?:md|markdown|xlsx)$/i;

export type Cell = { address: string; value: string; display?: string; kind: 'text' | 'number' | 'boolean' | 'formula' | 'locked' };
export type Sheet = { name: string; rows: number; columns: number; cells: Cell[]; protected?: boolean; blocked?: string[] };
export type CellChange = { sheet: string; address: string; value: string; kind: 'text' | 'number' | 'boolean' | 'empty' };
export type Document = { version: string; kind: 'markdown'; text: string }
  | { version: string; kind: 'workbook'; sheets: Sheet[] };
export type Message = { role: 'user' | 'assistant'; text: string };
