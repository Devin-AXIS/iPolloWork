export function buildPluginRuntime(mode?: 'host' | 'bundled'): Promise<{ script: string; dependencies: string[] }>;
