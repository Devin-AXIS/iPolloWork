// The two font paths `useDocxSource` offers, and the uniform origin list `useFonts` takes.
//
// The distinction that matters to a reader is whether the DOCUMENT WAITS. An eager origin
// is complete before the file is parsed, so the bytes are held back and the document
// paginates once. An on-demand resolver is answered with the families the file declares,
// which nothing knows until the parse, so holding the bytes back would wait on work only
// the bytes can start — it is released at once and the engine re-paginates when the faces
// land. Both are asserted here, because "still holds" is the promise the hook's own docs
// make and a silent regression to "never waits" looks like nothing at all.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { defineFontResolver, isFontResolver } from '@docx-editor.dev/core/editor';
import type { FontResolutionRequest } from '@docx-editor.dev/core/editor';
import type { FontSource } from '@docx-editor.dev/core/contracts/editor';
import { useDocxSource } from '../src/editor/useDocxSource.ts';
import { useFonts, type FontsInput } from '../src/editor/useFonts.ts';
import type { FontResolver } from '@docx-editor.dev/core/editor';

afterEach(cleanup);

const BYTES = new Uint8Array([1, 2, 3]);

const REQUEST: FontResolutionRequest = { families: ['Calibri'], defaultFamily: 'Calibri' };

function source(family: string, id: string): FontSource {
  return {
    request: { family, weight: 400, style: 'normal' },
    id,
    bytes: new Uint8Array([0]),
    hash: `sha256:${id}`,
    faceIndex: 0,
  };
}

/** A deferred so a test can decide exactly when the eager loader settles. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useDocxSource: the eager path still holds the document', () => {
  test('document stays undefined until a zero-argument loader settles', async () => {
    const gate = deferred<{ sources: FontSource[] }>();
    const seen: (Uint8Array | undefined)[] = [];
    let loading = true;

    function Probe() {
      const result = useDocxSource(BYTES, { fonts: () => gate.promise });
      seen.push(result.document);
      loading = result.isLoading;
      return null;
    }
    render(<Probe />);
    await flush();

    // Before the loader settles: bytes are in hand and deliberately withheld.
    expect(seen.at(-1)).toBeUndefined();
    expect(loading).toBe(true);

    await act(async () => {
      gate.resolve({ sources: [source('Calibri', 'eager')] });
      await gate.promise;
    });
    await flush();

    expect(seen.at(-1)).toBe(BYTES);
    expect(loading).toBe(false);
  });

  test('a failing loader releases the document instead of holding it forever', async () => {
    let document: Uint8Array | undefined;

    function Probe() {
      document = useDocxSource(BYTES, {
        fonts: () => Promise.reject(new Error('no faces today')),
      }).document;
      return null;
    }
    render(<Probe />);
    await flush();

    expect(document).toBe(BYTES);
  });

  test('a list of eager origins composes first-wins', async () => {
    let fonts: unknown;

    function Probe() {
      fonts = useDocxSource(BYTES, {
        fonts: [
          { sources: [source('Calibri', 'first')] },
          { sources: [source('Calibri', 'last')] },
        ],
      }).fonts;
      return null;
    }
    render(<Probe />);
    await flush();

    expect((fonts as { sources: FontSource[] }).sources.map((entry) => entry.id)).toEqual([
      'first',
    ]);
  });
});

describe('useDocxSource: the on-demand path cannot wait, and does not pretend to', () => {
  test('an on-demand origin costs the document no renders at all', async () => {
    // The control: no `fonts` option, so nothing is waited for. Whatever render the
    // document appears on here is the floor.
    const renderOf = async (options: Parameters<typeof useDocxSource>[1]) => {
      const seen: boolean[] = [];
      let result!: ReturnType<typeof useDocxSource>;
      function Probe() {
        result = useDocxSource(BYTES, options);
        // Recorded DURING render, so an extra state round trip is visible as an extra
        // render before the document appears.
        seen.push(result.document !== undefined);
        return null;
      }
      render(<Probe />);
      await flush();
      return { firstReleased: seen.indexOf(true), fonts: result.fonts };
    };

    const control = await renderOf({});
    cleanup();
    const onDemand = await renderOf({
      fonts: defineFontResolver(async () => ({ sources: [source('Calibri', 'lazy')] })),
    });

    expect(control.firstReleased).toBeGreaterThanOrEqual(0);
    // Not "eventually the same" — the SAME render. Holding the bytes for a resolver that
    // cannot answer until after the parse costs a frame of loading screen for nothing.
    expect(onDemand.firstReleased).toBe(control.firstReleased);
    expect(typeof onDemand.fonts).toBe('function');
  });

  test('the resolver keeps ONE identity even when the origins are written inline', async () => {
    const identities = new Set<unknown>();

    function Probe({ tick }: { tick: number }) {
      // A fresh resolver object on every render, which is what an inline
      // `{ fonts: packagedFonts() }` produces.
      const { fonts } = useDocxSource(BYTES, {
        fonts: defineFontResolver(async () => ({ sources: [source('Calibri', `r${tick}`)] })),
      });
      identities.add(fonts);
      return null;
    }
    const view = render(<Probe tick={0} />);
    view.rerender(<Probe tick={1} />);
    view.rerender(<Probe tick={2} />);

    expect(identities.size).toBe(1);
  });

  test('the stable resolver delegates to the LATEST origins, not the first render', async () => {
    let resolve!: (request: FontResolutionRequest) => unknown;

    function Probe({ tick }: { tick: number }) {
      const { fonts } = useDocxSource(BYTES, {
        fonts: defineFontResolver(async () => ({ sources: [source('Calibri', `r${tick}`)] })),
      });
      resolve = fonts as (request: FontResolutionRequest) => unknown;
      return null;
    }
    const view = render(<Probe tick={0} />);
    view.rerender(<Probe tick={7} />);

    const merged = (await resolve(REQUEST)) as { sources: FontSource[] };
    expect(merged.sources.map((entry) => entry.id)).toEqual(['r7']);
  });

  test('one resolver in a list is enough to make the whole list on demand', async () => {
    let result!: ReturnType<typeof useDocxSource>;

    function Probe() {
      result = useDocxSource(BYTES, {
        fonts: [
          { sources: [source('Cambria', 'brand')] },
          defineFontResolver(async () => ({ sources: [source('Calibri', 'lazy')] })),
        ],
      });
      return null;
    }
    render(<Probe />);

    expect(result.document).toBe(BYTES);
    const merged = (await (result.fonts as (r: FontResolutionRequest) => Promise<unknown>)(
      REQUEST
    )) as { sources: FontSource[] };
    expect(merged.sources.map((entry) => entry.id)).toEqual(['brand', 'lazy']);
  });
});

describe('useFonts keeps every call shape that compiled before the mark existed', () => {
  // Compile-time half. `FontsInput` and the first argument both still take a BARE
  // resolver: adding the mark narrowed them, and a host with a hand-written resolver that
  // worked would have had to change source for a type that never protected it — the first
  // position has never accepted a loader, so there was nothing to disambiguate there.
  const _aliasStillTakesBareResolver: FontsInput = (() => undefined) as unknown as FontResolver;
  void _aliasStillTakesBareResolver;

  test('an UNMARKED resolver in the first position is called with the full request', async () => {
    const seen: FontResolutionRequest[] = [];
    // No `defineFontResolver`, exactly as a host would have written it before.
    const unmarked = (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [source(request.defaultFamily, 'unmarked')] };
    };
    let compose!: unknown;

    function Probe() {
      compose = useFonts(unmarked, { sources: [source('Cambria', 'fragment')] });
      return null;
    }
    render(<Probe />);

    const merged = (await (compose as (r: FontResolutionRequest) => Promise<unknown>)(REQUEST)) as {
      sources: FontSource[];
    };
    expect(seen).toEqual([REQUEST]);
    expect(merged.sources.map((entry) => entry.id)).toEqual(['unmarked', 'fragment']);
  });

  // The twin of the Vue table. Both adapters treat every function origin as a value, so
  // the two shapes that report `length === 0` behave here exactly as they do there —
  // there is no arity test left in either to diverge on.
  const unmarkedShapes: readonly [string, (request: FontResolutionRequest) => unknown][] = [
    ['one declared argument', (request) => ({ sources: [source(request.defaultFamily, 'r')] })],
    [
      'a defaulted argument, length 0',
      ((request = { families: [], defaultFamily: 'Fallback' }) => ({
        sources: [source(request.defaultFamily, 'r')],
      })) as (request: FontResolutionRequest) => unknown,
    ],
    [
      'rest arguments, length 0',
      ((...args: FontResolutionRequest[]) => ({
        sources: [source(args[0]!.defaultFamily, 'r')],
      })) as (request: FontResolutionRequest) => unknown,
    ],
  ];

  for (const [shape, unmarked] of unmarkedShapes) {
    test(`an unmarked resolver is a value, never a getter — ${shape}`, async () => {
      let compose!: unknown;
      function Probe() {
        compose = useFonts(unmarked as never);
        return null;
      }
      render(<Probe />);

      const merged = (await (compose as (r: FontResolutionRequest) => Promise<unknown>)(
        REQUEST
      )) as { sources: FontSource[] };
      expect(merged.sources.map((entry) => entry.request.family)).toEqual(['Calibri']);
    });
  }
});

describe('useFonts takes every origin in the same shape', () => {
  test('a resolver composes with a fragment in either position', async () => {
    let first!: unknown;
    let second!: unknown;

    function Probe() {
      const resolver = defineFontResolver(async () => ({ sources: [source('Calibri', 'lazy')] }));
      const fragment = { sources: [source('Cambria', 'brand')] };
      first = useFonts(resolver, fragment);
      second = useFonts(fragment, resolver);
      return null;
    }
    render(<Probe />);

    const one = (await (first as (r: FontResolutionRequest) => Promise<unknown>)(REQUEST)) as {
      sources: FontSource[];
    };
    const two = (await (second as (r: FontResolutionRequest) => Promise<unknown>)(REQUEST)) as {
      sources: FontSource[];
    };
    expect(one.sources.map((entry) => entry.id)).toEqual(['lazy', 'brand']);
    expect(two.sources.map((entry) => entry.id)).toEqual(['brand', 'lazy']);
  });

  test('two resolvers compose, which is the packaged-plus-Google shape', async () => {
    let resolve!: unknown;

    function Probe() {
      resolve = useFonts(
        defineFontResolver(async () => ({ sources: [source('Calibri', 'packaged')] })),
        defineFontResolver(async () => ({ sources: [source('Montserrat', 'google')] }))
      );
      return null;
    }
    render(<Probe />);

    const merged = (await (resolve as (r: FontResolutionRequest) => Promise<unknown>)(REQUEST)) as {
      sources: FontSource[];
    };
    expect(merged.sources.map((entry) => entry.id)).toEqual(['packaged', 'google']);
  });

  test('the result is MARKED, so it can be an origin of another list', async () => {
    let composed!: unknown;
    let nested!: unknown;

    function Probe() {
      composed = useFonts(defineFontResolver(async () => ({ sources: [source('Calibri', 'a')] })));
      // Unmarked, `useDocxSource` would call this with no argument and lose every font.
      nested = useDocxSource(BYTES, { fonts: composed as never }).fonts;
      return null;
    }
    render(<Probe />);

    expect(isFontResolver(composed)).toBe(true);
    // Taken as a resolver, not as a loader: the on-demand path returns a function.
    expect(typeof nested).toBe('function');
    const merged = (await (nested as (r: FontResolutionRequest) => Promise<unknown>)(REQUEST)) as {
      sources: FontSource[];
    };
    expect(merged.sources.map((entry) => entry.id)).toEqual(['a']);
  });

  test('switching from no fonts to a resolver actually resolves them', async () => {
    let result!: ReturnType<typeof useDocxSource>;

    function Probe({ ready }: { ready: boolean }) {
      // The shape a host writes when its origins depend on something else being loaded.
      result = useDocxSource(BYTES, {
        ...(ready
          ? { fonts: defineFontResolver(async () => ({ sources: [source('Calibri', 'late')] })) }
          : {}),
      });
      return null;
    }
    const view = render(<Probe ready={false} />);
    await flush();
    expect(result.fonts).toBeUndefined();

    view.rerender(<Probe ready />);
    await flush();

    // Latched at mount, this stayed undefined forever and the document never got fonts.
    expect(typeof result.fonts).toBe('function');
    expect(result.document).toBe(BYTES);
  });

  test('a LOADER in an on-demand list is still called with no argument', async () => {
    let sawArguments: unknown;
    let result!: ReturnType<typeof useDocxSource>;

    function Probe() {
      result = useDocxSource(BYTES, {
        fonts: [
          // Unmarked and zero-argument: the older loader form, sharing a list with a
          // resolver. Handed the request instead, `defaultFonts` would silently change
          // from "all 20 eager faces" to "the ones this document names".
          (...args: unknown[]) => {
            sawArguments = args;
            return { sources: [source('Cambria', 'loader')] };
          },
          defineFontResolver(async () => ({ sources: [source('Calibri', 'resolver')] })),
        ] as never,
      });
      return null;
    }
    render(<Probe />);

    const merged = (await (result.fonts as (r: FontResolutionRequest) => Promise<unknown>)(
      REQUEST
    )) as { sources: FontSource[] };
    expect(sawArguments).toEqual([]);
    expect(merged.sources.map((entry) => entry.id)).toEqual(['loader', 'resolver']);
  });

  test('one rejecting eager origin does not discard the others', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    let result!: ReturnType<typeof useDocxSource>;
    try {
      function Probe() {
        result = useDocxSource(BYTES, {
          fonts: [
            { sources: [source('Calibri', 'before')] },
            () => Promise.reject(new Error('boom')),
            { sources: [source('Cambria', 'after')] },
          ],
        });
        return null;
      }
      render(<Probe />);
      await flush();
    } finally {
      console.warn = warn;
    }

    // `Promise.all` rejected wholesale here and left the document with no fonts at all.
    expect((result.fonts as { sources: FontSource[] }).sources.map((e) => e.id)).toEqual([
      'before',
      'after',
    ]);
    expect(warnings).toHaveLength(1);
  });

  test('switching from no fonts to an eager LOADER resolves them too', async () => {
    let result!: ReturnType<typeof useDocxSource>;

    function Probe({ ready }: { ready: boolean }) {
      // The same host shape as the resolver case, with the older loader form. Keyed on
      // "is it on demand" alone, this stayed false on both renders and never re-ran.
      result = useDocxSource(BYTES, {
        ...(ready ? { fonts: () => ({ sources: [source('Calibri', 'late-eager')] }) } : {}),
      });
      return null;
    }
    const view = render(<Probe ready={false} />);
    await flush();
    expect(result.fonts).toBeUndefined();

    view.rerender(<Probe ready />);
    await flush();

    expect((result.fonts as { sources: FontSource[] }).sources.map((e) => e.id)).toEqual([
      'late-eager',
    ]);
  });

  test('removing the fonts option clears the composed configuration', async () => {
    let result!: ReturnType<typeof useDocxSource>;

    function Probe({ withFonts }: { withFonts: boolean }) {
      result = useDocxSource(BYTES, {
        ...(withFonts ? { fonts: () => ({ sources: [source('Calibri', 'gone')] }) } : {}),
      });
      return null;
    }
    const view = render(<Probe withFonts />);
    await flush();
    expect((result.fonts as { sources: FontSource[] }).sources).toHaveLength(1);

    view.rerender(<Probe withFonts={false} />);
    await flush();

    // Left standing, the editor would keep measuring with fonts the host has stopped
    // asking for. The Vue twin has always cleared it.
    expect(result.fonts).toBeUndefined();
  });

  test('a throwing eager loader is reported, not swallowed', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      function Probe() {
        useDocxSource(BYTES, { fonts: () => Promise.reject(new Error('boom')) });
        return null;
      }
      render(<Probe />);
      await flush();
    } finally {
      console.warn = warn;
    }

    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('font loading failed');
  });

  test('the returned resolver never changes identity', () => {
    const identities = new Set<unknown>();

    function Probe({ tick }: { tick: number }) {
      identities.add(useFonts({ sources: [source('Calibri', `r${tick}`)] }));
      return null;
    }
    const view = render(<Probe tick={0} />);
    view.rerender(<Probe tick={1} />);

    expect(identities.size).toBe(1);
  });
});
