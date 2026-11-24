// Vertical placement for top-level `w:tblpPr` tables.

import { sha256FontBytes } from '../store/package/sha256.ts';
import { framedTokenJoin } from './layout-cache.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { marginInset } from './page-body-margins.ts';

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';
import { readTableStructure, type TableFloatPosition } from './semantic-table.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';

type PositionedTableFragment = TableFragmentRecord & { readonly outOfFlow: true };

type PositionableBlock =
  | { readonly kind: 'table'; readonly table: OoxmlElement }
  | {
      readonly kind: 'paragraph';
      readonly paragraph: OoxmlElement;
      readonly props: readonly OoxmlProperty[];
    };

export interface PositionedTableAnchor {
  readonly table: OoxmlElement;
  readonly sourceIndex: number;
  readonly anchorId: string;
  readonly float: TableFloatPosition;
}

export interface PositionedTableAnchorSignal {
  readonly anchorId: string;
  readonly column: number;
  readonly fragmentIndex: number;
  readonly anchorY: number;
}

const anchorsByParagraphMemo = new WeakMap<
  readonly PositionedTableAnchor[],
  ReadonlyMap<string, readonly PositionedTableAnchor[]>
>();

export function positionedTablesByAnchor(
  positionedTables: readonly PositionedTableAnchor[]
): ReadonlyMap<string, readonly PositionedTableAnchor[]> {
  const memo = anchorsByParagraphMemo.get(positionedTables);
  if (memo) return memo;
  const mutable = new Map<string, PositionedTableAnchor[]>();
  for (const positioned of positionedTables) {
    const entries = mutable.get(positioned.anchorId) ?? [];
    entries.push(positioned);
    mutable.set(positioned.anchorId, entries);
  }
  anchorsByParagraphMemo.set(positionedTables, mutable);
  return mutable;
}

/** Resolve each sheet-positioned table to the next regular paragraph in document order. */
export function positionedTableAnchors(
  blocks: readonly PositionableBlock[],
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined,
  compatibilityMode?: number
): PositionedTableAnchor[] {
  const result: PositionedTableAnchor[] = [];
  let nextParagraphId: string | undefined;
  // A text-positioned float follows the next block in flow, an in-flow table included; a
  // page- or margin-positioned one keeps the next paragraph, which prices its earlier text.
  let nextFlowId: string | undefined;
  for (let sourceIndex = blocks.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    const block = blocks[sourceIndex]!;
    if (
      block.kind === 'paragraph' &&
      !block.props.some((property) => property.localName === 'framePr')
    ) {
      nextParagraphId = block.paragraph.id;
      nextFlowId = block.paragraph.id;
      continue;
    }
    if (block.kind !== 'table') continue;
    const float = readTableStructure(
      block.table,
      contentWidth,
      0,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    )?.float;
    if (!float || float.ySpec === 'inline') {
      nextFlowId = block.table.id;
      continue;
    }
    const anchorId = float.vertAnchor === 'text' ? nextFlowId : nextParagraphId;
    if (!anchorId) continue;
    result.push({
      table: block.table,
      sourceIndex,
      anchorId,
      float,
    });
  }
  return result.reverse();
}

function sameAnchorSignals(
  left: readonly PositionedTableAnchorSignal[] | undefined,
  right: readonly PositionedTableAnchorSignal[]
): boolean {
  const values = left ?? [];
  return (
    values.length === right.length &&
    values.every(
      (value, index) =>
        value.anchorId === right[index]!.anchorId &&
        value.column === right[index]!.column &&
        value.fragmentIndex === right[index]!.fragmentIndex &&
        value.anchorY === right[index]!.anchorY
    )
  );
}

export interface PendingPositionedTableTokens {
  readonly token: string;
  readonly previous: PendingPositionedTableTokens | undefined;
  readonly length: number;
  readonly signature: string;
}

interface PositionedTableCheckpointState {
  readonly pendingPositionedTableTokens?: PendingPositionedTableTokens;
  readonly positionedTableAnchorSignals?: readonly PositionedTableAnchorSignal[];
}

export function samePositionedTableCheckpoints(
  left: PositionedTableCheckpointState,
  right: PositionedTableCheckpointState
): boolean {
  const pending = right.pendingPositionedTableTokens;
  const priorTokens = left.pendingPositionedTableTokens;
  return (
    (pending === priorTokens ||
      (pending?.length === priorTokens?.length && pending?.signature === priorTokens?.signature)) &&
    sameAnchorSignals(left.positionedTableAnchorSignals, right.positionedTableAnchorSignals ?? [])
  );
}

/** Capture, restore, and compare the deferred-table portion of a flow checkpoint. */
export function positionedTableFlow(
  positionedTables: readonly PositionedTableAnchor[],
  flowKeys: readonly string[]
) {
  const tokenById = new Map<string, string>();
  const idByToken = new Map<string, string>();
  const anchorIds = new Set<string>();
  for (const positioned of positionedTables) {
    const token = JSON.stringify([positioned.table.id, flowKeys[positioned.sourceIndex]]);
    tokenById.set(positioned.table.id, token);
    idByToken.set(token, positioned.table.id);
    anchorIds.add(positioned.anchorId);
  }
  let pending: PendingPositionedTableTokens | undefined;
  const append = (token: string): void => {
    pending = {
      token,
      previous: pending,
      length: (pending?.length ?? 0) + 1,
      signature: sha256FontBytes(
        new TextEncoder().encode(framedTokenJoin([pending?.signature ?? '', token]))
      ),
    };
  };
  // Publication only removes IDs. Rebuild once after a removal, never at each addition.
  const sync = (ids: ReadonlySet<string>): void => {
    if ((pending?.length ?? 0) === ids.size) return;
    pending = undefined;
    for (const id of ids) {
      const token = tokenById.get(id);
      if (token) append(token);
    }
  };
  return {
    add(ids: Set<string>, id: string): void {
      sync(ids);
      if (ids.has(id)) return;
      const token = tokenById.get(id);
      if (!token) return;
      ids.add(id);
      append(token);
    },
    /**
     * Note an in-flow table as the anchor of the floating tables before it, and return where
     * the table itself starts: below those floats, or below a page-positioned float spanning
     * the column, when their bands cross its top. An `ordinary` table, without `w:tblpPr`,
     * leaves the floats it anchors to its own clearance, which can place it beside them.
     */
    noteTable(
      signals: PositionedTableAnchorSignal[],
      tableId: string,
      column: number,
      fragmentIndex: number,
      top: number,
      zones: readonly ExclusionZone[],
      ordinary = false
    ): number {
      if (anchorIds.has(tableId))
        signals.push({ anchorId: tableId, column, fragmentIndex, anchorY: top });
      let start = top;
      for (const zone of zones) {
        const band = zone.verticalBand;
        if (zone.sourceKind !== 'table') continue;
        if (zone.pageFramedBand !== true && (zone.anchorParagraphId !== tableId || ordinary))
          continue;
        if (band.y <= start + 0.001 && band.y + band.height > start) start = band.y + band.height;
      }
      return start;
    },
    note(
      signals: PositionedTableAnchorSignal[],
      anchorId: string,
      column: number,
      fragmentIndex: number,
      anchorY: number
    ): void {
      if (anchorIds.has(anchorId)) signals.push({ anchorId, column, fragmentIndex, anchorY });
    },
    checkpoint(pendingIds: ReadonlySet<string>, signals: readonly PositionedTableAnchorSignal[]) {
      sync(pendingIds);
      return {
        pendingPositionedTableTokens: pending,
        positionedTableAnchorSignals: [...signals],
      };
    },
    restore(
      checkpoint: PositionedTableCheckpointState,
      pendingIds: Set<string>,
      signals: PositionedTableAnchorSignal[]
    ): void {
      pendingIds.clear();
      const tokens: string[] = [];
      for (let node = checkpoint.pendingPositionedTableTokens; node; node = node.previous)
        tokens.push(node.token);
      for (let index = tokens.length - 1; index >= 0; index--) {
        const id = idByToken.get(tokens[index]!);
        if (id) pendingIds.add(id);
      }
      pending = checkpoint.pendingPositionedTableTokens;
      sync(pendingIds);
      signals.splice(0, signals.length, ...(checkpoint.positionedTableAnchorSignals ?? []));
    },
    same(
      priorTokens: PendingPositionedTableTokens | undefined,
      priorSignals: readonly PositionedTableAnchorSignal[] | undefined,
      pendingIds: ReadonlySet<string>,
      signals: readonly PositionedTableAnchorSignal[]
    ): boolean {
      sync(pendingIds);
      return samePositionedTableCheckpoints(
        { pendingPositionedTableTokens: priorTokens, positionedTableAnchorSignals: priorSignals },
        { pendingPositionedTableTokens: pending, positionedTableAnchorSignals: signals }
      );
    },
  };
}

/** Paint tables whose logical anchor paragraph has reached the page being closed. */
export function publishPositionedTablesOnPage(
  positionedTables: readonly PositionedTableAnchor[],
  outstandingIds: Set<string>,
  pageFragments: BlockFragmentRecord[],
  anchorSignals: PositionedTableAnchorSignal[],
  placeTable: (
    table: OoxmlElement,
    column: number,
    anchorY: number,
    anchorFragmentIndex: number
  ) => void
): void {
  const byParagraph = positionedTablesByAnchor(positionedTables);
  let insertedFragments = 0;
  for (const signal of anchorSignals) {
    const positionedForAnchor = byParagraph.get(signal.anchorId);
    if (!positionedForAnchor) continue;
    const insertionIndex = signal.fragmentIndex + insertedFragments;
    const publishedAt = pageFragments.length;
    for (const positioned of positionedForAnchor) {
      if (!outstandingIds.has(positioned.table.id)) continue;
      const start = pageFragments.length;
      placeTable(positioned.table, signal.column, signal.anchorY, insertionIndex);
      for (let index = start; index < pageFragments.length; index++) {
        const fragment = pageFragments[index]!;
        if (fragment.kind === 'table')
          pageFragments[index] = {
            ...fragment,
            floatingWrap: {
              anchorId: signal.anchorId,
              columnIndex: signal.column,
              float: positioned.float,
              sourceOrder: positioned.sourceIndex,
            },
          };
      }
      outstandingIds.delete(positioned.table.id);
    }
    const fragments = pageFragments.splice(publishedAt);
    pageFragments.splice(insertionIndex, 0, ...fragments);
    insertedFragments += fragments.length;
  }
  anchorSignals.length = 0;
}

/** True when a table paints on its anchor sheet without consuming body flow. */
export function isOutOfFlowTableFragment(
  fragment: BlockFragmentRecord
): fragment is PositionedTableFragment {
  return fragment.kind === 'table' && (fragment as PositionedTableFragment).outOfFlow === true;
}

/** One vertical anchor box, in page-content coordinates. */
export interface TableVerticalAnchorFrame {
  readonly top: number;
  readonly height: number;
}

/** The three boxes `w:vertAnchor` can name, resolved for the page being laid out. */
export interface TableVerticalAnchorFrames {
  readonly text: TableVerticalAnchorFrame;
  readonly margin: TableVerticalAnchorFrame;
  readonly page: TableVerticalAnchorFrame;
}

/** The page facts needed to resolve table vertical anchor frames. */
export interface BodyTableVerticalFrameInput {
  readonly pageHeight: number;
  readonly contentInsetTop: number;
  readonly contentHeight: number;
  readonly marginBottom: number;
}

export function bodyTableVerticalAnchorFrames(
  input: BodyTableVerticalFrameInput,
  cursorY: number,
  marginTop: number
): TableVerticalAnchorFrames {
  // `marginTop` is the signed authored value; the margin frame starts at its size.
  const top = marginInset(marginTop);
  return {
    text: { top: cursorY, height: Math.max(0, input.contentHeight - cursorY) },
    margin: {
      top: top - input.contentInsetTop,
      height: Math.max(0, input.pageHeight - top - input.marginBottom),
    },
    page: { top: -input.contentInsetTop, height: input.pageHeight },
  };
}

/**
 * True when the current region holds body-flow content. A floating table is not flow content,
 * nor is the last fragment of a broken text-anchored table that text wraps beside.
 */
export function hasFlowFragments(
  fragments: readonly BlockFragmentRecord[],
  start: number
): boolean {
  for (let index = start; index < fragments.length; index += 1) {
    const fragment = fragments[index]!;
    if (!isOutOfFlowFragment(fragment) && !(fragment.kind === 'table' && fragment.floatingWrap))
      return true;
  }
  return false;
}

/**
 * Resolve a floated table's top edge in page-content coordinates.
 *
 * A vertical alignment supersedes `w:tblpY`. `inside` and `outside` use top and bottom until
 * mirrored page margins are modelled. The clamp keeps the leading edge on the sheet.
 *
 * `keepWhole` is set when `w:doNotBreakWrappedTables` (ECMA-376 Part 4, 14.8.3.10) keeps the
 * table in one piece. A table that would then pass the bottom edge of the sheet moves up until
 * its bottom edge meets it, but never above the top edge of the sheet.
 */
export function tableFloatOriginY(
  float: TableFloatPosition,
  tableHeightPt: number,
  frames: TableVerticalAnchorFrames,
  keepWhole = false
): number {
  const frame = frames[float.vertAnchor];
  const slack = frame.height - tableHeightPt;
  let y: number;
  if (float.ySpec === 'center') y = frame.top + slack / 2;
  else if (float.ySpec === 'bottom' || float.ySpec === 'outside') y = frame.top + slack;
  else if (float.ySpec) y = frame.top;
  else y = frame.top + float.yPt;
  if (!Number.isFinite(y)) return frame.top;
  const pageBottom = frames.page.top + frames.page.height;
  if (keepWhole) y = Math.min(y, pageBottom - tableHeightPt);
  return Math.max(frames.page.top, Math.min(y, pageBottom));
}
