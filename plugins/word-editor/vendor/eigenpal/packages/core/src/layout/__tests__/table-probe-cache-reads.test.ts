// Speculative table-row layouts read measured breaks without retaining or counting them.
//
// A keep-with-next paragraph before a table asks for the table's opening, a binary search of
// row probes. Each probe used to measure every cell paragraph again. They now read the breaks
// placement cached, with identical inputs, so a warm pass measures almost nothing while the
// cache's counters, recency and geometry stay exactly what they were.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createBudgetedParagraphLayoutCache,
  createParagraphLayoutCache,
  DEFAULT_PARAGRAPH_CACHE_BUDGET,
} from '../layout-cache.ts';
import { readOnlyBreakCache } from '../paragraph-cache-peek.ts';
import { createFixedMeasurer, layoutSemanticDocument, type PageGeometry } from '../index.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 260,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const p = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (inner: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
const table = (k: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
  '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>' +
  Array.from(
    { length: 5 },
    (_, row) =>
      `<w:tr>${tc(p(`table ${k} row ${row} with words that wrap over lines`))}${tc(p(`${k}.${row}`))}</w:tr>`
  ).join('') +
  '</w:tbl>';

function load(): OoxmlPart {
  let body = '';
  for (let k = 0; k < 8; k++) {
    body += p(`Paragraph ${k} before the heading with a few words.`);
    body += p(`Heading ${k}`, '<w:keepNext/>') + table(k);
  }
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function countingMeasurer(): { measurer: TextMeasurer; calls: () => number } {
  const base = createFixedMeasurer(6, 14);
  let calls = 0;
  const measurer = new Proxy(base, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function'
        ? (...args: unknown[]) => {
            calls += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          }
        : value;
    },
  });
  return { measurer, calls: () => calls };
}

const geometryOf = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  JSON.stringify(layout.pages.map((page) => page.fragments));

test('a warm full pass measures almost nothing, probes included, with unchanged geometry', () => {
  const part = load();
  const cold = countingMeasurer();
  const cache = createParagraphLayoutCache<never>();
  const options = { measurer: cold.measurer, geometry: GEOMETRY, cache: cache as never };
  const first = layoutSemanticDocument(part, 1, options);
  const coldCalls = cold.calls();
  const stats = cache.stats;
  const second = layoutSemanticDocument(part, 2, options);
  const warmCalls = cold.calls() - coldCalls;
  expect(first.pages.length).toBeGreaterThan(2);
  expect(warmCalls).toBeLessThan(coldCalls / 4);
  // Probes peek: the only reads the counters see are placement's own.
  expect(cache.stats.misses).toBe(stats.misses);
  expect(geometryOf(second)).toBe(geometryOf(first));
  expect(geometryOf(second)).toBe(
    geometryOf(layoutSemanticDocument(part, 3, { measurer: cold.measurer, geometry: GEOMETRY }))
  );
});

test('the read-only view answers from the cache and changes nothing in it', () => {
  const cache = createBudgetedParagraphLayoutCache<string>({}, DEFAULT_PARAGRAPH_CACHE_BUDGET);
  cache.set('a', 'A');
  cache.set('b', 'B');
  const before = cache.stats;
  const view = readOnlyBreakCache(cache)!;
  expect(view).toBe(readOnlyBreakCache(cache)!);
  expect(view.get('a')).toBe('A');
  expect(view.get('missing')).toBeUndefined();
  view.set('c', 'C');
  view.retain(new Set());
  view.clear();
  expect(cache.stats).toEqual(before);
  expect(cache.get('c')).toBeUndefined();
  expect(cache.get('a')).toBe('A');
  expect(view.retainAcrossPasses).toBe(false);
  expect(view.keyFor).toBeDefined();
});

test('no cache, or a cache that cannot be read without side effects, gives no view', () => {
  expect(readOnlyBreakCache(undefined)).toBeUndefined();
  const custom = {
    get: () => undefined,
    set: () => {},
    retain: () => {},
    clear: () => {},
    stats: { hits: 0, misses: 0, evictions: 0, size: 0 },
  };
  expect(readOnlyBreakCache(custom)).toBeUndefined();
});
