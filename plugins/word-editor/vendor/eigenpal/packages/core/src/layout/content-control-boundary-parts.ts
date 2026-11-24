// Which parts a boundary pass collects controls from, and their merged index.
//
// A control lives in the part that DECLARES it, and a header is a different part from the
// body. The pass used to derive boundaries from the body part alone, so a control in a header
// was never collected: it had no geometry, and its outline could neither draw nor hit-test.
//
// Extracted from `content-control-boundary-layout.ts` to keep it under the line cap. Pure
// functions over parts and layouts, with no page geometry.

import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { SemanticLayout } from './semantic-records.ts';
import {
  collectedControlIndexOf,
  sameRefs,
  type CollectedControl,
  type CollectedControlIndex,
} from './content-control-boundary-layout.ts';

/**
 * The body's part, then each distinct HEADER and FOOTER part the layout draws.
 *
 * A control lives in the part that declares it, and a header is a different part from the
 * body. Deriving boundaries from the body alone meant a control in a header was never
 * collected — so it had no geometry, and its outline could neither draw nor hit-test.
 *
 * Deduplicated by part IDENTITY, because one header part is shared across every page it
 * appears on and across sections that inherit it.
 *
 * Not the note parts. A note's fragments hang off the page's note areas rather than off a page
 * story, so this pass has no origin to place their controls with. Collecting them would publish
 * boundaries the painter and the hit test cannot use.
 *
 * The table lane draws that line in two places, on purpose. `semantic-cell-selection.ts` covers
 * notes as well, because a cell selection is resolved by id and its geometry is shifted per
 * story. The HOVER walks — `semantic-table-interaction.ts` and `table-interaction-targets.ts` —
 * stop at header and footer, matching this pass. A table in a footnote is editable through the
 * editor commands and offers no row or column handles.
 */
export function boundaryParts(layout: SemanticLayout, part: OoxmlPart): readonly OoxmlPart[] {
  const parts: OoxmlPart[] = [part];
  const seen = new Set<OoxmlPart>([part]);
  for (const page of layout.pages) {
    for (const story of [page.header, page.footer]) {
      if (!story?.part || seen.has(story.part)) continue;
      seen.add(story.part);
      parts.push(story.part);
    }
  }
  return parts;
}

/**
 * The collected controls of every story part, as one index.
 *
 * Each part's own index is memoized on the part, so this is a concat and two set unions —
 * the walks themselves are not repeated.
 */
const mergedControlIndexes = new WeakMap<
  OoxmlPart,
  { readonly parts: readonly OoxmlPart[]; readonly index: CollectedControlIndex }
>();

/**
 * The retained previous merge, guarded by the per-part INDEX identities. A keystroke mints a
 * new body part, so the part-keyed memo above misses by design — but the body's own index
 * comes back by identity when its controls are unchanged, and an identical index tuple
 * proves the merge cannot differ. Keyed weakly on the body's index, so a closed document's
 * merge dies with its index instead of staying pinned in a module slot.
 */
const mergedIndexByBodyIndex = new WeakMap<
  CollectedControlIndex,
  {
    readonly indexes: readonly CollectedControlIndex[];
    readonly index: CollectedControlIndex;
  }
>();

export function collectedControlIndexOverParts(parts: readonly OoxmlPart[]): CollectedControlIndex {
  if (parts.length === 1) return collectedControlIndexOf(parts[0]!);
  // Memoized on the BODY part, guarded by the exact part list. Each part's own index is
  // already memoized, but the merge was not, and one layout pass makes several passes over it.
  // Part objects are immutable, so identity is the whole comparison.
  const cached = mergedControlIndexes.get(parts[0]!);
  if (cached && sameRefs(cached.parts, parts)) return cached.index;

  const indexes = parts.map((storyPart) => collectedControlIndexOf(storyPart));
  const slot = mergedIndexByBodyIndex.get(indexes[0]!);
  if (slot && sameRefs(slot.indexes, indexes)) {
    mergedControlIndexes.set(parts[0]!, { parts, index: slot.index });
    return slot.index;
  }

  const controls: CollectedControl[] = [];
  const neededBlockIds = new Set<string>();
  const neededParagraphIds = new Set<string>();
  for (const index of indexes) {
    // A LOOP, not a spread: the control count comes from a file, and spreading an unbounded
    // array into `push` throws `RangeError` once it is large enough.
    for (const control of index.controls) controls.push(control);
    for (const id of index.neededBlockIds) neededBlockIds.add(id);
    for (const id of index.neededParagraphIds) neededParagraphIds.add(id);
  }
  // Recomputed over the MERGED sets, not concatenated from the parts. This token is the
  // per-page geometry memo's key: if it did not move when a furniture control appeared, every
  // page would keep serving the contribution it built before that control existed.
  const neededToken = `${[...neededBlockIds].sort().join(',')};${[...neededParagraphIds]
    .sort()
    .join(',')}`;
  const index: CollectedControlIndex = {
    controls,
    neededBlockIds,
    neededParagraphIds,
    neededToken,
  };
  mergedIndexByBodyIndex.set(indexes[0]!, { indexes, index });
  mergedControlIndexes.set(parts[0]!, { parts, index });
  return index;
}
