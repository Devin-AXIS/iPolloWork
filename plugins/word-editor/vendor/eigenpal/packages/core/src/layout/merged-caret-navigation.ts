import { paragraphLinesFor, type PlacedLine } from './paragraph-lines.ts';
import { lineSegments } from './line-segments.ts';
import type { SemanticLayout } from './semantic-records.ts';
export interface MergedCaretGroup {
  readonly members: readonly string[];
  readonly lines: readonly PlacedLine[];
}
const cache = new WeakMap<SemanticLayout, Map<string, MergedCaretGroup | null>>();
/** Only connected merged members share stops; ordinary paragraphs retain their bounded cache. */
export function mergedCaretGroup(
  layout: SemanticLayout,
  paragraphId: string
): MergedCaretGroup | null {
  let groups = cache.get(layout);
  if (!groups) cache.set(layout, (groups = new Map()));
  if (groups.has(paragraphId)) return groups.get(paragraphId)!;
  const members = new Set([paragraphId]);
  const lines = new Map<string, PlacedLine>();
  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const member of members) {
    let previous: string | undefined;
    for (const placed of paragraphLinesFor(layout, member)) {
      const id = placed.line.id;
      lines.set(id, placed);
      if (!indegree.has(id)) indegree.set(id, 0);
      for (const segment of lineSegments(placed.line)) members.add(segment.paragraphId);
      if (previous && previous !== id) {
        let after = edges.get(previous);
        if (!after) edges.set(previous, (after = new Set()));
        if (!after.has(id)) {
          after.add(id);
          indegree.set(id, indegree.get(id)! + 1);
        }
      }
      previous = id;
    }
  }
  if (members.size === 1) {
    groups.set(paragraphId, null);
    return null;
  }
  // Each member already lists lines in flow order. Shared lines join those sequences,
  // preserving pagination and columns without sorting by page-local coordinates.
  const queue = [...lines.keys()].filter((id) => indegree.get(id) === 0);
  const ordered: PlacedLine[] = [];
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at]!;
    ordered.push(lines.get(id)!);
    for (const next of edges.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  const group = { members: [...members], lines: ordered };
  for (const member of members) groups.set(member, group);
  return group;
}
