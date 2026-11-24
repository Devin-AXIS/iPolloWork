// Floating tables use the same scanline geometry and convergence keys as anchored drawings.
import { autofitContextOf, type TableAutofitContext } from './table-autofit-widths.ts';
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { hardBreakKind } from '../store/package/hard-break.ts';
import { paragraphBreaksBefore } from './paragraph-style.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type { ExclusionZone, ExclusionColumnLayout } from './drawing-exclusion.ts';
import type { BlockFragmentRecord, LayoutBox, PageRecord } from './semantic-records.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { floatingTableZone, leavesNoPassage } from './table-wrap-zone.ts';
import {
  positionedTablesByAnchor,
  positionedTableAnchors,
  tableFloatOriginY,
  type PositionedTableAnchor,
  type PositionedTableAnchorSignal,
  type TableVerticalAnchorFrames,
} from './table-float-position.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import {
  readTableStructure,
  type SemanticTableStructure,
  type TableAnchorFrames,
  type TableFloatPosition,
} from './semantic-table.ts';
import { positionedTableOriginX } from './table-origin.ts';
import { pinnedTableBreak } from './table-pinned-break.ts';
import { openingRowsBottom } from './table-text-float-break.ts';
import {
  noOverlapShift,
  tableRefusesOverlap,
  withoutFloatingTableZones,
  type NoOverlapObstacle,
} from './table-float-overlap.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';

/**
 * A table's structure for float placement. A table that floats is read at the widths
 * placement lays it out at; one that does not skips the autofit pass, since these readers
 * only ask whether it floats.
 */
function floatTableStructure(table: OoxmlElement, width: number, deps: TableFlowDeps) {
  const read = (autofit?: TableAutofitContext) =>
    readTableStructure(
      table,
      width,
      0,
      deps.styleCascade,
      deps.displayMode,
      deps.revisionAuthorFilter,
      deps.compatibilityMode,
      autofit
    );
  const base = read();
  return base?.float ? read(autofitContextOf(deps)) : base;
}

export function hasFloatingTables(
  blocks: readonly OoxmlElement[],
  width: number,
  styles: StyleCascadeTable | undefined,
  mode: RevisionDisplayMode,
  authors: RevisionAuthorFilter | undefined,
  compatibilityMode?: number
): boolean {
  // By list and inputs: a pass asks again for the same list, and the blocks never change.
  const previous = floatingTableLists.get(blocks);
  if (
    previous &&
    previous.width === width &&
    previous.styles === styles &&
    previous.mode === mode &&
    previous.authors === authors &&
    previous.compatibilityMode === compatibilityMode
  ) {
    return previous.floating;
  }
  const floating = blocks.some((block) => {
    if (block.kind !== 'table') return false;
    const float = readTableStructure(
      block,
      width,
      0,
      styles,
      mode,
      authors,
      compatibilityMode
    )?.float;
    return float !== undefined && float.ySpec !== 'inline';
  });
  floatingTableLists.set(blocks, { width, styles, mode, authors, compatibilityMode, floating });
  return floating;
}

const floatingTableLists = new WeakMap<
  readonly OoxmlElement[],
  {
    readonly width: number;
    readonly styles: StyleCascadeTable | undefined;
    readonly mode: RevisionDisplayMode;
    readonly authors: RevisionAuthorFilter | undefined;
    readonly compatibilityMode: number | undefined;
    readonly floating: boolean;
  }
>();

export function addFloatingTableExclusions(
  pages: readonly Pick<PageRecord, 'fragments'>[],
  drawingZones: ReadonlyMap<number, readonly ExclusionZone[]>,
  columns: ExclusionColumnLayout,
  /**
   * Whether the tables sit in the body flow they wrap, where a table that leaves no passage
   * moves the earlier lines it covers. A header or footer table keeps the plain wrap.
   */
  inBodyFlow = true
): ReadonlyMap<number, readonly ExclusionZone[]> {
  let result: Map<number, readonly ExclusionZone[]> | undefined;
  for (const [pageIndex, page] of pages.entries()) {
    let pageZones: ExclusionZone[] | undefined;
    for (const block of page.fragments) {
      if (block.kind !== 'table') continue;
      const metadata = block.floatingWrap;
      if (!metadata) continue;
      const column = metadata.columnIndex;
      const left = columns.columnLefts?.[column] ?? 0;
      const width = columns.columnWidths?.[column] ?? columns.contentWidth;
      const zone = floatingTableZone(block, metadata, {
        left,
        width,
        columnIndex: column,
        pageFramed: inBodyFlow && metadata.float.vertAnchor !== 'text',
        // In every column: the anchor pricing (`coveredLinesAnchorBand`) reads the anchor's column.
        reachesWhenSpanning: inBodyFlow && raisedAboveText(metadata.float),
        // The earlier lines a rising band crosses wrap beside it, in every column too.
        wrapsWhenRising: inBodyFlow && bandRisesAboveText(metadata.float),
      });
      if (!pageZones) {
        result ??= new Map(drawingZones);
        pageZones = [...(drawingZones.get(pageIndex) ?? [])];
        result.set(pageIndex, pageZones);
      }
      pageZones.push(zone);
    }
  }
  return result ?? drawingZones;
}

const NO_DISTANCES = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * Whether a text-anchored table rises above its anchor: an offset more negative than the one
 * twip of storage bias that an authored `w:tblpY="0"` carries, and no vertical alignment.
 */
function raisedAboveText(float: TableFloatPosition): boolean {
  return float.vertAnchor === 'text' && !float.ySpec && float.yPt < -0.051;
}

/**
 * Whether the band of a text-anchored table rises above its anchor top: the offset less the
 * `w:topFromText` distance is more negative than the one twip of storage bias.
 */
function bandRisesAboveText(float: TableFloatPosition): boolean {
  const top = float.distances?.top ?? 0;
  return float.vertAnchor === 'text' && !float.ySpec && float.yPt - top < -0.051;
}

/** Whether the column being filled is the whole text width: a single-column section. */
function singleColumn(columnWidth: number, textWidth: number): boolean {
  return columnWidth >= textWidth - 0.5;
}

const NO_SHIFT: { readonly dx: number; readonly dy: number; readonly band?: NoOverlapObstacle } =
  Object.freeze({ dx: 0, dy: 0 });

// The deps object belongs to one body pass. Drawing-free probes have no page-relative inputs.
const bandMemos = new WeakMap<TableFlowDeps, WeakMap<OoxmlElement, Map<number, number>>>();

/** Admission keeps long text tables on the existing row-pagination path. */
export function floatingTableBand(table: OoxmlElement, width: number, deps: TableFlowDeps): number {
  let widths: Map<number, number> | undefined;
  if (!deps.inlineDrawingLayout) {
    let tables = bandMemos.get(deps);
    if (!tables) bandMemos.set(deps, (tables = new WeakMap()));
    widths = tables.get(table);
    if (!widths) tables.set(table, (widths = new Map()));
    const cached = widths.get(width);
    if (cached !== undefined) return cached;
  }
  const structure = floatTableStructure(table, width, deps);
  if (!structure?.float || structure.float.vertAnchor !== 'text') return 0;
  // Text-frame alignments need their own admission math; retain the existing row-flow path.
  // `w:tblOverlap` does not: it moves the table off other floating tables at placement.
  if (structure.float.ySpec) return Infinity;
  const band =
    Math.max(0, structure.float.yPt) +
    probeTableHeight(structure, table.id, deps) +
    (structure.float.distances?.bottom ?? 0);
  widths?.set(width, band);
  return band;
}

/**
 * Keep a page- or margin-positioned table whole when its anchor has a page break, an authored
 * gap, or another table (`pinnedBreakAllowed`). A text-anchored table breaks whatever its anchor.
 */
export function anchorBreakPolicy(
  anchors: readonly PositionedTableAnchor[],
  blocks: readonly PreparedBlock[]
): ReadonlyMap<string, boolean> {
  const policy = new Map(anchors.map(({ table }) => [table.id, false]));
  if (!anchors.length) return policy;
  const byParagraph = positionedTablesByAnchor(anchors);
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const tables = byParagraph.get(block.paragraph.id);
    if (tables?.length !== 1 || paragraphBreaksBefore(block.props) || block.spacing.before > 0)
      continue;
    if (paragraphHasPageOrColumnBreak(block.paragraph)) continue;
    policy.set(tables[0]!.table.id, true);
  }
  return policy;
}

function paragraphHasPageOrColumnBreak(paragraph: OoxmlElement): boolean {
  const pending: OoxmlNode[] = [paragraph];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'hardBreak' && ['page', 'column'].includes(hardBreakKind(node))) return true;
    if ('children' in node) for (const child of node.children) pending.push(child);
  }
  return false;
}

export interface PositionedTableFlowPolicy {
  readonly positionedTables: readonly PositionedTableAnchor[];
  readonly positionedTablePolicy: ReadonlyMap<string, boolean>;
}

/** Anchor admission is a forward dependency of the earlier table's flow checkpoint. */
export function anchorFlow(
  prepared: readonly PreparedBlock[],
  width: number,
  styles: StyleCascadeTable | undefined,
  mode: RevisionDisplayMode,
  authors: RevisionAuthorFilter | undefined,
  compatibilityMode?: number
): PositionedTableFlowPolicy {
  const positionedTables = positionedTableAnchors(
    prepared,
    width,
    styles,
    mode,
    authors,
    compatibilityMode
  );
  const positionedTablePolicy = anchorBreakPolicy(positionedTables, prepared);
  return { positionedTables, positionedTablePolicy };
}

/** Run before cross-block folds so keep-next chains carry anchor admission changes. */
export function anchorFlowKeys(keys: string[], state: PositionedTableFlowPolicy): string[] {
  if (!state.positionedTables.length) return keys;
  const flowKeys = [...keys];
  for (const anchor of state.positionedTables) {
    flowKeys[anchor.sourceIndex] = framedTokenJoin([
      keys[anchor.sourceIndex]!,
      anchor.anchorId,
      state.positionedTablePolicy.get(anchor.table.id) ? 'split' : 'whole',
    ]);
  }
  return flowKeys;
}

/** Where the body flow stands when it reaches a positioned table. */
export interface FloatAdmissionFlow {
  /** Single-column flow, where a text-anchored table may break across pages. */
  readonly allowBreak: boolean;
  readonly zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined;
  readonly page: number;
  /** The narrowest column. The table must fit whichever column its anchor reaches. */
  readonly width: number;
  readonly frames: TableAnchorFrames;
  /** Vertical frames on this page. The text frame starts at the body cursor. */
  readonly verticalFrames: TableVerticalAnchorFrames;
  readonly bottom: number;
}

const flowTop = (flow: FloatAdmissionFlow): number => flow.verticalFrames.text.top;

/**
 * True when a positioned table waits for its anchor paragraph and is placed there whole.
 *
 * Row pagination places the table instead when earlier objects wrap its cells, or when its
 * band is taller than a page. It also places a text-relative table that does not fit the room
 * left, when its opening rows do fit there. That table breaks between rows at the page bottom,
 * and its remaining rows continue at the top of the next page (`table-text-float-break.ts`).
 * When the opening rows do not fit, the table still moves whole with its anchor.
 */
export function admitsAtAnchor(
  table: OoxmlElement,
  deps: TableFlowDeps,
  flow: FloatAdmissionFlow
): boolean {
  if (hasEarlierCellExclusions(table, flow.zones, deps, flow.page)) return false;
  if (breaksAcrossPages(table, deps, flow)) return false;
  // `w:doNotBreakWrappedTables` (ECMA-376 Part 4, 14.8.3.10) keeps every positioned table
  // whole, also one taller than a page: placement then moves it up onto the sheet.
  if (deps.styleCascade?.doNotBreakWrappedTables) return true;
  // Rows that fit keep the table whole, even when its `w:bottomFromText` reaches past the room.
  // Only rows taller than a page take row pagination: a table that a page holds stays whole
  // although its `w:tblpY` pushes it past the bottom margin.
  const float = floatTableStructure(table, flow.width, deps)?.float;
  const band = floatingTableBand(table, flow.width, deps) - (float?.distances?.bottom ?? 0);
  if (band - Math.max(0, float?.yPt ?? 0) > flow.bottom) return false;
  return (
    band <= flow.bottom - flowTop(flow) ||
    !flow.allowBreak ||
    !breaksAtPageBottom(table, deps, flow)
  );
}

/** A page- or margin-positioned table that reaches below the bottom margin breaks in flow. */
function breaksAcrossPages(
  table: OoxmlElement,
  deps: TableFlowDeps,
  flow: FloatAdmissionFlow
): boolean {
  const structure = readTableStructure(
    table,
    flow.width,
    0,
    deps.styleCascade,
    deps.displayMode,
    deps.revisionAuthorFilter,
    deps.compatibilityMode
  );
  return (
    !!structure &&
    pinnedTableBreak(table, structure, deps, {
      top: flowTop(flow),
      bottom: flow.bottom,
      frames: flow.frames,
      verticalFrames: flow.verticalFrames,
      width: flow.width,
    }) !== undefined
  );
}

function breaksAtPageBottom(
  table: OoxmlElement,
  deps: TableFlowDeps,
  flow: FloatAdmissionFlow
): boolean {
  const structure = floatTableStructure(table, flow.width, deps);
  const float = structure?.float;
  // A negative offset collides with earlier text. Only anchor placement displaces it. Space
  // above the table keeps it whole too; space below it does not.
  if (!structure || float?.vertAnchor !== 'text' || float.ySpec || float.yPt < 0) return false;
  if ((float.distances?.top ?? 0) > 0) return false;
  const opening = openingRowsBottom(table, structure, flow.width, flowTop(flow) + float.yPt, deps);
  return opening !== undefined && opening <= flow.bottom + 0.001;
}

function probeTableHeight(
  structure: SemanticTableStructure,
  tableId: string,
  deps: TableFlowDeps
): number {
  let line = 0;
  // Measured as placed: a floating table's cells never wrap around another floating table.
  return layoutTableFragment(structure, 0, 0, 0, tableId, 0, {
    ...stripAnchorSinksForProbe(withoutFloatingTableZones(deps)),
    onCellBreakKey: undefined,
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `floating-table-probe-${line++}`,
  }).bottom;
}

/**
 * Room an anchor needs when its table lands on body lines already placed on the anchor's page:
 * a page- or margin-framed table, or a text-anchored one raised above its anchor.
 *
 * The table's box does not follow the flow, so the lines before its anchor on that page must
 * clear it too. Clearing moves them, and the anchor after them, below the table. When the
 * anchor then no longer fits, the band exceeds the page and the anchor opens the next page:
 * the table follows its anchor there, and the earlier lines keep their places. A raised table
 * is priced where its anchor was before the lines it moved (`pushed`), as it is placed.
 *
 * Only a column-spanning table in single-column flow is priced. Lines beside a narrower table,
 * and earlier columns of the same sheet, are not modeled.
 */
function coveredLinesAnchorBand(
  anchor: PositionedTableAnchor,
  width: number,
  deps: TableFlowDeps,
  placement: {
    readonly anchorY: number;
    readonly anchorExtent: number;
    readonly frames: TableAnchorFrames;
    readonly verticalFrames: TableVerticalAnchorFrames;
    readonly earlier: readonly BlockFragmentRecord[];
  },
  pushed: number
): number {
  const column = placement.frames.text;
  const raised = raisedAboveText(anchor.float);
  if (
    (anchor.float.vertAnchor === 'text' && !raised) ||
    (!raised &&
      (column.left > placement.frames.margin.left + 0.5 ||
        !singleColumn(column.width, placement.frames.margin.width)))
  )
    return 0;
  // A raised table's band moves only paragraph lines: the flow never moves a table for it. Only
  // the lines of the anchor's column move the anchor; a band that crosses another column moves
  // the lines there on their own.
  const inColumn = (box: LayoutBox) =>
    box.x + 0.5 >= column.left && box.x < column.left + column.width;
  const lineBoxes = placement.earlier.flatMap((block) => {
    if (isOutOfFlowFragment(block) || (block.kind === 'table' && block.floatingWrap)) return [];
    if (block.kind === 'table') return raised ? [] : [block.box];
    return block.lines.map((line) => line.box).filter(inColumn);
  });
  if (lineBoxes.length === 0) return 0;
  const structure = floatTableStructure(anchor.table, width, deps);
  const float = structure?.float;
  if (!structure || !float || (float.vertAnchor === 'text' && !raised) || float.ySpec === 'inline')
    return 0;
  const distances = float.distances ?? NO_DISTANCES;
  const left = positionedTableOriginX(structure, placement.frames, deps.compatibilityMode);
  const tableWidth = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const bandLeft = left - distances.left;
  const bandRight = left + tableWidth + distances.right;
  if (!leavesNoPassage(bandLeft, bandRight, column.left, column.width)) return 0;
  const topOf = (height: number) =>
    raised
      ? placement.anchorY - pushed + float.yPt
      : tableFloatOriginY(float, height, placement.verticalFrames);
  // An offset top does not depend on the table height: skip the probe when no line reaches it.
  const inkBottom = lineBoxes.reduce((bottom, box) => Math.max(bottom, box.y + box.height), 0);
  if (!float.ySpec && inkBottom <= topOf(0) - distances.top) return 0;
  const height = probeTableHeight(structure, anchor.table.id, deps);
  const top = topOf(height);
  const bandTop = top - distances.top;
  const bandBottom = top + height + distances.bottom;
  let firstTop = Infinity;
  for (const box of lineBoxes) {
    if (
      box.y < bandBottom &&
      box.y + box.height > bandTop &&
      box.x < bandRight &&
      box.x + box.width > bandLeft
    )
      firstTop = Math.min(firstTop, box.y);
  }
  if (firstTop > placement.anchorY) return 0;
  // A raised table stays while the lines it moves fit below it; its anchor may move on alone.
  return bandBottom - firstTop + (raised ? 0 : placement.anchorExtent);
}

export function requiredAnchorBand(
  anchors: readonly PositionedTableAnchor[],
  pending: ReadonlySet<string>,
  paragraphId: string,
  width: number,
  deps: TableFlowDeps,
  placement: {
    readonly anchorY: number;
    /** Height of the anchor's first line, which must fit below any cleared table. */
    readonly anchorExtent: number;
    readonly frames: TableAnchorFrames;
    readonly verticalFrames: TableVerticalAnchorFrames;
    readonly earlier: readonly BlockFragmentRecord[];
    /** Anchors already laid on this page whose tables wait for the page flush. */
    readonly signals?: readonly PositionedTableAnchorSignal[];
    /** How far a raised table's band pushed the lines before its anchor (`earlier-line-push.ts`). */
    readonly pushOf?: (tableId: string) => number;
  }
): number {
  if (pending.size === 0) return 0;
  let height = 0;
  const byParagraph = positionedTablesByAnchor(anchors);
  const pendingOf = (anchorId: string) =>
    (byParagraph.get(anchorId) ?? []).filter((anchor) => pending.has(anchor.table.id));
  const here = pendingOf(paragraphId);
  // Tables of earlier anchors on this page are placed first, at the flush, in anchor order.
  // Only in one column: a waiting table in another column is placed against other frames.
  const oneColumn = singleColumn(placement.frames.text.width, placement.frames.margin.width);
  const before = here.length > 0 && oneColumn ? (placement.signals ?? []) : [];
  const waiting = before.flatMap((signal) =>
    pendingOf(signal.anchorId).map((anchor) => ({ anchor, signal }))
  );
  const placed = here.length > 0 ? placedFloatObstacles(placement.earlier, deps) : [];
  // Overlap avoidance only runs when a table involved refuses overlap.
  const avoids =
    [...here, ...waiting.map((entry) => entry.anchor)].some(
      (anchor) => deps.floatRefusesOverlap?.(anchor.table.id) ?? tableRefusesOverlap(anchor.table)
    ) || placed.some((obstacle) => obstacle.refusesOverlap);
  const prospective: NoOverlapObstacle[] = [];
  if (avoids) {
    for (const { anchor, signal } of waiting) {
      // The same text the flush clears: what preceded that anchor on the page.
      const y = clearEarlierText(
        anchor.table,
        signal.anchorY,
        width,
        placement.frames,
        placement.earlier.slice(0, signal.fragmentIndex),
        deps
      );
      const shift = noOverlapPlacement(anchor.table, y, width, placement.frames, deps, [
        ...placed,
        ...prospective,
      ]);
      if (shift.band) prospective.push(shift.band);
    }
  }
  for (const anchor of here) {
    const pushed = placement.pushOf?.(anchor.table.id) ?? 0;
    const clearedY = clearEarlierText(
      anchor.table,
      placement.anchorY - pushed,
      width,
      placement.frames,
      placement.earlier,
      deps
    );
    // Tables sharing this anchor are placed in order, so each one meets the ones before it.
    const shift = avoids
      ? noOverlapPlacement(anchor.table, clearedY, width, placement.frames, deps, [
          ...placed,
          ...prospective,
        ])
      : NO_SHIFT;
    if (shift.band) prospective.push(shift.band);
    // A text-anchored table's `w:bottomFromText` may reach past the page bottom; only the rows
    // must fit. Other anchors have no band here.
    const gap = anchor.float.vertAnchor === 'text' ? (anchor.float.distances?.bottom ?? 0) : 0;
    const band =
      floatingTableBand(anchor.table, width, deps) -
      gap +
      clearedY +
      shift.dy -
      placement.anchorY +
      Math.min(0, anchor.float.yPt);
    height = Math.max(height, band, coveredLinesAnchorBand(anchor, width, deps, placement, pushed));
  }
  return height;
}

/** The page state an anchor's band reads, as getters: the layout pass mutates it in place. */
export interface AnchorTableBandState {
  readonly anchors: readonly PositionedTableAnchor[];
  readonly pending: ReadonlySet<string>;
  readonly width: () => number;
  readonly deps: TableFlowDeps;
  readonly frames: () => TableAnchorFrames;
  readonly verticalFrames: (anchorY: number) => TableVerticalAnchorFrames;
  readonly earlier: () => readonly BlockFragmentRecord[];
  readonly signals: readonly PositionedTableAnchorSignal[];
  readonly pushOf: (tableId: string) => number;
}

/** Room below `anchorY` that the tables waiting for `anchorId` need on the current page. */
export function anchorTableBandOf(
  state: AnchorTableBandState
): (anchorId: string, anchorY: number, anchorExtent: number) => number {
  return (anchorId, anchorY, anchorExtent) =>
    requiredAnchorBand(state.anchors, state.pending, anchorId, state.width(), state.deps, {
      anchorY,
      anchorExtent,
      frames: state.frames(),
      verticalFrames: state.verticalFrames(anchorY),
      earlier: state.earlier(),
      signals: state.signals,
      pushOf: state.pushOf,
    });
}

/**
 * Whether the tables that wait for `paragraphId` stay on the page that its `w:pageBreakBefore`
 * closes. A text-anchored table goes where the body flow reaches it, and the break moves only
 * the anchor paragraph. A table that does not fit is not split here: it follows its anchor.
 *
 * The tables stay only when each one is text-anchored and `fits` finds room for them below the
 * flow on that page (`requiredAnchorBand`). Otherwise they follow their anchor.
 */
export function staysBeforeAnchorBreak(
  anchors: readonly PositionedTableAnchor[],
  pending: ReadonlySet<string>,
  paragraphId: string,
  fits: () => boolean
): boolean {
  const waiting = (positionedTablesByAnchor(anchors).get(paragraphId) ?? []).filter((anchor) =>
    pending.has(anchor.table.id)
  );
  return (
    waiting.length > 0 && waiting.every((anchor) => anchor.float.vertAnchor === 'text') && fits()
  );
}

/**
 * Where a text-anchored table placed at its anchor starts: below the earlier text it would
 * cover, then off the floating tables already on the page. `dx` moves it sideways.
 */
export function positionedTableStart(
  table: OoxmlElement,
  anchorY: number,
  width: number,
  frames: TableAnchorFrames,
  pageFragments: readonly BlockFragmentRecord[],
  anchorFragmentIndex: number,
  deps: TableFlowDeps,
  /** The page content bottom. A move down never takes the table past it. */
  bottom: number
): { readonly anchorY: number; readonly dx: number } {
  const earlier = pageFragments.slice(0, anchorFragmentIndex);
  const clearedY = clearEarlierText(table, anchorY, width, frames, earlier, deps);
  const refuses = (fragment: BlockFragmentRecord) =>
    fragment.kind === 'table' &&
    !!fragment.floatingWrap &&
    (deps.floatRefusesOverlap?.(fragment.tableId) ?? false);
  // The common story has no no-overlap table: skip building obstacles at all.
  if (!tableRefusesOverlap(table) && !pageFragments.some(refuses))
    return { anchorY: clearedY, dx: 0 };
  const obstacles = placedFloatObstacles(pageFragments, deps);
  const shift = noOverlapPlacement(table, clearedY, width, frames, deps, obstacles);
  // The anchor's band priced the moves it could see. A table that a later move would push
  // below the page keeps its authored place rather than painting into the bottom margin.
  if (shift.dy > 0 && (shift.band?.bottom ?? 0) > bottom + 0.001)
    return { anchorY: clearedY, dx: 0 };
  return { anchorY: clearedY + shift.dy, dx: shift.dx };
}

/** Floating tables already placed among `fragments`, as obstacles for a later table. */
export function placedFloatObstacles(
  fragments: readonly BlockFragmentRecord[],
  deps: TableFlowDeps
): NoOverlapObstacle[] {
  // The wrap bands text already avoids, outer rules included. Floating tables an earlier
  // section left on this sheet join them; their own setting is not known here, so only a
  // table that itself refuses overlap moves off them.
  const layout = Object.freeze({ columnCount: 1, columnGapPt: 0, contentWidth: Infinity });
  const zones = [
    ...(deps.pageExclusionZones?.() ?? []).filter(
      (zone) => zone.earlierSection && zone.sourceKind === 'table'
    ),
    ...(addFloatingTableExclusions([{ fragments }], new Map(), layout).get(0) ?? []),
  ];
  return zones.map((zone) => ({
    left: zone.verticalBand.x,
    top: zone.verticalBand.y,
    right: zone.verticalBand.x + zone.verticalBand.width,
    bottom: zone.verticalBand.y + zone.verticalBand.height,
    refusesOverlap:
      !zone.earlierSection &&
      (deps.floatRefusesOverlap?.(zone.drawingNodeId.slice('table:'.length)) ?? false),
  }));
}

/**
 * How far a text-anchored floating table placed at `anchorY` moves off earlier floating
 * tables (`table-float-overlap.ts`), with the band it then occupies. No move without one.
 */
export function noOverlapPlacement(
  table: OoxmlElement,
  anchorY: number,
  width: number,
  frames: TableAnchorFrames,
  deps: TableFlowDeps,
  obstacles: readonly NoOverlapObstacle[]
): { readonly dx: number; readonly dy: number; readonly band?: NoOverlapObstacle } {
  const structure = floatTableStructure(table, width, deps);
  const float = structure?.float;
  if (!structure || !float || float.vertAnchor !== 'text' || float.ySpec) return NO_SHIFT;
  const band = floatingTableBand(table, width, deps);
  if (!Number.isFinite(band)) return NO_SHIFT;
  const distances = float.distances ?? NO_DISTANCES;
  const refusesOverlap = tableRefusesOverlap(table);
  const candidate = {
    left: positionedTableOriginX(structure, frames, deps.compatibilityMode),
    top: anchorY + float.yPt,
    width: structure.columnWidthsPt.reduce((sum, column) => sum + column, 0),
    height: band - Math.max(0, float.yPt) - distances.bottom,
    distances,
    refusesOverlap,
  };
  const shift = noOverlapShift(
    candidate,
    obstacles,
    { left: frames.margin.left, right: frames.margin.left + frames.margin.width },
    hasCompatibilityRule(deps.compatibilityMode, 'floatingTableOverlapMovesLeft')
  );
  const left = candidate.left + shift.dx;
  const top = candidate.top + shift.dy;
  return {
    ...shift,
    band: {
      left: left - distances.left,
      top: top - distances.top,
      right: left + candidate.width + distances.right,
      bottom: top + candidate.height + distances.bottom,
      refusesOverlap,
    },
  };
}

/** Preserve offsets whose padded box clears earlier ink; displacement avoids circular reflow. */
export function clearEarlierText(
  table: OoxmlElement,
  anchorY: number,
  width: number,
  frames: TableAnchorFrames,
  earlier: readonly BlockFragmentRecord[],
  deps: TableFlowDeps
): number {
  const structure = floatTableStructure(table, width, deps);
  const float = structure?.float;
  if (!structure || !float || float.vertAnchor !== 'text' || float.ySpec) return anchorY;
  const tableWidth = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const distances = float.distances ?? NO_DISTANCES;
  const left = positionedTableOriginX(structure, frames, deps.compatibilityMode) - distances.left;
  // A raised table that leaves no passage beside it keeps its place: the earlier lines it
  // covers move below it instead (`reachesEarlierLines`).
  const right = left + tableWidth + distances.left + distances.right;
  const spans = leavesNoPassage(left, right, frames.text.left, frames.text.width);
  if (spans && raisedAboveText(float)) return anchorY;
  // A band that rises above the anchor and leaves a passage clears only earlier in-flow tables:
  // the earlier lines it crosses wrap beside it instead (`wrapsEarlierLines`).
  const wrapsText = !spans && bandRisesAboveText(float);
  const height = floatingTableBand(table, width, deps) - Math.max(0, float.yPt) + distances.top;
  let top = anchorY + float.yPt - distances.top;
  const ink = earlier
    .flatMap((block) => {
      if (block.kind === 'table') return block.floatingWrap ? [] : [block.box];
      if (wrapsText) return [];
      return block.lines.flatMap((line) => [
        ...line.spans.filter((span) => span.text.trim()).map((span) => span.box),
        ...(line.drawings ?? []).map((drawing) => drawing.paintBounds),
      ]);
    })
    .sort((a, b) => a.y - b.y);
  for (const box of ink) {
    if (
      left < box.x + box.width &&
      left + tableWidth + distances.left + distances.right > box.x &&
      top < box.y + box.height &&
      top + height > box.y
    )
      top = box.y + box.height;
  }
  return top + distances.top - float.yPt;
}

const earliestExclusions = new WeakMap<
  TableFlowDeps,
  {
    readonly zones: ReadonlyMap<number, readonly ExclusionZone[]>;
    readonly remainingOrders: readonly (readonly [page: number, order: number])[];
  }
>();

/** A floating table needs placement-aware row admission when earlier objects wrap its cells. */
export function hasEarlierCellExclusions(
  table: OoxmlElement,
  zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined,
  deps: TableFlowDeps,
  firstPage = 0
): boolean {
  if (!deps.pageExclusionZones || !zones?.size) return false;
  let memo = earliestExclusions.get(deps);
  if (memo?.zones !== zones) {
    const remainingOrders: [number, number][] = [];
    for (const [pageIndex, page] of zones) {
      let order = Infinity;
      // Another floating table never wraps this table's cells: the two overlap, or
      // `w:tblOverlap` moves this one off it at placement.
      for (const zone of page)
        if (zone.sourceKind !== 'table')
          order = Math.min(
            order,
            deps.paragraphOrderIndex?.(zone.anchorParagraphId) ?? zone.sourceOrder
          );
      remainingOrders.push([pageIndex, order]);
    }
    remainingOrders.sort((a, b) => a[0] - b[0]);
    for (let index = remainingOrders.length - 2; index >= 0; index--)
      remainingOrders[index]![1] = Math.min(
        remainingOrders[index]![1],
        remainingOrders[index + 1]![1]
      );
    memo = { zones, remainingOrders };
    earliestExclusions.set(deps, memo);
  }
  // Completed pages cannot wrap this table's cells. Retain later-page exclusions
  // because an inline table can continue there; query the suffix without rescanning
  // all pages for every table in a long document.
  let low = 0;
  let high = memo.remainingOrders.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (memo.remainingOrders[middle]![0] < firstPage) low = middle + 1;
    else high = middle;
  }
  const earliestOrder = memo.remainingOrders[low]?.[1];
  if (earliestOrder === undefined || earliestOrder === Infinity) return false;
  // Only objects anchored before the table wrap its cells from outside. An object anchored in
  // one of the table's own cells (`wp:anchor`, ECMA-376 Part 1, 20.4.2.3) moves with the
  // table, so it never keeps the table from floating.
  return earliestOrder < firstParagraphOrder(table, deps);
}

/** The document order of the table's first paragraph, in a bounded preorder walk. */
function firstParagraphOrder(table: OoxmlElement, deps: TableFlowDeps): number {
  const pending: OoxmlNode[] = [table];
  let visits = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++visits > 10000) break;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'paragraph')
      return deps.paragraphOrderIndex?.(node.id) ?? Number.MAX_SAFE_INTEGER;
    for (let index = node.children.length - 1; index >= 0; index--)
      pending.push(node.children[index]!);
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Preserve body wrapping when external obstacles require immediate table placement, and beside
 * the last fragment of a text-anchored table that broke across pages.
 */
export function withFloatingWrap(
  fragment: BlockFragmentRecord,
  positioned: PositionedTableAnchor | undefined,
  columnIndex: number,
  wrapsFollowingText = false
): BlockFragmentRecord {
  if (
    !positioned ||
    fragment.kind !== 'table' ||
    !(isOutOfFlowFragment(fragment) || wrapsFollowingText)
  )
    return fragment;
  return {
    ...fragment,
    floatingWrap: {
      anchorId: positioned.anchorId,
      columnIndex,
      float: positioned.float,
      sourceOrder: positioned.sourceIndex,
    },
  };
}
