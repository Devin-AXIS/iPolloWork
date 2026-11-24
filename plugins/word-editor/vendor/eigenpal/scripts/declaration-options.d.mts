export declare function declarationCompilerOptions(
  configUrl: string | URL,
  extra?: Record<string, unknown>
): Record<string, unknown> & { paths: Record<string, string[]>; pathsBase: string };
