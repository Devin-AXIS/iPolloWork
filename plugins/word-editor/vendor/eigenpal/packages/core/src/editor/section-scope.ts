// Which section a caret is in, for a caret in any story.
//
// Sections are a BODY structure: `w:sectPr` lives in the body flow and nowhere else, so a
// paragraph in a header, a footer or a note is in no section map at all. Answering `0` — or the
// tail section, the other easy wrong answer — is not merely a display error, because the reads
// that ask this question feed writes: the ruler's clamps, the grid width `insertTableOp` sizes
// from, and the `w:sectPr` the note-properties dialog writes back to. Three callers each
// guessed differently, so the answer lives here once.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { StoryScope } from '@docx-editor.dev/core/store';
import { bodyParagraphSectionIndexForSession } from './body-paragraph-section-index.ts';
import {
  enumerateDocumentSections,
  projectedSectionSourceIndexes,
} from '../layout/section-properties.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../layout/revision-projection.ts';
import { storyBlocks } from '../layout/story-roots.ts';
import { collectNoteReferences, resolveNotesPart } from '../store/package/note-references.ts';
import { noteIdOf, notesOf } from '../store/package/note-nodes.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { findNode } from '../store/package/ooxml-edit.ts';

/** Depth cap for the note-body walk, matching the shared tree-walk bound. */
const MAX_NOTE_WALK_DEPTH = 32;

/**
 * The section a paragraph belongs to, whichever story it is in.
 *
 * A body paragraph answers directly. A header or footer belongs to the section that names its
 * relationship — the OPEN one when the surface knows it, because inheritance lets several
 * sections share one header and the first to name it is not the page the reader is looking at.
 * A note belongs to the section holding its reference mark, which is a body paragraph.
 *
 * Returns `0` when nothing settles it, which is the first section rather than the tail: the
 * tail is the document-wide answer and is wrong for everything not on the last page.
 */
export function sectionIndexForCaret(
  session: TreeDocxSessionView,
  paragraphId: string,
  scope: StoryScope,
  openHeaderFooterSection?: number,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): number {
  const part = session.part();
  const sections = enumerateDocumentSections(part, displayMode, authorFilter);
  if (sections.length <= 1) return 0;
  const sourceIndexes = projectedSectionSourceIndexes(part, displayMode, authorFilter);
  const projectedIndexOf = (sourceIndex: number): number => {
    const exact = sourceIndexes.indexOf(sourceIndex);
    if (exact !== -1) return exact;
    const following = sourceIndexes.findIndex((candidate) => candidate > sourceIndex);
    return following === -1 ? Math.max(0, sourceIndexes.length - 1) : following;
  };

  // BODY content answers for itself, whatever story happens to be open. Consulting the open
  // scope first made `sectionPropertiesAt(id)` ignore its own argument for the whole time a
  // header was open, so every body paragraph reported the header's section.
  const bodyIndex = bodySectionIndexOf(session, paragraphId);
  if (bodyIndex !== null) return projectedIndexOf(bodyIndex);

  if (scope.kind === 'headerFooter') {
    if (openHeaderFooterSection !== undefined && sections[openHeaderFooterSection] !== undefined) {
      return openHeaderFooterSection;
    }
    const owning = session
      .headerFooterResolutionBySection()
      .findIndex((section) =>
        [section.headers, section.footers].some((slots) =>
          [...slots.values()].some((slot) => slot.rId === scope.rId)
        )
      );
    return owning === -1 ? 0 : projectedIndexOf(owning);
  }

  const referencing = referencingBodyParagraph(session, paragraphId);
  if (referencing !== null) {
    const viaReference = bodySectionIndexOf(session, referencing);
    if (viaReference !== null) return projectedIndexOf(viaReference);
  }
  return 0;
}

/**
 * How a section-addressed op should name the section a caret is in.
 *
 * `w:sectPr` lives on the body story, so the op can only name BODY content — and a caret in a
 * header or a note is not body content. The three answers are genuinely different, and
 * collapsing them to "a paragraph or `null`" is what let an unaddressable section quietly
 * become a document-wide write.
 */
export type SectionAnchor =
  /** Name this body paragraph. Its section is the one the caret is in. */
  | { readonly kind: 'anchor'; readonly paragraphId: string }
  /** One section: an anchor names nothing extra, so the op may omit it. */
  | { readonly kind: 'whole-document' }
  /**
   * Several sections, and the caret's holds no paragraph to name.
   *
   * An omitted anchor here would write EVERY section, which is what `scope: 'document'` is
   * for — so answering it to a `scope: 'section'` request changes sections nobody asked
   * about. There is no anchor that reaches an empty final section: one exists only when every
   * paragraph already closes an earlier section, so nothing sits at or after it.
   */
  | { readonly kind: 'unaddressable' };

/**
 * The anchor for the section `paragraphId` is in. See {@link SectionAnchor}.
 */
export function sectionAnchorParagraphFor(
  session: TreeDocxSessionView,
  paragraphId: string,
  scope: StoryScope,
  openHeaderFooterSection?: number,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): SectionAnchor {
  const part = session.part();
  const sections = enumerateDocumentSections(part);
  if (sections.length <= 1) return { kind: 'whole-document' };
  const sourceIndexes = projectedSectionSourceIndexes(part, displayMode, authorFilter);
  const own = bodySectionIndexOf(session, paragraphId);
  const projectedIndex = sectionIndexForCaret(
    session,
    paragraphId,
    scope,
    openHeaderFooterSection,
    displayMode,
    authorFilter
  );
  const sourceIndex = sourceIndexes[projectedIndex] ?? projectedIndex;
  if (own !== null && own === sourceIndex) return { kind: 'anchor', paragraphId };

  const section = sections[sourceIndex];
  if (!section) return { kind: 'unaddressable' };
  const blocks = storyBlocks(part);
  for (let i = section.blockStart; i < section.blockEndExclusive; i += 1) {
    const found = firstParagraphIn(blocks[i]);
    if (found !== null) return { kind: 'anchor', paragraphId: found };
  }
  // Neither a borrowed anchor nor none. Borrowing one from elsewhere in the body pins the
  // write to THAT paragraph's section — section 0, for the obvious choice — and omitting it
  // writes every section, which is what `scope: 'document'` already means. Both answer a
  // question the caller did not ask; only the refusal is true.
  return { kind: 'unaddressable' };
}

/** The first paragraph id anywhere under a block, tables and controls included. */
function firstParagraphIn(block: OoxmlNode | undefined): string | null {
  if (!block) return null;
  const walk = (node: OoxmlNode, depth: number): string | null => {
    if (node.kind === 'textValue' || depth > MAX_NOTE_WALK_DEPTH) return null;
    if (node.kind === 'paragraph') return node.id;
    for (const child of node.children) {
      const found = walk(child, depth + 1);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(block, 0);
}

/**
 * Every body paragraph's section, cached on the session until section structure changes.
 *
 * Warm text edits reuse the map because top-level block ids and section breaks stay
 * unchanged. Structural edits, section-property changes, undo, and redo publish new block
 * ids or section breaks and therefore rebuild safely.
 */
/** The section index of a BODY paragraph, or `null` when the body does not hold it. */
export function bodySectionIndexOf(
  session: TreeDocxSessionView,
  paragraphId: string
): number | null {
  return bodyParagraphSectionIndexForSession(session, session.part(), paragraphId);
}

/**
 * The body paragraph whose `w:footnoteReference` / `w:endnoteReference` cites the note that
 * holds `paragraphId`, or `null` when the id is not note content or nothing cites it.
 *
 * An orphaned note — one no reference points at — legitimately answers `null`. Word treats it
 * as unreachable content, and guessing a section for it would be inventing one.
 */
export function referencingBodyParagraph(
  session: TreeDocxSessionView,
  paragraphId: string
): string | null {
  const pkg = session.currentPackage();
  for (const noteKind of ['footnote', 'endnote'] as const) {
    const notesPart = resolveNotesPart(pkg, noteKind);
    if (!notesPart || !holdsNodeId(notesPart, paragraphId)) continue;
    for (const note of notesOf(notesPart.root)) {
      const noteId = noteIdOf(note);
      if (noteId === null || !holdsParagraph(note, paragraphId)) continue;
      const hit = collectNoteReferences(session.part()).find(
        (candidate) => candidate.noteKind === noteKind && candidate.noteId === noteId
      );
      return hit?.paragraphId ?? null;
    }
  }
  return null;
}

/**
 * Whether a part holds this node. A loaded id names its part, so a prefix answers. A logical id
 * from a collaboration session names none, so the part's node index answers.
 */
function holdsNodeId(part: OoxmlPart, nodeId: string): boolean {
  return nodeId.includes('#')
    ? nodeId.startsWith(`${part.name}#`)
    : findNode(part, nodeId) !== null;
}

/** Whether a subtree contains this paragraph id, within the shared depth cap. */
function holdsParagraph(root: OoxmlNode, paragraphId: string): boolean {
  const walk = (node: OoxmlNode, depth: number): boolean => {
    if (node.kind === 'textValue' || depth > MAX_NOTE_WALK_DEPTH) return false;
    if (node.kind === 'paragraph' && node.id === paragraphId) return true;
    for (const child of node.children) if (walk(child, depth + 1)) return true;
    return false;
  };
  return walk(root, 0);
}
