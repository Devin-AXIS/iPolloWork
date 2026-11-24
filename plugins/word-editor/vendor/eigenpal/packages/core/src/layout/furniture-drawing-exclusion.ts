import { indexInlineDrawingProjectionsInPart } from '../store/package/drawing-projection.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  DrawingExclusionConvergenceError,
  exclusionZoneFromAnchoredDrawing,
  localizeExclusionZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { furnitureTableZones, storyHasFloatingTable } from './furniture-table-exclusion.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';
import type { PageFurniture } from './page-furniture-insets.ts';
import { TablePaginationError } from './semantic-table-layout.ts';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import type { HeaderFooterStoryRecord, PageRecord } from './semantic-records.ts';

const projectionsByPart = new WeakMap<
  OoxmlPart,
  ReturnType<typeof indexInlineDrawingProjectionsInPart>
>();

// Keep this check aligned with `exclusionZoneFromAnchoredDrawing`.
const wraps = (drawing: AnchoredDrawingRecord): boolean =>
  !['inline', 'behind', 'inFront'].includes(drawing.wrap);

function anyFurnitureDrawing(
  furniture: PageFurniture | undefined,
  test: (drawing: AnchoredDrawingRecord) => boolean
): boolean {
  if (!furniture) return false;
  for (const stories of [furniture.headers, furniture.footers])
    for (const story of stories.values()) if (story.anchoredDrawings?.some(test)) return true;
  return false;
}

/**
 * Whether any header or footer variant wraps body text, with a drawing or a floating table;
 * `omitHidden` skips hidden drawing records.
 */
export function hasFurnitureDrawingExclusions(
  furniture: PageFurniture | undefined,
  omitHidden = false
): boolean {
  if (!furniture) return false;
  for (const stories of [furniture.headers, furniture.footers])
    for (const story of stories.values()) if (storyHasFloatingTable(story)) return true;
  return anyFurnitureDrawing(
    furniture,
    (drawing) => wraps(drawing) && !(omitHidden && drawing.accessibility.hidden)
  );
}

/** After a retry, inspect retained exclusions across first, even, and default page variants. */
export function retainedFurnitureWrap(
  furniture: PageFurniture | undefined,
  omitHidden: boolean | undefined,
  zonesFor: (pageIndex: number, omitHidden?: boolean) => readonly ExclusionZone[]
): boolean {
  return (
    hasFurnitureDrawingExclusions(furniture, omitHidden) &&
    (!omitHidden || [0, 1, 2].some((index) => zonesFor(index, true).length > 0))
  );
}

// A non-picture drawing with no paint payload is a visible unsupported-content placeholder.
// Pending picture resources and supported vector/text drawings retain their authored wrap.
function unsupportedPlaceholder(drawing: AnchoredDrawingRecord): boolean {
  if (drawing.groupPicture) {
    const failed = (resource: AnchoredDrawingRecord['resource']) =>
      resource.kind !== 'ready' && resource.kind !== 'pending';
    return (
      failed(drawing.resource) ||
      (drawing.groupPictureLayers?.some((layer) => failed(layer.resource)) ?? false)
    );
  }
  return (
    drawing.placeholderGraphicKind !== null &&
    !drawing.vectorShape &&
    !drawing.groupPicture &&
    !drawing.textboxStory &&
    !drawing.groupTextboxStories?.length &&
    !drawing.textArt &&
    drawing.resource.kind !== 'ready'
  );
}

const retryableWrap = (drawing: AnchoredDrawingRecord): boolean =>
  wraps(drawing) && (drawing.accessibility.hidden || unsupportedPlaceholder(drawing));

/**
 * Whether hidden or unsupported placeholder furniture wraps body text
 * in any header or footer variant of the section, or on the host sheet it continues on.
 *
 * When a flow with such a record refuses, layout retries once without hidden zones or
 * full-height unsupported placeholder zones. The placeholder itself remains visible.
 */
export function furnitureHasHiddenWrap(
  furniture: PageFurniture | undefined,
  host: ContinuedPageFurniture | undefined
): boolean {
  if (anyFurnitureDrawing(furniture, retryableWrap)) return true;
  const stories: readonly (HeaderFooterStoryRecord | undefined)[] = [host?.header, host?.footer];
  return stories.some((story) => story?.anchoredDrawings?.some(retryableWrap) ?? false);
}

type FurnitureRetryOptions = {
  readonly drawingExclusionPass?: number;
  readonly drawingExclusionConverged?: boolean;
  readonly yieldHiddenFurnitureZones?: boolean;
  readonly furniture?: PageFurniture;
  readonly continuedPageFurniture?: ContinuedPageFurniture;
};

/**
 * Whether a layout refusal under `options` gets the retry of `refusalYieldsHiddenFurniture`:
 * the outermost call, not yet yielding, with hidden or unsupported furniture. Never during
 * that retry, so a refusal there must be handled where it happens.
 */
export function refusalRetriesWithoutHiddenFurniture(options: FurnitureRetryOptions): boolean {
  return (
    options.drawingExclusionPass === undefined &&
    !options.drawingExclusionConverged &&
    !options.yieldHiddenFurnitureZones &&
    furnitureHasHiddenWrap(options.furniture, options.continuedPageFurniture)
  );
}

/**
 * Whether a refused flow retries without blocking unsupported header and footer zones.
 *
 * Only a layout refusal (wrap exclusion, table pagination) of the outermost call, not yet
 * yielding, with hidden or unsupported furniture. Supported drawing zones stay in the retry,
 * so a refusal they cause repeats and propagates; any other error propagates at once.
 */
export function refusalYieldsHiddenFurniture(
  error: unknown,
  options: FurnitureRetryOptions
): boolean {
  if (!refusalRetriesWithoutHiddenFurniture(options)) return false;
  // Host callbacks can throw proxies whose prototype traps also throw. Preserve the
  // original failure instead of replacing it with an error from retry classification.
  try {
    return (
      error instanceof DrawingExclusionConvergenceError || error instanceof TablePaginationError
    );
  } catch {
    return false;
  }
}

/** Wrapping furniture affects body flow without changing the header/footer story's own height. */
/** Header and footer wrap zones of the body page being filled, before its record exists. */
export function furnitureZonesOnPage(
  box: PageRecord['box'],
  insets: { readonly top: number; readonly height: number },
  marginLeft: number,
  options: {
    readonly width: number;
    readonly story: (kind: 'header' | 'footer') => PageRecord['header'];
    readonly omitHidden?: boolean;
  }
): readonly ExclusionZone[] {
  return furnitureDrawingExclusionsForPage(
    {
      box,
      contentBox: {
        x: box.x + marginLeft,
        y: box.y + insets.top,
        width: options.width,
        height: insets.height,
      },
      header: options.story('header'),
      footer: options.story('footer'),
    },
    options.omitHidden
  );
}

export function furnitureDrawingExclusionsForPage(
  page: Pick<PageRecord, 'header' | 'footer' | 'box' | 'contentBox'>,
  /** Yield hidden zones and full-height unsupported zones during the bounded retry. */
  omitHidden = false
): readonly ExclusionZone[] {
  const added: ExclusionZone[] = [];
  for (const story of [page.header, page.footer]) {
    if (!story?.part) continue;
    // A floating table in the story wraps body text as a floating body table does.
    added.push(...furnitureTableZones(story, page.contentBox));
    if (!story.anchoredDrawings?.length) continue;
    let projections = projectionsByPart.get(story.part);
    if (!projections) {
      projections = indexInlineDrawingProjectionsInPart(story.part);
      projectionsByPart.set(story.part, projections);
    }
    for (const drawing of story.anchoredDrawings) {
      if (omitHidden && drawing.accessibility.hidden) continue;
      const projection = projections.get(drawing.drawingNodeId);
      if (!projection) continue;
      const zone = exclusionZoneFromAnchoredDrawing({
        drawing,
        projection,
        sourceOrder: -1,
        contentLeft: 0,
        contentRight: page.contentBox.width,
      });
      if (!zone) continue;
      const origin = headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box);
      const [localized] = localizeExclusionZones(
        [zone],
        drawing.x - origin.x + page.contentBox.x,
        drawing.y - origin.y + page.contentBox.y,
        { left: 0, right: page.contentBox.width }
      );
      if (
        !localized ||
        localized.verticalBand.y >= page.contentBox.height ||
        localized.verticalBand.y + localized.verticalBand.height <= 0
      )
        continue;
      // A full-height unsupported placeholder must not prevent the body from opening.
      // Yield only its exclusion on the cold retry; keep its visible paint record and source.
      // Smaller placeholder bands still wrap, even when another drawing caused the retry.
      if (
        omitHidden &&
        unsupportedPlaceholder(drawing) &&
        localized.verticalBand.y <= 0 &&
        localized.verticalBand.y + localized.verticalBand.height >= page.contentBox.height
      )
        continue;
      added.push(
        Object.freeze({
          ...localized,
          sourceKind: 'furniture',
          furnitureSource: Object.freeze({
            partName: story.partName,
            kind: 'drawing' as const,
            nodeId: drawing.drawingNodeId,
          }),
          drawingNodeId: `${story.partName}:${drawing.drawingNodeId}`,
          anchorParagraphId: `${story.partName}:${drawing.anchorParagraphId}`,
        })
      );
    }
  }
  return Object.freeze(added);
}

/** The host sheet's header and footer records, for a section that continues on that sheet. */
export type ContinuedPageFurniture = Pick<PageRecord, 'header' | 'footer' | 'box'>;

/**
 * Wrap zones on the host sheet, relative to the content column of the section continuing on it.
 *
 * The host sheet keeps and paints its own header and footer, so a continued section's text on
 * that sheet wraps around THOSE drawings. The section's own furniture starts on its next sheet.
 * `contentLeft` and `contentWidth` are the continued section's column, which can differ from
 * the host's when the margins change.
 */
export function continuedPageFurnitureZones(
  host: ContinuedPageFurniture,
  insets: { readonly top: number; readonly height: number },
  contentLeft: number,
  contentWidth: number,
  omitHidden = false
): readonly ExclusionZone[] {
  return furnitureDrawingExclusionsForPage(
    {
      header: host.header,
      footer: host.footer,
      box: host.box,
      contentBox: {
        x: host.box.x + contentLeft,
        y: host.box.y + insets.top,
        width: contentWidth,
        height: insets.height,
      },
    },
    omitHidden
  );
}
