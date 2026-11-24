// Text frames share bounded scanline reflow with drawings and floating tables.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ExclusionColumnLayout, ExclusionZone } from './drawing-exclusion.ts';
import type { PageRecord } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

const styleFrames = new WeakMap<StyleCascadeTable, boolean>();

/** Cheap admission check; unsupported frames produce no zones during collection. */
export function hasParagraphFrames(
  blocks: readonly OoxmlElement[],
  styles: StyleCascadeTable | undefined
): boolean {
  if (styles) {
    let hasStyleFrame = styleFrames.get(styles);
    if (hasStyleFrame === undefined) {
      hasStyleFrame = styles.docDefaultsParagraph.some(
        (property) => property.localName === 'framePr'
      );
      for (const style of styles.styles.values()) {
        if (style.paragraphProperties.some((property) => property.localName === 'framePr')) {
          hasStyleFrame = true;
          break;
        }
      }
      styleFrames.set(styles, hasStyleFrame);
    }
    if (hasStyleFrame) return true;
  }
  let framed = framedBlockLists.get(blocks);
  if (framed === undefined) {
    framed = blocks.some(
      (block) =>
        block.kind === 'paragraph' &&
        block.children.some(
          (child) =>
            child.kind === 'paragraphProperties' &&
            child.children.some((property) => property.localName === 'framePr')
        )
    );
    framedBlockLists.set(blocks, framed);
  }
  return framed;
}

/** Whether a block list holds a framed paragraph, by list; the blocks never change. */
const framedBlockLists = new WeakMap<readonly OoxmlElement[], boolean>();

/** Each shared frame contributes one exclusion, regardless of its paragraph count. */
export function addParagraphFrameExclusions(
  pages: readonly Pick<PageRecord, 'fragments'>[],
  existing: ReadonlyMap<number, readonly ExclusionZone[]>,
  columns: ExclusionColumnLayout
): ReadonlyMap<number, readonly ExclusionZone[]> {
  let result: Map<number, readonly ExclusionZone[]> | undefined;
  for (const [pageIndex, page] of pages.entries()) {
    const groups = new Set<string>();
    let zones: ExclusionZone[] | undefined;
    for (const block of page.fragments) {
      if (block.kind !== 'paragraph') continue;
      const frame = block.positionedFrame;
      if (!frame || groups.has(frame.groupId)) continue;
      groups.add(frame.groupId);
      const box = frame.box;
      const column = frame.columnIndex;
      const left = columns.columnLefts?.[column] ?? 0;
      const width = columns.columnWidths?.[column] ?? columns.contentWidth;
      const distances = {
        left: frame.hSpace,
        right: frame.hSpace,
        top: frame.vSpace,
        bottom: frame.vSpace,
      };
      const fullWidth =
        box.x - frame.hSpace <= left && box.x + box.width + frame.hSpace >= left + width;
      const beside =
        frame.wrap === 'auto' ||
        frame.wrap === 'around' ||
        frame.wrap === 'tight' ||
        frame.wrap === 'through';
      const polygon =
        frame.wrap === 'tight' || frame.wrap === 'through'
          ? [
              { x: box.x, y: box.y },
              { x: box.x + box.width, y: box.y },
              { x: box.x + box.width, y: box.y + box.height },
              { x: box.x, y: box.y + box.height },
            ]
          : null;
      const zone: ExclusionZone = {
        sourceKind: 'frame',
        sourceOrder: frame.sourceOrder,
        drawingNodeId: `frame:${frame.groupId}`,
        anchorParagraphId: frame.anchorId,
        anchorModelStart: 0,
        // A page- or margin-positioned frame keeps its band when earlier text reflows.
        ...(frame.pageFramed ? { pageFramedBand: true } : {}),
        paintLayer: 'inFront',
        relativeHeight: 0,
        allowOverlap: true,
        columnIndex: column,
        y: box.y,
        verticalBand: {
          x: box.x - frame.hSpace,
          y: box.y - frame.vSpace,
          width: box.width + 2 * frame.hSpace,
          height: box.height + 2 * frame.vSpace,
        },
        input: {
          mode:
            !beside || fullWidth
              ? 'topAndBottom'
              : frame.wrap === 'tight'
                ? 'tight'
                : frame.wrap === 'through'
                  ? 'through'
                  : 'square',
          contentBounds: box,
          polygon,
          clipPolygon: null,
          wrapDistances: distances,
          effectInsets: { left: 0, right: 0, top: 0, bottom: 0 },
          textSide: 'bothSides',
          contentLeft: left,
          contentRight: left + width,
        },
      };
      zones ??= [...(existing.get(pageIndex) ?? [])];
      zones.push(zone);
    }
    if (zones) {
      result ??= new Map(existing);
      result.set(pageIndex, zones);
    }
  }
  return result ?? existing;
}

/** A full-width exclusion must leave some vertical room for its anchor on a fresh page. */
export function unplaceableParagraphFrameIds(
  pages: readonly PageRecord[],
  allFrames = false
): ReadonlySet<string> {
  const refused = new Set<string>();
  for (const page of pages) {
    const groups = new Set<string>();
    const capsByAnchor = new Map<string, string>();
    for (const block of page.fragments) {
      if (block.kind !== 'paragraph' || !block.positionedFrame) continue;
      const frame = block.positionedFrame;
      if (frame.dropCapLines !== undefined) {
        const previous = capsByAnchor.get(frame.anchorId);
        if (previous) {
          groups.add(previous);
          groups.add(frame.groupId);
        }
        capsByAnchor.set(frame.anchorId, frame.groupId);
      }
      const blocking =
        !['auto', 'around', 'tight', 'through'].includes(frame.wrap) ||
        (frame.box.x - frame.hSpace <= 0 &&
          frame.box.x + frame.box.width + frame.hSpace >= page.contentBox.width);
      const top = frame.box.y - frame.vSpace;
      const bottom = frame.box.y + frame.box.height + frame.vSpace;
      if (
        allFrames ||
        (frame.dropCapLines !== undefined &&
          (!frame.anchorId || bottom > page.contentBox.height + 0.001)) ||
        (blocking &&
          bottom > 0 &&
          top < page.contentBox.height &&
          frame.box.height + 2 * frame.vSpace >= page.contentBox.height - 0.001)
      )
        groups.add(frame.groupId);
    }
    for (const block of page.fragments) {
      if (
        block.kind === 'paragraph' &&
        block.positionedFrame &&
        groups.has(block.positionedFrame.groupId)
      )
        refused.add(block.paragraphId);
    }
  }
  return refused;
}
