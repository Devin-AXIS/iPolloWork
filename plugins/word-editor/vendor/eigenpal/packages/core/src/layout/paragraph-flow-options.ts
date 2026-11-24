// Options for `breakParagraph`. Re-exported from `paragraph-flow.ts`.

import type { DocumentProperties, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { CellAnchorScope } from './cell-anchor-layout.ts';
import type { CjkParagraphTypography } from './cjk-typography.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { FieldLinkProjector, HyperlinkProjector } from './field-projection.ts';
import type { ParagraphLineSpacing } from './paragraph-style.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { ThemeFonts } from './run-style.ts';
import type { LayoutBox } from './semantic-records.ts';
import type { SpaceShrinkRule } from './space-shrink-rule.ts';

/** Paragraph geometry affects line starts and heights, so callers must include it in cache keys. */
export interface ParagraphFlowOptions {
  readonly paragraphRtl?: boolean;
  /**
   * How a line may compress its inter-word spaces to keep the word that overflows it
   * (`resolveSpaceShrinkRule`). Absent, lines keep natural spaces.
   */
  readonly spaceShrink?: SpaceShrinkRule;
  /** A left tab stop past the margin is honoured, and its text may run past the margin. */
  readonly leftTabsPastMargin?: boolean;
  /** An inline object opening its line stays on it beside a float, however wide. */
  readonly inlineObjectsBesideFloats?: boolean;
  /** Square wrapping on the largest side breaks a tie to the physical left (mode 15 and later). */
  readonly largestWrapTieLeft?: boolean;
  /**
   * A Korean paragraph-final mark that hangs lets the text before it fill the measure (mode 15
   * and later). Otherwise that last line keeps its natural width.
   */
  readonly koreanHangingLineFills?: boolean;
  /** A body paragraph, where a column break ends its column. */
  readonly columnBreaksEndColumns?: boolean;
  /** The paragraph mark after a closing page break takes a line on the next page. */
  readonly pageBreakMarkOnNextPage?: boolean;
  /** Justified paragraphs may compress East Asian punctuation to fit a line; others keep natural widths. */
  readonly cjkPunctuationFit?: boolean;
  readonly typography?: CjkParagraphTypography;
  readonly lineSpacing?: ParagraphLineSpacing;
  /** First-line offset from the paragraph indent: `w:firstLine` right, `w:hanging` left. */
  readonly firstLineOffset?: number;
  /**
   * Baseline floor for the FIRST line, in points: a picture-bullet marker sits on it. The
   * floor lowers the baseline and grows the box alike, so no later line moves. `exact` clips.
   */
  readonly firstLineMinimumBaseline?: number;
  /**
   * The list marker face's own ascent, reserved above the FIRST line's baseline.
   *
   * Word sets the number or bullet on that baseline, so a level `w:rFonts`/`w:sz` taller
   * than the paragraph's own font pushes the line down by the excess. It applies BEFORE line
   * spacing, because the marker grows the natural line that an `auto` multiple then scales.
   * The marker never deepens the line below its baseline ({@link listMarkerFirstLineMetrics}).
   */
  readonly firstLineMarkerAscent?: number;
  /**
   * Page breaks that open the paragraph pass the first-line slot (offset and marker floors) on
   * to the first line after them, where body layout publishes the list marker. A continuation
   * from `startOffset` keeps the slot only when nothing but page breaks precedes it.
   */
  readonly firstLineAfterLeadingBreaks?: boolean;
  /** Re-break only the unplaced suffix when an unequal-width column follows. */
  readonly startOffset?: number;
  /** Text column bounds in indentLeft coordinates. Margin-relative positional tabs use these
   * bounds; absent, they use the paragraph column, which differs when indents are present. */
  readonly marginExtent?: { readonly left: number; readonly right: number };
  /** Sanitize hyperlink relationships. Without a resolver, text paints without a link. */
  readonly projectLink?: HyperlinkProjector;
  /** Sanitize HYPERLINK field targets; otherwise paint the cached result without a link. */
  readonly projectFieldLink?: FieldLinkProjector;
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
  /** @internal */
  readonly fieldCodeRanges?: readonly import('./field-code-toc.ts').FieldCodeRange[];
  /** @internal Word TOC character-style suppression. */
  readonly tocLinkStyleRanges?: readonly import('./toc-link-formatting.ts').TocLinkRange[];
  /**
   * The document's parsed metadata, for document-property fields (TITLE, AUTHOR, …).
   *
   * Document-global rather than per-paragraph — the surface reads it once from the store and
   * hands the same object to every flow. Absent means such a field paints its cached result or
   * nothing, the same degradation as a furniture-only pass.
   */
  readonly documentProperties?: DocumentProperties;
  /**
   * True when this is BODY flow, whose PAGE/NUMPAGES/SECTIONPAGES fields are substituted at
   * document finalize (`substituteBodyPageFields`). Only then does an empty-cache page field
   * paint a placeholder digit; headers/footers, notes and text boxes leave it blank, keeping
   * their own live path or their deferral, so a placeholder is never stranded unsubstituted.
   */
  readonly bodyPageFields?: import('./field-page-furniture.ts').BodyPageFieldContext | false;
  /**
   * The story's resolved REF inputs (bookmark targets + numbering), for live REF results.
   *
   * Supplied by the body flow, whose block cache keys fold the resolved values — a flow that
   * threads this WITHOUT keying on those values would serve stale breaks after a renumbering
   * edit. Absent means REF fields paint their cached results, the safe degradation every
   * other story (headers/footers, notes, text boxes) currently takes.
   */
  readonly refFields?: import('./field-ref.ts').RefFieldContext;
  /**
   * Which revisions this break resolves away.
   *
   * A different mode is a different break — the proposed result drops deleted text, so lines
   * wrap elsewhere — so it belongs in the caller's cache key alongside line spacing.
   */
  readonly displayMode?: RevisionDisplayMode;
  /** Reviewers whose revisions project as accepted for this layout pass. */
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /** Derived footnote/endnote marks for noteReference / noteRef projection. */
  readonly noteMarks?: import('./note-projection.ts').NoteMarkContext;
  /** Inline drawing projection + resource lookup for typed `w:drawing` nodes. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /** Lay out the content of an inline text box. */
  readonly layoutTextboxStory?: import('./inline-textbox-flow.ts').TextboxStoryLayouter;
  /** Column's paragraph-relative left edge; oversized inline extents clip here without scaling. */
  readonly contentLeft?: number;
  /** Right edge of the containing text column in paragraph-relative coordinates. */
  readonly contentRight?: number;
  /** @internal Line placement applies the horizontal clip: the paper, a cell box, or a column. */
  readonly deferInlineDrawingHorizontalClip?: boolean;
  /**
   * Horizontal origin of the active column within page-content coordinates.
   * Line x offsets are column-local; exclusion zones are page-wide.
   */
  readonly contentOriginX?: number;
  /** Page-content Y where this paragraph starts — for anchored wrap exclusion at break time. */
  readonly paragraphStartY?: number;
  /** Anchor origin before displacement that its own wrap caused in a preceding paragraph. */
  readonly anchorParagraphStartY?: number;
  /** Spacing applied above the first line; `paragraphStartY` already includes it. */
  readonly paragraphSpaceBefore?: number;
  /**
   * The page frames of the body page being filled. A band of the paragraph's own that the page
   * or a margin positions sits where they put it, not at its anchor line.
   */
  readonly anchorFrameBase?: ReturnType<
    typeof import('./body-flow-helpers.ts').bodyAnchorFrameBase
  >;
  /**
   * Page-content Y of the flow region's bottom. An empty line does not move below a float
   * anchored in its own paragraph past it: the float travels with the paragraph, so the
   * next region would block the line the same way.
   */
  readonly regionBottomY?: number;
  /**
   * Model offsets of the paragraph's own paragraph-framed top-and-bottom anchors whose bands
   * apply from the first line, set on the second break of `top-and-bottom-earlier-lines.ts`.
   */
  readonly ownBandsFromFirstLine?: ReadonlySet<number>;
  /** Active exclusion zones on the current page while breaking. */
  readonly pageExclusionZones?: readonly ExclusionZone[];
  /** When breaking inside a table cell, the cell content box for anchored frame resolution. */
  readonly anchorCellBox?: LayoutBox | null;
  /** With {@link anchorCellBox}: what decides the cell's anchors' `layoutInCell`. */
  readonly cellAnchorScope?: CellAnchorScope;
  /**
   * A manual page break keeps its model offset but has no geometry, as in a table cell. Set for
   * a paragraph in a text frame (`w:framePr`): the frame stays on its page, and the text after
   * the break continues on the same line.
   */
  readonly pageBreaksIgnored?: true;
  /**
   * Instruction-only TOC paragraphs and ending field chrome can carry no measurable text.
   * When set, an otherwise empty break returns no lines. A paragraph mark after a TOC
   * separator belongs to the result and must retain its ordinary empty line instead.
   */
  readonly suppressEmptyPlaceholderLine?: boolean;
  /**
   * The theme's Latin typefaces, resolving `w:rFonts` theme references.
   *
   * A different theme measures every `+Body`/`+Headings` run in a different face, so it
   * belongs in the caller's cache key. The BODY lane has that: `semantic-layout` folds
   * `StyleCascadeTable.cacheToken` into its producer. The header/footer and note lanes pass
   * the raw surface producer instead, so their keys carry the cascaded `w:rFonts` property
   * but not the theme it resolves through. That is safe only because the theme is memoized
   * per session and every reload rebuilds the surface with a fresh cache — a live retheme
   * would need `cacheToken` folded into those producers too.
   */
  readonly themeFonts?: ThemeFonts;
  /** Stable measurement producer token for cross-break equation geometry reuse. */
  readonly equationCacheToken?: string;
  /**
   * Paragraph-mark cascade for empty-line metrics and last-line mark height.
   * When omitted, falls back to the content `inheritedRunProperties` argument.
   */
  readonly markRunProperties?: readonly OoxmlProperty[];
}
