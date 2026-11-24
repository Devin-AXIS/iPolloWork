// Tests for the shared conformance fixture format + replay harness (task 1.5),
// including a spike-derived fixture replayed as DATA through the production
// harness — no spike module is imported (ADR-S9).

import { describe, expect, test } from 'bun:test';
import {
  validateFixture,
  replayFixture,
  hashAuthored,
  type ConformanceFixture,
  type ReplayStore,
  type ReplayOutcome,
  type FixtureStep,
} from '../conformance/index.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';

// Authored-state snapshots for the spike flow (create -> insert -> format).
const S0 = { story: 'body', blocks: [{ id: 'p1', text: 'Hello' }] };
const S1 = { story: 'body', blocks: [{ id: 'p1', text: 'Hello world' }] };
const S2 = { story: 'body', blocks: [{ id: 'p1', text: 'Hello world', marks: ['bold'] }] };

const spikeFixture: ConformanceFixture = {
  formatVersion: 1,
  documentId: 'doc-spike',
  source: { kind: 'create' },
  steps: [
    {
      baseRevision: 0,
      origin: ORIGIN_IDS.mutationHuman,
      ops: [{ kind: 'insertText', at: 'p1', text: ' world' }],
      expect: {
        outcome: 'applied',
        committedRevision: 1,
        modelChange: {
          fromRevision: 0,
          toRevision: 1,
          origin: ORIGIN_IDS.mutationHuman,
          dirty: ['p1'],
          dependencyKeys: [],
        },
        authoredStateHash: hashAuthored(S1),
      },
    },
    {
      baseRevision: 1,
      origin: ORIGIN_IDS.mutationHuman,
      ops: [{ kind: 'addMark', at: 'p1', mark: 'bold' }],
      expect: { outcome: 'applied', committedRevision: 2, authoredStateHash: hashAuthored(S2) },
    },
    {
      // A rejected edit commits nothing (spike: silent no-op became typed failure).
      baseRevision: 2,
      origin: ORIGIN_IDS.mutationHuman,
      ops: [{ kind: 'insertText', at: 'missing', text: 'x' }],
      expect: { outcome: 'validation' },
    },
  ],
  snapshots: [
    {
      kind: 'snapshot',
      protocolVersion: 1,
      schemaVersion: 1,
      documentId: 'doc-spike',
      byteLength: 2,
      bytesHex: 'abcd',
    },
  ],
};

// A mock store that reproduces the spike flow's authored states.
class SpikeReplayStore implements ReplayStore {
  private revision = 0;
  private states = [S1, S2];
  private idx = 0;
  init(): number {
    this.revision = 0;
    this.idx = 0;
    return 0;
  }
  applyStep(step: FixtureStep): ReplayOutcome {
    const op = step.ops[0] as { at: string };
    if (op.at === 'missing') return { outcome: 'validation' };
    this.revision += 1;
    return {
      outcome: 'applied',
      committedRevision: this.revision,
      authoredState: this.states[this.idx++],
    };
  }
}

describe('fixture validation', () => {
  test('the spike fixture is structurally valid', () => {
    expect(validateFixture(spikeFixture).valid).toBe(true);
  });
  test('unknown origin is rejected', () => {
    const bad = { ...spikeFixture, steps: [{ ...spikeFixture.steps[0], origin: 'not.an.origin' }] };
    expect(validateFixture(bad).valid).toBe(false);
  });
  test('applied step missing committedRevision is rejected', () => {
    const bad: ConformanceFixture = {
      ...spikeFixture,
      steps: [{ ...spikeFixture.steps[0], expect: { outcome: 'applied' } }],
    };
    expect(validateFixture(bad).errors.join()).toMatch(/committedRevision/);
  });
  test('failed step with a committed revision is rejected', () => {
    const bad: ConformanceFixture = {
      ...spikeFixture,
      steps: [
        { ...spikeFixture.steps[2], expect: { outcome: 'validation', committedRevision: 3 } },
      ],
    };
    expect(validateFixture(bad).valid).toBe(false);
  });
  test('envelope byteLength must match decoded bytes', () => {
    const bad: ConformanceFixture = {
      ...spikeFixture,
      snapshots: [{ ...spikeFixture.snapshots![0], byteLength: 99 }],
    };
    expect(validateFixture(bad).valid).toBe(false);
  });
  test('revision regression across steps is rejected', () => {
    const bad: ConformanceFixture = {
      ...spikeFixture,
      steps: [spikeFixture.steps[0], { ...spikeFixture.steps[1], baseRevision: 0 }],
    };
    expect(validateFixture(bad).errors.join()).toMatch(/regressed/);
  });
});

describe('replay harness', () => {
  test('spike evidence replays cleanly through the production harness (as data)', () => {
    const report = replayFixture(spikeFixture, new SpikeReplayStore());
    expect(report.ok).toBe(true);
    expect(report.mismatches).toEqual([]);
  });
  test('a store returning the wrong authored state is reported as a mismatch', () => {
    class WrongStore extends SpikeReplayStore {
      applyStep(step: FixtureStep): ReplayOutcome {
        const base = super.applyStep(step);
        if (base.outcome !== 'applied') return base;
        return { ...base, authoredState: { tampered: true } };
      }
    }
    const report = replayFixture(spikeFixture, new WrongStore());
    expect(report.ok).toBe(false);
    expect(report.mismatches.join()).toMatch(/authoredStateHash/);
  });
});
