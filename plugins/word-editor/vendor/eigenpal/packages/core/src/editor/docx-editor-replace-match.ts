// `replaceMatch`: replace one `findMatches` result, or one computed range, where it stands.
//
// The match is addressed directly, so the reader's selection and the viewport stay put — a
// host stepping through its own list of matches must not have the caret taken or the page
// moved. Suggesting records a tracked replacement under the editor's author, through the same
// plan and store rules as a replacement typed over a selection.
//
// A match in a header, footer, or note that is not open is replaced there without opening it:
// a proofing panel that fixes one word must not drop the reader into header editing. A match
// whose expected text is no longer at its offsets is refused before anything changes.

import type { StoryScope } from '@docx-editor.dev/core/store';
import { replacementOps } from './replacement-ops.ts';
import type { EditorCommand, ExecResult, ViewScope } from '../contracts/editor.ts';
import { isCollaborationFailureCode } from '../collaboration/failure.ts';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import {
  isActiveStory,
  removedTextRefusal,
  resolveTextTarget,
  textTargetArgumentRefusal,
  type TextTarget,
} from './text-target.ts';

type ReplaceMatchCommand = Extract<EditorCommand, { type: 'replaceMatch' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

/** The argument checks, which need no document. */
export function replaceMatchArgumentRefusal(command: ReplaceMatchCommand): string | null {
  const target = textTargetArgumentRefusal(command.match);
  if (target) return target;
  if (typeof command.text !== 'string') return 'replaceMatch requires text';
  if (/[\r\n\v\f\u2028\u2029]/.test(command.text))
    return 'replaceMatch requires text without a paragraph mark';
  return null;
}

/**
 * The story to replace in, or why the match cannot be replaced. Reads only, so `can` and
 * `exec` agree. A match in a text box is refused rather than edited behind the reader.
 */
export function replaceMatchTarget(
  surface: PaginatedSurface,
  match: TextTarget
): { readonly ok: true; readonly scope: ViewScope } | Refusal {
  // A match inside a field result covers the whole field; replacing it would replace more.
  const resolved = resolveTextTarget(surface, match, 'refuse');
  if (!resolved.ok) return resolved;
  if (resolved.scope.kind === 'frame') {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'replaceMatch does not replace text in a text box',
    };
  }
  // Struck text stays in the model text, so a search finds it; it is not a word to replace.
  return removedTextRefusal(surface, match) ?? { ok: true, scope: resolved.scope };
}

/** The store scope of a story, for a write that does not open it. */
function storyScopeOf(scope: ViewScope): StoryScope | null {
  if (scope.kind === 'body') return { kind: 'body' };
  if (scope.kind === 'headerFooter') return { kind: 'headerFooter', rId: scope.rId };
  if (scope.kind === 'note') {
    const parsed = parseNoteScopeId(scope.id);
    return parsed ? { kind: 'notesPart', noteKind: parsed.noteKind } : null;
  }
  return null;
}

/** A refused write in a story that is not open, as a command result. */
function writeRefusalResult(raw: string, reason: string): Refusal {
  if (isCollaborationFailureCode(raw)) return { ok: false, code: 'unsupported', reason: raw };
  return { ok: false, code: raw === 'locked' ? 'locked' : 'invalidArgs', reason };
}

/**
 * Replace in a story the reader is not in, without opening it. One commit, so one undo step;
 * suggesting tracks it, as typing over the range would. The reader's selection is in the open
 * story, so neither it nor the active story moves.
 */
function replaceInClosedStory(
  surface: PaginatedSurface,
  scope: ViewScope,
  paragraphId: string,
  start: number,
  end: number,
  text: string
): ExecResult | null {
  const story = storyScopeOf(scope);
  if (!story) {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'the story that holds the match cannot be edited',
    };
  }
  // Non-null exactly when the edit is tracked: the struck text stays, the insertion follows it.
  const landing = surface.replacementLanding(paragraphId, start, end);
  const ops = replacementOps(paragraphId, start, end, text, landing);
  if (ops.length === 0) return null;
  const outcome = surface.applyAutomationOps(() => ops, story);
  if (!outcome.rejected) return null;
  const raw = String(outcome.reason ?? 'replaceMatch was refused');
  return writeRefusalResult(raw, surface.state().lastRejection ?? raw);
}

/** Run an admitted `replaceMatch`. Null when it committed or had nothing to change. */
export function execReplaceMatch(
  surface: PaginatedSurface,
  command: ReplaceMatchCommand
): ExecResult | null {
  // Typing still in the buffer lands first, so the expected text is checked against it.
  surface.flushPendingInput();
  const target = replaceMatchTarget(surface, command.match);
  if (!target.ok) return target;
  const { blockId, start, length } = command.match;
  if (!isActiveStory(surface, target.scope)) {
    return replaceInClosedStory(
      surface,
      target.scope,
      blockId,
      start,
      start + length,
      command.text
    );
  }
  if (surface.replaceTextInPlace(blockId, start, start + length, command.text)) return null;
  return {
    ok: false,
    code: 'invalidArgs',
    reason: surface.state().lastRejection ?? 'replaceMatch was refused',
  };
}
