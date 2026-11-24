import { expect, test } from 'bun:test';
import { createRevisionMarkupState } from '../revision-markup-state.ts';
import {
  DEFAULT_REVISION_MARKUP,
  type RevisionMarkupDialogSession,
  type ResolvedRevisionMarkup,
} from '../../contracts/revision-markup.ts';
import type { ReviewModuleContribution } from '../../contracts/modules.ts';

function setup() {
  let destroyed = false;
  let attached = true;
  let fallbackOpened = 0;
  let fallbackDestroyed = 0;
  const changes: ResolvedRevisionMarkup[] = [];
  const contribution = {
    createRevisionMarkupDialog: () => ({
      open() {
        fallbackOpened++;
      },
      destroy() {
        fallbackDestroyed++;
      },
    }),
  } as unknown as ReviewModuleContribution;
  const state = createRevisionMarkupState(undefined, {
    container: () => (attached ? document.createElement('div') : null),
    destroyed: () => destroyed,
    contribution: () => contribution,
    translate: () => undefined,
    apply: () => {},
    changed: (value) => changes.push(value),
  });
  const requested: RevisionMarkupDialogSession[] = [];
  const register = () => state.register({ onRequest: (session) => requested.push(session) });
  return {
    state,
    changes,
    requested,
    register,
    fallbackOpened: () => fallbackOpened,
    fallbackDestroyed: () => fallbackDestroyed,
    detach() {
      attached = false;
      state.destroyDialog();
    },
    destroy() {
      destroyed = true;
      state.destroyDialog();
    },
  };
}

test('custom settings sessions stage, reset, validate, and commit once', () => {
  const host = setup();
  const dispose = host.register();
  host.state.open();
  const session = host.requested[0]!;
  let notifications = 0;
  const unsubscribe = session.subscribe(() => notifications++);
  session.set({ insertions: { color: 'blue' } });
  expect(host.state.current()).toEqual(DEFAULT_REVISION_MARKUP);
  expect(host.changes).toHaveLength(0);
  expect(session.get().insertions).toEqual({
    color: 'blue',
    mark: 'underline',
    background: 'none',
  });
  expect(() => session.set({ insertions: { color: 'invalid' as never } })).toThrow();
  expect(session.get().insertions.color).toBe('blue');
  session.reset();
  expect(host.changes).toHaveLength(0);
  expect(session.get()).toBe(DEFAULT_REVISION_MARKUP);
  session.set({ formatting: { mark: 'bold' } });
  expect(notifications).toBe(3);
  unsubscribe();
  expect(session.canApply()).toBe(true);
  expect(session.apply()).toBe(true);
  expect(host.state.current().formatting.mark).toBe('bold');
  expect(host.changes).toHaveLength(1);
  expect(session.signal.aborted).toBe(true);
  expect(session.canApply()).toBe(false);
  expect(session.apply()).toBe(false);
  session.set({ formatting: { mark: 'italic' } });
  expect(host.changes).toHaveLength(1);
  dispose();
});

test('effective external preferences refresh drafts and no-op setters preserve drafts', () => {
  const host = setup();
  host.register();
  host.state.open();
  const session = host.requested[0]!;
  session.set({ deletions: { mark: 'hidden' } });
  host.state.set({ insertions: { color: 'green' } });
  expect(session.get()).toBe(host.state.current());
  expect(session.get().deletions.mark).toBe('strikethrough');
  session.set({ deletions: { mark: 'hidden' } });
  host.state.set({ insertions: { color: 'green' } });
  host.state.set({});
  expect(session.get().deletions.mark).toBe('hidden');
  expect(host.state.current().deletions.mark).toBe('strikethrough');
  session.cancel();
  expect(host.changes).toHaveLength(1);
});

for (const fallbackFirst of [true, false]) {
  test(`manual dialog registration overrides fallback, mount order ${fallbackFirst}`, () => {
    const host = setup();
    const calls: string[] = [];
    let manual!: () => void;
    let fallback!: () => void;
    const registerManual = () => host.state.register({ onRequest: () => calls.push('manual') });
    const registerFallback = () =>
      host.state.register({ onRequest: () => calls.push('fallback') }, { fallback: true });
    if (fallbackFirst) {
      fallback = registerFallback();
      manual = registerManual();
    } else {
      manual = registerManual();
      fallback = registerFallback();
    }
    host.state.open();
    expect(calls).toEqual(['manual']);
    manual();
    host.state.open();
    expect(calls).toEqual(['manual', 'fallback']);
    fallback();
    host.state.open();
    expect(host.fallbackOpened()).toBe(1);
    host.state.destroyDialog();
    expect(host.fallbackDestroyed()).toBe(1);
  });
}

test('registration disposal, reopening, detach, and destroy cancel sessions without writes', () => {
  const host = setup();
  const firstDispose = host.register();
  host.state.open();
  const first = host.requested[0]!;
  host.state.open();
  expect(first.signal.aborted).toBe(true);
  const second = host.requested[1]!;
  second.set({ trackMoves: false });
  firstDispose();
  expect(second.signal.aborted).toBe(true);
  host.register();
  host.state.open();
  const third = host.requested[2]!;
  host.detach();
  expect(third.signal.aborted).toBe(true);
  expect(host.changes).toHaveLength(0);
  const other = setup();
  other.register();
  other.state.open();
  other.destroy();
  expect(other.requested[0]!.signal.aborted).toBe(true);
  expect(other.requested[0]!.apply()).toBe(false);
});

test('a null registration selects native chrome and disposal restores the previous renderer', () => {
  const host = setup();
  host.register();
  const restore = host.state.register(null);
  host.state.open();
  expect(host.fallbackOpened()).toBe(1);
  expect(host.requested).toHaveLength(0);
  restore();
  host.state.open();
  expect(host.requested).toHaveLength(1);
  host.destroy();
});
