import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { customFonts } from '../custom-fonts.ts';
import { loadFonts, type FontUrlSource } from '../load-fonts.ts';
import { composeFontOrigins, isFontResolver } from '../font-resolver.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const source = (family = 'Acme Sans', weight = 400): FontUrlSource => ({
  url: `/fonts/${family}-${weight}.ttf`,
  family,
  weight,
  style: 'normal',
});
const request = { families: ['Acme Sans'], defaultFamily: 'Calibri' };
let originalCaches: PropertyDescriptor | undefined;
beforeEach(() => {
  originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined });
});
afterEach(() => {
  if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
  else Reflect.deleteProperty(globalThis, 'caches');
  mock.restore();
});

function fetching() {
  const fetcher = mock(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bytes.slice())
  );
  return fetcher;
}

test('construction is lazy; blank and unrelated documents still receive configured company faces', async () => {
  const fetcher = fetching();
  const resolve = customFonts({ sources: [source()], fetcher: fetcher as typeof fetch });
  expect(isFontResolver(resolve)).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await resolve({ families: [], defaultFamily: 'Calibri' })).sources).toHaveLength(1);
  expect(
    (await resolve({ families: ['Unlisted'], defaultFamily: 'Unlisted' })).sources
  ).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('empty or fully covered company sources do not fetch', async () => {
  const fetcher = fetching();
  expect(await customFonts({ sources: [], fetcher: fetcher as typeof fetch })(request)).toEqual({
    sources: [],
    failures: [],
  });
  const result = await customFonts({ sources: [source()], fetcher: fetcher as typeof fetch })({
    ...request,
    resolvedFaces: [{ family: 'acme sans', weight: 400, style: 'normal' }],
  });
  expect(result).toEqual({ sources: [], failures: [] });
  expect(fetcher).not.toHaveBeenCalled();
});

test('matches case-insensitively and skips only previously supplied faces', async () => {
  const fetcher = fetching();
  const resolve = customFonts({
    sources: [source(), source('Acme Sans', 700)],
    fetcher: fetcher as typeof fetch,
  });
  const result = await resolve({
    families: [' acme SANS ', '../../untrusted'],
    defaultFamily: 'Unknown',
    resolvedFaces: [{ family: 'ACME SANS', weight: 400, style: 'normal' }],
  });
  expect(result.sources.map((s) => s.request.weight)).toEqual([700]);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/fonts/Acme Sans-700.ttf']);
});

test('retains valid fonts, reports typed failures, and honours hash and byte limits', async () => {
  const onFailure = mock(() => {});
  const fetcher = fetching();
  const resolve = customFonts({
    sources: [source(), { ...source('Acme Sans', 700), hash: 'sha256:wrong' }],
    fetcher: fetcher as typeof fetch,
    onFailure,
  });
  const result = await resolve(request);
  expect(result.sources).toHaveLength(1);
  expect(result.failures[0]!.reason).toBe('hashMismatch');
  expect(onFailure).toHaveBeenCalledWith(result.failures[0]);
  const limited = await customFonts({
    sources: [source()],
    fetcher: fetcher as typeof fetch,
    maxFontBytes: 1,
    onFailure,
  })(request);
  expect(limited.sources).toHaveLength(0);
  expect(limited.failures[0]!.reason).toBe('overLimit');
});

test('warns by default for unavailable faces without rejecting the resolver', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  const result = await customFonts({
    sources: [source()],
    fetcher: (async () => new Response(null, { status: 404 })) as typeof fetch,
  })(request);
  expect(result.failures[0]!.reason).toBe('httpError');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![0]).toContain('Acme Sans');
});

test('composes first-wins and lets later origins provide missing weights', async () => {
  const first = fetching();
  const second = fetching();
  const result = await composeFontOrigins(
    [
      customFonts({ sources: [source()], fetcher: first as typeof fetch }),
      customFonts({
        sources: [source(), source('Acme Sans', 700)],
        fetcher: second as typeof fetch,
      }),
    ],
    request
  );
  expect(result!.sources!.map((s) => s.request.weight)).toEqual([400, 700]);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second.mock.calls.map(([url]) => url)).toEqual(['/fonts/Acme Sans-700.ttf']);
});

test('pre-aborted resolution does no work or reporting', async () => {
  const controller = new AbortController();
  const reason = new Error('document closed');
  controller.abort(reason);
  const fetcher = fetching();
  const onFailure = mock(() => {});
  const resolve = customFonts({ sources: [source()], fetcher: fetcher as typeof fetch, onFailure });
  await expect(resolve({ ...request, signal: controller.signal })).rejects.toBe(reason);
  await expect(
    loadFonts({ sources: [source()], fetcher: fetcher as typeof fetch, signal: controller.signal })
  ).rejects.toBe(reason);
  expect(fetcher).not.toHaveBeenCalled();
  expect(onFailure).not.toHaveBeenCalled();
});

test('passes cancellation to fetch without reporting a network failure', async () => {
  const controller = new AbortController();
  const reason = new Error('document changed');
  const onFailure = mock(() => {});
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  const fetcher = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(init!.signal).toBe(controller.signal);
    controller.abort(reason);
    throw reason;
  });
  await expect(
    customFonts({ sources: [source()], fetcher: fetcher as typeof fetch, onFailure })({
      ...request,
      signal: controller.signal,
    })
  ).rejects.toBe(reason);
  expect(onFailure).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

test('cancellation during body reads preserves the original abort reason', async () => {
  const controller = new AbortController();
  const reason = new Error('body cancelled');
  const onFailure = mock(() => {});
  const fetcher = (async () => ({
    ok: true,
    async arrayBuffer() {
      controller.abort(reason);
      return bytes.slice().buffer;
    },
  })) as unknown as typeof fetch;
  await expect(
    customFonts({ sources: [source()], fetcher, onFailure })({
      ...request,
      signal: controller.signal,
    })
  ).rejects.toBe(reason);
  expect(onFailure).not.toHaveBeenCalled();
});

test('browser cache reuse does not download the same company face twice', async () => {
  const entries = new Map<string, Response>();
  const open = mock(async () => ({
    async match(url: string) {
      return entries.get(url)?.clone();
    },
    async put(url: string, value: Response) {
      entries.set(url, value);
    },
  }));
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open } });
  const fetcher = fetching();
  const resolve = customFonts({
    sources: [source()],
    fetcher: fetcher as typeof fetch,
    cacheName: 'company-fonts-test',
  });
  expect((await resolve(request)).sources).toHaveLength(1);
  expect((await resolve(request)).sources).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith('company-fonts-test');
});

test('cancellation during a cache read stops subsequent network work', async () => {
  const controller = new AbortController();
  const reason = new Error('cache cancelled');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      async open() {
        return {
          async match() {
            controller.abort(reason);
            return undefined;
          },
        };
      },
    },
  });
  const fetcher = fetching();
  const onFailure = mock(() => {});
  await expect(
    customFonts({ sources: [source()], fetcher: fetcher as typeof fetch, onFailure })({
      ...request,
      signal: controller.signal,
    })
  ).rejects.toBe(reason);
  expect(fetcher).not.toHaveBeenCalled();
  expect(onFailure).not.toHaveBeenCalled();
});

test('cancellation during cache storage suppresses completion and failure callbacks', async () => {
  const controller = new AbortController();
  const reason = new Error('cache write cancelled');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      async open() {
        return {
          async match() {
            return undefined;
          },
          async put() {
            controller.abort(reason);
          },
        };
      },
    },
  });
  const fetcher = fetching();
  const onFailure = mock(() => {});
  await expect(
    customFonts({ sources: [source()], fetcher: fetcher as typeof fetch, onFailure })({
      ...request,
      signal: controller.signal,
    })
  ).rejects.toBe(reason);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(onFailure).not.toHaveBeenCalled();
});
