import { expect, test } from 'bun:test';
import { faceLineGapPt, takesLegacyLineGap } from '../times-new-roman-leading.ts';

const em = (units: number, sizePt = 12) => (units / 2048) * sizePt;

test('a Times New Roman face that declares no gap takes the legacy 87 units', () => {
  const gap = faceLineGapPt('Times New Roman', em(1825), em(443), 0, 12);
  expect(gap).toBeCloseTo(em(87), 9);
  // The same face box as the earlier face, whose 12pt lines step 13.7937pt in the reference.
  expect(em(1825) + em(443) + gap).toBeCloseTo((2355 / 2048) * 12, 9);
});

test('a face that declares its own gap keeps it', () => {
  expect(faceLineGapPt('Times New Roman', em(1825), em(443), em(87), 12)).toBe(em(87));
  expect(faceLineGapPt('Arial', em(1854), em(434), em(67), 12)).toBe(em(67));
});

test('other faces with no gap keep none', () => {
  expect(faceLineGapPt('Rockwell', em(1937), em(468), 0, 12)).toBe(0);
  expect(faceLineGapPt('Calibri', em(1536), em(512), 0, 12)).toBe(0);
});

test('the name alone does not take the legacy gap', () => {
  expect(faceLineGapPt('Times New Roman', em(1900), em(443), 0, 12)).toBe(0);
  expect(faceLineGapPt('times new roman ', em(1825, 24), em(443, 24), 0, 24)).toBeCloseTo(
    em(87, 24),
    9
  );
});

test('complex-script text keeps the face bytes', () => {
  expect(faceLineGapPt('Times New Roman', em(1825), em(443), 0, 12, false)).toBe(0);
  expect(takesLegacyLineGap({})).toBe(true);
  expect(takesLegacyLineGap({ shaping: { script: 'Latn' } })).toBe(true);
  expect(takesLegacyLineGap({ shaping: { script: 'Hebr' } })).toBe(false);
  expect(takesLegacyLineGap({ latinLane: {} })).toBe(false);
});
