// Which story of a document a handle names.
//
// INTERNAL. A document is not one story: it is a body, a header and a footer per variant per
// section, and a story per footnote and endnote. They live in different PARTS, they have their own
// paragraph sets, and they commit through their own transaction scope — so "which story" is part
// of a handle's identity rather than context a caller supplies per call. A body handle that meant
// "whatever story the reader is in" would write a script's edit into a header because the user had
// clicked into one.
//
// A STORY IS NAMED BY WHAT THE DOCUMENT SAYS, never by a part name or a relationship id. A header
// is `(section, variant)`, which is how `w:sectPr` declares it and what a caller can compute from
// a section it already holds; a note is `(kind, w:id)`, which is what the reference in the story
// names. Part names and `r:id`s are resolved here, at the boundary, and never leave: a consumer
// holding one would be holding engine identity, and the next thing to arrive would be a second
// write path. It also keeps a handle meaningful across an edit that renames a part.

import type { HeaderFooterVariant } from '../store/package/hf-references.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';

/** The variants a section can declare furniture for. */
export const HEADER_FOOTER_VARIANTS: readonly HeaderFooterVariant[] = Object.freeze([
  'default',
  'first',
  'even',
]);

/**
 * Which story an operation acts on: the main body, one header/footer variant of one section, or
 * one note.
 *
 * A header is addressed by section INDEX plus variant rather than by relationship id, because
 * that is how a caller thinks about it and because a section inheriting its predecessor's header
 * has no relationship of its own to name.
 */
export type AutomationStoryId =
  | AutomationShapeOwnerStory
  | { readonly kind: 'note'; readonly noteKind: NoteKind; readonly noteId: number }
  /**
   * A text box: the `w:txbxContent` of the floating shape whose `wp:docPr/@id` is `shapeId`,
   * anchored in `owner`. Its paragraphs live in the owner's part and commit through its scope.
   */
  | {
      readonly kind: 'textbox';
      readonly owner: AutomationShapeOwnerStory;
      readonly shapeId: number;
    };

/** A story that can anchor shapes: the main body, or one header/footer variant of a section. */
export type AutomationShapeOwnerStory =
  | { readonly kind: 'body' }
  | {
      readonly kind: 'header' | 'footer';
      /** Position of the section in the document, from zero. */
      readonly sectionIndex: number;
      readonly variant: HeaderFooterVariant;
    };

/** Whether a story can anchor shapes. */
export function isShapeOwnerStory(story: AutomationStoryId): story is AutomationShapeOwnerStory {
  return story.kind === 'body' || story.kind === 'header' || story.kind === 'footer';
}

/** The main story, named once so nothing spells it twice. */
export const BODY_STORY: AutomationStoryId = Object.freeze({ kind: 'body' as const });

/**
 * A story's identity as one comparable string.
 *
 * For map keys and for handle stability: asking twice for the same story must yield the same
 * handle, and structural equality of two record literals does not do that.
 */
export function storyKey(story: AutomationStoryId): string {
  switch (story.kind) {
    case 'body':
      return 'body';
    case 'note':
      return `note:${story.noteKind}:${String(story.noteId)}`;
    case 'textbox':
      return `textbox:${storyKey(story.owner)}:${String(story.shapeId)}`;
    default:
      return `${story.kind}:${String(story.sectionIndex)}:${story.variant}`;
  }
}

/** Whether a value is a story id this lane will act on, checked as untrusted input. */
export function isStoryId(value: unknown): value is AutomationStoryId {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    kind?: unknown;
    sectionIndex?: unknown;
    variant?: unknown;
    noteKind?: unknown;
    noteId?: unknown;
    owner?: unknown;
    shapeId?: unknown;
  };
  if (candidate.kind === 'body') return true;
  if (candidate.kind === 'textbox') {
    return (
      isStoryId(candidate.owner) &&
      isShapeOwnerStory(candidate.owner) &&
      Number.isInteger(candidate.shapeId) &&
      (candidate.shapeId as number) >= 0
    );
  }
  if (candidate.kind === 'note') {
    return (
      (candidate.noteKind === 'footnote' || candidate.noteKind === 'endnote') &&
      Number.isInteger(candidate.noteId)
    );
  }
  if (candidate.kind !== 'header' && candidate.kind !== 'footer') return false;
  return (
    Number.isInteger(candidate.sectionIndex) &&
    (candidate.sectionIndex as number) >= 0 &&
    HEADER_FOOTER_VARIANTS.includes(candidate.variant as HeaderFooterVariant)
  );
}

/**
 * Whether a story is one root among several in its part: a note in the notes part, or a text
 * box in its owner's part. Part-wide work for such a story must be scoped to its own root.
 */
export function sharesItsPart(story: AutomationStoryId): boolean {
  return story.kind === 'note' || story.kind === 'textbox';
}
