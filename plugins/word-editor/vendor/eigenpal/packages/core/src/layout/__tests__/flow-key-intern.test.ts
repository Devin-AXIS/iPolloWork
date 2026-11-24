import { expect, test } from 'bun:test';
import { extendedFlowKey, withFlowKeyIntern } from '../flow-key-intern.ts';

// The memo only changes which string object answers; every answer must equal the plain
// concatenation, inside a pass, across passes, and outside any pass.
test('extended flow keys equal their concatenation across passes', () => {
  const extend = () => [
    extendedFlowKey('a', '~mk~', '1.'),
    extendedFlowKey('a', '~ls~', '1.'),
    extendedFlowKey('b', '~mk~', '1.'),
    extendedFlowKey('a', '~mk~', '2.'),
  ];
  const expected = ['a~mk~1.', 'a~ls~1.', 'b~mk~1.', 'a~mk~2.'];
  const first = withFlowKeyIntern(undefined, extend);
  expect(first.result).toEqual(expected);
  const second = withFlowKeyIntern(first.intern, () => [
    ...extend(),
    extendedFlowKey('c', '~cs~', '10'),
  ]);
  expect(second.result).toEqual([...expected, 'c~cs~10']);
  // A pass keeps only what it used: the next pass forgets a key this one did not ask for.
  const third = withFlowKeyIntern(second.intern, () => extendedFlowKey('a', '~mk~', '1.'));
  expect(third.result).toBe('a~mk~1.');
  expect([...third.intern.keys()]).toEqual(['~mk~']);
  expect([...third.intern.get('~mk~')!.keys()]).toEqual(['a']);
  expect(extendedFlowKey('a', '~mk~', '1.')).toBe('a~mk~1.');
});

test('a nested pass restores the outer memo', () => {
  const outer = withFlowKeyIntern(undefined, () => {
    withFlowKeyIntern(undefined, () => extendedFlowKey('inner', '~lbg', ''));
    return extendedFlowKey('outer', '~lbg', '');
  });
  expect(outer.result).toBe('outer~lbg');
  expect([...outer.intern.get('~lbg')!.keys()]).toEqual(['outer']);
});
