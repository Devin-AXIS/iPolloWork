import type { NoteMarkContext } from './note-projection.ts';
import type { NoteStoryLayoutCache } from './note-layout.ts';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { NoteKind } from '../store/package/note-nodes.ts';
import {
  layoutNoteSeparator,
  type LayoutNoteStoryOptions,
  type NoteSeparatorLayout,
} from './note-layout.ts';
import type { NotePaginationFallbackReason } from './note-pagination.ts';
import type { NoteSeparatorCache } from './note-footnote-area-options.ts';

/**
 * Pass-local cache for separator / continuationSeparator layouts.
 * Tall authored separators are expensive to re-measure on every drain page.
 */

export function createNoteSeparatorCache(): NoteSeparatorCache {
  const map = new Map<string, NoteSeparatorLayout>();
  return {
    get(part, kind, contentWidth, noteKind, maxFlowHeightPt, opts, reasons) {
      const partKey = part?.name ?? 'none';
      const key = `${partKey}\0${noteKind}\0${kind}\0${contentWidth}\0${maxFlowHeightPt}`;
      const cached = map.get(key);
      if (cached) return cached;
      const laid = layoutNoteSeparator(part, kind, contentWidth, opts, noteKind, maxFlowHeightPt);
      map.set(key, laid);
      if (laid.fallbackReason) reasons.push(laid.fallbackReason);
      return laid;
    },
  };
}

/** Fetch a separator and retain any bounded layout refusal. */
export function separatorLayoutOf(
  cache: NoteSeparatorCache | undefined,
  part: OoxmlPart | null | undefined,
  kind: 'separator' | 'continuationSeparator',
  contentWidth: number,
  noteKind: NoteKind,
  maxFlowHeightPt: number,
  opts: LayoutNoteStoryOptions,
  reasons: NotePaginationFallbackReason[]
): NoteSeparatorLayout {
  if (cache) return cache.get(part, kind, contentWidth, noteKind, maxFlowHeightPt, opts, reasons);
  const laid = layoutNoteSeparator(part, kind, contentWidth, opts, noteKind, maxFlowHeightPt);
  if (laid.fallbackReason) reasons.push(laid.fallbackReason);
  return laid;
}

/**
 * Note story layouts per mark-context identity. One reflow search shares one marks object
 * across all of its rounds, so each note lays out once per search; a new pass mints new
 * marks and the old cache is released with them.
 */
const noteStoryCachesByMarks = new WeakMap<NoteMarkContext, NoteStoryLayoutCache>();

export function noteStoryCacheFor(marks: NoteMarkContext): NoteStoryLayoutCache {
  let cache = noteStoryCachesByMarks.get(marks);
  if (!cache) {
    cache = new Map();
    noteStoryCachesByMarks.set(marks, cache);
  }
  return cache;
}
