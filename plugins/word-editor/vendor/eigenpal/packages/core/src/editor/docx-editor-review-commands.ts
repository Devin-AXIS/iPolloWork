import {
  filterReviewItemsByAuthor,
  type RevisionAuthorVisibility,
} from './revision-author-visibility.ts';
import { paragraphsWithOrdinaryMoves } from '../store/store/revision-move-ranges.ts';
import { emptiedTableCells } from '../store/store/revision-table-emptied-cells.ts';
import type {
  EditorModuleRegistry,
  ReviewDisplayMode,
  ReviewModelInput,
  ReviewModuleContribution,
} from '../contracts/modules.ts';

import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';
import { planRevisionBatch, type RevisionBatchResult } from '../store/store/revision-batch.ts';
import {
  invalidRevisionAuthorInput,
  planRevisionAuthorChange,
  type RevisionAuthorResult,
} from '../store/store/revision-author-change.ts';
import { commandProtectionRefusal } from './command-protection.ts';
import { revisionSiteNodeIdsOf, reviewItemKey } from '../store/store/review-items.ts';
import type {
  CanResult,
  EditorCommand,
  ExecResult,
  ReviewItem,
  ReviewItemPlacement,
  ReviewItemQuery,
  ReviewRevisionItem,
  ReviewRevisionPlacement,
} from '../contracts/editor.ts';
import type {
  ReviewChangesResolvedEvent,
  ReviewItemRevealEvent,
} from '../contracts/editor-events.ts';
import type { StoryScope, TreeDocOp } from '../store/index.ts';
import {
  deepParagraphOrderOfPart,
  collectRevisionSites,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '../store/index.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { EditorDiagnostics } from './editor-diagnostics.ts';
import { PRO_REVIEW_REASON, READ_ONLY_REVISION_REASON } from './opening-editing-mode.ts';
import { reviewWriteRefusal } from './review-write-refusal.ts';
import { documentReviewDecisionOf } from './review-document-decisions.ts';
import { BOUND_CHANGES_REFUSAL, LOCKED_CHANGES_REFUSAL } from './review-guard-refusals.ts';
import { guardKeepsRevisions, holdsGuardedControls } from '../store/store/revision-content-lock.ts';
import { withReviewItemFilter } from '../binding/review-item-filter.ts';
import {
  inertPropertyChangeInputsOf,
  inertPropertyChanges,
  withoutInertPropertyChanges,
} from '../layout/review-inert-property-changes.ts';
import { revisionItemsOf } from '../store/store/review-reads.ts';
import {
  findReviewPlacement,
  isReplacementPairKey,
  replacementPairHalves,
  resolutionKeysOf,
} from './review-replacement-pairs.ts';

/** Why `setActiveReviewItem` refused an item that `activatable` reports false for. */
export function reviewActivationRefusal(item: ReviewItem): string {
  // A custom node without `reviewCard` has no card, so the surface never makes it active.
  if (item.kind === 'custom') {
    return `custom node '${item.name}' has no reviewCard, so it has no card to activate`;
  }
  const kind = item.kind === 'revision' ? item.revisionKind : item.kind;
  return `review items of kind '${kind}' are excluded from activation`;
}

interface ReviewCommandDependencies {
  surface(): PaginatedSurface | null;
  enabled(): boolean;
  destroyed(): boolean;
  viewing(): boolean;
  placements(query?: ReviewItemQuery): readonly ReviewItemPlacement[];
  /** The reviewer filter: which authors it shows, and whether a predicate narrows the rest. */
  authorVisibility: RevisionAuthorVisibility;
  scope(item: ReviewItem): StoryScope;
  /** Activates without announcing: only the caller knows whether the activation reveals. */
  activate(key: string | null, allowExcludedFormat?: boolean): ExecResult;
  reveal(event: ReviewItemRevealEvent): void;
  /** Announce a committed accept-all or reject-all decision. */
  resolved?(event: ReviewChangesResolvedEvent): void;
  setDisplayMode(mode: ReviewDisplayMode): void;
  /** Reports a single accept or reject, which does not go through `exec`. */
  report?: {
    readonly diagnostics: Pick<EditorDiagnostics, 'reviewItem'>;
    readonly tracked: () => boolean;
  };
}

/**
 * The surface's review model, when a module registered one.
 *
 * The module's derivation reaches the session through the surface: the session owns the
 * per-revision memo, the module owns the algorithm. Registered custom-node definitions ride
 * along OPAQUELY so the derivation can contribute `custom` cards; core never looks inside.
 */
export function reviewModelOption(
  modules: EditorModuleRegistry,
  reportDiagnostic: (diagnostic: unknown) => void
): { readonly reviewModel: ReviewModuleContribution } | Record<never, never> {
  const review = modules.review;
  if (!review) return {};
  return {
    // Property changes that resolve to no change are left out of every queue reader.
    reviewModel: withReviewItemFilter(
      {
        ...review,
        collectReviewItems: (input: ReviewModelInput) =>
          review.collectReviewItems(
            modules.customNodes.length > 0
              ? {
                  ...input,
                  customNodes: modules.customNodes,
                  ...(modules.customNodeDiagnostics.length > 0
                    ? { reportCustomNodeDiagnostic: reportDiagnostic }
                    : {}),
                }
              : input
          ),
      },
      withoutInertPropertyChanges
    ),
  };
}

/** Every view the command accepts, Simple Markup included. */
const REVIEW_DISPLAY_MODES: readonly ReviewDisplayMode[] = [
  'all-markup',
  'simple-markup',
  'proposed',
  'original',
];

/** Review commands share navigation, mutation gates, and atomic story resolution. */
export function createReviewCommands(deps: ReviewCommandDependencies) {
  // A replacement is one change, so it is one stop in every review layout: a deletion and the
  // touching insertion from the same author that took its place. Navigation reads the same
  // filtered queue as the cards, so a filter that hides one half leaves the other a lone stop.
  const navigable = () =>
    deps
      .placements({ pairReplacements: true })
      .filter(
        (item): item is ReviewRevisionPlacement =>
          item.kind === 'revision' && (item.activatable || item.revisionKind === 'format')
      );
  const all = () =>
    deps
      .surface()
      ?.session.reviewItems()
      .filter((item): item is ReviewRevisionItem => item.kind === 'revision') ?? [];
  /** Property changes the queue leaves out because they change nothing, in every story. */
  const unlistedRecordsNow = (): readonly ReviewRevisionItem[] => {
    const session = deps.surface()?.session;
    if (!session) return [];
    const inputs = inertPropertyChangeInputsOf(session.currentPackage());
    return session
      .storyParts()
      .flatMap((part) => inertPropertyChanges(revisionItemsOf(part), inputs));
  };
  /**
   * The unlisted records a decision with no keys clears beside the listed changes. With
   * `scope: 'visible'`, only those by an author the filter shows, and none while a tracked
   * change predicate narrows the decision: it decides over listed changes only. A document-wide
   * decision with no keys resolves every site already. Read only when the decision runs.
   */
  const keylessUnlisted = (
    command: { scope?: 'visible' | 'document'; keys?: readonly string[] },
    unlisted: () => readonly ReviewRevisionItem[]
  ): readonly ReviewRevisionItem[] =>
    command.keys !== undefined || command.scope === 'document' || deps.authorVisibility.hasPredicate
      ? []
      : unlisted().filter((item) => deps.authorVisibility.isVisible(item.author));
  /** The parts a bulk review command reaches, with the keys it selects in each. */
  const selection = (
    command: { scope?: 'visible' | 'document'; keys?: readonly string[] },
    withUnlisted = false
  ) => {
    const items = all();
    // A paired replacement's key selects both of its halves. The paired queue is read once,
    // however many pair keys the command names.
    let pairs: ReadonlyMap<string, ReviewItemPlacement> | undefined;
    const pairOf = (key: string) => {
      pairs ??= new Map(
        deps
          .placements({ placement: false, pairReplacements: true })
          .filter((entry) => isReplacementPairKey(entry.key))
          .map((entry) => [entry.key, entry])
      );
      return pairs.get(key);
    };
    const selected = new Set(
      command.keys?.flatMap((key) => {
        if (!isReplacementPairKey(key)) return [key];
        const pair = pairOf(key);
        return pair ? resolutionKeysOf(pair.item) : [key];
      }) ??
        (command.scope === 'document'
          ? items
          : filterReviewItemsByAuthor(
              deps.surface()?.session.reviewItems() ?? [],
              deps.authorVisibility
            )
        )
          .filter((item) => item.kind === 'revision')
          .map(reviewItemKey)
    );
    const scopes = new Map<string, { scope: StoryScope; part: OoxmlPart; keys: string[] }>();
    // A visible decision whose filter hides nothing decides the whole document, so history
    // without a card, such as a table's property record, resolves with it.
    const unfilteredDocument =
      command.keys === undefined &&
      (command.scope === 'document' || !deps.authorVisibility.hasFilter);
    if (unfilteredDocument) {
      const session = deps.surface()!.session;
      // A visible decision reaches the stories that hold a listed change, and `place` below adds
      // the story of each unlisted record it sweeps; a document-wide one reaches every story.
      const listed =
        command.scope === 'document'
          ? null
          : new Set(
              items.flatMap((item) => {
                const ids = item.kind === 'revision' ? revisionSiteNodeIdsOf(item) : [];
                const part = ids.length ? partOfNodeId(session, ids[0]) : null;
                return part ? [part.name] : [];
              })
            );
      for (const part of session.storyParts())
        if (!listed || listed.has(part.name))
          scopes.set(part.name, {
            scope: storyScopeOfNodeId(session, part.root.id, { kind: 'body' }),
            part,
            keys: [],
          });
    }
    let unlistedMemo: readonly ReviewRevisionItem[] | null = null;
    const unlisted = () => (unlistedMemo ??= unlistedRecordsNow());
    const swept = withUnlisted ? keylessUnlisted(command, unlisted) : [];
    for (const item of swept) selected.add(reviewItemKey(item));
    const place = (item: ReviewRevisionItem) => {
      const scope = deps.scope(item);
      const part = partOfNodeId(deps.surface()!.session, revisionSiteNodeIdsOf(item)[0]);
      if (!part) return;
      let group = scopes.get(part.name);
      if (!group) {
        group = { scope, part, keys: [] };
        scopes.set(part.name, group);
      }
      const key = reviewItemKey(item);
      if (selected.delete(key)) group.keys.push(key);
    };
    for (const item of items) place(item);
    for (const item of swept) place(item);
    // A key a caller saved can name a record that has since lost its card; it still resolves.
    const named = new Set(command.keys ?? []);
    if (named.size > 0 && selected.size > 0) {
      for (const item of unlisted()) if (selected.has(reviewItemKey(item))) place(item);
    }
    // Records the caller did not name resolve silently: results report only listed changes.
    const silent = withUnlisted
      ? new Set(
          unlisted().flatMap((item) =>
            named.has(reviewItemKey(item)) ? [] : [reviewItemKey(item)]
          )
        )
      : new Set<string>();
    return { scopes: [...scopes.values()], missing: [...selected], unfilteredDocument, silent };
  };
  /** Whether a part holds no editable story, such as the styles part or comment text. */
  const outsideStories = (part: OoxmlPart): boolean =>
    !deps
      .surface()!
      .session.storyParts()
      .some((story) => story.name === part.name);
  /** Story ops commit as groups; parts outside the stories commit as part ops. */
  const routed = (
    plans: readonly { scope: StoryScope; part: OoxmlPart; ops: readonly TreeDocOp[] }[]
  ) => {
    const groups: { scope: StoryScope; ops: readonly TreeDocOp[] }[] = [];
    const partOps: { partName: string; ops: readonly TreeDocOp[] }[] = [];
    for (const { scope, part, ops } of plans) {
      if (!ops.length) continue;
      if (outsideStories(part)) partOps.push({ partName: part.name, ops });
      else groups.push({ scope, ops });
    }
    return { groups, partOps };
  };
  const bulkPlan = (
    command: Extract<EditorCommand, { type: 'resolveAllReviewChanges' }>,
    withUnlisted = false
  ) => {
    const { scopes, missing, unfilteredDocument, silent } = selection(command, withUnlisted);
    const resolved: RevisionBatchResult['resolved'][number][] = [];
    const skipped: RevisionBatchResult['skipped'][number][] = missing
      .filter((key) => !silent.has(key))
      .map((key) => ({ key, reason: 'unknown-revision' }));
    const plans: { scope: StoryScope; part: OoxmlPart; ops: readonly TreeDocOp[] }[] = [];
    let remaining = 0;
    for (const { scope, part, keys } of scopes) {
      // The editor reports its own queue as what remains; see `countRemaining`.
      const plan = planRevisionBatch(
        part,
        command.action,
        unfilteredDocument ? undefined : keys,
        undefined,
        // Keys a caller names are decided as card decisions on them would be, as the API's
        // named revisions are; only an author filter keeps the stricter rule.
        { countRemaining: false, explicit: command.keys !== undefined }
      );
      for (const entry of plan.result.resolved) if (!silent.has(entry.key)) resolved.push(entry);
      for (const entry of plan.result.skipped) if (!silent.has(entry.key)) skipped.push(entry);
      remaining += plan.result.remaining;
      plans.push({ scope, part, ops: plan.ops });
    }
    return { ...routed(plans), result: { resolved, skipped, remaining } };
  };
  /** The command's author, or the editor's own when the command names none. */
  const authorOf = (command: Extract<EditorCommand, { type: 'setReviewChangesAuthor' }>) =>
    command.author === undefined ? deps.surface()?.author() : command.author;
  const authorPlan = (command: Extract<EditorCommand, { type: 'setReviewChangesAuthor' }>) => {
    const { scopes, missing } = selection(command);
    const attribution = {
      author: authorOf(command) ?? '',
      ...(command.date === undefined ? {} : { date: command.date }),
    };
    const unknown: RevisionAuthorResult['skipped'][number][] = missing.map((key) => ({
      key,
      reason: 'unknown-revision',
    }));
    const plans: {
      scope: StoryScope;
      part: OoxmlPart;
      ops: readonly TreeDocOp[];
      plan: ReturnType<typeof planRevisionAuthorChange>;
    }[] = [];
    for (const { scope, part, keys } of scopes) {
      if (!keys.length) continue;
      const plan = planRevisionAuthorChange(part, attribution, keys, undefined, command.authors);
      plans.push({ scope, part, ops: plan.ops, plan });
    }
    const combine = (results: readonly RevisionAuthorResult[]): RevisionAuthorResult => ({
      updated: results.flatMap((result) => result.updated),
      skipped: [...unknown, ...results.flatMap((result) => result.skipped)],
    });
    return {
      ...routed(plans),
      result: combine(plans.map(({ plan }) => plan.result)),
      /** Name each updated change by its key in the committed document. */
      finish: () => {
        const parts = deps.surface()!.session.currentPackage().parts;
        return combine(
          plans.map(({ part, plan }) => {
            const after = parts.get(part.name);
            return after ? plan.finish(after) : plan.result;
          })
        );
      },
    };
  };
  const ready = (): CanResult => {
    if (deps.destroyed())
      return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
    if (!deps.enabled()) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    if (!deps.surface()) return { ok: false, code: 'notFound', reason: 'no document is open' };
    return { ok: true };
  };
  const selectionRefusal = (command: {
    scope?: unknown;
    keys?: unknown;
    unsupported?: unknown;
  }): CanResult | null =>
    (command.scope !== undefined && !['visible', 'document'].includes(command.scope as string)) ||
    (command.unsupported !== undefined &&
      !['skip', 'fail'].includes(command.unsupported as string)) ||
    (command.keys !== undefined &&
      (!Array.isArray(command.keys) || command.keys.some((key) => typeof key !== 'string')))
      ? { ok: false, code: 'invalidArgs', reason: 'invalid bulk revision selection' }
      : null;
  /** The gate and, when the arguments are valid, the one plan it was judged on. */
  const planSetAuthor = (
    command: Extract<EditorCommand, { type: 'setReviewChangesAuthor' }>
  ): { gate: CanResult; plan?: ReturnType<typeof authorPlan> } => {
    const gate = ready();
    if (!gate.ok) return { gate };
    if (deps.viewing())
      return { gate: { ok: false, code: 'locked', reason: 'the document is open for viewing' } };
    const protectedWrite = commandProtectionRefusal(command, deps.surface()!);
    if (protectedWrite) return { gate: protectedWrite };
    const author = authorOf(command);
    if (author === undefined)
      return {
        gate: {
          ok: false,
          code: 'invalidArgs',
          reason: 'pass an author, or configure the editor author, to change the author',
        },
      };
    if (
      typeof author !== 'string' ||
      (command.date !== undefined && typeof command.date !== 'string') ||
      invalidRevisionAuthorInput({
        author,
        ...(command.date === undefined ? {} : { date: command.date }),
      })
    )
      return {
        gate: {
          ok: false,
          code: 'invalidArgs',
          reason: 'author must be nonblank text, and date an ISO 8601 date and time',
        },
      };
    const invalidSelection = selectionRefusal(command);
    if (invalidSelection) return { gate: invalidSelection };
    // Exact keys and a scope narrowed by authors are two selections; the type excludes the mix.
    if (
      (command.keys !== undefined &&
        (command.scope !== undefined || command.authors !== undefined)) ||
      (command.authors !== undefined &&
        (!Array.isArray(command.authors) ||
          command.authors.some((name) => typeof name !== 'string')))
    )
      return {
        gate: {
          ok: false,
          code: 'invalidArgs',
          reason: 'select by keys, or by scope and authors; authors must be a list of names',
        },
      };
    const plan = authorPlan(command);
    const { result } = plan;
    if (command.unsupported === 'fail' && result.skipped.length)
      return {
        gate: {
          ok: false,
          code: 'unsupported',
          reason: 'some selected changes cannot change author',
        },
        plan,
      };
    if (!result.updated.length)
      return {
        gate: {
          ok: false,
          code: result.skipped.some((entry) => entry.reason === 'unsupported-revision')
            ? 'unsupported'
            : 'notFound',
          reason: 'no eligible selected changes to update',
        },
        plan,
      };
    return { gate: { ok: true }, plan };
  };
  const setAuthor = (
    command: Extract<EditorCommand, { type: 'setReviewChangesAuthor' }>
  ): ExecResult => {
    deps.surface()?.flushPendingInput();
    const { gate, plan } = planSetAuthor(command);
    // A refused selection still reports which changes stopped it.
    if (!gate.ok)
      return plan ? { ...gate, revisionAuthors: { ...plan.result, updated: [] } } : gate;
    const surface = deps.surface()!;
    const { groups, partOps } = plan!;
    if (!groups.length && !partOps.length)
      return { ok: true, changed: false, revisionAuthors: plan!.result };
    // Store keys, as `result.updated` reports them.
    const active = deps
      .placements({ placement: false, pairReplacements: false })
      .find((placement) => placement.isActive)?.key;
    let applied: { committed: boolean; reason?: unknown } | undefined;
    const refused = surface.commitReviewOps((historyToken) => {
      applied = surface.session.applyTreeOpsAtomic(groups, { partOps, historyToken });
      return applied;
    }, 'revision-attribution');
    if (!applied?.committed) return reviewWriteRefusal(refused, 'the changes were refused');
    const result = plan!.finish();
    // Keys include the author, so an active card keeps its place under its new key.
    const moved = result.updated.find((entry) => entry.previousKey === active);
    if (moved) deps.activate(moved.key);
    return { ok: true, changed: true, revisionAuthors: result };
  };
  const can = (requested: EditorCommand): CanResult | null => {
    const command = documentReviewDecisionOf(requested) ?? requested;
    if (command.type === 'setReviewChangesAuthor') return planSetAuthor(command).gate;
    if (
      command.type !== 'navigateReviewChange' &&
      command.type !== 'resolveAllReviewChanges' &&
      command.type !== 'setReviewDisplayMode'
    )
      return null;
    const gate = ready();
    if (!gate.ok) return gate;
    if (command.type === 'setReviewDisplayMode')
      return REVIEW_DISPLAY_MODES.includes(command.mode)
        ? { ok: true }
        : { ok: false, code: 'invalidArgs', reason: 'unknown review display mode' };
    if (
      command.type === 'navigateReviewChange' &&
      !['next', 'previous'].includes(command.direction)
    )
      return { ok: false, code: 'invalidArgs', reason: 'unknown review navigation direction' };
    if (
      command.type === 'resolveAllReviewChanges' &&
      !['accept', 'reject'].includes(command.action)
    )
      return { ok: false, code: 'invalidArgs', reason: 'unknown review resolution action' };
    if (command.type === 'navigateReviewChange')
      return navigable().length
        ? { ok: true }
        : { ok: false, code: 'notFound', reason: 'no visible changes to review' };
    if (deps.viewing())
      return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
    const protectedWrite = commandProtectionRefusal(command, deps.surface()!);
    if (protectedWrite) return protectedWrite;
    const invalidSelection = selectionRefusal(command);
    if (invalidSelection) return invalidSelection;
    const { result, groups, partOps } = bulkPlan(command);
    if (command.unsupported === 'fail' && result.skipped.length)
      return { ok: false, code: 'unsupported', reason: SOME_UNRESOLVABLE_REFUSAL };
    if (!result.resolved.length && !groups.length && !partOps.length)
      return {
        ok: false,
        code: bulkRefusalCode(result.skipped),
        reason: bulkRefusalReason(result.skipped, deps.authorVisibility.hasFilter),
      };
    return { ok: true };
  };
  const resolveReviewItemNow = (key: string, action: 'accept' | 'reject'): ExecResult => {
    const gate = ready();
    if (!gate.ok) return gate;
    if (deps.viewing()) {
      // The surface's own answer: a refresh holding the guard is reported, and answered, as
      // the refresh rather than as viewing.
      const refused = deps
        .surface()!
        .commitReviewOps(
          () => ({ committed: false, reason: 'the document is open for viewing' }),
          'revision-resolve'
        );
      return reviewWriteRefusal(refused, 'the document is open for viewing', 'locked');
    }
    const protectedWrite = commandProtectionRefusal(
      { type: 'resolveAllReviewChanges', action },
      deps.surface()!
    );
    if (protectedWrite) return protectedWrite;
    deps.surface()!.flushPendingInput();
    const item = findReviewPlacement(deps.placements, key)?.item;
    if (!item || item.kind !== 'revision')
      // Led by the review reason, so every reader names the stale card as the planner does.
      return { ok: false, code: 'notFound', reason: 'unknown-revision: no revision with that key' };
    if (item.readOnly)
      return {
        ok: false,
        code: 'unsupported',
        reason: READ_ONLY_REVISION_REASON,
      };
    // A lock or a binding keeps the card in any session state, so it is refused before the
    // commit, with its review code; the exec code stays `locked` or `bound`, as for an edit.
    const kept = guardedCardRefusal(
      partOfNodeId(deps.surface()!.session, revisionSiteNodeIdsOf(item)[0]),
      item,
      action
    );
    if (kept) return kept;
    let applied: { committed: boolean; reason?: unknown } | undefined;
    const refused = deps.surface()!.commitReviewOps((historyToken) => {
      const session = deps.surface()!.session;
      const part = partOfNodeId(session, revisionSiteNodeIdsOf(item)[0]);
      if (part && outsideStories(part)) {
        const outside = resolutionOps(item, action, part);
        // The planner's reason, as a card in a story gets it.
        if (outside.refusal) {
          applied = { committed: false, reason: outside.refusal };
          return applied;
        }
        applied = session.applyTreeOpsAtomic([], {
          partOps: [{ partName: part.name, ops: outside.ops }],
          historyToken,
        });
        return applied;
      }
      const scoped = deps.surface()!.session.partFor(deps.scope(item));
      const decision = resolutionOps(item, action, scoped);
      // A card the planner skips, such as a row kept for its nested table, is refused with the
      // planner's reason, not reported as resolved.
      if (decision.refusal) {
        applied = { committed: false, reason: decision.refusal };
        return applied;
      }
      applied = deps
        .surface()!
        .session.applyTreeOps(decision.ops, undefined, undefined, deps.scope(item), {
          historyToken,
        });
      return applied;
    }, 'revision-resolve');
    if (!applied?.committed)
      return reviewWriteRefusal(
        refused ?? (typeof applied?.reason === 'string' ? applied.reason : null),
        'the revision was refused'
      );
    return { ok: true, changed: true };
  };
  const exec = (requested: EditorCommand): ExecResult | null => {
    const command = documentReviewDecisionOf(requested) ?? requested;
    if (command.type === 'setReviewChangesAuthor') return setAuthor(command);
    if (
      !['navigateReviewChange', 'resolveAllReviewChanges', 'setReviewDisplayMode'].includes(
        command.type
      )
    )
      return null;
    deps.surface()?.flushPendingInput();
    const gate = can(command);
    if (!gate) return null;
    if (!gate.ok) {
      if (
        command.type === 'resolveAllReviewChanges' &&
        (gate.code === 'notFound' ||
          gate.code === 'unsupported' ||
          gate.code === 'locked' ||
          gate.code === 'bound') &&
        ready().ok &&
        !deps.viewing()
      ) {
        const { result } = bulkPlan(command);
        return {
          ...gate,
          revisions: {
            ...result,
            resolved: [],
            // The listed queue, as a decision that runs reports it: records with no card are
            // not pending decisions to a caller.
            remaining: all().length,
          },
        };
      }
      return gate;
    }
    const surface = deps.surface()!;
    if (command.type === 'setReviewDisplayMode') {
      deps.setDisplayMode(command.mode);
      return { ok: true, changed: false };
    }
    if (command.type === 'navigateReviewChange') {
      const items = navigable();
      const active = items.findIndex((item) => item.isActive);
      const step = command.direction === 'next' ? 1 : -1;
      const index =
        active < 0
          ? nextFromCaret(items, surface, step)
          : (active + step + items.length) % items.length;
      const target = items[index]!;
      // A pair opens through its deletion and lights both halves. The reveal names the
      // deletion's store key and adds the pair's key, as for any other activation of a half.
      const halves = replacementPairHalves(target.item);
      const key = halves ? reviewItemKey(halves.deletion) : target.key;
      const result = deps.activate(
        target.key,
        !target.activatable && target.revisionKind === 'format'
      );
      // Every landing reveals, the active item included: a lone change navigates to itself,
      // and its closed card must open again.
      if (result.ok) deps.reveal({ key, source: 'navigate' });
      return result;
    }
    if (command.type !== 'resolveAllReviewChanges') return null;
    const { groups, partOps, result } = bulkPlan(command, true);
    let applied: { committed: boolean; reason?: unknown } | undefined;
    const refused = surface.commitReviewOps((historyToken) => {
      applied = surface.session.applyTreeOpsAtomic(groups, { partOps, historyToken });
      return applied;
    }, 'revision-resolve');
    if (!applied?.committed) return reviewWriteRefusal(refused, 'the revisions were refused');
    deps.activate(null);
    deps.resolved?.({
      action: command.action,
      resolvedCount: result.resolved.length,
      skipped: result.skipped.map(({ key, reason, detail }) => ({
        key,
        reason,
        ...(detail ? { detail } : {}),
      })),
    });
    return { ok: true, changed: true, revisions: { ...result, remaining: all().length } };
  };
  const revisionOf = (key: string) => {
    const item = findReviewPlacement(deps.placements, key)?.item;
    return item?.kind === 'revision' ? item : undefined;
  };
  const resolveReviewItem = deps.report
    ? deps.report.diagnostics.reviewItem(
        resolveReviewItemNow,
        revisionOf,
        (item, action) => {
          const session = deps.surface()?.session;
          const part = session && partOfNodeId(session, revisionSiteNodeIdsOf(item)[0]);
          if (!part) return {};
          try {
            // The plan the decision itself runs, so the report names the same reason.
            const plan = planRevisionBatch(part, action, resolutionKeysOf(item), undefined, {
              countRemaining: false,
              explicit: true,
            });
            const detail = plan.result.skipped[0]?.detail;
            return { partName: part.name, ...(detail ? { detail } : {}) };
          } catch {
            return { partName: part.name };
          }
        },
        deps.report.tracked
      )
    : resolveReviewItemNow;
  return { can, exec, resolveReviewItem };
}

function nextFromCaret(
  items: readonly ReviewItemPlacement[],
  surface: PaginatedSurface,
  step: number
): number {
  const caret = surface.state().selection.head;
  const part = partOfNodeId(surface.session, caret.paragraphId);
  const order = part ? deepParagraphOrderOfPart(part) : new Map<string, number>();
  const rank = order.get(caret.paragraphId);
  if (rank !== undefined) {
    for (
      let index = step > 0 ? 0 : items.length - 1;
      index >= 0 && index < items.length;
      index += step
    ) {
      const item = items[index]!;
      const start = item.kind === 'revision' ? item.item.ranges[0]?.start : undefined;
      const at = start ? order.get(start.paragraphId) : undefined;
      if (
        start &&
        at !== undefined &&
        (step > 0
          ? at > rank || (at === rank && start.offset >= caret.offset)
          : at < rank || (at === rank && start.offset <= caret.offset))
      )
        return index;
    }
  }
  return step > 0 ? 0 : items.length - 1;
}

/** The bulk refusals chrome shows. Fixed sentences, so the catalogue can translate them. */
const NO_REVIEW_CHANGES = 'no eligible selected changes to review';
const HIDDEN_CHANGES_REFUSAL =
  'these changes would also resolve changes the filter hides; clear the filter to review them first';
const NAMED_CHANGES_REFUSAL =
  'these changes would also resolve changes the selection leaves out; decide each card';
const UNRESOLVABLE_CHANGES_REFUSAL = 'none of the selected changes can be resolved';
const SOME_UNRESOLVABLE_REFUSAL = 'some selected changes cannot be resolved';
/** @internal Every bulk refusal sentence, so a test keeps each one translatable. */
export const BULK_REVIEW_REFUSALS = [
  NO_REVIEW_CHANGES,
  HIDDEN_CHANGES_REFUSAL,
  NAMED_CHANGES_REFUSAL,
  UNRESOLVABLE_CHANGES_REFUSAL,
  SOME_UNRESOLVABLE_REFUSAL,
  LOCKED_CHANGES_REFUSAL,
  BOUND_CHANGES_REFUSAL,
] as const;

/** The exec code of a bulk decision that resolves nothing: a lock or a binding keeps its own. */
function bulkRefusalCode(
  skipped: readonly { readonly detail?: string }[]
): 'notFound' | 'unsupported' | 'locked' | 'bound' {
  if (!skipped.length) return 'notFound';
  if (skipped.every((skip) => skip.detail === 'locked-content')) return 'locked';
  if (skipped.every((skip) => skip.detail === 'bound-content')) return 'bound';
  return 'unsupported';
}

/**
 * Why a bulk decision resolves nothing. A change that would take a hidden author's change with
 * it names the cause and the way out, in a fixed sentence the catalogue translates.
 */
function bulkRefusalReason(
  skipped: readonly { readonly reason: string; readonly detail?: string }[],
  filtered: boolean
): string {
  if (!skipped.length) return NO_REVIEW_CHANGES;
  if (skipped.every((skip) => skip.reason === 'incomplete-group'))
    return filtered ? HIDDEN_CHANGES_REFUSAL : NAMED_CHANGES_REFUSAL;
  // Every change is kept by one cause, a lock or a binding: the refusal names it.
  if (skipped.every((skip) => skip.detail === 'locked-content')) return LOCKED_CHANGES_REFUSAL;
  if (skipped.every((skip) => skip.detail === 'bound-content')) return BOUND_CHANGES_REFUSAL;
  return UNRESOLVABLE_CHANGES_REFUSAL;
}

/** Why a row decision is refused when the row must stay to keep a nested table. */
const RETAINED_ROW_REASON =
  'retained-structure: the row stays because it holds a nested table with untracked rows';

/** Why a card is refused when it resolves only together with changes it does not name. */
const GROUPED_CARD_REASON =
  'incomplete-group: this change resolves only together with another change, such as the deleted row that holds it; decide that change first';

/** The refusal for a card the planner skips, led by the review reason. */
function cardRefusal(skip: { readonly reason: string; readonly detail?: string }): string {
  if (skip.reason === 'retained-structure') return RETAINED_ROW_REASON;
  if (skip.reason === 'incomplete-group') return GROUPED_CARD_REASON;
  // A lock or a binding keeps this decision: the detail names its own review code.
  if (skip.detail === 'locked-content' || skip.detail === 'bound-content')
    return `${skip.detail}: the change stays pending`;
  return skip.detail ? `${skip.reason}: ${skip.detail}` : skip.reason;
}

/** The refusal for a card a content control lock or data binding keeps, or null. */
function guardedCardRefusal(
  part: OoxmlPart | null,
  item: ReviewRevisionItem,
  action: 'accept' | 'reject'
): Extract<ExecResult, { ok: false }> | null {
  const kept =
    part && holdsGuardedControls(part)
      ? guardKeepsRevisions(part, revisionSiteNodeIdsOf(item), action)
      : null;
  if (!kept) return null;
  return {
    ok: false,
    code: kept === 'locked-content' ? 'locked' : 'bound',
    reason: cardRefusal({ reason: 'unsupported-revision', detail: kept }),
  };
}

/** Whether accepting the card empties a table cell, which then goes. */
function acceptEmptiesTableCell(part: OoxmlPart, item: ReviewRevisionItem): boolean {
  const ids = new Set(revisionSiteNodeIdsOf(item));
  const sites = collectRevisionSites(part).filter((site) => ids.has(site.node.id));
  return (
    sites.some((site) => site.paragraphMark) && emptiedTableCells(part, sites, 'accept').size > 0
  );
}

/**
 * Whether a card can decide together with an ordinary move range. A card with no range has no
 * paragraph to rule it out.
 */
function touchesOrdinaryMove(part: OoxmlPart, item: ReviewRevisionItem): boolean {
  const paragraphs = paragraphsWithOrdinaryMoves(part.root);
  if (paragraphs === 'everywhere') return true;
  return (
    paragraphs.size > 0 &&
    (item.ranges.length === 0 ||
      item.ranges.some(
        (range) => paragraphs.has(range.start.paragraphId) || paragraphs.has(range.end.paragraphId)
      ))
  );
}

/** Resolve only the canonical sites that contributed to this card. */
function resolutionOps(
  item: ReviewRevisionItem,
  action: 'accept' | 'reject',
  part: OoxmlPart | null
): { readonly ops: readonly TreeDocOp[]; readonly refusal?: string } {
  const op = action === 'accept' ? 'acceptRevision' : 'rejectRevision';
  if (!part) return { ops: [] };
  // A grouped row decision can remove later constituents. Resolve its sites
  // together, with the same dependency preflight as the bulk command.
  if (
    item.revisionKind === 'structural' ||
    // A move and a paragraph mark can resolve with another site, such as a destination with no
    // source and its mark.
    item.revisionKind === 'moveFrom' ||
    item.revisionKind === 'moveTo' ||
    item.revisionKind === 'paragraphMark' ||
    // A change in a paragraph that holds part of an ordinary move range can resolve with it.
    touchesOrdinaryMove(part, item) ||
    // A formatting decision can replace properties that hold another change, so the planner
    // decides it, as it decides a keyed bulk selection of the same card.
    item.revisionKind === 'format' ||
    // Accepting a deletion that empties a table cell removes the cell, which needs its text
    // and its paragraph marks decided together.
    (action === 'accept' && acceptEmptiesTableCell(part, item)) ||
    // Text and the paragraph mark it reaches decide together, so the paragraph goes whole.
    holdsParagraphMark(part, item)
  ) {
    const plan = planRevisionBatch(part, action, resolutionKeysOf(item), undefined, {
      countRemaining: false,
      explicit: true,
    });
    const skip = plan.result.skipped[0];
    return skip ? { ops: [], refusal: cardRefusal(skip) } : { ops: plan.ops };
  }
  const nodeIds = new Set(revisionSiteNodeIdsOf(item));
  const operations = new Map<
    string,
    {
      revision: ReviewRevisionItem['address'];
      localName: string | undefined;
      siteNodeIds: string[];
    }
  >();
  for (const site of collectRevisionSites(part)) {
    if (!nodeIds.has(site.node.id)) continue;
    const attr = (name: string) =>
      site.node.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value;
    const revision = item.addresses.find(
      (address) =>
        address.id === attr('id') &&
        address.author === (attr('author') ?? '') &&
        (address.date ?? '') === (attr('date') ?? '')
    );
    if (!revision) continue;
    const localName = site.node.localName;
    const key = JSON.stringify([revision, localName]);
    const known = operations.get(key);
    if (known) known.siteNodeIds.push(site.node.id);
    else operations.set(key, { revision, localName, siteNodeIds: [site.node.id] });
  }
  return {
    ops: [...operations.values()].map(({ revision, localName, siteNodeIds }) => ({
      op,
      revision,
      ...(localName === undefined ? {} : { localName }),
      siteNodeIds,
    })),
  };
}

/** Whether a text change also holds a paragraph mark. */
function holdsParagraphMark(part: OoxmlPart, item: ReviewRevisionItem): boolean {
  if (item.revisionKind !== 'insert' && item.revisionKind !== 'delete') return false;
  const ids = new Set(revisionSiteNodeIdsOf(item));
  return (
    ids.size > 1 &&
    collectRevisionSites(part).some((site) => site.paragraphMark && ids.has(site.node.id))
  );
}

/** Date metadata shared by comment and revision placements. */
export function dateOfReviewItem(item: ReviewItem): string | undefined {
  if (item.kind === 'comment') return item.comment.date;
  return item.kind === 'revision' ? item.date : undefined;
}
