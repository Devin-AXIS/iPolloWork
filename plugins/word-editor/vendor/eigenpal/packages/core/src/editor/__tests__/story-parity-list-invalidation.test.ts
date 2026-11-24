// A header's list markers follow `numbering.xml`.
//
// The marker a header paints is resolved from a part the header does not contain. Everything
// that identifies a header story describes the AUTHORED part — its `contentKey` and its flow
// height — and neither moves when `numbering.xml` changes: the definition lives elsewhere, and
// a marker sits in the hanging-indent slot, so the story is exactly as tall with `1.` as with
// `vii.`.
//
// Three caches sat between the two, and each had to learn the numbering input separately:
// `hfStoryMemo` in `surface-pages.ts`, the section reuse context through
// `furnitureLayoutContext`, and the multi-section `furnitureFingerprint`. Miss any one and the
// unchanged-pass early exit returns the previous pages BY IDENTITY, furniture included — so
// the header keeps a marker the document no longer defines, and nothing invalidates it again.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { PROBE } from './story-parity-fixture.ts';
import { caretIn, openStory } from './story-parity-harness.ts';

/** The marker text the header paints for its own list item, or null when it paints none. */
function headerMarkers(open: ReturnType<typeof openStory>): (string | null)[] {
  const header = open.surface.publishedLayout().pages[0]?.header;
  if (!header) return [];
  return header.fragments
    .filter((block) => block.kind === 'paragraph')
    .map((block) => (block.kind === 'paragraph' ? (block.marker?.text ?? null) : null));
}

/** The same read for the body's own fragments. */
function bodyMarkers(open: ReturnType<typeof openStory>): (string | null)[] {
  return open.surface
    .publishedLayout()
    .pages[0]!.fragments.filter((block) => block.kind === 'paragraph')
    .map((block) => (block.kind === 'paragraph' ? (block.marker?.text ?? null) : null));
}

describe("a header's markers follow numbering.xml", () => {
  test('the header paints its own list marker', () => {
    const open = openStory('header');
    try {
      expect(headerMarkers(open).filter(Boolean).length).toBeGreaterThan(0);
    } finally {
      open.destroy();
    }
  });

  // The counter rule, asserted on the marker TEXT rather than on a count.
  //
  // The header and footer spec requires a header list to start at the level's `w:start` and to
  // leave the body's own sequence alone, even when the two share a `numId` - which this
  // fixture makes them do. A count cannot see the difference: a header that CONTINUED the body
  // would paint just as many markers, reading `2.` where it should read `1.`.
  // `list-counters.ts` gives each story its own counter state, and this is what pins it.
  test('the header restarts the shared numId, and the body is unaffected', () => {
    const open = openStory('header');
    try {
      const header = headerMarkers(open).filter((each): each is string => each !== null);
      const body = bodyMarkers(open).filter((each): each is string => each !== null);
      // Guard the comparison: two empty lists agree about nothing.
      expect(header.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(header[0]).toBe('1.');
      expect(body[0]).toBe('1.');
    } finally {
      open.destroy();
    }
  });

  test('demoting a header list item re-resolves the marker', () => {
    const open = openStory('header');
    try {
      const before = headerMarkers(open);
      caretIn(open, PROBE.numbered);
      // Increase Indent demotes the item, which DECLARES a level the document did not have —
      // a write to `numbering.xml`, not to `header1.xml`. Captured by value at mount, the
      // furniture source held an index with no such level and the paragraph resolved to no
      // marker at all, springing back to the margin for the rest of the session.
      expect(open.surface.adjustIndent('increase')).toBe(true);
      const after = headerMarkers(open);

      expect(after.filter(Boolean).length, 'the header lost its marker').toBe(
        before.filter(Boolean).length
      );
      expect(after).not.toEqual(before);
    } finally {
      open.destroy();
    }
  });

  test('a body list edit does not leave the header showing a stale marker', () => {
    const open = openStory('body');
    try {
      const before = headerMarkers(open);
      // A BODY edit that also writes `numbering.xml`. The header part is untouched, so every
      // key the section reuse context compares is unchanged, and the early exit would return
      // the previous pages with the header among them.
      caretIn(open, PROBE.numbered);
      expect(open.surface.adjustIndent('increase')).toBe(true);
      const after = headerMarkers(open);

      // The header's own list is on its own counter, so a body demotion must not move it.
      expect(after).toEqual(before);
      expect(after.filter(Boolean).length).toBeGreaterThan(0);
    } finally {
      open.destroy();
    }
  });
});
