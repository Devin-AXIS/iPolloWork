// Exporter-neutral laid-out bounds for review artifact occurrences.
//
// Engine-produced occurrences are one paragraph. Cross-paragraph source ranges are sliced
// before this attach pass, so this walk never builds a story-order span index.

import { headerFooterAnchoredDrawingOrigin } from '../layout/header-footer-drawing-origin.ts';
import type { AnchoredDrawingRecord } from '../layout/drawing-layout.ts';
import { xWithinLine } from '../layout/line-geometry.ts';
import { lineSegments } from '../layout/line-segments.ts';
import type {
  SemanticReviewArtifactOccurrence,
  SemanticReviewArtifactOccurrenceGeometry,
  SemanticReviewArtifactRecord,
} from '../layout/review-artifact-records.ts';
import { pageContentOrigin, storyBoxContentOffset } from '../layout/selection-rects.ts';
import { caretAt, type SemanticPosition } from '../layout/semantic-interaction.ts';
import {
  forEachPageStory,
  forEachStoryParagraphFragment,
} from '../layout/semantic-record-queries.ts';
import type { LayoutBox, PageRecord, SemanticLayout } from '../layout/semantic-records.ts';

/**
 * Cap on paragraph→range index entries for one attach pass.
 *
 * Each same-paragraph occurrence registers one binding. A hostile file can name a comment on
 * every laid-out fragment; this keeps that product finite.
 * @internal
 */
export const MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS = 65_536;

let reviewGeometryBindings = 0;

/**
 * Warm-path recorder for review geometry index construction.
 * @internal
 */
export function reviewGeometryIndexRecorder(): {
  readonly bindings: number;
  reset(): void;
} {
  return {
    get bindings() {
      return reviewGeometryBindings;
    },
    reset() {
      reviewGeometryBindings = 0;
    },
  };
}

interface IndexedRange {
  readonly key: string;
  readonly from: SemanticPosition;
  readonly to: SemanticPosition;
  readonly pageIndex: number;
}

function storyOriginInPageContent(
  page: PageRecord,
  origin: Readonly<{ x: number; y: number }>
): { readonly x: number; readonly y: number } {
  return {
    x: origin.x - page.contentBox.x,
    y: origin.y - page.contentBox.y,
  };
}

function textboxPathsMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function rootStoryMatches(
  occurrence: SemanticReviewArtifactOccurrence,
  rootStory: SemanticReviewArtifactOccurrence['rootStory'],
  noteScopeId: string | null
): boolean {
  if (occurrence.rootStory !== rootStory) return false;
  if (rootStory === 'footnote' || rootStory === 'endnote') {
    return occurrence.noteScopeId === noteScopeId;
  }
  return true;
}

function textboxPageContentOffset(
  page: PageRecord,
  occurrence: SemanticReviewArtifactOccurrence
): { readonly x: number; readonly y: number } | null {
  if (occurrence.story !== 'textbox' || occurrence.textboxPath.length === 0) return null;
  let found: { readonly x: number; readonly y: number } | null = null;
  forEachPageStory(page, (root) => {
    if (found) return;
    if (!rootStoryMatches(occurrence, root.story, root.noteScopeId)) return;
    const rootDrawingOrigin =
      root.story === 'header' || root.story === 'footer'
        ? (drawing: AnchoredDrawingRecord) =>
            headerFooterAnchoredDrawingOrigin(drawing, root.origin, {
              x: page.box.x,
              y: page.box.y,
            })
        : undefined;
    forEachStoryParagraphFragment(
      root.host,
      (_fragment, context) => {
        if (found || context.textboxDepth === 0) return;
        const path = context.textboxPath.map((drawing) => drawing.drawingNodeId);
        if (!textboxPathsMatch(path, occurrence.textboxPath)) return;
        found = storyOriginInPageContent(page, context.storyOrigin);
      },
      root.origin,
      rootDrawingOrigin
    );
  });
  return found;
}

/**
 * Story origin for an occurrence.
 *
 * Keys by `rootStory` and `noteScopeId` because a note-separator is not in the paragraph walk
 * of `storyContentOffset`. Offset arithmetic stays in {@link storyBoxContentOffset}.
 */
function occurrencePageContentOffset(
  page: PageRecord,
  occurrence: SemanticReviewArtifactOccurrence
): { readonly x: number; readonly y: number } {
  if (occurrence.story === 'textbox') {
    return textboxPageContentOffset(page, occurrence) ?? { x: 0, y: 0 };
  }
  switch (occurrence.rootStory) {
    case 'body':
      return { x: 0, y: 0 };
    case 'header':
      return page.header ? storyBoxContentOffset(page, page.header.box) : { x: 0, y: 0 };
    case 'footer':
      return page.footer ? storyBoxContentOffset(page, page.footer.box) : { x: 0, y: 0 };
    case 'footnote':
    case 'endnote': {
      const area = occurrence.rootStory === 'footnote' ? page.footnotes : page.endnotes;
      const note = area?.notes.find((entry) => entry.scopeId === occurrence.noteScopeId);
      return note ? storyBoxContentOffset(page, note.box) : { x: 0, y: 0 };
    }
    case 'note-separator': {
      const area = occurrence.noteAreaKind === 'endnotes' ? page.endnotes : page.footnotes;
      let box = area?.separator?.box;
      if (area?.continuationNotice) {
        forEachStoryParagraphFragment(area.continuationNotice, (paragraph) => {
          if (paragraph.paragraphId === occurrence.source.start.paragraphId)
            box = area.continuationNotice!.box;
        });
      }
      return box ? storyBoxContentOffset(page, box) : { x: 0, y: 0 };
    }
    default:
      return { x: 0, y: 0 };
  }
}

interface IndexedRect extends LayoutBox {
  readonly pageIndex: number;
}

function freezeRect(rect: LayoutBox): LayoutBox {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function toPageStackRect(page: PageRecord, rect: LayoutBox): LayoutBox {
  const origin = pageContentOrigin(page);
  return Object.freeze({
    x: origin.x + rect.x,
    y: origin.y + rect.y,
    width: rect.width,
    height: rect.height,
  });
}

function pointGeometry(
  layout: SemanticLayout,
  occurrence: SemanticReviewArtifactOccurrence
): SemanticReviewArtifactOccurrenceGeometry | undefined {
  const caret = caretAt(
    layout,
    {
      paragraphId: occurrence.source.start.paragraphId,
      offset: occurrence.source.start.offset,
    },
    { preferredPageIndex: occurrence.pageIndex }
  );
  if (!caret || caret.pageIndex !== occurrence.pageIndex) return undefined;
  const page = layout.pages[caret.pageIndex];
  if (!page) return undefined;
  const origin = occurrencePageContentOffset(page, occurrence);
  const pageContent = Object.freeze([
    freezeRect({
      x: caret.x + origin.x,
      y: caret.y + origin.y,
      width: 0,
      height: caret.height,
    }),
  ]);
  return Object.freeze({
    pageContent,
    pageStack: Object.freeze(pageContent.map((rect) => toPageStackRect(page, rect))),
  });
}

function geometryOfOccurrence(
  layout: SemanticLayout,
  occurrence: SemanticReviewArtifactOccurrence,
  rects: readonly IndexedRect[]
): SemanticReviewArtifactOccurrenceGeometry | undefined {
  const onPage = rects.filter((rect) => rect.pageIndex === occurrence.pageIndex);
  if (onPage.length === 0) {
    return isPointOccurrence(occurrence) ? pointGeometry(layout, occurrence) : undefined;
  }
  const page = layout.pages[occurrence.pageIndex];
  if (!page) return undefined;
  const pageContent = Object.freeze(onPage.map((rect) => freezeRect(rect)));
  return Object.freeze({
    pageContent,
    pageStack: Object.freeze(pageContent.map((rect) => toPageStackRect(page, rect))),
  });
}

function isPointOccurrence(occurrence: SemanticReviewArtifactOccurrence): boolean {
  return (
    occurrence.source.start.paragraphId === occurrence.source.end.paragraphId &&
    occurrence.source.start.offset === occurrence.source.end.offset
  );
}

function rangeKey(pageIndex: number, paragraphId: string): string {
  return `${pageIndex}\0${paragraphId}`;
}

function sameParagraphOverlap(
  segment: { readonly start: number; readonly end: number },
  from: SemanticPosition,
  to: SemanticPosition
): { start: number; end: number } | null {
  const start = Math.max(segment.start, from.offset);
  const end = Math.min(segment.end, to.offset);
  return end > start ? { start, end } : null;
}

function collectIndexedRangeRects(
  layout: SemanticLayout,
  artifacts: readonly SemanticReviewArtifactRecord[]
): Map<string, IndexedRect[]> {
  const found = new Map<string, IndexedRect[]>();
  const byParagraph = new Map<string, IndexedRange[]>();
  const pages = new Set<number>();
  let bindings = 0;
  reviewGeometryBindings = 0;

  const register = (range: IndexedRange, paragraphId: string): boolean => {
    if (bindings >= MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS) return false;
    bindings += 1;
    reviewGeometryBindings = bindings;
    const key = rangeKey(range.pageIndex, paragraphId);
    const list = byParagraph.get(key);
    if (list) list.push(range);
    else byParagraph.set(key, [range]);
    return true;
  };

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    for (const [occurrenceIndex, occurrence] of artifact.occurrences.entries()) {
      if (isPointOccurrence(occurrence)) continue;
      if (occurrence.source.start.paragraphId !== occurrence.source.end.paragraphId) continue;
      pages.add(occurrence.pageIndex);
      const key = `${artifactIndex}\0${occurrenceIndex}`;
      const from = {
        paragraphId: occurrence.source.start.paragraphId,
        offset: occurrence.source.start.offset,
      };
      const to = {
        paragraphId: occurrence.source.end.paragraphId,
        offset: occurrence.source.end.offset,
      };
      const ordered = from.offset <= to.offset ? { from, to } : { from: to, to: from };
      register(
        {
          key,
          from: ordered.from,
          to: ordered.to,
          pageIndex: occurrence.pageIndex,
        },
        ordered.from.paragraphId
      );
    }
  }

  if (byParagraph.size === 0) return found;

  for (const page of layout.pages) {
    if (!pages.has(page.index)) continue;
    forEachPageStory(page, (root) => {
      const rootDrawingOrigin =
        root.story === 'header' || root.story === 'footer'
          ? (drawing: AnchoredDrawingRecord) =>
              headerFooterAnchoredDrawingOrigin(drawing, root.origin, {
                x: page.box.x,
                y: page.box.y,
              })
          : undefined;
      forEachStoryParagraphFragment(
        root.host,
        (fragment, context) => {
          const offset = storyOriginInPageContent(page, context.storyOrigin);
          for (const line of fragment.lines) {
            for (const segment of lineSegments(line)) {
              const ranges = byParagraph.get(rangeKey(page.index, segment.paragraphId));
              if (!ranges) continue;
              for (const range of ranges) {
                const overlap = sameParagraphOverlap(segment, range.from, range.to);
                if (!overlap) continue;
                const startX = xWithinLine(line, overlap.start, undefined, segment);
                const endX = xWithinLine(
                  line,
                  overlap.end,
                  undefined,
                  segment,
                  overlap.end > overlap.start
                );
                const rects = found.get(range.key) ?? [];
                rects.push({
                  pageIndex: page.index,
                  x: Math.min(startX, endX) + offset.x,
                  y: line.box.y + offset.y,
                  width: Math.abs(endX - startX),
                  height: line.box.height,
                });
                found.set(range.key, rects);
              }
            }
          }
        },
        root.origin,
        rootDrawingOrigin
      );
    });
  }
  return found;
}

/** Attach laid-out geometry to every occurrence that can be measured on this layout. @internal */
export function attachReviewArtifactGeometry(
  layout: SemanticLayout,
  artifacts: readonly SemanticReviewArtifactRecord[]
): readonly SemanticReviewArtifactRecord[] {
  let hasOccurrence = false;
  for (const artifact of artifacts) {
    if (artifact.occurrences.length === 0) continue;
    hasOccurrence = true;
    break;
  }
  if (!hasOccurrence) return artifacts;
  const rectsByKey = collectIndexedRangeRects(layout, artifacts);
  return artifacts.map((artifact, artifactIndex) => {
    if (artifact.occurrences.length === 0) return artifact;
    const occurrences = artifact.occurrences.map((occurrence, occurrenceIndex) => {
      const key = `${artifactIndex}\0${occurrenceIndex}`;
      const geometry = geometryOfOccurrence(layout, occurrence, rectsByKey.get(key) ?? []);
      if (!geometry) return occurrence;
      return { ...occurrence, geometry };
    });
    return { ...artifact, occurrences: Object.freeze(occurrences) };
  });
}
