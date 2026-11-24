// Wrap zones a continued section inherits from the sheet it continues on.
//
// A `continuous` section break keeps the next section on the same sheet. The floating tables
// and wrapping pictures an earlier section placed there still occupy that sheet, so the new
// section's text flows beside them, and below them only where no room is left. The section
// does not restart below the lowest float: the earlier objects are obstacles on the shared
// sheet, the same as the header and footer drawings that sheet paints.
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  collectExclusionZonesFromDrawings,
  localizeExclusionZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import {
  continuedPageFurnitureZones,
  type ContinuedPageFurniture,
} from './furniture-drawing-exclusion.ts';
import type { PageRecord } from './semantic-records.ts';
import { addFloatingTableExclusions } from './table-float-exclusion.ts';
import { addParagraphFrameExclusions } from './paragraph-frame-exclusion.ts';

/** The host sheet a continued section lays its first page onto. */
export type ContinuedPageHost = ContinuedPageFurniture &
  Partial<Pick<PageRecord, 'contentBox' | 'fragments' | 'anchoredDrawings'>>;

/**
 * Wrap zones of the floating tables and wrapping pictures already on the host sheet.
 *
 * Returned in the continued section's own content coordinates. `contentLeft` and
 * `contentWidth` are that section's column, which can differ from the host's when the margins
 * change. Each zone is marked {@link ExclusionZone.earlierSection}: its anchor lies in an
 * earlier section, so it reaches every line and column of the continued section on this sheet.
 */
export function earlierSectionZones(
  host: ContinuedPageHost,
  contentLeft: number,
  contentWidth: number,
  drawingLayout: InlineDrawingLayoutContext | undefined
): readonly ExclusionZone[] {
  if (!host.contentBox || !host.fragments) return Object.freeze([]);
  // The host sheet record is reused while nothing on it changes, so every pass of this section
  // (reflow, column balance, the next keystroke) shares one result.
  const memo = earlierZonesMemo.get(host);
  if (
    memo &&
    memo.contentLeft === contentLeft &&
    memo.contentWidth === contentWidth &&
    memo.drawingLayout === drawingLayout
  )
    return memo.zones;
  const zones = collectEarlierSectionZones(host, contentLeft, contentWidth, drawingLayout);
  earlierZonesMemo.set(host, { contentLeft, contentWidth, drawingLayout, zones });
  return zones;
}

const earlierZonesMemo = new WeakMap<
  object,
  {
    readonly contentLeft: number;
    readonly contentWidth: number;
    readonly drawingLayout: InlineDrawingLayoutContext | undefined;
    readonly zones: readonly ExclusionZone[];
  }
>();

function collectEarlierSectionZones(
  host: ContinuedPageHost,
  contentLeft: number,
  contentWidth: number,
  drawingLayout: InlineDrawingLayoutContext | undefined
): readonly ExclusionZone[] {
  if (!host.contentBox || !host.fragments) return Object.freeze([]);
  const hostWidth = host.contentBox.width;
  const layout = Object.freeze({ columnCount: 1, columnGapPt: 0, contentWidth: hostWidth });
  const drawings =
    drawingLayout && host.anchoredDrawings?.length
      ? collectExclusionZonesFromDrawings(
          host.anchoredDrawings,
          drawingLayout,
          0,
          hostWidth,
          undefined,
          layout
        )
      : [];
  // Text frames are obstacles too; a drop cap stays with its own anchor paragraph.
  const frames = host.fragments.filter(
    (block) =>
      block.kind === 'paragraph' &&
      block.positionedFrame &&
      block.positionedFrame.dropCapLines === undefined
  );
  const zones =
    addParagraphFrameExclusions(
      [{ fragments: frames }],
      addFloatingTableExclusions([{ fragments: host.fragments }], new Map([[0, drawings]]), layout),
      layout
    ).get(0) ?? [];
  if (zones.length === 0) return Object.freeze([]);
  const hostLeft = host.contentBox.x - host.box.x;
  return Object.freeze(
    localizeExclusionZones(zones, contentLeft - hostLeft, 0, {
      left: 0,
      right: contentWidth,
    }).map((zone) => Object.freeze({ ...zone, earlierSection: true }))
  );
}

/**
 * Every wrap zone on a continued section's local page 0: the host sheet's header and footer
 * drawings, then the floats earlier sections placed on it.
 */
export function continuedPageZones(
  host: ContinuedPageHost,
  insets: { readonly top: number; readonly height: number },
  contentLeft: number,
  contentWidth: number,
  options: {
    readonly omitHiddenFurniture?: boolean;
    readonly drawingLayout?: InlineDrawingLayoutContext;
  }
): readonly ExclusionZone[] {
  const furniture = continuedPageFurnitureZones(
    host,
    insets,
    contentLeft,
    contentWidth,
    options.omitHiddenFurniture
  );
  const body = earlierSectionZones(host, contentLeft, contentWidth, options.drawingLayout);
  return body.length ? Object.freeze([...furniture, ...body]) : furniture;
}

/**
 * Whether page furniture wraps this pass's text (`furnitureHasWrap`), and whether it keeps the
 * pass's positioned tables in flow (`furnitureHoldsTables`). Floating tables an earlier section
 * left on the host sheet wrap text but do not keep this section's floating tables in flow.
 */
export function continuedWrapFlags(
  ownFurnitureWraps: boolean,
  continuedZones: readonly ExclusionZone[] | undefined
): {
  readonly furnitureHasWrap: boolean;
  readonly furnitureHoldsTables: boolean;
  /** The zones a positioned table's admission reads: page 0 adds earlier pictures. */
  readonly admission: (
    zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined
  ) => ReadonlyMap<number, readonly ExclusionZone[]> | undefined;
} {
  return {
    furnitureHasWrap: ownFurnitureWraps || (continuedZones?.length ?? 0) > 0,
    furnitureHoldsTables:
      ownFurnitureWraps || (continuedZones?.some((zone) => !zone.earlierSection) ?? false),
    admission: (zones) => withEarlierPictures(zones, continuedZones),
  };
}

const admissionMemo = new WeakMap<
  readonly ExclusionZone[],
  {
    readonly zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined;
    readonly merged: ReadonlyMap<number, readonly ExclusionZone[]> | undefined;
  }
>();

/**
 * Body zones for admission, with the pictures an earlier section left on page 0. A table whose
 * cells such a picture can wrap keeps row pagination, as with pictures of its own section.
 * Earlier floating tables are left out: they never wrap a floating table's cells. Stable for
 * equal inputs, since the admission check memoizes on the map.
 */
function withEarlierPictures(
  zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined,
  continuedZones: readonly ExclusionZone[] | undefined
): ReadonlyMap<number, readonly ExclusionZone[]> | undefined {
  const pictures = continuedZones?.filter((zone) => zone.earlierSection && !zone.sourceKind);
  if (!continuedZones || !pictures?.length) return zones;
  const memo = admissionMemo.get(continuedZones);
  if (memo && memo.zones === zones) return memo.merged;
  const merged = new Map(zones);
  // Anchored before every paragraph of this section.
  const earlier = pictures.map((zone) => Object.freeze({ ...zone, sourceOrder: -1 }));
  merged.set(0, Object.freeze([...(zones?.get(0) ?? []), ...earlier]));
  admissionMemo.set(continuedZones, { zones, merged });
  return merged;
}
