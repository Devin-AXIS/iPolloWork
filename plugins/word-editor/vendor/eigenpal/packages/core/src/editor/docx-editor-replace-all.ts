// `replaceAllMatches`: replace every match of a query in one undo step.
//
// The command searches the same stories `findMatches` reports, so a host's count and the
// replacement agree. Each story is one commit, and every commit carries one history group, so
// a single undo takes back the body, headers, footers, and notes together. Inside a paragraph
// the edits run back to front: a replacement shifts the offsets after it, never the ones
// before it. Suggesting attributes every replacement, as `replaceMatch` does.
//
// A match is skipped, not refused, when its range cannot take plain text: struck text, a field
// result (its model range is one atom), or content the mode or a lock protects. Those are found
// before committing, so a normal run is one commit per story. The result counts both.
// The selection and the scroll position stay where the reader left them; a caret after a
// replaced word moves with its text.

import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type {
  EditorCommand,
  ExecResult,
  ReplaceAllMatchesOutcome,
  TextMatch,
} from '../contracts/editor.ts';
import { isCollaborationFailureCode } from '../collaboration/failure.ts';
import { writeRejectionReason } from './command-protection.ts';
import { matchRangeSkip } from './docx-editor-replace-all-ranges.ts';
import { withDisplayedHyphens } from '../store/package/hyphen-text.ts';
import { paragraphTextOf } from '../store/store/paragraph-model-text.ts';
import { searchStoriesForSurface } from './docx-editor-story-navigation.ts';
import { runWithHistoryGroup, takeHistoryGroup } from './history-group-scope.ts';
import type { PaginatedSurface, ScaleMutableSurface } from './paginated-surface-contract.ts';
import { mapSelectionAcrossText } from './surface-remote-caret.ts';
import { replacementOps } from './replacement-ops.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';

type ReplaceAllCommand = Extract<EditorCommand, { type: 'replaceAllMatches' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

const PARAGRAPH_MARK = /[\r\n\v\f\u2028\u2029]/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
/** Extra commits the refusal fallback may spend, beyond one per story. */
const MAX_FALLBACK_COMMITS = 32;
const TOO_MANY_REFUSALS = 'replaceAllMatches stopped: the document refused too many replacements';

/** The argument checks, which need no document. */
export function replaceAllMatchesArgumentRefusal(command: ReplaceAllCommand): string | null {
  if (typeof command.query !== 'string' || command.query.length === 0)
    return 'replaceAllMatches requires a non-empty query';
  if (typeof command.text !== 'string') return 'replaceAllMatches requires text';
  if (PARAGRAPH_MARK.test(command.text))
    return 'replaceAllMatches requires text without a paragraph mark';
  for (const flag of ['matchCase', 'wholeWord'] as const) {
    if (command[flag] !== undefined && typeof command[flag] !== 'boolean')
      return `replaceAllMatches requires ${flag} to be a boolean`;
  }
  return null;
}

/** One match planned for writing: its range, the ops that replace it, and its length change. */
interface PlannedMatch {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  /** Where the replacement text is inserted. */
  readonly landing: number;
  readonly ops: readonly TreeDocOp[];
  /** How much longer the paragraph's model text gets. A tracked strike stays in the text. */
  readonly delta: number;
  /** Whether the matched text leaves the model text, so a caret inside it moves to its start. */
  readonly removes: boolean;
}

const modelTextOf = (surface: PaginatedSurface, paragraphId: string): string | undefined => {
  const part = partOfNodeId(surface.session, paragraphId);
  return (part && paragraphTextOf(part, paragraphId)) ?? undefined;
};

/**
 * Whether the model text under `match` is still the text the search reported. A field
 * result fails this on purpose: its model range is one atom, not the visible result.
 * `textOf` reads one paragraph's model text, cached across the matches it holds.
 */
function matchStillHolds(
  textOf: (paragraphId: string) => string | undefined,
  match: TextMatch
): boolean {
  const text = textOf(match.blockId);
  if (text === undefined || match.start + match.length > text.length) return false;
  const current = withDisplayedHyphens(text.slice(match.start, match.start + match.length));
  return current.replace(CONTROL_CHARS, ' ') === match.text;
}

/** Plan one match: strike or delete its range, then insert where typing would land. */
function planMatch(surface: PaginatedSurface, match: TextMatch, text: string): PlannedMatch {
  const { blockId: paragraphId, start, length } = match;
  const end = start + length;
  // Non-null exactly when the edit is tracked: the struck text stays, the insertion follows it.
  const landing = surface.replacementLanding(paragraphId, start, end);
  const ops = replacementOps(paragraphId, start, end, text, landing);
  const removes = landing === null;
  const delta = text.length - (removes ? length : 0);
  return { paragraphId, start, end, landing: landing ?? start, ops, delta, removes };
}

/** One offset carried across the planned matches of its paragraph, in ascending order. */
function carryOffset(offset: number, matches: readonly PlannedMatch[]): number {
  let shift = 0;
  for (const match of matches) {
    if (offset >= match.end) shift += match.delta;
    else if (offset > match.start && match.removes) return match.start + shift;
    else break;
  }
  return offset + shift;
}

/**
 * The selection carry for one commit: the reader's endpoints move with their text when the
 * commit writes in their paragraph. The planned length changes are checked against the
 * committed text; a paragraph that disagrees (a tracked strike that removed the author's own
 * pending insertion) falls back to the shared text-diff carry.
 */
function selectionCarry(
  surface: PaginatedSurface,
  planned: readonly PlannedMatch[]
): (selection: SemanticSelection) => SemanticSelection {
  const { anchor, head } = surface.state().selection;
  const before = new Map<string, { text: string; matches: PlannedMatch[] }>();
  for (const id of new Set([anchor.paragraphId, head.paragraphId])) {
    const matches = planned.filter((match) => match.paragraphId === id);
    const text = matches.length > 0 ? modelTextOf(surface, id) : undefined;
    if (text !== undefined)
      before.set(id, { text, matches: matches.sort((a, b) => a.start - b.start) });
  }
  return (selection) => {
    let carried = selection;
    for (const [paragraphId, { text, matches }] of before) {
      const after = modelTextOf(surface, paragraphId) ?? text;
      const total = matches.reduce((sum, match) => sum + match.delta, 0);
      if (text.length + total !== after.length) {
        carried = mapSelectionAcrossText(carried, paragraphId, text, after);
        continue;
      }
      const move = (position: SemanticPosition): SemanticPosition =>
        position.paragraphId === paragraphId
          ? { ...position, offset: carryOffset(position.offset, matches) }
          : position;
      carried = { anchor: move(carried.anchor), head: move(carried.head) };
    }
    return carried;
  };
}

function storyKey(scope: StoryScope): string {
  if (scope.kind === 'headerFooter') return `headerFooter:${scope.rId}`;
  if (scope.kind === 'notesPart') return `notesPart:${scope.noteKind}`;
  return 'body';
}

/** A refused write: the store's code, and the sentence the surface reported for it. */
interface WriteRefusal {
  readonly raw: string;
  readonly reason: string;
}

/** A refused write as a command result. */
function writeRefusalResult({ raw, reason }: WriteRefusal): Refusal {
  if (isCollaborationFailureCode(raw)) return { ok: false, code: 'unsupported', reason: raw };
  const code = raw === 'locked' || raw === 'bound' ? raw : 'invalidArgs';
  return { ok: false, code, reason };
}

/** Run an admitted `replaceAllMatches`. */
export function execReplaceAllMatches(
  surface: PaginatedSurface,
  command: ReplaceAllCommand
): ExecResult {
  const result = surface.session.findText(command.query, {
    ...(command.matchCase !== undefined ? { matchCase: command.matchCase } : {}),
    ...(command.wholeWord !== undefined ? { wholeWord: command.wholeWord } : {}),
    stories: searchStoriesForSurface(surface, 'editing'),
  });
  // A capped scan does not know every match, and replacing a prefix would leave the rest.
  if (result.truncated) {
    return {
      ok: false,
      code: 'unsupported',
      reason: `replaceAllMatches replaces at most ${result.matches.length} matches; narrow the query`,
    };
  }
  const live = surface as ScaleMutableSurface;
  const stories = new Map<string, { scope: StoryScope; planned: PlannedMatch[] }>();
  let skipped = 0;
  let firstRefusal: WriteRefusal | undefined;
  const texts = new Map<string, string | undefined>();
  const textOf = (paragraphId: string) => {
    if (!texts.has(paragraphId)) texts.set(paragraphId, modelTextOf(surface, paragraphId));
    return texts.get(paragraphId);
  };
  // A range is written once, even if a story were reached twice.
  const seen = new Set<string>();
  // Back to front, so an edit never moves the offsets of a match still to be written.
  for (let index = result.matches.length - 1; index >= 0; index -= 1) {
    const match = result.matches[index]!;
    const key = `${match.blockId}\u0000${match.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!matchStillHolds(textOf, match)) {
      skipped += 1;
      continue;
    }
    const plan = planMatch(surface, match, command.text);
    if (plan.ops.length === 0) continue;
    // The store's own range rules, asked before committing: a refused commit costs a full
    // apply and layout, so a lock found only by committing made the fallback quadratic.
    const part = partOfNodeId(surface.session, match.blockId);
    const rangeSkip = part
      ? matchRangeSkip(part, plan.paragraphId, plan.start, plan.end, plan.landing)
      : 'locked';
    if (rangeSkip !== null) {
      // Struck text is not a refusal: there is simply nothing live to replace there.
      if (rangeSkip !== 'deleted') {
        const reason = writeRejectionReason(rangeSkip, surface.session.settingsRoot());
        firstRefusal ??= { raw: rangeSkip, reason };
      }
      skipped += 1;
      continue;
    }
    // The mode rules for this match alone: a table of contents or a suggesting rule refuses
    // one match without refusing its neighbours.
    const refusal = live.automationWriteRefusal?.(plan.ops, false) ?? null;
    if (refusal !== null) {
      firstRefusal ??= { raw: refusal, reason: refusal };
      skipped += 1;
      continue;
    }
    const scope = storyScopeOfNodeId(surface.session, match.blockId, { kind: 'body' });
    const story = stories.get(storyKey(scope)) ?? { scope, planned: [] };
    story.planned.push(plan);
    stories.set(storyKey(scope), story);
  }

  // The caller's group when one is bound, else one minted here: each commit takes the bound
  // group, so it is bound again for every story.
  const group = takeHistoryGroup(surface) ?? Symbol('replaceAllMatches');
  const commit = (planned: readonly PlannedMatch[], scope: StoryScope) => {
    const ops = planned.flatMap((entry) => entry.ops);
    const carry = selectionCarry(surface, planned);
    return runWithHistoryGroup(surface, group, () =>
      surface.applyAutomationOps(() => ops, scope, undefined, false, carry)
    );
  };
  let replaced = 0;
  let retries = 0;
  // Why the command stopped before writing every story, or undefined while it runs.
  let stopped: WriteRefusal | undefined;
  // The checks above leave a story commit nothing the store refuses, so this halving is a
  // fallback for a rule they do not ask. It is bounded: past `MAX_FALLBACK_COMMITS` extra
  // commits, or on a collaboration refusal, which holds for every half, the command stops.
  const write = (planned: readonly PlannedMatch[], scope: StoryScope, retry: boolean): void => {
    if (stopped || planned.length === 0) return;
    if (retry && ++retries > MAX_FALLBACK_COMMITS) {
      stopped = { raw: 'too-many-refusals', reason: TOO_MANY_REFUSALS };
      return;
    }
    const outcome = commit(planned, scope);
    if (!outcome.rejected) {
      replaced += planned.length;
      return;
    }
    const raw = String(outcome.reason ?? 'replaceAllMatches was refused');
    // Read now: a later commit that lands clears the surface's rejection.
    const refusal = { raw, reason: surface.state().lastRejection ?? raw };
    if (isCollaborationFailureCode(raw)) {
      stopped = refusal;
      return;
    }
    if (planned.length === 1) {
      firstRefusal ??= refusal;
      skipped += 1;
      return;
    }
    // Halves stay back to front: the later half is written first.
    const middle = Math.ceil(planned.length / 2);
    write(planned.slice(0, middle), scope, true);
    write(planned.slice(middle), scope, true);
  };
  for (const { scope, planned } of stories.values()) write(planned, scope, false);

  if (stopped) {
    // Part-way: say so, and report what landed. The written matches still undo as one step.
    const refusal = writeRefusalResult(stopped);
    if (replaced === 0) return refusal;
    return {
      ...refusal,
      reason: `replaceAllMatches stopped after ${replaced} replacements: ${refusal.reason}`,
      replacements: { replaced, skipped },
    };
  }
  // Nothing written and something refused: the refusal is the answer, not a quiet no-op.
  if (replaced === 0 && firstRefusal !== undefined) return writeRefusalResult(firstRefusal);
  const replacements: ReplaceAllMatchesOutcome = { replaced, skipped };
  return { ok: true, changed: replaced > 0, replacements };
}
