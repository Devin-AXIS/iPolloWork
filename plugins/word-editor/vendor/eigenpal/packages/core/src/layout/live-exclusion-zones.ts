// The exclusion zones of the pictures a pass has already placed, read from the pass itself.
//
// A reflow pass lays every page out under the zones the previous pass collected. A picture
// positioned against its paragraph moves whenever the text before it moves, so its collected
// zone is where the previous pass put it. After an edit that moves text (a page break, a longer
// paragraph) the text below a picture wraps around its old place, and each pass repairs about
// one more page of that. The pass count then grows with the document, and every pass lays out
// the whole document.
//
// The pictures this pass has placed are known: their records sit in the page being filled.
// Zone collection reads each record on its own, with the same inputs
// (`exclusion-collection-inputs.ts`), so the zone made from a placed record is the zone the
// pass will collect for it. Text placed after it reads that zone instead of the previous
// pass's, and a picture placed on an earlier page of this pass loses its old zone here. Zones
// of pictures not placed yet (an object reaching back over earlier text, the paragraph being
// laid out) still come from the previous pass. At a fixed point the two agree.
//
// Only pictures are live. Text-anchored floating tables and frames still take their zones from
// the previous pass, so a document of many of those still settles about one page per pass.

import type { AnchoredDrawingRecord, InlineDrawingLayoutContext } from './drawing-layout.ts';
import { collectExclusionZonesFromDrawings, type ExclusionZone } from './drawing-exclusion.ts';
import { exclusionColumnLayoutOf, exclusionSourceOrderOf } from './exclusion-collection-inputs.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { PageRecord } from './semantic-records.ts';
import type { ResolvedSectionColumns } from './section-columns.ts';

type ZonesByPage = ReadonlyMap<number, readonly ExclusionZone[]>;

let liveZonesOffForTest = false;

/**
 * Reads every zone from the previous pass until the returned function runs: the oracle live
 * zones must settle on. @internal
 */
export function disableLiveExclusionZonesForTest(): () => void {
  liveZonesOffForTest = true;
  return () => {
    liveZonesOffForTest = false;
  };
}

/** The ids of the paragraphs in `bodies` outside every table, through block containers. */
function flowParagraphIdsOf(bodies: readonly OoxmlElement[]): Set<string> {
  const ids = new Set<string>();
  const pending: OoxmlElement[] = [...bodies];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'paragraph') ids.add(node.id);
    else if (node.kind !== 'table')
      for (const child of node.children) if (child.kind !== 'textValue') pending.push(child);
  }
  return ids;
}

/** A body picture's zone, as opposed to a table's, a frame's or an earlier section's. */
const bodyPicture = (zone: ExclusionZone): boolean =>
  zone.sourceKind === undefined && !zone.earlierSection;
/**
 * A body picture whose placed record replaces its zone. A page- or margin-framed one
 * (`pageFramedBand`) stays where the page puts it, and a reflow cycle may keep it on a page it
 * left on purpose (`cycleZones`), so it always comes from the previous pass.
 */
const followsText = (zone: ExclusionZone): boolean =>
  bodyPicture(zone) && zone.pageFramedBand !== true;

export interface LiveExclusionZones {
  /**
   * `earlier` (the previous pass's zones for the page being filled) with every body picture
   * this pass has placed replaced by the zone of its record in `pending` (the page being
   * filled), or dropped when it landed on one of `pages`.
   */
  zones(
    pages: readonly PageRecord[],
    pending: readonly AnchoredDrawingRecord[],
    earlier: readonly ExclusionZone[]
  ): readonly ExclusionZone[];
  /**
   * `map` (the previous pass's zones of every page) as this pass sees it from the page being
   * filled: that page's live zones, the later pages without the pictures this pass placed, and
   * no completed page. The same map for unchanged inputs, since its readers memoize on it.
   */
  byPage(
    pages: readonly PageRecord[],
    pending: readonly AnchoredDrawingRecord[],
    map: ZonesByPage | undefined
  ): ZonesByPage | undefined;
  /** Whether this pass has read a zone the previous pass did not collect. */
  readonly sawLiveZones: boolean;
}

export function createLiveExclusionZones(
  options: {
    readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
    readonly drawingSourceOrder?: ReadonlyMap<string, number>;
  },
  columns: ResolvedSectionColumns,
  contentWidth: number,
  /** The flow's blocks. */
  bodies: readonly OoxmlElement[]
): LiveExclusionZones {
  // Without a drawing layout, every zone comes from the previous pass.
  const drawingLayout = liveZonesOffForTest ? undefined : options.inlineDrawingLayout;
  // A picture stands on one page only when its paragraph is in the flow itself. One in a table
  // cell can stand on several: a repeated header row places it on every page.
  let flowParagraphs: Set<string> | undefined;
  const anchoredOnOnePage = (paragraphId: string): boolean =>
    (flowParagraphs ??= flowParagraphIdsOf(bodies)).has(paragraphId);
  const columnLayout = exclusionColumnLayoutOf(columns, contentWidth);
  const sourceOrderOf = exclusionSourceOrderOf(options);
  // A record is frozen, and these inputs are the flow's: each record's zone is built once.
  const zoneOfRecord = new WeakMap<AnchoredDrawingRecord, readonly ExclusionZone[]>();
  const liveZonesOf = (pending: readonly AnchoredDrawingRecord[]): ExclusionZone[] => {
    const live: ExclusionZone[] = [];
    for (const record of pending) {
      let zones = zoneOfRecord.get(record);
      if (!zones) {
        zones = collectExclusionZonesFromDrawings(
          [record],
          drawingLayout!,
          0,
          contentWidth,
          sourceOrderOf,
          columnLayout
        ).filter(followsText);
        zoneOfRecord.set(record, zones);
      }
      for (const zone of zones) live.push(zone);
    }
    return live;
  };

  // Pictures on the completed pages of this pass, kept in step with `pages`, which only grows
  // at its end: a last page taken back and laid out again rebuilds the set. `placedRevision`
  // moves whenever the set does.
  const placedOnPages = new Set<string>();
  const scanned: PageRecord[] = [];
  let placedRevision = 0;
  const scan = (pages: readonly PageRecord[]): void => {
    if (scanned.length > pages.length || pages[scanned.length - 1] !== scanned.at(-1)) {
      placedOnPages.clear();
      scanned.length = 0;
      placedRevision += 1;
    }
    if (scanned.length === pages.length) return;
    placedRevision += 1;
    for (let index = scanned.length; index < pages.length; index += 1) {
      const page = pages[index]!;
      scanned.push(page);
      for (const drawing of page.anchoredDrawings ?? [])
        if (anchoredOnOnePage(drawing.anchorParagraphId)) placedOnPages.add(drawing.drawingNodeId);
    }
  };

  // The records of the page being filled, and the pictures they hold.
  let pendingKey: readonly AnchoredDrawingRecord[] = Object.freeze([]);
  let onPage = new Set<string>();
  const notePending = (pending: readonly AnchoredDrawingRecord[]): void => {
    if (pending.length === pendingKey.length && pending.at(-1) === pendingKey.at(-1)) {
      let same = true;
      for (let index = 0; same && index < pending.length; index += 1)
        same = pending[index] === pendingKey[index];
      if (same) return;
    }
    pendingKey = Object.freeze(pending.slice());
    onPage = new Set(pending.map((drawing) => drawing.drawingNodeId));
  };
  const placed = (zone: ExclusionZone): boolean =>
    followsText(zone) && (onPage.has(zone.drawingNodeId) || placedOnPages.has(zone.drawingNodeId));

  let sawLiveZones = false;
  /** `earlier` with its placed pictures replaced by the live zones of `pendingKey`. */
  const merge = (earlier: readonly ExclusionZone[]): readonly ExclusionZone[] => {
    if (pendingKey.length === 0 && !earlier.some(placed)) return earlier;
    const live = liveZonesOf(pendingKey);
    if (live.length > 0) sawLiveZones = true;
    // One partition: body pictures in source order, as collection lists them; tables, frames
    // and an earlier section's pictures after.
    const pictures: ExclusionZone[] = [];
    const others: ExclusionZone[] = [];
    for (const zone of earlier) {
      if (!bodyPicture(zone)) others.push(zone);
      else if (!placed(zone)) pictures.push(zone);
    }
    for (const zone of live) pictures.push(zone);
    pictures.sort((left, right) => left.sourceOrder - right.sourceOrder);
    return Object.freeze([...pictures, ...others]);
  };

  let zonesKey: readonly [readonly ExclusionZone[], readonly AnchoredDrawingRecord[], number] = [
    [],
    [],
    -1,
  ];
  let zonesResult: readonly ExclusionZone[] = Object.freeze([]);
  const zones: LiveExclusionZones['zones'] = (pages, pending, earlier) => {
    if (!drawingLayout) return earlier;
    scan(pages);
    notePending(pending);
    const [lastEarlier, lastPending, lastRevision] = zonesKey;
    if (earlier === lastEarlier && pendingKey === lastPending && placedRevision === lastRevision)
      return zonesResult;
    zonesKey = [earlier, pendingKey, placedRevision];
    zonesResult = merge(earlier);
    return zonesResult;
  };

  let mapKey: readonly [ZonesByPage | undefined, readonly AnchoredDrawingRecord[], number] = [
    undefined,
    [],
    -1,
  ];
  let mapResult: ZonesByPage | undefined;
  const byPage: LiveExclusionZones['byPage'] = (pages, pending, map) => {
    if (!drawingLayout) return map;
    scan(pages);
    notePending(pending);
    if (!map?.size && pendingKey.length === 0) return map;
    const [lastMap, lastPending, lastRevision] = mapKey;
    if (map === lastMap && pendingKey === lastPending && placedRevision === lastRevision)
      return mapResult;
    mapKey = [map, pendingKey, placedRevision];
    const current = pages.length;
    const out = new Map<number, readonly ExclusionZone[]>();
    const live = merge(map?.get(current) ?? Object.freeze([]));
    if (live.length > 0) out.set(current, live);
    for (const [index, page] of map ?? [])
      if (index > current)
        out.set(index, page.some(placed) ? Object.freeze(page.filter((z) => !placed(z))) : page);
    mapResult = out;
    return out;
  };

  return {
    zones,
    byPage,
    get sawLiveZones() {
      return sawLiveZones;
    },
  };
}
