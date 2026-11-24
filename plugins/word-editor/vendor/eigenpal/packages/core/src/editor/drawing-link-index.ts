// Drawing hyperlink lookup from published layout records (typed-drawings-and-images task 10).

import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { HeaderFooterStoryRecord, PageRecord } from '../layout/semantic-records.ts';
import type { SurfaceHyperlink } from './surface-hyperlinks.ts';

function surfaceHyperlinkFromDrawing(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord
): SurfaceHyperlink | null {
  const href = drawing.hyperlinkHref;
  if (!href) return null;
  const paragraphId =
    drawing.kind === 'anchoredDrawing' ? drawing.anchorParagraphId : drawing.paragraphId;
  const start = drawing.kind === 'inlineDrawing' ? drawing.start : 0;
  const kind: SurfaceHyperlink['kind'] = href.startsWith('#') ? 'internal' : 'external';
  return Object.freeze({
    id: drawing.drawingNodeId,
    paragraphId,
    start,
    end: start + 1,
    text: '',
    kind,
    href,
    authored: href,
    ...(kind === 'internal' ? { anchor: href.slice(1) } : {}),
  });
}

function visitDrawing(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  drawingNodeId: string
): SurfaceHyperlink | null {
  if (drawing.drawingNodeId !== drawingNodeId) return null;
  return surfaceHyperlinkFromDrawing(drawing);
}

function visitStoryDrawings(
  story: HeaderFooterStoryRecord | undefined,
  drawingNodeId: string
): SurfaceHyperlink | null {
  if (!story) return null;
  for (const drawing of story.anchoredDrawings ?? []) {
    const link = visitDrawing(drawing, drawingNodeId);
    if (link) return link;
  }
  return null;
}

function visitPageDrawings(page: PageRecord, drawingNodeId: string): SurfaceHyperlink | null {
  for (const drawing of page.anchoredDrawings ?? []) {
    const link = visitDrawing(drawing, drawingNodeId);
    if (link) return link;
  }
  for (const fragment of page.fragments) {
    if (fragment.kind === 'table') {
      for (const row of fragment.rows) {
        for (const cell of row.cells) {
          for (const inner of cell.blocks) {
            const fromBlock = visitBlockDrawings(inner, drawingNodeId);
            if (fromBlock) return fromBlock;
          }
        }
      }
      continue;
    }
    const fromParagraph = visitParagraphDrawings(fragment, drawingNodeId);
    if (fromParagraph) return fromParagraph;
  }
  const fromHeader = visitStoryDrawings(page.header, drawingNodeId);
  if (fromHeader) return fromHeader;
  return visitStoryDrawings(page.footer, drawingNodeId);
}

function visitParagraphDrawings(
  fragment: { readonly lines: readonly { readonly drawings?: readonly InlineDrawingRecord[] }[] },
  drawingNodeId: string
): SurfaceHyperlink | null {
  for (const line of fragment.lines) {
    for (const drawing of line.drawings ?? []) {
      const link = visitDrawing(drawing, drawingNodeId);
      if (link) return link;
    }
  }
  return null;
}

function visitBlockDrawings(
  block:
    | import('../layout/semantic-records.ts').ParagraphFragmentRecord
    | import('../layout/semantic-records.ts').TableFragmentRecord,
  drawingNodeId: string
): SurfaceHyperlink | null {
  if (block.kind === 'table') {
    for (const row of block.rows) {
      for (const cell of row.cells) {
        for (const inner of cell.blocks) {
          const link = visitBlockDrawings(inner, drawingNodeId);
          if (link) return link;
        }
      }
    }
    return null;
  }
  return visitParagraphDrawings(block, drawingNodeId);
}

/** Resolve a sanitized drawing hyperlink from the current layout projection. */
export function drawingLinkByIdFromLayout(
  layout: SemanticLayout,
  drawingNodeId: string
): SurfaceHyperlink | null {
  for (const page of layout.pages) {
    const link = visitPageDrawings(page, drawingNodeId);
    if (link) return link;
  }
  return null;
}
