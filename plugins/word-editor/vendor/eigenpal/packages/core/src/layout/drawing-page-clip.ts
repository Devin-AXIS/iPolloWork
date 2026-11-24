import type { LayoutBox } from './semantic-records.ts';

/** The frame fields a page clip reads: a structural subset of the anchor frame context. */
export interface PageClipFrame {
  readonly pageWidth: number;
  readonly pageHeight?: number | undefined;
  readonly marginLeft: number;
  readonly contentInsetTop: number;
  readonly contentInsetBottom: number;
  readonly contentBandHeight: number;
}

/**
 * Full physical page clip, including margins and all columns. A continuous section's
 * content band can end before the sheet does; it must not crop page-relative artwork.
 * Callers without physical height retain the full-band fallback.
 */
export function pageClipRegion(frameBase: PageClipFrame): LayoutBox {
  const height = frameBase.pageHeight;
  return Object.freeze({
    x: -frameBase.marginLeft,
    y: -frameBase.contentInsetTop,
    width: frameBase.pageWidth,
    height:
      height !== undefined && Number.isFinite(height) && height > 0
        ? height
        : frameBase.contentBandHeight + frameBase.contentInsetTop + frameBase.contentInsetBottom,
  });
}

/**
 * A header or footer story's page clip. Once the story top on the sheet is known, it is the
 * whole sheet in story coordinates; before that, the page clip of the frame.
 */
export function storyPageClip(
  frame: PageClipFrame & { readonly pageHeight: number },
  storyTop: number | undefined
): LayoutBox {
  return storyTop !== undefined
    ? Object.freeze({
        x: -frame.marginLeft,
        y: -storyTop,
        width: frame.pageWidth,
        height: frame.pageHeight,
      })
    : pageClipRegion(frame);
}

/**
 * The horizontal room a body inline picture in one column may paint into. Beside another column
 * it stops at the middle of the gap; at the outside of the column set it reaches the paper edge.
 * Physical neighbours are used, so right-to-left column order needs no special case.
 */
export function columnPaperClip(
  paper: LayoutBox,
  columns: { readonly lefts: readonly number[]; readonly widths: readonly number[] },
  index: number
): LayoutBox {
  const left = columns.lefts[index];
  const width = columns.widths[index];
  if (left === undefined || width === undefined || columns.lefts.length < 2) return paper;
  const right = left + width;
  let from = paper.x;
  let to = paper.x + paper.width;
  for (const [other, otherLeft] of columns.lefts.entries()) {
    if (other === index) continue;
    const otherRight = otherLeft + (columns.widths[other] ?? 0);
    if (otherRight <= left) from = Math.max(from, (otherRight + left) / 2);
    if (otherLeft >= right) to = Math.min(to, (right + otherLeft) / 2);
  }
  return Object.freeze({ ...paper, x: from, width: Math.max(0, to - from) });
}

/** The horizontal room an inline picture may paint into, in its flow's coordinates. */
export interface InlinePictureRoom {
  readonly left: number;
  readonly right: number;
}

/** The room of a whole box: a cell box with its margins, or a story's sheet. */
export function inlinePictureRoomOf(box: LayoutBox): InlinePictureRoom {
  return Object.freeze({ left: box.x, right: box.x + box.width });
}

/**
 * The clip for an inline picture placed in a cell or story paragraph. Sideways it is the
 * room the flow set (the cell box with its margins, or a header's sheet), or the text column
 * when the flow set none. Vertically it is the placement band.
 */
export function inlinePictureClip(
  room: InlinePictureRoom | undefined,
  column: { readonly x: number; readonly width: number },
  top: number,
  bottom: number
): LayoutBox {
  return Object.freeze({
    x: room ? room.left : column.x,
    y: top,
    width: room ? Math.max(0, room.right - room.left) : column.width,
    height: Math.max(0, bottom - top),
  });
}

/** `deps` with the room of one cell; a flow that lays out no pictures keeps its object. */
export function withInlinePictureRoom<
  T extends { readonly inlineDrawingLayout?: unknown; readonly inlinePictureRoom?: unknown },
>(deps: T, room: InlinePictureRoom | undefined): T {
  return deps.inlineDrawingLayout ? { ...deps, inlinePictureRoom: room } : deps;
}
