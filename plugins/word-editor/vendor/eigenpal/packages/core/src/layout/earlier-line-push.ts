// How far a raised text-anchored table pushes the lines before its anchor on its page.
//
// A text-anchored table with a negative `w:tblpY` that leaves no passage beside it moves the
// earlier lines it covers below it (`reachesEarlierLines` zones). The anchor follows them, but
// the table keeps the place its anchor had before the move: its top is the anchor top minus
// this push, plus the offset. The first earlier line the band pushes sets the push; the lines
// after it follow without a skip of their own. A table of the same anchor that comes after the
// pushing one in source order is placed after the move and takes no push.
//
// The zones come from the previous pass, so the push is measured in the pass it applies to and
// an edit above the table moves the table with its text. When the moved lines would carry the
// anchor off the page, the anchor's band pricing (`coveredLinesAnchorBand`) sends the anchor and
// its table to the next page first, so no zone is left behind on this one.

import type { ExclusionZone } from './drawing-exclusion.ts';
import type { LayoutBox } from './semantic-records.ts';

const EPSILON = 0.5;
const TOUCH = 0.01;

/** Whether a line at `top` crosses `band`; a line that only touches it stays. */
function crosses(top: number, height: number, band: LayoutBox): boolean {
  return top < band.y + band.height - TOUCH && top + height > band.y + TOUCH;
}

/** Where a line at `top` lands below the top-and-bottom bands of `zones` it falls through. */
function fallThrough(top: number, height: number, zones: readonly ExclusionZone[]): number {
  let y = top;
  for (let moved = true; moved;) {
    moved = false;
    for (const zone of zones) {
      if (!crosses(y, height, zone.verticalBand)) continue;
      y = zone.verticalBand.y + zone.verticalBand.height;
      moved = true;
    }
  }
  return y;
}

/** The push of one anchor on one page: where its pushed line landed, and where it stood. */
interface AnchorPush {
  readonly landed: number;
  /** Per raised table of the anchor, source order first: where the line stood before it. */
  readonly before: readonly { readonly order: number; readonly y: number }[];
}

export function createEarlierLinePush(
  /** The document order of each paragraph, by id. */
  paragraphOrder: ReadonlyMap<string, number>,
  /** The lines rising table bands of `anchorId` add by wrap on `page` (`wrapsEarlierLines`). */
  wrapPush: (page: number, anchorId: string) => number = () => 0
) {
  const orderOf = (paragraphId: string) => paragraphOrder.get(paragraphId);
  const pushes = new Map<string, AnchorPush>();
  const key = (page: number, column: number, anchorId: string) => `${page}:${column}:${anchorId}`;
  return {
    /**
     * Records a line of `paragraphId` that moved from `top` down by `skip` on `page`, when it
     * crossed the band of a raised table anchored after that paragraph, also after an earlier
     * band moved it there, and landed at or below that band.
     *
     * The tables of one anchor are placed in source order, each from the flow as it stands
     * then, and each moves the earlier lines its band covers below it. So a table leaves out of
     * its own position only the move it and the later tables of its anchor cause: where the line
     * landed, less where the bands before it would have left the line.
     *
     * The push is kept per column: only a line in the column of the anchor moves the anchor, and
     * a band that crosses into another column moves the lines there without moving its anchor.
     */
    note(
      page: number,
      column: number,
      paragraphId: string,
      top: number,
      height: number,
      skip: number,
      zones: readonly ExclusionZone[]
    ): void {
      if (skip <= 0) return;
      const order = orderOf(paragraphId);
      if (order === undefined) return;
      const landed = top + skip;
      const raised = new Map<string, ExclusionZone[]>();
      const others: ExclusionZone[] = [];
      for (const zone of zones) {
        if (zone.input.mode !== 'topAndBottom') continue;
        const anchorOrder = orderOf(zone.anchorParagraphId);
        if (anchorOrder === undefined) continue;
        if (zone.reachesEarlierLines && anchorOrder > order) {
          const own = raised.get(zone.anchorParagraphId) ?? [];
          own.push(zone);
          raised.set(zone.anchorParagraphId, own);
        } else if (anchorOrder <= order || zone.pageFramedBand) others.push(zone);
      }
      for (const [anchorId, own] of raised) {
        const id = key(page, column, anchorId);
        if (pushes.has(id)) continue;
        own.sort((a, b) => a.sourceOrder - b.sourceOrder);
        // Where the line stands when each table is placed: below the bands before it.
        const before = own.map((zone, index) => ({
          order: zone.sourceOrder,
          y: Math.min(landed, fallThrough(top, height, [...others, ...own.slice(0, index)])),
        }));
        // The first table whose band the line crosses from there pushes it.
        const pusher = own.findIndex((zone, index) =>
          crosses(before[index]!.y, height, zone.verticalBand)
        );
        const band = pusher < 0 ? undefined : own[pusher]!.verticalBand;
        if (!band || landed < band.y + band.height - EPSILON) continue;
        pushes.set(id, { landed, before });
      }
    },
    /**
     * The push the raised tables anchored at `anchorId` in `column` leave out of its top on `page`, with the
     * lines that rising bands add by wrap. With `sourceOrder`, the part the table at that order and
     * the later ones caused.
     */
    of(page: number, column: number, anchorId: string, sourceOrder?: number): number {
      const wrapped = wrapPush(page, anchorId);
      const push = pushes.get(key(page, column, anchorId));
      if (!push) return wrapped;
      const first = push.before[0]?.y ?? push.landed;
      if (sourceOrder === undefined) return push.landed - first + wrapped;
      const own = push.before.find((entry) => entry.order >= sourceOrder);
      return (own ? push.landed - own.y : 0) + wrapped;
    },
  };
}

/**
 * Whether a text-anchored table the previous pass placed beside `anchorId` keeps that place while
 * its anchor moves on to the next column or page: the anchor's first line fits where it stood
 * before the table moved anything (`overrun`, how far it now misses the bottom, is no more than
 * the push), so the table's band is what pushed it out. A page- or margin-positioned table
 * follows its anchor instead (`coveredLinesAnchorBand`).
 */
export function ownTableStaysForAnchor(
  zones: readonly ExclusionZone[],
  anchorId: string,
  at: {
    /** The column being filled in a multi-column section. */
    readonly column: number | undefined;
    /** How far the raised tables of `anchorId` pushed the earlier lines on this page. */
    readonly pushed: number;
    readonly overrun: number;
  }
): boolean {
  return zones.some(
    (zone) =>
      zone.sourceKind === 'table' &&
      zone.anchorParagraphId === anchorId &&
      !zone.pageFramedBand &&
      (at.column === undefined || zone.columnIndex === at.column) &&
      at.overrun - at.pushed <= 0
  );
}
