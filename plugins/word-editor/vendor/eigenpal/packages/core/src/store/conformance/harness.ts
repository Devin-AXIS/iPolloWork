// Replay harness for conformance fixtures (document-engine task 1.5). The
// production store/backends (sections 4–5) implement `ReplayStore`; the harness
// drives a fixture's steps against any implementation and compares outcomes,
// committed revisions, and authored-state hashes with the frozen comparators.
// This lets spike EVIDENCE be replayed as data through the production harness
// without importing any spike module (ADR-S9): a fixture is JSON, not code.

import { compareArtifacts } from '../comparators/index.ts';
import {
  validateFixture,
  type ConformanceFixture,
  type FixtureStep,
  type FixtureOutcome,
} from './fixture-format.ts';

/** The outcome a store reports for one replayed step. */
export interface ReplayOutcome {
  readonly outcome: FixtureOutcome;
  readonly committedRevision?: number;
  /** Canonical authored-state value AFTER the step (hashed via comparator 0.4). */
  readonly authoredState?: unknown;
}

/** The interface a conformance runtime implements so one fixture can drive every backend. */
export interface ReplayStore {
  /** Initialize from the fixture source; return the initial revision (0 for create). */
  init(fixture: ConformanceFixture): number;
  /** Apply one step and report what happened. */
  applyStep(step: FixtureStep): ReplayOutcome;
}

/** What replaying a fixture produced: per-step outcomes and where they diverged. */
export interface ReplayReport {
  readonly ok: boolean;
  readonly mismatches: readonly string[];
}

/**
 * Replay a fixture against a store and check every step's outcome, committed
 * revision, and authored-state fingerprint against the fixture's expectations.
 */
export function replayFixture(fixture: ConformanceFixture, store: ReplayStore): ReplayReport {
  const structural = validateFixture(fixture);
  if (!structural.valid) return { ok: false, mismatches: structural.errors };

  const mismatches: string[] = [];
  store.init(fixture);

  fixture.steps.forEach((step, i) => {
    const at = `step[${i}]`;
    const got = store.applyStep(step);
    const want = step.expect;

    if (got.outcome !== want.outcome) {
      mismatches.push(`${at}: outcome ${got.outcome} != expected ${want.outcome}`);
      return;
    }
    if (want.outcome === 'applied') {
      if (got.committedRevision !== want.committedRevision) {
        mismatches.push(
          `${at}: revision ${got.committedRevision} != expected ${want.committedRevision}`
        );
      }
      if (want.authoredStateHash !== undefined) {
        if (got.authoredState === undefined) {
          mismatches.push(`${at}: store returned no authored state to hash`);
        } else {
          // Compare the fixture's frozen hash by re-deriving via the comparator.
          const fresh = compareArtifacts(
            'authoredState',
            got.authoredState,
            got.authoredState
          ).equal;
          if (!fresh) mismatches.push(`${at}: authored state is not self-consistent`);
          const actual = hashAuthored(got.authoredState);
          if (actual !== want.authoredStateHash) {
            mismatches.push(
              `${at}: authoredStateHash ${actual} != expected ${want.authoredStateHash}`
            );
          }
        }
      }
    }
  });

  return { ok: mismatches.length === 0, mismatches };
}

// Re-export the canonical fingerprint under the authored-state ephemera policy so
// fixtures and stores agree on the hash without importing comparators directly.
import { fingerprint } from '../comparators/index.ts';
/** Hash a store's authored state, so two runtimes replaying one fixture can be compared. */
export function hashAuthored(authoredState: unknown): string {
  return fingerprint('authoredState', authoredState);
}
