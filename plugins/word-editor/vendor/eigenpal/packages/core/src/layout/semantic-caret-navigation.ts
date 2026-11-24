import {
  horizontalCaretStep,
  directionThroughGap,
  visualLineEdge,
  type BidiDirectionOf,
} from './visual-caret-navigation.ts';
import type { IndexedCaretStops } from './semantic-caret-stop-index.ts';

interface VerticalCaretStop {
  readonly lineId: string;
  readonly x: number;
  readonly position: { readonly paragraphId: string; readonly offset: number };
}

/** Previous stop of this member, even when another merged member emitted stops after it. */
export function lastStopOfParagraph<T extends VerticalCaretStop>(
  stops: readonly T[],
  paragraphId: string
): T | undefined {
  for (let index = stops.length - 1; index >= 0; index--)
    if (stops[index]!.position.paragraphId === paragraphId) return stops[index];
  return undefined;
}

function lineIdsOf(stops: readonly VerticalCaretStop[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const stop of stops) {
    if (seen.has(stop.lineId)) continue;
    seen.add(stop.lineId);
    ids.push(stop.lineId);
  }
  return ids;
}

function nearestOnLine<T extends VerticalCaretStop>(
  stops: readonly T[],
  lineId: string,
  targetX: number
): T | null {
  let best: T | null = null;
  for (const stop of stops) {
    if (stop.lineId !== lineId) continue;
    if (!best || Math.abs(stop.x - targetX) < Math.abs(best.x - targetX)) best = stop;
  }
  return best;
}

/**
 * The stop nearest a position that NO stop owns, in the same paragraph, or null.
 *
 * A gesture can leave the caret at such an offset — a drag or shift-click endpoint resolves
 * to the character the browser saw, and the interior of deleted content is deliberately not
 * a caret stop. Refusing to move from there made every arrow a dead press. Ties go to the
 * earlier stop, matching the "before the region" answer a step-over gives.
 */
export function nearestStop<T extends VerticalCaretStop>(
  stops: readonly T[],
  position: VerticalCaretStop['position']
): T | null {
  let best: T | null = null;
  for (const stop of stops) {
    if (stop.position.paragraphId !== position.paragraphId) continue;
    if (
      !best ||
      Math.abs(stop.position.offset - position.offset) <
        Math.abs(best.position.offset - position.offset)
    ) {
      best = stop;
    }
  }
  return best;
}

/**
 * The first stop past an unowned position in the direction of travel, or null.
 *
 * For horizontal motion the resolution IS the move: from inside a deleted region, Right goes
 * to the stop just past it and Left to the one just before, exactly where a step-over from
 * the boundary would have landed.
 */
export function stopInDirection<T extends VerticalCaretStop>(
  stops: readonly T[],
  position: VerticalCaretStop['position'],
  direction: -1 | 1
): T | null {
  let best: T | null = null;
  for (const stop of stops) {
    if (stop.position.paragraphId !== position.paragraphId) continue;
    const offset = stop.position.offset;
    if (direction === 1) {
      if (offset > position.offset && (!best || offset < best.position.offset)) best = stop;
    } else if (offset < position.offset && (!best || offset > best.position.offset)) {
      best = stop;
    }
  }
  return best;
}

/** Home/End within the active paragraph's current visual line. */
export function moveToLineEdge<T extends VerticalCaretStop>(
  position: VerticalCaretStop['position'],
  direction: -1 | 1,
  indexed: IndexedCaretStops<T>,
  directionOf: BidiDirectionOf = () => undefined
): VerticalCaretStop['position'] | null {
  const stopIndex = indexed.index.get(position.paragraphId)?.get(position.offset);
  const stop =
    stopIndex === undefined ? nearestStop(indexed.stops, position) : indexed.stops[stopIndex]!;
  if (!stop) return null;
  return visualLineEdge(indexed.stops, stop, direction, directionOf).position;
}

/** Body ArrowLeft/ArrowRight using only the active and boundary-neighbour paragraphs. */
export function moveHorizontalCaret<T extends VerticalCaretStop>(
  position: VerticalCaretStop['position'],
  direction: -1 | 1,
  order: readonly string[],
  paragraphIndex: number,
  stopsForParagraph: (paragraphId: string) => IndexedCaretStops<T>,
  directionOf: BidiDirectionOf = () => undefined
): { position: VerticalCaretStop['position']; desiredX: null } | null {
  const current = stopsForParagraph(position.paragraphId);
  const stopIndex = current.index.get(position.paragraphId)?.get(position.offset);
  let logicalDirection = direction;
  if (stopIndex === undefined) {
    logicalDirection = directionThroughGap(current.stops, position, direction, directionOf);
    const resolved = stopInDirection(current.stops, position, logicalDirection);
    if (resolved) return { position: resolved.position, desiredX: null };
    // Past every stop of this paragraph in that direction: the neighbour, like an edge step.
  } else {
    const step = horizontalCaretStep(current.stops, stopIndex, direction, directionOf);
    logicalDirection = step.logicalDirection;
    if (step.target) return { position: step.target.position, desiredX: null };
  }
  const neighbourId = order[paragraphIndex + logicalDirection];
  if (!neighbourId) return { position, desiredX: null };
  const neighbour = stopsForParagraph(neighbourId).stops;
  const target = logicalDirection === -1 ? neighbour[neighbour.length - 1] : neighbour[0];
  return target ? { position: target.position, desiredX: null } : null;
}

/** Ctrl/Cmd+Home/End from the first or last semantic paragraph only. */
export function moveToDocumentEdge<T extends VerticalCaretStop>(
  direction: -1 | 1,
  order: readonly string[],
  stopsForParagraph: (paragraphId: string) => IndexedCaretStops<T>
): VerticalCaretStop['position'] | null {
  const paragraphId = direction === -1 ? order[0] : order[order.length - 1];
  if (!paragraphId) return null;
  const stops = stopsForParagraph(paragraphId).stops;
  return (direction === -1 ? stops[0] : stops[stops.length - 1])?.position ?? null;
}

/** Body ArrowUp/ArrowDown without constructing caret stops for the whole document. */
export function moveVerticalCaret<T extends VerticalCaretStop>(
  position: VerticalCaretStop['position'],
  direction: -1 | 1,
  desiredX: number | null,
  order: readonly string[],
  paragraphIndex: number,
  stopsForParagraph: (paragraphId: string) => IndexedCaretStops<T>
): { position: VerticalCaretStop['position']; desiredX: number } | null {
  const current = stopsForParagraph(position.paragraphId);
  const stopIndex = current.index.get(position.paragraphId)?.get(position.offset);
  const currentStop =
    stopIndex === undefined ? nearestStop(current.stops, position) : current.stops[stopIndex]!;
  if (!currentStop) return null;
  const targetX = desiredX ?? currentStop.x;
  const currentLines = lineIdsOf(current.stops);
  const currentLineIndex = currentLines.indexOf(currentStop.lineId);
  const localLine = currentLines[currentLineIndex + direction];
  if (localLine) {
    const target = nearestOnLine(current.stops, localLine, targetX);
    return target ? { position: target.position, desiredX: targetX } : null;
  }

  for (
    let index = paragraphIndex + direction;
    index >= 0 && index < order.length;
    index += direction
  ) {
    const neighbour = stopsForParagraph(order[index]!);
    const lines = lineIdsOf(neighbour.stops);
    const targetLine = direction === -1 ? lines[lines.length - 1] : lines[0];
    if (!targetLine) continue;
    const target = nearestOnLine(neighbour.stops, targetLine, targetX);
    if (target) return { position: target.position, desiredX: targetX };
  }

  const edge = direction === -1 ? current.stops[0] : current.stops[current.stops.length - 1];
  return edge ? { position: edge.position, desiredX: targetX } : null;
}
