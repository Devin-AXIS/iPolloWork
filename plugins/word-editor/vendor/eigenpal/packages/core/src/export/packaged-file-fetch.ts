// Node-compatible fetch adapter for packaged exporter assets (fonts, images, …).

import { HARD_MAX_FONT_BYTES } from '../layout/font-resource.ts';

/** Read packaged bytes from a confined local `file:` URL. Kept injectable for tests. @public */
export type PackagedFileRead = (
  path: string | URL,
  options: { readonly signal?: AbortSignal; readonly maxBytes: number }
) => Promise<Uint8Array>;

/**
 * Bounds for {@link createPackagedFileFetch}. `trustedRoot` is one directory or a short
 * host-chosen list of directories of allowed `file:` URLs. `maxBytes` is the per-file
 * allocation ceiling and cannot exceed the engine font-byte ceiling.
 * @public
 */
export interface PackagedFileFetchOptions {
  readonly trustedRoot: string | URL | readonly (string | URL)[];
  readonly maxBytes: number;
  readonly read?: PackagedFileRead;
  readonly networkFetch?: typeof fetch;
}

const FILE_TOO_LARGE = 'FILE_TOO_LARGE';
const HARD_MAX_TRUSTED_ROOTS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== 'string') return undefined;
  return error.code;
}

function isLocalFileHost(host: string): boolean {
  return host === '' || host.toLowerCase() === 'localhost';
}

function decodePathname(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

/** Collapse `.` and `..` after decoding so `%2e%2e%2f` cannot skip the URL parser. */
function normalizeAbsolutePathname(pathname: string): string | null {
  const decoded = decodePathname(pathname);
  if (decoded === null) return null;
  const parts: string[] = [];
  for (const segment of decoded.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

function asDirectoryPathname(pathname: string): string | null {
  const normalized = normalizeAbsolutePathname(pathname);
  if (normalized === null) return null;
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function isBroadFilesystemRoot(directory: string): boolean {
  return directory === '/' || /^\/[A-Za-z]:\/$/.test(directory);
}

function trustedRootDirectory(root: string | URL): URL {
  let url: URL;
  try {
    url =
      typeof root === 'string' ? new URL(root) : new URL('href' in root ? root.href : String(root));
  } catch {
    throw new TypeError('trustedRoot must be an absolute file: URL');
  }
  if (url.protocol !== 'file:') {
    throw new TypeError('trustedRoot must use the file: protocol');
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('trustedRoot must not include credentials');
  }
  if (!isLocalFileHost(url.host)) {
    throw new TypeError('trustedRoot must be a local file: URL');
  }
  const directory = asDirectoryPathname(url.pathname);
  if (directory === null || isBroadFilesystemRoot(directory)) {
    throw new TypeError('trustedRoot must be a directory inside the filesystem');
  }
  const canonical = new URL('file:///');
  canonical.pathname = directory;
  return canonical;
}

function asTrustedRootValues(
  root: string | URL | readonly (string | URL)[]
): readonly (string | URL)[] {
  if (typeof root === 'string') return [root];
  if (typeof root === 'object' && root !== null && 'href' in root) return [root];
  if (Array.isArray(root)) return root;
  throw new TypeError('trustedRoot must be an absolute file: URL');
}

function trustedRootDirectories(root: string | URL | readonly (string | URL)[]): readonly URL[] {
  const values = asTrustedRootValues(root);
  if (values.length === 0) {
    throw new TypeError('trustedRoot must name at least one directory');
  }
  if (values.length > HARD_MAX_TRUSTED_ROOTS) {
    throw new TypeError(`trustedRoot must not exceed ${HARD_MAX_TRUSTED_ROOTS} directories`);
  }
  return values.map(trustedRootDirectory);
}

function parseMaxBytes(maxBytes: number): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }
  if (maxBytes > HARD_MAX_FONT_BYTES) {
    throw new TypeError(`maxBytes must not exceed ${HARD_MAX_FONT_BYTES}`);
  }
  return maxBytes;
}

function confinedFileUrl(input: URL, trustedRoots: readonly URL[]): URL | null {
  if (input.protocol !== 'file:') return null;
  if (input.username !== '' || input.password !== '') return null;
  if (!isLocalFileHost(input.host)) return null;
  const filePath = normalizeAbsolutePathname(input.pathname);
  if (filePath === null) return null;
  for (const trustedRoot of trustedRoots) {
    const directory = asDirectoryPathname(trustedRoot.pathname);
    if (directory === null) continue;
    if (!filePath.startsWith(directory) || filePath.length <= directory.length) continue;
    const confined = new URL('file:///');
    confined.pathname = filePath;
    return confined;
  }
  return null;
}

function requestUrl(input: string | URL | { readonly url: string }): URL {
  if (typeof input === 'string') return new URL(input);
  if ('href' in input && typeof input.href === 'string') return new URL(input.href);
  return new URL('url' in input ? input.url : String(input));
}

function isInsideRoot(
  root: string,
  candidate: string,
  path: Pick<typeof import('node:path'), 'relative' | 'isAbsolute' | 'resolve'>
): boolean {
  const relation = path.relative(path.resolve(root), path.resolve(candidate));
  return relation !== '' && !relation.startsWith('..') && !path.isAbsolute(relation);
}

function isInsideAnyRoot(
  roots: readonly string[],
  candidate: string,
  path: Pick<typeof import('node:path'), 'relative' | 'isAbsolute' | 'resolve'>
): boolean {
  return roots.some((root) => isInsideRoot(root, candidate, path));
}

async function existingRealpaths(
  paths: readonly string[],
  realpath: (path: string) => Promise<string>
): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) {
    try {
      found.push(await realpath(path));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      throw error;
    }
  }
  return found;
}

function createNodePackagedFileRead(trustedRoots: readonly URL[]): PackagedFileRead {
  return async (path, { signal, maxBytes }) => {
    if (signal?.aborted) throw signal.reason;
    const [{ open, realpath }, { constants }, { fileURLToPath }, nodePath] = await Promise.all([
      import('node:fs/promises'),
      import('node:fs'),
      import('node:url'),
      import('node:path'),
    ]);
    const logicalRoots = trustedRoots.map((root) => nodePath.resolve(fileURLToPath(root.href)));
    const requested = nodePath.resolve(fileURLToPath(typeof path === 'string' ? path : path.href));
    if (!isInsideAnyRoot(logicalRoots, requested, nodePath)) {
      throw Object.assign(new Error('packaged file is outside trustedRoot'), { code: 'ENOENT' });
    }
    const flags =
      typeof constants.O_NOFOLLOW === 'number' ? constants.O_RDONLY | constants.O_NOFOLLOW : 'r';
    const handle = await open(requested, flags);
    const closeOnAbort = (): void => {
      void handle.close();
    };
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    try {
      if (signal?.aborted) throw signal.reason;
      const actualPath = await realpath(requested);
      if (!isInsideAnyRoot(await existingRealpaths(logicalRoots, realpath), actualPath, nodePath)) {
        throw Object.assign(new Error('packaged file is outside trustedRoot'), { code: 'ENOENT' });
      }
      const size = (await handle.stat()).size;
      if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
        throw Object.assign(new Error('packaged file exceeds maxBytes'), { code: FILE_TOO_LARGE });
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        if (signal?.aborted) throw signal.reason;
        const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (signal?.aborted) throw signal.reason;
      return offset === bytes.byteLength ? bytes : bytes.slice(0, offset);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw error;
    } finally {
      signal?.removeEventListener('abort', closeOnAbort);
      await handle.close().catch(() => {});
    }
  };
}

/**
 * Build the packaged-asset fetch adapter shared by headless exporters.
 * File reads stay inside the host-chosen `trustedRoot` list and never allocate more than `maxBytes`.
 * Kept injectable for lifecycle and host-fetch tests.
 * @public
 */
export function createPackagedFileFetch(options: PackagedFileFetchOptions): typeof fetch {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createPackagedFileFetch requires trustedRoot and maxBytes');
  }
  if (options.trustedRoot === undefined || options.maxBytes === undefined) {
    throw new TypeError('createPackagedFileFetch requires trustedRoot and maxBytes');
  }
  const trustedRoots = trustedRootDirectories(options.trustedRoot);
  const maxBytes = parseMaxBytes(options.maxBytes);
  const read = options.read ?? createNodePackagedFileRead(trustedRoots);
  const networkFetch = options.networkFetch ?? fetch;
  return (async (
    input: string | URL | { readonly url: string },
    init?: RequestInit
  ): Promise<Response> => {
    const hostSignal = init?.signal;
    if (hostSignal?.aborted) throw hostSignal.reason;
    const value = requestUrl(input);
    if (value.protocol !== 'file:') {
      // Source builds run the same package in browser demos. Vite and other bundlers rewrite
      // `new URL('../assets/face.ttf', import.meta.url)` to an HTTP asset URL, so let the host
      // fetch it normally. Published Node builds retain file: URLs and stay on the bounded
      // file-reader path below.
      return networkFetch(value, init);
    }
    const confined = confinedFileUrl(value, trustedRoots);
    if (!confined) return new Response(null, { status: 404 });
    // A host signal can come from another JS realm. Node's fs validator rejects such signals
    // even though fetch accepts them, so bridge it through this module's native controller.
    const readController = hostSignal ? new AbortController() : undefined;
    const forwardAbort = (): void => readController?.abort(hostSignal?.reason);
    hostSignal?.addEventListener('abort', forwardAbort, { once: true });
    let bytes: Uint8Array;
    try {
      bytes = await read(confined, {
        maxBytes,
        ...(readController ? { signal: readController.signal } : {}),
      });
      if (hostSignal?.aborted) throw hostSignal.reason;
      if (bytes.byteLength > maxBytes) {
        return new Response(null, { status: 413 });
      }
    } catch (error) {
      if (hostSignal?.aborted) throw hostSignal.reason;
      if (readController?.signal.aborted) throw readController.signal.reason ?? error;
      if (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error;
      }
      const code = errorCode(error);
      if (code === FILE_TOO_LARGE) return new Response(null, { status: 413 });
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
        return new Response(null, { status: 404 });
      }
      throw error;
    } finally {
      hostSignal?.removeEventListener('abort', forwardAbort);
    }
    return new Response(
      bytes as unknown as NonNullable<ConstructorParameters<typeof Response>[0]>,
      { status: 200 }
    );
  }) as typeof fetch;
}
