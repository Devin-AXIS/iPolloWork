// Read-only note-property state for adapter chrome — no tree mutation.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { enumerateDocumentSections, sectionPropertiesNodes } from '../layout/section-properties.ts';
import { sectionIndexForCaret } from './section-scope.ts';
import { storyScopeOfNodeId } from './surface-scope.ts';
import { storyBlocks } from '../layout/story-roots.ts';
import {
  authoredDocumentEndnoteProperties,
  authoredDocumentFootnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
  type AuthoredNoteProperties,
  type ResolvedEndnoteProperties,
  type ResolvedFootnoteProperties,
} from '../store/package/note-properties.ts';
import {
  isNormalNote,
  noteIdOf,
  notesOf,
  parseNoteScopeId,
  findNoteById,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import {
  layoutProjectionOf,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from '../layout/revision-projection.ts';

export type NotePropertiesSlice = {
  readonly resolved: ResolvedFootnoteProperties | ResolvedEndnoteProperties;
  readonly documentAuthored?: AuthoredNoteProperties;
  readonly sectionAuthored?: AuthoredNoteProperties;
};

export type NotePropertiesStateSnapshot = {
  readonly sectionIndex: number;
  readonly footnote: NotePropertiesSlice;
  readonly endnote: NotePropertiesSlice;
};

/** Hard cap for attacker-controlled note text exposed to hover chrome. */
export const MAX_NOTE_PREVIEW_CHARS = 500;

function sectionSectPrNodes(
  session: TreeDocxSessionView,
  sections: ReturnType<typeof enumerateDocumentSections>,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): readonly (import('../store/package/ooxml-tree.ts').OoxmlElement | undefined)[] {
  const part = session.part();
  return sectionPropertiesNodes(part, storyBlocks(part, displayMode, authorFilter), sections);
}

export function notePropertiesStateOf(
  surface: PaginatedSurface | null,
  authorFilter?: RevisionAuthorFilter
): NotePropertiesStateSnapshot | null {
  if (!surface) return null;
  const session = surface.session;
  const displayMode = layoutProjectionOf(surface.revisionDisplayMode());
  const paragraphId = surface.state().selection.head.paragraphId;
  const sectionIndex = sectionIndexForCaret(
    session,
    paragraphId,
    surface.activeScope().kind === 'headerFooter'
      ? { kind: 'headerFooter', rId: surface.headerFooterState()?.rId ?? '' }
      : storyScopeOfNodeId(session, paragraphId, { kind: 'body' }),
    surface.headerFooterState()?.sectionIndex,
    displayMode,
    authorFilter
  );
  const pkg = session.currentPackage();
  const settings = settingsPartOf(pkg);
  const docFnAuthored = authoredDocumentFootnoteProperties(settings);
  const docEnAuthored = authoredDocumentEndnoteProperties(settings);
  const sections = enumerateDocumentSections(session.part(), displayMode, authorFilter);
  const sectPrBySection = sectionSectPrNodes(session, sections, displayMode, authorFilter);
  const sectionFnAuthored = authoredFootnotePropertiesFromSectPr(sectPrBySection[sectionIndex]);
  const sectionEnAuthored = authoredEndnotePropertiesFromSectPr(sectPrBySection[sectionIndex]);

  // Footnote numbering and position ignore settings.xml; only the endnote position reads it.
  const footnoteResolved = resolveFootnoteProperties(sectionFnAuthored);
  const endnoteResolved = resolveEndnoteProperties(sectionEnAuthored, docEnAuthored);

  return {
    sectionIndex,
    footnote: {
      resolved: footnoteResolved,
      ...(docFnAuthored ? { documentAuthored: docFnAuthored } : {}),
      ...(sectionFnAuthored ? { sectionAuthored: sectionFnAuthored } : {}),
    },
    endnote: {
      resolved: endnoteResolved,
      ...(docEnAuthored ? { documentAuthored: docEnAuthored } : {}),
      ...(sectionEnAuthored ? { sectionAuthored: sectionEnAuthored } : {}),
    },
  };
}

export function listNormalNoteIds(
  session: TreeDocxSessionView,
  noteKind: NoteKind
): readonly number[] {
  const part = resolveNotesPart(session.currentPackage(), noteKind);
  if (!part) return [];
  return notesOf(part.root)
    .filter((note) => isNormalNote(note))
    .map((note) => noteIdOf(note))
    .filter((id): id is number => id !== null);
}

/** Plain text preview for a note scope id — safe for tooltip display. */
export function notePreviewTextOf(session: TreeDocxSessionView, scopeId: string): string | null {
  const parsed = parseNoteScopeId(scopeId);
  if (!parsed) return null;
  const part = resolveNotesPart(session.currentPackage(), parsed.noteKind);
  if (!part) return null;
  const notePart = part;
  const note = findNoteById(notePart.root, parsed.noteId);
  if (!note) return null;
  const chunks: string[] = [];
  let remaining = MAX_NOTE_PREVIEW_CHARS;
  const walk = (node: OoxmlNode, depth: number): void => {
    if (depth > 32 || remaining <= 0) return;
    if (node.kind === 'paragraph' && typeof node.id === 'string') {
      const text = (paragraphTextOf(notePart, node.id) ?? '').replace(/\uFFFC/g, '').trim();
      if (text) {
        const chunk = text.slice(0, remaining);
        chunks.push(chunk);
        remaining -= chunk.length;
      }
      return;
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(note, 0);
  const joined = chunks.filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : null;
}
