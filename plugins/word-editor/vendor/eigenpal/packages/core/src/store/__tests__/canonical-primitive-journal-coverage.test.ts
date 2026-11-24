// Complete-journal coverage for every authorable TreeDocOp kind (tasks 3.6 and 3.8).

import { describe, expect, test } from 'bun:test';
import {
  observeCanonicalPrimitiveJournal,
  flushPendingCanonicalJournals,
} from '../../collaboration/primitive-journal.ts';
import { isHeaderFooterLifecycleOp } from '../package/hf-lifecycle.ts';
import { isNoteLifecycleOp } from '../package/note-lifecycle.ts';
import { applyTreeOp, TREE_DOC_OP_KINDS, type TreeDocOp } from '../store/tree-ops.ts';
import {
  COLLABORATION_COVERAGE_VOCABULARIES,
  COLLABORATION_UNCOVERED,
} from '../store/collaboration-coverage-contract.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { authorableCoverageFixtures } from './canonical-primitive-journal-coverage-ops.ts';
import {
  variantCoverageFixtures,
  type VariantFixture,
} from './canonical-primitive-variant-coverage.ts';
import {
  captureOneJournal,
  openStore,
  replayAndCompare,
  walkNodes,
} from './canonical-primitive-journal-coverage-support.ts';

const fixtures = authorableCoverageFixtures();
const variants = variantCoverageFixtures();

function dummyPart() {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function isUnsupportedKind(kind: (typeof TREE_DOC_OP_KINDS)[number]): boolean {
  try {
    const applied = applyTreeOp(dummyPart(), { op: kind, controlId: 'missing' } as TreeDocOp);
    return !applied.ok && applied.reason === 'unsupported';
  } catch {
    return false;
  }
}

describe('canonical primitive journal completeness (tasks 3.6 and 3.8)', () => {
  test('every authorable TREE_DOC_OP_KINDS member has a fixture or a declared reason', () => {
    const covered = new Set(fixtures.map((fixture) => fixture.kind));
    expect(covered.size).toBe(fixtures.length);
    // The forcing function: a kind is acceptable only if it has a replay-convergence fixture
    // OR a reasoned entry in the contract. Nothing passes by default — an agent adding an op
    // must prove it replicates or record why it cannot.
    for (const kind of TREE_DOC_OP_KINDS) {
      if (COLLABORATION_UNCOVERED.opKinds.has(kind)) continue;
      expect(covered.has(kind)).toBe(true);
    }
    // The contract cannot rot: every declared-uncovered kind must ACTUALLY refuse at apply
    // (no journal), and must not also carry a fixture that would prove it wrong.
    for (const [kind, reason] of COLLABORATION_UNCOVERED.opKinds) {
      expect(reason.length).toBeGreaterThan(0);
      expect(covered.has(kind)).toBe(false);
      expect(isUnsupportedKind(kind)).toBe(true);
    }
    // And every kind that refuses at apply must be declared, so a silently-unsupported op
    // cannot slip the gate.
    const refusing = TREE_DOC_OP_KINDS.filter((kind) => isUnsupportedKind(kind));
    expect([...refusing].sort()).toEqual([...COLLABORATION_UNCOVERED.opKinds.keys()].sort());
  });

  const VOCABULARY_LABELS = {
    paragraphProperties: 'accepted paragraph property',
    runProperties: 'accepted run property',
    wrapTargets: 'image wrap target',
    contentControlTypes: 'insertable content-control type',
  } as const;

  for (const key of Object.keys(VOCABULARY_LABELS) as (keyof typeof VOCABULARY_LABELS)[]) {
    test(`every ${VOCABULARY_LABELS[key]} has a fixture or a declared reason`, () => {
      const vocabulary = COLLABORATION_COVERAGE_VOCABULARIES[key] as readonly string[];
      const excused = COLLABORATION_UNCOVERED[key] as ReadonlyMap<string, string>;
      const covered = new Set(variants[key].map((entry) => entry.token));
      for (const member of vocabulary) {
        if (excused.has(member)) continue;
        expect(covered.has(member)).toBe(true);
      }
      // No fixture may cover a token outside the vocabulary, and no excuse may name one that
      // also has a fixture — the partition stays exact.
      for (const token of covered) expect(vocabulary).toContain(token);
      for (const [token, reason] of excused) {
        expect(reason.length).toBeGreaterThan(0);
        expect(covered.has(token)).toBe(false);
      }
    });
  }

  const everyVariant: readonly VariantFixture[] = [
    ...variants.paragraphProperties,
    ...variants.runProperties,
    ...variants.wrapTargets,
    ...variants.contentControlTypes,
  ];
  for (const variant of everyVariant) {
    const { token, fixture, expectLocalName } = variant;
    test(`variant ${fixture.kind}:${token} journal replays to an equivalent replica`, () => {
      const first = openStore(fixture.bytes);
      const second = openStore(fixture.bytes);
      const replica = openStore(fixture.bytes);
      const captured = captureOneJournal(first, () => fixture.apply(first));
      expect(captured.result.ok).toBe(true);
      if (!captured.result.ok) throw new Error(captured.result.reason ?? token);
      expect(captured.journal).not.toBeNull();
      // Convergence of an EMPTY change is not coverage: a property the applier cannot express
      // would leave the tree unchanged and still converge. Where the token names an element,
      // assert the fixture actually produced it, so a passing gate means the variant is
      // expressed, not merely survived.
      if (expectLocalName) {
        let present = false;
        walkNodes(first.bodyStore().part.root, (node) => {
          if (node.kind !== 'textValue' && node.localName === expectLocalName) present = true;
        });
        expect(present).toBe(true);
      }
      const again = captureOneJournal(second, () => fixture.apply(second));
      expect(JSON.stringify(again.journal)).toBe(JSON.stringify(captured.journal));
      replayAndCompare(replica, first, captured.journal!);
    });
  }

  test('repeating-section kinds refuse with no journal and no revision move', () => {
    const store = openStore(fixtures[0]!.bytes);
    const journals: unknown[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const before = store.packageRevision;
    for (const kind of TREE_DOC_OP_KINDS.filter((entry) => isUnsupportedKind(entry))) {
      const result = store.transact({ kind: 'body' }, (context) => {
        context.apply({ op: kind, controlId: 'missing' } as TreeDocOp);
      });
      expect(result.ok).toBe(false);
    }
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(0);
    expect(store.packageRevision).toBe(before);
  });

  for (const fixture of fixtures) {
    const path = isHeaderFooterLifecycleOp({ op: fixture.kind })
      ? 'lifecycle'
      : isNoteLifecycleOp({ op: fixture.kind })
        ? 'lifecycle'
        : 'transact';
    test(`${fixture.kind} journal replays to an equivalent replica (${path})`, () => {
      const first = openStore(fixture.bytes);
      const second = openStore(fixture.bytes);
      const replica = openStore(fixture.bytes);
      const captured = captureOneJournal(first, () => fixture.apply(first));
      expect(captured.result.ok).toBe(true);
      if (!captured.result.ok) throw new Error(captured.result.reason ?? fixture.kind);
      expect(captured.journal).not.toBeNull();
      const again = captureOneJournal(second, () => fixture.apply(second));
      expect(JSON.stringify(again.journal)).toBe(JSON.stringify(captured.journal));
      replayAndCompare(replica, first, captured.journal!);
    });
  }
});
