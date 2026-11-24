import { describe, expect, test } from 'bun:test';
import type { PaginatedSurface, PaginatedSurfaceState } from '../paginated-surface-contract.ts';
import { createPublishSignal } from '../surface-publish-signal.ts';

const surface = {
  headerFooterState: () => null,
  drawingSelectionIntent: () => ({ kind: 'none' }),
} as unknown as PaginatedSurface;

function state(pageCount: number): PaginatedSurfaceState {
  return {
    selection: null,
    pendingFormat: null,
    formatPainter: { mode: 'off', level: 'none' },
    collaborationStatus: 'inactive',
    pageCount,
  } as unknown as PaginatedSurfaceState;
}

describe('publish signal', () => {
  test('a publish that only moves the page count is reported', () => {
    const signal = createPublishSignal();
    signal.moved(state(3), surface);
    expect(signal.moved(state(30), surface)).toBe('pages');
  });

  test('a publish with the same page count stays quiet', () => {
    const signal = createPublishSignal();
    signal.moved(state(30), surface);
    expect(signal.moved(state(30), surface)).toBe('nothing');
  });

  test('a fresh surface is the baseline, so its own page count is not reported', () => {
    const signal = createPublishSignal();
    signal.adopt({ ...surface, state: () => state(12) } as unknown as PaginatedSurface);
    expect(signal.moved(state(12), surface)).toBe('nothing');
    expect(signal.moved(state(13), surface)).toBe('pages');
  });

  test('a publish that moves other state with the page count reports the state', () => {
    const signal = createPublishSignal();
    signal.moved(state(3), surface);
    const collaborating = { ...state(30), collaborationStatus: 'connected' };
    expect(signal.moved(collaborating as PaginatedSurfaceState, surface)).toBe('state');
  });
});
