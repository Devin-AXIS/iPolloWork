// `replaceAcceptedText`: fix a range of a paragraph's accepted text, as a proofing tool reads it.
//
// A checker reads `ParagraphText.acceptedText`, where a word that a tracked deletion splits is
// one word. Its fix names a range of that text, and replacing the whole range would strike
// and retype letters that were never wrong, moving other authors' changes out of the word.
// So the command compares the range with the fix and edits only the graphemes between the
// common start and the common end. Those letters can still cover several parts of the
// paragraph; each part is edited from the end to the start, in one commit, so one undo step.
//
// An object (a field, a picture, a note reference, a symbol) reads as U+FFFC. A fix may keep
// one in its unchanged start or end, but never removes one or writes the character as text.
//
// The write goes to the story that holds the paragraph, without opening it: a header, a
// footer, a note, or a text box. Suggesting tracks it under the editor's author, as
// `replaceMatch` does. The reader's selection stays next to the same characters.

import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { EditorCommand, ExecResult, ParagraphText } from '../contracts/editor.ts';
import { isCollaborationFailureCode } from '../collaboration/failure.ts';
import { paragraphTextOf } from '../store/store/paragraph-model-text.ts';
import { writeRejectionReason } from './command-protection.ts';
import { textEdits, type TextEdit } from './grapheme-diff.ts';
import { matchRangeSkip } from './docx-editor-replace-all-ranges.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { acceptedTextRanges, textOffsetFromAccepted } from './paragraph-text-ranges.ts';
import { replacementOps } from './replacement-ops.ts';
import { textboxScopeOfParagraph } from './review-story-entry.ts';
import { mapSelectionAcrossText } from './surface-remote-caret.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';
import { removedTextRefusal, resolveTextTarget, textTargetArgumentRefusal } from './text-target.ts';

type ReplaceAcceptedTextCommand = Extract<EditorCommand, { type: 'replaceAcceptedText' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

const PARAGRAPH_MARK = /[\r\n\v\f\u2028\u2029]/;
const OBJECT = '\uFFFC';

/** The argument checks, which need no document. */
export function replaceAcceptedTextArgumentRefusal(
  command: ReplaceAcceptedTextCommand
): string | null {
  const target = textTargetArgumentRefusal(command.match);
  if (target) return target;
  if (typeof command.text !== 'string') return 'replaceAcceptedText requires text';
  if (PARAGRAPH_MARK.test(command.text))
    return 'replaceAcceptedText requires text without a paragraph mark';
  return null;
}

const NOT_FOUND: Refusal = Object.freeze({
  ok: false as const,
  code: 'notFound' as const,
  reason: 'the paragraph does not hold that accepted text; read it again',
});

const REMOVES_OBJECT: Refusal = Object.freeze({
  ok: false as const,
  code: 'unsupported' as const,
  reason:
    'the fix would remove an object, such as a field, a picture, or a note reference; edit the object instead',
});

const ADDS_OBJECT: Refusal = Object.freeze({
  ok: false as const,
  code: 'invalidArgs' as const,
  reason: 'the text adds U+FFFC; an object cannot be written as text',
});

const OTHER_SCOPE: Refusal = Object.freeze({
  ok: false as const,
  code: 'invalidArgs' as const,
  reason: 'the match scope does not hold the paragraph; omit scope or name its story',
});

/** One `text` range the plan edits, and where its insertion lands. */
interface Piece {
  readonly start: number;
  readonly end: number;
  readonly landing: number;
}

/** The planned write: the ops in order and the `text` ranges they edit. */
interface Plan {
  readonly ops: readonly TreeDocOp[];
  readonly pieces: readonly Piece[];
}

/** The ops and pieces of one edit in accepted offsets. */
function planEdit(
  surface: PaginatedSurface,
  paragraph: ParagraphText,
  edit: TextEdit
): { readonly ops: readonly TreeDocOp[]; readonly pieces: readonly Piece[] } {
  const { blockId } = paragraph;
  if (edit.from === edit.to) {
    // A pure insertion follows the accepted text before it, ahead of any struck text.
    const at = textOffsetFromAccepted(paragraph, edit.from);
    const landing = surface.replacementLanding(blockId, at, at) ?? at;
    return {
      ops: replacementOps(blockId, at, at, edit.text, landing),
      pieces: [{ start: at, end: at, landing }],
    };
  }
  const ranges = acceptedTextRanges(paragraph, edit.from, edit.to);
  const ops: TreeDocOp[] = [];
  // Back to front: a later part never moves the offsets of an earlier one.
  for (let index = ranges.length - 1; index > 0; index -= 1) {
    const { start, length } = ranges[index]!;
    ops.push({ op: 'deleteText', paragraphId: blockId, start, end: start + length });
  }
  const first = ranges[0]!;
  const firstEnd = first.start + first.length;
  // Non-null exactly when the edit is tracked: the struck text stays, the insertion follows it.
  const tracked = surface.replacementLanding(blockId, first.start, firstEnd);
  ops.push(...replacementOps(blockId, first.start, firstEnd, edit.text, tracked));
  const landing = tracked ?? first.start;
  return {
    ops,
    pieces: ranges.map(({ start, length }) => ({ start, end: start + length, landing })),
  };
}

/** Plan the edit, or the refusal. Reads only, so `can` and `exec` agree. */
function planReplacement(
  surface: PaginatedSurface,
  paragraph: ParagraphText,
  command: ReplaceAcceptedTextCommand
): Plan | Refusal | null {
  const { acceptedText } = paragraph;
  const { start, length, expectedText } = command.match;
  const end = start + length;
  if (end > acceptedText.length) return NOT_FOUND;
  const current = acceptedText.slice(start, end);
  if (expectedText !== undefined && expectedText !== current) return NOT_FOUND;
  const edits = textEdits(current, command.text);
  if (edits.length === 0) return null;
  for (const edit of edits) {
    if (current.slice(edit.from, edit.to).includes(OBJECT)) return REMOVES_OBJECT;
    if (edit.text.includes(OBJECT)) return ADDS_OBJECT;
  }
  const ops: TreeDocOp[] = [];
  const pieces: Piece[] = [];
  // Back to front again, across edits.
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!;
    const planned = planEdit(surface, paragraph, {
      from: start + edit.from,
      to: start + edit.to,
      text: edit.text,
    });
    ops.push(...planned.ops);
    pieces.push(...planned.pieces);
  }
  return { ops, pieces };
}

/** Why the caller's `scope` does not hold the paragraph, or null. */
function scopeRefusal(
  command: ReplaceAcceptedTextCommand,
  textBox: { readonly id: string } | null
): Refusal | null {
  const scope = command.match.scope;
  if (!scope) return null;
  if (textBox) return scope.kind === 'frame' && scope.id === textBox.id ? null : OTHER_SCOPE;
  return scope.kind === 'frame' ? OTHER_SCOPE : null;
}

/** The story to write in, or why the plan cannot be written. Reads only. */
function storyOf(
  surface: PaginatedSurface,
  paragraph: ParagraphText,
  command: ReplaceAcceptedTextCommand,
  plan: Plan
): StoryScope | Refusal {
  const { blockId } = paragraph;
  const part = partOfNodeId(surface.session, blockId);
  if (!part) return NOT_FOUND;
  const textBox = textboxScopeOfParagraph(part, blockId);
  const wrongScope = scopeRefusal(command, textBox);
  if (wrongScope) return wrongScope;
  for (const piece of plan.pieces) {
    const target = { blockId, start: piece.start, length: piece.end - piece.start };
    // A text box is written through the story that holds it, so its story needs no opening.
    if (!textBox) {
      const scope = command.match.scope;
      const resolved = resolveTextTarget(surface, scope ? { ...target, scope } : target, 'refuse');
      if (!resolved.ok) return resolved;
    }
    const removed = removedTextRefusal(surface, target);
    if (removed) return removed;
    // The store's own lock and binding rules, asked before writing in every story.
    const skip = matchRangeSkip(part, blockId, piece.start, piece.end, piece.landing);
    if (skip !== null) return writeRefusal(surface, skip);
  }
  return storyScopeOfNodeId(surface.session, blockId, { kind: 'body' });
}

function writeRefusal(surface: PaginatedSurface, raw: string, reason?: string): Refusal {
  if (isCollaborationFailureCode(raw)) return { ok: false, code: 'unsupported', reason: raw };
  return {
    ok: false,
    code: raw === 'locked' || raw === 'bound' ? raw : 'invalidArgs',
    reason: reason ?? writeRejectionReason(raw, surface.session.settingsRoot()),
  };
}

/** Whether `replaceAcceptedText` would write, without writing. */
export function replaceAcceptedTextRefusal(
  surface: PaginatedSurface,
  paragraph: ParagraphText | null,
  command: ReplaceAcceptedTextCommand
): Refusal | null {
  if (!paragraph) return NOT_FOUND;
  const plan = planReplacement(surface, paragraph, command);
  if (plan === null) return null;
  if ('ok' in plan) return plan;
  const story = storyOf(surface, paragraph, command, plan);
  return 'ok' in story ? story : null;
}

/** Run an admitted `replaceAcceptedText`. Null when it committed or had nothing to change. */
export function execReplaceAcceptedText(
  surface: PaginatedSurface,
  readParagraph: (blockId: string) => ParagraphText | null,
  command: ReplaceAcceptedTextCommand
): ExecResult | null {
  // Typing still in the buffer lands first, so the range is checked against it.
  surface.flushPendingInput();
  const paragraph = readParagraph(command.match.blockId);
  if (!paragraph) return NOT_FOUND;
  const plan = planReplacement(surface, paragraph, command);
  if (plan === null) return null;
  if ('ok' in plan) return plan;
  const story = storyOf(surface, paragraph, command, plan);
  if ('ok' in story) return story;
  const { blockId } = paragraph;
  const modelText = () => {
    const part = partOfNodeId(surface.session, blockId);
    return (part && paragraphTextOf(part, blockId)) ?? undefined;
  };
  const before = modelText();
  const carry = (selection: Parameters<typeof mapSelectionAcrossText>[0]) => {
    const after = modelText();
    return before === undefined || after === undefined
      ? selection
      : mapSelectionAcrossText(selection, blockId, before, after);
  };
  const outcome = surface.applyAutomationOps(() => plan.ops, story, undefined, false, carry);
  if (!outcome.rejected) return null;
  const raw = String(outcome.reason ?? 'replaceAcceptedText was refused');
  return writeRefusal(surface, raw, surface.state().lastRejection ?? undefined);
}
