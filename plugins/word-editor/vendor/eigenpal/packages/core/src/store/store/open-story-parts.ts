// Which stories are OPEN, and the cache key that says when that set moved.
//
// Extracted from `tree-package-store.ts` to keep it under its `max-lines` cap, and because the
// two answers have to agree: the token is the key for anything derived from the parts, so a
// part leaving the set without the token moving serves a stale answer, and vice versa. Keeping
// them side by side is what makes that checkable.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import type { TreeDocumentStore } from './tree-store.ts';

/**
 * The live part of every story store ALREADY open, body excluded.
 *
 * Already open, and never opening one. `w14:paraId` is minted when a story store opens, and the
 * coordinator's package only learns of the minting on the first commit — so a header the reader
 * has entered but not yet typed in carries none in the package copy, and anything indexing from
 * there cannot address it. Reading the open stores closes that gap without paying the cost the
 * cap exists for: resolving every scope in turn would open a store per header, and a store
 * whose part is still in the package is never evicted.
 *
 * PARKED stores are excluded. A deleted story's store stays in the map so undo and redo keep
 * its identity, but its part is no longer in the package — and a caller asking which stories
 * are open is asking about the document as it stands. Indexing a parked part left a deleted
 * header's paragraphs addressable by paraId, so an anchor into a story the reader had removed
 * still resolved.
 */
export function openStoryPartsOf(
  stories: ReadonlyMap<string, TreeDocumentStore>,
  pkg: OoxmlPackage
): readonly OoxmlPart[] {
  return [...stories.values()]
    .map((store) => store.part)
    .filter((part) => pkg.parts.has(part.name));
}

/**
 * Which stories are open, as a value that changes whenever the set does.
 *
 * A cache key for anything derived from {@link openStoryPartsOf}. Opening a story store
 * deliberately does NOT bump the package revision — it publishes no edit — but it does mint
 * `w14:paraId` for that story, so a paraId index built before the open is stale afterwards and
 * nothing else would say so. Measured: a host that reads `snapshot()` on mount (every host
 * does) poisoned that index with a body-only answer for the rest of the session, and a caret in
 * a header reported no selection at all.
 *
 * Derived from the SAME filtered parts, not from the store map's keys. A parked store stays in
 * the map, so a key-derived token does not move when a part leaves the package — and the pair
 * would then disagree: the parts list shrinks while the key that guards it stands still.
 *
 * The NAMES, not the count: closing one story and opening another leaves the count equal.
 */
export function openStoryTokenOf(
  stories: ReadonlyMap<string, TreeDocumentStore>,
  pkg: OoxmlPackage
): string {
  return openStoryPartsOf(stories, pkg)
    .map((part) => part.name)
    .sort()
    .join(',');
}
