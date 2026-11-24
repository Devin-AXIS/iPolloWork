import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HARD_MAX_FONT_BYTES } from '../../layout/font-resource.ts';
import { createPackagedFileFetch, type PackagedFileRead } from '../packaged-file-fetch.ts';

const TEST_ROOT = new URL('file:///packaged/');
const TEST_FILE = new URL('file:///packaged/font.woff2');

function confinedFetch(
  read?: PackagedFileRead,
  networkFetch?: typeof fetch,
  maxBytes = 1024
): typeof fetch {
  return createPackagedFileFetch({
    trustedRoot: TEST_ROOT,
    maxBytes,
    ...(read ? { read } : {}),
    ...(networkFetch ? { networkFetch } : {}),
  });
}

test('packaged file reads physically observe abort before a retry begins', async () => {
  const observedSignals: AbortSignal[] = [];
  const fetcher = confinedFetch(
    (_path, { signal }) =>
      new Promise<Uint8Array>((_resolve, reject) => {
        if (!signal) throw new Error('expected read cancellation signal');
        observedSignals.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
  );
  const first = new AbortController();
  const firstRead = fetcher(TEST_FILE, { signal: first.signal });
  first.abort('deadline-one');
  await expect(firstRead).rejects.toBe('deadline-one');
  expect(observedSignals[0]?.aborted).toBe(true);

  const second = new AbortController();
  const secondRead = fetcher(TEST_FILE, { signal: second.signal });
  expect(observedSignals).toHaveLength(2);
  expect(observedSignals[1]?.aborted).toBe(false);
  second.abort('deadline-two');
  await expect(secondRead).rejects.toBe('deadline-two');
});

test('packaged file fetch distinguishes missing files from cancellation', async () => {
  const missing = confinedFetch(async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
  expect((await missing(TEST_FILE)).status).toBe(404);

  const controller = new AbortController();
  controller.abort('already-stopped');
  await expect(missing(TEST_FILE, { signal: controller.signal })).rejects.toBe('already-stopped');
});

test('packaged file fetch delegates bundler HTTP asset URLs to the host fetch', async () => {
  const calls: Array<{ readonly url: string; readonly signal: AbortSignal | null }> = [];
  const controller = new AbortController();
  const fetcher = confinedFetch(
    async () => {
      throw new Error('file reader must not receive browser assets');
    },
    (async (input, init) => {
      calls.push({
        url: input instanceof URL ? input.href : String(input),
        signal: init?.signal ?? null,
      });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch
  );

  const response = await fetcher(new URL('https://demo.test/assets/Carlito-Regular.ttf'), {
    signal: controller.signal,
  });

  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(calls).toEqual([
    {
      url: 'https://demo.test/assets/Carlito-Regular.ttf',
      signal: controller.signal,
    },
  ]);
});

test('packaged file fetch refuses file URLs outside trustedRoot without reading', async () => {
  const reads: string[] = [];
  const fetcher = confinedFetch(async (path) => {
    reads.push(String(path));
    return new Uint8Array([1]);
  });

  expect((await fetcher(new URL('file:///etc/passwd'))).status).toBe(404);
  expect((await fetcher(new URL('file:///packaged/../etc/passwd'))).status).toBe(404);
  expect((await fetcher(new URL('file:///packaged/%2e%2e%2fetc/passwd'))).status).toBe(404);
  expect((await fetcher(new URL('file:///packaged-extra/font.woff2'))).status).toBe(404);
  expect(reads).toEqual([]);
});

test('packaged file fetch rejects an oversized injected read without returning the body', async () => {
  const fetcher = confinedFetch(async () => new Uint8Array(8), undefined, 4);
  const response = await fetcher(TEST_FILE);
  expect(response.status).toBe(413);
  expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(0);
});

test('createPackagedFileFetch requires a nested trustedRoot and a finite maxBytes', () => {
  expect(() => createPackagedFileFetch({ trustedRoot: new URL('file:///'), maxBytes: 1 })).toThrow(
    TypeError
  );
  expect(() =>
    createPackagedFileFetch({ trustedRoot: new URL('https://demo.test/assets/'), maxBytes: 1 })
  ).toThrow(TypeError);
  expect(() => createPackagedFileFetch({ trustedRoot: TEST_ROOT, maxBytes: 0 })).toThrow(TypeError);
  expect(() => createPackagedFileFetch({ trustedRoot: TEST_ROOT, maxBytes: 1.5 })).toThrow(
    TypeError
  );
  expect(() =>
    createPackagedFileFetch({ trustedRoot: TEST_ROOT, maxBytes: HARD_MAX_FONT_BYTES + 1 })
  ).toThrow(TypeError);
  expect(() => createPackagedFileFetch({ trustedRoot: [], maxBytes: 1 })).toThrow(TypeError);
  expect(() =>
    createPackagedFileFetch({
      trustedRoot: Array.from({ length: 9 }, () => TEST_ROOT),
      maxBytes: 1,
    })
  ).toThrow(TypeError);
});

test('packaged file fetch admits a host-chosen second root without widening either directory', async () => {
  const reads: string[] = [];
  const bundledRoot = new URL('file:///bundle/assets/');
  const fetcher = createPackagedFileFetch({
    trustedRoot: [TEST_ROOT, bundledRoot],
    maxBytes: 1024,
    read: async (path) => {
      reads.push(String(path));
      return new Uint8Array([1]);
    },
  });

  expect((await fetcher(TEST_FILE)).status).toBe(200);
  expect((await fetcher(new URL('file:///bundle/assets/Carlito-Regular.ttf'))).status).toBe(200);
  expect((await fetcher(new URL('file:///etc/passwd'))).status).toBe(404);
  expect((await fetcher(new URL('file:///bundle/assets/../secret.ttf'))).status).toBe(404);
  expect((await fetcher(new URL('file:///packaged/../etc/passwd'))).status).toBe(404);
  expect(reads).toEqual([
    new URL('file:///packaged/font.woff2').href,
    new URL('file:///bundle/assets/Carlito-Regular.ttf').href,
  ]);
});

test('default packaged file reader stays inside trustedRoot and honors maxBytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'packaged-file-fetch-'));
  const outside = mkdtempSync(join(tmpdir(), 'packaged-file-outside-'));
  try {
    writeFileSync(join(root, 'face.ttf'), 'font');
    writeFileSync(join(root, 'huge.ttf'), 'too-large');
    writeFileSync(join(outside, 'secret.ttf'), 'secret');
    symlinkSync(join(outside, 'secret.ttf'), join(root, 'escaped.ttf'));
    const trustedRoot = new URL(pathToFileURL(root.endsWith('/') ? root : `${root}/`).href);
    const fetcher = createPackagedFileFetch({ trustedRoot, maxBytes: 4 });

    const allowed = await fetcher(new URL(pathToFileURL(join(root, 'face.ttf')).href));
    expect(allowed.status).toBe(200);
    expect(new Uint8Array(await allowed.arrayBuffer())).toEqual(
      new Uint8Array([102, 111, 110, 116])
    );

    expect((await fetcher(new URL(pathToFileURL(join(root, 'huge.ttf')).href))).status).toBe(413);
    expect((await fetcher(new URL(pathToFileURL(join(root, 'escaped.ttf')).href))).status).toBe(
      404
    );
    expect((await fetcher(new URL(pathToFileURL(join(outside, 'secret.ttf')).href))).status).toBe(
      404
    );
    expect((await fetcher(new URL('../secret.ttf', trustedRoot))).status).toBe(404);

    const bundled = mkdtempSync(join(tmpdir(), 'packaged-file-bundled-'));
    try {
      writeFileSync(join(bundled, 'face.ttf'), 'font');
      const bundledRoot = new URL(
        pathToFileURL(bundled.endsWith('/') ? bundled : `${bundled}/`).href
      );
      const dual = createPackagedFileFetch({
        trustedRoot: [trustedRoot, bundledRoot],
        maxBytes: 4,
      });
      const bundledFace = await dual(new URL(pathToFileURL(join(bundled, 'face.ttf')).href));
      expect(bundledFace.status).toBe(200);
      expect((await dual(new URL(pathToFileURL(join(outside, 'secret.ttf')).href))).status).toBe(
        404
      );
    } finally {
      rmSync(bundled, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('default packaged file reader keeps the logical trustedRoot prefix before realpath', async () => {
  const realDir = mkdtempSync(join(tmpdir(), 'packaged-file-real-'));
  const linkParent = mkdtempSync(join(tmpdir(), 'packaged-file-link-'));
  try {
    writeFileSync(join(realDir, 'face.ttf'), 'font');
    const linkedDir = join(linkParent, 'assets');
    symlinkSync(realDir, linkedDir);
    const symlinkRoot = new URL(
      pathToFileURL(linkedDir.endsWith('/') ? linkedDir : `${linkedDir}/`).href
    );
    const fetcher = createPackagedFileFetch({ trustedRoot: symlinkRoot, maxBytes: 4 });

    const throughLink = await fetcher(new URL(pathToFileURL(join(linkedDir, 'face.ttf')).href));
    expect(throughLink.status).toBe(200);
    expect(new Uint8Array(await throughLink.arrayBuffer())).toEqual(
      new Uint8Array([102, 111, 110, 116])
    );
    expect((await fetcher(new URL(pathToFileURL(join(realDir, 'face.ttf')).href))).status).toBe(
      404
    );
  } finally {
    rmSync(realDir, { recursive: true, force: true });
    rmSync(linkParent, { recursive: true, force: true });
  }
});
