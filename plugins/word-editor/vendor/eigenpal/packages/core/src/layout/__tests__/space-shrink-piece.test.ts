import { expect, test } from 'bun:test';
import type { FieldAwarePiece } from '../field-pieces.ts';
import { isSpaceShrinkWordPiece } from '../space-shrink-piece.ts';

const piece = (extra: Partial<FieldAwarePiece>): FieldAwarePiece =>
  ({ text: '3.4', props: [], style: {}, start: 10, end: 11, ...extra }) as FieldAwarePiece;

test('a field shown by its saved result completes a justified word', () => {
  expect(
    isSpaceShrinkWordPiece(
      piece({ projected: true, fieldAtom: { formField: false, fixedResult: true } })
    )
  ).toBe(true);
});

test('page-number and form fields keep their own width policy', () => {
  expect(
    isSpaceShrinkWordPiece(
      piece({ projected: true, fieldAtom: { formField: false, pageField: { kind: 'PAGE' } } })
    )
  ).toBe(false);
  expect(isSpaceShrinkWordPiece(piece({ projected: true, fieldAtom: { formField: true } }))).toBe(
    false
  );
  // A field result without the fixed-width mark (a body PAGE placeholder) stays out.
  expect(isSpaceShrinkWordPiece(piece({ projected: true, fieldAtom: { formField: false } }))).toBe(
    false
  );
  // A projected unit that is neither a citation nor a field result stays out.
  expect(isSpaceShrinkWordPiece(piece({ projected: true }))).toBe(false);
});
