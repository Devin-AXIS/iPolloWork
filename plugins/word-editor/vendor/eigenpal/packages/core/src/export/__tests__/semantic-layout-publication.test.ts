import { expect, test } from 'bun:test';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { publishImmutableSemanticLayout } from '../semantic-layout-publication.ts';

test('publication recursively freezes shallow-frozen page records in bounded chunks', () => {
  const spans: unknown[] = [{ text: 'published' }];
  const page = Object.freeze({
    index: 0,
    fragments: [{ kind: 'paragraph', lines: [{ spans }] }],
  });
  const layout = {
    revision: 1,
    pages: [page],
  } as unknown as SemanticLayout;

  const published = publishImmutableSemanticLayout(layout);

  expect(published).toBe(layout);
  expect(Object.isFrozen(published)).toBe(true);
  expect(Object.isFrozen(published.pages)).toBe(true);
  expect(Object.isFrozen(page.fragments)).toBe(true);
  expect(Object.isFrozen(spans)).toBe(true);
  expect(Object.isFrozen(spans[0])).toBe(true);
});

test('publication rejects a cycle instead of recursing or silently exposing it', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const layout = { revision: 1, pages: [], cycle } as unknown as SemanticLayout;

  expect(() => publishImmutableSemanticLayout(layout)).toThrow('cyclic record graph');
});

test('publication rejects executable values instead of silently exposing them', () => {
  const layout = {
    revision: 1,
    pages: [],
    accidentalCapability: () => 'mutable engine state',
  } as unknown as SemanticLayout;

  expect(() => publishImmutableSemanticLayout(layout)).toThrow('function value');
});

test('publication batches many pages with shared furniture', () => {
  let sharedRecordVisits = 0;
  const nested = new Proxy(
    { value: 'shared' },
    {
      getPrototypeOf(target) {
        sharedRecordVisits += 1;
        return Reflect.getPrototypeOf(target);
      },
    }
  );
  const sharedHeader = { kind: 'default', fragments: [{ nested }] };
  const pages = Array.from({ length: 40 }, (_, index) => ({
    id: `page-${index}`,
    index,
    fragments: [],
    header: sharedHeader,
  }));
  const layout = { revision: 1, pages } as unknown as SemanticLayout;

  const published = publishImmutableSemanticLayout(layout);

  expect(Object.isFrozen(published.pages[39])).toBe(true);
  expect(Object.isFrozen(sharedHeader.fragments[0]?.nested)).toBe(true);
  expect(sharedRecordVisits).toBe(1);
});
