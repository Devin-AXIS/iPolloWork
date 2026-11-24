// The read/write contract every editor surface holds a session by.
//
// Extracted from tree-session.ts so the session module stays under its line budget; the
// binding-only extension (TreeDocxSession, which exchanges ProseMirror projections) stays
// there. tree-session.ts re-exports both names, so existing imports resolve unchanged.

import type {
  BookmarkIndex,
  EmbeddedFont,
  HeaderFooterParts,
  HeaderFooterSectionResolution,
  HeadlessDocumentView,
  ListDefinitionGeometry,
  ListKind,
  OoxmlElement,
  OoxmlPackage,
  OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { ReviewItem } from '../store/store/review-items.ts';
import type {
  SelectionMark,
  TreeModelChange,
  TransactOptions as TreeTransactOptions,
} from '../store/store/tree-store.ts';
import type { StoryScope, StoryTargetRejection } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import type { TreeBindingRejection } from './tree-binding.ts';
import type { CollaborationDocumentPort } from '../collaboration/replication.ts';
import type {
  CustomNodeSweepOutcome,
  CustomNodeWriteResult,
  InsertCustomNodeWrite,
} from '../store/store/custom-node-writes.ts';
import type { DocumentStyleEntry } from './document-catalog.ts';
import type { DocumentThemeColorEntry, DocumentThemeFonts } from './document-theme.ts';
import type { DocumentOutlineEntry } from './document-outline.ts';
import type { DocumentSearchOptions, DocumentSearchResult } from './document-search.ts';
import type { ParagraphAnchorIndex } from './paragraph-anchors.ts';
import type { RunPropertyLike, StyleRunDefaults } from './document-run-defaults.ts';
import type { DocumentTrackingSettings } from '../store/package/tracking-settings.ts';
import type { DocumentProperties } from '../store/package/document-properties.ts';
import type { HistoryGroup } from '../store/store/history-group.ts';

/**
 * What applying ops produced: whether it committed, and why not when it did not.
 *
 * `committed` and `rejected` are separate flags because they are not opposites — a batch of zero
 * ops neither commits nor is rejected.
 */
export interface TreeApplyResult {
  readonly committed: boolean;
  readonly rejected: boolean;
  readonly opCount: number;
  /** Present when the edit was refused, so a host can report WHY rather than a silent no-op. */
  readonly reason?: TreeBindingRejection | StoryTargetRejection | string;
}

/** Optional collaboration attribution and history grouping for a direct tree-op transaction. */
export type TreeApplyOptions = Pick<
  TreeTransactOptions,
  'origin' | 'actorId' | 'operationId' | 'recordsHistory'
> & {
  /** The store token of the commit's history group, as `commitReviewOps` hands it over. */
  readonly historyToken?: HistoryGroup;
  /** @deprecated Use `historyToken`, the same store token under its one name. */
  readonly historyGroup?: HistoryGroup;
  /** Package resources committed in the same transaction as the tree operations. */
  readonly packageEdits?: readonly ((pkg: OoxmlPackage) => OoxmlPackage)[];
  /** Canonical operations on related package parts, committed in the same undo unit. */
  readonly partOps?: readonly { readonly partName: string; readonly ops: readonly TreeDocOp[] }[];
};

/** History grouping for a comment or custom-node write: frames of one group share one undo step. */
export interface PackageWriteOptions {
  /** The store token of the commit's history group, as `commitReviewOps` hands it over. */
  readonly historyToken?: HistoryGroup;
}

/**
 * One open document: the canonical tree, and the only write path into it.
 *
 * `applyTreeOps` is that path. Every mutation is a `TreeDocOp` addressed by node id plus UTF-16
 * offset, applied in one transaction, which is what makes cell and nested paragraphs ordinary
 * rather than special cases.
 *
 * Holds the whole package, not just the body — headers, footers, notes, comments and styles are
 * all reachable through it, and parts the engine does not model are preserved verbatim.
 */
export interface TreeDocxSessionView extends HeadlessDocumentView {
  /** Whether the body holds at least one editable paragraph. */
  readonly editable: boolean;
  /** Canonical node ids of the body paragraphs, in order. */
  paragraphIds(): string[];
  /**
   * Canonical node ids of paragraphs in a story scope. Defaults to the body.
   * Header/footer scopes address the part `EditorScope { kind: 'headerFooter'; rId }` names.
   */
  paragraphIdsIn(scope?: StoryScope): string[];
  /** The current canonical BODY part — what layout reads for the main story. */
  part(): OoxmlPart;
  /** The current part for a story scope, or null when the target is refused. */
  partFor(scope: StoryScope): OoxmlPart | null;
  /**
   * The current package with every opened story store merged in. Authority for layout
   * resolution and save — never a swapped single-part view.
   */
  currentPackage(): OoxmlPackage;
  /**
   * Commit typed tree ops directly, as ONE transaction.
   *
   * The paginated surface has no ProseMirror doc to diff, so it addresses the model the way
   * the ops already do — by node id and offset — rather than round-tripping an edit through
   * a projection just to have it diffed back out.
   *
   * `scope` defaults to the body. Pass `{ kind: 'headerFooter', rId }` to target an existing
   * header/footer part; the transaction publishes one ModelChange (HF → `global` impact)
   * and one undo unit without swapping the body store.
   */
  applyTreeOps(
    ops: readonly TreeDocOp[],
    selectionBefore?: SelectionMark | null,
    selectionAfter?: SelectionMark | null,
    scope?: StoryScope,
    options?: TreeApplyOptions
  ): TreeApplyResult;
  /**
   * Commit several stories' ops as ONE transaction and ONE undo unit.
   *
   * `applyTreeOps` addresses one story; a write that must land in the body AND note parts
   * together — the save-time field-result refresh — needs all-or-nothing semantics, or a
   * mid-sequence refusal exports a file mixing refreshed and stale values and a single undo
   * restores only the last part. Any refusal rolls every group back. Lifecycle ops refuse.
   */
  applyTreeOpsAtomic(
    groups: readonly { readonly scope: StoryScope; readonly ops: readonly TreeDocOp[] }[],
    options?: TreeApplyOptions
  ): TreeApplyResult;
  /**
   * Every part that holds a story, body first, then headers, footers and note parts.
   *
   * A READ: parts come from the package, so this opens no story store and spends none of the
   * 64 editable-store slots. Use it for any query that must answer about the whole document
   * rather than about the caret — an enumeration that reads only the body reports a document
   * the reader is not looking at.
   */
  storyParts(): readonly OoxmlPart[];
  /** Body text, paragraphs joined by newlines, read from the CANONICAL tree. */
  bodyText(): string;
  /** Text of a story scope, paragraphs joined by newlines. */
  storyText(scope: StoryScope): string | null;
  /** Body-store revision (independent of header/footer store revisions). */
  revision(): number;
  /** Per-story revision, or null when the target is refused. */
  revisionFor(scope: StoryScope): number | null;
  /** Package-wide revision — bumps on any story commit (body or HF). */
  packageRevision(): number;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Undo the last entry, returning the selection to restore.
   *
   * The selection is part of the entry, not something a host can recompute: after undoing a
   * split the caret belongs where the user was typing, and offsets in the reverted tree do
   * not correspond to offsets in the one that replaced it. `null` means nothing was undone
   * or the entry recorded no selection.
   */
  undo(): SelectionMark | null;
  redo(): SelectionMark | null;
  beginComposition(scope?: StoryScope): void;
  endComposition(): void;
  subscribe(onChange: (change: TreeModelChange) => void): () => void;
  /** Narrow provider-neutral attachment over this session's canonical package store. */
  collaborationPort(documentId: string): CollaborationDocumentPort;
  /** Serialize the whole package back to DOCX bytes. */
  save(): Uint8Array;
  /**
   * {@link save} in steps a caller can pause between. The package is captured at the call, so
   * the bytes describe the document as it was then, whatever happens between steps.
   */
  saveSteps(): Generator<void, Uint8Array>;
  /**
   * The resolved header/footer parts of the section, by variant (phase 2).
   *
   * Returns the FINAL section's effective parts after OOXML inheritance. Prefer
   * `headerFooterPartsBySection` for multi-section pagination.
   *
   * Re-resolved after any package revision so an edited shared part is visible everywhere
   * it is attached.
   */
  headerFooterParts(): HeaderFooterParts;
  /**
   * Per-section header/footer parts after OOXML inheritance, index-aligned with
   * `enumerateDocumentSections`.
   */
  headerFooterPartsBySection(): readonly HeaderFooterParts[];
  /**
   * Per-section resolution with declared-vs-inherited metadata for "Same as previous"
   * chrome. Index-aligned with `headerFooterPartsBySection`.
   */
  headerFooterResolutionBySection(): readonly HeaderFooterSectionResolution[];
  /**
   * Font family names the document uses, from every `w:rFonts` in the CURRENT main
   * part plus the styles and header/footer parts — validated, deduplicated, sorted.
   * Memoized per package revision.
   */
  documentFonts(): readonly string[];
  /**
   * Font families the document's RENDERED text resolves to, over the story roots only:
   * direct run `w:rFonts` of text-bearing runs plus the style chains those runs,
   * paragraphs and tables actually reference — never a declaration in an unused style.
   * Memoized per package revision.
   *
   * The font-substitution notice reads this one: `documentFonts` reports what the
   * document DECLARES, and Word writes latent styles (Balloon Text naming Segoe UI)
   * into documents that never render a character in them.
   */
  renderedFontFamilies(): readonly string[];
  /**
   * Font families named by a `w:sym/@w:font`, over the same roots
   * {@link TreeDocxSessionView.documentFonts} reads. Memoized per package revision.
   *
   * Separate from both other answers on purpose. It is not a DECLARATION, so it does not
   * join `documentFonts`, and it is not a face TEXT renders in, so the substitution notice
   * reports it only for a private-use glyph with no Unicode equivalent
   * (`editor/unmapped-symbol-faces.ts`) — but a font resolver has to hear about it, or an
   * app cannot supply the face such a glyph needs.
   */
  symbolFontFamilies(): readonly string[];
  /**
   * Whether the document puts any literal character on a page, over the same roots
   * {@link TreeDocxSessionView.documentFonts} reads. Memoized per package revision.
   *
   * The font-substitution notice needs it: `documentFonts` reports what the document
   * DECLARES, and a brand-new document declares Word's Calibri default over a single
   * empty paragraph — a declaration with no glyph behind it.
   */
  rendersText(): boolean;
  /** Validated style-picker projection. A document without styles answers `[]`. */
  documentStyles(): readonly DocumentStyleEntry[];
  /** Current styles root for layout, or `null` when the package has no styles part. */
  stylesRoot(): OoxmlElement | null;
  /**
   * The theme part's Latin typefaces, for resolving `w:rFonts` theme references in layout.
   *
   * Memoized once: theme editing is a later slice. A document with no theme part answers
   * `{ major: null, minor: null }`, which leaves every theme reference on the explicit
   * font name beside it.
   */
  documentThemeFonts(): DocumentThemeFonts;
  /**
   * Root of the numbering part tree (`w:numbering`), for list layout. Memoized once;
   * `null` when the package has no numbering part. Numbering editing is a later slice.
   */
  numberingRoot(): OoxmlElement | null;
  /**
   * Root of the settings part tree (`w:settings`), for document-wide layout constants such
   * as `w:defaultTabStop`. Memoized once; `null` when the package has no settings part.
   * Settings editing is a later slice, so this is immutable for the session.
   */
  settingsRoot(): OoxmlElement | null;
  /**
   * The document's own metadata from `docProps/core.xml` and `docProps/app.xml`, for
   * document-property fields (TITLE, AUTHOR, SUBJECT, KEYWORDS, LASTSAVEDBY, COMMENTS). Read
   * once per package revision; an empty object when the parts are absent.
   */
  documentProperties(): DocumentProperties;
  /**
   * What `settings.xml` says about tracking — `w:trackRevisions`, the tracked-changes
   * protection, and the two do-not-track switches.
   *
   * Read from the document rather than assumed, because Word records the tracking state on
   * the FILE: a package that asks to be edited as tracked changes, presented as an ordinary
   * editable one, takes its first keystroke as an untracked edit.
   */
  trackingSettings(): DocumentTrackingSettings;
  /**
   * The theme's ten picker colours (`a:clrScheme`), in Word's column order, or `[]`
   * when the package has no complete scheme. Memoized once: the theme part is
   * immutable for the session's lifetime.
   */
  documentThemeColors(): readonly DocumentThemeColorEntry[];
  /**
   * The run formatting a paragraph's content INHERITS when it authors none: the
   * paragraph style's `basedOn` chain, then `w:docDefaults`, with theme `rFonts`
   * attributes resolved through the font scheme. `runProperties` (the span's own
   * authored properties) lets a theme-only run-level `w:rFonts` resolve too. This is
   * what lets a toolbar always show the effective font, the way Word does.
   */
  effectiveRunDefaults(
    paragraphId: string,
    runProperties?: readonly RunPropertyLike[]
  ): StyleRunDefaults;
  /**
   * The heading outline of the BODY story, in document order: paragraphs whose
   * `w:pStyle` resolves to a heading through the styles part (built-in `heading N`
   * name, or the style's own `w:outlineLvl` 0..8). Memoized per main-part revision —
   * an edit can retitle, add or remove a heading, but the styles part cannot change
   * in-session.
   */
  documentOutline(): readonly DocumentOutlineEntry[];

  /**
   * Every pending review decision in the document, memoized per revision.
   *
   * Derived from the canonical TREE — the queue is a property of the document, and one derived
   * from laid-out spans empties by half whenever the reader switches to a resolved view.
   */
  reviewItems(): readonly ReviewItem[];

  /**
   * Whether the document carries review content — tracked changes or comment
   * anchors — regardless of any review module. Derived from store vocabulary
   * only (never the review model), memoized per revision: it is the free
   * tier's honest "this document has more than you are seeing" signal.
   */
  hasReviewContent(): boolean;

  /**
   * Reply to a comment, or add one over a revision's range. Returns the new comment's id.
   *
   * `scope` names the story the anchor lives in and defaults to the body. A header or
   * footer anchor written against the body store addresses a paragraph that store has
   * never heard of, so the transaction is refused and the reply is lost — which is what
   * replying to a header card did.
   */
  replyToComment(
    parentCommentId: string | null,
    anchor: { paragraphId: string; start: number; end: number; endParagraphId?: string },
    text: string,
    author: string,
    /** ISO-8601. Omitted writes no `@w:date`, because inventing one is a content change. */
    date?: string,
    scope?: StoryScope,
    /** Binds id allocation to one actor, so two peers cannot mint the same comment id. */
    actorId?: string,
    options?: PackageWriteOptions
  ): string | null;
  /**
   * Resolve a comment thread, or reopen it. False when the document holds no such comment.
   *
   * The same package transaction shape as a reply, and for the same reason: `@w15:done` lives in
   * `commentsExtended.xml`, a part a document with no thread does not have, so the state and the
   * part that records it commit together.
   */
  setCommentResolved(commentId: string, resolved: boolean, options?: PackageWriteOptions): boolean;
  /**
   * Replace the text of one comment or reply. False when the document holds no such comment, or
   * when the write was refused.
   *
   * Only the body changes: the id, author, date, thread state, replies and range markers stay, so
   * the comment keeps its place in its thread in Word.
   */
  setCommentText(commentId: string, text: string, options?: PackageWriteOptions): boolean;
  /** Replace several validated comment bodies in one package transaction. */
  setCommentTexts(
    edits: readonly { readonly commentId: string; readonly text: string }[],
    options?: PackageWriteOptions
  ): boolean;
  /**
   * Delete a comment thread outright — body, thread state and story markers.
   *
   * A THREAD, like resolving one: a reply whose parent is gone has nothing left to answer.
   * `scope` names the owning story and defaults to the body; `noteId` names one note inside a
   * shared notes part. False when the document holds no such comment, or when the removal was
   * refused.
   */
  deleteComment(
    commentId: string,
    scope?: StoryScope,
    noteId?: number,
    options?: PackageWriteOptions
  ): boolean;
  /**
   * Delete several comment objects as one package transaction and one undo unit.
   *
   * A root removes its thread; a reply removes only itself and reparents any foreign nested
   * descendants to its parent. Marker stripping is scoped to `scope` / `noteId`.
   */
  deleteComments(
    comments: readonly { readonly commentId: string; readonly parentCommentId?: string }[],
    scope?: StoryScope,
    noteId?: number,
    options?: PackageWriteOptions
  ): boolean;
  /**
   * Insert a custom node, with the payload it carries, as ONE transaction.
   *
   * A package write reaching through the body store, exactly as a comment is: the customXml data
   * part, the node inside it and the bound `w:sdt` commit together or not at all. A control bound
   * to a store that was never written is a document Word offers to repair.
   *
   * Omitting the payload authors the ordinary tagged control, which is what a node small enough
   * to live in its `w:tag` needs.
   */
  /** `scope` names the story the paragraph is in, and defaults to the body. */
  insertCustomNode(
    write: InsertCustomNodeWrite,
    scope?: StoryScope,
    options?: PackageWriteOptions
  ): CustomNodeWriteResult;
  /**
   * Remove a custom node and, in the same transaction, the payload it bound.
   *
   * The sweep would collect the payload on the next open regardless; doing it here means a
   * document saved between the deletion and that open does not carry a payload for a chip that
   * is gone.
   */
  /**
   * Remove a custom node and the payload it bound. `scope` names the story holding it and
   * defaults to the body; a chip in a header is refused against the body store.
   */
  removeCustomNode(controlNodeId: string, scope?: StoryScope): CustomNodeWriteResult;
  /**
   * Drop every payload no control binds, in the stores whose namespaces a module claims.
   *
   * Called ON OPEN and nowhere else — see `sweepCustomNodePayloads`. Answers the ids collected,
   * so a host can report what a document arrived carrying.
   */
  sweepCustomNodePayloads(namespaces: readonly string[]): CustomNodeSweepOutcome;
  /**
   * Every occurrence of `query` across editable stories, in navigation order. Each match uses
   * the same offset vocabulary as tree operations and surface selections.
   *
   * Memoized one deep, keyed on the package revision AND the question asked: a find panel asks the
   * same question on every tick, and a different query replaces the entry rather than
   * growing a cache the session would have to bound.
   */
  findText(query: string, options?: DocumentSearchOptions): DocumentSearchResult;
  /** Many queries in one walk of the document, one result per query in the same order. */
  findText(
    queries: readonly string[],
    options?: DocumentSearchOptions
  ): readonly DocumentSearchResult[];
  /**
   * The faces the package EMBEDS (`word/fontTable.xml` embed relationships),
   * deobfuscated — the only font source that needs neither a substitute nor a network.
   * Extraction asserts nothing about validity; admitting a face is the font resource
   * lane's job. Memoized once: the font table and font parts are immutable in-session.
   */
  embeddedFonts(): readonly EmbeddedFont[];
  /**
   * The `w:numId` of a bullet or numbered list definition, creating one where the document
   * has none — including `numbering.xml` itself, its relationship and its content type.
   *
   * A document Word has never numbered carries no numbering part at all, so the first
   * bullet a user asks for has to bring the whole definition with it. An existing
   * definition of the same kind is reused rather than duplicated.
   */
  /**
   * What the owning part's relationships answer for one `r:id` under `scope` (default:
   * body): the authored target and whether it is external. `null` for an id the part does
   * not declare, or when the scoped part is not open.
   *
   * Live rather than memoized: inserting a link mints a relationship mid-session, and a
   * cached resolver would report the link this session just created as dangling.
   */
  relationshipTarget(
    relationshipId: string,
    scope?: StoryScope
  ): { readonly target: string; readonly external: boolean } | null;
  /**
   * `bookmarkName -> { paragraphId, offset }` over the main part, memoized per revision.
   *
   * What an internal hyperlink's `w:anchor` resolves through. Keyed on the store revision
   * because an edit can move, split or delete the paragraph a bookmark sits in.
   */
  bookmarks(): BookmarkIndex;
  /**
   * The relationship id for an external hyperlink target on the part owning `scope`
   * (default: body), minting one if that part has none, or `null` when the URL is refused
   * or the scoped part cannot be resolved.
   *
   * Lives on the PACKAGE, outside `store.transact`, like the numbering definitions: the
   * undoable half is the tree op that names the id. An unreferenced relationship left
   * behind by an undo is inert and is what Word writes anyway. Scoped inserts mint onto
   * the story's own `.rels` so a header/footer or note link never creates a stray body
   * relationship.
   */
  ensureHyperlinkRelationship(url: string, scope?: StoryScope): string | null;
  /**
   * Find or create a `kind` list definition and answer the `w:numId` to name, or `null`.
   *
   * With `geometry`, the definition keeps those level positions, so an item switching
   * between bullets and numbers stays where it was.
   */
  ensureListDefinition(kind: ListKind, geometry?: ListDefinitionGeometry): string | null;
  /**
   * Declare `level` in the list definition `numId` names, with Word's default format for
   * that depth, or answer false.
   *
   * Word never greys Increase Indent out on a list item: demoting past the deepest level
   * a definition declares makes Word define the level, cycling its stock bullets and
   * number formats. An already-declared level answers true without changing anything.
   *
   * The declaration lives on the PACKAGE, outside the store's history — undoing the edit
   * that needed it restores the paragraph but leaves the level declared, which is
   * harmless: an unreferenced level renders nothing and Word writes files full of them.
   */
  ensureNumberingLevel(numId: string, level: number, kind: ListKind): boolean;
  /**
   * The `w14:paraId` ↔ node-id index over the full editable set of the MAIN part,
   * memoized per revision. Every editable paragraph carries a valid, part-unique id
   * (established at open, maintained by the split appliers), so every paragraph is
   * mapped. Header/footer paragraphs become addressable through `partFor` once their
   * story store is open.
   */
  paragraphAnchors(): ParagraphAnchorIndex;
  /** `w14:paraId` of a canonical paragraph node id, verbatim, or null. */
  paraIdOf(nodeId: string): string | null;
  /** Canonical node id for a `w14:paraId`, matched case-insensitively, or null. */
  nodeIdOf(paraId: string): string | null;

  /** Insert a validated raster image as one package undo unit (task 12). */
  insertImage(
    scope: StoryScope,
    input: import('../store/store/tree-package-images.ts').InsertImageInput
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;

  /** Replace a picture drawing's embedded media in one package undo unit. */
  replaceImage(
    scope: StoryScope,
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: import('../store/package/image-resources.ts').SupportedImageMime,
    decodePort: import('../store/package/image-resources.ts').ImageDecodePort,
    options: import('../store/store/tree-package-images.ts').ReplaceImageOptions
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;

  /** Delete a picture drawing and collect orphaned media in one package undo unit. */
  deleteImage(
    scope: StoryScope,
    drawingNodeId: string
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;

  /** Propose the drawing's deletion as a tracked change (`w:del`); media stays untouched. */
  deleteImageTracked(
    scope: StoryScope,
    drawingNodeId: string,
    revision: import('../store/store/tree-op-types.ts').RevisionAttributionInput
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;

  /** Apply image property tree ops plus hyperlink relationship wiring atomically. */
  applyImageProperties(
    scope: StoryScope,
    input: import('../store/store/tree-package-images.ts').ApplyImagePropertiesInput
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;

  /**
   * Apply drawing ops as one package undo unit. A resize of a DrawingML diagram also rescales
   * the diagram's saved drawing part, so the saved layout matches the new frame.
   */
  applyDrawingFrameOps(
    scope: StoryScope,
    ops: readonly import('../store/store/tree-op-types.ts').DrawingTreeDocOp[]
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;

  /** Insert a chart, or edit the chart part behind a chart drawing, as one package undo unit. */
  charts(): import('../store/store/tree-package-charts.ts').ChartLanes;

  /** Land a clipboard fragment (resource merge + blocks) as one package undo unit. */
  applyFragmentPaste(
    scope: StoryScope,
    input: import('../store/store/tree-package-fragment.ts').FragmentPasteInput
  ): import('../store/store/tree-package-fragment.ts').FragmentPasteResult;

  /**
   * Replace the whole package with one derived from {@link currentPackage}, as one package undo
   * unit that publishes a `global` change. For writes that rebuild many parts, such as a compare.
   */
  replacePackage(
    pkg: OoxmlPackage
  ): import('../store/store/tree-package-replace.ts').PackageReplacementResult;

  /**
   * Apply a complete updated package, opened as a load would open it, as ONE undoable edit
   * that replicates: unchanged nodes keep their ids, and a collaboration session receives the
   * difference as an ordinary journal. Refuses with nothing changed when it cannot apply.
   */
  applyPackageUpdate(
    pkg: OoxmlPackage
  ): import('../store/store/tree-package-update.ts').PackageUpdateResult;
}
