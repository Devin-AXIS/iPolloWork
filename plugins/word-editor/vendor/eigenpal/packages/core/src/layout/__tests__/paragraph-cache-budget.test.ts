// Byte-budgeted retention for the paragraph break cache.
//
// The scenario these guard: a large document is laid out once with a fallback measurer and
// again when its fonts arrive. Every key of the first pass names a producer that no longer
// exists. A count-bounded LRU kept those dead entries while evicting the start of the live
// document, so the first edit that re-laid out early pages re-measured all of them.

import { describe, expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createBudgetedParagraphLayoutCache,
  createParagraphLayoutCache,
  DEFAULT_PARAGRAPH_CACHE_BUDGET,
  retainLiveBreakKeys,
  type ParagraphLayoutCache,
} from '../layout-cache.ts';
import { estimatedParagraphCacheEntryBytes } from '../paragraph-cache-weight.ts';
import { paragraphCacheDiagnostics } from '../paragraph-cache-diagnostics.ts';
import { reuseParagraphAtWidth } from '../paragraph-cache-width-reuse.ts';
import { breakParagraph, type PendingLine } from '../paragraph-flow.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageGeometry,
} from '../index.ts';

const diagnostics = (cache: object) => paragraphCacheDiagnostics(cache)!;

const span = (text: string) => ({ text, box: { x: 0, y: 0, width: 1, height: 1 } });
const line = (...texts: string[]) => ({ spans: texts.map(span), drawings: [] });
const cell = (text = '12.5') => [line(text)];
const paragraph = (lines: number, words: number) =>
  Array.from({ length: lines }, () =>
    line(...Array.from({ length: words }, (_, index) => `word${index}`))
  );
const bytesOf = (key: string, value: unknown) => estimatedParagraphCacheEntryBytes(key, value);

/** One published pass in the order the layout drives a cache: touch, then maybe sweep. */
function pass<T>(
  cache: ParagraphLayoutCache<T>,
  keys: readonly string[],
  value: (key: string) => T
) {
  for (const key of keys) if (cache.get(key) === undefined) cache.set(key, value(key));
  if (cache.retentionPassDue?.() ?? true) cache.retain(new Set(keys));
}

const keysFor = (producer: string, count: number) =>
  Array.from({ length: count }, (_, index) => `plk:${producer}:${index}`);

describe('estimated entry bytes', () => {
  test('grow with the lines, spans, text and drawings a break holds', () => {
    const key = 'plk:k';
    const one = bytesOf(key, cell());
    expect(bytesOf(key, cell('12.50'))).toBe(one + 2);
    expect(bytesOf(key, [line('12.5', '6')])).toBeGreaterThan(one);
    expect(bytesOf(key, [line('12.5'), line('6')])).toBeGreaterThan(
      bytesOf(key, [line('12.5', '6')])
    );
    expect(bytesOf(key, [{ ...line('12.5'), drawings: [{}] }])).toBeGreaterThan(one);
    expect(bytesOf(key, [{ ...line('12.5'), deletedRanges: [{}, {}] }])).toBeGreaterThan(one);
    // Key characters count as UTF-16 units.
    expect(bytesOf(`${key}x`, cell())).toBe(one + 2);
    expect(bytesOf(`${key}é`, cell())).toBe(one + 2);
  });

  test('separate one-token cells from long paragraphs by an order of magnitude', () => {
    expect(bytesOf('plk:k', paragraph(4, 14))).toBeGreaterThan(10 * bytesOf('plk:k', cell()));
  });

  test('count a value that is not a break as its slot and key', () => {
    expect(bytesOf('plk:k', 7)).toBe(bytesOf('plk:k', 'text'));
    expect(bytesOf('plk:k', [null, 3])).toBeGreaterThan(bytesOf('plk:k', []));
  });

  test('accept arbitrary generic values without throwing', () => {
    const odd: unknown[] = [
      undefined,
      null,
      0,
      'text',
      Symbol('s'),
      () => 1,
      new Map([[1, 2]]),
      Object.create(null),
      [undefined, null, 1, 'x', [], {}],
      [{ spans: null, drawings: 3 }],
      [{ spans: [null, 1, 'x', undefined, [], { text: 5 }, { text: null, caretEdges: 'no' }] }],
      [{ spans: 'abc', drawings: [null], deletedRanges: {}, changeSites: [null] }],
      [Object.freeze({ spans: Object.freeze([Object.create(null)]) })],
    ];
    for (const value of odd) {
      const bytes = bytesOf('plk:k', value);
      expect(Number.isFinite(bytes)).toBe(true);
      expect(bytes).toBeGreaterThanOrEqual(bytesOf('plk:k', undefined));
    }
    const cache = createBudgetedParagraphLayoutCache<unknown>({}, DEFAULT_PARAGRAPH_CACHE_BUDGET);
    odd.forEach((value, index) => cache.set(`k${index}`, value));
    expect(cache.stats.size).toBe(odd.length);
  });
});

describe('byte budgets', () => {
  test('total bytes track sets, overwrites, transfers, releases and clear exactly', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      { retainAcrossPasses: false },
      { softBytes: 1 << 20, hardBytes: 1 << 20 }
    );
    cache.set('a', cell());
    cache.set('b', paragraph(2, 3));
    cache.set('a', paragraph(1, 2));
    expect(diagnostics(cache).estimatedBytes).toBe(
      bytesOf('a', paragraph(1, 2)) + bytesOf('b', paragraph(2, 3))
    );
    cache.release!('a');
    expect(diagnostics(cache).estimatedBytes).toBe(bytesOf('b', paragraph(2, 3)));
    cache.clear();
    expect(diagnostics(cache).estimatedBytes).toBe(0);
    expect(diagnostics(cache).namedBytes).toBe(0);
  });

  test('past generations are evicted above the soft budget, the working set is not', () => {
    const entry = bytesOf('k0', cell());
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      {},
      { softBytes: 2 * entry, hardBytes: 100 * entry }
    );
    for (const key of ['k0', 'k1', 'k2', 'k3']) cache.set(key, cell());
    // One generation: a document larger than the soft budget keeps every break.
    expect(cache.stats.size).toBe(4);
    cache.retain(new Set(['k3']));
    cache.set('k4', cell());
    // k0..k2 are no longer the working set; k3 was named and k4 just written.
    expect(['k0', 'k1', 'k2'].map((key) => cache.get(key))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(cache.get('k3')).toBeDefined();
    expect(cache.get('k4')).toBeDefined();
    expect(diagnostics(cache).softLimitEvictions).toBe(3);
  });

  test('the hard budget evicts even the working set, least recent first', () => {
    const entry = bytesOf('k0', cell());
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      {},
      { softBytes: entry, hardBytes: 3 * entry }
    );
    for (let index = 0; index < 6; index += 1) cache.set(`k${index}`, cell());
    expect(cache.stats.size).toBe(3);
    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k3')).toBeDefined();
    expect(diagnostics(cache).hardLimitEvictions).toBe(3);
    expect(diagnostics(cache).estimatedBytes).toBeLessThanOrEqual(3 * entry);
  });

  test('budgets weigh bytes: many small cells fit where a few long paragraphs do not', () => {
    const long = paragraph(6, 20);
    const budget = { softBytes: 0, hardBytes: 4 * bytesOf('k10', long) };
    const cells = createBudgetedParagraphLayoutCache<unknown>({}, budget);
    const paragraphs = createBudgetedParagraphLayoutCache<unknown>({}, budget);
    for (let index = 0; index < 40; index += 1) {
      cells.set(`k${index}`, cell());
      paragraphs.set(`k${index}`, long);
    }
    expect(cells.stats.size).toBe(40);
    expect(paragraphs.stats.size).toBe(4);
  });

  test('an entry larger than the hard budget is refused and keeps the cache intact', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      {},
      { softBytes: 0, hardBytes: bytesOf('small', cell()) * 2 }
    );
    cache.set('small', cell());
    cache.set('huge', paragraph(40, 40));
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.get('small')).toBeDefined();
    expect(diagnostics(cache).oversizedRefusals).toBe(1);
    expect(diagnostics(cache).estimatedBytes).toBe(bytesOf('small', cell()));
  });

  test('an oversized overwrite drops the older value under that key', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      {},
      { softBytes: 0, hardBytes: bytesOf('k', cell()) * 3 }
    );
    cache.set('k', cell());
    cache.set('other', cell());
    cache.set('k', paragraph(40, 40));
    expect(cache.get('k')).toBeUndefined();
    expect(cache.get('other')).toBeDefined();
    expect(diagnostics(cache).estimatedBytes).toBeLessThanOrEqual(bytesOf('k', cell()) * 3);
  });

  test('a zero budget admits nothing', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>({}, { softBytes: 0, hardBytes: 0 });
    cache.set('k', cell());
    expect(cache.stats.size).toBe(0);
    expect(cache.get('k')).toBeUndefined();
    expect(diagnostics(cache).estimatedBytes).toBe(0);
  });

  test('estimated bytes never exceed the hard budget under random traffic', () => {
    const shapes = [cell(), cell('1234567890'), paragraph(2, 5), paragraph(8, 30), 'value'];
    for (const hardBytes of [0, 400, 1_000, 5_000, 20_000, 200_000]) {
      for (const softBytes of [0, hardBytes / 2, hardBytes]) {
        const cache = createBudgetedParagraphLayoutCache<unknown>({}, { softBytes, hardBytes });
        let random = 11;
        for (let step = 0; step < 1500; step += 1) {
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          const key = `k${random % 37}`;
          const operation = (random >>> 8) % 7;
          if (operation === 0) cache.retain(new Set([key]));
          else if (operation === 1) cache.retentionPassDue!();
          else if (operation === 2) cache.get(key);
          else cache.set(key, shapes[(random >>> 12) % shapes.length]);
          const now = diagnostics(cache);
          expect(now.estimatedBytes).toBeLessThanOrEqual(hardBytes);
          expect(now.estimatedBytes).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('an explicit entry limit still applies alongside the default byte budget', () => {
    const cache = createParagraphLayoutCache<unknown>({ maxEntries: 2 });
    for (let index = 0; index < 20; index += 1) cache.set(`k${index}`, cell());
    expect(cache.stats.size).toBe(16);
    expect(diagnostics(cache).hardLimit).toBe(16);
    expect(diagnostics(createParagraphLayoutCache()).hardLimit).toBe(Number.POSITIVE_INFINITY);
    expect(diagnostics(createParagraphLayoutCache()).hardLimitBytes).toBe(
      DEFAULT_PARAGRAPH_CACHE_BUDGET.hardBytes
    );
  });
});

describe('re-keyed documents', () => {
  const entry = bytesOf(keysFor('shaped', 1)[0]!, cell());
  const budget = { softBytes: 20 * entry, hardBytes: 2000 * entry };

  test('a measurer change leaves the whole new working set and drops the old one', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>({}, budget);
    const fallback = keysFor('fallback', 600);
    const shaped = keysFor('shaped', 600);
    pass(cache, fallback, () => cell());
    pass(cache, shaped, () => cell());
    const after = diagnostics(cache);
    expect(after.supersededEvictions).toBe(600);
    expect(after.size).toBe(600);
    expect(after.estimatedBytes).toBe(after.namedBytes);
    // An edit early in the document re-lays out its first pages: every break is a hit.
    const misses = cache.stats.misses;
    for (const key of shaped.slice(0, 300)) expect(cache.get(key)).toBeDefined();
    expect(cache.stats.misses).toBe(misses);
  });

  test('the old policy shape: a tighter hard budget still keeps the newest pass first', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      {},
      { softBytes: 20 * entry, hardBytes: 700 * entry }
    );
    pass(cache, keysFor('fallback', 600), () => cell());
    pass(cache, keysFor('shaped', 600), () => cell());
    // The dead pass is least recent, so the hard budget spends it before any live break.
    expect(keysFor('shaped', 600).every((key) => cache.get(key) !== undefined)).toBe(true);
  });

  test('ordinary typing passes do not trigger early sweeps', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>({}, budget);
    const keys = keysFor('shaped', 600);
    pass(cache, keys, () => cell());
    let sweeps = 0;
    for (let step = 1; step <= 16; step += 1) {
      cache.set(`typing:${step}`, cell());
      if (cache.retentionPassDue!()) {
        sweeps += 1;
        cache.retain(new Set([...keys.slice(1), `typing:${step}`]));
      }
    }
    // Only the stride: one sweep per eight passes.
    expect(sweeps).toBe(2);
  });

  test('a small document keeps superseded entries within its soft budget', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      {},
      { softBytes: 1000 * entry, hardBytes: 2000 * entry }
    );
    pass(cache, keysFor('fallback', 20), () => cell());
    for (let index = 0; index < 8; index += 1) pass(cache, keysFor('zoomed', 20), () => cell());
    // Zooming back still finds the earlier breaks until the TTL expires them.
    expect(keysFor('fallback', 20).every((key) => cache.get(key) !== undefined)).toBe(true);
  });

  test('lanes retain cannot name survive while a pass still touches them', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>({}, budget);
    const furniture = keysFor('header', 30);
    for (const producer of ['fallback', 'shaped']) {
      for (const key of furniture) if (cache.get(key) === undefined) cache.set(key, cell());
      pass(cache, keysFor(producer, 600), () => cell());
    }
    expect(furniture.every((key) => cache.get(key) !== undefined)).toBe(true);
  });

  test('one-shot caches never sweep early', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      { retainAcrossPasses: false },
      budget
    );
    for (const key of keysFor('export', 600)) cache.set(key, cell());
    expect(cache.retentionPassDue!()).toBe(false);
  });

  test('stale entries still age out after the TTL, whatever the budget', () => {
    const cache = createBudgetedParagraphLayoutCache<unknown>(
      {},
      { softBytes: 1 << 30, hardBytes: 1 << 30 }
    );
    cache.set('gone', cell());
    for (let index = 0; index < 9; index += 1) cache.retain(new Set());
    expect(cache.get('gone')).toBeUndefined();
    expect(diagnostics(cache).staleEvictions).toBe(1);
  });
});

describe('the cache inside layout', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const geometry: PageGeometry = {
    width: 300,
    height: 200,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };
  const load = (first: string): OoxmlPart => {
    const rows = Array.from(
      { length: 40 },
      (_, row) =>
        `<w:tr>${[0, 1, 2].map((column) => `<w:tc><w:p><w:r><w:t>${row}.${column}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`
    ).join('');
    const body =
      `<w:p><w:r><w:t>${first}</w:t></w:r></w:p>` +
      Array.from(
        { length: 30 },
        (_, index) => `<w:p><w:r><w:t>paragraph ${index} ${'word '.repeat(20)}</w:t></w:r></w:p>`
      ).join('') +
      `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>${rows}</w:tbl><w:p/>`;
    const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    return read.part;
  };
  const firstParagraphId = (part: OoxmlPart): string => {
    const body = part.root.children[0];
    const first = body && 'children' in body ? body.children[0] : undefined;
    if (!first) throw new Error('missing paragraph');
    return first.id;
  };
  const geometryOf = (layout: ReturnType<typeof layoutSemanticDocument>) =>
    JSON.stringify(layout.pages.map((page) => page.fragments));

  test('after fonts arrive, an early edit re-measures only the edited paragraph', () => {
    const cache = createBudgetedParagraphLayoutCache<never>(
      {},
      { softBytes: 1024, hardBytes: 1 << 26 }
    );
    const part = load('first');
    const options = (producer: string) => ({
      measurer: createFixedMeasurer(6, 14),
      geometry,
      producer,
      cache: cache as never,
    });
    layoutSemanticDocument(part, 1, options('fallback'));
    const shaped = layoutSemanticDocument(part, 2, options('shaped'));
    const settled = diagnostics(cache);
    expect(settled.supersededEvictions).toBeGreaterThan(0);
    expect(settled.estimatedBytes).toBe(settled.namedBytes);
    const misses = cache.stats.misses;
    const edited = layoutSemanticDocument(load('first edited'), 3, options('shaped'));
    expect(cache.stats.misses - misses).toBe(1);
    expect(geometryOf(shaped)).not.toBe(geometryOf(edited));
    expect(geometryOf(edited)).toBe(
      geometryOf(
        layoutSemanticDocument(load('first edited'), 3, {
          measurer: createFixedMeasurer(6, 14),
          geometry,
          producer: 'shaped',
        })
      )
    );
  });

  test('pages reused without re-measurement stay named, so none of them is superseded', () => {
    const cache = createBudgetedParagraphLayoutCache<never>(
      {},
      { softBytes: 0, hardBytes: 1 << 26 }
    );
    const session = createLayoutSession();
    const options = {
      measurer: createFixedMeasurer(6, 14),
      geometry,
      producer: 'p',
      cache: cache as never,
      session,
    };
    let part = load('first');
    layoutSemanticDocument(part, 1, options);
    // Each edit re-lays out the opening page only; the table pages are reused untouched, so
    // only retain's live names keep their breaks across two stride sweeps.
    for (let revision = 2; revision <= 17; revision += 1) {
      const edited = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: firstParagraphId(part),
        offset: 0,
        text: 'x',
      });
      if (!edited.ok) throw new Error(edited.reason);
      part = edited.part;
      layoutSemanticDocument(part, revision, options);
    }
    // The edited paragraph's earlier states are the superseded entries.
    expect(diagnostics(cache).supersededEvictions).toBeGreaterThan(0);
    const misses = cache.stats.misses;
    layoutSemanticDocument(part, 18, { ...options, session: createLayoutSession() });
    expect(cache.stats.misses).toBe(misses);
  });
});

test('a width transfer moves its bytes with the entry', () => {
  const read = readOoxmlPart(
    `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>Token</w:t></w:r></w:p>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  const paragraph = read.part.root;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const inputs = { paragraph, properties: [], width: 100, producer: 'test' };
  const key = cache.keyFor!(inputs);
  breakParagraph(paragraph, paragraph.id, 0, 100, createFixedMeasurer(6, 14), cache, key);
  const next = cache.keyFor!({ ...inputs, width: 120 });
  const moved = reuseParagraphAtWidth(cache, paragraph, next, 120)!;
  expect(cache.stats.size).toBe(1);
  expect(diagnostics(cache).estimatedBytes).toBe(bytesOf(next, moved));
});

test('width transfers move bytes without asking for an early sweep', () => {
  const cache = createBudgetedParagraphLayoutCache<readonly PendingLine[]>(
    {},
    { softBytes: 0, hardBytes: 1 << 26 }
  );
  const measurer = createFixedMeasurer(6, 14);
  const tokens = Array.from({ length: 40 }, (_, index) => {
    const read = readOoxmlPart(
      `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>T${index}</w:t></w:r></w:p>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw Error(read.reason);
    return read.part.root;
  });
  const keyAt = (paragraph: (typeof tokens)[number], width: number) =>
    cache.keyFor!({ paragraph, properties: [], width, producer: 'test' });
  const keys = tokens.map((paragraph) => keyAt(paragraph, 100));
  tokens.forEach((paragraph, index) =>
    breakParagraph(paragraph, paragraph.id, 0, 100, measurer, cache, keys[index]!)
  );
  expect(cache.retentionPassDue!()).toBe(true);
  cache.retain(new Set(keys));
  // A column widens: every cell keeps its measured line under its new key.
  for (const paragraph of tokens) {
    expect(reuseParagraphAtWidth(cache, paragraph, keyAt(paragraph, 120), 120)).toBeDefined();
  }
  expect(cache.stats.size).toBe(tokens.length);
  expect(cache.retentionPassDue!()).toBe(false);
  // Re-measuring them instead would be a re-keyed document.
  for (const paragraph of tokens) {
    breakParagraph(paragraph, paragraph.id, 0, 90, measurer, cache, keyAt(paragraph, 90));
  }
  expect(cache.retentionPassDue!()).toBe(true);
});

test('retainLiveBreakKeys names bytes once even when keys repeat across tables', () => {
  const cache = createBudgetedParagraphLayoutCache<unknown>({}, DEFAULT_PARAGRAPH_CACHE_BUDGET);
  cache.set('a', cell());
  cache.set('b', cell());
  retainLiveBreakKeys(cache, undefined, ['a', 'a', 'b'], []);
  expect(diagnostics(cache).namedBytes).toBe(bytesOf('a', cell()) + bytesOf('b', cell()));
});
