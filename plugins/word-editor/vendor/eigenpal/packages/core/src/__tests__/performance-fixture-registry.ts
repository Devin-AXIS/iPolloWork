/**
 * Performance-scale fixtures excluded from general correctness corpora.
 *
 * These files are sha256-pinned and listed in their own manifest; they repeat known
 * offset disagreements or exist only for browser typing audits.
 */
export const PERFORMANCE_FIXTURE_BASENAMES = new Set(['typing-perf-521pp.docx']);

/** Whether a fixture basename is a performance-only document. */
export function isPerformanceFixture(name: string): boolean {
  return PERFORMANCE_FIXTURE_BASENAMES.has(name);
}
