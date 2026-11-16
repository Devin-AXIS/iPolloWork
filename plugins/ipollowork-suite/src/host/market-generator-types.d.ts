/** Build-time alias to the unmodified, pinned official DSH reference generator. */
declare module '#dsh-market-generator' {
  export function generate(options: {
    sources: readonly ({ kind: 'npm'; line: string; name: string } | { kind: 'git'; line: string; url: string })[];
    cacheDir: string; registry: string; recordRegistry: boolean; title: string; inlineIconBytes: number;
    limits: { timeoutMs: number; maxTarballBytes: number }; concurrency: number; warn(message: string): void;
    gitTransports: readonly string[];
  }): Promise<{ index: { plugins: readonly unknown[] }; failures: readonly string[] }>;
}
