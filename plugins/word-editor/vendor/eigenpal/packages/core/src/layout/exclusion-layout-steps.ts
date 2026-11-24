// Layout under the exclusion zones that anchored drawings, paragraph frames and floating tables
// produce. Moving one moves the text that wraps around it, which can move it again, so the
// blocks are laid out until the zones settle. Steps, so a long pass may pause; see
// `layout-steps.ts`.

import { exclusionColumnLayoutOf, exclusionSourceOrderOf } from './exclusion-collection-inputs.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  createDrawingExclusionPasses,
  exclusionZoneChangeCount,
} from './drawing-exclusion-passes.ts';
import {
  collectExclusionZonesByPage,
  collectExclusionZonesByPageMemoized,
  DrawingExclusionConvergenceError,
  exclusionMapsEqual,
  MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { noteExclusionLayoutPass } from './exclusion-pass-observer.ts';
import { refusalRetriesWithoutHiddenFurniture } from './furniture-drawing-exclusion.ts';
import { createLayoutSession, replaceLayoutSession, type LayoutSession } from './layout-session.ts';
import type { LayoutSteps } from './layout-steps.ts';
import * as frameWrap from './paragraph-frame-exclusion.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import type { PageRecord } from './semantic-records.ts';
import type { ResolvedSectionColumns } from './section-columns.ts';
import * as tableWrap from './table-float-exclusion.ts';
import {
  markResultUnsettled,
  markSessionUnsettled,
  takeSessionUnsettled,
} from './unsettled-exclusion-layout.ts';
import type { BlockLayoutResult } from './column-balance-layout.ts';
import type { BlockLayoutOptions } from './semantic-layout.ts';

/** Extra full-document layouts after the reflow pass budget to detect a stable 2-cycle. */
const MAX_DRAWING_EXCLUSION_STABILIZATION_PASSES = 2;

/**
 * Hard ceiling for a reflow that is still settling. Objects positioned against text that
 * wraps the object before them form a chain, and each pass settles about one more link, so a
 * long chain needs more passes than the ordinary budget. The extension runs only while the
 * passes keep reaching fewer changed zones.
 */
const MAX_DRAWING_EXCLUSION_SETTLING_PASSES = 64;
let reflowPassLimit = MAX_DRAWING_EXCLUSION_REFLOW_PASSES;
let settlingPassLimit = MAX_DRAWING_EXCLUSION_SETTLING_PASSES;

/**
 * Lowers the pass budget and the settling ceiling until the returned function runs, so a test
 * reaches them with a small document. @internal
 */
export function limitExclusionPassesForTest(reflow: number, settling: number): () => void {
  reflowPassLimit = reflow;
  settlingPassLimit = settling;
  return () => {
    reflowPassLimit = MAX_DRAWING_EXCLUSION_REFLOW_PASSES;
    settlingPassLimit = MAX_DRAWING_EXCLUSION_SETTLING_PASSES;
  };
}

/** Passes a settling reflow may run without a new low of changed zones. */
const SETTLING_PASSES_WITHOUT_PROGRESS = 4;

type OnePass = (
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions
) => LayoutSteps<BlockLayoutResult>;

/**
 * The converged layout of `bodies` under their exclusion zones, or null when nothing in them
 * produces zones (the caller then lays them out once). `layout` is one ordinary pass. An edit
 * starts from the zones of the session's previous pages; see `settleExclusionLayout`.
 */
export function convergeExclusionLayout(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions,
  columns: ResolvedSectionColumns,
  contentWidthForReflow: number,
  layout: OnePass
): LayoutSteps<BlockLayoutResult | null> {
  return settleExclusionLayout(bodies, revision, options, columns, contentWidthForReflow, layout, {
    seedFromPrevious: true,
  });
}

/**
 * `convergeExclusionLayout`, with pass zero laid out under the zones of the session's previous
 * pages when `seedFromPrevious` holds. A seeded reflow that ends in a cycle, or runs out of
 * passes, settles again from scratch: where a reflow enters a cycle decides which of its maps
 * it publishes under, and an edit must lay out like a fresh layout. An edit that enters a
 * cycle pays for that settle (measured on `page-framed-cycle.test.ts`: 7 passes, against 4 for
 * a fresh layout); later edits that leave the cycle alone keep the one seeded pass. A seeded
 * reflow that runs out of passes costs at most one seeded pass plus twice
 * `MAX_DRAWING_EXCLUSION_SETTLING_PASSES` before the fresh settle publishes its last zones.
 */
function* settleExclusionLayout(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions,
  columns: ResolvedSectionColumns,
  contentWidthForReflow: number,
  layout: OnePass,
  {
    seedFromPrevious,
    // Read once per layout, so a fresh settle after a seeded one uses the same limits.
    limits = { reflow: reflowPassLimit, settling: settlingPassLimit },
  }: {
    readonly seedFromPrevious: boolean;
    readonly limits?: { readonly reflow: number; readonly settling: number };
  }
): LayoutSteps<BlockLayoutResult | null> {
  if (!(
    (options.inlineDrawingLayout ||
      frameWrap.hasParagraphFrames(bodies, options.styleCascade) ||
      tableWrap.hasFloatingTables(
        bodies,
        contentWidthForReflow,
        options.styleCascade,
        options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
        options.revisionAuthorFilter,
        options.compatibilityMode
      )) &&
    options.drawingExclusionPass === undefined &&
    !options.drawingExclusionConverged
  ))
    return null;
  const sourceOrderOf = exclusionSourceOrderOf(options);
  const exclusionColumnLayout = exclusionColumnLayoutOf(columns, contentWidthForReflow);
  const collectZones = (pages: readonly PageRecord[], memoized = false) => {
    const drawingZones = !options.inlineDrawingLayout
      ? new Map<number, readonly ExclusionZone[]>()
      : memoized
        ? collectExclusionZonesByPageMemoized(
            pages,
            options.inlineDrawingLayout,
            options.drawingLayoutEpoch,
            contentWidthForReflow,
            options.drawingSourceOrder,
            exclusionColumnLayout
          )
        : collectExclusionZonesByPage(
            pages,
            options.inlineDrawingLayout,
            contentWidthForReflow,
            sourceOrderOf,
            exclusionColumnLayout
          );
    return frameWrap.addParagraphFrameExclusions(
      pages,
      tableWrap.addFloatingTableExclusions(pages, drawingZones, exclusionColumnLayout),
      exclusionColumnLayout
    );
  };
  let zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]> = new Map();
  let result: BlockLayoutResult | null = null;
  let converged = false;
  const exclusionPasses = createDrawingExclusionPasses(
    bodies,
    options.inlineDrawingLayout,
    limits.reflow,
    options.compatibilityMode
  );
  let passCount = 0;
  let lastCandidateSession: LayoutSession | undefined;
  function* layoutExclusionCandidate(
    candidateOptions: BlockLayoutOptions
  ): LayoutSteps<BlockLayoutResult> {
    noteExclusionLayoutPass();
    passCount += 1;
    lastCandidateSession = candidateOptions.session;
    return yield* layout(bodies, revision, candidateOptions);
  }
  function* fallbackUnplaceableFrames(
    candidate: BlockLayoutResult
  ): LayoutSteps<BlockLayoutResult | null> {
    const ids = frameWrap.unplaceableParagraphFrameIds(candidate.pages);
    if (ids.size === 0) return null;
    // IDs only accumulate. After three admission rounds, ordinary flow handles all
    // remaining frames, bounding recursive retries even with changing page reserves.
    const round = options.paragraphFrameFallbackRound ?? 0;
    const disabled = new Set(options.disabledParagraphFrameIds);
    for (const id of round >= 3
      ? frameWrap.unplaceableParagraphFrameIds(candidate.pages, true)
      : ids)
      disabled.add(id);
    const coldSession = options.session ? createLayoutSession() : undefined;
    const fallback = yield* layout(bodies, revision, {
      ...options,
      session: coldSession,
      disabledParagraphFrameIds: disabled,
      paragraphFrameFallbackRound: round + 1,
    });
    if (options.session && coldSession) replaceLayoutSession(options.session, coldSession);
    return fallback;
  }
  const previousPages = seedFromPrevious ? options.session?.previous?.pages : undefined;
  // Taken by every seeded settle, so a mark never outlives the layout it describes.
  const previousUnsettled =
    seedFromPrevious &&
    options.session !== undefined &&
    takeSessionUnsettled(options.session) &&
    previousPages !== undefined;
  const settleFresh = (): LayoutSteps<BlockLayoutResult | null> =>
    settleExclusionLayout(bodies, revision, options, columns, contentWidthForReflow, layout, {
      seedFromPrevious: false,
      limits,
    });
  if (previousPages) {
    zonesByPage = collectZones(previousPages, true);
    result = yield* layoutExclusionCandidate({
      ...options,
      drawingExclusionPass: 0,
      drawingExclusionZonesByPage: zonesByPage,
    });
    const fallback = yield* fallbackUnplaceableFrames(result);
    if (fallback) return fallback;
    // A pass that hands the previous pages back BY IDENTITY was laid under `zonesByPage`
    // and re-collecting from the same page records under the same inputs reproduces the
    // same zones — the equality below is true by construction. Every no-change section of
    // a multi-section document takes this path on every keystroke.
    if (result.pages === previousPages) {
      if (previousUnsettled) {
        markResultUnsettled(result, passCount);
        markSessionUnsettled(options.session!);
      }
      return result;
    }
    // An unsettled layout is no fixed point to seed from (`unsettled-exclusion-layout.ts`).
    if (previousUnsettled) return yield* settleFresh();
    const nextZones = collectZones(result.pages, true);
    if (exclusionMapsEqual(zonesByPage, nextZones)) return result;
    // A return to the seeded map is a cycle too.
    exclusionPasses.remember(zonesByPage);
    zonesByPage = new Map(nextZones);
    exclusionPasses.remember(nextZones);
  }
  // The common document has an image-layout port but no exclusion-producing anchors. Build
  // pass zero with a disposable session so that, when its collected zone map is empty, that
  // very pass is publishable and can seed the caller's incremental state. Previously the
  // engine retained this complete probe while constructing an identical final layout.
  const publishCandidate = (
    candidate: BlockLayoutResult,
    candidateSession: LayoutSession | undefined
  ): BlockLayoutResult => {
    if (options.session && candidateSession)
      replaceLayoutSession(options.session, candidateSession);
    return candidate;
  };
  function* publishConverged(
    zones: ReadonlyMap<number, readonly ExclusionZone[]>
  ): LayoutSteps<BlockLayoutResult> {
    // The caller's session still owns pre-relay pages; resuming it could replay the seeded
    // geometry. Build the converged result cold, then replace the session atomically.
    const candidateSession = options.session ? createLayoutSession() : undefined;
    return publishCandidate(
      yield* layoutExclusionCandidate({
        ...options,
        session: candidateSession,
        drawingExclusionConverged: true,
        drawingExclusionZonesByPage: zones,
      }),
      candidateSession
    );
  }
  // A reflow that keeps reaching a new low of changed zones is still settling, even when one
  // pass moves a few more zones than the pass before it.
  let fewestChanges = Number.POSITIVE_INFINITY;
  let passesSinceFewest = 0;
  let settling = true;
  const noteChanges = (
    previous: ReadonlyMap<number, readonly ExclusionZone[]>,
    next: ReadonlyMap<number, readonly ExclusionZone[]>
  ): void => {
    // The first collection compares against no zones and says nothing about settling.
    if (previous.size === 0) return;
    const changes = exclusionZoneChangeCount(previous, next);
    if (changes < fewestChanges) {
      fewestChanges = changes;
      passesSinceFewest = 0;
    } else passesSinceFewest += 1;
    settling = passesSinceFewest < SETTLING_PASSES_WITHOUT_PROGRESS;
  };
  /**
   * Compares the zones a pass collected with `zonesByPage`, moves `zonesByPage` on, updates
   * `settling` (the stabilization loop's extension test), and says what the loop does next:
   * publish the pass (`stable`), settle again from scratch (`fresh`, a seeded reflow that
   * cycles), publish under `zonesByPage`, now the cycle's zones (`cycle`), or lay out once more
   * under `zonesByPage`, now the collected zones (`continue`).
   */
  const applyTransition = (
    nextZones: ReadonlyMap<number, readonly ExclusionZone[]>,
    stabilization: boolean
  ): 'stable' | 'fresh' | 'cycle' | 'continue' => {
    const transition = exclusionPasses.advance(zonesByPage, nextZones, stabilization);
    if (transition.kind === 'stable') return 'stable';
    noteChanges(zonesByPage, nextZones);
    if (transition.kind === 'cycle' && previousPages) return 'fresh';
    zonesByPage = transition.kind === 'cycle' ? transition.zones : new Map(nextZones);
    return transition.kind;
  };
  for (let pass = 0; pass < exclusionPasses.maxPasses; pass += 1) {
    const candidateSession = options.session ? createLayoutSession() : undefined;
    result = yield* layoutExclusionCandidate({
      ...options,
      session: candidateSession,
      drawingExclusionPass: exclusionPasses.passIndex(pass),
      drawingExclusionZonesByPage: zonesByPage,
    });
    const fallback = yield* fallbackUnplaceableFrames(result);
    if (fallback) return fallback;
    const nextZones = collectZones(result.pages);
    if (nextZones.size === 0) {
      // A candidate laid under seeded zones cannot publish merely because it collected none.
      if (pass === 0 && zonesByPage.size === 0) {
        return publishCandidate(result, candidateSession);
      }
      return yield* publishConverged(nextZones);
    }
    const verdict = applyTransition(nextZones, false);
    if (verdict === 'stable') return publishCandidate(result, candidateSession);
    if (verdict === 'fresh') return yield* settleFresh();
    if (verdict === 'cycle') {
      converged = true;
      break;
    }
  }
  if (!converged) {
    for (
      let stab = 0;
      !converged &&
      (stab < MAX_DRAWING_EXCLUSION_STABILIZATION_PASSES ||
        (settling && exclusionPasses.maxPasses + stab < limits.settling));
      stab += 1
    ) {
      const candidateSession = options.session ? createLayoutSession() : undefined;
      result = yield* layoutExclusionCandidate({
        ...options,
        session: candidateSession,
        drawingExclusionPass: exclusionPasses.maxPasses + stab,
        drawingExclusionZonesByPage: zonesByPage,
      });
      const fallback = yield* fallbackUnplaceableFrames(result);
      if (fallback) return fallback;
      const nextZones = collectZones(result.pages);
      const verdict = applyTransition(nextZones, true);
      if (verdict === 'stable') return publishCandidate(result, candidateSession);
      if (verdict === 'fresh') return yield* settleFresh();
      if (verdict === 'cycle') {
        converged = true;
        break;
      }
    }
  }
  if (!converged) {
    if (previousPages) return yield* settleFresh();
    // A column-balance trial treats a refusal as a band that does not fit, and the caller
    // first retries without hidden header and footer zones, which may settle.
    if (options.columnBalanceTrial || refusalRetriesWithoutHiddenFurniture(options))
      throw new DrawingExclusionConvergenceError(
        `wrap exclusion reflow did not settle in ${passCount} passes`
      );
    // Otherwise the last pass publishes: the document opens, and only the wrap that never
    // settled may sit off by a pass. Laying out once more under its zones is no closer.
    markResultUnsettled(result!, passCount);
    const published = publishCandidate(result!, lastCandidateSession);
    if (options.session) markSessionUnsettled(options.session);
    return published;
  }
  return yield* publishConverged(zonesByPage);
}
