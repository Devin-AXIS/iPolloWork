// Budgeted note-reference scans compose from per-subtree memos in a module-level WeakMap
// keyed on node OBJECTS, and a store edit shares every untouched subtree by reference
// across revisions — so a stale entry (wrong hits, wrong visited count, wrong depth)
// would be read back by every later scan, including the one that checks it.
//
// The clean side of the differential therefore scans a structuredClone of the part: same
// content, all-new node objects, so nothing identity-keyed can be shared with the
// memoized side and the clone's first walk IS the unmemoized walk. Node ids are plain
// data properties, so the clone carries the ORIGINAL ids and hits compare by value.
//
// Three probes per applied op:
// 1. The budget-free path FIRST (while the edited spine is still unmemoized), which
//    runs the same walk over the same memo under an unbounded internal budget — so the
//    two entry points cannot drift apart — then again warm through the root fast path.
// 2. Full budget: hits AND the final `budget.visited` / `budget.truncated` must be
//    byte-identical to the cold walk — downstream parts sharing one budget must truncate
//    at exactly the same point.
// 3. A budget small enough to truncate mid-tree: hits and accounting must STILL match
//    the cold walk byte-for-byte, because an overrunning memo falls through to the
//    plain descent (pre-truncation prefixes feed diagnoseNoteReferences).
//
// Determinism and the random-edit machinery live in `random-edit-test-support.ts`,
// shared with `derivation-memo-freshness.test.ts`.

import { describe, expect, test } from 'bun:test';
import { TreeDocumentStore, type OoxmlPart } from '../index.ts';
import { collectNoteReferences, createNoteReferenceScanBudget } from '../package/index.ts';
import { budgetedNoteScanMemoStats } from '../package/note-references.ts';
import {
  driveRandomEdits,
  loadPart,
  mulberry32,
  W,
  type RandomOpKind,
} from './random-edit-test-support.ts';

// ── Fixture ────────────────────────────────────────────────────────────────────
// Note references sit in every third paragraph, inside hyperlinks in some, so edits hit
// both ref-bearing and plain subtrees and splits/joins move refs between spines.

function fixturePart(): OoxmlPart {
  const words = 'word '.repeat(6);
  const paragraphs = Array.from({ length: 12 }, (_, i) => {
    const ref =
      i % 3 === 0
        ? `<w:r><w:footnoteReference w:id="${i + 1}"/></w:r>`
        : i % 3 === 1
          ? `<w:hyperlink w:anchor="a${i}"><w:r><w:endnoteReference w:id="${i + 100}"/></w:r></w:hyperlink>`
          : '';
    return `<w:p><w:r><w:t xml:space="preserve">p${i} ${words}</w:t></w:r>${ref}</w:p>`;
  }).join('');
  return loadPart(
    `<w:document xmlns:w="${W}"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`
  );
}

const OPS: readonly RandomOpKind[] = ['insert-text', 'insert-text', 'delete-text', 'split', 'join'];

// ── The oracle ─────────────────────────────────────────────────────────────────

const FULL_BUDGET = 1_000_000;

function fail(name: string, seed: number, step: number, detail: string, log: unknown[]): never {
  throw new Error(
    `${name} over the retained tree diverged from the clone walk.\n` +
      `seed: ${seed}, step: ${step}\n${detail}\nreplay script:\n${JSON.stringify(log)}`
  );
}

/** Memoized budgeted scans over the retained part vs cold walks over structuredClones. */
function assertBudgetedScanFresh(
  part: OoxmlPart,
  seed: number,
  step: number,
  log: unknown[]
): void {
  // Budget-free first, before anything re-memoizes the edited spine: the root entry is
  // stale after an edit, so this exercises the warm budget-free WALK (in-walk bulk
  // reuse and prune bookkeeping), not just the root fast path. It must agree with its
  // own cold walk, so the two entry points into the shared memo cannot drift apart.
  const plainJson = JSON.stringify(collectNoteReferences(part));
  const plainColdJson = JSON.stringify(collectNoteReferences(structuredClone(part)));
  if (plainJson !== plainColdJson) {
    fail('budget-free hits', seed, step, `memoized: ${plainJson}\nfresh: ${plainColdJson}`, log);
  }
  // That walk completed, so a second budget-free scan serves from the root fast path
  // and must return the same answer.
  const plainWarmJson = JSON.stringify(collectNoteReferences(part));
  if (plainWarmJson !== plainJson) {
    fail('budget-free root reuse', seed, step, `warm: ${plainWarmJson}\nwalk: ${plainJson}`, log);
  }

  // Full budget: hits and accounting byte-identical to the cold walk.
  const memoBudget = createNoteReferenceScanBudget(FULL_BUDGET);
  const memoHits = collectNoteReferences(part, {
    budget: memoBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  const coldClone = structuredClone(part);
  const coldBudget = createNoteReferenceScanBudget(FULL_BUDGET);
  const coldHits = collectNoteReferences(coldClone, {
    budget: coldBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  const memoJson = JSON.stringify(memoHits);
  const coldJson = JSON.stringify(coldHits);
  if (memoJson !== coldJson) {
    fail('budgeted hits', seed, step, `memoized: ${memoJson}\nfresh: ${coldJson}`, log);
  }
  if (memoBudget.visited !== coldBudget.visited || memoBudget.truncated !== coldBudget.truncated) {
    fail(
      'budget accounting',
      seed,
      step,
      `memoized: visited ${memoBudget.visited}, truncated ${memoBudget.truncated}\n` +
        `fresh: visited ${coldBudget.visited}, truncated ${coldBudget.truncated}`,
      log
    );
  }
  if (memoBudget.truncated) {
    fail('full budget', seed, step, 'full budget unexpectedly truncated', log);
  }

  // A budget that truncates mid-tree: a warm memo whose bulk charge would overrun the
  // remaining budget must fall through to the plain descent, so hits AND accounting
  // stay byte-identical to the cold walk — pre-truncation hit prefixes (which
  // diagnoseNoteReferences reports) survive warm memos.
  const cap = Math.max(1, Math.floor(coldBudget.visited / 2));
  const memoSmall = createNoteReferenceScanBudget(cap);
  const memoSmallHits = collectNoteReferences(part, {
    budget: memoSmall,
    maxHits: Number.POSITIVE_INFINITY,
  });
  const coldSmall = createNoteReferenceScanBudget(cap);
  const coldSmallHits = collectNoteReferences(structuredClone(part), {
    budget: coldSmall,
    maxHits: Number.POSITIVE_INFINITY,
  });
  if (memoSmall.visited !== coldSmall.visited || memoSmall.truncated !== coldSmall.truncated) {
    fail(
      'truncating budget accounting',
      seed,
      step,
      `cap: ${cap}\nmemoized: visited ${memoSmall.visited}, truncated ${memoSmall.truncated}\n` +
        `fresh: visited ${coldSmall.visited}, truncated ${coldSmall.truncated}`,
      log
    );
  }
  const memoSmallJson = JSON.stringify(memoSmallHits);
  const coldSmallJson = JSON.stringify(coldSmallHits);
  if (memoSmallJson !== coldSmallJson) {
    fail(
      'truncated hit prefix',
      seed,
      step,
      `cap: ${cap}\nmemoized: ${memoSmallJson}\nfresh: ${coldSmallJson}`,
      log
    );
  }
}

const SEEDS = [0xc0ffee, 42, 20260825];
const STEPS = 30;

describe('budgeted note-reference scan memos stay fresh across random op sequences', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: ${STEPS} random ops`, () => {
      const store = new TreeDocumentStore(fixturePart());

      // The fixture's typed references must have parsed, or the oracle compares empty
      // hit lists at every step.
      expect(collectNoteReferences(store.part).length).toBeGreaterThanOrEqual(6);
      assertBudgetedScanFresh(store.part, seed, -1, []);

      const reusesBefore = budgetedNoteScanMemoStats.reuses;
      const budgetFreeReusesBefore = budgetedNoteScanMemoStats.budgetFreeReuses;
      const rootReusesBefore = budgetedNoteScanMemoStats.budgetFreeRootReuses;
      const { applied, splitsApplied } = driveRandomEdits(store, {
        rand: mulberry32(seed),
        steps: STEPS,
        ops: OPS,
        onApplied: (step, _op, log) => assertBudgetedScanFresh(store.part, seed, step, log),
      });

      // Anti-vacuity: enough ops applied, and enough splits that fresh spines were
      // rescanned against — and read back through — the memoized subtrees. The reuse
      // floors prove memos actually served (equivalence alone would also pass for a
      // memo that never hits, which delivers correctness but none of the latency win).
      // The counters are per serve site, so a budgeted-walk regression cannot hide
      // behind budget-free reuses, an in-walk regression cannot hide behind the root
      // fast path, or the reverse.
      expect(applied).toBeGreaterThanOrEqual(12);
      expect(splitsApplied).toBeGreaterThanOrEqual(2);
      expect(budgetedNoteScanMemoStats.reuses - reusesBefore).toBeGreaterThanOrEqual(applied);
      expect(
        budgetedNoteScanMemoStats.budgetFreeReuses - budgetFreeReusesBefore
      ).toBeGreaterThanOrEqual(applied);
      expect(
        budgetedNoteScanMemoStats.budgetFreeRootReuses - rootReusesBefore
      ).toBeGreaterThanOrEqual(applied);
    });
  }
});

describe('memo reuse under a finite maxHits clip', () => {
  test('clipped hit prefix matches the cold walk; full buffer reads as truncated coverage', () => {
    const store = new TreeDocumentStore(fixturePart());
    // Warm the memos with an unclipped mutation-style scan.
    const warm = createNoteReferenceScanBudget(FULL_BUDGET);
    const all = collectNoteReferences(store.part, {
      budget: warm,
      maxHits: Number.POSITIVE_INFINITY,
    });
    expect(all.length).toBeGreaterThanOrEqual(6);

    // Diagnostics-style clip over the warmed tree. A memo whose hits would reach the
    // clip must fall through to the plain descent, so hits, visited and truncated all
    // stay byte-identical to the cold walk even where the clip binds mid-subtree.
    const maxHits = 2;
    const memoBudget = createNoteReferenceScanBudget(FULL_BUDGET);
    const memoClipped = collectNoteReferences(store.part, { budget: memoBudget, maxHits });
    const coldBudget = createNoteReferenceScanBudget(FULL_BUDGET);
    const coldClipped = collectNoteReferences(structuredClone(store.part), {
      budget: coldBudget,
      maxHits,
    });
    expect(memoClipped).toHaveLength(maxHits);
    expect(JSON.stringify(memoClipped)).toBe(JSON.stringify(coldClipped));
    expect(memoBudget.visited).toBe(coldBudget.visited);
    expect(memoBudget.truncated).toBe(false);
    expect(coldBudget.truncated).toBe(false);
  });
});
