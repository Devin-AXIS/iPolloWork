import type { DocumentProperties, OoxmlNode } from '@docx-editor.dev/core/store';
import type { FieldResultsMode } from '../store/package/field-result-mode.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { FieldLinkProjector, HyperlinkProjector } from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { LayoutSession } from './layout-session.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { PageFurniture } from './page-furniture-insets.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { SectionColumns } from './section-properties.ts';
import type { SectionPageBorders } from './page-borders.ts';
import type { PageGeometry, TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/**
 * Everything a layout pass needs beyond the document itself.
 *
 * `measurer` is the only required field — layout is DOM-free and measures through whatever is
 * injected here, which is what lets the same code paginate on a server and in a browser.
 */
export interface SemanticLayoutOptions {
  readonly geometry?: PageGeometry;
  readonly measurer: TextMeasurer;
  /**
   * Reuse of measured-and-broken paragraphs across revisions (task 9.2).
   *
   * Only the BREAK is cached. Placement — y, fragments, page cuts — is always redone, so
   * an edit high in the document still repaginates everything below it while paragraphs
   * nobody touched are never measured again.
   */
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  /**
   * Collector for the cache keys a pass wants retained, instead of retaining directly.
   * Supplied by the multi-section orchestrator, which retains once over the union —
   * retaining per section evicted every other section's entries. `false` skips retention
   * for this pass entirely (the orchestrator strides sweeps). See
   * `retainLiveBreakKeys`.
   */
  readonly retainKeys?: Set<string> | false;
  /**
   * Part-level drawing projection/resource epoch for the section prepass memo.
   *
   * Moves whenever any drawing projection or resource state in the part does, standing in
   * for the per-paragraph drawing tokens the memo would otherwise have to recompute to
   * validate. A caller that supplies `drawingTokenForParagraph` without this epoch keeps
   * the recompute path — the memo must never miss a token move it cannot see.
   */
  readonly drawingLayoutEpoch?: string;
  /** Part-level freshness signal for paragraph-local semantic projection tokens. */
  readonly projectionEpoch?: string;
  /**
   * Who produced the measurements, folded into every cache key.
   *
   * A font arriving after first paint changes every advance in the document while no
   * content changes; without this the cache would serve the pre-font layout forever.
   */
  readonly producer?: string;
  /**
   * Incremental placement across revisions (task 9.3).
   *
   * Holds the previous complete layout and a flow checkpoint per paragraph, so a pass can
   * resume just before the first affected paragraph instead of re-placing the document from
   * the top, and can stop early when the flow reconverges with the previous run.
   *
   * Multi-section documents keep per-section child sessions on {@link LayoutSession.multi}.
   */
  readonly session?: LayoutSession;
  /** Header/footer stories to attach per page; absent means no furniture. */
  readonly furniture?: PageFurniture;
  /**
   * Which tracked revisions this pass resolves away (ECMA-376 §17.13).
   *
   * `all-markup` (the default) lays out both halves of every change. `proposed` lays out what
   * the document becomes if every change is accepted; `original` what it was before any of
   * them. Both are LAYOUT INPUTS: neither applies a `TreeDocOp` nor publishes a `ModelChange`,
   * so a user who switches to the proposed result, saves, and sends the file has not silently
   * accepted every proposal in it.
   */
  readonly displayMode?: RevisionDisplayMode;
  /** Reviewers whose revisions render as their accepted projection. */
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /**
   * Per-section furniture, index-aligned with `enumerateDocumentSections`.
   *
   * When present, multi-section layout attaches each section's own headers/footers (after
   * OOXML inheritance). `furniture` remains the single-section / last-section fallback.
   */
  readonly sectionFurniture?: readonly (PageFurniture | undefined)[];
  /**
   * `w:evenAndOddHeaders` from settings.xml. A section that restarts its page numbering then
   * aligns its continued numbering with the required break or restart parity. When absent,
   * layout reads the flag from the section furniture.
   */
  readonly evenAndOddHeaders?: boolean;
  /** Authored column count/gap for anchored `relativeFrom="column"` frame resolution. */
  readonly sectionColumns?: SectionColumns;
  /** Active section line-grid pitch: line-unit margins and line snapping. Absent: no grid. */
  readonly paragraphLineUnitPt?: number;
  /**
   * This section's resolved `w:pgBorders`, for the frame each of its sheets publishes.
   *
   * Section-scoped, not document-scoped: `w:display="firstPage"` means the first page of THIS
   * section, and multi-section layout hands each pass its own.
   */
  readonly sectionPageBorders?: SectionPageBorders;
  /**
   * Styles-part cascade table (docDefaults + `w:style` last-wins). Absent keeps direct
   * formatting only — the pre-cascade behaviour, used by unit tests that never open a
   * package.
   */
  readonly styleCascade?: StyleCascadeTable;
  /**
   * Projection of `/word/numbering.xml`. Absent keeps pre-list behaviour (no markers /
   * level indents). The index is immutable for a session; list counter state is derived
   * per layout pass from document order.
   */
  readonly numberingIndex?: NumberingIndex;
  /**
   * Optional precomputed list items for the body story. When absent and
   * {@link numberingIndex} is set, layout walks the full body (including table cells)
   * once so counters continue across section boundaries and table document order.
   */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /**
   * `w:settings/w:defaultTabStop` in points (ECMA-376 §17.15.1.25); absent keeps the 0.5"
   * schema default.
   *
   * It arrives as an option because the paragraph cascade cannot see `settings.xml`. A
   * metric-locale template declares 1134 twips (2cm) and every default-interval tab in the
   * document belongs on that grid. Constant for a session — the settings part is immutable
   * here — which is why the prepared-block memo does not key on it.
   */
  readonly defaultTabStopPt?: number;
  /** Explicit Word compatibility mode; absent retains existing geometry. */
  readonly compatibilityMode?: number;
  /**
   * Turns a typed `w:hyperlink` into the SANITIZED record its spans carry.
   *
   * An option because resolving `r:id` needs the package's relationships, which layout — a
   * per-part walk — cannot see. Absent means link runs still measure, break and paint;
   * they simply carry no link, so nothing is clickable and no text is lost. That is the
   * degradation a headless test or a furniture-only pass gets, and it is the safe one.
   */
  readonly projectLink?: HyperlinkProjector;
  /**
   * Turns a parsed HYPERLINK field instruction into the SANITIZED record its result carries.
   *
   * An option for the same reason as {@link projectLink}: the raw target must cross the
   * surface's href trust boundary, which layout cannot see. Absent means the field's cached
   * result still measures, breaks and paints — it simply is not clickable.
   */
  readonly projectFieldLink?: FieldLinkProjector;
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
  /**
   * How the pass addresses saved field results (DATE, MERGEFIELD, HYPERLINK display text, see
   * `FieldResultsMode`). `atomic` (the default) lays every field out as one model unit.
   * `editable` lays a saved result out as ordinary text at the offsets the store's editable
   * mode addresses, so a caret, a hit, and a selection inside it land on its characters. The
   * mode is folded into every cache key.
   */
  readonly fieldResults?: FieldResultsMode;
  /** @internal */
  readonly fieldCodeRanges?: import('./field-code-toc.ts').FieldCodeRanges;
  /** @internal Word TOC character-style suppression. */
  readonly tocLinkStyleRanges?: import('./toc-link-formatting.ts').TocLinkRanges;
  /**
   * The document's parsed metadata, for document-property fields (TITLE, AUTHOR, …). Read once
   * by the surface and shared across body, table, note and header/footer flows.
   */
  readonly documentProperties?: DocumentProperties;
  /**
   * Footnote/endnote layout input. When present, body layout projects note marks and a
   * post-pass attaches note areas (with bounded reflow for pageBottom reservation).
   */
  readonly notes?: import('./note-pagination.ts').NotesLayoutInput;
  /**
   * Per-page bottom reserves (points) subtracted from content height before line placement,
   * keyed by DOCUMENT page index. A section's pass reads its own slice through
   * `pageIndexStart`. Produced by the note reflow loop; absent means full content column.
   */
  readonly pageBottomReserves?: ReadonlyMap<number, number>;
  /**
   * `pageBottomReserves` index the pages of the previous pass, the seed a notes pass starts
   * from. A multi-section pass moves each section's entries by how far its first page moved,
   * so a section after an edit that added or removed pages sees the reserves it had.
   * @internal
   */
  readonly pageBottomReservesFromPreviousPass?: boolean;
  /**
   * With a seed: each page reads its reserve where its content stood in the previous pass, and
   * the pass reports what it read (`takeReadReserves`); see `note-reserve-search.ts`.
   * @internal
   */
  readonly pageBottomReservesFollowFlow?: boolean;
  /**
   * Lay out only the first this many body blocks: a round of the footnote reserve search,
   * which reads only the pages near the one it decides. The result is not published.
   * @internal
   */
  readonly noteRoundBlockLimit?: number;
  /**
   * One object for every round of one footnote reserve walk. Between such rounds only the
   * reserves and the block limit move, so a section with the same blocks, flow state and
   * reserves on its pages takes its result from the round before.
   * @internal
   */
  readonly noteRoundContext?: object;
  /** Derived note marks for body/note projection (provisional or final). */
  readonly noteMarks?: import('./note-projection.ts').NoteMarkContext;
  /** Inline drawing projection for typed `w:drawing` / `wp:inline` nodes. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /** Per-paragraph drawing projection/resource token for break cache keys. */
  readonly drawingTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Per-paragraph identity for projected links and live document-property text. */
  readonly projectionTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Memoized aggregate projection identity for an immutable table subtree. */
  readonly projectionTokenForTable?: (table: OoxmlNode) => string;
  /** @deprecated Prefer {@link drawingTokenForParagraph}. */
  readonly drawingLayoutToken?: string;
  /** Internal: reflow pass index; negative values establish anchor pages before backward wrap. */
  readonly drawingExclusionPass?: number;
  /** Internal: converged exclusion zones — skips the reflow loop when set with zones. */
  readonly drawingExclusionConverged?: boolean;
  /** Internal: exclusion zones from the prior reflow pass, keyed by page index. */
  readonly drawingExclusionZonesByPage?: ReadonlyMap<number, readonly ExclusionZone[]>;
  /** Canonical drawing traversal order within the owner story part. */
  readonly drawingSourceOrder?: ReadonlyMap<string, number>;
  /**
   * TOC instruction-only opening and ending chrome paragraph ids. Empty chrome suppresses
   * its placeholder line; opening paragraph marks after a separator remain visible result lines.
   * Tree nodes stay intact for refresh/save.
   */
  readonly tocFieldChromeParagraphIds?: ReadonlySet<string>;
  /**
   * Begin-paragraph ids of empty TOCs. These keep one layout line so paint can host an
   * identifiable empty-TOC furniture placeholder (overrides chrome suppression).
   */
  readonly emptyTocPlaceholderParagraphIds?: ReadonlySet<string>;
  /**
   * Empty result-paragraph ids inside empty TOCs. Suppressed like field chrome so blank
   * cached rows do not stack under the empty placeholder.
   */
  readonly emptyTocSuppressedResultParagraphIds?: ReadonlySet<string>;
  /**
   * Lay out only the first `bodyBlockLimit` body blocks. A large open lays out a growing
   * prefix in separate tasks, each pass resuming from the last, so the page stays
   * responsive; the final pass has no limit. @internal
   */
  readonly bodyBlockLimit?: number;
}
