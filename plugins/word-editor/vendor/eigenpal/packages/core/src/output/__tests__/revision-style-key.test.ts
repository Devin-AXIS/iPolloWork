// What may and may not move the paint-reuse key.
//
// `revisionStyleContextKey` decides whether painted pages can be reused. Too eager and the
// document keeps stale colours; too loose and a change that alters no pixel throws away
// every retained page. Both directions are cheap to get wrong in a refactor and expensive
// to notice, so both are pinned here.

import { describe, expect, test } from 'bun:test';
import {
  revisionStyleContextKey,
  revisionStyleContextOf,
  type RevisionStyles,
} from '../revision-presentation.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';

/** No pages: the author walk finds nobody, which is all these assertions need. */
const LAYOUT = { pages: [] } as unknown as SemanticLayout;

/** A FRESH layout per call: the context cache is keyed on layout identity. */
function keyOf(styles: RevisionStyles): string {
  const layout = { pages: [] } as unknown as SemanticLayout;
  return revisionStyleContextKey(revisionStyleContextOf(styles, layout));
}

describe('the paint-reuse key', () => {
  test('does NOT move when only an avatar changes', () => {
    // An avatar reaches the review card and nothing the painter emits. Hashing it made a
    // host resolving its roster over the network drop every retained page — measured at
    // 228ms and 0 of 41 pages for a change that alters no painted pixel.
    const withoutAvatar = keyOf({ authors: { Ada: { color: '#111' } } });
    const withAvatar = keyOf({ authors: { Ada: { color: '#111', avatarUrl: '/a.png' } } });
    const otherAvatar = keyOf({ authors: { Ada: { color: '#111', avatarUrl: '/b.png' } } });
    expect(withAvatar).toBe(withoutAvatar);
    expect(otherAvatar).toBe(withoutAvatar);
  });

  test('DOES move for every field the painter reads', () => {
    const base = keyOf({ authors: { Ada: { color: '#111' } } });
    expect(keyOf({ authors: { Ada: { color: '#222' } } })).not.toBe(base);
    expect(keyOf({ authors: { Ada: { color: '#111', background: '#eee' } } })).not.toBe(base);
    expect(keyOf({ authors: { Ada: { color: '#111', activeBackground: '#eee' } } })).not.toBe(base);
    expect(keyOf({ authors: { Ada: { color: '#111', spanClassName: 'x' } } })).not.toBe(base);
    // Two class lists differing only near the end: the digest is uncapped for style fields
    // precisely so this cannot collide.
    const long = 'a'.repeat(400);
    expect(keyOf({ authors: { Ada: { spanClassName: `${long}1` } } })).not.toBe(
      keyOf({ authors: { Ada: { spanClassName: `${long}2` } } })
    );
  });

  test('DOES move when the scheme for unstyled authors moves', () => {
    const ramp = keyOf({ authors: { Ada: { color: '#111' } }, others: 'author' });
    const kind = keyOf({ authors: { Ada: { color: '#111' } }, others: 'kind' });
    expect(kind).not.toBe(ramp);
  });

  test("'kind' has no context at all, so it is one constant key", () => {
    // A scheme that names nobody and leaves everyone on the kind colours needs no author
    // walk and marks no span with a slot; resolving a context for it would cost a full walk
    // per paint for no visible difference.
    expect(revisionStyleContextOf('kind', LAYOUT)).toBeNull();
    expect(revisionStyleContextKey(null)).toBe('kind');
    expect(keyOf({ authors: {}, others: 'kind' })).toBe('kind');
  });
});
