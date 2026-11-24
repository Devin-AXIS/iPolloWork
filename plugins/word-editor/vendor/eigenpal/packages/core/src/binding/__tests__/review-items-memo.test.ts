// A document state the session returns to gets its earlier review queue back.

import { describe, expect, test } from 'bun:test';
import type { OoxmlPart, ReviewItem } from '@docx-editor.dev/core/store';
import { createReviewItemsMemo, type ReviewItemsInputs } from '../review-items-memo.ts';

const part = (name: string) => ({ name }) as unknown as OoxmlPart;
const items = (label: string) => [{ id: label }] as unknown as readonly ReviewItem[];

function inputs(overrides: Partial<ReviewItemsInputs> = {}): ReviewItemsInputs {
  return {
    root: {},
    commentsPart: part('comments'),
    commentsExtendedPart: undefined,
    stylesPart: part('styles'),
    numberingRoot: null,
    furnitureParts: [part('header1')],
    customNodePayloads: new Map(),
    ...overrides,
  };
}

describe('createReviewItemsMemo', () => {
  test('equal inputs give back the stored queue', () => {
    const memo = createReviewItemsMemo();
    const state = inputs();
    const queue = items('a');
    memo.set(state, queue);
    expect(memo.get({ ...state, furnitureParts: [...state.furnitureParts] })).toBe(queue);
  });

  test('any changed input misses', () => {
    const memo = createReviewItemsMemo();
    const state = inputs();
    memo.set(state, items('a'));
    expect(memo.get({ ...state, root: {} })).toBeUndefined();
    expect(memo.get({ ...state, commentsPart: part('comments') })).toBeUndefined();
    expect(memo.get({ ...state, furnitureParts: [] })).toBeUndefined();
    const payload = { nodeId: 'n', label: 'L', data: '{}' };
    const withPayload = { ...state, customNodePayloads: new Map([['c', payload]]) };
    memo.set(withPayload, items('b'));
    expect(
      memo.get({ ...state, customNodePayloads: new Map([['c', { ...payload }]]) })
    ).toBeDefined();
    expect(
      memo.get({ ...state, customNodePayloads: new Map([['c', { ...payload, data: '[]' }]]) })
    ).toBeUndefined();
  });

  test('only the most recent states are kept', () => {
    const memo = createReviewItemsMemo();
    const states = Array.from({ length: 9 }, () => inputs());
    for (const [index, state] of states.entries()) memo.set(state, items(String(index)));
    expect(memo.get(states[0]!)).toBeUndefined();
    expect(memo.get(states[8]!)).toBeDefined();
  });
});
