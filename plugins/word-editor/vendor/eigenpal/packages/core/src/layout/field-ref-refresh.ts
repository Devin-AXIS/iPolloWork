// Save-time REF result refresh: plan the `refreshFieldResults` ops that make the saved
// bytes carry what the pages paint.
//
// Painted REF values are a layout projection; the file keeps Word's cached result runs, so
// an export after a renumbering edit is stale until Word refreshes fields. The plans reuse
// the layout's own resolution (`resolveStoryRefFields` — grammar, bookmark index, number
// composition AND the per-field calibration verdict, all shared, so save and paint cannot
// drift) and pair it with the store's result locator, then keep only the fields whose
// plain-run cached text differs from the LIVE value. `liveValueOf` answers null for a field
// that failed calibration, so a field painting its cache keeps that cache on save too —
// rewriting it would export the very value the calibration gate exists to suppress. A fresh
// document plans NOTHING: the caller sees null (body) or no plans (notes), runs no
// transaction, bumps no revision, and the save is byte-identical to one without the refresh.
//
// Scope: the BODY story plus the footnote/endnote stories. Note plans carry the note kind
// so the caller can commit each one against its own notes-part scope — the store keeps one
// transaction lane per part, and a plan is pure reading (never `partFor`, which durably
// opens a notes store). The field INSTRUCTION is never modified, and any result the locator
// calls non-rewritable (revision markup, nested fields, locks, anything but plain runs)
// keeps its cache untouched.

import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../store/package/note-references.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  fieldResultUpdateRefusal,
  locateFieldResults,
  MAX_FIELD_RESULT_TEXT_CHARS,
  MAX_FIELD_RESULT_UPDATES,
  type RefreshFieldResultsOp,
} from '../store/store/tree-op-field-results.ts';
import { noteRefNumberingForPart } from './field-noteref.ts';
import {
  buildPageRefTargetIndex,
  formatPageNumber,
  pageRefCalibrationVerdict,
  type PageRefHostRecord,
} from './field-page-furniture.ts';
import type { SemanticLayout } from './semantic-records.ts';
import {
  noteStoriesOfPart,
  parseRefInstruction,
  resolveStoryRefFieldsWithNoteNumbers,
  type RefFieldContext,
  type RefNoteParts,
} from './field-ref.ts';
import { walkStoryParagraphs, withResolvedListItems } from './list-resolve.ts';
import { numberingFlowBlocks } from './hidden-paragraph-mark.ts';
import type { NumberingIndex } from './numbering-index.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { storyBlocks } from './story-roots.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

export interface RefFieldRefreshOptions {
  /**
   * The package the part belongs to, for the note-part half of the resolution context —
   * the same context paint uses, so a body REF that targets a footnote bookmark computes
   * the same value both places. Absent narrows resolution to body-declared bookmarks.
   */
  readonly package?: OoxmlPackage;
  readonly styleCascade?: StyleCascadeTable;
  readonly numberingIndex?: NumberingIndex;
  /** The mode the surface painted under, so the saved values match the painted ones. */
  readonly displayMode?: RevisionDisplayMode;
  /**
   * The DISPLAYED page number of one paragraph in the current finalized layout, or null when
   * it is not placed. PAGEREF results ride the plan through this: the value is pagination's,
   * so only a caller holding the laid-out pages can answer, and a plan without it keeps every
   * PAGEREF result as loaded. The same calibration verdict paint took gates each rewrite.
   */
  readonly pageRefPageNumberOf?: (targetParagraphId: string) => string | null;
}

/**
 * A {@link RefFieldRefreshOptions.pageRefPageNumberOf} source over one finalized layout.
 *
 * Builds the target → host-page index once, on first demand, and answers every field from
 * it — the same walk finalize substitution takes, so the saved number is the painted one.
 */
export function pageRefPageNumbersFromLayout(
  layout: SemanticLayout
): (targetParagraphId: string) => string | null {
  let hosts: ReadonlyMap<string, PageRefHostRecord> | null | undefined;
  return (targetParagraphId) => {
    if (hosts === undefined) hosts = buildPageRefTargetIndex(layout.pages)?.hosts ?? null;
    const host = hosts?.get(targetParagraphId);
    return host ? formatPageNumber(host.pageNumber, host.format) : null;
  };
}

/** One notes part's refresh, tagged with the story scope its transaction must target. */
export interface NoteRefFieldRefreshPlan {
  readonly noteKind: NoteKind;
  readonly op: RefreshFieldResultsOp;
}

interface RefRefreshResolution {
  readonly blocks: readonly OoxmlElement[];
  readonly notes: RefNoteParts | undefined;
  readonly context: RefFieldContext | null;
}

/**
 * The shared resolution both planners read: body blocks, the note parts joined to the scan,
 * and ONE context. Every input is the memoized identity paint resolves through
 * (`storyBlocks`, `withResolvedListItems`, `resolveStoryRefFields`), so the body and note
 * plans of one save read the same context object and the same calibration verdicts.
 */
function resolveRefreshContext(
  part: OoxmlPart,
  options: RefFieldRefreshOptions
): RefRefreshResolution {
  const blocks = storyBlocks(part, options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE);
  const listItems = withResolvedListItems(
    { numberingIndex: options.numberingIndex, styleCascade: options.styleCascade },
    blocks
  ).listItems;
  const notes: RefNoteParts | undefined = options.package
    ? {
        footnotesPart: resolveNotesPart(options.package, 'footnote'),
        endnotesPart: resolveNotesPart(options.package, 'endnote'),
      }
    : undefined;
  // NOTEREF results ride the same plan: the numbering input rebuilds from the package the
  // way the surface builds its notes input, so a refreshed result carries the painted value.
  const context = resolveStoryRefFieldsWithNoteNumbers(
    blocks,
    listItems,
    notes,
    options.package ? noteRefNumberingForPart(options.package, part, blocks) : undefined,
    options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE
  );
  return { blocks, notes, context };
}

/**
 * Collect the stale-but-calibrated fields of one story walk into `updates`, up to the op's
 * cap. Every skip is conservative and per-field: an unrecognized instruction or switch, a
 * missing bookmark, an unnumbered target under a number switch, a non-plain result, a
 * locked field and a field whose calibration verdict is "keeps the cache" all keep their
 * cached runs exactly as loaded.
 */
function collectStaleResultUpdates(
  owningPart: OoxmlPart,
  paragraphs: Iterable<OoxmlElement>,
  context: RefFieldContext,
  updates: { paragraphId: string; fieldNodeId: string; text: string }[],
  pageRefPageNumberOf?: (targetParagraphId: string) => string | null
): void {
  for (const paragraph of paragraphs) {
    if (updates.length >= MAX_FIELD_RESULT_UPDATES) return;
    // The context already scanned every paragraph; only the ones holding recognized REF
    // specs are worth the locate walk.
    if (context.tokenForParagraph(paragraph.id) === '') continue;
    // Validation rejects the WHOLE op for a bound or content-locked paragraph, so the plan
    // must exclude it here — one locked field must not starve every other stale field in
    // the part. The same predicate validation applies, asked against the owning RAW part.
    if (fieldResultUpdateRefusal(owningPart, paragraph.id) !== null) continue;
    for (const located of locateFieldResults(paragraph)) {
      if (updates.length >= MAX_FIELD_RESULT_UPDATES) return;
      if (!located.rewritable) continue;
      const spec = parseRefInstruction(located.instruction);
      if (spec === null) continue;
      // The locator's field id IS the calibration anchor (begin fldChar / fldSimple node),
      // so this read returns exactly what the pages paint — or null for a field painting
      // its cache, which then saves as loaded. A PAGEREF answers through the deferred
      // projection instead: the caller supplies the target's displayed page number, and the
      // same sticky verdict paint's finalize took gates the rewrite.
      let value = context.liveValueOf(located.fieldNodeId, spec);
      if (value === null && pageRefPageNumberOf && context.pageRefProjectionOf) {
        const pageRef = context.pageRefProjectionOf(located.fieldNodeId, spec);
        if (pageRef) {
          const computed = pageRefPageNumberOf(pageRef.targetParagraphId);
          if (
            computed !== null &&
            computed.length > 0 &&
            // NaN revision: a save-time check can neither collide with nor revoke a layout
            // pass's provisional latch (NaN never equals any revision).
            pageRefCalibrationVerdict(pageRef.calibration, pageRef.cached, computed, Number.NaN)
          ) {
            value = computed;
          }
        }
      }
      if (value === null || value === located.cachedText) continue;
      // The op's own bounds, applied per field so one outlier cannot refuse the whole plan:
      // length-capped, and no carriage return (a rewrite writes tabs and line breaks only).
      if (value.length > MAX_FIELD_RESULT_TEXT_CHARS) continue;
      if (value.includes('\r')) continue;
      updates.push({ paragraphId: paragraph.id, fieldNodeId: located.fieldNodeId, text: value });
    }
  }
}

/**
 * Plan the refresh for one body part, or null when every supported REF result is already
 * fresh (the no-op save path — no transaction, no revision bump, no undo entry).
 */
export function planRefFieldResultRefresh(
  part: OoxmlPart,
  options: RefFieldRefreshOptions
): RefreshFieldResultsOp | null {
  const { blocks, context } = resolveRefreshContext(part, options);
  if (context === null) return null;
  const updates: { paragraphId: string; fieldNodeId: string; text: string }[] = [];
  // PAGEREF refresh is BODY-only on purpose: note-story PAGEREF fields paint their cache
  // (notes have no substitute pass), and a save must carry what the pages paint.
  collectStaleResultUpdates(
    part,
    walkStoryParagraphs(numberingFlowBlocks(blocks)),
    context,
    updates,
    options.pageRefPageNumberOf
  );
  if (updates.length === 0) return null;
  return { op: 'refreshFieldResults', updates };
}

/**
 * Plan the refresh for the footnote and endnote parts, empty when every note result is
 * fresh — the same no-op contract as the body plan, per part: a part with no stale field
 * gets no plan, so its store is never opened and its bytes save exactly as loaded.
 *
 * `part` is the BODY part: the context resolves against body bookmarks and numbering, the
 * targets a citing note overwhelmingly names. The note stories walked here are the SAME
 * arrays the context scanned (`noteStoriesOfPart`), so a located field's anchor id reads
 * its own calibration verdict.
 */
export function planNoteRefFieldResultRefreshes(
  part: OoxmlPart,
  options: RefFieldRefreshOptions
): readonly NoteRefFieldRefreshPlan[] {
  const { notes, context } = resolveRefreshContext(part, options);
  if (context === null || notes === undefined) return [];
  const plans: NoteRefFieldRefreshPlan[] = [];
  const noteParts: readonly { noteKind: NoteKind; notesPart: OoxmlPart | null }[] = [
    { noteKind: 'footnote', notesPart: notes.footnotesPart },
    { noteKind: 'endnote', notesPart: notes.endnotesPart },
  ];
  for (const { noteKind, notesPart } of noteParts) {
    if (!notesPart) continue;
    const updates: { paragraphId: string; fieldNodeId: string; text: string }[] = [];
    for (const story of noteStoriesOfPart(
      notesPart,
      options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE
    )) {
      if (updates.length >= MAX_FIELD_RESULT_UPDATES) break;
      collectStaleResultUpdates(
        notesPart,
        walkStoryParagraphs(numberingFlowBlocks(story)),
        context,
        updates
      );
    }
    if (updates.length > 0) plans.push({ noteKind, op: { op: 'refreshFieldResults', updates } });
  }
  return plans;
}
