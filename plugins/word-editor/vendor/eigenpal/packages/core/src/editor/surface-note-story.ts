// One footnote or endnote story for selection (ECMA-376 Part 1 §17.11).
//
// The editor opens ONE note for editing, so the frame, the label and the caret host have a
// note to name. The notes part is one story, though: a selection that starts in footnote 1
// extends across footnotes 2 to 5 by drag, Shift+click and Shift+arrow. These helpers widen
// the selection lanes from the open note to every note of its kind. Edits that would join two
// notes are refused (`crossNoteWriteRefusal`).

import type {
  BlockFragmentRecord,
  SemanticLayout,
  SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { TextMeasurer } from '@docx-editor.dev/core/layout';
import { hitTestFragments, pageAtY, type SemanticHit } from '../layout/semantic-hit-test.ts';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import type { NoteOps } from './surface-note-ops.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { notePagesIndexOf, noteScopeIndexOf } from './layout-paragraph-indexes.ts';

/** Refusal reason when an edit would remove the boundary between two notes. */
export const CROSS_NOTE_EDIT_REFUSAL = 'this is not a valid action for a selection across notes';

/** Whether two note scope ids name notes of the same kind, which form one story. */
export function sameNoteStory(a: string, b: string): boolean {
  if (a === b) return true;
  const left = parseNoteScopeId(a);
  const right = parseNoteScopeId(b);
  return left !== null && right !== null && left.noteKind === right.noteKind;
}

type NoteRecord = NonNullable<SemanticLayout['pages'][number]['footnotes']>['notes'][number];

export type NoteStoryHit = {
  readonly pageIndex: number;
  readonly scopeId: string;
  readonly local: { readonly x: number; readonly y: number };
  readonly fragments: readonly BlockFragmentRecord[];
};

/**
 * The note of the open story under a sheet point, for a selection gesture.
 *
 * A drag keeps extending when the pointer leaves the notes: past the last note, over the gap
 * between two notes or over the body above them, the point clamps to the nearest note of the
 * story on that page. Null when the page shows no note of the story.
 */
export function noteStoryHitAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number,
  scopeId: string
): NoteStoryHit | null {
  const page = layout.pages[pageAtY(layout, sheet.y)];
  if (!page) return null;
  const ox = pageOffsetX(page.index);
  let best: { note: NoteRecord; distance: number } | null = null;
  for (const area of [page.footnotes, page.endnotes]) {
    for (const note of area?.notes ?? []) {
      if (!sameNoteStory(note.scopeId, scopeId)) continue;
      const top = note.box.y;
      const bottom = top + note.box.height;
      const distance = sheet.y < top ? top - sheet.y : sheet.y >= bottom ? sheet.y - bottom : 0;
      if (!best || distance < best.distance) best = { note, distance };
    }
  }
  if (!best) return null;
  const { box } = best.note;
  const clamp = (value: number, size: number): number => Math.min(Math.max(value, 0), size);
  return {
    pageIndex: page.index,
    scopeId: best.note.scopeId,
    local: { x: clamp(sheet.x - box.x - ox, box.width), y: clamp(sheet.y - box.y, box.height) },
    fragments: best.note.fragments,
  };
}

/** The text position a selection gesture reaches in the open note story, or null. */
export function hitNoteStoryAtSheetPoint(
  host: {
    layout(): SemanticLayout;
    pageOffsetX(pageIndex: number): number;
    measurer(): TextMeasurer | undefined;
  },
  sheet: { readonly x: number; readonly y: number },
  scopeId: string
): SemanticHit | null {
  const layout = host.layout();
  const note = noteStoryHitAtSheetPoint(layout, sheet, (index) => host.pageOffsetX(index), scopeId);
  if (!note) return null;
  const measurer = host.measurer();
  return hitTestFragments(layout, note.pageIndex, note.fragments, note.local, {
    ...(measurer ? { measurer } : {}),
  });
}

/**
 * The painted note of the open story that holds a paragraph, and the page to show it on: the
 * preferred page when the paragraph paints there, else its first page. Reads the per-layout
 * indexes, so a caret move in a long document does not walk every page.
 */
export function noteOfParagraphInStory(
  layout: SemanticLayout,
  scopeId: string,
  paragraphId: string,
  preferredPageIndex?: number | null
): { readonly scopeId: string; readonly pageIndex: number } | null {
  const holder = noteScopeIndexOf(layout).get(paragraphId);
  const pages = notePagesIndexOf(layout).get(paragraphId);
  if (!holder || !pages?.length || !sameNoteStory(holder, scopeId)) return null;
  const pageIndex =
    preferredPageIndex != null && pages.includes(preferredPageIndex)
      ? preferredPageIndex
      : pages[0]!;
  return { scopeId: holder, pageIndex };
}

/**
 * Follow the selection head into the note that holds it.
 *
 * The open note names the frame, the label and the caret host, so it has to be the note, and
 * the page, the caret is on. `headPageIndex` is the page a pointer placed the head on; without
 * it the open note keeps its page while the head stays in it, which is what lets entry reveal
 * the note and arrows retarget its continuations themselves. A head outside the story changes
 * nothing.
 */
export function followNoteOfHead(
  layout: SemanticLayout,
  active: { readonly scopeId: string; readonly pageIndex: number | null },
  selection: SemanticSelection,
  retarget: (scopeId: string, pageIndex: number) => void,
  headPageIndex?: number
): void {
  const next = noteOfParagraphInStory(
    layout,
    active.scopeId,
    selection.head.paragraphId,
    headPageIndex ?? active.pageIndex
  );
  if (!next) return;
  const samePage = headPageIndex === undefined || next.pageIndex === active.pageIndex;
  if (next.scopeId === active.scopeId && samePage) return;
  retarget(next.scopeId, next.pageIndex);
}

/** {@link followNoteOfHead} for the surface's note ops, when a note is open. */
export function followOpenNoteToHead(
  notes: Pick<NoteOps, 'activeNoteScope' | 'activeNotePageIndex' | 'followNote'> | null,
  layout: SemanticLayout,
  selection: SemanticSelection,
  headPageIndex?: number
): void {
  const open = notes?.activeNoteScope();
  if (!notes || !open) return;
  const active = { scopeId: open.id, pageIndex: notes.activeNotePageIndex() };
  const retarget = (scopeId: string, pageIndex: number) => notes.followNote(scopeId, pageIndex);
  followNoteOfHead(layout, active, selection, retarget, headPageIndex);
}

/**
 * The refusal for an edit over a selection that spans two notes, or null.
 *
 * Typing, deletion and paste over such a range are refused. Deleting it would merge the notes or strand a reference mark. Formatting and
 * copy still work across notes, and do not ask this.
 */
export function crossNoteEditRefusal(
  layout: SemanticLayout,
  scopeId: string | null,
  selection: SemanticSelection
): string | null {
  if (!scopeId || selection.anchor.paragraphId === selection.head.paragraphId) return null;
  // Any two notes, of either kind: a host can set a range from a footnote into an endnote,
  // and that edit would address two parts at once.
  const index = noteScopeIndexOf(layout);
  const anchor = index.get(selection.anchor.paragraphId);
  const head = index.get(selection.head.paragraphId);
  return anchor && head && anchor !== head ? CROSS_NOTE_EDIT_REFUSAL : null;
}

/**
 * Ops a range across notes cannot take. Removing content would merge the notes or strand their
 * marks; a range marker (bookmark, comment, link, control) would open in one note and close in
 * another, which no later note edit keeps paired. An insertion replaces the range, so it is
 * refused with it: alone it means the removal was dropped, as for a range into an endnote.
 */
function crossesNotes(op: TreeDocOp): boolean {
  switch (op.op) {
    case 'insertText':
    case 'insertTab':
    case 'insertHardBreak':
    case 'insertPageBreak':
    case 'insertFragment':
    case 'insertDrawing':
    case 'insertTable':
    case 'insertEquation':
    case 'insertComplexField':
    case 'insertPageField':
    case 'insertBuildingBlock':
    case 'splitParagraph':
    case 'splitParagraphMany':
    case 'deleteText':
    case 'joinParagraphs':
    case 'deleteBlock':
    case 'deleteDrawing':
    case 'removeMathEquation':
    case 'proposeParagraphMerge':
    case 'replaceStoryBlocks':
    case 'insertBookmark':
    case 'insertCommentMarker':
    case 'insertHyperlink':
    case 'insertContentControl':
    case 'insertInlineContentControl':
      return true;
    case 'setParagraphMarkRevision':
      return op.kind === 'del';
    default:
      return false;
  }
}

/**
 * {@link crossNoteEditRefusal} for a write about to apply at the selection. Writes that insert,
 * remove or place a range marker refuse: typing, deletion, paste and cut. Formatting does none
 * of these, so bold or a style still applies across notes.
 */
export function crossNoteWriteRefusal(
  layout: SemanticLayout,
  scopeId: string | null,
  selection: SemanticSelection,
  ops: readonly TreeDocOp[]
): string | null {
  if (!scopeId || !ops.some(crossesNotes)) return null;
  return crossNoteEditRefusal(layout, scopeId, selection);
}

/**
 * Commands that replace the selection, so a cross-note selection refuses them before they run:
 * the gate and the write agree, and the control shows disabled rather than failing on press.
 */
const SELECTION_REPLACING_COMMANDS: ReadonlySet<string> = new Set([
  'cut',
  'deleteText',
  'replaceText',
  'splitParagraph',
  'mergeParagraphs',
  'paste',
  'pasteWithoutFormatting',
  'insertText',
  'insertBreak',
  'insertBookmark',
  'insertChart',
  'insertHyperlink',
  'insertImage',
  'insertPageField',
  'insertTable',
  'insertToc',
]);

/** Whether a command type replaces the selection, and so cannot run across notes. */
export function replacesSelection(commandType: string): boolean {
  return SELECTION_REPLACING_COMMANDS.has(commandType);
}

/** {@link crossNoteEditRefusal} for the surface's own selection, for gates that run before a write. */
export function surfaceCrossNoteRefusal(
  surface: Pick<PaginatedSurface, 'activeScope' | 'layout' | 'state'>
): string | null {
  const scope = surface.activeScope();
  if (scope.kind !== 'note') return null;
  return crossNoteEditRefusal(surface.layout(), scope.id, surface.state().selection);
}

/**
 * The paragraphs of the open note in `order`, or `order` itself outside a note.
 *
 * Selection spans the whole note story, but a collapsed Delete or Backspace at a note's edge,
 * and Tab between form controls, stay in the open note and never reach another note.
 */
export function withinOpenNote(
  layout: SemanticLayout,
  scopeId: string | null,
  order: readonly string[]
): readonly string[] {
  if (!scopeId) return order;
  const index = noteScopeIndexOf(layout);
  return order.filter((paragraphId) => index.get(paragraphId) === scopeId);
}
