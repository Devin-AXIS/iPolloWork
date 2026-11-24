// The mark that separates an on-demand resolver from a zero-argument loader, and the
// list-of-origins composition both adapters build their font hooks on.
//
// The mark exists because the two are the same TYPE — `() => X` is assignable to
// `(request) => X` — and are called differently, so getting them mixed up is a runtime
// throw rather than a compile error. What is pinned here is that the mark survives, that
// an unmarked function reads as a loader, and that composition is first-wins in LIST
// order rather than in the order the origins happened to resolve.

import { describe, expect, test } from 'bun:test';
import {
  FONT_RESOLVER_BRAND,
  FONT_RESOLVER_MARK_KEY,
  composeFontOrigins,
  composePreparedFontOrigins,
  defineFontResolver,
  isFontResolver,
} from '../font-resolver.ts';
import type { FontOrigin, FontOriginCompositionRequest } from '../font-resolver.ts';
import type { FontConfigurationFragment, FontResolutionRequest } from '../font-composition.ts';
import type { FontSource } from '@docx-editor.dev/core/contracts/editor';
import { prepareLayoutFontConfiguration } from '../../layout/layout-shaping.ts';
import { HARD_MAX_FONT_SOURCES } from '../../layout/font-resource.ts';

const REQUEST: FontResolutionRequest = {
  families: ['Calibri', 'Montserrat'],
  defaultFamily: 'Calibri',
};

test('partial font failures are bounded snapshots and do not discard usable sources', async () => {
  const cause = new Error('Missing bold face');
  const failures = Array.from({ length: HARD_MAX_FONT_SOURCES + 2 }, () => cause);
  const reports: unknown[] = [];
  const fragment = { sources: [source('Calibri', 'available')], failures };
  const merged = await composeFontOrigins([fragment], REQUEST, {
    onOriginFailure: ({ cause }) => {
      reports.push(cause);
      failures.length = 0;
    },
  });
  expect(merged?.sources?.map(({ id }) => id)).toEqual(['available']);
  expect(reports).toHaveLength(2); // One unique cause plus the truncation diagnostic.
  expect(reports[0]).toBe(cause);
  expect(merged?.failures).toHaveLength(HARD_MAX_FONT_SOURCES + 1);
});

test('a reported font failure has its stack formatted before anyone keeps it', async () => {
  // An unread stack keeps every frame's closure alive, and those reach the document. A
  // report that outlives the export, such as a PDF result's font resolution, kept it all.
  const cause = new Error('Missing bold face');
  const stack = cause.stack;
  let reads = 0;
  Object.defineProperty(cause, 'stack', {
    get: () => {
      reads += 1;
      return stack;
    },
  });
  let readsAtReport = -1;
  await composeFontOrigins([{ sources: [], failures: [cause] }], REQUEST, {
    onOriginFailure: () => {
      readsAtReport = reads;
    },
  });
  expect(readsAtReport).toBeGreaterThan(0);
});

test('concurrent font compositions keep partial failure reports independent', async () => {
  const first = new Error('First export'),
    second = new Error('Second export');
  const results = await Promise.all(
    [first, second].map(async (cause) => {
      const reports: unknown[] = [];
      await composeFontOrigins([Promise.resolve({ sources: [], failures: [cause] })], REQUEST, {
        onOriginFailure: ({ cause }) => reports.push(cause),
      });
      return reports;
    })
  );
  expect(results).toEqual([[first], [second]]);
});

function source(family: string, id: string): FontSource {
  return {
    request: { family, weight: 400, style: 'normal' },
    id,
    bytes: new Uint8Array([0]),
    hash: `sha256:${id}`,
    faceIndex: 0,
  };
}

describe('the resolver mark', () => {
  test('a marked function is a resolver and stays the same object', () => {
    const inner = async () => ({ sources: [] });
    const marked = defineFontResolver(inner);

    expect(marked).toBe(inner);
    expect(isFontResolver(marked)).toBe(true);
  });

  test('an unmarked function reads as a loader, which is the safe way to be wrong', () => {
    expect(isFontResolver(async () => ({ sources: [] }))).toBe(false);
    expect(isFontResolver({ sources: [] })).toBe(false);
    expect(isFontResolver(undefined)).toBe(false);
  });

  test('the mark is invisible to enumeration and to the spread a host might write', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));

    // Both halves, both non-enumerable. `Object.keys` alone would pass on a symbol-only
    // mark whatever its descriptor said, so the spread check is what carries the symbol
    // half and `Object.keys` carries the string half.
    expect(Object.getOwnPropertySymbols({ ...marked })).not.toContain(FONT_RESOLVER_BRAND);
    expect(Object.keys(marked)).toEqual([]);
    expect(Object.keys({ ...marked })).toEqual([]);
  });

  test('both halves of the mark are really set, so the TYPE is not lying', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));

    expect((marked as unknown as Record<symbol, unknown>)[FONT_RESOLVER_BRAND]).toBe(true);
    // The string half is what `MarkedFontResolver` claims in the type and what lets
    // `@docx-editor.dev/fonts` declare the same mark without importing from the engine.
    expect(marked[FONT_RESOLVER_MARK_KEY]).toBe(true);
    expect(FONT_RESOLVER_MARK_KEY).toBe('docx-editor.dev/font-resolver');
  });

  test('refuses a frozen function rather than returning it unmarked', () => {
    const frozen = Object.freeze(async () => ({ sources: [] }));

    // The return TYPE says marked. Handing back an unmarked function would compile and
    // then lose every font at the first `useDocxSource` call.
    expect(() => defineFontResolver(frozen)).toThrow(TypeError);
    expect(isFontResolver(frozen)).toBe(false);
  });

  test('the mark does not survive .bind() or a wrapper, which the docs say', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));

    expect(isFontResolver(marked.bind(null))).toBe(false);
    expect(isFontResolver((request: FontResolutionRequest) => marked(request))).toBe(false);
    // Re-marking the new object is the documented fix.
    expect(isFontResolver(defineFontResolver(marked.bind(null)))).toBe(true);
  });

  test('the mark is the registered symbol, so a second module copy still reads it', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));
    const rediscovered = Symbol.for('docx-editor.dev/font-resolver');

    expect(rediscovered).toBe(FONT_RESOLVER_BRAND);
    expect((marked as unknown as Record<symbol, unknown>)[rediscovered]).toBe(true);
  });
});

describe('composeFontOrigins', () => {
  test('passes the first origin default family to later missing-face resolvers', async () => {
    let request: FontResolutionRequest | undefined;
    const fallback = defineFontResolver((next: FontResolutionRequest) => {
      request = next;
      return undefined;
    });

    await composeFontOrigins(
      [
        {
          defaultFont: { family: 'Aptos', sizeHalfPoints: 22 },
          epoch: 7,
          maxFontBytes: 1_000_000,
          sources: [],
        },
        fallback,
      ],
      REQUEST
    );

    expect(request?.defaultFamily).toBe('Aptos');
  });

  test('one invalid face drops alone and is reported; its origin siblings still compose', async () => {
    const failures: unknown[] = [];
    const oversized: FontSource = {
      ...source('Bloated', 'oversized'),
      bytes: new Uint8Array(64),
    };
    const composed = await composeFontOrigins(
      [
        {
          maxFontBytes: 16,
          sources: [source('Calibri', 'kept-a'), oversized, source('Montserrat', 'kept-b')],
        },
      ],
      REQUEST,
      { onOriginFailure: (failure) => failures.push(failure.cause) }
    );

    expect(composed?.sources?.map((entry) => entry.id)).toEqual(['kept-a', 'kept-b']);
    expect(failures).toHaveLength(1);
    expect(String(failures[0])).toContain('byte ceiling');
  });

  test('merges first-wins in LIST order, however long an origin takes to answer', async () => {
    const slowFirst = defineFontResolver(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { sources: [source('Calibri', 'first')] };
    });
    const fastSecond: FontOrigin = { sources: [source('Calibri', 'second')] };

    // Both cover the same face, so exactly one of them can appear and which one is the
    // whole precedence rule. Reversed, the same two origins must give the other answer —
    // an implementation that merged in some other order would pass one of these and fail
    // the other.
    expect(
      (await composeFontOrigins([slowFirst, fastSecond], REQUEST))?.sources?.map((e) => e.id)
    ).toEqual(['first']);
    expect(
      (await composeFontOrigins([fastSecond, slowFirst], REQUEST))?.sources?.map((e) => e.id)
    ).toEqual(['second']);
  });

  const faceNames = (request: FontResolutionRequest | undefined) =>
    [...(request?.resolvedFaces ?? [])]
      .map((face) => `${face.family}/${face.weight}/${face.style}`)
      .sort();

  test('reports the faces an earlier origin can paint, by BOTH names', async () => {
    const seen: FontResolutionRequest[] = [];
    const first = defineFontResolver(async () => ({
      // What a substitute package answers: bytes under the face it loaded, plus the map
      // from the name the document wrote.
      sources: [source('Carlito', 'packaged')],
      substitutions: [
        {
          from: { family: 'Calibri', weight: 400, style: 'normal' as const },
          to: { family: 'Carlito', weight: 400, style: 'normal' as const },
        },
      ],
    }));
    const second = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [] };
    });

    await composeFontOrigins([first, second], REQUEST);

    expect(seen).toHaveLength(1);
    expect(faceNames(seen[0])).toEqual(['Calibri/400/normal', 'Carlito/400/normal']);
    // Everything else about the request is untouched.
    expect(seen[0]!.families).toBe(REQUEST.families);
    expect(seen[0]!.defaultFamily).toBe(REQUEST.defaultFamily);
    expect((seen[0] as FontOriginCompositionRequest).committedSourceBytes).toBe(1);
  });

  test('reports FACES, not families: two faces of one family are two entries', async () => {
    const seen: FontResolutionRequest[] = [];
    // The brand fragment the `useFonts(brandFragment, packagedFonts())` shape produces:
    // some Arial, not all of it. Keyed on family, the two collapsed into one entry saying
    // "Arial", and a packaged origin reading that supplied no italics at all.
    // Three of Arial's four faces, chosen so that dropping ANY limb of the key collapses
    // them: family alone gives one entry, family+weight gives two (400 and 700),
    // family+style gives two (normal and italic). Only all three give three.
    const brand = {
      sources: [
        { ...source('Arial', 'brand-regular') },
        {
          ...source('Arial', 'brand-bold'),
          request: { family: 'Arial', weight: 700, style: 'normal' as const },
        },
        {
          ...source('Arial', 'brand-italic'),
          request: { family: 'Arial', weight: 400, style: 'italic' as const },
        },
      ],
    };
    const second = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [] };
    });

    await composeFontOrigins([brand, second], REQUEST);

    // Bold-italic is the face the brand does NOT hold, and its absence is what lets the
    // origin behind it supply one.
    expect(faceNames(seen[0])).toEqual([
      'Arial/400/italic',
      'Arial/400/normal',
      'Arial/700/normal',
    ]);
  });

  test('reports only faces with BYTES, so a failed origin cannot suppress its failover', async () => {
    const seen: FontResolutionRequest[] = [];
    // Exactly what `packagedFonts()` answers when every asset fetch fails: the whole
    // substitution map, and no sources at all. Both shipped resolvers build the map before
    // fetching, so trusting substitutions alone lost the failover the list exists for.
    const failed = defineFontResolver(async () => ({
      sources: [],
      substitutions: [400, 700].map((weight) => ({
        from: { family: 'Calibri', weight, style: 'normal' as const },
        to: { family: 'Carlito', weight, style: 'normal' as const },
      })),
    }));
    const failover = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [source('Carlito', 'failover')] };
    });

    const merged = await composeFontOrigins([failed, failover], REQUEST);

    // ASKED, and asked about everything. `faceNames(undefined)` is also `[]`, so asserting
    // the list alone would have passed just as well had the failover never been called —
    // which is the outcome this test exists to rule out.
    expect(seen).toHaveLength(1);
    expect(faceNames(seen[0])).toEqual([]);
    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['failover']);
  });

  test('a substitution becomes reportable once a LATER origin supplies its target', async () => {
    const seen: FontResolutionRequest[] = [];
    const mapOnly = defineFontResolver(async () => ({
      substitutions: [
        {
          from: { family: 'Calibri', weight: 400, style: 'normal' as const },
          to: { family: 'Carlito', weight: 400, style: 'normal' as const },
        },
      ],
    }));
    const bytes = defineFontResolver(async () => ({ sources: [source('Carlito', 'bytes')] }));
    const third = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return undefined;
    });

    await composeFontOrigins([mapOnly, bytes, third], REQUEST);

    // Calibri was unpaintable when origin 2 was asked and paintable by the time origin 3
    // was, which is why coverage is recomputed per origin rather than accumulated.
    expect(faceNames(seen[0])).toEqual(['Calibri/400/normal', 'Carlito/400/normal']);
  });

  test('the FIRST origin is asked the request as it came, with nothing marked resolved', async () => {
    const seen: FontResolutionRequest[] = [];
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return undefined;
    });

    await composeFontOrigins([record], REQUEST);

    expect(seen).toEqual([REQUEST]);
    expect(seen[0]!.resolvedFaces).toBeUndefined();
  });

  test('an origin that answered nothing does not narrow the next one', async () => {
    const seen: FontResolutionRequest[] = [];
    const empty = defineFontResolver(async () => undefined);
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [] };
    });

    await composeFontOrigins([empty, record], REQUEST);

    expect(seen[0]!.resolvedFaces).toBeUndefined();
    expect((seen[0] as FontOriginCompositionRequest).committedSourceBytes).toBeUndefined();
  });

  test('tells later origins the bytes earlier origins already committed', async () => {
    const seen: FontOriginCompositionRequest[] = [];
    const first = defineFontResolver(async () => ({
      sources: [
        { ...source('Calibri', 'first-a'), bytes: new Uint8Array([1, 2, 3]) },
        { ...source('Arial', 'first-b'), bytes: new Uint8Array([4, 5]) },
      ],
    }));
    const second = defineFontResolver(async (request: FontOriginCompositionRequest) => {
      seen.push(request);
      return { sources: [source('Georgia', 'second')] };
    });
    const third = defineFontResolver(async (request: FontOriginCompositionRequest) => {
      seen.push(request);
      return undefined;
    });

    await composeFontOrigins([first, second, third], REQUEST);

    expect(seen[0]!.committedSourceBytes).toBe(5);
    expect(faceNames(seen[0])).toEqual(['Arial/400/normal', 'Calibri/400/normal']);
    expect(seen[1]!.committedSourceBytes).toBe(6);
    expect(seen[1]!.families).toBe(REQUEST.families);
  });

  test('an aborting origin never starts a later fallback', async () => {
    const controller = new AbortController();
    let fallbackCalls = 0;
    const first = defineFontResolver(
      (request: FontResolutionRequest) =>
        new Promise<undefined>((_resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(request.signal?.reason ?? new Error('aborted')),
            { once: true }
          );
        })
    );
    const fallback = defineFontResolver(() => {
      fallbackCalls += 1;
      return { sources: [source('Calibri', 'too-late')] };
    });
    const pending = composeFontOrigins([first, fallback], {
      ...REQUEST,
      signal: controller.signal,
    });
    controller.abort('host-stop');

    await expect(pending).rejects.toBe('host-stop');
    expect(fallbackCalls).toBe(0);
  });

  test('calls a function origin again on the NEXT composition, never caching its answer', async () => {
    let calls = 0;
    const perLoad = defineFontResolver(async () => {
      calls += 1;
      return { sources: [source('Calibri', `call-${calls}`)] };
    });

    // Once per document, and the answer belongs to THAT document. A cached answer would
    // serve the first file's fonts to every file after it — and it is this, not anything
    // in the adapters, that makes a plain-function getter re-read per resolve.
    const first = await composeFontOrigins([perLoad], REQUEST);
    const second = await composeFontOrigins([perLoad], REQUEST);

    expect(calls).toBe(2);
    expect(first?.sources?.map((entry) => entry.id)).toEqual(['call-1']);
    expect(second?.sources?.map((entry) => entry.id)).toEqual(['call-2']);
  });

  test('passes through the coverage IT was told about', async () => {
    const seen: FontResolutionRequest[] = [];
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [source('Cambria', 'inner')] };
    });

    // The shape a `useFonts` result used as an origin of another list produces: an inner
    // composition handed a request that already carries coverage. Replacing rather than
    // merging made every inner origin from the second on under-report, and refetch.
    await composeFontOrigins([{ sources: [source('Calibri', 'first')] }, record], {
      ...REQUEST,
      resolvedFaces: [{ family: 'Georgia', weight: 400, style: 'normal' }],
    });

    expect(faceNames(seen[0])).toEqual(['Calibri/400/normal', 'Georgia/400/normal']);
  });

  test('an origin answering null is skipped, not fatal to the ones around it', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    let merged: Awaited<ReturnType<typeof composeFontOrigins>>;
    try {
      // `null`, not `undefined`. "Returning nothing is a valid answer" reads as `null` to
      // plenty of hosts, and `null.sources` took every other origin down with it.
      const nullish = defineFontResolver(async () => null as never);
      merged = await composeFontOrigins(
        [
          { sources: [source('Calibri', 'before')] },
          nullish,
          { sources: [source('Cambria', 'after')] },
        ],
        REQUEST
      );
    } finally {
      console.warn = warn;
    }

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['before', 'after']);
    // A valid "I cover none of this", not a failure: nothing to report.
    expect(warnings).toHaveLength(0);
  });

  test('an origin answering something malformed is skipped WHOLE', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    let merged: Awaited<ReturnType<typeof composeFontOrigins>>;
    try {
      // A source with no `request`: keying it throws. Committing the answer before reading
      // it would leave this fragment in the composition with its faces unrecorded, and
      // break `composeFontConfiguration` later, outside anyone's catch.
      const malformed = defineFontResolver(async () => ({ sources: [{} as never] }));
      merged = await composeFontOrigins(
        [
          { sources: [source('Calibri', 'before')] },
          malformed,
          { sources: [source('Cambria', 'after')] },
        ],
        REQUEST
      );
    } finally {
      console.warn = warn;
    }

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['before', 'after']);
    expect(warnings).toHaveLength(1);
  });

  test('malformed substitutions, requests, and defaults are isolated to their origin', async () => {
    const failures: Array<{ originIndex: number }> = [];
    const malformed = [
      { substitutions: [{} as never] },
      {
        sources: [
          {
            ...source('Bad', 'bad-request'),
            request: { family: ' ', weight: 0, style: 'oblique' as never },
          },
        ],
      },
      {
        sources: [source('Bad Default Source', 'bad-default')],
        defaultFont: { family: ' ', sizeHalfPoints: 0 },
      },
      { sources: [{ ...source('Bad Id', 'unused'), id: '' }] },
      {
        sources: [source('Bad Ceiling', 'bad-ceiling')],
        maxFontBytes: Number.MAX_SAFE_INTEGER,
      },
    ];
    const merged = await composeFontOrigins(
      [
        { sources: [source('Calibri', 'before')] },
        ...malformed,
        { sources: [source('Cambria', 'after')] },
      ],
      REQUEST,
      { onOriginFailure: (failure) => failures.push(failure) }
    );

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['before', 'after']);
    expect(failures.map((failure) => failure.originIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  test('rejects non-array origin collections without invoking hostile iterators', async () => {
    let iteratorCalls = 0;
    const hostile = {
      length: 1,
      [Symbol.iterator]() {
        iteratorCalls += 1;
        return {
          next: () => ({ done: false, value: source('Hostile', 'unbounded') }),
        };
      },
    };
    const failures: number[] = [];
    const merged = await composeFontOrigins(
      [
        { sources: hostile as never },
        { substitutions: hostile as never },
        { sources: [source('Calibri', 'safe-fallback')] },
      ],
      REQUEST,
      { onOriginFailure: ({ originIndex }) => failures.push(originIndex) }
    );

    expect(iteratorCalls).toBe(0);
    expect(failures).toEqual([0, 1]);
    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['safe-fallback']);
  });

  test('samples nested origin inputs before awaiting a later resolver', async () => {
    const mutableSource = source('Stable Family', 'stable-source');
    const mutableSubstitution = {
      from: { family: 'Alias', weight: 400, style: 'normal' as const },
      to: { family: 'Stable Family', weight: 400, style: 'normal' as const },
      lineMetrics: { heightEm: 1, baselineEm: 0.8 },
    };
    const later = defineFontResolver(async () => {
      mutableSource.request.family = 'Mutated Family';
      mutableSource.bytes[0] = 255;
      mutableSubstitution.from.family = 'Mutated Alias';
      mutableSubstitution.lineMetrics.heightEm = 3;
      return undefined;
    });
    const merged = await composeFontOrigins(
      [{ sources: [mutableSource], substitutions: [mutableSubstitution] }, later],
      REQUEST
    );

    expect(merged?.sources?.[0]?.request.family).toBe('Stable Family');
    expect(merged?.sources?.[0]?.bytes[0]).toBe(0);
    expect(merged?.substitutions?.[0]?.from.family).toBe('Alias');
    expect(merged?.substitutions?.[0]?.lineMetrics?.heightEm).toBe(1);
  });

  test('samples accessor-backed source fields once before budgeting and ownership', async () => {
    let availabilityReads = 0;
    let bytesReads = 0;
    let familyReads = 0;
    let hashReads = 0;
    let copies = 0;
    const accessorSource = {
      request: {
        get family() {
          familyReads += 1;
          return familyReads === 1 ? 'Stable Accessor' : 'Mutated Accessor';
        },
        weight: 400,
        style: 'normal' as const,
      },
      id: 'accessor-source',
      get bytes() {
        bytesReads += 1;
        return new Uint8Array(1024 * 1024);
      },
      get hash() {
        hashReads += 1;
        return hashReads === 1 ? 'sha256:stable' : '';
      },
      faceIndex: 0,
      get availability() {
        availabilityReads += 1;
        return availabilityReads === 1 ? ('forbidden' as const) : ('available' as const);
      },
    };
    const merged = await composePreparedFontOrigins([{ sources: [accessorSource] }], REQUEST, {
      instrumentation: {
        onOwnedByteCopy: () => {
          copies += 1;
        },
      },
    });

    expect(availabilityReads).toBe(1);
    expect(bytesReads).toBe(0);
    expect(familyReads).toBe(1);
    expect(hashReads).toBe(1);
    expect(copies).toBe(0);
    expect(merged?.sources?.[0]?.request.family).toBe('Stable Accessor');
    expect(merged?.sources?.[0]?.availability).toBe('forbidden');
  });

  test('already-rejected promise origins are observed before a slow earlier resolver settles', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const slow = defineFontResolver(
        () => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10))
      );
      const rejected = Promise.reject(new Error('early promise rejection'));
      const failures: Array<{ originIndex: number }> = [];
      const merged = await composeFontOrigins(
        [slow, rejected, { sources: [source('Cambria', 'after-promise')] }],
        REQUEST,
        { onOriginFailure: (failure) => failures.push(failure) }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(merged?.sources?.map((entry) => entry.id)).toEqual(['after-promise']);
      expect(failures.map((failure) => failure.originIndex)).toEqual([1]);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test('one throwing origin is reported and skipped; the others still compose', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const boom = defineFontResolver(() => {
        throw new Error('resolver called as a loader');
      });
      const merged = await composeFontOrigins(
        [
          { sources: [source('Calibri', 'before')] },
          boom,
          { sources: [source('Cambria', 'after')] },
        ],
        REQUEST
      );

      expect(merged?.sources?.map((entry) => entry.id)).toEqual(['before', 'after']);
    } finally {
      console.warn = warn;
    }
    // Reported, not swallowed: this is the failure mode an empty catch made undebuggable.
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('font origin failed');
  });

  test('observes rejected async origin-diagnostic callbacks without process rejection', async () => {
    const unhandled: unknown[] = [];
    const warnings: unknown[][] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    process.on('unhandledRejection', onUnhandled);
    try {
      const merged = await composeFontOrigins(
        [{ sources: [{} as never] }, { sources: [source('Calibri', 'after-diagnostic')] }],
        REQUEST,
        {
          onOriginFailure: async () => {
            throw new Error('async origin diagnostic failed');
          },
        }
      );
      expect(merged?.sources?.map((entry) => entry.id)).toEqual(['after-diagnostic']);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toHaveLength(0);
      expect(warnings).toHaveLength(1);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      console.warn = warn;
    }
  });

  test('carries NO epoch, so the engine stamps the load sequence', async () => {
    const merged = await composeFontOrigins([{ sources: [source('Calibri', 'one')] }], REQUEST);

    expect(merged).toBeDefined();
    expect('epoch' in (merged as object)).toBe(false);
  });

  test('an empty list, and a list that contributes nothing, both answer undefined', async () => {
    expect(await composeFontOrigins([], REQUEST)).toBeUndefined();
    expect(await composeFontOrigins([undefined, undefined], REQUEST)).toBeUndefined();
    expect(
      await composeFontOrigins([defineFontResolver(async () => undefined)], REQUEST)
    ).toBeUndefined();
  });

  test('composes rather than concatenates: a face supplied directly drops its stand-in', async () => {
    const direct: FontConfigurationFragment = { sources: [source('Calibri', 'real-calibri')] };
    const substituting: FontConfigurationFragment = {
      substitutions: [
        {
          from: { family: 'Calibri', weight: 400, style: 'normal' },
          to: { family: 'Carlito', weight: 400, style: 'normal' },
        },
      ],
    };

    // Either order: the drop rule is about the composition as a whole, not about which
    // origin was listed first. A concatenating implementation keeps the substitution and
    // the resource snapshot then consults it BEFORE the real bytes.
    for (const origins of [
      [direct, substituting],
      [substituting, direct],
    ]) {
      const merged = await composeFontOrigins(origins, REQUEST);
      expect(merged?.sources?.map((entry) => entry.id)).toEqual(['real-calibri']);
      expect(merged?.substitutions ?? []).toHaveLength(0);
    }
  });

  test('a promise origin resolves like any other', async () => {
    const merged = await composeFontOrigins(
      [Promise.resolve({ sources: [source('Cambria', 'awaited')] })],
      REQUEST
    );

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['awaited']);
  });

  test('prepares one owned winner when many origins repeat the same face', async () => {
    let copies = 0;
    let hashes = 0;
    const repeated = source('Calibri', 'same-face');
    const merged = await composePreparedFontOrigins(
      Array.from({ length: 100 }, () => ({ sources: [repeated] })),
      REQUEST,
      {
        instrumentation: {
          onOwnedByteCopy: () => {
            copies += 1;
          },
          onHash: () => {
            hashes += 1;
          },
        },
      }
    );

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['same-face']);
    expect(copies).toBe(1);
    expect(hashes).toBe(1);
  });

  test('reservation refusal escapes unchanged before copying or starting fallbacks', async () => {
    const refusal = new Error('process font-byte budget exhausted');
    let fallbackCalls = 0;
    let copies = 0;
    const fallback = defineFontResolver(() => {
      fallbackCalls += 1;
      return { sources: [source('Cambria', 'must-not-run')] };
    });

    await expect(
      composePreparedFontOrigins(
        [{ sources: [source('Calibri', 'reservation-candidate')] }, fallback],
        REQUEST,
        {
          reserveOwnedBytes: () => {
            throw refusal;
          },
          instrumentation: {
            onOwnedByteCopy: () => {
              copies += 1;
            },
          },
        }
      )
    ).rejects.toBe(refusal);
    expect(fallbackCalls).toBe(0);
    expect(copies).toBe(0);
  });

  test('isolates the origin that tips the cumulative source count', async () => {
    const makeSources = (prefix: string, count: number, offset = 0): FontSource[] =>
      Array.from({ length: count }, (_, index) =>
        source(`${prefix}-${index + offset}`, `${prefix}-${index + offset}`)
      );
    const failures: number[] = [];
    const merged = await composeFontOrigins(
      [{ sources: makeSources('first', 128) }, { sources: makeSources('second', 129) }],
      REQUEST,
      { onOriginFailure: ({ originIndex }) => failures.push(originIndex) }
    );

    expect(merged?.sources).toHaveLength(128);
    expect(failures).toEqual([1]);
  });

  test('uses the first base byte ceiling and skips only a later violating origin', async () => {
    const twoBytes = { ...source('Cambria', 'too-large'), bytes: new Uint8Array([0, 1]) };
    const failures: number[] = [];
    const merged = await composeFontOrigins(
      [
        { maxFontBytes: 1, sources: [source('Calibri', 'base')] },
        { maxFontBytes: 64, sources: [twoBytes] },
        { sources: [source('Arial', 'fallback')] },
      ],
      REQUEST,
      { onOriginFailure: ({ originIndex }) => failures.push(originIndex) }
    );

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['base', 'fallback']);
    expect(failures).toEqual([1]);
    expect(() => prepareLayoutFontConfiguration({ epoch: 0, ...merged! })).not.toThrow();

    const badBaseFailures: number[] = [];
    const recovered = await composeFontOrigins(
      [
        { maxFontBytes: 1, sources: [twoBytes] },
        { maxFontBytes: 2, sources: [twoBytes] },
      ],
      REQUEST,
      { onOriginFailure: ({ originIndex }) => badBaseFailures.push(originIndex) }
    );
    expect(badBaseFailures).toEqual([0]);
    expect(recovered?.sources?.map((entry) => entry.id)).toEqual(['too-large']);
    expect(() => prepareLayoutFontConfiguration({ epoch: 0, ...recovered! })).not.toThrow();
  });

  test('bounds substitutions across origins and credits a later direct source', async () => {
    const substitution = (name: string) => ({
      from: { family: name, weight: 400, style: 'normal' as const },
      to: { family: 'Calibri', weight: 400, style: 'normal' as const },
    });
    const first = Array.from({ length: 128 }, (_, index) => substitution(`First ${index}`));
    const tipping = Array.from({ length: 129 }, (_, index) => substitution(`Second ${index}`));
    const failures: number[] = [];
    const bounded = await composeFontOrigins(
      [{ substitutions: first }, { substitutions: tipping }],
      REQUEST,
      { onOriginFailure: ({ originIndex }) => failures.push(originIndex) }
    );
    expect(bounded?.substitutions).toHaveLength(128);
    expect(failures).toEqual([1]);

    const full = Array.from({ length: 256 }, (_, index) => substitution(`At Cap ${index}`));
    const credited = await composeFontOrigins(
      [
        { substitutions: full },
        {
          sources: [source('At Cap 0', 'direct-at-cap')],
          substitutions: [substitution('Replacement Slot')],
        },
      ],
      REQUEST
    );
    expect(credited?.sources).toHaveLength(1);
    expect(credited?.substitutions).toHaveLength(256);
    expect(credited?.substitutions?.some((entry) => entry.from.family === 'At Cap 0')).toBe(false);
    expect(credited?.substitutions?.some((entry) => entry.from.family === 'Replacement Slot')).toBe(
      true
    );
  });
});
