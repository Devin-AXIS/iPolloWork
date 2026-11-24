// Per-limit units, enforcement phases, and a deterministic memory substitute
// (document-engine task 2.1 / lossless-package-model "Resource defaults are
// finite and hard ceilings cannot be disabled"). Every package/XML/output limit
// gets a typed unit, an enforcement phase, an overflow-safe counter, and an
// N/N+1 boundary. Time and memory are tested via deterministic substitutes (the
// DeterministicClock from ./ports plus the meter here), not wall-clock/RSS, so
// limit tests are reproducible.

import { BoundedCounter } from './counter.ts';
import { HARD_CEILINGS, DEFAULT_LIMITS, type ResourceLimits } from './limits.ts';

/** What a limit counts. Typed so a byte cap and a depth cap cannot be compared by accident. */
export type LimitUnit = 'bytes' | 'count' | 'depth' | 'ratio' | 'passes';
/**
 * Where a limit is enforced.
 *
 * Declared per limit so enforcement happens at the boundary that can still refuse cheaply — a zip
 * cap checked during layout has already let the bomb decompress.
 */
export type EnforcementPhase = 'package-read' | 'xml-parse' | 'layout' | 'output';

/** One limit's unit and enforcement phase — the metadata that makes limits testable uniformly. */
export interface LimitSpec {
  readonly unit: LimitUnit;
  readonly phase: EnforcementPhase;
}

/** Unit + enforcement phase for every resource limit. */
export const LIMIT_SPECS: Readonly<Record<keyof ResourceLimits, LimitSpec>> = Object.freeze({
  maxRecursionDepth: { unit: 'depth', phase: 'xml-parse' },
  maxElementCount: { unit: 'count', phase: 'xml-parse' },
  maxPartCount: { unit: 'count', phase: 'package-read' },
  maxDecompressedBytes: { unit: 'bytes', phase: 'package-read' },
  maxCompressedBytes: { unit: 'bytes', phase: 'package-read' },
  maxCompressionRatio: { unit: 'ratio', phase: 'package-read' },
  maxChunkBytes: { unit: 'bytes', phase: 'package-read' },
  maxPaginationPasses: { unit: 'passes', phase: 'layout' },
  maxQueueDepth: { unit: 'count', phase: 'output' },
});

/** Every limit name, for iterating the specs and asserting each has a unit and phase. */
export const LIMIT_KEYS = Object.keys(LIMIT_SPECS) as (keyof ResourceLimits)[];

/** A phase-scoped overflow-safe counter for one limit. */
export function makeLimitCounter(
  limits: ResourceLimits,
  key: keyof ResourceLimits
): BoundedCounter {
  return new BoundedCounter(`${LIMIT_SPECS[key].phase}:${key}`, limits[key]);
}

/**
 * Deterministic memory substitute. Tracks current and peak "allocated" units
 * against a hard byte ceiling; `allocate` fails closed (LimitExceededError) past
 * the limit. Used in place of process RSS so memory-limit tests are reproducible
 * and cancellation/cleanup can be asserted without a real allocator.
 */
export class DeterministicMemoryMeter {
  private readonly counter: BoundedCounter;
  private current = 0;
  private peak = 0;

  constructor(limitBytes: number) {
    this.counter = new BoundedCounter('memory', limitBytes);
  }

  allocate(bytes: number): void {
    this.counter.add(bytes); // overflow-safe; throws past the ceiling
    this.current += bytes;
    if (this.current > this.peak) this.peak = this.current;
  }

  free(bytes: number): void {
    this.counter.release(bytes);
    this.current = Math.max(0, this.current - bytes);
  }

  get currentBytes(): number {
    return this.current;
  }
  get peakBytes(): number {
    return this.peak;
  }
  /** Release everything (cancellation/cleanup path). */
  reset(): void {
    this.counter.release(this.current);
    this.current = 0;
  }
}

/** Assert the finite-default / hard-ceiling invariant holds for every limit. */
export function assertLimitInvariants(): void {
  for (const key of LIMIT_KEYS) {
    const def = DEFAULT_LIMITS[key];
    const ceil = HARD_CEILINGS[key];
    if (!Number.isFinite(def) || def <= 0) throw new Error(`default ${key} must be finite > 0`);
    if (!Number.isFinite(ceil) || ceil <= 0) throw new Error(`ceiling ${key} must be finite > 0`);
    if (def > ceil) throw new Error(`default ${key} exceeds ceiling`);
  }
}
