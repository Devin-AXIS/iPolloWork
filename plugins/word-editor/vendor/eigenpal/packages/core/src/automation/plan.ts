import { createCommentTextPlanner } from './comment-text-plan.ts';
import { areInsertableTexts } from '../store/store/tree-op-inline-elements.ts';
import { TARGET_REMOVED } from './target-removed.ts';
import { planShapes } from './plan-shapes.ts';
import { planTextRanges } from './plan-text-ranges.ts';
import { isSpanControlOperation, planSpanControls } from './plan-span-controls.ts';
import {
  bookmarkHandleRange,
  bookmarkWriteAdmission,
  planBookmarks,
  withEnclosedBookmarkDrops,
} from './plan-bookmarks.ts';
import { planCompare } from './plan-compare.ts';
import { planReplaceDocument } from './plan-replace-document.ts';
import { planPackageOperation } from './plan-package-operations.ts';
// The shared frozen refusal and query answer, under the names this planner has always used.
import { answered as query, refused as refuse } from './plan-results.ts';
import { referencedNoteIds } from './note-references.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import { revisionProtectionRefusal } from './revision-protection.ts';
import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { createContextualRunFormatting } from '../layout/complex-script-formatting.ts';

import {
  TextEditLedger,
  isPlainTextTarget,
  planPlainTextEdit,
  planSingleTextReplacement,
  placeholderInsertionRefusal,
} from './text-edit-ledger.ts';
import { isTextHyperlink } from '../store/store/tree-op-hyperlink-range.ts';
import type { ContentControlLock } from '../store/package/content-control-nodes.ts';
import type { PlannedOperation } from './plan-types.ts';
export type { PlannedOperation } from './plan-types.ts';
import {
  delimitedText,
  delimiterRefusal,
  anchorForSection,
  placeable,
  trimmed,
} from './plan-read-helpers.ts';
import { planContentControlInsertion } from './plan-content-control-insert.ts';
import { planCheckboxGlyphReplacement } from './plan-checkbox-glyph.ts';
import { ownsInsertedControl } from './tracked-content-controls.ts';
import { isInlineAtomOperation, planInlineAtoms } from './plan-fields.ts';
import { planTableOperation } from './plan-tables.ts';
import { planVirtualFurniture } from './virtual-furniture.ts';
import { emptyFrameWriteRefusal } from './empty-text-frame.ts';
import { isAutomationCommand } from './operations.ts';
import { planPictures } from './plan-pictures.ts';
import {
  createRevisionDecisionLedger,
  planKeyedDecision,
  planReviewItemRange,
  planRevisionListing,
} from './review-scope.ts';
import { planBreakOperation, planLineBreak } from './plan-breaks.ts';
import { planParagraphBreaks } from './plan-paragraph-breaks.ts';
import { insertTextOps, lineBreakRefusal, PARAGRAPH_MARK_IN_TEXT } from './line-break-text.ts';
import { edgeTableOf, paragraphTextRefusal, storyKeeper } from './plan-story-edge.ts';
import { planListAuthoring } from './plan-list-authoring.ts';
import { planSetListLevel } from './plan-list-level.ts';
import { createControlLookup } from './plan-control-lookup.ts';
import { hyperlinkStyleFor } from '../store/package/hyperlink-style-edit.ts';
// What each operation MEANS, as reads off a snapshot and `TreeDocOp`s for one transaction.
// The planner is pure with respect to the document: it reads a snapshot and produces ops. Every
// question ("what does inserting a paragraph before another one do to identity", "what does
// deleting across a paragraph mark leave behind") is answered in one testable place instead of
// being distributed across two host adapters.
//
// THREE RULES HOLD EVERYTHING TOGETHER:
//
// 1. QUERIES ANSWER FROM THE START OF THE BATCH. A read is a read of the state the caller's
//    decisions were made against.
//
// 2. COMMANDS ARE PLANNED FROM THE START OF THE BATCH AND APPLIED IN ORDER. Offsets a caller
//    supplies are validated against the state it could see. Disjoint plain text edits rebase
//    their operations and result ranges as earlier commands change that paragraph.
//
// 3. A PARAGRAPH THAT ONE COMMAND RESTRUCTURES BELONGS TO THAT COMMAND. Splitting, deleting, or
//    inserting beside a paragraph changes what its offsets mean; a second command addressing it
//    in the same batch would be planned against coordinates that no longer describe it. That is
//    `conflicting-operations` — refused, never guessed at. It costs nothing real: the common
//    shape, one structural edit per paragraph per sync, is untouched.
//
import type { OoxmlProperty, TreeDocOp } from '../store/store/tree-ops.ts';
import { isSearchableQuery } from '../store/store/text-match.ts';
import { directParagraphProperties, mergedProperties } from '../store/store/direct-properties.ts';
import {
  fontProperties,
  fontVerticalProperties,
  fontRead,
  paragraphFormatRead,
  type AutomationFontWrite,
  type AutomationParagraphFormatWrite,
} from './formatting.ts';
import type {
  AutomationOperation,
  AutomationSearchOptions,
  AutomationSelectionMode,
  AutomationTextProjection,
} from './operations.ts';
import { createBatchCommandPolicy } from './batch-command-policy.ts';
import { paragraphFormatOps } from './plan-paragraph-format.ts';
import { paragraphBordersRead } from './paragraph-borders.ts';
import type { AutomationHandle, AutomationSpan, AutomationValue } from './protocol.ts';
import {
  scopedStoryReads,
  PARAGRAPH_MARK,
  type AutomationPackageReads,
  type AutomationStoryReads,
} from './reads.ts';
import {
  resolveParagraphHandle,
  resolveParagraphRef,
  resolvePoint,
  resolveSpanRef,
  spanOffsets,
  spanParagraphIds,
  spanText,
  spanValue,
  storyOfHandle,
  storyOfSpanRef,
  type ResolvedPoint,
  type ResolvedRange,
  type ResolvedSpan,
} from './spans.ts';
import { BODY_STORY, storyKey, type AutomationStoryId } from './stories.ts';
import { isStoryId } from './stories.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { authorableHyperlinkTarget } from '../store/package/hyperlink-part.ts';
import { bookmarkIn, linkTarget, linksInParagraph, type AutomationLinkRead } from './links.ts';
import { listReads, membershipIn, MAX_LIST_LEVEL, type AutomationListRead } from './lists.ts';
import { pageSetupProperties } from './sections.ts';
import { projectedSearchSpans } from './search.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';
import { paragraphStyleName, styleIdFor } from './styles.ts';
import { commentReads, revisionReads, type AutomationRevisionRead } from './review.ts';
import {
  controlValueOp,
  controlValueRevision,
  trackedValueStart,
} from './tracked-control-value.ts';
import { planProposal, trackedParagraphInsertError, trackedProposalOf } from './plan-proposal.ts';
import { planRevisionDecision } from './revision-operations.ts';
import type { ReviewCommentItem } from '../store/store/review-items.ts';
import {
  planDeleteComment,
  planInsertComment,
  stagedCommentDate,
  validatePlannedCommentFields,
} from './comment-create-plan.ts';
import { contentControlReads, contentControlSpan, contentControlText } from './content-controls.ts';
import { contentControlPropertiesOf } from '../store/package/content-control-nodes.ts';
import {
  CONTENT_CONTROL_LOCKS,
  CONTENT_CONTROL_RANGE_LOCATIONS,
  allControlsUnder,
  contentControlTextInsertionError,
  contentControlValueOf,
} from './content-control-input.ts';
import {
  customNodePayloadOf,
  customNodePlacement,
  customNodeRequestRefusal,
  customNodeWriteOf,
} from './custom-node-plan.ts';

/** A position in the symbolic story order. Bound to a real id after the commit. */
interface Slot {
  id: string | null;
}

import type { BatchPlanner, BatchPlannerHost } from './plan-planner-types.ts';
export type { BatchPlanner, BatchPlannerHost };

/** A handle whose object an edit, a peer, or an undo removed: reading again finds a fresh one. */
const removed = (message: string) => refuse('invalid-handle', message, TARGET_REMOVED);

const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

/** Planning state remains separate for each story and scoped body. */
interface StoryPlan {
  externalCreatedCount: number;
  /**
   * Set when a command replaces the whole package (a compare). Its new paragraphs bind to no
   * slot, so settling does not count them. Such a command commits alone.
   */
  wholesale: boolean;
  readonly reads: AutomationStoryReads;
  /** The symbolic story order: bound slots for paragraphs that exist, unbound for created ones. */
  readonly order: Slot[];
  readonly slotById: Map<string, Slot>;
  readonly created: Slot[];
  /** Paragraphs a command has restructured, and paragraphs any command has touched. */
  readonly restructured: Set<string>;
  readonly touched: Set<string>;
  readonly textEdits: TextEditLedger;
  /** Property containers a command has written, as `container:paragraphId` (`claimFormatting`). */
  readonly formatted: Set<string>;
  /** Selections resolve before writes but apply afterward; edits cannot share their paragraphs. */
  readonly selected: Set<string>;
  readonly retargets: { readonly from: string; readonly slot: Slot }[];
}

export function createBatchPlanner(host: BatchPlannerHost): BatchPlanner {
  const { runPropertyEdits, mergedParagraphMarkProperties } = createContextualRunFormatting(
    () => (host.reads.package ? (stylesPartOf(host.reads.package)?.root ?? null) : null),
    () => (host.reads.package ? (settingsPartOf(host.reads.package)?.root ?? null) : null),
    () => host.displayMode ?? 'proposed'
  );

  const { handles, capabilities } = host;
  const packageReads = host.reads;

  const plans = new Map<string, StoryPlan>();
  const commentTextEdits = createCommentTextPlanner(packageReads);
  // Partial flag writes through aliases compose against earlier writes in this batch.
  // Only own flags are staged; canonical validation still enforces ancestor protection.
  const controlLocks = new Map<StoryPlan, Map<string, ContentControlLock>>();
  const planFor = (reads: AutomationStoryReads): StoryPlan => {
    const key = `${storyKey(reads.story)}:${reads.root.id}`;
    const existing = plans.get(key);
    if (existing) return existing;
    const slotById = new Map<string, Slot>();
    const order: Slot[] = reads.paragraphIds.map((id) => {
      const slot: Slot = { id };
      slotById.set(id, slot);
      return slot;
    });
    const fresh: StoryPlan = {
      externalCreatedCount: 0,
      wholesale: false,
      reads,
      order,
      slotById,
      created: [],
      restructured: new Set<string>(),
      touched: new Set<string>(),
      textEdits: new TextEditLedger(),
      formatted: new Set<string>(),
      selected: new Set<string>(),
      retargets: [],
    };
    plans.set(key, fresh);
    return fresh;
  };

  const selections: { readonly range: ResolvedRange; readonly mode: AutomationSelectionMode }[] =
    [];
  const commandPolicy = createBatchCommandPolicy();
  let dynamicSolitary = false;
  /** The one story this batch writes into, pinned by its first command. */
  let writeStory: StoryPlan | null = null;
  /** Set while planning the text of a write that also splits its paragraph. */
  let paragraphBreakWrite = false;

  /** Keep every command within the batch's single atomic write story. */
  const pinWrite = (plan: StoryPlan): PlannedOperation | null => {
    if (writeStory === null) {
      writeStory = plan;
      return null;
    }
    if (writeStory === plan) return null;
    return refuse(
      'conflicting-operations',
      'one batch writes into one story',
      `${storyKey(writeStory.reads.story)} then ${storyKey(plan.reads.story)}`
    );
  };
  const pinCommentStory = (reads: AutomationStoryReads): PlannedOperation | null =>
    pinWrite(planFor(reads));
  const pinDecision = pinCommentStory;
  const decisions = createRevisionDecisionLedger();

  /**
   * The comments of one story, or null when the document is gone.
   *
   * Read through the package rather than cached per batch: a reply commits and the next
   * operation must see it, and a batch that answered a stale thread would report a reply it
   * had just written as absent.
   */
  const commentsOf = (reads: AutomationStoryReads): ReturnType<typeof commentReads> | null => {
    const pkg = packageReads.package;
    return pkg === null ? null : commentReads(pkg, reads);
  };

  /** One comment's item, with the story it lives in, or a refusal naming which half failed. */
  const commentAt = (
    handle: unknown
  ):
    | { readonly ok: true; readonly reads: AutomationStoryReads; readonly item: ReviewCommentItem }
    | { readonly ok: false; readonly planned: PlannedOperation } => {
    const target = handles.resolve(handle, 'comment');
    if (!target || target.kind !== 'comment') {
      return {
        ok: false,
        planned: refuse('invalid-handle', 'that handle does not name a comment', 'comment'),
      };
    }
    const reads = packageReads.story(target.story);
    if (!reads) {
      return {
        ok: false,
        planned: refuse('invalid-handle', 'that story is not in this document'),
      };
    }
    const comments = commentsOf(reads);
    const item = comments?.byId(target.commentId) ?? null;
    if (!item) {
      return {
        ok: false,
        planned: removed('this document no longer holds that comment'),
      };
    }
    return { ok: true, reads, item };
  };

  /** One decision, with its story. A change the engine cannot resolve is not one of these. */
  const revisionAt = (
    handle: unknown
  ):
    | {
        readonly ok: true;
        readonly reads: AutomationStoryReads;
        readonly item: AutomationRevisionRead;
      }
    | { readonly ok: false; readonly planned: PlannedOperation } => {
    const target = handles.resolve(handle, 'revision');
    if (!target || target.kind !== 'revision') {
      return {
        ok: false,
        planned: refuse('invalid-handle', 'that handle does not name a tracked change', 'revision'),
      };
    }
    const reads = packageReads.story(target.story);
    if (!reads) {
      return { ok: false, planned: refuse('invalid-handle', 'that story is not in this document') };
    }
    // No package: a handle to a record still in the document resolves, listed or not.
    const item = revisionReads(reads, null).find((each) => each.id === target.revisionId) ?? null;
    // RESOLVED MEANS GONE. A decision already made is not re-applied to whatever now occupies
    // its offsets — that would edit text the caller never named.
    if (!item) {
      return {
        ok: false,
        planned: removed('this document no longer holds that tracked change'),
      };
    }
    return { ok: true, reads, item };
  };

  /** A review range as a protocol span, clamped to what the story still holds. */
  const spanOfReviewRange = (
    reads: AutomationStoryReads,
    range: {
      readonly start: { paragraphId: string; offset: number };
      readonly end: { paragraphId: string; offset: number };
    }
  ): AutomationSpan | null => {
    const startText = reads.rawText(range.start.paragraphId);
    const endText = reads.rawText(range.end.paragraphId);
    if (startText === null || endText === null) return null;
    const start: ResolvedPoint = {
      story: reads.story,
      paragraphId: range.start.paragraphId,
      index: reads.indexOf(range.start.paragraphId),
      offset: Math.min(range.start.offset, startText.length),
    };
    const end: ResolvedPoint = {
      story: reads.story,
      paragraphId: range.end.paragraphId,
      index: reads.indexOf(range.end.paragraphId),
      offset: Math.min(range.end.offset, endText.length),
    };
    return spanOf({ start, end });
  };

  const positionOf = (plan: StoryPlan, slot: Slot): number => plan.order.indexOf(slot);

  /** Refuse when a paragraph a queued selection covers is about to be changed. */
  const selectionConflict = (plan: StoryPlan, paragraphId: string): PlannedOperation | null =>
    plan.selected.has(paragraphId)
      ? refuse(
          'conflicting-operations',
          'this batch selects a paragraph it also edits',
          paragraphId
        )
      : null;

  /** Claim a paragraph for a structural command, or say why it cannot be claimed. */
  const claim = (plan: StoryPlan, paragraphId: string): PlannedOperation | null => {
    const selection = selectionConflict(plan, paragraphId);
    if (selection) return selection;
    if (plan.restructured.has(paragraphId) || plan.touched.has(paragraphId)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch already changes that paragraph',
        paragraphId
      );
    }
    plan.restructured.add(paragraphId);
    plan.touched.add(paragraphId);
    return null;
  };

  /** Record a non-structural touch, or say why the paragraph is already spoken for. */
  const touch = (plan: StoryPlan, paragraphId: string): PlannedOperation | null => {
    const selection = selectionConflict(plan, paragraphId);
    if (selection) return selection;
    if (plan.restructured.has(paragraphId) || plan.textEdits.has(paragraphId)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch restructures that paragraph',
        paragraphId
      );
    }
    plan.touched.add(paragraphId);
    return null;
  };

  /** Different property containers may compose; two writes to one container must refuse. */
  const claimFormatting = (
    plan: StoryPlan,
    paragraphId: string,
    container: 'runs' | 'paragraph' | `list:${string}:${number}`
  ): PlannedOperation | null => {
    const claimed = `${container}:${paragraphId}`;
    if (plan.formatted.has(claimed)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch already writes that formatting',
        paragraphId
      );
    }
    const conflict = touch(plan, paragraphId);
    if (conflict) return conflict;
    plan.formatted.add(claimed);
    return null;
  };

  /** A fresh unbound slot at `position`, remembered in creation-independent reading order. */
  const insertSlot = (plan: StoryPlan, position: number): Slot => {
    const slot: Slot = { id: null };
    plan.order.splice(position, 0, slot);
    plan.created.push(slot);
    return slot;
  };

  const spanOf = (range: ResolvedRange): AutomationSpan => spanValue(range, handles);

  /** The story a resolved range lives in, or null when the document went away. */
  const storyReadsOf = (span: ResolvedSpan): AutomationStoryReads | null =>
    span === null ? null : packageReads.story(span.start.story);

  const isTextProjection = (value: unknown): value is AutomationTextProjection | undefined =>
    value === undefined || value === 'allMarkup' || value === 'original' || value === 'model';

  const searchScope = (
    reads: AutomationStoryReads,
    scope: ResolvedSpan,
    text: string,
    options: AutomationSearchOptions | undefined
  ): PlannedOperation => {
    if (!isTextProjection(options?.projection))
      return refuse('unsupported-content', 'unknown text projection', 'projection');
    if (options?.matchWildcards === true)
      return refuse(
        'unsupported-capability',
        'wildcard search is not implemented',
        'matchWildcards'
      );
    if (options?.ignorePunct === true)
      return refuse(
        'unsupported-capability',
        'ignoring punctuation is not implemented',
        'ignorePunct'
      );
    if (options?.ignoreSpace === true)
      return refuse(
        'unsupported-capability',
        'ignoring whitespace is not implemented',
        'ignoreSpace'
      );
    if (!isSearchableQuery(text))
      return refuse('unsupported-content', 'that is not a query this host will scan for', 'text');

    const requested = options?.limit;
    if (requested !== undefined && (!Number.isInteger(requested) || requested < 0))
      return refuse('invalid-offset', 'limit must be a non-negative integer', String(requested));
    // An empty story has nothing to scan. Answering no matches is the truth about it, and it is
    // not the same answer as a refusal — there is no error in searching a document with no text.
    const searched = projectedSearchSpans(reads, scope, handles, text, options);
    if (!searched.ok)
      return refuse('invalid-offset', 'projection mapping failed', searched.paragraphId);
    return query({ kind: 'spans', spans: searched.spans });
  };

  const planPlainText = (
    plan: StoryPlan,
    range: ResolvedRange,
    text: string,
    prepend = false
  ): PlannedOperation => {
    const paragraphId = range.start.paragraphId;
    const conflict = plan.textEdits.has(paragraphId)
      ? selectionConflict(plan, paragraphId)
      : plan.touched.has(paragraphId)
        ? refuse(
            'conflicting-operations',
            'text edits cannot share a paragraph with other edits',
            paragraphId
          )
        : touch(plan, paragraphId);
    if (conflict) return conflict;
    return planPlainTextEdit(plan.textEdits, range, text, handles, prepend);
  };

  const planInsertText = (
    plan: StoryPlan,
    at: ResolvedPoint,
    text: string,
    prepend = false
  ): PlannedOperation => {
    if (typeof text !== 'string' || PARAGRAPH_MARK_IN_TEXT.test(text))
      return refuse('unsupported-content', 'insertText needs text without paragraph marks', 'text');
    const lineBreak = lineBreakRefusal(plan.reads.part, at.paragraphId, at.offset, at.offset, text);
    if (lineBreak) return lineBreak;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const landing = host.replacementLanding?.(at.paragraphId, at.offset, at.offset);
    const tracked = landing != null;
    const promptRefusal =
      !tracked && placeholderInsertionRefusal(plan.reads.part, at.paragraphId, at.offset, text);
    if (promptRefusal) return promptRefusal;
    if (
      !tracked &&
      !paragraphBreakWrite &&
      isPlainTextTarget(plan.reads.part, at.paragraphId, at.offset)
    )
      return planPlainText(plan, { start: at, end: at }, text, prepend);
    const conflict = claim(plan, at.paragraphId);
    if (conflict) return conflict;
    const ops = insertTextOps(at.paragraphId, at.offset, text);
    // A split follows the text to where suggesting mode lands it.
    const start = paragraphBreakWrite && tracked ? { ...at, offset: landing } : at;
    return {
      ok: true,
      kind: 'command',
      ops,
      story: plan.reads.story,
      answer: () => ({
        kind: 'span',
        span: spanOf({ start, end: { ...start, offset: start.offset + text.length } }),
      }),
    };
  };

  const planReplaceSpan = (
    plan: StoryPlan,
    range: ResolvedRange,
    text: string
  ): PlannedOperation => {
    const reads = plan.reads;
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'replaceSpan needs text', 'text');
    if (PARAGRAPH_MARK_IN_TEXT.test(text)) {
      return refuse(
        'unsupported-content',
        'text carrying a paragraph mark is not written by this host',
        'paragraph-mark-in-text'
      );
    }

    const ids = spanParagraphIds(range, reads);
    const first = range.start.paragraphId;
    const ops: TreeDocOp[] = [];
    const textEnd = ids.length === 1 ? range.end.offset : range.start.offset;
    const lineBreak = lineBreakRefusal(reads.part, first, range.start.offset, textEnd, text);
    if (lineBreak) return lineBreak;

    const pin = pinWrite(plan);
    if (pin) return pin;
    const checkbox = planCheckboxGlyphReplacement(reads, range, text, () => ({
      kind: 'span',
      span: spanOf(range),
    }));
    if (checkbox) return claim(plan, first) ?? checkbox;

    const struckEnd = ids.length === 1 ? range.end.offset : (reads.rawText(first) ?? '').length;
    const landing = host.replacementLanding?.(first, range.start.offset, struckEnd);
    if (
      ids.length === 1 &&
      landing == null &&
      !paragraphBreakWrite &&
      isPlainTextTarget(reads.part, first, range.start.offset)
    )
      return planPlainText(plan, range, text);
    if (ids.length === 1) {
      const conflict = claim(plan, first);
      if (conflict) return conflict;
      if (landing == null) return planSingleTextReplacement(reads.part, range, text, handles);
      if (range.end.offset > range.start.offset) {
        ops.push({
          op: 'deleteText',
          paragraphId: first,
          start: range.start.offset,
          end: range.end.offset,
        });
      }
    } else {
      // Crossing a paragraph mark removes the paragraphs between the endpoints and joins what
      // is left of the two ends, because that is what deleting a stretch of a document means.
      // The join is the canonical `joinParagraphs`, so a span that spills across a table cell
      // is refused there and the whole batch with it.
      for (const paragraphId of ids) {
        const conflict = claim(plan, paragraphId);
        if (conflict) return conflict;
      }
      const last = range.end.paragraphId;
      const headLength = (reads.rawText(first) ?? '').length;
      if (range.start.offset < headLength)
        ops.push({
          op: 'deleteText',
          paragraphId: first,
          start: range.start.offset,
          end: headLength,
        });
      if (range.end.offset > 0)
        ops.push({ op: 'deleteText', paragraphId: last, start: 0, end: range.end.offset });
      for (const middle of ids.slice(1, -1)) ops.push({ op: 'deleteBlock', blockId: middle });
      ops.push({ op: 'joinParagraphs', firstId: first, secondId: last });
      for (const gone of ids.slice(1)) {
        const slot = plan.slotById.get(gone);
        if (slot) plan.order.splice(positionOf(plan, slot), 1);
      }
    }

    // Tracked deletions retain text. Their host-provided landing has no plain
    // length delta, so these edits claim their paragraph and cannot compose.
    const at = landing ?? range.start.offset;
    ops.push(...insertTextOps(first, at, text));

    const start: ResolvedPoint = { ...range.start, paragraphId: first, offset: at };
    const answer = (): AutomationValue => ({
      kind: 'span',
      span: spanOf({ start, end: { ...start, offset: start.offset + text.length } }),
    });
    return { ok: true, kind: 'command', ops, story: plan.reads.story, answer };
  };

  /**
   * Whole-body replacement removes blocks rather than joining text across table cells.
   * Preserve section-owning paragraphs and paragraphs within block content controls.
   */
  const planReplaceStory = (plan: StoryPlan, text: string): PlannedOperation => {
    const reads = plan.reads;
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'replaceSpan needs text', 'text');
    if (PARAGRAPH_MARK_IN_TEXT.test(text)) {
      return refuse(
        'unsupported-content',
        'text carrying a paragraph mark is not written by this host',
        'paragraph-mark-in-text'
      );
    }

    const blocks = reads.blocks;
    const removed = blocks.filter((block) => block.removable);
    const survivors = blocks
      .filter((block) => !block.removable)
      .flatMap((block) => block.paragraphIds);

    // One paragraph has to remain to hold the text. When something already has to stay — a section
    // mark, a content control's contents — that IS the remainder, plus the empty paragraph after
    // a final table; otherwise the story's first paragraph is kept, so a caller's handle for it
    // goes on naming a paragraph and a script can clear a story and keep writing to it.
    const keeper = storyKeeper(reads.part, removed, survivors.length);
    if (!keeper && survivors.length === 0) {
      // Every block is a table (or the story is empty). Emptying this story would need a paragraph
      // CREATED at the top level, which is not an op this slice has — and inventing one here would
      // mean guessing at its properties. Refused whole; the document is untouched.
      return refuse(
        'invalid-offset',
        'that story holds no paragraph this host can write into',
        'no-top-level-paragraph'
      );
    }

    // Every paragraph in the story belongs to this one command: it either goes away or is emptied,
    // so a second operation addressing any of them in this batch is planned against text that will
    // not be there.
    const pin = pinWrite(plan);
    if (pin) return pin;
    for (const paragraphId of reads.paragraphIds) {
      const conflict = claim(plan, paragraphId);
      if (conflict) return conflict;
    }

    const ops: TreeDocOp[] = [];
    // Reading order, so the text lands in the first paragraph the story still has.
    const kept: string[] = [...(keeper ? [keeper.id] : []), ...survivors].sort(
      (a, b) => reads.indexOf(a) - reads.indexOf(b)
    );
    const target = kept[0] as string;

    // RAW text, for the reason `planReplaceSpan` spells out: this is the same measure the
    // `deleteText` below strikes with, and the projected one disagrees over a field.
    const targetLength = (reads.rawText(target) ?? '').length;
    for (const paragraphId of kept) {
      const length = (reads.rawText(paragraphId) ?? '').length;
      if (length > 0) ops.push({ op: 'deleteText', paragraphId, start: 0, end: length });
    }
    for (const block of removed) {
      if (block.id === keeper?.id) continue;
      ops.push({ op: 'deleteBlock', blockId: block.id });
    }
    // The same landing rule `planReplaceSpan` reads, for the same reason: in suggesting mode
    // the struck words keep their offsets and the new text belongs after them. Aimed at
    // offset 0 the store relocates it anyway, and the span answered here then named the
    // struck words rather than what replaced them.
    const at = host.replacementLanding?.(target, 0, targetLength) ?? 0;
    const lineBreak = lineBreakRefusal(reads.part, target, 0, targetLength, text);
    if (lineBreak) return lineBreak;
    ops.push(...insertTextOps(target, at, text));

    for (const block of removed) {
      if (block.id === keeper?.id) continue;
      for (const paragraphId of block.paragraphIds) {
        const slot = plan.slotById.get(paragraphId);
        if (slot) plan.order.splice(positionOf(plan, slot), 1);
      }
    }

    const start: ResolvedPoint = {
      story: reads.story,
      paragraphId: target,
      index: reads.indexOf(target),
      offset: at,
    };
    const answer = (): AutomationValue => ({
      kind: 'span',
      span: spanOf({ start, end: { ...start, offset: at + text.length } }),
    });
    return { ok: true, kind: 'command', ops, story: reads.story, answer };
  };

  const planReplaceStoryBlocks = (
    plan: StoryPlan,
    paragraphs: readonly string[]
  ): PlannedOperation => {
    if (
      !Array.isArray(paragraphs) ||
      paragraphs.length < 1 ||
      paragraphs.length > 10_000 ||
      paragraphs.some((text) => typeof text !== 'string' || PARAGRAPH_MARK_IN_TEXT.test(text)) ||
      !areInsertableTexts(paragraphs)
    ) {
      return refuse(
        'unsupported-content',
        'replaceStoryBlocks needs 1-10000 valid XML text strings without paragraph marks',
        'paragraphs'
      );
    }
    const pin = pinWrite(plan);
    if (pin) return pin;
    for (const paragraphId of plan.reads.paragraphIds) {
      const conflict = claim(plan, paragraphId);
      if (conflict) return conflict;
    }
    plan.order.splice(0, plan.order.length);
    for (let index = 0; index < paragraphs.length; index += 1) {
      insertSlot(plan, index);
    }
    return {
      ok: true,
      kind: 'command',
      ops: [
        {
          op: 'replaceStoryBlocks',
          storyRootId: plan.reads.root.id,
          paragraphs,
        },
      ],
      story: plan.reads.story,
      answer: () => APPLIED,
    };
  };

  const planInsertParagraph = (
    plan: StoryPlan,
    anchor: ResolvedPoint,
    where: 'before' | 'after',
    text: string
  ): PlannedOperation => {
    const reads = plan.reads;
    const textRefusal = paragraphTextRefusal(text);
    if (textRefusal) return textRefusal;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const conflict = claim(plan, anchor.paragraphId);
    if (conflict) return conflict;

    const anchorSlot = plan.slotById.get(anchor.paragraphId);
    if (!anchorSlot) return refuse('invalid-handle', 'that paragraph is not in the body');
    const anchorLength = (reads.rawText(anchor.paragraphId) ?? '').length;
    const edge = where === 'after' ? anchorLength : 0;
    const lineBreak = lineBreakRefusal(reads.part, anchor.paragraphId, edge, edge, text);
    if (lineBreak) return lineBreak;
    const ops: TreeDocOp[] = [];
    // One paragraph becomes two by splitting one: `splitParagraph` leaves the HEAD on the
    // original node and puts the TAIL on a new one. So "after" writes the new text at the end
    // and cuts it off, and "before" writes it at the start and cuts everything else off —
    // which moves the ANCHOR'S content to the new node, and its identity with it.
    if (where === 'after') {
      ops.push(...insertTextOps(anchor.paragraphId, anchorLength, text));
      ops.push({ op: 'splitParagraph', paragraphId: anchor.paragraphId, offset: anchorLength });
    } else {
      ops.push(...insertTextOps(anchor.paragraphId, 0, text));
      ops.push({ op: 'splitParagraph', paragraphId: anchor.paragraphId, offset: text.length });
    }
    const fresh = insertSlot(plan, positionOf(plan, anchorSlot) + 1);
    if (where === 'before') plan.retargets.push({ from: anchor.paragraphId, slot: fresh });

    // "after" names the created node; "before" names the original one, which now holds the
    // inserted paragraph. Both are asked for AFTER the retarget, so the handle is a new ref.
    const answer = (): AutomationValue => {
      const id = where === 'after' ? fresh.id : anchor.paragraphId;
      if (id === null) return APPLIED;
      return { kind: 'handle', handle: handles.paragraph(id, reads.story) };
    };
    return { ok: true, kind: 'command', ops, story: reads.story, answer };
  };

  const planSplitParagraph = (
    plan: StoryPlan,
    paragraph: ResolvedPoint,
    delimiters: readonly string[],
    trimDelimiters: boolean,
    trimSpacing: boolean
  ): PlannedOperation => {
    const reads = plan.reads;
    const badDelimiters = delimiterRefusal(delimiters);
    if (badDelimiters) return badDelimiters;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const conflict = claim(plan, paragraph.paragraphId);
    if (conflict) return conflict;

    const slot = plan.slotById.get(paragraph.paragraphId);
    if (!slot) return refuse('invalid-handle', 'that paragraph is not in the body');
    const { text, occurrences } = delimitedText(reads, paragraph.paragraphId, delimiters);

    const ops: TreeDocOp[] = [];
    const offsets: number[] = [];
    /** The text each resulting paragraph will hold, for the answered ranges. */
    const pieces: string[] = [];

    if (occurrences.length === 0) {
      pieces.push(text);
    } else if (trimDelimiters) {
      // Cut the delimiters out from the LAST backwards, so every remaining op's offsets still
      // describe the paragraph the caller measured.
      for (const occurrence of [...occurrences].reverse()) {
        ops.push({
          op: 'deleteText',
          paragraphId: paragraph.paragraphId,
          start: occurrence.start,
          end: occurrence.start + occurrence.length,
        });
      }
      let removed = 0;
      let previous = 0;
      for (const occurrence of occurrences) {
        const at = occurrence.start - removed;
        offsets.push(at);
        pieces.push(text.slice(previous, occurrence.start));
        previous = occurrence.start + occurrence.length;
        removed += occurrence.length;
      }
      pieces.push(text.slice(previous));
    } else {
      let previous = 0;
      for (const occurrence of occurrences) {
        const at = occurrence.start + occurrence.length;
        offsets.push(at);
        pieces.push(text.slice(previous, at));
        previous = at;
      }
      pieces.push(text.slice(previous));
    }

    if (offsets.length > 0)
      ops.push({ op: 'splitParagraphMany', paragraphId: paragraph.paragraphId, offsets });

    const parts: Slot[] = [slot];
    for (let index = 0; index < offsets.length; index += 1)
      parts.push(insertSlot(plan, positionOf(plan, slot) + 1 + index));

    const answer = (post: AutomationPackageReads): AutomationValue => {
      const after = post.story(reads.story);
      const spans: AutomationSpan[] = [];
      parts.forEach((part, index) => {
        const id = part.id;
        if (id === null) return;
        const piece = after?.rawText(id) ?? pieces[index] ?? '';
        const [from, to] = trimSpacing ? trimmed(piece, 0, piece.length) : [0, piece.length];
        const handle = handles.paragraph(id, reads.story);
        spans.push({
          start: { paragraph: handle, offset: from },
          end: { paragraph: handle, offset: to },
        });
      });
      return { kind: 'spans', spans };
    };
    return { ok: true, kind: 'command', ops, story: reads.story, answer };
  };

  const planDeleteParagraph = (plan: StoryPlan, paragraph: ResolvedPoint): PlannedOperation => {
    const pin = pinWrite(plan);
    if (pin) return pin;
    const conflict = claim(plan, paragraph.paragraphId);
    if (conflict) return conflict;
    const slot = plan.slotById.get(paragraph.paragraphId);
    if (slot) plan.order.splice(positionOf(plan, slot), 1);
    return {
      ok: true,
      kind: 'command',
      ops: [{ op: 'deleteBlock', blockId: paragraph.paragraphId }],
      story: plan.reads.story,
      answer: () => APPLIED,
    };
  };

  /**
   * Author run properties over a span.
   *
   * One `setRunProperties` op per RUN the span covers — not per paragraph — each carrying that
   * run's own authored properties with the request merged over them. Both halves of that are
   * load-bearing, and `runPropertyEdits` is the one implementation of them: the op replaces the
   * container it writes, so a per-paragraph op would homogenise a mixed selection onto one run's
   * font, and an op that did not carry the run's bag forward would delete the colour of every run
   * it resized.
   *
   * The paragraph MARK's own `w:rPr` is written for every paragraph the span covers WHOLE, which
   * is what Word does and is not cosmetic: a list marker takes its face from the pilcrow, so a
   * whole-paragraph size change that skipped it leaves the bullet at the old size.
   *
   * A span covering no characters is refused: there is nothing to format, and writing the mark
   * alone would format a paragraph the caller addressed as a caret.
   */
  const planSetFont = (
    plan: StoryPlan,
    range: ResolvedRange,
    request: AutomationFontWrite
  ): PlannedOperation => {
    const reads = plan.reads;
    const part = reads.part;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const properties = fontProperties(request ?? {});
    if (!properties.ok)
      return refuse(
        'unsupported-content',
        'that is not formatting this host writes',
        properties.detail
      );
    const ops: TreeDocOp[] = [];
    for (const share of spanOffsets(range, reads)) {
      if (share.end <= share.start && !share.whole) continue;
      const conflict = claimFormatting(plan, share.paragraphId, 'runs');
      if (conflict) return conflict;
      for (const edit of runPropertyEdits(
        part,
        share.paragraphId,
        share.start,
        share.end,
        properties.value.filter((property) => property.localName !== 'vertAlign'),
        host.displayMode
      )) {
        ops.push({
          op: 'setRunProperties',
          paragraphId: share.paragraphId,
          start: edit.start,
          end: edit.end,
          properties: fontVerticalProperties(edit.properties, request),
          ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
        });
      }
      if (share.whole) {
        ops.push({
          op: 'setParagraphMarkProperties',
          paragraphId: share.paragraphId,
          properties: fontVerticalProperties(
            mergedParagraphMarkProperties(
              part,
              share.paragraphId,
              properties.value.filter((property) => property.localName !== 'vertAlign')
            ),
            request
          ),
        });
      }
    }
    if (ops.length === 0)
      return refuse(
        'invalid-offset',
        'that range covers no characters to format',
        'collapsed-range'
      );
    return { ok: true, kind: 'command', ops, story: reads.story, answer: () => APPLIED };
  };

  /**
   * Apply a paragraph style to every paragraph a span covers.
   *
   * One `setParagraphProperties` op per paragraph, each carrying that paragraph's own authored
   * properties with `w:pStyle` merged over them — the same rule every property write follows, and
   * the reason a style change does not delete a paragraph's indents and numbering. The style is
   * resolved ONCE for the whole span: it is a property of the document, not of a paragraph.
   */
  const planSetStyle = (plan: StoryPlan, range: ResolvedRange, name: string): PlannedOperation => {
    const reads = plan.reads;
    const part = reads.part;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const resolved = styleIdFor(name, reads.styles());
    if (!resolved.ok)
      return refuse(
        'unsupported-content',
        'that is not a style this document has',
        resolved.detail
      );
    const style: OoxmlProperty = {
      localName: 'pStyle',
      attributes: { val: resolved.styleId },
    };
    const ops: TreeDocOp[] = [];
    for (const paragraphId of spanParagraphIds(range, reads)) {
      const conflict = claimFormatting(plan, paragraphId, 'paragraph');
      if (conflict) return conflict;
      ops.push({
        op: 'setParagraphProperties',
        paragraphId,
        properties: mergedProperties(directParagraphProperties(part, paragraphId), style),
      });
    }
    if (ops.length === 0)
      return refuse('invalid-offset', 'that story holds no paragraph to style', 'empty-story');
    return { ok: true, kind: 'command', ops, story: reads.story, answer: () => APPLIED };
  };

  const planSetParagraphFormat = (
    plan: StoryPlan,
    paragraph: ResolvedPoint,
    request: AutomationParagraphFormatWrite
  ): PlannedOperation => {
    const reads = plan.reads;
    const part = reads.part;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const planned = paragraphFormatOps(part, paragraph.paragraphId, request ?? {}, reads.styles());
    if (!planned.ok)
      return refuse(
        'unsupported-content',
        'that is not paragraph formatting this host writes',
        planned.detail
      );
    const conflict = claimFormatting(plan, paragraph.paragraphId, 'paragraph');
    if (conflict) return conflict;
    return {
      ok: true,
      kind: 'command',
      ops: planned.ops,
      story: reads.story,
      answer: () => APPLIED,
    };
  };

  /**
   * Author page geometry on one section.
   *
   * ANCHORED, never applied document-wide: the op's own default is every section, and a caller
   * that asked about section two and got section one changed as well would have no way to notice.
   * The anchor is the paragraph whose mark ends the section — which is what `setSectionProperties`
   * resolves "the section governing this paragraph" from — or, for the final section that no mark
   * closes, the story's last paragraph.
   */
  const planSetPageSetup = (index: number, request: unknown): PlannedOperation => {
    const body = packageReads.body;
    if (!body) return refuse('document-unavailable', 'this host holds no document right now');
    const sections = packageReads.sections();
    const section = sections[index];
    if (!section) return refuse('invalid-handle', 'that section is not in this document');

    const fields = pageSetupProperties(request);
    if (!fields.ok) return refuse('unsupported-content', fields.reason, fields.detail);

    const anchorParagraphId = anchorForSection(body, sections, index);
    if (anchorParagraphId === null) {
      return refuse(
        'unsupported-content',
        'that section holds no paragraph to address it by',
        'no-anchor'
      );
    }

    const plan = planFor(body);
    const pin = pinWrite(plan);
    if (pin) return pin;
    // A SECTION IS NOT A PARAGRAPH, so nothing is claimed on the anchor: it is only how the op
    // names which `w:sectPr` to write, and the paragraph itself is untouched.
    return {
      ok: true,
      kind: 'command',
      ops: [{ op: 'setSectionProperties', ...fields.value, anchorParagraphId }],
      story: BODY_STORY,
      answer: () => APPLIED,
    };
  };

  /** Delete a note: package-level, so it travels alone. */
  const planDeleteNote = (noteKind: NoteKind, noteId: number): PlannedOperation => ({
    ok: true,
    kind: 'command',
    ops: [{ op: 'deleteNote', noteKind, noteId }],
    story: BODY_STORY,
    lifecycle: true,
    answer: () => APPLIED,
  });

  /**
   * The list a `list` handle names, in the story it names.
   *
   * Re-derived per operation rather than remembered from when the handle was minted: paragraphs
   * join and leave lists, so a list's membership is a fact about the document NOW. A number the
   * story no longer uses is a refusal — the list is gone, and answering an empty one would let a
   * caller believe a list survived the paragraph that was in it.
   */
  const listOf = (
    handle: unknown
  ): { ok: true; plan: StoryPlan; list: AutomationListRead } | PlannedOperation => {
    const target = handles.resolve(handle, 'list');
    if (!target || target.kind !== 'list')
      return refuse('invalid-handle', 'that handle does not name a list', 'list');
    const reads = packageReads.story(target.story);
    if (!reads) return refuse('invalid-handle', 'that story is not in this document');
    const found = listReads(reads).find((list) => list.numId === target.numId);
    if (!found) return removed('this story numbers nothing with that list');
    return { ok: true, plan: planFor(reads), list: found };
  };

  const { controlOf, controlScope } = createControlLookup(handles, packageReads);

  /**
   * Add an item at one edge of a list.
   *
   * ONE transaction and no numbering op of its own: a paragraph created beside a list item is
   * created BY SPLITTING it, and a split copies the paragraph's `w:pPr` — its `w:numPr` with it —
   * to both halves. So the new paragraph is in the list at the same level because it is the same
   * paragraph properties, which is also why Enter at the end of a list item continues the list in
   * Word. Stating the numbering again would mean naming a node the transaction has not made yet,
   * and that is a second commit.
   */
  const planInsertListParagraph = (
    plan: StoryPlan,
    list: AutomationListRead,
    where: 'start' | 'end',
    text: string
  ): PlannedOperation => {
    if (where !== 'start' && where !== 'end') {
      return refuse(
        'unknown-operation',
        'a list takes an item at its start or its end',
        String(where)
      );
    }
    const reads = plan.reads;
    const edgeId =
      where === 'start' ? list.paragraphIds[0] : list.paragraphIds[list.paragraphIds.length - 1];
    if (edgeId === undefined) return refuse('invalid-handle', 'that list holds no paragraph');
    const anchor: ResolvedPoint = {
      story: reads.story,
      paragraphId: edgeId,
      index: reads.indexOf(edgeId),
      offset: 0,
    };
    return planInsertParagraph(plan, anchor, where === 'start' ? 'before' : 'after', text);
  };

  /**
   * The one link that covers a whole span, or null.
   *
   * "Covers" is strict: a span reaching outside the link is not the link's span. A span crossing a
   * paragraph mark is never one link's either — a `w:hyperlink` lives inside one `w:p`.
   */
  const linkCovering = (
    reads: AutomationStoryReads,
    range: ResolvedRange
  ): AutomationLinkRead | null => {
    if (range.start.paragraphId !== range.end.paragraphId) return null;
    for (const link of linksInParagraph(reads, range.start.paragraphId)) {
      if (link.start <= range.start.offset && link.end >= range.end.offset) return link;
    }
    return null;
  };

  const planSetHyperlink = (
    plan: StoryPlan,
    range: ResolvedRange,
    target: string
  ): PlannedOperation => {
    if (typeof target !== 'string')
      return refuse('unsupported-content', 'a hyperlink target is a string', 'target');
    const reads = plan.reads;
    const existing = linkCovering(reads, range);
    const collapsed =
      range.start.paragraphId === range.end.paragraphId && range.start.offset === range.end.offset;

    const partial =
      existing && (range.start.offset !== existing.start || range.end.offset !== existing.end);
    const bounds = partial ? { range: { start: range.start.offset, end: range.end.offset } } : {};
    if (partial) {
      const paragraph = reads.node(existing.paragraphId);
      const link =
        paragraph?.kind === 'paragraph'
          ? paragraph.children.find((child) => child.id === existing.id)
          : undefined;
      if (
        collapsed ||
        !link ||
        !isTextHyperlink(link) ||
        paragraph?.kind !== 'paragraph' ||
        !paragraph.children.some((child) => child.id === existing.id)
      ) {
        return refuse(
          'unsupported-capability',
          'partial hyperlink edits require ordinary text in a paragraph'
        );
      }
    }

    if (target.length === 0) {
      if (!existing) return refuse('unsupported-content', 'that text is not a link', 'no-link');
      const pin = pinWrite(plan);
      if (pin) return pin;
      const conflict = touch(plan, existing.paragraphId);
      if (conflict) return conflict;
      return {
        ok: true,
        kind: 'command',
        ops: [{ op: 'removeHyperlink', linkId: existing.id, ...bounds }],
        story: reads.story,
        answer: () => APPLIED,
      };
    }

    let aimed: { readonly anchor?: string } = {};
    /** The external target to mint for, once the batch is allowed to write. */
    let external: string | null = null;
    if (target.startsWith('#')) {
      const name = target.slice(1);
      if (name.length === 0 || !bookmarkIn(reads, name))
        return refuse('unsupported-content', 'this document declares no such bookmark', target);
      aimed = { anchor: name };
    } else {
      if (authorableHyperlinkTarget(target) === null)
        return refuse('unsupported-content', 'this engine will not author that target', 'target');
      external = target;
    }

    const pin = pinWrite(plan);
    if (pin) return pin;

    /** A command whose ops are ready, or scheduled behind the relationship they name. */
    const staged = (
      build: (aim: { readonly relationshipId?: string; readonly anchor?: string }) => TreeDocOp
    ): PlannedOperation =>
      external === null
        ? {
            ok: true,
            kind: 'command',
            ops: [build(aimed)],
            story: reads.story,
            answer: () => APPLIED,
          }
        : {
            ok: true,
            kind: 'command',
            ops: [],
            relate: {
              url: external,
              ops: (relationshipId: string) => [build({ relationshipId })],
            },
            story: reads.story,
            answer: () => APPLIED,
          };

    if (existing) {
      const conflict = touch(plan, existing.paragraphId);
      if (conflict) return conflict;
      return staged((aim) => ({
        op: 'setHyperlinkTarget',
        linkId: existing.id,
        ...bounds,
        ...aim,
      }));
    }

    if (collapsed)
      return refuse('unsupported-content', 'a link with no text has nothing to click', 'collapsed');
    if (range.start.paragraphId !== range.end.paragraphId) {
      return refuse(
        'unsupported-content',
        'a link lives inside one paragraph',
        'crosses-paragraph-mark'
      );
    }
    const conflict = touch(plan, range.start.paragraphId);
    if (conflict) return conflict;
    // A document without the hyperlink character style gets the built-in one in the same
    // commit, so the new link is visibly a link. A collaborative host adds it only when it
    // commits setup outside shared undo, and never creates the styles part.
    const { styleId, edit } = hyperlinkStyleFor(packageReads.package, {
      add: !host.collaborative || host.setupOutsideUndo === true,
      createPart: !host.collaborative,
    });
    const linked = staged((aim) => ({
      op: 'insertHyperlink',
      paragraphId: range.start.paragraphId,
      start: range.start.offset,
      end: range.end.offset,
      ...aim,
      ...(styleId === null ? {} : { styleId }),
    }));
    return edit && linked.ok && linked.kind === 'command'
      ? { ...linked, packageEdits: [edit] }
      : linked;
  };

  const planSelect = (
    plan: StoryPlan,
    range: ResolvedRange,
    mode: AutomationSelectionMode
  ): PlannedOperation => {
    const reads = plan.reads;
    if (!capabilities.selection || !host.select)
      return refuse('unsupported-capability', 'this host has no reader to move', 'selection');
    if (mode !== 'select' && mode !== 'start' && mode !== 'end')
      return refuse('unknown-operation', 'that is not a selection mode', String(mode));
    const refusal = host.selectRefusal?.(reads.story, range.start.paragraphId);
    if (refusal) return refuse('unsupported-capability', refusal, 'selection');
    // Selecting is applied after the transaction, so a batch that also EDITS one of the
    // paragraphs the selection covers would place a caret using coordinates the edit moved.
    const covered = spanParagraphIds(range, reads);
    for (const paragraphId of covered) {
      if (plan.touched.has(paragraphId)) {
        return refuse(
          'conflicting-operations',
          'this batch edits a paragraph the selection covers',
          paragraphId
        );
      }
    }
    for (const paragraphId of covered) plan.selected.add(paragraphId);
    selections.push({ range, mode });
    // NO SCOPE PINNED. Moving a reader's caret writes nothing, so it does not claim the batch's
    // one write story — a script may select in a header while it edits the body. Answered as
    // a read for the same reason: a read-only document still lets a reader be moved. The
    // caret moves when the batch settles.
    return { ok: true, kind: 'query', value: APPLIED };
  };

  const resolveBookmarkRange = (handle: AutomationHandle) =>
    bookmarkHandleRange(handle, handles, packageReads);

  const plan = (operation: AutomationOperation, trackingAuthor?: string): PlannedOperation => {
    const lineBreak = planLineBreak(operation, (text) => plan(text, trackingAuthor));
    if (lineBreak) return lineBreak;
    const virtual = planVirtualFurniture(operation, host, (reads) =>
      createBatchPlanner({ ...host, reads })
    );
    if (virtual) {
      if (trackingAuthor && virtual.ok && virtual.kind === 'command')
        return refuse('unsupported-content', 'header/footer creation cannot be tracked');
      return virtual;
    }
    const table = planTableOperation(operation, {
      trackingAuthor,
      trackedRangeReplacement: host.trackedRangeReplacement,
      handles,
      reads: packageReads,
      admitWrite: (reads, count, paragraphIds, reshaped = []) => {
        const plan = planFor(reads);
        const refusal = pinWrite(plan);
        if (refusal) return refusal;
        for (const id of paragraphIds) {
          // A cell write plans again on what an earlier merge made, so only the merge's mark
          // (restructured, never touched) gives way to it. A text edit still refuses.
          if (!plan.touched.has(id)) plan.restructured.delete(id);
          const conflict = claim(plan, id);
          if (conflict) return conflict;
        }
        for (const id of reshaped) plan.restructured.add(id);
        plan.externalCreatedCount += count;
        return null;
      },
    });
    if (table) return table;
    const breaks = planParagraphBreaks(operation, {
      handles,
      reads: packageReads,
      trackingAuthor,
      planJoined: (joined) => {
        paragraphBreakWrite = true;
        try {
          return plan(joined, trackingAuthor);
        } finally {
          paragraphBreakWrite = false;
        }
      },
      reserve: (paragraphId, count) => {
        const pinned = writeStory;
        const anchor = pinned?.slotById.get(paragraphId);
        if (!pinned || !anchor) return null;
        const position = positionOf(pinned, anchor) + 1;
        return Array.from({ length: count }, (_, index) => insertSlot(pinned, position + index));
      },
    });
    if (breaks) return breaks;
    const tracked = trackingAuthor !== undefined;
    if (tracked) {
      const proposal = trackedProposalOf(operation, trackingAuthor, handles, packageReads);
      if ('ok' in proposal) return proposal;
      operation = proposal;
    }
    if (isSpanControlOperation(operation))
      return planSpanControls(operation, handles, packageReads);
    if (isInlineAtomOperation(operation))
      return planInlineAtoms(
        operation,
        handles,
        packageReads,
        (story, paragraphId, resultOnly) => {
          const plan = planFor(story);
          return pinWrite(plan) ?? (resultOnly ? null : claim(plan, paragraphId));
        },
        host.fieldPageContext,
        trackingAuthor
      );
    const protectedRevision = revisionProtectionRefusal(operation, packageReads.package);
    if (protectedRevision) return protectedRevision;
    switch (operation.op) {
      case 'getShapes':
      case 'getShape':
      case 'getShapeBody':
      case 'getShapeFill':
      case 'setShapeFill':
        return planShapes(operation, handles, packageReads, (story, paragraphId) => {
          const plan = planFor(story);
          return pinWrite(plan) ?? claim(plan, paragraphId);
        });
      case 'getTextRanges':
      case 'getParagraphTextIfPresent':
      case 'getParagraphTextSpan':
      case 'expandSpan':
      case 'getReviewedText':
        return planTextRanges(operation, handles, packageReads);
      case 'getInlinePictures':
      case 'getInlinePicture':
      case 'setInlinePicture':
      case 'deleteInlinePicture':
      case 'insertInlinePicture':
        return planPictures(operation, handles, packageReads, (story, paragraphId) => {
          const plan = planFor(story);
          return pinWrite(plan) ?? claim(plan, paragraphId);
        });
      case 'getBookmarks':
      case 'getBookmarkName':
      case 'getBookmarkNames':
      case 'getBookmarkRangeByName':
      case 'insertBookmark':
      case 'deleteBookmark':
        return planBookmarks(operation, handles, packageReads, {
          admit: bookmarkWriteAdmission(planFor, pinWrite, claim),
          pinned: () => writeStory?.reads.story ?? null,
        });
      case 'insertBreak':
        return planBreakOperation(
          operation,
          handles,
          packageReads,
          (story, paragraphId, createdCount) => {
            const plan = planFor(story);
            const refusal = pinWrite(plan) ?? claim(plan, paragraphId);
            if (!refusal) plan.externalCreatedCount += createdCount;
            return refusal;
          },
          trackingAuthor
        );
      case 'startNewList':
      case 'attachToList':
      case 'detachFromList':
      case 'setListLevelFormat':
        return planListAuthoring(
          operation,
          handles,
          packageReads,
          (story, paragraphId, numbering) => {
            const plan = planFor(story);
            return (
              pinWrite(plan) ??
              claimFormatting(
                plan,
                paragraphId,
                numbering ? `list:${numbering.numId}:${numbering.level}` : 'paragraph'
              )
            );
          },
          trackingAuthor
        );
      case 'compareFromBase64':
      case 'replaceDocumentFromBase64': {
        const pin = () => {
          const plan = planFor(packageReads.body!);
          const refusal = pinWrite(plan);
          if (!refusal) plan.wholesale = true;
          return refusal;
        };
        if (operation.op === 'replaceDocumentFromBase64')
          return planReplaceDocument(operation, { reads: packageReads, handles, pin });
        const { compareDocuments: engine, collaborative = false } = host;
        return planCompare(operation, { reads: packageReads, engine, collaborative, pin });
      }
      case 'removeDocumentInformation':
      case 'getDocumentProperty':
      case 'setDocumentProperties':
      case 'getStyles':
      case 'getSections':
      case 'getPageSetup':
        return planPackageOperation(operation, {
          reads: packageReads,
          handles,
          pin: () => pinWrite(planFor(packageReads.body!)),
          supportsPartCreation: !host.collaborative,
        });
      case 'getDocument':
        return query({ kind: 'handle', handle: handles.document() });

      case 'getBody': {
        if (!handles.resolve(operation.document, 'document'))
          return refuse('invalid-handle', 'that handle does not name a document', 'document');
        // A DOCUMENT'S BODY IS THE MAIN STORY, always. Headers, footers and notes are reached
        // through the section or the note that declares them, because that is where a document
        // says they exist — asking a document for "the header" has no answer.
        if (!packageReads.body)
          return refuse('document-unavailable', 'this host holds no document right now');
        return query({ kind: 'handle', handle: handles.body(BODY_STORY) });
      }

      case 'getParagraphs': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        return query({
          kind: 'handles',
          handles: story.value.paragraphIds.map((id) => handles.paragraph(id, story.value.story)),
        });
      }

      case 'getRange': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value) return refuse('invalid-offset', 'empty story');
        if (!['Whole', 'Content', 'Start', 'End'].includes(operation.location))
          return refuse('unsupported-content', 'unsupported range location');
        const range = resolved.value;
        const selected =
          operation.location === 'Start'
            ? { start: range.start, end: range.start }
            : operation.location === 'End'
              ? { start: range.end, end: range.end }
              : range;
        return query({ kind: 'span', span: spanValue(selected, handles) });
      }
      case 'getSpanParagraphs': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        return query({
          kind: 'handles',
          handles: spanParagraphIds(resolved.value, story.value).map((id) =>
            handles.paragraph(id, story.value.story)
          ),
        });
      }

      case 'getText': {
        if (!isTextProjection(operation.projection))
          return refuse('unsupported-content', 'unknown text projection', 'projection');
        const body = handles.resolve(operation.target, 'body');
        if (body) {
          const story = storyOfHandle(operation.target, 'body', handles, packageReads);
          if (!story.ok)
            return refuse(story.code, 'that handle does not name a body', story.detail);
          return query({
            kind: 'text',
            text: story.value.text(operation.projection ?? 'allMarkup'),
          });
        }
        const paragraph = resolveParagraphHandle(operation.target, handles, packageReads);
        if (!paragraph.ok)
          return refuse(
            paragraph.code,
            'that handle does not name a body or a paragraph',
            paragraph.detail
          );
        const story = packageReads.story(paragraph.value.story);
        return query({
          kind: 'text',
          text:
            story?.paragraphText(
              paragraph.value.paragraphId,
              operation.projection ?? 'allMarkup'
            ) ?? '',
        });
      }
      case 'getSpanText': {
        if (!isTextProjection(operation.projection))
          return refuse('unsupported-content', 'unknown text projection', 'projection');
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        return query({
          kind: 'text',
          text: spanText(
            resolved.value,
            story.value,
            PARAGRAPH_MARK,
            operation.projection ?? 'allMarkup'
          ),
        });
      }

      case 'getParagraphId': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        const read = story?.paragraph(paragraph.value.paragraphId);
        // A document Word never touched may carry no `w14:paraId`; empty text says "this
        // document does not write one" rather than inventing an identity the file lacks.
        return query({ kind: 'text', text: read?.paraId ?? '' });
      }

      case 'search': {
        const scope = resolveSpanRef(operation.scope, handles, packageReads);
        if (!scope.ok) return refuse(scope.code, 'that is not a scope to search', scope.detail);
        const story = storyOfSpanRef(operation.scope, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that is not a scope to search', story.detail);
        return searchScope(story.value, scope.value, operation.text, operation.options);
      }

      case 'proposeInsertion':
      case 'proposeDeletion':
      case 'proposeReplacement':
        return planProposal(
          operation,
          tracked,
          handles,
          packageReads,
          (story, paragraphId) => {
            const storyPlan = planFor(story);
            return pinWrite(storyPlan) ?? claim(storyPlan, paragraphId);
          },
          host.trackedRangeReplacement !== false,
          paragraphBreakWrite
        );

      case 'insertText': {
        const at = resolvePoint(operation.at, handles, packageReads);
        if (!at.ok) return refuse(at.code, 'that is not a place to insert at', at.detail);
        const story = packageReads.story(at.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planInsertText(
          planFor(story),
          at.value,
          operation.text,
          'at' in operation.at && operation.at.at === 'start'
        );
      }

      case 'replaceSpan': {
        // A SPAN OVER A WHOLE STORY IS A DIFFERENT OPERATION, and it is told apart by what the
        // caller NAMED rather than by comparing endpoints: `{ body }` means "all of it" — what
        // `Body.clear()` and `Body.insertText(…, 'Replace')` mean — and only that request may take
        // blocks out of the story. Two explicit endpoints that happen to reach both ends stay a
        // text edit, because a caller who addressed text asked for a text edit.
        if ('body' in operation.span) {
          const story = storyOfHandle(operation.span.body, 'body', handles, packageReads);
          if (!story.ok)
            return refuse(story.code, 'that handle does not name a body', story.detail);
          return planReplaceStory(planFor(story.value), operation.text);
        }
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse(
            'invalid-offset',
            'that story holds no paragraph to write into',
            'empty-story'
          );
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return withEnclosedBookmarkDrops(
          planReplaceSpan(planFor(story), resolved.value, operation.text),
          story,
          resolved.value,
          host.replacementLanding?.(resolved.value.start.paragraphId, 0, 0) != null
        );
      }

      case 'replaceStoryBlocks': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        return planReplaceStoryBlocks(planFor(story.value), operation.paragraphs);
      }

      case 'insertParagraph': {
        const anchor = resolveParagraphRef(operation.anchor, handles, packageReads);
        if (!anchor.ok)
          return refuse(anchor.code, 'that is not a paragraph to insert beside', anchor.detail);
        if (operation.where !== 'before' && operation.where !== 'after')
          return refuse(
            'unknown-operation',
            'that is not a place to insert',
            String(operation.where)
          );
        const story = packageReads.story(anchor.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        const edgeTable = edgeTableOf(operation.anchor, handles, packageReads);
        if (edgeTable) {
          // The edge paragraph is in the table's cell, so the new one goes beside the table.
          // Another edit at that edge in this batch would land out of order, so it refuses.
          const plan = planFor(story);
          const { where, text } = operation;
          const refusal =
            paragraphTextRefusal(text) ??
            pinWrite(plan) ??
            claim(plan, `${edgeTable}:${where}`) ??
            claim(plan, anchor.value.paragraphId);
          if (refusal) return refusal;
          const edgeSlot = plan.slotById.get(anchor.value.paragraphId);
          if (!edgeSlot) return refuse('invalid-handle', 'that paragraph is not in the body');
          const edge = positionOf(plan, edgeSlot);
          const fresh = insertSlot(plan, where === 'before' ? edge : edge + 1);
          const op = { op: 'insertParagraphBesideTable', tableId: edgeTable, where, text } as const;
          const answer = (): AutomationValue =>
            fresh.id === null
              ? APPLIED
              : { kind: 'handle', handle: handles.paragraph(fresh.id, story.story) };
          return { ok: true, kind: 'command', ops: [op], story: story.story, answer };
        }
        const error =
          tracked && trackedParagraphInsertError(story, anchor.value.paragraphId, trackingAuthor!);
        if (error) return { ok: false, error };
        return planInsertParagraph(planFor(story), anchor.value, operation.where, operation.text);
      }

      case 'splitParagraph': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSplitParagraph(
          planFor(story),
          paragraph.value,
          operation.delimiters,
          operation.trimDelimiters === true,
          operation.trimSpacing === true
        );
      }

      case 'getFont': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        const spans = spanOffsets(resolved.value, story.value);
        return query({ kind: 'font', font: fontRead(story.value.part, spans, host.displayMode) });
      }

      case 'setFont': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to format', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetFont(planFor(story), resolved.value, operation.font);
      }

      case 'getStyle': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        const part = story.value.part;
        const styles = story.value.styles();
        const names = spanParagraphIds(resolved.value, story.value).map((paragraphId) =>
          paragraphStyleName(part, paragraphId, styles)
        );
        // Agreement, same as a formatting read: one name if every paragraph the span covers states
        // it, and no answer where they differ or where the document names none.
        const agreed =
          names.length > 0 && names.every((name) => name !== null && name === names[0])
            ? (names[0] as string)
            : null;
        return query({ kind: 'style', name: agreed });
      }

      case 'setStyle': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to style', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetStyle(planFor(story), resolved.value, operation.name);
      }

      case 'getParagraphFormat':
      case 'getParagraphBorders': {
        const paragraph = resolveParagraphRef(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that is not a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('document-unavailable', 'this host holds no document right now');
        if (operation.op === 'getParagraphBorders') {
          const borders = paragraphBordersRead(
            story.part,
            paragraph.value.paragraphId,
            story.styles()
          );
          if (!borders) return refuse('invalid-handle', 'that handle does not name a paragraph');
          return query({ kind: 'paragraphBorders', borders });
        }
        const format = paragraphFormatRead(story.part, paragraph.value.paragraphId, story.styles());
        if (!format) return refuse('invalid-handle', 'that handle does not name a paragraph');
        return query({ kind: 'paragraphFormat', format });
      }

      case 'setParagraphFormat': {
        const paragraph = resolveParagraphRef(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that is not a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetParagraphFormat(planFor(story), paragraph.value, operation.format);
      }

      case 'deleteParagraph': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planDeleteParagraph(planFor(story), paragraph.value);
      }

      case 'setPageSetup': {
        const target = handles.resolve(operation.section, 'section');
        if (!target || target.kind !== 'section')
          return refuse('invalid-handle', 'that handle does not name a section', 'section');
        return planSetPageSetup(target.index, operation.setup);
      }

      case 'getFurniture': {
        const target = handles.resolve(operation.section, 'section');
        if (!target || target.kind !== 'section')
          return refuse('invalid-handle', 'that handle does not name a section', 'section');
        if (operation.kind !== 'header' && operation.kind !== 'footer')
          return refuse('unknown-operation', 'that is not furniture', String(operation.kind));
        const story: AutomationStoryId = {
          kind: operation.kind,
          sectionIndex: target.index,
          variant: operation.variant,
        };
        // Validated as untrusted input BEFORE it is used to look a story up: `variant` arrives
        // from a caller, and a story id this lane will not act on must not become a handle.
        if (!isStoryId(story))
          return refuse(
            'unknown-operation',
            'that is not a furniture variant',
            String(operation.variant)
          );
        if (!packageReads.sections()[target.index]) return removed('that section no longer exists');
        return query({ kind: 'handle', handle: handles.body(story) });
      }

      case 'getNotes': {
        if (!handles.resolve(operation.document, 'document'))
          return refuse('invalid-handle', 'that handle does not name a document', 'document');
        if (operation.noteKind !== 'footnote' && operation.noteKind !== 'endnote')
          return refuse(
            'unknown-operation',
            'that is not a kind of note',
            String(operation.noteKind)
          );
        const kind = operation.noteKind;
        const listing = packageReads.noteIds(kind);
        if (!listing.ok)
          return refuse(
            'ambiguous-document',
            `${kind} identities are not completely and unambiguously enumerable`,
            listing.reason === 'duplicates' ? listing.duplicateIds.join(',') : listing.reason
          );
        let ids = listing.ids;
        if (operation.scope) {
          const scope = storyOfHandle(operation.scope, 'body', handles, packageReads);
          if (!scope.ok)
            return refuse(scope.code, 'that handle does not name a body', scope.detail);
          const referenced = referencedNoteIds(scope.value.root, kind);
          const available = new Set(listing.ids);
          if (referenced.some((id) => !available.has(id)))
            return refuse('ambiguous-document', 'a note reference has no matching note');
          ids = referenced;
        }
        return query({
          kind: 'handles',
          handles: ids.map((noteId) => handles.note(kind, noteId)),
        });
      }

      case 'getNoteBody':
      case 'getNoteText': {
        const target = handles.resolve(operation.note, 'note');
        if (!target || target.kind !== 'note')
          return refuse('invalid-handle', 'that handle does not name a note', 'note');
        const story: AutomationStoryId = target;
        // A note DELETED since the handle was minted has no story, and saying so is the point:
        // answering empty text or a body would hide that the document lost it.
        const reads = packageReads.story(story);
        if (!reads)
          return refuse('invalid-handle', 'that note is not in this document', storyKey(story));
        return operation.op === 'getNoteText'
          ? query({ kind: 'text', text: reads.text(operation.projection) })
          : query({ kind: 'handle', handle: handles.body(story) });
      }

      case 'getNoteKind': {
        const target = handles.resolve(operation.note, 'note');
        if (!target || target.kind !== 'note')
          return refuse('invalid-handle', 'that handle does not name a note', 'note');
        return query({ kind: 'text', text: target.noteKind });
      }

      case 'deleteNote': {
        const target = handles.resolve(operation.note, 'note');
        if (!target || target.kind !== 'note')
          return refuse('invalid-handle', 'that handle does not name a note', 'note');
        const listing = packageReads.noteIds(target.noteKind);
        if (!listing.ok)
          return refuse(
            'ambiguous-document',
            `${target.noteKind} identities are not completely and unambiguously enumerable`,
            listing.reason === 'duplicates' ? listing.duplicateIds.join(',') : listing.reason
          );
        if (!listing.ids.includes(target.noteId))
          return refuse('invalid-handle', 'that note is not in this document');
        return planDeleteNote(target.noteKind, target.noteId);
      }

      case 'getLists': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        return query({
          kind: 'handles',
          handles: listReads(story.value).map((list) =>
            handles.list(list.numId, story.value.story)
          ),
        });
      }

      case 'getListId': {
        const found = listOf(operation.list);
        if (!('list' in found)) return found;
        // Decimal by schema (`ST_DecimalNumber`), and validated as one before it is parsed: the
        // string came out of a file, and `Number('1e3')` is not the id anything wrote.
        return query({ kind: 'number', value: Number(found.list.numId) });
      }

      case 'getListById': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        if (!Number.isInteger(operation.id) || operation.id <= 0)
          return refuse('unsupported-content', 'a list is numbered from one', String(operation.id));
        const wanted = String(operation.id);
        const found = listReads(story.value).find((list) => list.numId === wanted);
        if (!found)
          return refuse('invalid-handle', 'no list in that story carries that number', wanted);
        return query({ kind: 'handle', handle: handles.list(found.numId, story.value.story) });
      }

      case 'getListParagraphs': {
        const found = listOf(operation.list);
        if (!('list' in found)) return found;
        const level = operation.level;
        if (
          level !== undefined &&
          (!Number.isInteger(level) || level < 0 || level > MAX_LIST_LEVEL)
        ) {
          return refuse(
            'invalid-offset',
            `a list level is 0 to ${String(MAX_LIST_LEVEL)}`,
            String(level)
          );
        }
        const reads = found.plan.reads;
        const ids =
          level === undefined
            ? found.list.paragraphIds
            : found.list.paragraphIds.filter((id) => membershipIn(reads, id)?.level === level);
        return query({
          kind: 'handles',
          handles: ids.map((id) => handles.paragraph(id, reads.story)),
        });
      }

      case 'getParagraphList': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const reads = packageReads.story(paragraph.value.story);
        if (!reads) return refuse('invalid-handle', 'that story is not in this document');
        const membership = membershipIn(reads, paragraph.value.paragraphId);
        if (!membership)
          return refuse(
            'unsupported-content',
            'that paragraph is not in a list',
            paragraph.value.paragraphId
          );
        return query({
          kind: 'handle',
          handle: handles.list(membership.numId, reads.story),
        });
      }

      case 'getListLevel': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const reads = packageReads.story(paragraph.value.story);
        if (!reads) return refuse('invalid-handle', 'that story is not in this document');
        const membership = membershipIn(reads, paragraph.value.paragraphId);
        if (!membership)
          return refuse(
            'unsupported-content',
            'that paragraph is not in a list',
            paragraph.value.paragraphId
          );
        return query({ kind: 'number', value: membership.level });
      }

      case 'setListLevel': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const reads = packageReads.story(paragraph.value.story);
        if (!reads) return refuse('invalid-handle', 'that story is not in this document');
        const plan = planFor(reads);
        const { paragraphId } = paragraph.value;
        // The paragraph's PROPERTIES container, the one a paragraph-format write claims.
        return planSetListLevel(packageReads, reads, paragraphId, operation.level, () => {
          return pinWrite(plan) ?? claimFormatting(plan, paragraphId, 'paragraph');
        });
      }

      case 'insertListParagraph': {
        const found = listOf(operation.list);
        if (!('list' in found)) return found;
        return planInsertListParagraph(found.plan, found.list, operation.where, operation.text);
      }

      case 'getHyperlink': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        const pkg = packageReads.package;
        if (!pkg || !resolved.value) return query({ kind: 'text', text: '' });
        const link = linkCovering(story.value, resolved.value);
        if (!link) return query({ kind: 'text', text: '' });
        const node = findNode(story.value.part, link.id);
        const target = node ? linkTarget(pkg, story.value.part.name, node) : null;
        return query({ kind: 'text', text: target ?? '' });
      }

      case 'setHyperlink': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no text to link', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetHyperlink(planFor(story), resolved.value, operation.target);
      }

      case 'getBookmarkRange': {
        const found = resolveBookmarkRange(operation.bookmark);
        if (!('reads' in found)) return found;
        return query({ kind: 'span', span: spanOf(found.range) });
      }

      case 'getComments': {
        const scope = resolveSpanRef(operation.scope, handles, packageReads);
        if (!scope.ok) return refuse(scope.code, 'that scope is not a place', scope.detail);
        const story = storyOfSpanRef(operation.scope, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that scope names no story', story.detail);
        const reads = story.value;
        const comments = commentsOf(reads);
        if (!comments) return refuse('document-unavailable', 'this host holds no document');
        // A SCOPE NARROWS: a whole-story ask answers every top-level comment, a span answers the
        // ones whose words it overlaps, so `Range#getComments` is not the body's list again.
        const covering = scope.value;
        const roots = comments.roots.filter((item) => {
          if (!covering) return true;
          const range = item.range;
          if (!range) return false;
          const from = reads.indexOf(range.start.paragraphId);
          const to = reads.indexOf(range.end.paragraphId);
          const low = reads.indexOf(covering.start.paragraphId);
          const high = reads.indexOf(covering.end.paragraphId);
          if (to < low || from > high) return false;
          if (to === low && from === low && high === low) {
            return (
              range.end.offset > covering.start.offset && range.start.offset < covering.end.offset
            );
          }
          return true;
        });
        return query({
          kind: 'handles',
          handles: roots.map((item) => handles.comment(item.id, reads.story)),
        });
      }

      case 'getCommentReplies': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({
          kind: 'handles',
          handles: found.item.replyIds.map((id) => handles.comment(id, found.reads.story)),
        });
      }

      case 'getCommentId': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.id });
      }

      case 'getCommentAuthor': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.comment.author });
      }

      case 'getCommentDate': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.comment.date ?? '' });
      }

      case 'getCommentText':
        return commentTextEdits.read(
          commentAt(operation.comment),
          (reads, id) => commentsOf(reads)?.textOf(id) ?? ''
        );

      case 'getCommentRange': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        const range = found.item.range;
        // ORPHANED IS NOT A PLACE. A file can reference a comment with no usable range, and
        // answering the story's start would put a caller's edit somewhere nobody commented on.
        if (!range || found.item.orphaned)
          return refuse('invalid-handle', 'that comment has no range in this document');
        const span = spanOfReviewRange(found.reads, range);
        // The comment object still exists, so this refusal is not a stale target.
        if (!span)
          return refuse('invalid-handle', 'that comment’s range is no longer in the story');
        return query({ kind: 'span', span });
      }

      case 'getCommentResolved': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'flag', value: found.item.resolved });
      }

      case 'insertComment':
        return planInsertComment(operation, handles, packageReads, pinCommentStory);

      case 'setCommentText': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return commentTextEdits.edit(operation, found.item, found.reads, () =>
          pinWrite(planFor(found.reads))
        );
      }

      case 'setCommentResolved': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        if (typeof operation.resolved !== 'boolean')
          return refuse(
            'unsupported-content',
            'resolved is a yes or a no',
            String(operation.resolved)
          );
        const conflict = pinWrite(planFor(found.reads));
        if (conflict) return conflict;
        return {
          ok: true,
          kind: 'commentWrite',
          write: { kind: 'resolve', commentId: found.item.id, resolved: operation.resolved },
          story: found.reads.story,
          answer: () => APPLIED,
        };
      }

      case 'replyToComment': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        const fields = validatePlannedCommentFields({
          author: operation.author,
          text: operation.text,
          date: operation.date,
          kind: 'reply',
        });
        if (fields) return fields;
        const range = found.item.range;
        if (!range || found.item.orphaned)
          return refuse('invalid-handle', 'that comment has no range to reply over');
        const conflict = pinWrite(planFor(found.reads));
        if (conflict) return conflict;
        const story = found.reads.story;
        const date = stagedCommentDate(operation.date);
        return {
          ok: true,
          kind: 'commentWrite',
          write: {
            kind: 'reply',
            parentCommentId: found.item.id,
            anchor: {
              paragraphId: range.start.paragraphId,
              start: range.start.offset,
              end: range.end.offset,
              ...(range.end.paragraphId === range.start.paragraphId
                ? {}
                : { endParagraphId: range.end.paragraphId }),
            },
            text: operation.text,
            author: operation.author,
            date,
          },
          story: found.reads.story,
          answer: (_post, commentId) =>
            commentId === undefined
              ? APPLIED
              : { kind: 'handle', handle: handles.comment(commentId, story) },
        };
      }

      case 'deleteComment': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return planDeleteComment(found.item, found.reads, (reads) => pinWrite(planFor(reads)));
      }

      case 'getRevisions':
        return planRevisionListing(operation, handles, packageReads);

      case 'getReviewItemRange':
        return planReviewItemRange(operation.key, handles, packageReads);

      case 'getRevisionType': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.type });
      }

      case 'getRevisionAuthor': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.author });
      }

      case 'getRevisionDate': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.date });
      }

      case 'getRevisionRange': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        const { ranges } = found.item.item;
        const first = ranges[0];
        if (!first) return refuse('invalid-handle', 'that change covers no characters');
        // A change over several paragraphs spans from its first range to its last; a row or
        // cell change keeps its first range.
        const structural = found.item.item.revisionKind === 'structural';
        const last = structural ? first : { ...first, end: ranges[ranges.length - 1]!.end };
        const span = spanOfReviewRange(found.reads, last) ?? spanOfReviewRange(found.reads, first);
        if (!span) return refuse('invalid-handle', 'that change’s range is no longer in the story');
        return query({ kind: 'span', span });
      }

      case 'acceptRevision':
      case 'rejectRevision': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        const action = operation.op === 'acceptRevision' ? 'accept' : 'reject';
        return planKeyedDecision(found.reads, [found.item.item], action, decisions, pinDecision);
      }

      case 'resolveRevisionBatch':
      case 'setRevisionAuthorBatch':
      case 'acceptAllRevisions':
      case 'rejectAllRevisions':
        return planRevisionDecision(operation, handles, packageReads, pinDecision, decisions);

      case 'selectSpan': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to select', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSelect(planFor(story), resolved.value, operation.mode);
      }

      case 'selectBookmark': {
        const found = resolveBookmarkRange(operation.bookmark);
        if (!('reads' in found)) return found;
        return planSelect(planFor(found.reads), found.range, operation.mode);
      }

      case 'getContentControls': {
        const scope = controlScope(operation.scope);
        if (!('reads' in scope)) return scope;
        return query({
          kind: 'handles',
          handles: contentControlReads(scope.reads, scope.node).map((control) =>
            handles.contentControl(control.nodeId, scope.reads.story)
          ),
        });
      }

      case 'getContentControlById': {
        const scope = controlScope(operation.scope);
        if (!('reads' in scope)) return scope;
        if (!Number.isInteger(operation.id)) {
          return refuse(
            'unsupported-content',
            'a control id is a whole number',
            String(operation.id)
          );
        }
        // Document order over the WHOLE scope subtree, nested controls included: an id lookup is
        // a search of what the file wrote, and Word's own numbering is not scoped to a nesting
        // level. The first match wins because `w:id` is not unique.
        const found = allControlsUnder(scope.node).find(
          (control) => contentControlPropertiesOf(control).id === operation.id
        );
        if (!found) {
          // `invalid-handle`, the same code a bookmark the document stopped declaring answers: the
          // caller named an object this document does not have. A second code for "looked up by a
          // file attribute rather than by a handle" would be a distinction without a caller.
          return refuse(
            'invalid-handle',
            'no control in that scope carries that id',
            String(operation.id)
          );
        }
        return query({
          kind: 'handle',
          handle: handles.contentControl(found.id, scope.reads.story),
        });
      }

      case 'getContentControlsByTag':
      case 'getContentControlsByTitle': {
        const scope = controlScope(operation.scope);
        if (!('reads' in scope)) return scope;
        const wanted = operation.op === 'getContentControlsByTag' ? operation.tag : operation.title;
        if (typeof wanted !== 'string' || wanted.length === 0) {
          return refuse('unsupported-content', 'a tag or title to match is required', operation.op);
        }
        const matches = allControlsUnder(scope.node).filter((control) => {
          const properties = contentControlPropertiesOf(control);
          return operation.op === 'getContentControlsByTag'
            ? properties.tag === wanted
            : properties.alias === wanted;
        });
        return query({
          kind: 'handles',
          handles: matches.map((control) => handles.contentControl(control.id, scope.reads.story)),
        });
      }

      case 'getContentControlTag':
      case 'getContentControlTitle':
      case 'getContentControlFileId':
      case 'getContentControlSubtype':
      case 'getContentControlLock': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const properties = found.control.properties;
        if (operation.op === 'getContentControlLock') {
          return query({ kind: 'text', text: found.control.lock });
        }
        if (operation.op === 'getContentControlSubtype') {
          return query({ kind: 'text', text: properties.type });
        }
        if (operation.op === 'getContentControlFileId') {
          // A STRING, and empty for a control the file never numbered — the identity a caller
          // holds is the handle, so an absent `w:id` is a missing label rather than an error.
          return query({
            kind: 'text',
            text: properties.id === undefined ? '' : String(properties.id),
          });
        }
        const text = operation.op === 'getContentControlTag' ? properties.tag : properties.alias;
        return query({ kind: 'text', text: text ?? '' });
      }

      case 'getContentControlIsBound':
      case 'getContentControlPlaceholderShown':
      case 'getContentControlTemporary': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const value =
          operation.op === 'getContentControlIsBound'
            ? found.control.properties.dataBinding !== undefined
            : operation.op === 'getContentControlPlaceholderShown'
              ? found.control.properties.showingPlaceholder
              : found.control.properties.temporary;
        return query({ kind: 'flag', value });
      }

      case 'getContentControlText': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        return query({
          kind: 'text',
          text: contentControlText(found.reads, found.node, operation.projection),
        });
      }

      case 'getContentControlParagraphs': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        return query({
          kind: 'handles',
          handles: found.control.paragraphIds.map((id) => handles.paragraph(id, found.reads.story)),
        });
      }

      case 'getContentControlRange': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const location = operation.location ?? 'whole';
        if (!CONTENT_CONTROL_RANGE_LOCATIONS.has(location)) {
          return refuse('unsupported-content', 'that is not a place in a control', location);
        }
        const span = contentControlSpan(found.reads, found.node);
        if (!span) {
          return refuse('unsupported-content', 'that control holds nothing addressable', 'empty');
        }
        // `before`/`start` and `after`/`end` land on the same point on purpose: the control's
        // boundary marks take no offset, so there is no position outside the content to answer.
        const edge = location === 'start' || location === 'before' ? span.start : span.end;
        const collapsed = location !== 'whole' && location !== 'content';
        const point = (at: { readonly paragraphId: string; readonly offset: number }) => ({
          story: found.reads.story,
          paragraphId: at.paragraphId,
          index: found.reads.indexOf(at.paragraphId),
          offset: at.offset,
        });
        return query({
          kind: 'span',
          span: spanValue(
            collapsed
              ? { start: point(edge), end: point(edge) }
              : { start: point(span.start), end: point(span.end) },
            handles
          ),
        });
      }

      case 'setContentControlValue': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const value = contentControlValueOf(operation.value);
        if (!value.ok) return refuse(value.code, value.message, value.detail);
        const plan = planFor(found.reads);
        const pin = pinWrite(plan);
        if (pin) return pin;
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops: [controlValueOp(found.control.nodeId, value.value, trackingAuthor)],
          answer: () => APPLIED,
        };
      }

      case 'setContentControlProperties': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        if (
          tracked &&
          (!ownsInsertedControl(found.reads.part, found.control.nodeId, trackingAuthor!) ||
            operation.lock !== undefined ||
            operation.cannotEdit !== undefined ||
            operation.cannotDelete !== undefined)
        )
          return refuse(
            'unsupported-capability',
            'tracked control metadata requires an own pending insertion; locks require direct edits'
          );
        if (
          operation.tag === undefined &&
          operation.title === undefined &&
          operation.lock === undefined &&
          operation.cannotEdit === undefined &&
          operation.cannotDelete === undefined
        ) {
          return refuse('unsupported-content', 'nothing to write', 'no-properties');
        }
        if (operation.lock !== undefined && !CONTENT_CONTROL_LOCKS.has(operation.lock)) {
          return refuse(
            'unsupported-content',
            'that is not a lock this schema declares',
            operation.lock
          );
        }
        for (const value of [operation.cannotEdit, operation.cannotDelete]) {
          if (value !== undefined && typeof value !== 'boolean')
            return refuse('unsupported-content', 'lock flags must be boolean');
        }
        const plan = planFor(found.reads);
        let lock = operation.lock;
        if (operation.cannotEdit !== undefined || operation.cannotDelete !== undefined) {
          const own =
            lock ??
            controlLocks.get(plan)?.get(found.control.nodeId) ??
            found.control.properties.lock;
          const edit =
            operation.cannotEdit ?? (own === 'contentLocked' || own === 'sdtContentLocked');
          const removal =
            operation.cannotDelete ?? (own === 'sdtLocked' || own === 'sdtContentLocked');
          lock = edit
            ? removal
              ? 'sdtContentLocked'
              : 'contentLocked'
            : removal
              ? 'sdtLocked'
              : 'unlocked';
        }
        const pin = pinWrite(plan);
        if (pin) return pin;
        if (lock !== undefined) {
          const staged = controlLocks.get(plan) ?? new Map<string, ContentControlLock>();
          staged.set(found.control.nodeId, lock);
          controlLocks.set(plan, staged);
        }
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops: [
            {
              op: 'setContentControlProperties',
              controlId: found.control.nodeId,
              ...(operation.tag === undefined ? {} : { tag: operation.tag }),
              // `title` in the object model is `w:alias` in the file. One name each side, and the
              // translation happens here rather than leaking Word's UI wording into the tree.
              ...(operation.title === undefined ? {} : { alias: operation.title }),
              ...(lock === undefined ? {} : { lock }),
            },
          ],
          answer: () => APPLIED,
        };
      }

      case 'insertContentControlText': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const error = contentControlTextInsertionError(
          found.control.properties,
          operation.text,
          operation.at
        );
        if (error) return { ok: false, error };
        const plan = planFor(found.reads);
        const pin = pinWrite(plan);
        if (pin) return pin;
        const span = contentControlSpan(found.reads, found.node);
        if (!span) {
          return refuse('unsupported-content', 'that control holds nothing addressable', 'empty');
        }
        // WHERE THE WRITTEN TEXT WILL BE, answered by the command itself rather than by a read
        // beside it: reads are planned against the document as it is now, so a read enqueued after
        // this write would answer the span the control had BEFORE it. `replace` puts the whole
        // value in the content's first paragraph, which keeps its identity across the write.
        // A tracked replacement keeps the struck words first, so its text starts after them.
        const at =
          operation.at === 'end'
            ? span.end
            : operation.at === 'replace' && tracked
              ? trackedValueStart(found.reads.part, span, trackingAuthor!)
              : span.start;
        const written = (): AutomationValue => ({
          kind: 'span',
          span: spanOf({
            start: {
              story: found.reads.story,
              paragraphId: at.paragraphId,
              index: found.reads.indexOf(at.paragraphId),
              offset: at.offset,
            },
            end: {
              story: found.reads.story,
              paragraphId: at.paragraphId,
              index: found.reads.indexOf(at.paragraphId),
              offset: at.offset + operation.text.length,
            },
          }),
        });
        // `replace` is the control's own value path, so the prompt and `w:temporary` are dealt
        // with there rather than twice. The edges are ordinary insertions at the ends of the
        // content: the lock the control carries refuses them as it refuses a keystroke.
        if (operation.at === 'replace') {
          return {
            ok: true,
            kind: 'command',
            story: found.reads.story,
            ops: [
              controlValueOp(
                found.control.nodeId,
                { kind: 'text', text: operation.text },
                trackingAuthor
              ),
            ],
            answer: written,
          };
        }
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops:
            operation.text.length === 0
              ? []
              : [
                  {
                    op: 'insertText',
                    paragraphId: at.paragraphId,
                    offset: at.offset,
                    text: operation.text,
                    // THE TEXT GOES IN THE CONTROL, which the offset alone cannot say: a boundary
                    // offset belongs to the run that starts there, so an inline control's
                    // trailing edge is the text AFTER the control and the command would have
                    // written beside the field it was handed.
                    inside: found.node.id,
                    ...controlValueRevision(trackingAuthor),
                  },
                ],
          answer: written,
        };
      }

      case 'deleteContentControl': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        if (typeof operation.keepContent !== 'boolean') {
          return refuse('unsupported-content', 'keepContent is required', 'keepContent');
        }
        const plan = planFor(found.reads);
        const pin = pinWrite(plan);
        if (pin) return pin;
        if (!operation.keepContent) {
          // Touched, not claimed: removing a nested control too shares these paragraphs.
          for (const paragraphId of found.control.paragraphIds) {
            const conflict = touch(plan, paragraphId);
            if (conflict) return conflict;
          }
        }
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops: [
            {
              op: 'removeContentControl',
              controlId: found.control.nodeId,
              keepContent: operation.keepContent,
            },
          ],
          answer: () => APPLIED,
        };
      }

      case 'insertContentControl':
        return planContentControlInsertion(
          operation,
          handles,
          packageReads,
          trackingAuthor,
          host.trackedRangeReplacement,
          (story, paragraphId) => {
            const plan = planFor(story);
            return pinWrite(plan) ?? claim(plan, paragraphId);
          }
        );

      case 'insertCustomNode': {
        // Everything that can be judged from the request alone, before a handle is resolved.
        const shape = customNodeRequestRefusal(operation);
        if (shape) return refuse('unsupported-content', shape.message, shape.detail);
        const payload = customNodePayloadOf(operation.payload);
        if (!payload.ok) {
          return refuse('unsupported-content', 'that payload cannot be written', payload.field);
        }

        const placed = customNodePlacement(operation, handles, packageReads);
        if ('code' in placed) return refuse(placed.code, placed.message, placed.detail);
        const { start, end } = placed.range;
        const story = storyReadsOf(placed.range);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        const conflict = pinWrite(planFor(story));
        if (conflict) return conflict;
        return {
          ok: true,
          kind: 'customNodeWrite',
          story: story.story,
          write: customNodeWriteOf(operation, start, end, payload.value),
          answer: () => APPLIED,
        };
      }

      default: {
        const unknown = operation as { readonly op?: unknown };
        return refuse(
          'unknown-operation',
          'this host does not implement that operation',
          String(unknown.op)
        );
      }
    }
  };

  return {
    plan(operation, trackingAuthor) {
      if (dynamicSolitary && isAutomationCommand(operation))
        return refuse('conflicting-operations', 'header/footer creation must commit alone');
      const conflict = commandPolicy.conflict(operation);
      if (conflict) return refuse('conflicting-operations', conflict.message, conflict.detail);
      const planned = emptyFrameWriteRefusal(
        operation,
        () => plan(operation, trackingAuthor),
        handles,
        packageReads
      );
      if (planned.ok && planned.kind === 'command' && planned.solitary) {
        if (commandPolicy.hasCommands)
          return refuse('conflicting-operations', 'header/footer creation must commit alone');
        dynamicSolitary = true;
      }
      // A command that plans to an answer writes nothing, so it does not count as a write.
      if (planned.ok && planned.kind !== 'query') commandPolicy.note(operation);
      return planned;
    },
    get hasCommands() {
      return commandPolicy.hasCommands;
    },
    get writeScope() {
      return writeStory?.reads.scope ?? null;
    },
    settle(post) {
      // ONE story settles: a batch's commands are pinned to one story, so only that story can
      // have created paragraphs. A read-only batch has nothing to bind at all.
      const pinned = writeStory;
      if (pinned) {
        const fullAfter = post.story(pinned.reads.story);
        const scopedRoot = fullAfter && findNode(fullAfter.part, pinned.reads.root.id);
        const after =
          fullAfter && scopedRoot && scopedRoot.id !== fullAfter.root.id
            ? scopedStoryReads(fullAfter, scopedRoot)
            : fullAfter;
        if (!after) {
          return {
            ok: false,
            detail: `the story this batch wrote is gone: ${storyKey(pinned.reads.story)}`,
          };
        }
        const before = new Set(pinned.reads.paragraphIds);
        const fresh = after.paragraphIds.filter((id) => !before.has(id));
        if (
          !pinned.wholesale &&
          fresh.length !== pinned.created.length + pinned.externalCreatedCount
        ) {
          return {
            ok: false,
            detail: `planned ${String(pinned.created.length + pinned.externalCreatedCount)} new paragraphs, the transaction made ${String(fresh.length)}`,
          };
        }
        // Reading order on both sides: `created` is ordered by the symbolic story position each
        // slot was inserted at, and `fresh` by where the paragraphs actually landed.
        const inOrder = pinned.order.filter((slot) => slot.id === null);
        inOrder.forEach((slot, index) => {
          slot.id = fresh[index] ?? null;
        });
        for (const retarget of pinned.retargets) {
          if (retarget.slot.id) handles.retarget(retarget.from, retarget.slot.id);
        }
      }
      // LAST GATE BEFORE A CARET MOVES. Planning already refuses a batch that selects a paragraph
      // it also changes, so a selection reaching here should describe the committed document
      // exactly. "Should" is the reason for the check: if it does not — a planner bug, an op with
      // an effect this file did not model — the right outcome is that no caret moves, not that one
      // moves to a position that has stopped meaning what it meant.
      for (const [index, selection] of selections.entries()) {
        const story = post.story(selection.range.start.story);
        if (!story || !placeable(selection.range, story)) continue;
        // A selection the host could not place is refused, never reported as done. `selection`
        // names which one, so the host can say whether the batch's writes committed first.
        if (host.select?.(selection.range, selection.mode) === false)
          return { ok: false, detail: 'the host could not place the selection', selection: index };
      }
      return { ok: true };
    },
  };
}
