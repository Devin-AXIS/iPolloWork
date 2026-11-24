// `useFonts` — one stable `fonts` prop out of origins that change identity every render.
//
// The trap this exists to close: `DocxEditor.Root` replaces its fonts on every `fonts`
// identity change, so `fonts={googleFonts()}` (a new function per render) would resolve
// and lay out the fonts again on every render. These pin the two halves of the fix — the identity never moves, and the
// arguments are still re-read when a resolution actually happens.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { FontResolver } from '@docx-editor.dev/core/editor';
import { useFonts } from '../src/editor/useFonts.ts';

afterEach(cleanup);

const REQUEST = { families: ['Garamond'] as readonly string[], defaultFamily: 'Calibri' };

const source = (family: string) => ({
  sources: [
    {
      request: { family, weight: 400, style: 'normal' as const },
      id: `test:${family}`,
      bytes: new Uint8Array([0, 1, 0, 0]),
      hash: `sha256:${family}`,
      faceIndex: 0,
    },
  ],
});

/** Renders the hook, exposing every value it returned across renders. */
function harness(initial: Parameters<typeof useFonts>[0]) {
  const returned: FontResolver[] = [];
  let setInput: (next: Parameters<typeof useFonts>[0]) => void = () => {};
  function Probe() {
    // Boxed: a resolver IS a function, which bare `useState` would take for a lazy
    // initializer (and `set` for an updater).
    const [input, set] = useState(() => initial);
    setInput = (next) => set(() => next);
    returned.push(useFonts(input));
    return null;
  }
  render(<Probe />);
  return { returned, setInput: (next: Parameters<typeof useFonts>[0]) => setInput(next) };
}

describe('useFonts', () => {
  test('identity never moves, even as the origin does', () => {
    const { returned, setInput } = harness(source('A'));
    act(() => setInput(source('B')));
    act(() => setInput(source('C')));
    expect(returned.length).toBeGreaterThan(2);
    expect(new Set(returned).size).toBe(1);
  });

  test('resolves against the LATEST origin, not the one captured at mount', async () => {
    const { returned, setInput } = harness(source('A'));
    const resolver = returned[0]!;
    act(() => setInput(source('B')));
    const resolved = await resolver(REQUEST);
    expect(resolved?.sources?.[0]?.request.family).toBe('B');
  });

  test('an on-demand origin is called with the request and its answer is passed through', async () => {
    const seen: string[][] = [];
    const { returned } = harness((request) => {
      seen.push([...request.families]);
      return source('OnDemand');
    });
    const resolved = await returned[0]!(REQUEST);
    expect(seen).toEqual([['Garamond']]);
    expect(resolved?.sources?.[0]?.request.family).toBe('OnDemand');
  });

  test('a promise origin is awaited', async () => {
    const { returned } = harness(Promise.resolve(source('Awaited')));
    const resolved = await returned[0]!(REQUEST);
    expect(resolved?.sources?.[0]?.request.family).toBe('Awaited');
  });

  test('origins compose first-wins, in argument order', async () => {
    let resolver: FontResolver | null = null;
    function Probe() {
      resolver = useFonts(source('First'), source('Second'));
      return null;
    }
    render(<Probe />);
    const resolved = await resolver!(REQUEST);
    expect(resolved?.sources?.map((entry) => entry.request.family)).toEqual(['First', 'Second']);
  });

  test('resolving to nothing stays nothing, rather than an empty configuration', async () => {
    const { returned } = harness(undefined);
    expect(await returned[0]!(REQUEST)).toBeUndefined();
  });

  test('carries no epoch: the engine stamps the load sequence onto the answer', async () => {
    const { returned } = harness(source('A'));
    const resolved = await returned[0]!(REQUEST);
    expect(resolved).not.toBeUndefined();
    expect('epoch' in (resolved as object)).toBe(false);
  });
});
