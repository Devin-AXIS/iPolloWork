// loadFonts: explicit URLs in, hash-verified cached FontSources out
// (font-resolution-overhaul group 3).
//
// The fetcher is injected and counted, so these pin the security-relevant behavior
// directly: exactly the listed URLs are requested, per-source failures degrade rather
// than reject, hash expectations gate admission hard, and the cache layer serves only
// hash-revalidated bytes (a poisoned entry is discarded and refetched).

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sha256FontBytes } from '../../layout/index.ts';
import { createFontSource, loadFonts } from '../load-fonts.ts';
import { composeFontConfiguration } from '../font-composition.ts';

// REAL font bytes: `loadFonts` screens the sfnt signature at the boundary, so synthetic
// payloads would all be refused as `malformed` — which is the point of that screen, and
// is asserted on its own below. Distinct faces give distinct hashes.
const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL(`../../layout/__tests__/fixtures/fonts/${name}`, import.meta.url))
  );
const fontA = fixture('DejaVuSans.ttf');
const fontB = fixture('DejaVuSans-Bold.ttf');
// A third DISTINCT but still structurally valid face: trailing padding changes the
// content hash without touching the sfnt header or table directory.
const fontC = ((): Uint8Array => {
  const base = fixture('DejaVuSans.ttf');
  const padded = new Uint8Array(base.byteLength + 16);
  padded.set(base);
  return padded;
})();

interface FakeFetch {
  readonly fetcher: typeof fetch;
  readonly requested: string[];
}

function fakeFetch(routes: Record<string, Uint8Array | number>): FakeFetch {
  const requested: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const route = routes[url];
    if (route === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    if (typeof route === 'number') return Promise.resolve(new Response(null, { status: route }));
    return Promise.resolve(new Response(route.slice()));
  }) as typeof fetch;
  return { fetcher, requested };
}

/** An in-memory Cache API double registered on the happy-dom/bun global. */
class FakeCache {
  private readonly entries = new Map<string, Uint8Array>();
  match(url: string): Promise<Response | undefined> {
    const bytes = this.entries.get(url);
    return Promise.resolve(bytes ? new Response(bytes.slice()) : undefined);
  }
  put(url: string, response: Response): Promise<void> {
    return response.arrayBuffer().then((buffer) => {
      this.entries.set(url, new Uint8Array(buffer));
    });
  }
  delete(url: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(url));
  }
  /** Test hook: poison an entry directly. */
  poison(url: string, bytes: Uint8Array): void {
    this.entries.set(url, bytes);
  }
  has(url: string): boolean {
    return this.entries.has(url);
  }
}

const globalWithCaches = globalThis as { caches?: unknown };
const originalCaches = globalWithCaches.caches;

function installFakeCaches(): Map<string, FakeCache> {
  const buckets = new Map<string, FakeCache>();
  globalWithCaches.caches = {
    open(name: string) {
      let bucket = buckets.get(name);
      if (!bucket) {
        bucket = new FakeCache();
        buckets.set(name, bucket);
      }
      return Promise.resolve(bucket);
    },
  };
  return buckets;
}

afterEach(() => {
  if (originalCaches === undefined) delete globalWithCaches.caches;
  else globalWithCaches.caches = originalCaches;
});

describe('loadFonts', () => {
  test('fetches exactly the listed URLs and nothing else', async () => {
    delete globalWithCaches.caches;
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA, '/b.ttf': fontB });
    const result = await loadFonts({
      sources: [
        { url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' },
        { url: '/b.ttf', family: 'Beta', weight: 700, style: 'italic' },
      ],
      fetcher,
    });
    expect(requested).toEqual(['/a.ttf', '/b.ttf']);
    expect(result.failures).toHaveLength(0);
    expect(result.sources.map((source) => source.request)).toEqual([
      { family: 'Alpha', weight: 400, style: 'normal' },
      { family: 'Beta', weight: 700, style: 'italic' },
    ]);
    // The computed hash is attached when no expectation was pinned.
    expect(result.sources[0]!.hash).toBe(sha256FontBytes(fontA));
  });

  test('one of three failing degrades that source only, never rejects', async () => {
    delete globalWithCaches.caches;
    const { fetcher } = fakeFetch({ '/a.ttf': fontA, '/b.ttf': 404, '/c.ttf': fontC });
    const result = await loadFonts({
      sources: [
        { url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' },
        { url: '/b.ttf', family: 'Beta', weight: 400, style: 'normal' },
        { url: '/c.ttf', family: 'Gamma', weight: 400, style: 'normal' },
      ],
      fetcher,
    });
    expect(result.sources).toHaveLength(2);
    expect(result.failures).toEqual([
      {
        url: '/b.ttf',
        request: { family: 'Beta', weight: 400, style: 'normal' },
        reason: 'httpError',
        status: 404,
      },
    ]);
  });

  test('a thrown fetch is a typed networkError, not a rejection', async () => {
    delete globalWithCaches.caches;
    const fetcher = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const result = await loadFonts({
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' }],
      fetcher,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.failures[0]).toMatchObject({ reason: 'networkError', diagnostic: 'offline' });
  });

  test('a pinned hash gates admission hard, with expected and actual reported', async () => {
    delete globalWithCaches.caches;
    const { fetcher } = fakeFetch({ '/a.ttf': fontB /* tampered: B served for A's URL */ });
    const expected = sha256FontBytes(fontA);
    const result = await loadFonts({
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal', hash: expected }],
      fetcher,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.failures[0]).toMatchObject({
      reason: 'hashMismatch',
      expectedHash: expected,
      actualHash: sha256FontBytes(fontB),
    });
  });

  test('second call serves from cache without a refetch', async () => {
    installFakeCaches();
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA });
    const request = {
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' as const }],
      fetcher,
    };
    const first = await loadFonts(request);
    expect(first.sources).toHaveLength(1);
    expect(requested).toEqual(['/a.ttf']);
    const second = await loadFonts(request);
    expect(second.sources).toHaveLength(1);
    // No second network request: the bytes came from the cache, hash-verified.
    expect(requested).toEqual(['/a.ttf']);
    expect(second.sources[0]!.hash).toBe(sha256FontBytes(fontA));
  });

  test('a poisoned cache entry is discarded and the URL refetched', async () => {
    const buckets = installFakeCaches();
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA });
    const expected = sha256FontBytes(fontA);
    const request = {
      sources: [
        { url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' as const, hash: expected },
      ],
      fetcher,
    };
    await loadFonts(request);
    const bucket = buckets.get('docx-editor-fonts')!;
    bucket.poison('/a.ttf', fontB);
    const result = await loadFonts(request);
    // Admission proceeded on the FRESH bytes' verification; the poisoned entry is gone.
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.hash).toBe(expected);
    expect(result.failures).toHaveLength(0);
    expect(requested).toEqual(['/a.ttf', '/a.ttf']);
  });

  test('degrades to direct fetch when the Cache API is unavailable', async () => {
    delete globalWithCaches.caches;
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA });
    const request = {
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' as const }],
      fetcher,
    };
    expect((await loadFonts(request)).sources).toHaveLength(1);
    expect((await loadFonts(request)).sources).toHaveLength(1);
    // Two calls, two fetches: no cache, no error.
    expect(requested).toEqual(['/a.ttf', '/a.ttf']);
  });

  test('an over-limit response is refused with a typed failure', async () => {
    delete globalWithCaches.caches;
    const { fetcher } = fakeFetch({ '/a.ttf': fontA });
    const result = await loadFonts({
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' }],
      fetcher,
      maxFontBytes: 2,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.failures[0]).toMatchObject({ reason: 'overLimit' });
  });
});

describe('malformed face descriptors degrade that source only', () => {
  test('an empty family or out-of-range weight fails its own source without fetching', async () => {
    const fetched: string[] = [];
    const result = await loadFonts({
      sources: [
        { url: 'https://x/blank.ttf', family: '   ', weight: 400, style: 'normal' },
        { url: 'https://x/frac.ttf', family: 'Acme', weight: 500.5, style: 'normal' },
        { url: 'https://x/good.ttf', family: 'Acme', weight: 400, style: 'normal' },
      ],
      fetcher: (async (input: RequestInfo | URL) => {
        fetched.push(String(input));
        return new Response(fontA.slice());
      }) as unknown as typeof fetch,
    });
    // Only the well-formed source was even requested.
    expect(fetched).toEqual(['https://x/good.ttf']);
    expect(result.sources).toHaveLength(1);
    expect(result.failures.map((failure) => failure.reason)).toEqual([
      'invalidRequest',
      'invalidRequest',
    ]);
    // And the admitted set composes without throwing — the point of screening early.
    expect(() => composeFontConfiguration(result)).not.toThrow();
  });
});

describe('bytes that are not a font are refused at the boundary', () => {
  test('a 200 response carrying an HTML error page fails as malformed and is not cached', async () => {
    const buckets = installFakeCaches();
    const html = new TextEncoder().encode('<!doctype html><title>404</title>');
    const { fetcher } = fakeFetch({ 'https://x/notafont.ttf': html });
    const result = await loadFonts({
      sources: [{ url: 'https://x/notafont.ttf', family: 'Acme', weight: 400, style: 'normal' }],
      fetcher,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.failures[0]).toMatchObject({ reason: 'malformed' });
    // Nothing poisons the cache, so a later load retries instead of failing forever.
    expect(buckets.get('docx-editor-fonts')?.has('https://x/notafont.ttf') ?? false).toBe(false);
  });
});

describe('createFontSource: bytes you already hold', () => {
  test('valid bytes become a composable source with a computed hash', () => {
    const result = createFontSource(fontA, { family: 'Acme', weight: 400, style: 'normal' });
    expect('source' in result).toBe(true);
    const source = (result as { source: { hash: string; id: string } }).source;
    expect(source.hash).toBe(sha256FontBytes(fontA));
    expect(source.id).toBe('bytes:Acme#400#normal');
    // Composes without ceremony — the point of the helper.
    expect(() =>
      composeFontConfiguration({ sources: [(result as { source: never }).source] })
    ).not.toThrow();
  });

  test('a bad descriptor or non-font bytes returns a typed failure, never throws', () => {
    expect(createFontSource(fontA, { family: '  ', weight: 400, style: 'normal' })).toMatchObject({
      failure: { reason: 'invalidRequest' },
    });
    expect(
      createFontSource(new Uint8Array([1, 2, 3, 4]), {
        family: 'Acme',
        weight: 400,
        style: 'normal',
      })
    ).toMatchObject({ failure: { reason: 'malformed' } });
  });
});
