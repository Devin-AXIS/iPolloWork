import type { LayoutCacheStats, ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './pending-line.ts';

export interface ParagraphCacheDiagnostics extends LayoutCacheStats {
  /** Entry-count limits; infinite unless the cache was created with `maxEntries`. */
  readonly softLimit: number;
  readonly hardLimit: number;
  /** Estimated retained bytes of every entry, the measure the byte budgets bound. */
  readonly estimatedBytes: number;
  /** Estimated bytes of the entries the latest retain named as live. */
  readonly namedBytes: number;
  readonly softLimitBytes: number;
  readonly hardLimitBytes: number;
  /** UTF-16 payload estimate, excluding engine headers, interning and backing storage. */
  readonly keyTextBytes: number;
  readonly softLimitEvictions: number;
  readonly hardLimitEvictions: number;
  readonly staleEvictions: number;
  /** Entries a retain stopped naming, evicted while the cache was over its soft budget. */
  readonly supersededEvictions: number;
  /** Writes refused because one entry alone exceeded the hard byte budget. */
  readonly oversizedRefusals: number;
  readonly releasedEntries: number;
  readonly clearedEntries: number;
}

interface Reader {
  snapshot(): ParagraphCacheDiagnostics;
  visit(consume: (value: unknown) => void): void;
}
const readers = new WeakMap<object, Reader>();

/** Internal registration: no document/cache is rooted by diagnostic instrumentation. */
export function registerParagraphCacheDiagnostics(cache: object, reader: Reader): void {
  readers.set(cache, reader);
}

/** On-demand O(entries) inspection. Reading never changes cache recency or counters. */
export function paragraphCacheDiagnostics(cache: object): ParagraphCacheDiagnostics | undefined {
  const reader = readers.get(cache);
  return reader ? Object.freeze(reader.snapshot()) : undefined;
}

export interface ParagraphBreakPayload {
  readonly uniqueLines: number;
  readonly uniqueSpans: number;
  /** UTF-16 logical text payload; shared span objects count once, strings may be shared further. */
  readonly spanTextBytes: number;
  readonly uniqueDrawings: number;
}

/**
 * Logical payload reachable through broken lines, deduplicated by object identity.
 * Not a retained-heap estimate: properties, shapes, arrays, canonical trees and WASM
 * resources are deliberately excluded. Call from diagnostics/benchmarks, not per paint.
 */
export function paragraphBreakPayload(
  cache: ParagraphLayoutCache<readonly PendingLine[]>
): ParagraphBreakPayload | undefined {
  const reader = readers.get(cache);
  if (!reader) return undefined;
  const lines = new Set<object>();
  const spans = new Set<object>();
  const drawings = new Set<object>();
  let spanTextBytes = 0;
  reader.visit((value) => {
    for (const line of value as readonly PendingLine[]) {
      if (lines.has(line)) continue;
      lines.add(line);
      for (const span of line.spans) {
        if (spans.has(span)) continue;
        spans.add(span);
        spanTextBytes += span.text.length * 2;
      }
      for (const drawing of line.drawings) drawings.add(drawing);
    }
  });
  return Object.freeze({
    uniqueLines: lines.size,
    uniqueSpans: spans.size,
    spanTextBytes,
    uniqueDrawings: drawings.size,
  });
}
