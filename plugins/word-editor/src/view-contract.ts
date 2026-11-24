export interface RendererContent {
  kind: 'renderer';
  revision: number;
  loaded(version: string): void;
  failed(): void;
  reload(): void;
}

export type OpenFile = { bytes: ArrayBuffer; version: string };
export type Draft = OpenFile & { savedAt: number };
export type SaveState = 'idle' | 'pending' | 'saved';
