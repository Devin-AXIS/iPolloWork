import { paragraphFragmentsOnPage } from './story-fragments.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import { wordBoundary } from './semantic-word-navigation.ts';
import { paragraphLinesFor } from './paragraph-lines.ts';
import type { SemanticLayout } from './semantic-records.ts';

export interface VisualCaretStop {
  readonly lineId: string;
  readonly x: number;
  readonly position: { readonly paragraphId: string; readonly offset: number };
}
export type BidiDirectionOf = (stop: VisualCaretStop) => -1 | 1 | undefined;
const directions = new WeakMap<SemanticLayout, Map<string, Map<string, -1 | 1 | undefined>>>();
/** Read immutable layout metadata, including for caller-cloned story stops. */
export function bidiDirectionOfStop(layout: SemanticLayout, stop: VisualCaretStop) {
  let cached = directions.get(layout);
  if (!cached) directions.set(layout, (cached = new Map()));
  if (!cached.get(stop.lineId)?.has(stop.position.paragraphId)) {
    const placed = paragraphLinesFor(layout, stop.position.paragraphId) ?? [];
    let paragraphBase = placed
      .flatMap(({ line }) => line.spans)
      .find((span) => span.range.paragraphId === stop.position.paragraphId && span.style.shaping)
      ?.style.shaping?.baseLevel;
    if (
      paragraphBase === undefined &&
      placed.every(({ line }) => line.spans.length === 0 && !line.drawings?.length)
    ) {
      const page = layout.pages[placed[0]?.pageIndex ?? -1];
      const fragment =
        page &&
        paragraphFragmentsOnPage(page).find(
          (value) => value.range.paragraphId === stop.position.paragraphId
        );
      if (fragment && paragraphIsRtl(fragment.props)) paragraphBase = 1;
    }
    for (const { line } of placed) {
      const base =
        line.spans.find(
          (span) => span.range.paragraphId === stop.position.paragraphId && span.style.shaping
        )?.style.shaping?.baseLevel ?? paragraphBase;
      let byParagraph = cached.get(line.id);
      if (!byParagraph) cached.set(line.id, (byParagraph = new Map()));
      byParagraph.set(
        stop.position.paragraphId,
        base === undefined ? undefined : base % 2 ? -1 : 1
      );
    }
  }
  return cached.get(stop.lineId)?.get(stop.position.paragraphId);
}
interface LineStops {
  readonly paragraphIds: ReadonlySet<string>;
  readonly logical: readonly VisualCaretStop[];
  visual?: readonly VisualCaretStop[];
  indexes?: ReadonlyMap<VisualCaretStop, number>;
}
interface GroupedStops {
  readonly indexes: ReadonlyMap<VisualCaretStop, number>;
  readonly lines: readonly string[];
  readonly lineIndexes: ReadonlyMap<string, number>;
  readonly groups: ReadonlyMap<string, LineStops>;
}
const groups = new WeakMap<readonly VisualCaretStop[], GroupedStops>();
function grouped(stops: readonly VisualCaretStop[]): GroupedStops {
  let cached = groups.get(stops);
  if (cached) return cached;
  const entries = new Map<string, VisualCaretStop[]>();
  for (const stop of stops) {
    let line = entries.get(stop.lineId);
    if (!line) entries.set(stop.lineId, (line = []));
    line.push(stop);
  }
  const lines = [...entries.keys()];
  cached = {
    indexes: new Map(stops.map((stop, index) => [stop, index])),
    lines,
    lineIndexes: new Map(lines.map((id, index) => [id, index])),
    groups: new Map(
      [...entries].map(([id, logical]) => [
        id,
        { logical, paragraphIds: new Set(logical.map((stop) => stop.position.paragraphId)) },
      ])
    ),
  };
  groups.set(stops, cached);
  return cached;
}
function visual(line: LineStops): readonly VisualCaretStop[] {
  if (!line.visual) {
    line.visual = [...line.logical].sort((a, b) => a.x - b.x);
    line.indexes = new Map(line.visual.map((stop, index) => [stop, index]));
  }
  return line.visual;
}
/** Canonical arrays stay logical; only the active bidi line is sorted for arrow motion. */
export function horizontalCaretStep<T extends VisualCaretStop>(
  stops: readonly T[],
  index: number,
  direction: -1 | 1,
  directionOf: BidiDirectionOf
): { target?: T; logicalDirection: -1 | 1 } {
  const current = stops[index]!;
  const base = directionOf(current);
  if (base === undefined) return { target: stops[index + direction], logicalDirection: direction };
  const groupedStops = grouped(stops);
  const line = groupedStops.groups.get(current.lineId)!;
  const sorted = visual(line);
  const target = sorted[line.indexes!.get(current)! + direction] as T | undefined;
  const logicalDirection = (direction * base) as -1 | 1;
  if (target) return { target, logicalDirection };
  const adjacent =
    groupedStops.lines[groupedStops.lineIndexes.get(current.lineId)! + logicalDirection];
  if (!adjacent) return { logicalDirection };
  const next = groupedStops.groups.get(adjacent)!;
  const sameFlow = [...line.paragraphIds].some((id) => next.paragraphIds.has(id));
  const nextStops = sameFlow ? visual(next) : next.logical;
  const entryDirection = sameFlow ? direction : logicalDirection;
  return {
    target: (entryDirection === 1 ? nextStops[0] : nextStops.at(-1)) as T,
    logicalDirection,
  };
}

export function visualLineEdge<T extends VisualCaretStop>(
  stops: readonly T[],
  current: T,
  direction: -1 | 1,
  directionOf: BidiDirectionOf
): T {
  const line = grouped(stops).groups.get(current.lineId)!;
  const base = directionOf(current);
  const ordered = base === undefined ? line.logical : visual(line);
  // Home/End are logical line edges: an RTL line begins at its physical right.
  const edge = direction * (base ?? 1);
  return (edge === -1 ? ordered[0] : ordered.at(-1)) as T;
}

/** Walk physical stops while preserving words, combining marks, and revision seams. */
export function visualWordBoundary<T extends VisualCaretStop>(
  text: string,
  stops: readonly T[],
  index: number,
  direction: -1 | 1,
  directionOf: BidiDirectionOf,
  boundaries: ReadonlySet<number>
): number {
  const first = stops[index]!;
  if (directionOf(first) === undefined)
    return wordBoundary(text, first.position.offset, direction, boundaries);
  const indexes = grouped(stops).indexes;
  let current = first;
  let consumedWord = false;
  for (let count = 0; count < stops.length; count++) {
    const next = horizontalCaretStep(stops, indexes.get(current)!, direction, directionOf).target;
    if (!next || next.position.paragraphId !== first.position.paragraphId) break;
    const adjacentSource = Math.abs(indexes.get(next)! - indexes.get(current)!) === 1;
    if (!adjacentSource) {
      if (consumedWord) break;
    } else {
      // Combining marks remain attached to their word during visual motion.
      const word = /[\p{L}\p{N}\p{M}_'\u2019]/u.test(
        text.slice(
          Math.min(current.position.offset, next.position.offset),
          Math.max(current.position.offset, next.position.offset)
        )
      );
      if (consumedWord && !word) break;
      consumedWord ||= word;
    }
    current = next;
    if (boundaries.has(current.position.offset)) break;
  }
  return current.position.offset;
}

/** Resolve a suppressed logical position toward its visible physical neighbour. */
export function directionThroughGap(
  stops: readonly VisualCaretStop[],
  position: VisualCaretStop['position'],
  direction: -1 | 1,
  directionOf: BidiDirectionOf
): -1 | 1 {
  let before: VisualCaretStop | undefined, after: VisualCaretStop | undefined;
  for (const stop of stops) {
    if (stop.position.paragraphId !== position.paragraphId) continue;
    if (
      stop.position.offset < position.offset &&
      (!before || stop.position.offset > before.position.offset)
    )
      before = stop;
    if (
      stop.position.offset > position.offset &&
      (!after || stop.position.offset < after.position.offset)
    )
      after = stop;
  }
  if (before && after && before.lineId === after.lineId && before.x !== after.x)
    return (direction * (after.x < before.x ? -1 : 1)) as -1 | 1;
  const near = before ?? after;
  return (direction * (near ? (directionOf(near) ?? 1) : 1)) as -1 | 1;
}
