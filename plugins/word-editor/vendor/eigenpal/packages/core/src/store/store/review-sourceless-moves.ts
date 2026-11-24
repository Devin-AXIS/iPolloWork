import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { rangesOverMovedMarks } from './revision-named-move-ranges.ts';
import { orphanMoveDestinationSites, type RevisionSite } from './tree-op-revisions.ts';

const byRoot = new WeakMap<OoxmlNode, ReadonlySet<string>>();

/**
 * The move sites a review list counts as insertions: the text of destinations with no source,
 * and a moved paragraph mark that no move range covers in a paragraph that holds such text.
 * That mark lists with the text, although rejecting it removes the mark while a destination
 * with no source keeps its text.
 */
export function sourcelessMoveSites(
  root: OoxmlNode,
  sites: readonly RevisionSite[]
): ReadonlySet<string> {
  const known = byRoot.get(root);
  if (known) return known;
  const destinations = orphanMoveDestinationSites(root, sites);
  const result = new Set<string>();
  for (const site of sites)
    if (!site.paragraphMark && destinations.has(site.node.id)) result.add(site.node.id);
  const marks = sites.filter((site) => site.paragraphMark && site.node.localName === 'moveTo');
  if (marks.length && result.size) {
    const places = rangesOverMovedMarks(root);
    for (const site of marks) {
      const place = places.get(site.node.id);
      // A mark a move range covers lists on its own, as the second entry of that move.
      if (place && !place.ranges.length && place.wrappers.some((id) => result.has(id)))
        result.add(site.node.id);
    }
  }
  byRoot.set(root, result);
  return result;
}
