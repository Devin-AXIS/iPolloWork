import { expect, test } from 'bun:test';
import { chopOversizedWord, type OversizedWordPrefix } from '../oversized-word-break.ts';
import {
  createWidthComparisonProof,
  widthComparisonProofHolds,
} from '../width-comparison-proof.ts';

function run(
  text: string,
  room: number,
  measure: (text: string) => number,
  trace = true,
  followingWidth = 0
) {
  const proof = createWidthComparisonProof(0.001);
  const pieces: OversizedWordPrefix[] = [];
  const measured: string[] = [];
  let roomReads = 0;
  let closed = 0;
  const remainder = chopOversizedWord(text, 7, measure(text), {
    remainingLineWidth: () => {
      roomReads++;
      return room;
    },
    lineHasText: () => false,
    measureText: (value) => {
      measured.push(value);
      return measure(value);
    },
    appendPrefix: (piece) => pieces.push(piece),
    closeLine: () => {
      closed++;
    },
    overflowTolerancePt: 0.001,
    followingWidth,
    ...(trace ? { onWidthComparison: proof.observe } : {}),
  });
  return { result: { pieces, remainder, measured, roomReads, closed }, proof: proof.finish() };
}

test('observed branch bounds reproduce complete cuts without monotonic prefix assumptions', () => {
  const measures = [
    (text: string) => text.length * 6,
    (text: string) => [...text].reduce((sum, char) => sum + 1 + (char.charCodeAt(0) % 7), 0),
    // Deliberately nonmonotonic: the proof preserves decisions, not a guessed longest prefix.
    (text: string) => Math.max(1, text.length * 4 + (text.length % 3 === 0 ? -7 : 4)),
  ];
  let accepted = 0;
  let changedRoom = 0;
  let rejected = 0;
  for (const text of ['1234567890123', '918273', 'A😀BC😀D'])
    for (const measure of measures) {
      for (const following of [0, 2.25])
        for (const room of [3, 6, 9, 12, 17.125, 23, 31.75, 48]) {
          const before = run(text, room, measure, true, following);
          expect(before.result).toEqual(run(text, room, measure, false, following).result);
          const proof = before.proof;
          if (!proof) continue;
          expect(Object.keys(proof)).toEqual(['acceptedWidth', 'rejectedWidth', 'tolerance']);
          const candidates = new Set([
            room,
            room - 0.25,
            room + 0.25,
            proof.acceptedWidth - proof.tolerance,
            proof.acceptedWidth - proof.tolerance - 1e-10,
            proof.acceptedWidth - proof.tolerance + 1e-10,
            proof.rejectedWidth - proof.tolerance,
            proof.rejectedWidth - proof.tolerance - 1e-10,
            proof.rejectedWidth - proof.tolerance + 1e-10,
          ]);
          for (const candidate of candidates) {
            if (!widthComparisonProofHolds(proof, candidate)) {
              rejected++;
              continue;
            }
            accepted++;
            if (candidate !== room) changedRoom++;
            expect(run(text, candidate, measure, false, following).result).toEqual(before.result);
          }
        }
    }
  expect(accepted).toBeGreaterThan(100);
  expect(changedRoom).toBeGreaterThan(100);
  expect(rejected).toBeGreaterThan(100);
});

test('changing room, invalid numbers, and inconsistent observations refuse a proof', () => {
  expect(createWidthComparisonProof(0.001).finish()).toBeUndefined();
  for (const tolerance of [NaN, Infinity, -1, 2]) {
    const trace = createWidthComparisonProof(tolerance);
    trace.observe(2, 10, true);
    expect(trace.finish()).toBeUndefined();
  }
  for (const [width, room, fits] of [
    [NaN, 10, true],
    [Infinity, 10, false],
    [-1, 10, true],
    [2 ** 21, 10, false],
    [2, NaN, false],
    [2, Infinity, true],
    [2, 0, false],
    [2, 2 ** 21, true],
    [2, 10, false],
    [20, 10, true],
    [2, 11, true],
  ] as const) {
    const trace = createWidthComparisonProof(0.001);
    trace.observe(2, 10, true);
    trace.observe(width, room, fits);
    expect(trace.finish()).toBeUndefined();
  }
  const trace = createWidthComparisonProof(0.001);
  trace.observe(20, 10, false);
  expect(trace.finish()).toBeUndefined();
});

test('the observer preserves variable-room reads and refuses their combined proof', () => {
  const runChanging = (enabled: boolean) => {
    const proof = createWidthComparisonProof(0.001);
    const effects: unknown[] = [];
    let room = 7;
    const result = chopOversizedWord('123456789', 0, 54, {
      remainingLineWidth: () => {
        effects.push(['room', room]);
        return room;
      },
      lineHasText: () => false,
      measureText: (text) => {
        effects.push(['measure', text]);
        return text.length * 6;
      },
      appendPrefix: (piece) => effects.push(['append', piece]),
      closeLine: () => {
        effects.push(['close']);
        room = room === 7 ? 13 : 7;
      },
      overflowTolerancePt: 0.001,
      ...(enabled ? { onWidthComparison: proof.observe } : {}),
    });
    return { result, effects, proof: proof.finish() };
  };
  const traced = runChanging(true);
  const plain = runChanging(false);
  expect(traced.result).toEqual(plain.result);
  expect(traced.effects).toEqual(plain.effects);
  expect(traced.proof).toBeUndefined();
});
