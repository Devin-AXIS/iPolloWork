import { expect, test } from 'bun:test';
import { createEditorEvents } from '../editor-events.ts';

for (const nested of [false, true]) {
  test(`deferred changes preserve emission order during listener edits (nested=${nested})`, () => {
    const events = createEditorEvents(() => {
      throw new Error('No snapshot requested');
    });
    const seen: string[] = [];
    events.on('change', ({ revision }) => {
      seen.push(`first:${revision}`);
      if (revision === 1) {
        const emit = () => events.emitDocumentChange({ revision: 3 });
        if (nested) events.defer(emit);
        else emit();
      }
    });
    events.on('change', ({ revision }) => seen.push(`second:${revision}`));
    events.defer(() => {
      events.emitDocumentChange({ revision: 1 });
      events.emitDocumentChange({ revision: 2 });
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual(['first:1', 'second:1', 'first:2', 'second:2', 'first:3', 'second:3']);
    events.emitDocumentChange({ revision: 4 });
    expect(seen.slice(-2)).toEqual(['first:4', 'second:4']);
  });
}

test('a throwing deferred listener does not prevent queued listener edits from draining', () => {
  const events = createEditorEvents(() => {
    throw new Error('No snapshot requested');
  });
  const seen: number[] = [];
  events.on('change', ({ revision }) => {
    seen.push(revision);
    if (revision === 1) {
      events.emitDocumentChange({ revision: 3 });
      throw new Error('Host listener failed');
    }
  });
  expect(() =>
    events.defer(() => {
      events.emitDocumentChange({ revision: 1 });
      events.emitDocumentChange({ revision: 2 });
    })
  ).not.toThrow();
  expect(seen).toEqual([1, 2, 3]);
});

test('ordinary commit batches propagate the first listener error after draining', () => {
  const events = createEditorEvents(() => {
    throw new Error('No snapshot requested');
  });
  const seen: number[] = [];
  events.on('change', ({ revision }) => {
    seen.push(revision);
    if (revision === 1) {
      events.emitDocumentChange({ revision: 3 });
      throw new Error('first listener error');
    }
    if (revision === 2) throw new Error('second listener error');
  });
  expect(() =>
    events.defer(() => {
      events.emitDocumentChange({ revision: 1 });
      events.emitDocumentChange({ revision: 2 });
    }, true)
  ).toThrow('first listener error');
  expect(seen).toEqual([1, 2, 3]);
  events.emitDocumentChange({ revision: 4 });
  expect(seen).toEqual([1, 2, 3, 4]);
});

test('an outer preview batch keeps its listener error policy for nested ordinary commits', () => {
  const events = createEditorEvents(() => {
    throw new Error('No snapshot requested');
  });
  events.on('change', () => {
    throw new Error('listener error');
  });
  expect(() =>
    events.defer(() => {
      events.defer(() => events.emitDocumentChange({ revision: 1 }), true);
    })
  ).not.toThrow();
});

test('a callback failure takes precedence over its queued listener failure', () => {
  const events = createEditorEvents(() => {
    throw new Error('No snapshot requested');
  });
  events.on('change', () => {
    throw new Error('listener error');
  });
  expect(() =>
    events.defer(() => {
      events.emitDocumentChange({ revision: 1 });
      throw new Error('callback error');
    }, true)
  ).toThrow('callback error');
});
