// Derivation freshness under structural edits: `usedParaIds`, `deepParagraphOrderOfPart`
// and `revisionItemsOf` compose from per-subtree memos in module-level WeakMaps keyed on
// node OBJECTS, and a store edit shares every untouched subtree by reference across
// revisions — so a stale entry would be read back by any pass over the same nodes,
// including the one that checks it.
//
// The clean side of the differential therefore derives over a structuredClone of the part:
// same content, all-new node objects, so nothing identity-keyed can be shared with the
// memoized side. Node ids are plain data properties (minted as `${partName}#${path}` at
// parse, and by the transaction's id counter afterwards), so the clone carries the
// ORIGINAL ids and both the paragraph-order map and the revision items compare by value.
//
// Two fixtures: an untracked one, where the revision read must answer [] at every step
// (the empty early return in front of the site index), and a tracked one seeded with
// `w:ins`/`w:del` plus tracked insertions in the op vocabulary, where the read must keep
// answering the full card list.
//
// Determinism and the random-edit machinery live in `random-edit-test-support.ts`,
// shared with `note-scan-memo-freshness.test.ts`.

import { describe, expect, test } from 'bun:test';
import {
  deepParagraphOrderOfPart,
  revisionItemsOf,
  TreeDocumentStore,
  usedParaIds,
  type OoxmlPart,
} from '../index.ts';
import {
  driveRandomEdits,
  loadPart,
  mulberry32,
  PLAIN_RANDOM_OPS,
  TRACKED_RANDOM_OPS,
  W,
  W14,
} from './random-edit-test-support.ts';

// ── Fixtures ───────────────────────────────────────────────────────────────────
// Every paragraph carries authored identity and the root binds w14, so every applied
// split MINTS a fresh paraId against the memoized set — without identity the id half of
// the oracle would never move.

const paraIdFor = (index: number): string => (0x4c0a0001 + index).toString(16).toUpperCase();

const para = (index: number, text: string, extra = ''): string =>
  `<w:p w14:paraId="${paraIdFor(index)}" w14:textId="${paraIdFor(index)}">` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${extra}</w:p>`;

const INS =
  `<w:ins w:id="101" w:author="QA Reviewer" w:date="2026-01-01T00:00:00Z">` +
  `<w:r><w:t xml:space="preserve"> added words</w:t></w:r></w:ins>`;
const DEL =
  `<w:del w:id="102" w:author="QA Reviewer" w:date="2026-01-02T00:00:00Z">` +
  `<w:r><w:delText xml:space="preserve"> removed words</w:delText></w:r></w:del>`;

function fixturePart(tracked: boolean): OoxmlPart {
  const words = 'word '.repeat(6);
  const body = Array.from({ length: 10 }, (_, i) =>
    para(i, `p${i} ${words}`, tracked && i === 2 ? INS : tracked && i === 5 ? DEL : '')
  ).join('');
  return loadPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
  );
}

// ── The oracle ─────────────────────────────────────────────────────────────────

/** Memoized derivations over the retained part vs the same derivations over a clone. */
function assertFreshDerivations(
  store: TreeDocumentStore,
  seed: number,
  step: number,
  log: unknown[]
): void {
  const clone = structuredClone(store.part);
  const comparisons: [string, unknown, unknown][] = [
    ['usedParaIds', [...usedParaIds(store.part.root)].sort(), [...usedParaIds(clone.root)].sort()],
    [
      'deepParagraphOrderOfPart',
      [...deepParagraphOrderOfPart(store.part).entries()],
      [...deepParagraphOrderOfPart(clone).entries()],
    ],
    ['revisionItemsOf', revisionItemsOf(store.part), revisionItemsOf(clone)],
  ];
  for (const [name, memoized, fresh] of comparisons) {
    const memoizedJson = JSON.stringify(memoized);
    const freshJson = JSON.stringify(fresh);
    if (memoizedJson !== freshJson) {
      throw new Error(
        `${name} over the retained tree diverged from the clone derivation.\n` +
          `seed: ${seed}, step: ${step}\nmemoized: ${memoizedJson}\nfresh: ${freshJson}\n` +
          `replay script:\n${JSON.stringify(log)}`
      );
    }
  }
}

const SEEDS = [0xc0ffee, 42, 20260825];
const STEPS = 30;

describe('per-subtree derivation memos stay fresh across random op sequences', () => {
  for (const tracked of [false, true]) {
    for (const seed of SEEDS) {
      test(`${tracked ? 'tracked' : 'untracked'} fixture, seed ${seed}: ${STEPS} random ops`, () => {
        const store = new TreeDocumentStore(fixturePart(tracked));

        // The fixture's authored identity must have parsed, or splits mint nothing and
        // the id half of the oracle measures a constant.
        expect(usedParaIds(store.part.root).size).toBe(10);
        if (tracked) expect(revisionItemsOf(store.part).length).toBeGreaterThanOrEqual(2);
        else expect(revisionItemsOf(store.part)).toEqual([]);

        const { applied, splitsApplied } = driveRandomEdits(store, {
          rand: mulberry32(seed),
          steps: STEPS,
          ops: tracked ? TRACKED_RANDOM_OPS : PLAIN_RANDOM_OPS,
          onApplied: (step, _op, log) => assertFreshDerivations(store, seed, step, log),
        });

        // Anti-vacuity: enough ops applied, and enough splits that fresh paraIds were
        // minted against — and then read back through — the memoized set.
        expect(applied).toBeGreaterThanOrEqual(15);
        expect(splitsApplied).toBeGreaterThanOrEqual(2);
      });
    }
  }
});
