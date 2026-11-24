import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { NoteKind } from '../store/package/note-nodes.ts';
import type { NoteReferenceLineBand } from './note-fragment-geometry.ts';
import type {
  LayoutNoteStoryOptions,
  NoteSeparatorLayout,
  NoteStoryLayout,
  NoteStoryLayoutCache,
} from './note-layout.ts';
import type { NotePaginationFallbackReason } from './note-pagination.ts';
import type { PageRefHit } from './note-ref-hit.ts';
import type { PageRecord } from './semantic-records.ts';

export interface NoteSeparatorCache {
  get(
    part: OoxmlPart | null | undefined,
    kind: 'separator' | 'continuationSeparator',
    contentWidth: number,
    noteKind: NoteKind,
    maxFlowHeightPt: number,
    opts: LayoutNoteStoryOptions,
    reasons: NotePaginationFallbackReason[]
  ): NoteSeparatorLayout;
}

export interface FootnoteAreaOptions {
  /**
   * When true, size the note stack against the content column (minus
   * {@link MIN_FOOTNOTE_BODY_BAND_PT}) instead of leftover body slack. Used by
   * reserve measurement so height is not clipped before body reflow.
   */
  readonly reserveColumnBudget?: boolean;
  /**
   * Band (content-relative pt) of each REFERENCE's own line
   * ({@link noteReferenceLineBandPt}). The BOTTOM keeps a note's first fragment on its
   * reference page: a budget that ignores where the reference sits evicts the
   * referencing line itself, and the reflow loop then chases the reference across pages
   * instead of converging. Per reference, because the stack tightens as it grows: note
   * `i` may fill down to reference `i`'s line, so an earlier note keeps its full room
   * while a later one whose line sits under the accumulated stack gets nothing — one
   * shared floor at the page's lowest reference strangles them all to the sliver under
   * it, stably. The TOP is where the reserve reaches when the note cannot even start in
   * that room. The reference moves when no legal note opening can remain below it.
   * Attach passes omit this callback and read the same reference band.
   */
  readonly reserveBandOf?: (ref: PageRefHit) => NoteReferenceLineBand;
  readonly separatorCache?: NoteSeparatorCache;
  /** Pass-local note story layouts shared with the hold-out (reserve mode). */
  readonly noteLayoutCache?: NoteStoryLayoutCache;
  /**
   * Whether the keep-whole eviction may fire (reserve mode). False when the NEXT page's
   * content geometry differs (a section boundary): the eviction guard measures the
   * destination with THIS page's column, and the hold-out refuses cross-geometry pages,
   * so an eviction there could never reach its fixed point — split instead.
   */
  readonly evictionAllowed?: boolean;
  readonly allowOrphanDeferral?: boolean;
  /** The next page (reserve mode): whether a table row ending this page continues there. */
  readonly nextPage?: PageRecord;
  /** Present only during the bounded second pass for an authored continuation notice. */
  readonly continuationNotice?: NoteStoryLayout;
}
