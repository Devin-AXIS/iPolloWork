// Per-note story layout (typed footnotes / endnotes).
//
// Each typed note node is a story laid out at content width with no body pagination —
// same shape as header/footer furniture ({@link layoutHeaderFooterStory}), but notes
// consume body space on the referencing page (or collect at sect/doc end) and are
// selectable editable content rather than `[data-docx-hf]` furniture.
//
// Line / fragment ids are namespaced by note kind + id so the body's incremental
// convergence counter never moves because a note changed. Resource accounting is
// bounded: hostile note counts and over-tall flows fail closed with named reasons.

import { withFieldResultsProducer } from './field-results-producer.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import {
  findNoteById,
  formatNoteScopeId,
  isContinuationSeparatorNode,
  isNormalNote,
  isNoteRefNode,
  isSeparatorNode,
  noteIdOf,
  noteKindOf,
  noteTypeOf,
  notesOf,
  type NoteKind,
  MAX_NOTES_PER_PART,
} from '../store/package/note-nodes.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { FieldLinkProjector, HyperlinkProjector } from './field-pieces.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import { noteMarksCacheToken, type NoteMarkContext } from './note-projection.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { paragraphBorders } from './paragraph-style.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import { withResolvedListItems } from './list-resolve.ts';
import { noteSeparatorRuleBox } from './note-separator-rule.ts';
import type { BlockFragmentRecord, LayoutBox, TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { noteStoryBlocks } from './story-roots.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

/** Hard ceiling on notes laid out in one pass (fail closed beyond). */
export const MAX_NOTES_LAID_OUT = MAX_NOTES_PER_PART;

/** Hard ceiling on fragments emitted for one note (split / continuation). */
export const MAX_NOTE_FRAGMENTS = 512;

/** Default separator rule height when the document supplies no separator note. */
export const DEFAULT_NOTE_SEPARATOR_HEIGHT_PT = 6;

/** Legacy proportional separator width. @deprecated Rules use a 144pt width, capped by the content band. */
export const DEFAULT_NOTE_SEPARATOR_WIDTH_RATIO = 1 / 3;

/**
 * Why note layout stopped short and fell back.
 *
 * Every one is a BOUND rather than a bug: note counts, fragment counts and heights all come from
 * a file, and a document can ask for more note area than a page has. Falling back with a reason
 * keeps the document open instead of failing to lay out.
 */
export type NoteLayoutFallbackReason =
  | 'note-count-limit'
  | 'note-fragment-limit'
  | 'note-reflow-exhausted'
  | 'note-height-cap'
  /** Authored separator/continuationSeparator taller than the content column. */
  | 'note-separator-height-cap'
  | 'note-continuation-notice-height-cap'
  | 'missing-note-body'
  | 'dangling-note-reference';

/**
 * One note's body laid out as its own story, in story-relative coordinates.
 *
 * Relative rather than page-absolute because a note moves between pages during pagination — the
 * page it lands on is decided after its content is measured.
 */
export interface NoteStoryLayout {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  /** `footnote:N` / `endnote:N` — matches EditorScope note id encoding. */
  readonly scopeId: string;
  readonly noteType: ReturnType<typeof noteTypeOf>;
  /** Story-relative fragments; origin at the story box's top-left. */
  readonly fragments: readonly BlockFragmentRecord[];
  /** Height the blocks flow to (points). */
  readonly flowHeight: number;
  /** True when layout hit a named bound and returned a truncated / empty story. */
  readonly fallbackReason?: NoteLayoutFallbackReason;
}

/** Paint style for Word-default / marker-only separator rules (not CSS inventing content). */
export type NoteSeparatorRuleStyle = 'single' | 'double';

/**
 * The rule between body text and the note area.
 *
 * Synthesized when the document declares none, because Word draws one regardless — a document
 * without an authored separator still shows the line a reader expects.
 */
export interface NoteSeparatorLayout {
  readonly kind: 'separator' | 'continuationSeparator';
  readonly fragments: readonly BlockFragmentRecord[];
  readonly flowHeight: number;
  /** True when the engine synthesized a default rule (document had none). */
  readonly synthetic: boolean;
  /**
   * Layout-owned rule when the separator is marker-only (`w:separator` /
   * `w:continuationSeparator`) or fully synthetic. Absent when an authored separator
   * story has real paragraph/run/border content that paint should render as fragments.
   */
  readonly ruleStyle?: NoteSeparatorRuleStyle;
  /** Marker rule geometry inside the measured separator story. */
  readonly ruleBox?: LayoutBox;
  /** Resolved marker-run color; null/absent uses automatic black. */
  readonly ruleColor?: string | null;
  /** Set when an oversize authored separator was replaced with a synthetic rule. */
  readonly fallbackReason?: NoteLayoutFallbackReason;
}

/**
 * Inline drawing support for ONE notes part.
 *
 * A note lives in `/word/footnotes.xml` or `/word/endnotes.xml`, not in the body part, so its
 * pictures resolve against that part's relationships — the same per-part shape header/footer
 * furniture uses. Without it a note paragraph flows with no drawing context at all and a
 * picture inside it contributes no record: no image, and no placeholder either.
 */
export interface NoteStoryDrawings {
  readonly inlineDrawingLayout: InlineDrawingLayoutContext;
  /**
   * Per-paragraph projection + RESOURCE token for the break cache key.
   *
   * Image resources settle asynchronously, and the authored extent does not move when one
   * does — so without the resource in the key the cached `pending` lines are served forever
   * and a decoded picture never reaches the page.
   */
  readonly drawingTokenForParagraph?: (paragraph: OoxmlNode) => string;
}

export interface LayoutNoteStoryOptions {
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: StyleCascadeTable;
  /**
   * `numbering.xml`, so a `w:numPr` paragraph inside a note resolves a marker.
   *
   * Per story, like every other: `createListCounterState` is fresh per walk, so a numbered
   * list in a footnote starts at `w:start` rather than continuing the body's sequence.
   */
  readonly numberingIndex?: import('./numbering-index.ts').NumberingIndex;
  readonly defaultTabStopPt?: number;
  readonly compatibilityMode?: number;
  /**
   * The active line-grid pitch of the section that owns the note, in points. Note lines snap
   * to it like body lines do; absent means no grid.
   */
  readonly lineGridPitchPt?: number;
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /**
   * Same projector seams the BODY walk uses. Without them a `w:hyperlink` or a HYPERLINK
   * field inside a note painted as plain text — measured, but carrying no link record for
   * paint to anchor and navigation to activate.
   */
  readonly projectLink?: HyperlinkProjector;
  /**
   * Per-part projector, preferred over `projectLink` when `ownerPartName` names the part.
   *
   * A `w:hyperlink` in `/word/footnotes.xml` declares its `r:id` in `footnotes.xml.rels`,
   * so it must resolve there — the body projector answers from the body part's
   * relationships, and when the two parts assign one id to different targets the footnote
   * link navigated to the body's target. Same per-part rule pictures follow through
   * {@link drawingsForPart}.
   */
  readonly projectLinkForPart?: (ownerPartName: string) => HyperlinkProjector | undefined;
  readonly projectFieldLink?: FieldLinkProjector;
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
  readonly projectionTokenForParagraphForPart?: (
    ownerPartName: string,
    paragraph: OoxmlNode
  ) => string;
  readonly projectionTokenForTableForPart?: (ownerPartName: string, table: OoxmlNode) => string;
  /** Document properties for a document-property field inside a note story. */
  readonly documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties;
  /**
   * The document's resolved REF inputs, so a footnote's cross-reference paints the live
   * value the body paints. The flow folds each paragraph's resolved values into its break
   * key, which is what repaints a note after a renumbering edit it cannot otherwise see.
   */
  readonly refFields?: import('./field-ref.ts').RefFieldContext;
  /** Derived display marks for noteRef projection inside the note body. */
  readonly noteMarks?: NoteMarkContext;
  /**
   * Cap on flow height for a single note story (points). Hostile notes must not allocate
   * unbounded page fragments; overflow is split by the pagination layer, not here.
   */
  readonly maxFlowHeightPt?: number;
  /** Resolves inline drawing support for the notes part a story lives in. */
  readonly drawingsForPart?: (ownerPartName: string) => NoteStoryDrawings | undefined;
  /**
   * Notes part the story being laid out came from. Set by {@link layoutNoteById} /
   * {@link layoutNoteSeparator}, which are the callers that hold the part.
   */
  readonly ownerPartName?: string;
}

/**
 * Stable line-id namespace for one note. Body line counters compare these as opaque strings
 * and must not collide with `line-N` / `hf-…` ids.
 */
export function noteLineIdPrefix(noteKind: NoteKind, noteId: number): string {
  return `note-${noteKind}-${noteId}`;
}

/** Collect normal (body) notes from a notes part, bounded. */
export function normalNotesOf(part: OoxmlPart | null | undefined): readonly OoxmlElement[] {
  if (!part) return [];
  const out: OoxmlElement[] = [];
  for (const note of notesOf(part.root)) {
    if (out.length >= MAX_NOTES_LAID_OUT) break;
    if (!isNormalNote(note)) continue;
    out.push(note);
  }
  return out;
}

type SpecialNoteType = 'separator' | 'continuationSeparator' | 'continuationNotice';

/**
 * The first note of each special type in a notes part root. The tree is immutable, so one
 * scan of a root answers every later lookup: a reserve search lays out the separator once per
 * computation, and a scan per lookup grew with the note count each time.
 */
const specialNotes = new WeakMap<
  OoxmlNode,
  Readonly<Record<SpecialNoteType, OoxmlElement | undefined>>
>();

/** The first note of a special type in a notes part, from one scan per part root. */
export function findSpecialNote(
  part: OoxmlPart | null | undefined,
  kind: SpecialNoteType
): OoxmlElement | undefined {
  if (!part) return undefined;
  let found = specialNotes.get(part.root);
  if (found === undefined) {
    const first: Record<SpecialNoteType, OoxmlElement | undefined> = {
      separator: undefined,
      continuationSeparator: undefined,
      continuationNotice: undefined,
    };
    for (const note of notesOf(part.root)) {
      const type = noteTypeOf(note);
      if (type !== undefined && type !== 'normal') first[type] ??= note;
    }
    found = first;
    specialNotes.set(part.root, found);
  }
  return found[kind];
}

/** Find separator / continuationSeparator note body in a notes part. */
export function findSeparatorNote(
  part: OoxmlPart | null | undefined,
  kind: 'separator' | 'continuationSeparator'
): OoxmlElement | undefined {
  return findSpecialNote(part, kind);
}

/**
 * Lay one note node out at `contentWidth`.
 *
 * Does not paginate. Callers that need splits ask for fragments and cut at paragraph/line
 * boundaries in the note-pagination layer.
 */
export function layoutNoteStory(
  note: OoxmlNode,
  contentWidth: number,
  options: LayoutNoteStoryOptions
): NoteStoryLayout | null {
  const noteKind = noteKindOf(note);
  const noteId = noteIdOf(note);
  if (!noteKind || noteId === null) return null;

  const scopeId = formatNoteScopeId(noteKind, noteId);
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const blocks = noteStoryBlocks(note, displayMode, options.revisionAuthorFilter);
  const prefix = noteLineIdPrefix(noteKind, noteId);
  let lineCounter = 0;
  const width = Math.max(1, contentWidth);
  const maxHeight = options.maxFlowHeightPt ?? Number.POSITIVE_INFINITY;

  // noteRef atoms have no @w:id — bind display marks to this story's scope.
  const measureSeparatorMarkers =
    noteTypeOf(note) === 'separator' || noteTypeOf(note) === 'continuationSeparator';
  const noteMarks: NoteMarkContext = {
    ...(options.noteMarks ?? { marks: new Map() }),
    activeNoteKey: scopeId,
    ...(measureSeparatorMarkers ? { measureSeparatorMarkers: true as const } : {}),
  };

  // INLINE pictures only. An anchored drawing in a note would need frame and exclusion
  // semantics against a story that has no page of its own until pagination places it.
  const drawings = options.ownerPartName
    ? options.drawingsForPart?.(options.ownerPartName)
    : undefined;

  // The link projector scoped to the part this note lives in; the body projector is only
  // the fallback for callers that supply no per-part resolution.
  const projectLink =
    (options.ownerPartName ? options.projectLinkForPart?.(options.ownerPartName) : undefined) ??
    options.projectLink;

  const listItems = withResolvedListItems(
    {
      numberingIndex: options.numberingIndex,
      styleCascade: options.styleCascade,
      measurer: options.measurer,
    },
    blocks
  ).listItems;

  const flow = flowBlocksInBox(blocks, 0, width, 0, 0, {
    measurer: options.measurer,
    cache: options.cache,
    // The projected pieces are cached, not merely the authored paragraph text. A shared
    // exporter/browser cache can therefore only reuse them within the revision projection
    // that produced them. Keep the unfiltered default key stable, matching furniture.
    producer:
      withFieldResultsProducer(options.producer) +
      (measureSeparatorMarkers ? '|separator-metrics' : '') +
      (options.showFieldCodes ? '|field-codes' : '') +
      (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`) +
      (options.revisionAuthorFilter ? `|reviewers:${options.revisionAuthorFilter.cacheKey}` : '') +
      // The story's `w:footnoteRef` paints its derived mark, which moves when a note is cited
      // earlier or the format changes while this paragraph stays byte-identical. Tokened on the
      // pass's shared context, not the per-story copy above: the token is memoized per context
      // object, and a fresh copy per note would re-serialize every mark for every note.
      (options.noteMarks ? `|nm:${noteMarksCacheToken(options.noteMarks)}` : '') +
      `|${scopeId}`,
    nextLineId: () => `${prefix}-line-${lineCounter++}`,
    styleCascade: options.styleCascade,
    ...(listItems ? { listItems } : {}),
    noteMarks,
    ...(projectLink ? { projectLink } : {}),
    ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
    showFieldCodes: options.showFieldCodes,
    ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
    ...(options.ownerPartName && options.projectionTokenForParagraphForPart
      ? {
          projectionTokenForParagraph: (paragraph: OoxmlNode) =>
            options.projectionTokenForParagraphForPart!(options.ownerPartName!, paragraph),
        }
      : {}),
    ...(options.ownerPartName && options.projectionTokenForTableForPart
      ? {
          projectionTokenForTable: (table: OoxmlNode) =>
            options.projectionTokenForTableForPart!(options.ownerPartName!, table),
        }
      : {}),
    ...(options.refFields ? { refFields: options.refFields } : {}),
    displayMode,
    compatibilityMode: options.compatibilityMode,
    ...(options.lineGridPitchPt !== undefined
      ? { paragraphLineUnitPt: options.lineGridPitchPt, snapsStoryLines: true as const }
      : {}),
    tableNestingOffset: 1,
    ...(options.defaultTabStopPt !== undefined
      ? { defaultTabStopPt: options.defaultTabStopPt }
      : {}),
    ...(drawings
      ? {
          inlineDrawingLayout: drawings.inlineDrawingLayout,
          ...(drawings.drawingTokenForParagraph
            ? { drawingTokenForParagraph: drawings.drawingTokenForParagraph }
            : {}),
        }
      : {}),
    ...(options.revisionAuthorFilter ? { revisionAuthorFilter: options.revisionAuthorFilter } : {}),
  });

  let fragments = flow.blocks;
  let flowHeight = flow.bottom;
  let fallbackReason: NoteLayoutFallbackReason | undefined;

  if (fragments.length > MAX_NOTE_FRAGMENTS) {
    fragments = fragments.slice(0, MAX_NOTE_FRAGMENTS);
    const last = fragments[fragments.length - 1];
    flowHeight = last ? last.box.y + last.box.height : 0;
    fallbackReason = 'note-fragment-limit';
  }

  if (flowHeight > maxHeight) {
    // Truncate to fragments that fit; pagination continues the remainder.
    const kept: BlockFragmentRecord[] = [];
    let bottom = 0;
    for (const fragment of fragments) {
      const next = fragment.box.y + fragment.box.height;
      if (next > maxHeight + 0.001 && kept.length > 0) break;
      kept.push(fragment);
      bottom = next;
    }
    fragments = kept;
    flowHeight = bottom;
    fallbackReason = fallbackReason ?? 'note-height-cap';
  }

  return {
    noteKind,
    noteId,
    scopeId,
    noteType: noteTypeOf(note),
    fragments,
    flowHeight,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

/** Layout a note by id from a notes part; null when missing. */
export function layoutNoteById(
  part: OoxmlPart | null | undefined,
  noteId: number,
  contentWidth: number,
  options: LayoutNoteStoryOptions
): NoteStoryLayout | null {
  if (!part) return null;
  const note = findNoteById(part.root, noteId);
  if (!note) return null;
  return layoutNoteStory(note, contentWidth, { ...options, ownerPartName: part.name });
}

/**
 * Note story layouts, keyed by part, note id and width, and OWNED by a mark context: the
 * caller keys each cache off one `NoteMarkContext` whose lifetime a notes-pass memo pins.
 * The key deliberately omits everything else riding `LayoutNoteStoryOptions` because the
 * memo's input fingerprint and identity checks pin those inputs for as long as the marks
 * (and so this cache) live. ADDING A FIELD to `LayoutNoteStoryOptions` therefore means
 * joining it to `fingerprintNotesInput`/`notesInputIdentities` in note-pagination.ts, or
 * a cached story silently outlives the input that shaped it.
 */
export type NoteStoryLayoutCache = Map<string, NoteStoryLayout | null>;

export function layoutNoteCached(
  part: OoxmlPart | null,
  noteId: number,
  contentWidth: number,
  opts: LayoutNoteStoryOptions,
  cache: NoteStoryLayoutCache | undefined
): NoteStoryLayout | null {
  if (!cache) return layoutNoteById(part, noteId, contentWidth, opts);
  const key = `${part?.name ?? 'none'}\0${noteId}\0${contentWidth}\0${opts.lineGridPitchPt ?? ''}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const laid = layoutNoteById(part, noteId, contentWidth, opts);
  cache.set(key, laid);
  return laid;
}

/**
 * Word-default paint style for a separator marker.
 *
 * Footnote and endnote separators both use a short single rule. A full-width double
 * border on a body heading (e.g. the comprehensive fixture’s end banner) is ordinary
 * paragraph `w:pBdr` ownership and must not transfer onto the note separator record.
 * Authored separator stories with real paragraph/run/border content bypass this via
 * fragment paint.
 */
export function defaultNoteSeparatorRuleStyle(
  _noteKind: NoteKind,
  _kind: 'separator' | 'continuationSeparator'
): NoteSeparatorRuleStyle {
  return 'single';
}

/**
 * True when a separator note contains only OOXML separator markers (and empty noteRef
 * atoms Word often authors beside them) — no measurable text or paragraph borders.
 */
export function isMarkerOnlySeparatorNote(
  note: OoxmlNode,
  displayMode?: RevisionDisplayMode,
  revisionAuthorFilter?: RevisionAuthorFilter
): boolean {
  const blocks = noteStoryBlocks(note, displayMode, revisionAuthorFilter);
  if (blocks.length === 0) return true;
  for (const block of blocks) {
    if (block.kind !== 'paragraph') return false;
    const pPr = block.children.find((child) => child.kind === 'paragraphProperties');
    if (Object.keys(paragraphBorders(pPr)).length > 0) return false;
    if (!paragraphIsMarkerOnly(block)) return false;
  }
  return true;
}

function paragraphIsMarkerOnly(paragraph: OoxmlElement): boolean {
  for (const child of paragraph.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraphProperties') continue;
    if (child.kind === 'run') {
      if (!runIsMarkerOnly(child)) return false;
      continue;
    }
    // Any other block-level / inline content is authored geometry.
    return false;
  }
  return true;
}

function runIsMarkerOnly(run: OoxmlElement): boolean {
  for (const child of run.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'runProperties') continue;
    if (isSeparatorNode(child) || isContinuationSeparatorNode(child) || isNoteRefNode(child)) {
      continue;
    }
    if (child.kind === 'text') {
      const text = child.children.map((c) => c.value).join('');
      if (text.trim().length > 0) return false;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Layout the document's separator note, or synthesize a short horizontal rule.
 *
 * Single-marker / missing separators emit no paragraph fragments — paint draws the rule
 * from {@link NoteSeparatorLayout.ruleStyle} + box geometry. Authored separators with
 * real paragraph/run/border content keep their fragment story (including `w:pBdr`).
 * Explicitly empty stories and hidden markers do not acquire a default rule.
 *
 * When `maxFlowHeightPt` is set and an authored separator exceeds it, the engine fails
 * closed to a short synthetic rule ({@link note-separator-height-cap}) so note pagination
 * cannot burn the overflow budget on zero-progress separator-only pages.
 */
export function layoutNoteSeparator(
  part: OoxmlPart | null | undefined,
  kind: 'separator' | 'continuationSeparator',
  contentWidth: number,
  options: LayoutNoteStoryOptions,
  noteKind: NoteKind,
  maxFlowHeightPt?: number
): NoteSeparatorLayout {
  const ruleStyle = defaultNoteSeparatorRuleStyle(noteKind, kind);
  const authored = findSeparatorNote(part, kind);
  if (authored) {
    // Separators keep their unsnapped height: only note text follows the section grid.
    const laid = layoutNoteStory(authored, contentWidth, {
      ...options,
      lineGridPitchPt: undefined,
      ...(part ? { ownerPartName: part.name } : {}),
    });
    if (laid) {
      const markerOnly = isMarkerOnlySeparatorNote(
        authored,
        options.displayMode,
        options.revisionAuthorFilter
      );
      let flowHeight = laid.flowHeight;
      let ruleBox: LayoutBox | undefined;
      let ruleColor: string | null | undefined;
      let singleRule = false;
      if (markerOnly) {
        const paragraphs = laid.fragments.filter((fragment) => fragment.kind === 'paragraph');
        const markers = paragraphs.flatMap((paragraph) =>
          paragraph.lines.flatMap((line) =>
            line.spans.filter((span) => span.noteSeparator).map((span) => ({ line, span }))
          )
        );
        singleRule = markers.length === 1;
        const last = paragraphs.at(-1);
        const authoredBlocks = noteStoryBlocks(
          authored,
          options.displayMode,
          options.revisionAuthorFilter
        );
        const lastBlock = authoredBlocks.at(-1);
        const properties =
          lastBlock?.kind === 'paragraph'
            ? lastBlock.children.find((child) => child.kind === 'paragraphProperties')
            : undefined;
        // Plain separators do not acquire the body's implicit trailing paragraph space.
        // Explicit paragraph spacing and named styles remain part of their story geometry.
        const hasAuthoredSpacing =
          properties?.kind === 'paragraphProperties' &&
          properties.children.some(
            (child) =>
              child.localName === 'pStyle' ||
              (child.localName === 'spacing' &&
                child.attributes.some((attribute) => attribute.localName === 'after'))
          );
        flowHeight -= hasAuthoredSpacing ? 0 : (last?.spacing.after ?? 0);
        const marker = markers[0];
        if (marker) {
          ruleColor = marker.span.style.color;
          ruleBox = noteSeparatorRuleBox(
            marker.span,
            marker.line,
            options.measurer.strikeoutMetrics?.(marker.span.style)
          );
        }
      }
      const cap = maxFlowHeightPt ?? Number.POSITIVE_INFINITY;
      if (flowHeight > cap + 0.001) {
        return {
          kind,
          fragments: [],
          flowHeight: DEFAULT_NOTE_SEPARATOR_HEIGHT_PT,
          synthetic: true,
          ruleStyle,
          fallbackReason: 'note-separator-height-cap',
        };
      }
      return {
        kind,
        fragments: markerOnly && singleRule ? [] : laid.fragments,
        flowHeight,
        synthetic: false,
        ...(markerOnly && singleRule
          ? {
              ruleStyle,
              ...(ruleBox ? { ruleBox } : {}),
              ...(ruleColor !== undefined ? { ruleColor } : {}),
            }
          : {}),
      };
    }
  }
  return {
    kind,
    fragments: [],
    flowHeight: DEFAULT_NOTE_SEPARATOR_HEIGHT_PT,
    synthetic: true,
    ruleStyle,
  };
}

/** Default rule geometry for a synthetic / marker-only separator, story-relative. */
export function syntheticSeparatorBox(
  contentWidth: number,
  flowHeight: number,
  kind: 'separator' | 'continuationSeparator' = 'separator'
): LayoutBox {
  const width = Math.max(
    1,
    Math.min(contentWidth, kind === 'continuationSeparator' ? contentWidth : 144)
  );
  return {
    x: 0,
    y: Math.max(0, (flowHeight - 0.5) / 2),
    width,
    height: 0.5,
  };
}

/** Absolute separator box: short rule for marker/synthetic, full width for authored stories. */
export function noteSeparatorAreaBox(
  separator: NoteSeparatorLayout,
  contentX: number,
  contentWidth: number,
  areaTop: number
): LayoutBox {
  if (separator.ruleStyle !== undefined || separator.synthetic) {
    const relative =
      separator.ruleBox ??
      syntheticSeparatorBox(contentWidth, separator.flowHeight, separator.kind);
    // A measured face stroke IS the thickness Word paints, so only a synthetic rule takes the
    // visibility floor. A `double` rule keeps its two-stroke minimum either way.
    const floor = separator.ruleStyle === 'double' ? 2.25 : separator.ruleBox ? 0 : 0.5;
    return {
      x: contentX + relative.x,
      y: areaTop + relative.y,
      width: relative.width,
      height: Math.max(relative.height, floor),
    };
  }
  return {
    x: contentX,
    y: areaTop,
    width: contentWidth,
    height: separator.flowHeight,
  };
}
