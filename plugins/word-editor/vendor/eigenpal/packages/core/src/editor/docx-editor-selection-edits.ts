// Selection edits from the document vocabulary: `replaceText`, `applyFormatting`,
// `splitParagraph`, `mergeParagraphs`, and `removeTabMark`.
//
// Each one is the command form of a gesture the editor already has, and runs through that
// gesture's own lane, so the mode rules, tracking, locks, and undo are the gesture's:
// `replaceText` is a paste over the selection, `applyFormatting` the toolbar's mark and value
// writes, `splitParagraph` Enter, `mergeParagraphs` the join a Delete at a paragraph's end
// makes, and `removeTabMark` the Paragraph dialog's tab list without one stop. Like `insertText`
// and `deleteText`, they act on the selection: a `target` is refused rather than guessed.

import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { RunFormatting } from '../contracts/types.ts';
import { paragraphTextOf } from '../store/store/paragraph-model-text.ts';
import { isCollaborationFailureCode } from '../collaboration/index.ts';
import { isMissingAuthorRefusal } from './docx-editor-author.ts';
import { FIELD_CODE_INPUT_REFUSAL } from './surface-field-code-input.ts';
import { MARKS, resolveMarkAttr, type CommandSupport } from './docx-editor-support.ts';
import { runWithHistoryGroup, takeHistoryGroup } from './history-group-scope.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';

type Command<T extends EditorCommand['type']> = Extract<EditorCommand, { type: T }>;
export type SelectionEditCommand = Command<
  'replaceText' | 'applyFormatting' | 'splitParagraph' | 'mergeParagraphs' | 'removeTabMark'
>;
type Refusal = Exclude<ExecResult, { ok: true }>;

const SELECTION_EDITS = new Set<string>([
  'replaceText',
  'applyFormatting',
  'splitParagraph',
  'mergeParagraphs',
  'removeTabMark',
]);

/** Whether `command` is one of the selection edits this module runs. */
export function isSelectionEditCommand(command: EditorCommand): command is SelectionEditCommand {
  return SELECTION_EDITS.has(command.type);
}

/** One run-property write `applyFormatting` makes. */
interface RunWrite {
  readonly localName: string;
  readonly attributes?: Record<string, string>;
}

/** What a `false` writes for each switch: the property stated off, so a style cannot add it back. */
const SWITCH_OFF: Record<string, RunWrite> = {
  bold: { localName: 'b', attributes: { val: '0' } },
  italic: { localName: 'i', attributes: { val: '0' } },
  underline: { localName: 'u', attributes: { val: 'none' } },
  strike: { localName: 'strike', attributes: { val: '0' } },
};
const RUN_KEYS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'superscript',
  'subscript',
  'color',
  'highlight',
  'fontFamily',
  'fontSizePt',
]);

/** The writes `marks` asks for, or the reason it cannot be applied. */
export function runWritesOf(marks: unknown): readonly RunWrite[] | string {
  if (typeof marks !== 'object' || marks === null) return 'applyFormatting requires marks';
  const writes: RunWrite[] = [];
  const formatting = marks as Record<string, unknown>;
  for (const key of Object.keys(formatting)) {
    if (formatting[key] === undefined) continue;
    if (!RUN_KEYS.has(key)) return `applyFormatting does not set '${key}'; it sets run formatting`;
  }
  const value = formatting as RunFormatting;
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    const flag = value[key];
    if (flag === undefined) continue;
    if (typeof flag !== 'boolean') return `applyFormatting requires ${key} to be a boolean`;
    writes.push(flag ? MARKS.get(key)! : SWITCH_OFF[key]!);
  }
  const { superscript, subscript } = value;
  for (const [key, flag] of [
    ['superscript', superscript],
    ['subscript', subscript],
  ] as const) {
    if (flag !== undefined && typeof flag !== 'boolean')
      return `applyFormatting requires ${key} to be a boolean`;
  }
  if (superscript === true && subscript === true)
    return 'applyFormatting cannot set superscript and subscript together';
  if (superscript === true || subscript === true)
    writes.push(MARKS.get(superscript ? 'superscript' : 'subscript')!);
  else if (superscript === false || subscript === false)
    writes.push({ localName: 'vertAlign', attributes: { val: 'baseline' } });
  if (value.color !== undefined) {
    const color = value.color as { kind?: unknown; value?: unknown };
    if (color?.kind !== 'hex') return 'applyFormatting supports hex colors only';
    const resolved = resolveMarkAttr({ mark: 'color', value: color.value });
    if (!resolved.ok) return resolved.reason;
    writes.push(resolved);
  }
  if (value.highlight !== undefined) {
    const resolved = resolveMarkAttr({ mark: 'highlight', value: value.highlight });
    if (!resolved.ok) return resolved.reason;
    writes.push(resolved);
  }
  if (value.fontFamily !== undefined) {
    const resolved = resolveMarkAttr({ mark: 'fontFamily', value: value.fontFamily });
    if (!resolved.ok) return resolved.reason;
    writes.push(resolved);
  }
  if (value.fontSizePt !== undefined) {
    const size = value.fontSizePt;
    const halfPoints = typeof size === 'number' ? size * 2 : NaN;
    const resolved = resolveMarkAttr({ mark: 'fontSize', value: halfPoints });
    if (!resolved.ok) return 'applyFormatting requires fontSizePt in half points from 1 to 1638';
    writes.push(resolved);
  }
  return writes.length > 0 ? writes : 'applyFormatting requires at least one mark';
}

/** The argument checks, shared by `can` and `exec`. */
export function classifySelectionEdit(command: SelectionEditCommand): CommandSupport {
  const invalid = (reason: string): CommandSupport => ({
    supported: false,
    code: 'invalidArgs',
    reason,
  });
  if ('target' in command && command.target !== undefined) {
    return {
      supported: false,
      reason: `DocTarget addressing is not supported; ${command.type} acts on the selection`,
    };
  }
  switch (command.type) {
    case 'replaceText':
      return typeof command.text === 'string'
        ? { supported: true, mutating: true }
        : invalid('replaceText requires text');
    case 'applyFormatting': {
      const writes = runWritesOf(command.marks);
      return typeof writes === 'string' ? invalid(writes) : { supported: true, mutating: true };
    }
    case 'removeTabMark':
      return Number.isInteger(command.positionTwips) &&
        command.positionTwips >= 0 &&
        command.positionTwips <= 31680
        ? { supported: true, mutating: true }
        : invalid('removeTabMark requires positionTwips as whole twips from 0 to 31680');
    default:
      return { supported: true, mutating: true };
  }
}

const collapsed = ({ anchor, head }: SemanticSelection) =>
  anchor.paragraphId === head.paragraphId && anchor.offset === head.offset;

/** A verb that reports nothing: unchanged revision means the document refused it. */
function verbRefusal(surface: PaginatedSurface, before: number, fallback: string): Refusal | null {
  if (surface.session.packageRevision() !== before) return null;
  return { ok: false, code: 'invalidArgs', reason: surface.state().lastRejection ?? fallback };
}

/** Bind one history group across several commits: the caller's, or one minted here. */
function grouped(surface: PaginatedSurface): <T>(commit: () => T) => T {
  const group = takeHistoryGroup(surface) ?? Symbol('selectionEdit');
  return (commit) => runWithHistoryGroup(surface, group, commit);
}

/**
 * A refused run format as a command result. A missing author or the generated table of
 * contents is the caller's to fix, as `insertText` reports it; a collaboration session that
 * is not ready is a retry, as the contract documents; anything else is a lock.
 */
export function runFormatRefusal(reason: string): Refusal {
  if (isCollaborationFailureCode(reason)) return { ok: false, code: 'unsupported', reason };
  const callerFixable =
    isMissingAuthorRefusal(reason) ||
    reason === 'the table of contents is generated and read-only' ||
    reason === FIELD_CODE_INPUT_REFUSAL;
  return { ok: false, code: callerFixable ? 'invalidArgs' : 'locked', reason };
}

/**
 * The paragraphs `mergeParagraphs` joins: the ones the selection spans, or the selection's
 * paragraph and the next one in its story.
 */
function mergeTargets(
  surface: PaginatedSurface,
  selection: SemanticSelection
): { ids: readonly string[]; scope: StoryScope } | string {
  const scope = storyScopeOfNodeId(surface.session, selection.head.paragraphId, {
    kind: 'body',
  });
  const order = surface.session.paragraphIdsIn(scope);
  const a = order.indexOf(selection.anchor.paragraphId);
  const b = order.indexOf(selection.head.paragraphId);
  if (a < 0 || b < 0) return 'mergeParagraphs joins paragraphs of a story, not of a text box';
  const first = Math.min(a, b);
  const last = a === b ? a + 1 : Math.max(a, b);
  if (last >= order.length) return 'there is no following paragraph to join';
  return { ids: order.slice(first, last + 1), scope };
}

/** Where a position in a joined paragraph lands once it is part of the first one. */
function joinedCarry(
  surface: PaginatedSurface,
  ids: readonly string[],
  scope: StoryScope
): (selection: SemanticSelection) => SemanticSelection {
  const head = ids[0]!;
  const starts = new Map<string, number>();
  let length = 0;
  for (const id of ids) {
    const part = partOfNodeId(surface.session, id);
    starts.set(id, length);
    length += (part && paragraphTextOf(part, id)?.length) || 0;
  }
  return (selection) => {
    // A tracked join keeps the paragraphs, proposing only the marks away.
    const remaining = new Set(surface.session.paragraphIdsIn(scope));
    const move = (position: SemanticPosition): SemanticPosition => {
      const start = starts.get(position.paragraphId);
      if (start === undefined || remaining.has(position.paragraphId)) return position;
      return { ...position, paragraphId: head, offset: start + position.offset };
    };
    return { anchor: move(selection.anchor), head: move(selection.head) };
  };
}

/** Run one admitted selection edit. */
export function execSelectionEdit(
  surface: PaginatedSurface,
  command: SelectionEditCommand
): ExecResult | null {
  const before = surface.session.packageRevision();
  switch (command.type) {
    case 'replaceText': {
      const selection = surface.state().selection;
      if (command.text.length === 0) {
        if (collapsed(selection)) return { ok: true, changed: false };
        surface.deleteSelection();
      } else {
        // The paste lane: one commit, newlines as paragraph boundaries, tracked when suggesting.
        surface.insertPlainText(command.text);
      }
      return verbRefusal(surface, before, 'the text could not be replaced here');
    }
    case 'applyFormatting': {
      const writes = runWritesOf(command.marks);
      if (typeof writes === 'string') return { ok: false, code: 'invalidArgs', reason: writes };
      // One commit for every mark, so the store accepts or refuses them together.
      const refused = grouped(surface)(() => surface.setRunProperties(writes));
      return refused ? runFormatRefusal(refused) : null;
    }
    case 'splitParagraph':
      surface.splitParagraph();
      return verbRefusal(surface, before, 'the paragraph could not be split here');
    case 'mergeParagraphs': {
      const targets = mergeTargets(surface, surface.state().selection);
      if (typeof targets === 'string') return { ok: false, code: 'notFound', reason: targets };
      const [first, ...rest] = targets.ids;
      const ops: TreeDocOp[] = rest.map((secondId) => ({
        op: 'joinParagraphs',
        firstId: first!,
        secondId,
      }));
      const carry = joinedCarry(surface, targets.ids, targets.scope);
      const result = grouped(surface)(() =>
        surface.applyAutomationOps(() => ops, targets.scope, undefined, false, carry)
      );
      if (!result.rejected) return null;
      const raw = String(result.reason ?? 'the paragraphs could not be joined');
      return {
        ok: false,
        code: raw === 'locked' ? 'locked' : 'invalidArgs',
        reason: surface.state().lastRejection ?? raw,
      };
    }
    case 'removeTabMark': {
      const stops = surface.formatting().tabStops;
      if (stops === null) {
        return {
          ok: false,
          code: 'ambiguous',
          reason: "the selection's paragraphs have different tab stops",
        };
      }
      const kept = stops.filter((stop) => stop.positionTwips !== command.positionTwips);
      if (kept.length === stops.length) {
        return {
          ok: false,
          code: 'notFound',
          reason: `there is no tab stop at ${command.positionTwips} twips`,
        };
      }
      if (surface.setParagraphFormat({ tabStops: kept })) return null;
      return {
        ok: false,
        code: 'invalidArgs',
        reason: surface.state().lastRejection ?? 'the tab stop could not be removed here',
      };
    }
  }
}
