// Section-column balancing over the neutral semantic block-flow pass.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { drainLayoutSteps, type LayoutSteps } from './layout-steps.ts';
import type { RefFieldContext } from './field-ref.ts';
import type { ContinuedPageHost } from './continued-page-zones.ts';
import type { LayoutSession } from './layout-session.ts';
import type { PageContentInsets, OverflowPageShell } from './page-furniture-insets.ts';
import { resolveSectionColumns, type ResolvedSectionColumns } from './section-columns.ts';
import { DEFAULT_SECTION_PROPERTIES, type SectionColumns } from './section-properties.ts';
import type { LayoutBox, PageGeometry, PageRecord, SemanticLayout } from './semantic-records.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { resultUnsettled } from './unsettled-exclusion-layout.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { raisedFloatAnchors } from './balanced-float-anchors.ts';

/** Result shared by ordinary and column-balanced block-flow passes. @internal */
export interface BlockLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
  /** Used height of the LAST page's content column, for a section that continues onto it. */
  readonly endCursorY: number;
  /** Trailing paragraph spacing at the end of the flow, for adjacent-spacing collapse. */
  readonly endSpaceAfter: number;
  /** Whether the last page is the one the flow was still filling. */
  readonly endsOpenPage: boolean;
  /** Resolve the content box and furniture for a note-overflow sheet at this document index. */
  readonly overflowShellAt: (
    documentPageIndex: number,
    box: LayoutBox,
    pageNumberShift?: number
  ) => OverflowPageShell;
}

/** Session state the balance search reads and publishes. */
type ColumnBalanceSession = Pick<
  LayoutSession,
  'balanceLimit' | 'previous' | 'endCursorY' | 'stats'
>;

/** Internal section-flow inputs layered over a host's semantic options. @internal */
export type BlockLayoutOptions<HostOptions extends object = object> = HostOptions & {
  readonly geometry: PageGeometry;
  readonly sectionColumns?: SectionColumns;
  readonly lineCounterStart?: number;
  readonly flowStartY?: number;
  readonly spaceBeforeCarry?: number;
  readonly pageIndexStart?: number;
  readonly furniturePageNumberStart?: number;
  /** The host sheet's content box when this section continues the previous one. */
  readonly continuedPageInsets?: PageContentInsets;
  /** The host sheet, whose furniture drawings and earlier floats the continued text wraps around. */
  readonly continuedPageFurniture?: ContinuedPageHost;
  /** Balance a continuous section's columns instead of filling each to the page bottom. */
  readonly balanceColumns?: boolean;
  /** A continuous section follows, so an empty section-mark paragraph takes no flow height. */
  readonly sectionMarkCollapses?: boolean;
  /**
   * A later section opens the next sheet, so an empty mark right after a page break stays on
   * the sheet the break closed.
   */
  readonly markJoinsBreakSheet?: boolean;
  /** Column bottom on the selected page, used by the bounded balance search. */
  readonly columnRegionBottom?: number;
  /** Section-local page selected for column balancing; defaults to the first page. */
  readonly columnRegionPage?: number;
  /**
   * The anchor tops that the raised floating tables on the balanced page keep from the
   * unbalanced layout (`raisedFloatKeepsUnbalancedPlace`), by table id.
   */
  readonly raisedFloatAnchors?: ReadonlyMap<string, number>;
  readonly compatibilityMode?: number;
  /**
   * Set on a balance search trial, which reads any layout refusal as a band that does not fit,
   * so a wrap reflow that does not settle refuses there instead of publishing.
   */
  readonly columnBalanceTrial?: boolean;
  /** Section page-number format used to measure body page-field placeholders. */
  readonly bodyPageNumberFormat?: string;
  /** Story REF inputs built by the document composition root. */
  readonly refFields?: RefFieldContext;
  readonly session?: ColumnBalanceSession;
};

/** {@link BlockLayoutPass} as steps that may pause. @internal */
export type BlockLayoutPassSteps<HostOptions extends object> = (
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions<HostOptions>
) => LayoutSteps<BlockLayoutResult>;

/** One ordinary block-flow attempt supplied by semantic layout. @internal */
export type BlockLayoutPass<HostOptions extends object> = (
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions<HostOptions>
) => BlockLayoutResult;

/** Content-relative bottom of each column's content on one page, floored at the region top. */
function columnBottomsOf(
  page: PageRecord,
  columns: ResolvedSectionColumns,
  regionTop: number
): number[] {
  const bottoms = columns.lefts.map(() => regionTop);
  for (const fragment of page.fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    let column = 0;
    let columnLeft = -Infinity;
    // A fragment starts at its column's left edge plus indents; assign it to the column with
    // the rightmost origin it does not precede (half-point slack for table indents). By
    // position, not index: a right-to-left section stores its columns right to left.
    for (let index = 0; index < columns.count; index += 1) {
      const left = columns.lefts[index]!;
      if (fragment.box.x + 0.5 >= left && left > columnLeft) {
        column = index;
        columnLeft = left;
      }
    }
    bottoms[column] = Math.max(bottoms[column]!, fragment.box.y + fragment.box.height);
  }
  return bottoms;
}

/** The balance search stops once the fitting bound is known this tightly (points). */
const BALANCE_TOLERANCE_PT = 0.25;
const MAX_BALANCE_STEPS = 20;

/**
 * Lay a block run out under its section geometry, balancing columns when asked.
 *
 * A multi-column section balances its final page before a continuous section follows.
 * The search finds the shortest column height that preserves the natural page count.
 * Trial passes are session-less;
 * only the final pass publishes incremental state.
 */
export function layoutBlocksWithColumnBalance<HostOptions extends object>(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions<HostOptions>,
  layoutPass: BlockLayoutPass<HostOptions>
): BlockLayoutResult {
  return drainLayoutSteps(
    layoutBlocksWithColumnBalanceSteps(bodies, revision, options, function* (b, r, o) {
      return layoutPass(b, r, o);
    })
  );
}

/** {@link layoutBlocksWithColumnBalance} over a pass that may pause; see `layout-steps.ts`. */
export function* layoutBlocksWithColumnBalanceSteps<HostOptions extends object>(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions<HostOptions>,
  layoutPass: BlockLayoutPassSteps<HostOptions>
): LayoutSteps<BlockLayoutResult> {
  const columns = resolveSectionColumns(
    options.sectionColumns ?? DEFAULT_SECTION_PROPERTIES.columns,
    options.geometry.width - options.geometry.margin.left - options.geometry.margin.right
  );
  if (!options.balanceColumns || columns.count < 2 || options.columnRegionBottom !== undefined) {
    if (options.session) options.session.balanceLimit = null;
    const final = yield* layoutPass(bodies, revision, options);
    if (
      !options.balanceColumns &&
      options.sectionMarkCollapses === true &&
      columns.count > 1 &&
      final.endsOpenPage &&
      final.pages.length > 0
    ) {
      // A continuous successor clears every column, even when balancing is disabled.
      const bottoms = columnBottomsOf(final.pages[final.pages.length - 1]!, columns, 0);
      const endCursorY = bottoms.reduce(
        (bottom, value) => Math.max(bottom, value),
        final.endCursorY
      );
      if (options.session) options.session.endCursorY = endCursorY;
      if (endCursorY !== final.endCursorY) return { ...final, endCursorY };
    }
    return final;
  }

  const session = options.session;
  let balancePage = 0;
  let regionTop = options.flowStartY ?? 0;
  const trialOptions: BlockLayoutOptions<HostOptions> = { ...options, session: undefined };
  const balancedResult = (final: BlockLayoutResult): BlockLayoutResult => {
    const page = final.pages[balancePage];
    // The next continuous section resumes below the whole balanced region, not below the
    // last column's own cursor.
    const endCursorY = page
      ? Math.max(...columnBottomsOf(page, columns, regionTop))
      : final.endCursorY;
    if (session) session.endCursorY = endCursorY;
    return { ...final, endCursorY };
  };

  // An unchanged section tries its remembered limit first. A stale limit costs one attempt;
  // the bounded search below then refreshes it.
  if (session && session.balanceLimit !== null) {
    const remembered = session.balanceLimit;
    balancePage = Math.max(0, (session.previous?.pages.length ?? 1) - 1);
    regionTop = balancePage === 0 ? (options.flowStartY ?? 0) : 0;
    const attempt = yield* layoutPass(bodies, revision, {
      ...options,
      columnRegionBottom: remembered,
      columnRegionPage: balancePage,
    });
    if (session.stats.placed === 0 && session.stats.reusedPages === attempt.pages.length) {
      session.balanceLimit = remembered;
      return balancedResult(attempt);
    }
  }

  const natural = yield* layoutPass(bodies, revision, trialOptions);
  // A natural layout whose wrap never settled makes every trial run to the pass ceiling too,
  // only to refuse: skip the search. Each reflow pass still balances its own candidate.
  if (!natural.pages.length || !natural.endsOpenPage || resultUnsettled(natural)) {
    if (session) session.balanceLimit = null;
    // Without a session to fill, the natural layout is that pass already.
    return session ? yield* layoutPass(bodies, revision, options) : natural;
  }
  balancePage = natural.pages.length - 1;
  regionTop = balancePage === 0 ? (options.flowStartY ?? 0) : 0;
  const pinned = hasCompatibilityRule(options.compatibilityMode, 'raisedFloatKeepsUnbalancedPlace')
    ? raisedFloatAnchors(natural.pages[balancePage])
    : undefined;
  const pins = pinned ? { raisedFloatAnchors: pinned } : {};
  const naturalBottoms = columnBottomsOf(natural.pages[balancePage]!, columns, regionTop);
  const total = naturalBottoms.reduce((sum, bottom) => sum + Math.max(0, bottom - regionTop), 0);
  if (total <= 0) {
    if (session) session.balanceLimit = null;
    return yield* layoutPass(bodies, revision, options);
  }

  // An authored column break owns a line in the column it closes. A shorter band can
  // overflow that line before applying the break and incorrectly remove its flow height.
  let breakBottom = regionTop;
  for (const fragment of natural.pages[balancePage]!.fragments) {
    if (fragment.kind !== 'paragraph' || isOutOfFlowFragment(fragment)) continue;
    for (const line of fragment.lines) {
      if (line.breakAfter === 'column') {
        breakBottom = Math.max(breakBottom, line.box.y + line.box.height);
      }
    }
  }
  let low = Math.max(regionTop + total / columns.count, breakBottom);
  let high = Math.max(...naturalBottoms) + 0.01;
  function* fits(limit: number): LayoutSteps<boolean> {
    try {
      const trial = yield* layoutPass(bodies, revision, {
        ...trialOptions,
        ...pins,
        columnBalanceTrial: true,
        columnRegionBottom: limit,
        columnRegionPage: balancePage,
      });
      return trial.pages.length === natural.pages.length && trial.endsOpenPage;
    } catch {
      // Keep rules or atomic rows can refuse a short band; that is simply "does not fit".
      return false;
    }
  }
  // The natural bottoms skip out-of-flow fragments, so the starting `high` is a guess until
  // one trial fits. A bound no trial proved must not reach the final pass: when every trial
  // refused, the section keeps its unbalanced layout.
  let proven = false;
  for (let step = 0; step < MAX_BALANCE_STEPS && high - low > BALANCE_TOLERANCE_PT; step += 1) {
    const mid = (low + high) / 2;
    if (yield* fits(mid)) {
      high = mid;
      proven = true;
    } else low = mid;
  }
  if (!proven && !(yield* fits(high))) {
    if (session) session.balanceLimit = null;
    const final = yield* layoutPass(bodies, revision, options);
    // A refused balance still clears every natural column before the next section.
    const endCursorY = Math.max(final.endCursorY, ...naturalBottoms);
    if (session) session.endCursorY = endCursorY;
    return { ...final, endCursorY };
  }

  const final = yield* layoutPass(bodies, revision, {
    ...options,
    ...pins,
    columnRegionBottom: high,
    columnRegionPage: balancePage,
  });
  if (session) session.balanceLimit = high;
  return balancedResult(final);
}
