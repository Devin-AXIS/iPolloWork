import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { noteIdOf } from '../store/package/note-nodes.ts';
import {
  findSpecialNote,
  layoutNoteCached,
  type LayoutNoteStoryOptions,
  type NoteLayoutFallbackReason,
  type NoteStoryLayout,
  type NoteStoryLayoutCache,
} from './note-layout.ts';
import { MIN_FOOTNOTE_BODY_BAND_PT } from './note-reserves.ts';
import type { NoteAreaRecord, NoteStoryRecord } from './semantic-records.ts';

/** Authored continuation notice, including the flow height of empty paragraphs. */
export function footnoteContinuationNotice(
  part: OoxmlPart | null,
  width: number,
  contentHeight: number,
  opts: LayoutNoteStoryOptions,
  cache?: NoteStoryLayoutCache,
  reasons?: { push(reason: NoteLayoutFallbackReason): unknown }
): NoteStoryLayout | undefined {
  if (!part) return undefined;
  const node = findSpecialNote(part, 'continuationNotice');
  const id = node ? noteIdOf(node) : null;
  if (id === null) return undefined;
  const laid = layoutNoteCached(part, id, width, opts, cache);
  if (!laid || laid.flowHeight <= 0) return undefined;
  // An unplaceable notice must not consume every overflow sheet without note progress.
  if (laid.fallbackReason || laid.flowHeight >= contentHeight - MIN_FOOTNOTE_BODY_BAND_PT) {
    reasons?.push('note-continuation-notice-height-cap');
    return undefined;
  }
  return laid;
}

/** Deferred notes without a fragment on this page do not acquire a notice here. */
export function hasContinuingNote(
  notes: readonly NoteStoryRecord[],
  carry: ReadonlyMap<string, unknown>
): boolean {
  return notes.some((note) => carry.has(note.scopeId));
}

export function placeContinuationNotice(
  notice: NoteStoryLayout | undefined,
  x: number,
  y: number,
  width: number
): Pick<NoteAreaRecord, 'continuationNotice'> {
  return notice
    ? {
        continuationNotice: {
          kind: 'continuationNotice',
          box: { x, y, width, height: notice.flowHeight },
          fragments: notice.fragments,
          synthetic: false,
        },
      }
    : {};
}
