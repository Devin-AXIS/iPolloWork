// App-directed font fetching (font-resolution-overhaul group 3).
//
// `loadFonts` turns URLs the APPLICATION chose into verified `FontSource`s. The security
// posture is explicit-only: this helper fetches exactly what it is handed, is never
// called by the engine itself, and a document can never reach it — opening a file must
// not produce a network request (no zero-click fetch, no default CDN, no discovery).
//
// The contract's `sha256:` hash does double duty here: it gates admission when the
// caller pinned an expectation (a tampered response or poisoned cache entry fails that
// source, hard), and it revalidates the Cache API layer on every read — the cache is an
// optimization keyed by URL, but BYTES are only ever trusted by content.
//
// Per-source failure is degradation, not rejection: the promise always resolves, with
// every admitted source plus a typed failure list, so the app can mount with partial
// coverage (unresolved families measure via the fixed fallback) and report.

import type { FontFaceRequest, FontSource } from '@docx-editor.dev/core/contracts/editor';
import {
  HARD_MAX_FONT_BYTES,
  boundedStructuralFontValidator,
  sha256FontBytes,
} from '@docx-editor.dev/core/layout';
import type { FontConfigurationFragment } from './font-composition.ts';

/** One URL to fetch and the face it claims to be. */
export interface FontUrlSource {
  readonly url: string;
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  /**
   * Expected `sha256:` content hash. When present, mismatching bytes are REFUSED —
   * pin this for any URL not under the app's sole control.
   */
  readonly hash?: string;
  readonly faceIndex?: number;
}

/**
 * What to fetch, and under what limits.
 *
 * Only `sources` is required. Each carries its own expected hash, so bytes are trusted by
 * CONTENT rather than by origin — a swapped asset fails admission even from a trusted host.
 */
export interface LoadFontsRequest {
  readonly sources: readonly FontUrlSource[];
  /** Cache API bucket name; default `docx-editor-fonts`. */
  readonly cacheName?: string;
  /** Injectable for tests and CSP-constrained hosts; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
  /** Per-font byte ceiling; defaults to the engine hard maximum. */
  readonly maxFontBytes?: number;
  /** Cancels loading with `signal.reason`, without returning per-source failures. */
  readonly signal?: AbortSignal;
}

/**
 * Why one font did not load.
 *
 * Distinguished rather than collapsed to "failed" because the responses differ: `networkError`
 * and `httpError` are worth retrying, while `hashMismatch` and `malformed` mean the bytes were
 * not what the source claimed and retrying will fetch the same wrong thing.
 */
export type FontLoadFailureReason =
  | 'networkError'
  | 'httpError'
  | 'hashMismatch'
  | 'overLimit'
  | 'emptyResponse'
  /** The declared face itself is unusable (empty family, out-of-range weight); nothing was fetched. */
  | 'invalidRequest'
  /** The bytes are not a font at all — most often an HTML error page served with 200. */
  | 'malformed';

/**
 * One face that did not load, with whatever evidence the failure produced.
 *
 * Non-fatal: {@link LoadFontsResult} still carries every source that succeeded, and the affected
 * family falls back to the engine's fixed measurement.
 */
export interface FontLoadFailure {
  readonly url: string;
  readonly request: FontFaceRequest;
  readonly reason: FontLoadFailureReason;
  /** HTTP status for `httpError`; hashes for `hashMismatch`. */
  readonly status?: number;
  readonly expectedHash?: string;
  readonly actualHash?: string;
  readonly diagnostic?: string;
}

/**
 * What one `loadFonts` call produced: the faces that arrived, plus the ones that did not.
 *
 * A `FontConfigurationFragment`, so it composes straight into `composeFontConfiguration`
 * alongside other font sources. Partial success is the normal case — compose it even with
 * failures present.
 */
export interface LoadFontsResult extends FontConfigurationFragment {
  readonly sources: readonly FontSource[];
  readonly failures: readonly FontLoadFailure[];
}

/**
 * Mirrors the request contract's own assertions (`assertRequest`) as a returned reason
 * rather than a throw, so one bad entry in a caller's list degrades that entry only.
 */
function faceRequestProblem(request: FontFaceRequest): string | null {
  if (request.family.trim().length === 0) return 'font family must not be empty';
  if (!Number.isInteger(request.weight) || request.weight < 1 || request.weight > 1000) {
    return 'font weight must be an integer from 1 through 1000';
  }
  if (request.style !== 'normal' && request.style !== 'italic') {
    return 'font style must be normal or italic';
  }
  return null;
}

/** The Cache API when the environment provides one; absence degrades to direct fetch. */
function openCache(cacheName: string): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    return caches.open(cacheName).catch(() => null);
  } catch {
    // Non-secure contexts throw on ACCESS, not just on open.
    return Promise.resolve(null);
  }
}

async function cachedBytes(cache: Cache | null, url: string): Promise<Uint8Array | null> {
  if (!cache) return null;
  try {
    const hit = await cache.match(url);
    if (!hit) return null;
    return new Uint8Array(await hit.arrayBuffer());
  } catch {
    return null;
  }
}

async function storeBytes(cache: Cache | null, url: string, bytes: Uint8Array): Promise<void> {
  if (!cache) return;
  try {
    // A fresh Response over a copy: the caller's view must not alias cache storage.
    await cache.put(
      url,
      new Response(bytes.slice(), { headers: { 'Content-Length': String(bytes.byteLength) } })
    );
  } catch {
    // Quota or eviction races are the cache's business; the fetch already succeeded.
  }
}

async function discardEntry(cache: Cache | null, url: string): Promise<void> {
  if (!cache) return;
  try {
    await cache.delete(url);
  } catch {
    /* best-effort */
  }
}

/**
 * Fetch app-specified font URLs into verified, cache-backed `FontSource`s.
 *
 * Fetches ONLY the URLs listed — never a default host or engine-chosen CDN — and never
 * rejects for a per-source failure: the result carries every admitted source and a
 * typed entry for every drop. Cancellation instead rejects with `signal.reason`. Compose the result with `composeFontConfiguration`.
 */
export async function loadFonts(request: LoadFontsRequest): Promise<LoadFontsResult> {
  const checkAbort = (): void => {
    if (request.signal?.aborted) throw request.signal.reason;
  };
  checkAbort();
  const fetcher = request.fetcher ?? fetch;
  const maxFontBytes = request.maxFontBytes ?? HARD_MAX_FONT_BYTES;
  const cache = await openCache(request.cacheName ?? 'docx-editor-fonts');
  checkAbort();

  type Outcome = { readonly source: FontSource } | { readonly failure: FontLoadFailure };

  async function loadOne(source: FontUrlSource): Promise<Outcome> {
    checkAbort();
    const faceRequest: FontFaceRequest = Object.freeze({
      family: source.family,
      weight: source.weight,
      style: source.style,
    });
    // Screened HERE, not at composition: the request contract refuses a malformed face
    // with a THROW, so admitting one would detonate the configuration carrying every
    // other font instead of degrading this single source. Same discipline the embedded
    // lane applies to file-declared families. Nothing is fetched for a bad descriptor.
    const descriptorProblem = faceRequestProblem(faceRequest);
    if (descriptorProblem) {
      return {
        failure: {
          url: source.url,
          request: faceRequest,
          reason: 'invalidRequest',
          diagnostic: descriptorProblem,
        },
      };
    }

    const admit = (bytes: Uint8Array, fromCache: boolean): FontSource | FontLoadFailure => {
      if (bytes.byteLength === 0) {
        return { url: source.url, request: faceRequest, reason: 'emptyResponse' };
      }
      if (bytes.byteLength > maxFontBytes) {
        return { url: source.url, request: faceRequest, reason: 'overLimit' };
      }
      // A 200 response carrying an HTML error page passes every size check. Without this
      // it would be admitted, cached, and then fail deep in shaping on EVERY later load,
      // with nothing ever discarding the entry. A signature check is cheap and turns that
      // into one typed failure at the boundary.
      const structural = boundedStructuralFontValidator(bytes, source.faceIndex ?? 0);
      if (!structural.valid) {
        return {
          url: source.url,
          request: faceRequest,
          reason: 'malformed',
          diagnostic: structural.diagnostic,
        };
      }
      const actualHash = sha256FontBytes(bytes);
      if (source.hash !== undefined && source.hash !== actualHash) {
        return {
          url: source.url,
          request: faceRequest,
          reason: 'hashMismatch',
          expectedHash: source.hash,
          actualHash,
          ...(fromCache ? { diagnostic: 'cached bytes failed revalidation' } : {}),
        };
      }
      return {
        request: faceRequest,
        id: `url:${source.url}`,
        bytes,
        hash: actualHash,
        faceIndex: source.faceIndex ?? 0,
      };
    };

    // Cache first, revalidated by content hash. A poisoned or stale entry is discarded
    // and the URL refetched — a cache problem is never a hard failure by itself.
    const cached = await cachedBytes(cache, source.url);
    checkAbort();
    if (cached) {
      const verdict = admit(cached, true);
      if (!('reason' in verdict)) return { source: verdict };
      await discardEntry(cache, source.url);
      checkAbort();
    }

    let response: Response;
    try {
      response = request.signal
        ? await fetcher(source.url, { signal: request.signal })
        : await fetcher(source.url);
      checkAbort();
    } catch (error) {
      checkAbort();
      return {
        failure: {
          url: source.url,
          request: faceRequest,
          reason: 'networkError',
          diagnostic: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (!response.ok) {
      return {
        failure: {
          url: source.url,
          request: faceRequest,
          reason: 'httpError',
          status: response.status,
        },
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
      checkAbort();
    } catch (error) {
      checkAbort();
      return {
        failure: {
          url: source.url,
          request: faceRequest,
          reason: 'networkError',
          diagnostic: error instanceof Error ? error.message : String(error),
        },
      };
    }
    const verdict = admit(bytes, false);
    if ('reason' in verdict) return { failure: verdict };
    await storeBytes(cache, source.url, bytes);
    checkAbort();
    return { source: verdict };
  }

  // Fetched CONCURRENTLY — eight brand faces should be one round trip's wait, not eight.
  // Results are reassembled in list order, so admission stays deterministic regardless of
  // which response lands first.
  const outcomes = await Promise.all(request.sources.map((source) => loadOne(source)));
  checkAbort();

  const sources: FontSource[] = [];
  const failures: FontLoadFailure[] = [];
  for (const outcome of outcomes) {
    if ('source' in outcome) sources.push(outcome.source);
    else failures.push(outcome.failure);
  }
  return { sources, failures };
}

/**
 * Turn font bytes you ALREADY hold into a `FontSource` — a file input, IndexedDB, a
 * bundler import. `loadFonts` covers URLs; this covers everything else, so no caller has
 * to hand-assemble the record or reach for a hashing helper.
 *
 * Returns a typed failure instead of throwing when the descriptor or the bytes are
 * unusable, matching `loadFonts`: one bad face degrades itself, never its neighbours.
 */
export function createFontSource(
  bytes: Uint8Array,
  request: FontFaceRequest & { readonly faceIndex?: number },
  options: { readonly id?: string; readonly maxFontBytes?: number } = {}
): { readonly source: FontSource } | { readonly failure: FontLoadFailure } {
  const faceRequest: FontFaceRequest = Object.freeze({
    family: request.family,
    weight: request.weight,
    style: request.style,
  });
  const url =
    options.id ?? `bytes:${faceRequest.family}#${faceRequest.weight}#${faceRequest.style}`;
  const descriptorProblem = faceRequestProblem(faceRequest);
  if (descriptorProblem) {
    return {
      failure: {
        url,
        request: faceRequest,
        reason: 'invalidRequest',
        diagnostic: descriptorProblem,
      },
    };
  }
  if (bytes.byteLength === 0) {
    return { failure: { url, request: faceRequest, reason: 'emptyResponse' } };
  }
  if (bytes.byteLength > (options.maxFontBytes ?? HARD_MAX_FONT_BYTES)) {
    return { failure: { url, request: faceRequest, reason: 'overLimit' } };
  }
  const faceIndex = request.faceIndex ?? 0;
  const structural = boundedStructuralFontValidator(bytes, faceIndex);
  if (!structural.valid) {
    return {
      failure: {
        url,
        request: faceRequest,
        reason: 'malformed',
        diagnostic: structural.diagnostic,
      },
    };
  }
  return {
    source: {
      request: faceRequest,
      id: url,
      bytes,
      hash: sha256FontBytes(bytes),
      faceIndex,
    },
  };
}
