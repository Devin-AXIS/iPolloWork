export function buildPluginRuntime(mode?: 'host' | 'bundled'): Promise<{ script: string; dependencies: string[] }>;
export function pluginUiRuntime(): import('vite').Plugin;
export const WORKSPACE_CHUNK_LIMIT_KB: number;
export function workspaceUiChunk(id: string): string | undefined;
