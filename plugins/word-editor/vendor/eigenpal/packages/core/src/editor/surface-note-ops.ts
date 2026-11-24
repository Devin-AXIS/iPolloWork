// Footnote/endnote lifecycle ops for the paginated surface.
//
// Commits package-level note lifecycle ops through the session (one ModelChange /
// undo entry each). Entering a note scope rebinds StoryScope to notesPart + the
// focused note identity via EditorScope { kind: 'note', id }.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  segmentsOf,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type { ViewScope } from '../contracts/editor.ts';
import {
  findNoteById,
  formatNoteScopeId,
  isNormalNote,
  isNoteRefNode,
  notesOf,
  noteIdOf,
  parseNoteScopeId,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';

export interface NoteOps {
  insertNote(noteKind: NoteKind): boolean;
  deleteNote(noteKind: NoteKind, noteId: number): boolean;
  convertNote(fromKind: NoteKind, noteId: number): boolean;
  convertAllNotes(fromKind: NoteKind): boolean;
  setNoteProperties(args: {
    readonly scope: 'document' | 'section';
    readonly sectionIndex?: number;
    readonly footnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
    readonly endnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
  }): boolean;
  enterNote(
    scopeId: string,
    position?: { paragraphId: string; offset: number },
    pageIndex?: number
  ): boolean;
  exitNote(restoreBody?: boolean): void;
  activeNoteScope(): Extract<ViewScope, { kind: 'note' }> | null;
  activeNotePageIndex(): number | null;
  /**
   * Retarget the painted occurrence page while keeping the same note scope.
   * Used when arrow navigation crosses continuation pages.
   */
  setActiveNotePageIndex(pageIndex: number): void;
  /**
   * Make another note of the open story the open note, keeping the selection and the body
   * selection to restore. The selection head moved into it: notes of one kind are one story.
   */
  followNote(scopeId: string, pageIndex: number): void;
}

export function createNoteOps(deps: {
  session: TreeDocxSessionView;
  /** Close an open header or footer, because a note replaces it rather than nesting in it. */
  exitHeaderFooter?: () => void;
  applyOps: (
    ops: readonly TreeDocOp[],
    before?: { paragraphId: string; start: number; end: number } | null,
    after?: { paragraphId: string; start: number; end: number } | null
  ) => TreeApplyResult;
  commit: (
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  selection: () => SemanticSelection;
  selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  orderedStart: () => { paragraphId: string; offset: number };
  /**
   * The ops that remove the current selection, and the position left to insert at.
   *
   * `insertNote` used `orderedStart()` and deleted nothing, so a note inserted over a
   * selection left the words in place and put the reference in front of them — and the
   * restored range then covered the reference, so the next keystroke took the note with it.
   */
  deleteSelectionPlan: () => {
    readonly ops: readonly TreeDocOp[];
    readonly collapseTo: { paragraphId: string; offset: number };
  };
  /** Take the deletion back when the note it was making room for never arrived. */
  undo: () => void;
  activeScope: () => ViewScope;
  setActiveScopeBodyOrHf: (scope: ViewScope) => boolean;
  setSelection: (next: SemanticSelection) => void;
  noteModelMoved: () => void;
  render: () => void;
  revealNote: (scopeId: string) => number | null;
  notify: () => void;
  lastRejection: () => string | null;
  setLastRejection: (reason: string | null) => void;
}): NoteOps {
  let activeNote: Extract<ViewScope, { kind: 'note' }> | null = null;
  let activeNotePageIndex: number | null = null;
  let savedBodySelection: SemanticSelection | null = null;

  const commitLifecycle = (
    ops: TreeDocOp | readonly TreeDocOp[],
    selectionAfter?: () => SemanticSelection | null
  ): boolean => {
    deps.setLastRejection(null);
    deps.commit(() => {
      const result = deps.applyOps(Array.isArray(ops) ? ops : [ops], deps.selectionMark());
      if (result.rejected) {
        deps.setLastRejection(String(result.reason ?? 'rejected'));
      }
      return result;
    }, selectionAfter);
    return deps.lastRejection() === null;
  };

  const enterNote = (
    scopeId: string,
    position?: { paragraphId: string; offset: number },
    pageIndex?: number
  ): boolean => {
    const parsed = parseNoteScopeId(scopeId);
    if (!parsed) {
      deps.setLastRejection('invalid note scope id');
      return false;
    }
    const pkg = deps.session.currentPackage();
    const part = resolveNotesPart(pkg, parsed.noteKind);
    const note = part ? findNoteById(part.root, parsed.noteId) : null;
    if (!part || !note) {
      deps.setLastRejection('note not found');
      return false;
    }
    // A note and a header are not both open. `activeScope` answers with the NOTE when both are
    // set and `storyScope` answers with the HEADER, so every write routed to a store that has
    // never heard of the note's paragraphs — the edit vanished, with nothing refused. Clicking
    // a footnote reference while a header was open reached exactly this.
    deps.exitHeaderFooter?.();
    if (deps.activeScope().kind === 'body') {
      const current = deps.selection();
      savedBodySelection = {
        anchor: { paragraphId: current.anchor.paragraphId, offset: current.anchor.offset },
        head: { paragraphId: current.head.paragraphId, offset: current.head.offset },
      };
    }
    activeNote = {
      kind: 'note',
      id: formatNoteScopeId(parsed.noteKind, parsed.noteId),
    };
    activeNotePageIndex = Number.isInteger(pageIndex) ? pageIndex! : null;
    if (position) {
      deps.setSelection({ anchor: position, head: position });
    } else {
      const paragraphs = paragraphsOfNote(note);
      const ids = new Set(
        deps.session.paragraphIdsIn({ kind: 'notesPart', noteKind: parsed.noteKind })
      );
      const first = paragraphs.find((paragraph) => ids.has(paragraph.id));
      if (first) {
        const offset = firstEditableNoteOffset(first);
        deps.setSelection({
          anchor: { paragraphId: first.id, offset },
          head: { paragraphId: first.id, offset },
        });
      }
    }
    deps.noteModelMoved();
    deps.render();
    activeNotePageIndex ??= deps.revealNote(activeNote.id);
    deps.notify();
    return true;
  };

  return {
    insertNote(noteKind) {
      if (deps.activeScope().kind !== 'body') {
        deps.setLastRejection('insertNote requires body scope');
        return false;
      }
      // A note REPLACES the selection, like every other insert. Nothing deleted it before, so
      // the reference landed in front of the selected words and `enterNote` then froze that
      // pre-insert range as the exit target — one keystroke after coming back deleted the
      // reference, and the note itself was swept with it.
      //
      // TWO TRANSACTIONS, because a note is a package-level op and the session refuses to mix
      // one with story ops. That costs a second undo step for a replacement, which is the
      // cheaper of the two prices.
      const plan = deps.deleteSelectionPlan();
      // The plan's survivor, in the note op's own offset space — which counts what a reader
      // SEES, so struck text is not in it. That is what puts the reference after the words a
      // suggested deletion keeps, and where the removed words were in editing mode: one
      // answer for both, without the correction the text lanes need.
      const start = plan.collapseTo;
      const removed =
        plan.ops.length === 0 ||
        commitLifecycle(plan.ops, () => ({ anchor: { ...start }, head: { ...start } }));
      if (!removed) return false;
      const beforeIds = normalNoteIds(deps.session.currentPackage(), noteKind);
      const inserted = commitLifecycle(
        {
          op: 'insertNote',
          noteKind,
          paragraphId: start.paragraphId,
          offset: start.offset,
        } as TreeDocOp,
        // The reference occupies one model unit AT `start.offset`, so the caret belongs after
        // it — where Word leaves it, and where the next character has to go.
        () => {
          const after = { paragraphId: start.paragraphId, offset: start.offset + 1 };
          return { anchor: after, head: after };
        }
      );
      if (!inserted) {
        // A note is a package-level op, so it cannot share a transaction with the deletion
        // that made room for it. If it refuses, the words are already gone with nothing to
        // show for them — so the deletion goes back.
        if (plan.ops.length > 0) deps.undo();
        return false;
      }
      const afterIds = normalNoteIds(deps.session.currentPackage(), noteKind);
      const noteId = [...afterIds].find((id) => !beforeIds.has(id));
      return noteId === undefined ? true : enterNote(formatNoteScopeId(noteKind, noteId));
    },

    deleteNote(noteKind, noteId) {
      return commitLifecycle({ op: 'deleteNote', noteKind, noteId } as TreeDocOp);
    },

    convertNote(fromKind, noteId) {
      return commitLifecycle({ op: 'convertNote', fromKind, noteId } as TreeDocOp);
    },

    convertAllNotes(fromKind) {
      return commitLifecycle({ op: 'convertAllNotes', fromKind } as TreeDocOp);
    },

    setNoteProperties(args) {
      return commitLifecycle({
        op: 'setNoteProperties',
        scope: args.scope,
        sectionIndex: args.sectionIndex,
        footnote: args.footnote,
        endnote: args.endnote,
      } as TreeDocOp);
    },

    enterNote,

    exitNote(restoreBody = true) {
      if (!activeNote) return;
      const restore = savedBodySelection;
      activeNote = null;
      activeNotePageIndex = null;
      savedBodySelection = null;
      deps.setActiveScopeBodyOrHf({ kind: 'body' });
      if (restoreBody && restore) {
        deps.setSelection(restore);
      }
      deps.noteModelMoved();
      deps.render();
      deps.notify();
    },

    activeNoteScope() {
      return activeNote;
    },

    activeNotePageIndex() {
      return activeNotePageIndex;
    },

    followNote(scopeId, pageIndex) {
      const parsed = parseNoteScopeId(scopeId);
      const open = activeNote ? parseNoteScopeId(activeNote.id) : null;
      if (!parsed || !open || parsed.noteKind !== open.noteKind) return;
      activeNote = { kind: 'note', id: formatNoteScopeId(parsed.noteKind, parsed.noteId) };
      activeNotePageIndex = Number.isInteger(pageIndex) ? pageIndex : activeNotePageIndex;
    },

    setActiveNotePageIndex(pageIndex) {
      if (!activeNote || !Number.isInteger(pageIndex)) return;
      if (activeNotePageIndex === pageIndex) return;
      activeNotePageIndex = pageIndex;
    },
  };
}

function paragraphsOfNote(note: OoxmlNode): OoxmlParagraphNode[] {
  const paragraphs: OoxmlParagraphNode[] = [];
  const visit = (node: OoxmlNode, depth: number): void => {
    if (depth > 32) return;
    if (node.kind === 'paragraph') {
      paragraphs.push(node);
      return;
    }
    if ('children' in node) {
      for (const child of node.children) visit(child, depth + 1);
    }
  };
  visit(note, 0);
  return paragraphs;
}

/** The offset after a note paragraph's leading reference mark, or 0 without one. */
export function firstEditableNoteOffset(paragraph: OoxmlParagraphNode): number {
  const first = segmentsOf(paragraph)[0];
  return first && isNoteRefNode(first.node) ? first.end : 0;
}

function normalNoteIds(
  pkg: ReturnType<TreeDocxSessionView['currentPackage']>,
  noteKind: NoteKind
): ReadonlySet<number> {
  const part = resolveNotesPart(pkg, noteKind);
  const ids = new Set<number>();
  if (!part) return ids;
  for (const note of notesOf(part.root)) {
    if (!isNormalNote(note)) continue;
    const id = noteIdOf(note);
    if (id !== null) ids.add(id);
  }
  return ids;
}
