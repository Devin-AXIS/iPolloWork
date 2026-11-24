// Reusing measured and broken paragraphs across revisions (task 9.2).
//
// The differential test is the one that matters: a cached layout must be INDISTINGUISHABLE
// from a full one. A cache that is merely fast is worthless if the geometry it serves has
// drifted from what the document says — the caret lands where no glyph is, and it looks
// correct until someone types.

import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  paragraphLayoutKey,
  type ParagraphLayoutCache,
  type PageGeometry,
} from '../index.ts';
import { sha256FontBytes } from '../../store/package/sha256.ts';
import {
  layoutNodeTokenVisitTestRecorder,
  PARAGRAPH_KEY_INPUT_ROLES,
  warmLayoutNodeDigests,
} from '../layout-cache.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 200,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const MANY = Array.from({ length: 12 }, (_, index) =>
  paragraph(`paragraph ${index} ${'word '.repeat(12)}`)
).join('');

type Cache = ReturnType<typeof createParagraphLayoutCache<never>>;

const lay = (part: OoxmlPart, revision: number, cache?: Cache) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    geometry: GEOMETRY,
    ...(cache ? { cache: cache as never } : {}),
  });

/** Geometry only, so two layouts can be compared without comparing revision stamps. */
const geometryOf = (part: OoxmlPart, revision: number, cache?: Cache) =>
  JSON.stringify(
    lay(part, revision, cache).pages.map((page) => ({
      box: page.box,
      fragments: page.fragments.map((fragment) => ({
        id: fragment.id,
        box: fragment.box,
        lines: fragment.lines.map((line) => ({ box: line.box, spans: line.spans })),
      })),
    }))
  );

describe('a cached layout is identical to a full one (task 9.2)', () => {
  test('the same document laid out twice is byte-identical through the cache', () => {
    const part = load(MANY);
    const cache = createParagraphLayoutCache<never>();
    const cold = geometryOf(part, 1, cache);
    const warm = geometryOf(part, 2, cache);
    expect(warm).toBe(cold);
    expect(cache.stats.hits).toBeGreaterThan(0);
  });

  test('a cached run matches an UNCACHED one, so reuse cannot hide a difference', () => {
    const part = load(MANY);
    const cache = createParagraphLayoutCache<never>();
    geometryOf(part, 1, cache);
    expect(geometryOf(part, 2, cache)).toBe(geometryOf(part, 2));
  });

  test('an edited paragraph is re-measured while the others are reused', () => {
    const cache = createParagraphLayoutCache<never>();
    geometryOf(load(MANY), 1, cache);
    const before = cache.stats.misses;

    // One paragraph's text changes; every other key is unchanged.
    const edited = MANY.replace('paragraph 5', 'paragraph five, now longer than it was');
    geometryOf(load(edited), 2, cache);
    // Exactly one paragraph missed — the edited one.
    expect(cache.stats.misses - before).toBe(1);
  });

  test('editing high in the document still repaginates everything below it', () => {
    // Only the BREAK is cached; placement is always redone. Otherwise a paragraph that
    // shifted onto the next page would keep the geometry it had on the previous one.
    const cache = createParagraphLayoutCache<never>();
    const original = load(MANY);
    geometryOf(original, 1, cache);
    const grown = load(
      MANY.replace(
        paragraph('paragraph 0 ' + 'word '.repeat(12)),
        paragraph(`paragraph 0 ${'word '.repeat(120)}`)
      )
    );
    const warm = geometryOf(grown, 2, cache);
    expect(warm).toBe(geometryOf(grown, 2));
    expect(warm).not.toBe(geometryOf(original, 3));
  });
});

describe('the cache key covers every input that can change a break (task 9.2)', () => {
  const part = load(paragraph('hello world'));
  const paragraphNode = (() => {
    const body = part.root.children.find((child) => child.kind === 'body')!;
    return body.children.find((child) => child.kind === 'paragraph')!;
  })();
  const base = { paragraph: paragraphNode, properties: [], width: 100, producer: 'p1' };

  test('a narrower column is a different key, because the text breaks differently', () => {
    expect(paragraphLayoutKey({ ...base, width: 50 })).not.toBe(paragraphLayoutKey(base));
  });

  test('a different producer is a different key, so fonts arriving later invalidate', () => {
    // A font loading after first paint changes every advance while no content changes.
    expect(paragraphLayoutKey({ ...base, producer: 'p2' })).not.toBe(paragraphLayoutKey(base));
  });

  test('paragraph properties are part of the key, since they decide the indents', () => {
    expect(
      paragraphLayoutKey({
        ...base,
        properties: [{ localName: 'ind', attributes: { left: '720' } }],
      })
    ).not.toBe(paragraphLayoutKey(base));
  });

  test('the same inputs give the same key, whatever order attributes arrive in', () => {
    const a = paragraphLayoutKey({
      ...base,
      properties: [{ localName: 'ind', attributes: { left: '720', right: '360' } }],
    });
    const b = paragraphLayoutKey({
      ...base,
      properties: [{ localName: 'ind', attributes: { right: '360', left: '720' } }],
    });
    expect(a).toBe(b);
  });

  test('a run property change is a different key even with identical text', () => {
    const bold = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>hello world</w:t></w:r></w:p>');
    const body = bold.root.children.find((child) => child.kind === 'body')!;
    const boldParagraph = body.children.find((child) => child.kind === 'paragraph')!;
    expect(paragraphLayoutKey({ ...base, paragraph: boldParagraph })).not.toBe(
      paragraphLayoutKey(base)
    );
  });

  test('the revision is NOT part of the key, or nothing would ever be reused', () => {
    const cache = createParagraphLayoutCache<never>();
    const document = load(MANY);
    geometryOf(document, 1, cache);
    const misses = cache.stats.misses;
    geometryOf(document, 99, cache);
    expect(cache.stats.misses).toBe(misses);
  });
});

describe('the cache is bounded and self-pruning (task 9.2)', () => {
  test('one-shot caches release placed values while reusable caches retain them', () => {
    const oneShot = createParagraphLayoutCache<string>({ retainAcrossPasses: false });
    const reusable = createParagraphLayoutCache<string>();
    oneShot.set('paragraph', 'break');
    reusable.set('paragraph', 'break');

    expect(oneShot.retainAcrossPasses).toBe(false);
    expect(reusable.retainAcrossPasses).toBe(true);
    oneShot.release('paragraph');
    reusable.release('paragraph');
    expect(oneShot.get('paragraph')).toBeUndefined();
    expect(reusable.get('paragraph')).toBe('break');
  });

  test('clearing a one-shot cache releases its subtree key memo scope', () => {
    const cache = createParagraphLayoutCache<never>({ retainAcrossPasses: false });
    const part = load('<w:p><w:r><w:t>construction-only identity</w:t></w:r></w:p>');
    const body = part.root.children.find((node) => node.kind === 'body')!;
    const paragraphNode = body.children.find((node) => node.kind === 'paragraph')!;
    const inputs = {
      paragraph: paragraphNode,
      properties: [],
      width: 100,
      producer: 'one-shot',
    } as const;
    const recorder = layoutNodeTokenVisitTestRecorder();
    try {
      const first = cache.keyFor!(inputs);
      expect(recorder.nodeVisits).toBeGreaterThan(0);
      recorder.reset();
      expect(cache.keyFor!(inputs)).toBe(first);
      expect(recorder.nodeVisits).toBe(0);

      cache.clear();
      recorder.reset();
      expect(cache.keyFor!(inputs)).toBe(first);
      expect(recorder.nodeVisits).toBeGreaterThan(0);
    } finally {
      recorder.dispose();
    }
  });

  test('a live cache keys a warmed node without reading its content again', () => {
    // A large open digests the body in short tasks before its first layout pass. The live
    // cache created at mount must read those digests, and its key must equal a cold one.
    const text = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>warmed identity</w:t></w:r></w:p>';
    const cold = load(text);
    const warm = load(text);
    const paragraphOf = (part: OoxmlPart) =>
      part.root.children
        .find((node) => node.kind === 'body')!
        .children.find((node) => node.kind === 'paragraph')!;
    const inputs = (paragraph: OoxmlNode) =>
      ({ paragraph, properties: [], width: 100, producer: 'warm' }) as const;
    const coldKey = createParagraphLayoutCache<never>().keyFor!(inputs(paragraphOf(cold)));
    warmLayoutNodeDigests([paragraphOf(warm)]);
    const recorder = layoutNodeTokenVisitTestRecorder();
    try {
      const warmKey = createParagraphLayoutCache<never>().keyFor!(inputs(paragraphOf(warm)));
      expect(recorder.nodeVisits).toBe(0);
      expect(warmKey).toEqual(coldKey);
    } finally {
      recorder.dispose();
    }
  });

  test('legacy structural caches without the optional release hook still lay out', () => {
    const inner = createParagraphLayoutCache<never>();
    const legacy: ParagraphLayoutCache<never> = {
      get: (key) => inner.get(key),
      set: (key, value) => inner.set(key, value),
      retain: (keys) => inner.retain(keys),
      clear: () => inner.clear(),
      get stats() {
        return inner.stats;
      },
    };
    expect(() => geometryOf(load(MANY), 1, legacy as Cache)).not.toThrow();
  });

  test('custom key hooks keep their cache receiver', () => {
    const inner = createParagraphLayoutCache<never>();
    let calls = 0;
    const seenNodeIds = new Set<string>();
    const custom: ParagraphLayoutCache<never> = {
      get: (key) => inner.get(key),
      set: (key, value) => inner.set(key, value),
      retain: (keys) => inner.retain(keys),
      clear: () => inner.clear(),
      keyFor(inputs) {
        expect(this).toBe(custom);
        calls += 1;
        seenNodeIds.add(inputs.paragraph.id);
        return inner.keyFor!(inputs);
      },
      get stats() {
        return inner.stats;
      },
    };
    const table = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const part = load(`${MANY}${table}`);
    let bodyParagraphId: string | undefined;
    let cellParagraphId: string | undefined;
    const visit = (node: OoxmlNode, insideCell: boolean): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') {
        if (insideCell) cellParagraphId ??= node.id;
        else bodyParagraphId ??= node.id;
      }
      for (const child of node.children) visit(child, insideCell || node.kind === 'tableCell');
    };
    visit(part.root, false);

    expect(() => lay(part, 1, custom as Cache)).not.toThrow();
    expect(calls).toBeGreaterThan(0);
    expect(bodyParagraphId).toBeDefined();
    expect(cellParagraphId).toBeDefined();
    expect(seenNodeIds.has(bodyParagraphId!)).toBe(true);
    expect(seenNodeIds.has(cellParagraphId!)).toBe(true);
  });

  test('it evicts least-recently-used entries from PAST generations over its limit', () => {
    const cache = createParagraphLayoutCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    // A retain starts the next generation; 'a' and 'b' now belong to the previous one.
    cache.retain(new Set<string>());
    cache.set('c', '3');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  test('the limit never evicts the current working set — a large document outgrows it', () => {
    // Every entry belongs to the current generation while a pass is still running, so a
    // document larger than the cap keeps all of its breaks: evicting them made every full
    // pass on a large document re-measure the whole document.
    const cache = createParagraphLayoutCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  test('a deleted paragraph ages out of the cache within the retention window', () => {
    const cache = createParagraphLayoutCache<never>();
    geometryOf(load(MANY), 1, cache);
    const full = cache.stats.size;
    // The drop is deliberately NOT immediate: keys a pass cannot enumerate up front
    // (notes, textbox stories) live on the same grace period, and the retention sweep
    // itself runs on a stride of passes. It is bounded, though — over enough passes the
    // deleted paragraphs are gone.
    for (let pass = 0; pass < 120; pass += 1) {
      geometryOf(load(paragraph('only one left')), 2 + pass, cache);
    }
    expect(cache.stats.size).toBeLessThan(full);
    expect(cache.stats.size).toBe(1);
  });

  test('it never grows unbounded however many stale states are touched', () => {
    const cache = createParagraphLayoutCache<never>({ maxEntries: 4 });
    for (let step = 0; step < 40; step += 1) {
      geometryOf(load(paragraph(`typing ${'x'.repeat(step)}`)), step + 1, cache);
    }
    // One live key per pass plus the bounded aging window; far below the 40 states touched.
    expect(cache.stats.size).toBeLessThanOrEqual(10);
  });
});

describe('the key covers what actually changes a break (review regressions)', () => {
  const keyOfBody = (body: string): string => {
    const part = load(body);
    const container = part.root.children.find((child) => child.kind === 'body')!;
    const paragraph = container.children.find((child) => child.kind === 'paragraph')!;
    return paragraphLayoutKey({ paragraph, properties: [], width: 100, producer: 'p' });
  };

  test('a RUN property VALUE change is a different key', () => {
    // `attributes` is an array of records, not a record. Serializing it with Object.entries
    // dropped every value and kept only the count, so 11pt and 22pt keyed identically and
    // the 22pt paragraph was served the 11pt breaks.
    const small = keyOfBody('<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>hi</w:t></w:r></w:p>');
    const large = keyOfBody('<w:p><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>hi</w:t></w:r></w:p>');
    expect(small).not.toBe(large);
  });

  test('a font family change is a different key', () => {
    const a = keyOfBody(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t>hi</w:t></w:r></w:p>'
    );
    const b = keyOfBody(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr><w:t>hi</w:t></w:r></w:p>'
    );
    expect(a).not.toBe(b);
  });

  test('an explicit-off toggle is a different key from an explicit-on one', () => {
    const on = keyOfBody('<w:p><w:r><w:rPr><w:caps w:val="1"/></w:rPr><w:t>hi</w:t></w:r></w:p>');
    const off = keyOfBody('<w:p><w:r><w:rPr><w:caps w:val="0"/></w:rPr><w:t>hi</w:t></w:r></w:p>');
    expect(on).not.toBe(off);
  });

  test('the same paragraph at a different NODE ID is a different key', () => {
    // Node ids are structural paths, so inserting a table above a paragraph renumbers it
    // while nothing about its content changes. Reusing the records would publish fragment
    // and span ranges naming a paragraph that no longer exists at that id.
    const alone = keyOfBody('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');
    const shifted = keyOfBody('<w:tbl><w:tr/></w:tbl><w:p><w:r><w:t>hello world</w:t></w:r></w:p>');
    expect(alone).not.toBe(shifted);
  });
});

describe('cached breaks are re-tagged for the paragraph that uses them (review regression)', () => {
  test('two identical paragraphs each get spans naming THEMSELVES', () => {
    // A cached break is keyed by content, so identical paragraphs share one entry — and the
    // spans in it carry whichever paragraph produced them unless placement re-tags.
    const cache = createParagraphLayoutCache<never>();
    const body = `${paragraph('same text here')}${paragraph('same text here')}`;
    const layout = lay(load(body), 1, cache);
    const fragments = layout.pages.flatMap((page) => page.fragments);
    expect(fragments.length).toBe(2);
    for (const fragment of fragments) {
      for (const line of fragment.lines) {
        for (const span of line.spans) {
          expect(span.range.paragraphId).toBe(fragment.paragraphId);
        }
      }
    }
  });
});

describe('key memoization over immutable nodes', () => {
  const firstParagraphOf = (part: OoxmlPart) => {
    const body = part.root.children.find((child) => child.kind === 'body')!;
    return (body as { children: readonly { kind: string }[] }).children.find(
      (child) => child.kind === 'paragraph'
    )! as never;
  };

  test('unchanged inputs return the SAME key string object, not just an equal one', () => {
    // The key embeds the whole content token, so it is long — and a freshly joined string
    // has no cached hash. Handing back the same object keeps every cache get on the
    // engine's cached string hash, which is what makes the cache cheap to consult per pass.
    const part = load(paragraph('memoized paragraph content'));
    const node = firstParagraphOf(part);
    const inputs = { paragraph: node, properties: [], width: 100, producer: 'p' } as const;
    expect(paragraphLayoutKey(inputs)).toBe(paragraphLayoutKey(inputs));
  });

  test('a changed width recomputes, and the bounded memo reuses an earlier width', () => {
    const part = load(paragraph('memoized paragraph content'));
    const node = firstParagraphOf(part);
    const at100 = paragraphLayoutKey({
      paragraph: node,
      properties: [],
      width: 100,
      producer: 'p',
    });
    const at200 = paragraphLayoutKey({
      paragraph: node,
      properties: [],
      width: 200,
      producer: 'p',
    });
    expect(at200).not.toBe(at100);
    // Prepass and placement commonly alternate widths; both stay warm without serializing the
    // immutable OOXML subtree into either key.
    const at100again = paragraphLayoutKey({
      paragraph: node,
      properties: [],
      width: 100,
      producer: 'p',
    });
    expect(at100again).toEqual(at100);
  });

  test('a changed producer or drawing token recomputes the key', () => {
    const part = load(paragraph('memoized paragraph content'));
    const node = firstParagraphOf(part);
    const base = paragraphLayoutKey({ paragraph: node, properties: [], width: 100, producer: 'p' });
    const otherProducer = paragraphLayoutKey({
      paragraph: node,
      properties: [],
      width: 100,
      producer: 'q',
    });
    expect(otherProducer).not.toEqual(base);
    const withDrawing = paragraphLayoutKey({
      paragraph: node,
      properties: [],
      width: 100,
      producer: 'p',
      drawingToken: 'd1',
    });
    expect(withDrawing).not.toEqual(base);
  });

  test('every declared memo input misses the memo when it alone changes', () => {
    // Table-driven over PARAGRAPH_KEY_INPUT_ROLES, the same map whose `satisfies` clause
    // forces a new ParagraphKeyInputs field to be classified. The memo hit test is the
    // trap this covers: an input folded into the joined key but missing from the memo
    // comparison is silently inert, because the memo answers before the join runs.
    const part = load(paragraph('memoized paragraph content'));
    const node = firstParagraphOf(part);
    const base: Parameters<typeof paragraphLayoutKey>[0] = {
      paragraph: node,
      properties: [],
      width: 100,
      producer: 'p',
      drawingToken: 'd0',
      projectionToken: 'p0',
      exclusionToken: 'x0',
    };
    const changed: Record<
      Exclude<keyof typeof PARAGRAPH_KEY_INPUT_ROLES, 'paragraph'>,
      Partial<typeof base>
    > = {
      properties: { properties: [{ localName: 'jc', attributes: { 'w:val': 'center' } }] },
      width: { width: 200 },
      producer: { producer: 'q' },
      drawingToken: { drawingToken: 'd1' },
      projectionToken: { projectionToken: 'p1' },
      exclusionToken: { exclusionToken: 'x1' },
    };
    for (const [field, override] of Object.entries(changed)) {
      const warm = paragraphLayoutKey(base);
      const moved = paragraphLayoutKey({ ...base, ...override });
      expect(`${field}:${String(moved !== warm)}`).toBe(`${field}:true`);
    }
  });

  test('a replaced content-equal paragraph reuses its exact interned identity', () => {
    // A canonical digest preserves incremental reuse even when a store rebuilds immutable nodes.
    const a = paragraphLayoutKey({
      paragraph: firstParagraphOf(load(paragraph('same content'))),
      properties: [],
      width: 100,
      producer: 'p',
    });
    const b = paragraphLayoutKey({
      paragraph: firstParagraphOf(load(paragraph('same content'))),
      properties: [],
      width: 100,
      producer: 'p',
    });
    expect(a).toEqual(b);
  });

  test('a cell edit rehashes only its copy-on-write path, not the whole table', () => {
    const rows = Array.from(
      { length: 200 },
      (_, index) =>
        `<w:tr><w:tc>${paragraph(`left ${index} ${'word '.repeat(8)}`)}</w:tc>` +
        `<w:tc>${paragraph(`right ${index} ${'word '.repeat(8)}`)}</w:tc></w:tr>`
    ).join('');
    const part = load(`<w:tbl><w:tblPr/>${rows}</w:tbl>`);
    const findFirst = (node: OoxmlNode, kind: string): OoxmlNode | null => {
      if (node.kind === kind) return node;
      if (node.kind === 'textValue') return null;
      for (const child of node.children) {
        const found = findFirst(child, kind);
        if (found) return found;
      }
      return null;
    };
    const paragraphs: OoxmlNode[] = [];
    const collectParagraphs = (node: OoxmlNode): void => {
      if (node.kind === 'paragraph') {
        paragraphs.push(node);
        return;
      }
      if (node.kind !== 'textValue') for (const child of node.children) collectParagraphs(child);
    };
    const table = findFirst(part.root, 'table');
    expect(table).not.toBeNull();
    collectParagraphs(table!);
    expect(paragraphs).toHaveLength(400);

    const recorder = layoutNodeTokenVisitTestRecorder();
    try {
      recorder.reset();
      const before = paragraphLayoutKey({
        paragraph: table!,
        properties: [],
        width: 500,
        producer: 'table-digest',
      });
      const coldVisits = recorder.nodeVisits;
      const reparsedTable = findFirst(load(`<w:tbl><w:tblPr/>${rows}</w:tbl>`).root, 'table');
      expect(reparsedTable).not.toBeNull();
      expect(
        paragraphLayoutKey({
          paragraph: reparsedTable!,
          properties: [],
          width: 500,
          producer: 'table-digest',
        })
      ).toBe(before);

      const target = paragraphs[201]!;
      const edited = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: target.id,
        offset: 0,
        text: 'changed ',
      });
      expect(edited.ok).toBe(true);
      if (!edited.ok) throw new Error(edited.reason);
      const editedTable = findFirst(edited.part.root, 'table');
      expect(editedTable).not.toBeNull();
      recorder.reset();
      const after = paragraphLayoutKey({
        paragraph: editedTable!,
        properties: [],
        width: 500,
        producer: 'table-digest',
      });
      const editedVisits = recorder.nodeVisits;

      expect(after).not.toBe(before);
      expect(coldVisits).toBeGreaterThan(2_000);
      // Deterministic structural bound, not timing: table → row → cell → paragraph → run/text.
      expect(editedVisits).toBeLessThanOrEqual(16);
    } finally {
      recorder.dispose();
    }
  });

  test('file-controlled attribute delimiters cannot forge the recursive node token', () => {
    // The old printable serialization made these attribute lists identical:
    // `a=x|:b=y`. Hashing an ambiguous serialization cannot repair that collision.
    const keyOf = (attributes: string) =>
      paragraphLayoutKey({
        paragraph: firstParagraphOf(load(`<w:p><w:r ${attributes}><w:t>same</w:t></w:r></w:p>`)),
        properties: [],
        width: 100,
        producer: 'p',
      });
    expect(keyOf('a="x|:b=y"')).not.toBe(keyOf('a="x" b="y"'));
  });

  test('attacker-sized attribute cardinality cannot overflow an argument list', () => {
    const attributes = Array.from({ length: 100_000 }, (_, index) => `a${index}="x"`).join(' ');
    const node = firstParagraphOf(load(`<w:p ${attributes}><w:r><w:t>x</w:t></w:r></w:p>`));
    expect(() =>
      paragraphLayoutKey({ paragraph: node, properties: [], width: 100, producer: 'p' })
    ).not.toThrow();
  });
});

test('property key framing preserves the exact digest across attribute orders and values', () => {
  const part = load(paragraph('Cache control'));
  const values = ['', 'a=b', 'x,y;z', 'line\nvalue', 'λ漢字', 'nul\0value', '__proto__'];
  const encoder = new TextEncoder();
  for (let count = 0; count < 40; count += 1) {
    const properties: OoxmlProperty[] = Array.from({ length: count }, (_, index) => ({
      localName: `property${index}`,
      ...(index % 3 === 0
        ? {}
        : {
            attributes: Object.fromEntries(
              values.map((value, attribute) => [
                `attribute${values.length - attribute}`,
                `${value}${index}`,
              ])
            ),
          }),
    }));
    // Independent reference framing: property order matters; attribute order does not.
    const reference = properties
      .map((property) => {
        const attributes = Object.entries(property.attributes ?? {})
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, value]) => `${name}=${value}`)
          .join('\0,');
        return `${property.localName}(\0${attributes}\0)`;
      })
      .join('\0;');
    const key = paragraphLayoutKey({
      paragraph: part.root,
      properties,
      width: 100,
      producer: 'fixed',
    });
    expect(key.endsWith(`:${sha256FontBytes(encoder.encode(reference))}`)).toBe(true);
  }
});
