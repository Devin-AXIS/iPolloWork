export const pluginName = '@ipollo/dsh-project-files';
export const endpoint = '/ipollo-project-files';

export type FileKind = 'directory' | 'file';
export interface Entry {
  path: string;
  name: string;
  kind: FileKind;
  bytes: number;
  modified: number;
}
export interface Artifact extends Entry {
  sessionId: string;
  source: 'presented' | 'written';
  title?: string;
}
export interface Input {
  id: string;
  name: string;
  sessionId: string;
  type: 'image' | 'file' | 'reference';
  path?: string;
  kind?: FileKind;
  bytes: number;
  time: number;
}
export function inputKey(input: Pick<Input, 'id' | 'name' | 'type'>): string {
  return JSON.stringify([input.id, input.name, input.type]);
}
export function rasterMediaType(name: string): string | undefined {
  const format = /\.(png|jpe?g|gif|webp|avif)$/i.exec(name)?.[1]?.toLowerCase();
  return format ? 'image/' + (format === 'jpg' ? 'jpeg' : format) : undefined;
}
export interface TrashEntry {
  id: string;
  path: string;
  time: number;
}
export interface Snapshot {
  project: { id: string; title: string; root: string };
  folder: string;
  entries: Entry[];
  inputs: Input[];
  outputs: Artifact[];
  trash: TrashEntry[];
  partial: boolean;
}
export type FileAction =
  | { kind: 'copy' | 'move'; path: string; folder: string }
  | { kind: 'copy-attachment'; source: string; attachment: string; name: string; folder: string }
  | { kind: 'rename'; path: string; name: string }
  | { kind: 'mkdir'; folder: string; name: string }
  | { kind: 'trash'; path: string }
  | { kind: 'restore'; id: string };
