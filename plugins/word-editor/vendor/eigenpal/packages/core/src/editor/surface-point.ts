import { sameNoteStory } from './surface-note-story.ts';
import type { PointerHost, SurfacePointHit } from './surface-pointer.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type { AnchoredDrawingRecord } from '../layout/drawing-layout.ts';
import { turnedInlineDrawings } from '../layout/turned-inline-drawing-hit.ts';
import { drawingPaintsPastBox } from '../layout/vector-shape-hit.ts';
import {
  findDrawingOverlayFrameInLayout,
  pageAtY,
  hitTestFragments,
  hitTestPage,
  type SemanticHit,
} from '../layout/semantic-hit-test.ts';
import {
  activeStoryDrawingAtSheetPoint,
  findNoteAtSheetPoint,
  findStoryAtSheetPoint,
  isBodyContentPoint,
  storyMatchesBinding,
  hitTestStoryAtLocalPoint,
  storyHitYieldsToBody,
} from './surface-scope.ts';

/** Strict point reads inspect one page and never change the active selection. */
export function surfacePointAt(
  host: PointerHost,
  clientX: number,
  clientY: number
): SurfacePointHit | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !host.pagesLayer.isConnected)
    return null;
  // Public reads do not retain a gesture's DOM origin across host layout changes.
  const pagesLayer = host.pagesLayer;
  const layout = host.layout();
  const rect = pagesLayer.getBoundingClientRect();
  const scale = host.scale() || 1;
  const sheet = { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  const index = pageAtY(layout, sheet.y);
  const page = layout.pages[index];
  if (!page) return null;
  const x = sheet.x - host.pageOffsetX(index);
  const box = page.box;
  if (x < box.x || x >= box.x + box.width || sheet.y < box.y || sheet.y >= box.y + box.height)
    return null;
  const pageLayout = { ...layout, pages: [page] };
  const options = host.measurer() ? { measurer: host.measurer()! } : {};
  let origin = { x: page.contentBox.x + host.pageOffsetX(index), y: page.contentBox.y };
  let hit: SemanticHit | null;
  const activeNote = host.activeNote?.();
  const activeStory = host.activeHeaderFooter?.();
  if (activeNote) {
    const note = findNoteAtSheetPoint(pageLayout, sheet, host.pageOffsetX);
    if (!note || !sameNoteStory(note.scopeId, activeNote.scopeId)) return null;
    origin = { x: sheet.x - note.local.x, y: sheet.y - note.local.y };
    hit = hitTestFragments(layout, index, note.fragments, note.local, options);
  } else if (activeStory) {
    const binding = {
      scope: { kind: 'headerFooter' as const, rId: activeStory.rId },
      ...activeStory,
    };
    const story = findStoryAtSheetPoint(pageLayout, sheet, host.pageOffsetX);
    if (index !== activeStory.pageIndex || !story || !storyMatchesBinding(story.story, binding)) {
      // Past the band, only the open story's own drawings answer (a watermark).
      const drawing = activeStoryDrawingAtSheetPoint(layout, binding, sheet, host.pageOffsetX);
      return drawing ? { hit: drawing, x: sheet.x, y: sheet.y } : null;
    }
    origin = { x: sheet.x - story.local.x, y: sheet.y - story.local.y };
    hit = hitTestStoryAtLocalPoint(layout, index, story.story, story.local, options);
  } else {
    if (!isBodyContentPoint(layout, sheet, host.pageOffsetX)) return null;
    if (findNoteAtSheetPoint(pageLayout, sheet, host.pageOffsetX)) return null;
    const story = findStoryAtSheetPoint(pageLayout, sheet, host.pageOffsetX);
    if (
      story &&
      !storyHitYieldsToBody(layout, story, sheet, host.pageOffsetX, false, options.measurer)
    )
      return null;
    hit = hitTestPage(layout, index, { x: sheet.x - origin.x, y: sheet.y - origin.y }, options);
  }
  if (
    !hit ||
    hit.pageIndex !== index ||
    host.isReadOnlyPosition?.(hit.position) ||
    host.isReadOnlyParagraph?.(hit.position.paragraphId)
  )
    return null;
  return { hit, x: origin.x + hit.caret.x, y: origin.y + hit.caret.y };
}

/**
 * Whether a repeated press stays on an object rather than selecting a word or a paragraph.
 * For a drawing the layout places, the hit decides, not the painted box: inside a shape with
 * no fill is text. A text box takes its repeated presses elsewhere.
 */
export function repeatedPressOnObject(
  layout: SemanticLayout,
  hit: SemanticHit,
  target: Element | null
): boolean {
  if (target?.closest('.docx-drawing-textbox')) return false;
  if (hit.drawing) return true;
  const painted = target?.closest('[data-drawing-node-id]')?.getAttribute('data-drawing-node-id');
  return painted != null && findDrawingOverlayFrameInLayout(layout, painted) === null;
}

/** A drawing a press reaches through the text; in an open story, also the page it is on. */
export type BehindDrawingHit = NonNullable<SemanticHit['drawing']> & {
  readonly pageIndex?: number;
};

/**
 * The body drawing that a press at a client point reaches by geometry, as the body's own hit
 * test resolves it, page margins included: a drawing behind the text, outside every text line,
 * or a turned shape, or a shape that paints past its box, on what it paints, which can lie past
 * its box and past the text column.
 * Null in a note, on a header or footer band, over another front drawing, and over a read-only
 * position. With a header or footer open, its own drawing that the press reaches instead, past
 * its band too (a watermark). That drawing names its page, which can be another page that
 * shows the story.
 */
export function behindDrawingAt(
  host: PointerHost,
  clientX: number,
  clientY: number
): BehindDrawingHit | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !host.pagesLayer.isConnected)
    return null;
  if (host.activeNote?.()) return null;
  const active = host.activeHeaderFooter?.();
  if (active) {
    const hit = surfacePointAt(host, clientX, clientY)?.hit;
    return hit?.drawing ? { ...hit.drawing, pageIndex: hit.pageIndex } : null;
  }
  const layout = host.layout();
  const rect = host.pagesLayer.getBoundingClientRect();
  const scale = host.scale() || 1;
  const sheet = { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  const index = pageAtY(layout, sheet.y);
  const page = layout.pages[index];
  if (!page) return null;
  const turned = turnedInlineDrawings(page.fragments);
  const reachable = (drawing: AnchoredDrawingRecord) =>
    drawing.behindDocument ||
    !!drawing.vectorShape?.rotationDegrees ||
    drawingPaintsPastBox(drawing);
  if (!page.anchoredDrawings?.some(reachable) && turned.length === 0) return null;
  const x = sheet.x - host.pageOffsetX(index);
  const box = page.box;
  if (x < box.x || x >= box.x + box.width || sheet.y < box.y || sheet.y >= box.y + box.height)
    return null;
  const pageLayout = { ...layout, pages: [page] };
  if (findNoteAtSheetPoint(pageLayout, sheet, host.pageOffsetX)) return null;
  const options = host.measurer() ? { measurer: host.measurer()! } : {};
  // A press on a header or footer band belongs to that story (a double press opens it).
  const story = findStoryAtSheetPoint(pageLayout, sheet, host.pageOffsetX);
  if (
    story &&
    !storyHitYieldsToBody(layout, story, sheet, host.pageOffsetX, false, options.measurer)
  )
    return null;
  const point = { x: x - page.contentBox.x, y: sheet.y - page.contentBox.y };
  const hit = hitTestPage(layout, index, point, options);
  const drawing = hit?.drawing;
  if (!drawing || host.isReadOnlyPosition?.(hit.position)) return null;
  const id = drawing.drawingNodeId;
  const record = page.anchoredDrawings?.find((d) => d.drawingNodeId === id);
  if (record) return reachable(record) ? drawing : null;
  return turned.some((entry) => entry.drawing.drawingNodeId === id) ? drawing : null;
}
