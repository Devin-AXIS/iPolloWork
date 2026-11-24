// The top limit of a wrapping object that its paragraph positions.
//
// In modern compatibility modes a body object that wraps text and takes its vertical position
// from its anchor paragraph never starts above the content box top: a negative offset that
// would lift it into the top margin stops at the margin. An object that does not wrap
// (`wrapNone`, in front of or behind the text) keeps its offset. Legacy modes keep it too.
//
// The bottom limit mirrors it. In modern modes the object moves up to end at the content box
// bottom, unless that would lift it above its own line: then it keeps its offset, and the flow
// moves the line to the next page instead (see `paragraph-own-anchors.ts`). Legacy modes move it
// up to end at the sheet bottom, never above the sheet top, and never move the line.
//
// In a table cell the same object, laid out in the cell, stops at the cell box top in every
// mode, and the row grows to hold it (see `cell-anchor-extent.ts`).

import type { ImageWrapTarget } from '../store/package/drawing-projection.ts';

interface ContentTopContext {
  readonly wrappedParagraphAnchorsBelowContentTop?: boolean;
  readonly wrappedParagraphAnchorBottom?: 'margin' | 'sheet';
  readonly storyKind: string;
  readonly cellBox: { readonly y: number } | null;
  readonly layoutInCell?: boolean;
  readonly inTableCell?: boolean;
}

/** Whether the object wraps text: not inline, not in front of or behind it. */
export function wrapsText(wrap: ImageWrapTarget): boolean {
  return wrap !== 'inline' && wrap !== 'behind' && wrap !== 'inFront';
}

/** Whether a body object with this frame and wrap stops at the content box top. */
export function stopsAtContentTop(
  verticalFrame: string,
  wrap: ImageWrapTarget,
  ctx: ContentTopContext
): boolean {
  return (
    ctx.wrappedParagraphAnchorsBelowContentTop === true &&
    ctx.storyKind === 'body' &&
    ctx.cellBox == null &&
    verticalFrame === 'paragraph' &&
    wrapsText(wrap)
  );
}

/** Whether a cell object with this frame and wrap stops at the cell box top. */
function stopsAtCellTop(verticalFrame: string, wrap: ImageWrapTarget, ctx: ContentTopContext) {
  return (
    ctx.cellBox != null &&
    ctx.inTableCell === true &&
    ctx.layoutInCell === true &&
    verticalFrame === 'paragraph' &&
    wrapsText(wrap)
  );
}

/** The resolved top `y` (page-content coordinates) after the content box top limit. */
export function wrappedParagraphAnchorTop(
  y: number,
  verticalFrame: string,
  wrap: ImageWrapTarget,
  ctx: ContentTopContext
): number {
  if (ctx.cellBox != null && y < ctx.cellBox.y && stopsAtCellTop(verticalFrame, wrap, ctx))
    return ctx.cellBox.y;
  return y < 0 && stopsAtContentTop(verticalFrame, wrap, ctx) ? 0 : y;
}

interface ContentBottomContext extends ContentTopContext {
  readonly contentHeight: number;
  readonly contentBandHeight: number;
  readonly contentInsetTop: number;
  readonly contentInsetBottom: number;
  readonly anchorLineBox: { readonly y: number };
}

/** The resolved top `y` after the bottom limit of a wrapping body object (see the header). */
export function wrappedParagraphAnchorBottomTop(
  y: number,
  height: number,
  verticalFrame: string,
  wrap: ImageWrapTarget,
  ctx: ContentBottomContext
): number {
  const limit = ctx.wrappedParagraphAnchorBottom;
  if (
    limit === undefined ||
    ctx.storyKind !== 'body' ||
    ctx.cellBox != null ||
    (verticalFrame !== 'paragraph' && verticalFrame !== 'line') ||
    !wrapsText(wrap)
  )
    return y;
  if (limit === 'margin') {
    const lifted = ctx.contentHeight - height;
    return y + height > ctx.contentHeight && lifted >= ctx.anchorLineBox.y ? lifted : y;
  }
  const sheetBottom = ctx.contentBandHeight + ctx.contentInsetBottom;
  return y + height > sheetBottom ? Math.max(-ctx.contentInsetTop, sheetBottom - height) : y;
}
