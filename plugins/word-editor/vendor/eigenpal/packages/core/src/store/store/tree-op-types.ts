import type { SetLegacyDropdownOp } from './legacy-dropdown-fields.ts';
import type { SetFieldCodeOp } from './tree-op-field-code.ts';
import type { InsertComplexFieldOp, InsertPageFieldOp } from './tree-op-field-insert.ts';
import type { SetFieldResultOp } from './tree-op-field-result-write.ts';
import type { InsertEquationOp } from './tree-op-equation-insert.ts';
import type { InsertTextOp, DeleteTextOp } from './text-edit-op-types.ts';
import type { SetTextFormFieldDefaultOp, CommitTextFormFieldOp } from './text-form-fields.ts';
import type { SetLegacyCheckboxOp } from './legacy-checkbox-fields.ts';
import type { InsertBuildingBlockOp } from './building-block-insert.ts';
import type { InsertBookmarkOp, DeleteBookmarkOp } from './tree-op-bookmarks.ts';
import type {
  InsertParagraphBesideTableOp,
  InsertTableOp,
  MoveTableOp,
} from './table-placement-op-types.ts';
// The op vocabulary and effect/rejection contracts (tree-ops seam).
//
// This module owns what an op IS — the declarative, JSON-safe `TreeDocOp` shapes, the
// accepted property boundaries, and the effect contract. Rejection codes live in
// tree-op-rejection.ts. Validation lives in
// tree-op-validate.ts; application lives in tree-op-apply.ts; both re-export via tree-ops.ts.

import type { ParagraphTabStop } from '../../contracts/types.ts';
import type { ContentControlLock } from '../package/content-control-nodes.ts';
import type { OoxmlDrawingNode, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type {
  DrawingLocksInput,
  DrawingPositionInput,
  ImageWrapTarget,
  SourceCrop,
} from '../package/drawing-projection.ts';
import type {
  ContentControlValueInput,
  InsertableContentControlKind,
} from './tree-op-content-controls.ts';
import type { TableBorderStyle } from '../table-border-style.ts';
import type { TreeOpRejection } from './tree-op-rejection.ts';
import type { SetParagraphBordersOp } from './tree-op-paragraph-borders.ts';
export type {
  ParagraphBorderEdgeName,
  ParagraphBorderEdgeWrite,
  SetParagraphBordersOp,
} from './tree-op-paragraph-borders.ts';

/**
 * A colour as an op carries it: a literal, a theme reference, or automatic.
 *
 * Theme references stay references so the document keeps following its theme; flattening one to
 * hex at write time would freeze the resolved value into the file.
 */
export type TreeDocColorValue =
  | { readonly kind: 'hex'; readonly value: string }
  | {
      readonly kind: 'theme';
      readonly slot: string;
      readonly resolvedHex: string;
      readonly tint?: number;
      readonly shade?: number;
    }
  | { readonly kind: 'auto'; readonly resolvedHex: string };

/** Which edges a border op addresses — the four sides, the interiors, all, or clear. */
export type TableBorderTarget =
  'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right';

/** A {@link TableBorderTarget} that draws something — everything except clear. */
export type TableBorderEdgeTarget = Exclude<TableBorderTarget, 'none'>;

/** Complete border spec for non-`none` selected-cell border scopes. Size is in eighths of a point. */
/** A complete border spec: style, width and colour. Ops carry all three, never a partial edit. */
export interface TableBorderSpecInput {
  readonly style: TableBorderStyle;
  readonly size: number;
  readonly color: TreeDocColorValue;
}
/**
 * The accepted RUN property boundary (design D8), as the OOXML element names that carry it.
 *
 * An explicit allowlist rather than "any `w:rPr` child": a property outside D8 has no
 * resolver, no layout behavior and no support claim, so accepting it here would let an
 * operation assert support the engine does not have. Unknown properties still ROUND-TRIP —
 * they are generic nodes in the tree — they simply cannot be authored by an op.
 */
export const ACCEPTED_RUN_PROPERTIES = [
  'rFonts', // font family
  'sz', // half-point size
  'szCs',
  'color',
  'b', // bold
  'bCs',
  'i', // italic
  'iCs',
  'u', // underline variant and color
  'strike',
  'dstrike', // double strike
  'highlight',
  'vertAlign', // superscript / subscript
  'position', // baseline offset
  'caps',
  'smallCaps',
  'spacing', // character spacing
  'w', // horizontal scaling
  'kern',
] as const;

/**
 * Run properties an op may ADD or replace, but that a write which leaves them out keeps.
 *
 * `w:rtl` marks text typed in a right-to-left script. It is a property of the text, not of
 * its formatting: Clear Formatting keeps it, the format painter does not carry it, and a
 * bold toggle that rewrites a run's formatting does not drop it. So it stays outside
 * {@link ACCEPTED_RUN_PROPERTIES}, whose members a write replaces as a set.
 */
export const ADDITIVE_RUN_PROPERTIES = ['rtl'] as const;
// `w:rStyle` is deliberately ABSENT. It is preserved, not accepted: this list is the set a
// property write REPLACES, so admitting the character style would make a bold toggle delete
// it. `insertHyperlink` writes `w:rStyle` itself, as part of making the run a link, which is
// what Word does and what leaves every other write alone.

/** The accepted PARAGRAPH property boundary (design D8). */
export const ACCEPTED_PARAGRAPH_PROPERTIES = [
  'pStyle',
  'jc', // alignment
  'spacing', // before/after + line spacing and rule
  'ind', // left/right/first-line/hanging indents
  'tabs',
  'numPr', // numbering identity and level
  'keepNext',
  'keepLines',
  'widowControl',
  'pageBreakBefore',
  // Word's "Don't add space between paragraphs of the same style". Layout has always read
  // it (`paragraphContextualSpacing`); until now nothing could write it.
  'contextualSpacing',
  'shd', // shading
  // Paragraph base direction: Word's Left-to-Right / Right-to-Left Text Direction. On/off
  // only; `w:val="0"` is the explicit left-to-right that overrides a right-to-left style.
  'bidi',
] as const;

export type AcceptedRunProperty = (typeof ACCEPTED_RUN_PROPERTIES)[number];
export type AcceptedParagraphProperty = (typeof ACCEPTED_PARAGRAPH_PROPERTIES)[number];

/**
 * One tab stop an op can author: where it sits, how it aligns, and what fills the gap.
 *
 * An alias, not a second declaration. The contract lane already names this shape, and two
 * public names for one shape is a trap — a caller building a stop for a read and for an op
 * would otherwise have to name it two things.
 */
export type TabStopWrite = ParagraphTabStop;

/**
 * One authored property: an element name plus its `w:`-namespace attributes.
 *
 * Modeled as name+attributes rather than a typed record per property because that is what
 * the tree holds, so an op maps to nodes without a lossy intermediate vocabulary. Attribute
 * VALUES are validated as XML text; their meaning is the resolver's business.
 *
 * Deliberately structural rather than a typed union: the accepted property lists bound WHICH
 * properties may be written, so the shape itself does not need to enumerate them.
 */
export interface OoxmlProperty {
  readonly localName: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

import type { RevisionAddress, RevisionAttributionInput } from './tree-op-revision-attribution.ts';
export {
  invalidRevisionAttribution,
  type RevisionAddress,
  type RevisionAttributionInput,
} from './tree-op-revision-attribution.ts';

/**
 * Every mutation the store accepts, as one JSON-safe discriminated union.
 *
 * The ONLY write path into a document. Each op addresses nodes by id plus UTF-16 offset, which is
 * what makes editing a paragraph inside a table cell no different from editing one at the top
 * level. Declarative and serializable, so the same op crosses a worker or transport boundary
 * unchanged.
 */
export type TreeDocOp =
  | SetFieldCodeOp
  | SetParagraphBordersOp
  | {
      /**
       * Replace one story's complete block structure with fresh plain paragraphs.
       *
       * Unlike a span replacement, this removes section-ending paragraphs and content-control
       * wrappers. A body's final direct `w:sectPr` survives to retain the page setup.
       */
      readonly op: 'replaceStoryBlocks';
      readonly storyRootId: string;
      readonly paragraphs: readonly string[];
    }
  | {
      /**
       * Insert an SDT-wrapped TOC immediately before a body paragraph.
       * The initial cached result and any heading bookmarks land in one undo unit.
       */
      readonly op: 'insertToc';
      readonly beforeParagraphId: string;
      readonly instruction: string;
      readonly alias: string;
      readonly entries: readonly {
        readonly level: number;
        readonly text: string;
        readonly headingParagraphId: string;
        readonly bookmarkName: string;
        readonly pageNumberText: string;
      }[];
      readonly bookmarksToCreate: readonly {
        readonly paragraphId: string;
        readonly name: string;
      }[];
    }
  | InsertTextOp
  | DeleteTextOp
  | {
      /**
       * Mark a paragraph's own MARK as inserted or deleted (`w:pPr/w:rPr/w:ins|w:del`,
       * §17.13.5). The change is to the paragraph break itself, so no character carries it.
       */
      readonly op: 'setParagraphMarkRevision';
      readonly paragraphId: string;
      readonly kind: 'ins' | 'del';
      readonly revision: RevisionAttributionInput;
    }
  | {
      /**
       * Propose merging this paragraph into its PREDECESSOR by striking the predecessor's
       * mark. Addressed by the SECOND paragraph so a multi-paragraph delete marks each
       * paragraph's own predecessor rather than stamping the group head N times.
       */
      readonly op: 'proposeParagraphMerge';
      readonly paragraphId: string;
      readonly revision: RevisionAttributionInput;
    }
  | {
      /**
       * Place one piece of comment markup at a model offset.
       *
       * Separate from the comment BODY, which lives in another part: this op is the story half
       * of a comment write, and the two are staged in one package transaction.
       */
      readonly op: 'insertCommentMarker';
      readonly paragraphId: string;
      readonly offset: number;
      readonly commentId: string;
      readonly marker: 'start' | 'end' | 'reference';
    }
  | {
      /**
       * Accept one revision, resolving every site in this part that carries its triple.
       */
      readonly op: 'acceptRevision';
      readonly revision: RevisionAddress;
      /** When set, only wrappers with this element local name resolve (ins/del/moveFrom/moveTo). */
      readonly localName?: string;
      /** Internal exact-site scope used when one Word revision address names separate decisions. */
      readonly siteNodeIds?: readonly string[];
    }
  | {
      readonly op: 'rejectRevision';
      readonly revision: RevisionAddress;
      readonly localName?: string;
      /** Internal exact-site scope used when one Word revision address names separate decisions. */
      readonly siteNodeIds?: readonly string[];
    }
  | {
      /**
       * Accept every revision in the part, or in one exact note root, in ONE transaction and one
       * history entry.
       *
       * Deliberately not a loop over `acceptRevision`: a reviewer who accepts a document's
       * changes made one decision, and one undo should restore all of them.
       */
      readonly op: 'acceptAllRevisions';
      /** Exact canonical sites selected by bulk preflight. */
      readonly siteNodeIds?: readonly string[];
      /** Internal shared-notes scope. When present, this must be the canonical id of a note root. */
      readonly scopeRootId?: string;
    }
  | {
      /**
       * Attribute pending revisions to another author, and optionally another date, without
       * deciding them. `sites` name revision elements and move range starts. Sites sharing a
       * `renumber` label take one fresh `w:id`, so the change cannot merge with another one.
       */
      readonly op: 'setRevisionAttribution';
      readonly revision: RevisionAttributionInput;
      readonly sites: readonly { readonly nodeId: string; readonly renumber?: string }[];
    }
  | {
      readonly op: 'rejectAllRevisions';
      /** Exact canonical sites selected by bulk preflight. */
      readonly siteNodeIds?: readonly string[];
      /** Internal shared-notes scope. When present, this must be the canonical id of a note root. */
      readonly scopeRootId?: string;
    }
  | {
      readonly op: 'insertTab';
      readonly paragraphId: string;
      readonly offset: number;
      /** Explicit left bias keeps a leading prompt outside the insertion. */
      readonly bias?: 'left' | 'right';
      /** Write this as a TRACKED insertion, on the same terms as `insertText`. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      readonly op: 'insertHardBreak';
      readonly paragraphId: string;
      readonly offset: number;
      /** Explicit left bias keeps a leading prompt outside the insertion. */
      readonly bias?: 'left' | 'right';
      /** Write this as a TRACKED insertion, on the same terms as `insertText`. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      readonly op: 'insertPageBreak';
      readonly paragraphId: string;
      readonly offset: number;
      /** Explicit left bias keeps a leading prompt outside the insertion. */
      readonly bias?: 'left' | 'right';
      /** Write this as a TRACKED insertion, on the same terms as `insertText`. */
      readonly revision?: RevisionAttributionInput;
    }
  | InsertPageFieldOp
  | InsertComplexFieldOp
  | SetFieldResultOp
  | InsertEquationOp
  | {
      /**
       * Move a numbered paragraph to another `w:numPr/w:ilvl`.
       *
       * A list item's LEVEL is what selects its format out of `numbering.xml`, so this is
       * the op behind Increase/Decrease Indent on a list: the marker changes with it. A
       * paragraph carrying no `w:numPr` is refused rather than silently numbered.
       */
      readonly op: 'setListLevel';
      readonly paragraphId: string;
      readonly level: number;
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /**
       * Put a paragraph in a list, or take it out of one.
       *
       * `numId` names a `w:num` in `numbering.xml`; null removes `w:numPr` entirely, which
       * is what turning a bullet off means. Everything else in `w:pPr` survives.
       */
      /**
       * Run properties of the PARAGRAPH MARK (`w:pPr/w:rPr`, ECMA-376 17.3.1.29).
       *
       * The mark carries the formatting a paragraph's own pilcrow has, and Word keeps it
       * in step whenever formatting is applied to a whole paragraph. It is what a list
       * marker inherits its face from — so without it, sizing a bulleted paragraph leaves
       * the bullet at the old size.
       */
      readonly op: 'setParagraphMarkProperties';
      readonly paragraphId: string;
      readonly properties: readonly OoxmlProperty[];
      /** Record this as a TRACKED format change (`w:pPr/w:rPr/w:rPrChange`, §17.13.5.31). */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      readonly op: 'setListNumbering';
      readonly paragraphId: string;
      readonly numId: string | null;
      readonly level?: number;
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /**
       * Replace a paragraph's custom tab stops, or clear them with an empty list.
       *
       * Its OWN op rather than a `w:tabs` entry in `setParagraphProperties`, because
       * `OoxmlProperty` is flat and `w:tabs` carries its meaning in `w:tab` children — the
       * same reason `setListNumbering` exists for `w:numPr`.
       */
      readonly op: 'setParagraphTabStops';
      readonly paragraphId: string;
      readonly stops: readonly TabStopWrite[];
      /**
       * Every stop position IN FORCE when the editor read the paragraph, including the
       * ones a style supplied.
       *
       * Tab stops are read through the cascade and written at the paragraph level, so a
       * replace alone cannot remove an inherited stop — the user clears a row, the style
       * puts it straight back, and the command reports success. A position that was in
       * force and is not in `stops` is suppressed with `w:val="clear"`, which is what the
       * value exists for (§17.3.1.37). Omit when the caller has no cascade to speak of;
       * the write is then a plain paragraph-level replace.
       */
      readonly inForcePositionsTwips?: readonly number[];
    }
  | {
      readonly op: 'splitParagraph';
      readonly paragraphId: string;
      readonly offset: number;
      /**
       * The `w:pStyle` the MINTED tail takes, instead of the head's own.
       *
       * A split otherwise clones the whole `w:pPr`, which is right for every property but
       * the style when the caller is an Enter at the end of a paragraph: Word gives that
       * new paragraph the style's `w:next`, so a heading is followed by body text rather
       * than by a second heading. `null` authors no `w:pStyle` at all, which is what the
       * document's default style is spelled as. Omit to clone the head's style unchanged.
       */
      readonly tailStyleId?: string | null;
    }
  | {
      /**
       * Split one `w:p` at MANY offsets in a single op.
       *
       * Equivalent to applying `splitParagraph` at each offset from the last to the first,
       * but the paragraph's content is cut in one pass and the parent's child sequence is
       * rebuilt once. A plain-text paste is a paragraph mark per line: as individual ops,
       * a large paste rebuilt the body — and re-sliced the pasted text — once per line,
       * which is quadratic in paste size.
       */
      readonly op: 'splitParagraphMany';
      readonly paragraphId: string;
      /**
       * Non-decreasing UTF-16 offsets; each produces one paragraph boundary. A repeated
       * offset produces an empty paragraph between the two boundaries — a blank line.
       */
      readonly offsets: readonly number[];
      /**
       * Propose the breaks rather than making them, exactly as the single split does.
       *
       * Every boundary is a paragraph mark this author is adding, so each paragraph that
       * PRECEDES one carries `w:rPr/w:ins`. Without it a multi-line paste in suggesting mode
       * tracked its text and not its breaks, and Reject left the extra paragraphs standing.
       */
      readonly revision?: RevisionAttributionInput;
    }
  | { readonly op: 'joinParagraphs'; readonly firstId: string; readonly secondId: string }
  | {
      readonly op: 'setRunProperties';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
      readonly properties: readonly OoxmlProperty[];
      /**
       * Record this as a TRACKED format change: each run keeps its new `w:rPr` and gains a
       * `w:rPrChange` (§17.13.5.30) holding the properties it had, so Reject restores them.
       */
      readonly revision?: RevisionAttributionInput;
      /**
       * When set, format only these runs (field result ownership). Offset range still
       * gates the edit and drives edge splits; without this, multi-run field results that
       * share one atom offset would homogenise under a single property bag.
       */
      readonly targetRunIds?: readonly string[];
    }
  | {
      readonly op: 'setParagraphProperties';
      readonly paragraphId: string;
      readonly properties: readonly OoxmlProperty[];
      /** Record this as a TRACKED format change (`w:pPrChange`, §17.13.5.29). */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /**
       * Set page-setup fields — page size, orientation, margins — on every targeted
       * `w:sectPr`: all of them (Word's "Apply to: Whole document", the default) or
       * only the one governing `anchorParagraphId`. A document whose write must reach
       * the implicit tail section gets a body-level `w:sectPr` minted as the body's
       * last child. Omitted fields are left exactly as authored per section. Explicit
       * dimensions are written literally; `orientation` WITHOUT dimensions swaps each
       * section's own (see `plannedSectionDimensions`), so distinct paper sizes
       * survive a whole-document flip.
       */
      readonly op: 'setSectionProperties';
      readonly pageWidthTwips?: number;
      readonly pageHeightTwips?: number;
      readonly orientation?: 'portrait' | 'landscape';
      readonly marginTopTwips?: number;
      readonly marginRightTwips?: number;
      readonly marginBottomTwips?: number;
      readonly marginLeftTwips?: number;
      /**
       * Word's "Apply to: This section": update only the section GOVERNING this
       * paragraph — the nearest mid-body `w:sectPr` at or after it, else the body-level
       * one. Absent means every section.
       */
      readonly anchorParagraphId?: string;
    }
  | {
      /**
       * End a section AT this paragraph: mint a `w:pPr/w:sectPr` cloning the governing
       * section's effective page setup, so the blocks up to and including this paragraph
       * become their own section. The paragraph must not already carry one.
       */
      readonly op: 'setSectionMark';
      readonly paragraphId: string;
      /**
       * Where the section that STARTS after this mark begins — Word's Breaks menu.
       *
       * `w:type` states how a section starts relative to the previous one (§17.6.22), so it
       * is written on the section FOLLOWING the mark, never on the minted one, which keeps
       * the cloned type because it starts where the section it was cut from did. `'nextPage'`
       * clears `w:type` (absent IS nextPage), so a next-page break inside a continuous
       * section really starts a page. Omitted leaves the following section untouched.
       */
      readonly breakType?: 'nextPage' | 'continuous';
    }
  | {
      /**
       * Wrap `[start, end)` of a paragraph in a `w:hyperlink`.
       *
       * The RANGE is the link — text and formatting inside it are untouched, and runs that
       * straddle either edge are divided so the link covers exactly the characters asked
       * for. Exactly one of `relationshipId` (an external target, already minted on the
       * package) or `anchor` (a bookmark in this document) names where it goes.
       *
       * A collapsed range is refused: a link with no text is markup with nothing to click,
       * and the caller that wants "insert a link with display text" inserts the text first.
       */
      readonly op: 'insertHyperlink';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
      readonly relationshipId?: string;
      readonly anchor?: string;
      readonly tooltip?: string;
      /**
       * Character style to mark the linked runs with (`w:rStyle`), normally `Hyperlink`.
       *
       * Written HERE rather than through `setRunProperties` because `w:rStyle` is preserved,
       * not accepted: it is not in the set a property write replaces, and putting it there
       * would make a later bold toggle delete it. Marking the text is part of making it a
       * link — Word does both in one operation — so the op that wraps it also styles it.
       * Omitted for a document that declares no such style.
       */
      readonly styleId?: string;
    }
  | {
      /**
       * Re-aim an existing link. `relationshipId` moves it to another external target,
       * `anchor` to a bookmark; supplying one CLEARS the other, so a link never ends up
       * carrying both and resolving by the wrong one.
       */
      readonly op: 'setHyperlinkTarget';
      readonly linkId: string;
      /** Optional exact paragraph offsets for an ordinary text subrange of this link. */
      readonly range?: { readonly start: number; readonly end: number };
      readonly relationshipId?: string;
      readonly anchor?: string;
      readonly tooltip?: string;
    }
  | {
      /**
       * Unlink: splice the `w:hyperlink`'s children into the paragraph in its place.
       *
       * The runs keep their identity, their formatting and their order, and any bookmark
       * markers inside the link stay exactly where they were. Only the link element goes,
       * which is what Word's Remove Hyperlink does — the text is not the link's, it was
       * only wrapped by it.
       */
      readonly op: 'removeHyperlink';
      readonly linkId: string;
      /** Optional exact paragraph offsets for an ordinary text subrange of this link. */
      readonly range?: { readonly start: number; readonly end: number };
    }
  | {
      /**
       * Replace one preserved `m:oMath` atom from bounded linear-math input.
       *
       * The complete equation changes as one unit. Internal OMML text never enters the
       * paragraph offset space, so callers cannot leave a partially edited math tree.
       */
      readonly op: 'setMathEquation';
      readonly equationId: string;
      readonly linear: string;
    }
  | {
      /** Remove one complete `m:oMath` atom. */
      readonly op: 'removeMathEquation';
      readonly equationId: string;
    }
  | {
      /**
       * Insert a NEW run-level content control at a text offset: `w:sdt` with a
       * `w:sdtPr` carrying the given tag (and alias/lock) and a `w:sdtContent`
       * holding one run of `text`.
       *
       * The write half of the custom-node contract (pro-review-and-custom-nodes):
       * a node's identity lives in `w:tag`, `sdtLocked` keeps Word users from
       * unwrapping the anchor, and the literal run text is what Word (and the
       * free tier) render. The TAG IS ATTACKER-ADJACENT ON READ but authored
       * here; it is written as an ordinary attribute value, so the serializer's
       * escaping covers it like every other attribute.
       */
      readonly op: 'insertInlineContentControl';
      readonly paragraphId: string;
      readonly offset: number;
      readonly tag: string;
      readonly text: string;
      readonly alias?: string;
      /** `w:lock` value; omitted writes no lock. */
      readonly lock?: 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
      /**
       * `w:dataBinding` — the customXml data part node this control mirrors.
       *
       * The payload half of the custom-node contract: `w:tag` caps at 64
       * characters, so anything larger lives in a data part and the control
       * points at it. All three attributes travel together because Word needs
       * all three — the store's `ds:itemID`, the XPath to the node's label, and
       * the prefix declaration that XPath's steps resolve through.
       *
       * A control that carries one is READ-ONLY in Word (verified against
       * `sdt-custom-node-databinding-word-roundtrip.docx`), and this engine
       * refuses content edits inside it for the same reason — see
       * `bindingRefusal`. That is what keeps the store and the page from
       * drifting: there is no edit that could move one without the other.
       *
       * Nothing here is resolved or fetched. The op writes the three strings and
       * the store lane owns the part they name.
       */
      readonly dataBinding?: {
        readonly prefixMappings: string;
        readonly xpath: string;
        readonly storeItemId: string;
      };
      /** Propose the control as a tracked `w:ins`; rejecting removes it with its text. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /** Repeating-section item insert — unsupported at this layer (out of scope). */
      readonly op: 'addRepeatingSectionItem';
      readonly controlId: string;
      readonly index?: number;
    }
  | {
      /** Repeating-section item remove — unsupported at this layer (out of scope). */
      readonly op: 'removeRepeatingSectionItem';
      readonly controlId: string;
      readonly index: number;
    }
  | {
      /**
       * Remove a typed block and everything under it.
       *
       * Validation restricts this structural operation to `w:p`, `w:tbl`, and `w:tr`, and
       * refuses removals that would violate required-container or section-mark invariants.
       */
      readonly op: 'deleteBlock';
      readonly blockId: string;
    }
  | InsertTableOp
  | MoveTableOp
  | InsertParagraphBesideTableOp
  | {
      /** Insert a fresh row above or below a canonical table row. */
      readonly op: 'insertTableRow';
      readonly tableId: string;
      readonly rowId: string;
      readonly where: 'above' | 'below';
      /** When present, author the row as a Word tracked insertion. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /** Delete one canonical table row; refuses the final row. */
      readonly op: 'deleteTableRow';
      readonly tableId: string;
      readonly rowId: string;
      /** Optional anchor cell for column-aware caret recovery after deletion. */
      readonly referenceCellId?: string;
      /** When present, retain the row and author a Word tracked deletion. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /** Insert one grid column left or right of a canonical `w:gridCol`. */
      readonly op: 'insertTableColumn';
      readonly tableId: string;
      readonly where: 'left' | 'right';
      readonly gridColumnId: string;
    }
  | {
      /**
       * Insert one grid column beside a first-row reference cell when `w:tblGrid` is absent.
       * Synthesizes a canonical grid before mutation.
       */
      readonly op: 'insertTableColumn';
      readonly tableId: string;
      readonly where: 'left' | 'right';
      readonly referenceCellId: string;
    }
  | {
      /** Delete one canonical grid column; refuses the final column. */
      readonly op: 'deleteTableColumn';
      readonly tableId: string;
      readonly gridColumnId: string;
    }
  | {
      /** Merge cells covering one rectangle into its top-left cell, content in reading order. */
      readonly op: 'mergeTableCells';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      /** Merge inside this author's own pending table insertion; new structure joins it. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /** Split one cell into `rows` by `columns` equal cells; a one-row cell adds rows. */
      readonly op: 'splitTableCell';
      readonly tableId: string;
      readonly cellId: string;
      readonly rows: number;
      readonly columns: number;
      /** Split inside this author's own pending table insertion; new structure joins it. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /**
       * Resize one internal divider between two adjacent canonical grid columns.
       * Preserves the pair total and sets fixed table layout.
       */
      readonly op: 'setTableColumnWidths';
      readonly tableId: string;
      readonly leftGridColumnId: string;
      readonly rightGridColumnId: string;
      readonly leftWidthTwips: number;
      readonly rightWidthTwips: number;
    }
  | {
      /**
       * Resize the outer-right edge: last grid column, matching cells, and `w:tblW` total.
       */
      readonly op: 'setTableRightEdgeWidth';
      readonly tableId: string;
      readonly gridColumnId: string;
      readonly columnWidthTwips: number;
      readonly tableWidthTwips: number;
    }
  | {
      /** Atomic semantic table authoring. Newly created nodes never need caller-supplied IDs. */
      readonly op: 'authorTable';
      /** Native row revisions. Other structural mutations refuse this option. */
      readonly revision?: RevisionAttributionInput;
      readonly action:
        | {
            readonly kind: 'existing';
            readonly tableId: string;
            readonly mutation: import('./table-authoring-plan.ts').AutomationTableMutation;
          }
        | {
            readonly kind: 'insert';
            readonly paragraphId: string;
            readonly offset: number;
            readonly rowCount: number;
            readonly columnCount: number;
            readonly values?: readonly (readonly string[])[];
          };
    }
  | {
      /** Lossless direct table properties; widths are one value per rectangular grid column. */
      readonly op: 'setTableProperties';
      readonly tableId: string;
      readonly styleId?: string;
      readonly headerRowCount?: number;
      readonly columnWidthsTwips?: readonly number[];
    }
  | {
      /** Set one authored table row to an exact height in twips. */
      readonly op: 'setTableRowHeight';
      readonly tableId: string;
      readonly rowId: string;
      readonly heightTwips: number;
    }
  | {
      /** Clear the active edge target on a bounded rectangular cell selection. */
      readonly op: 'setTableCellBorders';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly scope: 'none';
      readonly target: TableBorderEdgeTarget;
    }
  | {
      /** Apply a complete border spec to the requested edge target. */
      readonly op: 'setTableCellBorders';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly scope: TableBorderEdgeTarget;
      readonly spec: TableBorderSpecInput;
    }
  | {
      /** Write or remove direct selected-cell shading (`w:tcPr/w:shd`). */
      readonly op: 'setTableCellFill';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly color: TreeDocColorValue | null;
    }
  | {
      /** Set direct selected-cell vertical alignment (`w:tcPr/w:vAlign`). */
      readonly op: 'setTableCellVerticalAlignment';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly alignment: 'top' | 'center' | 'bottom';
    }
  | {
      /** Allocate an empty header/footer part and declare it on a section. Package-level. */
      readonly op: 'createHeaderFooter';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
      /** When true, also set section `w:titlePg` in the same package transaction. */
      readonly titlePage?: boolean;
      /** When true, also set document `w:evenAndOddHeaders` in the same package transaction. */
      readonly evenAndOddHeaders?: boolean;
    }
  | {
      /** Remove a section's declared header/footer reference; GC when orphaned. Package-level. */
      readonly op: 'deleteHeaderFooter';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
    }
  | {
      /** Drop a declared ref so the section inherits from the previous. Package-level. */
      readonly op: 'linkToPrevious';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
    }
  | {
      /** Clone an inherited part into a new declared reference. Package-level. */
      readonly op: 'unlinkFromPrevious';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
    }
  | {
      /**
       * Section/document furniture options: `titlePg`, header/footer distances on the
       * section; `evenAndOddHeaders` document-wide in settings. Package-level.
       */
      readonly op: 'setSectionFurnitureOptions';
      readonly sectionIndex?: number;
      readonly titlePage?: boolean;
      readonly evenAndOddHeaders?: boolean;
      readonly headerDistanceTwips?: number;
      readonly footerDistanceTwips?: number;
    }
  | {
      /**
       * Word's Protect Document: enforce or lift `w:documentProtection` in `settings.xml`.
       * Enforcing writes `w:edit="forms"` (filling in forms, the one restriction the store
       * applies); lifting keeps the recorded mode and clears `w:enforcement`, as Word's Stop
       * Protection does. A password-protected file refuses to lift. Package-level.
       */
      readonly op: 'setDocumentProtection';
      readonly enforce: boolean;
    }
  | {
      /** Replace the watermark in every header a section shows; null removes it. Package-level. */
      readonly op: 'setWatermark';
      readonly watermark: import('../package/watermark-package.ts').PackageWatermarkWrite | null;
    }
  | {
      /**
       * Insert a footnote or endnote: body reference + notes-part body (+ create the
       * notes part/rel/content-type when missing). Package-level; one ModelChange.
       */
      readonly op: 'insertNote';
      readonly noteKind: 'footnote' | 'endnote';
      readonly paragraphId: string;
      readonly offset: number;
      /**
       * Write the citing REFERENCE as a tracked insertion (`w:ins` around the reference
       * run), on the same terms as `insertText`. The note body itself is not revision
       * markup: rejecting the reference removes it, and the body cascade sweeps the
       * orphaned note exactly as an untracked reference deletion does.
       */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /**
       * Delete a note body and every matching reference (body, HF, other notes).
       * Package-level; one ModelChange.
       */
      readonly op: 'deleteNote';
      readonly noteKind: 'footnote' | 'endnote';
      readonly noteId: number;
    }
  | {
      /** Convert a footnote ↔ endnote, reallocating id in the target part. Package-level. */
      readonly op: 'convertNote';
      readonly fromKind: 'footnote' | 'endnote';
      readonly noteId: number;
    }
  | {
      /**
       * Convert every normal footnote↔endnote of `fromKind` in one package transaction.
       * One ModelChange / undo unit; bounded by notes-part size.
       */
      readonly op: 'convertAllNotes';
      readonly fromKind: 'footnote' | 'endnote';
    }
  | {
      /**
       * Write a content control's VALUE, in the vocabulary its own type accepts.
       *
       * One transaction for the whole transition: the content, `w:showingPlcHdr`, and the
       * type's own record of the value (`@w:lastValue`, `@w:fullDate`, `w14:checked`) move
       * together, because a control whose glyph says checked and whose flag says unchecked is
       * a document Word and this engine read differently.
       */
      readonly op: 'setContentControlValue';
      readonly controlId: string;
      /** String is the editor-facing v2 form; structured input is the automation form. */
      readonly value: string | ContentControlValueInput;
      /**
       * Propose the value instead of writing it: the shown value is struck (`w:del`) and the
       * new one inserted (`w:ins`) inside the control. The control's recorded state moves to
       * the new value, and accepting or rejecting brings it back in line with what is shown.
       */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /**
       * Author the metadata a control carries: its tag, its title, its lock.
       *
       * `null` removes the property. Everything else in `CT_SdtPr` — the type payload, a data
       * binding, an extension this vocabulary does not model — survives in schema order.
       */
      readonly op: 'setContentControlProperties';
      readonly controlId: string;
      readonly tag?: string | null;
      readonly alias?: string | null;
      readonly lock?: ContentControlLock;
    }
  | {
      /**
       * Remove a control. `keepContent` splices its content into its place — Word's own
       * "Remove content control" — and false takes the content with it.
       */
      readonly op: 'removeContentControl';
      readonly controlId: string;
      /** Defaults to true for the editor-facing v2 operation. */
      readonly keepContent?: boolean;
    }
  | {
      /**
       * Wrap `[start, end)` of a paragraph in a new control of the named type.
       *
       * A control is a SIBLING of runs, never a thing inside one, so a range ending mid-run
       * splits that run at both edges first. The characters and their formatting are the ones
       * that were there; only the run boundaries move.
       */
      readonly op: 'insertContentControl';
      /** Record a wrapper over existing text as a native replacement revision. */
      readonly revision?: RevisionAttributionInput;
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
      readonly type: InsertableContentControlKind;
      readonly tag?: string;
      readonly alias?: string;
      readonly lock?: ContentControlLock;
    }
  | {
      /**
       * Author `w:footnotePr` / `w:endnotePr` at document (settings) or section scope.
       * Refuse endnote `pageBottom`. Package-level; does not invent props on unedited saves.
       */
      readonly op: 'setNoteProperties';
      readonly scope: 'document' | 'section';
      readonly sectionIndex?: number;
      readonly footnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
      readonly endnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
    }
  | {
      /**
       * Insert clipboard-fragment blocks at a paragraph position, atomically.
       *
       * Blocks only — resources (styles, numbering, media, rels, note parts) merge through
       * the package-edit path in the same transaction, and the whole commit is promoted to
       * a package undo unit. A merged edge paragraph takes the properties of the paragraph
       * mark that ends it: the fragment's first mark leading, the host's original mark
       * trailing. Nodes receive fresh ids at apply.
       */
      readonly op: 'insertFragment';
      readonly paragraphId: string;
      readonly offset: number;
      readonly blocks: readonly OoxmlNode[];
      /** True when the fragment's last paragraph mark travelled (its paragraph stays whole). */
      readonly lastMarkCovered?: boolean;
    }
  | {
      readonly op: 'moveInlineDrawing';
      readonly drawingNodeId: string;
      readonly paragraphId: string;
      readonly offset: number;
    }
  | {
      readonly op: 'insertDrawing';
      /** Explicit left bias inserts before a leading prompt. */
      readonly bias?: 'left' | 'right';
      readonly paragraphId: string;
      readonly offset: number;
      readonly drawing: OoxmlDrawingNode;
      /** Present in suggesting mode: the drawing's run goes into a `w:ins` as one proposal. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      readonly op: 'replaceDrawingResource';
      readonly drawingNodeId: string;
      readonly relationshipId: string;
    }
  | {
      readonly op: 'deleteDrawing';
      readonly drawingNodeId: string;
      /** Suggesting-mode tracked deletion is refused; owned by typed-revisions-and-comments. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      readonly op: 'resizeDrawing';
      readonly drawingNodeId: string;
      readonly extentEmu: { readonly cx: number; readonly cy: number };
      /**
       * `release` turns off a text box's "Resize shape to fit text": `a:spAutoFit` becomes
       * `a:noAutofit`, so the box keeps the height given. Absent keeps the fit.
       */
      readonly textFit?: 'release';
    }
  | { readonly op: 'cropDrawing'; readonly drawingNodeId: string; readonly crop: SourceCrop }
  | {
      readonly op: 'positionDrawing';
      readonly drawingNodeId: string;
      readonly position: DrawingPositionInput;
    }
  | {
      readonly op: 'setDrawingWrap';
      readonly drawingNodeId: string;
      readonly wrap: ImageWrapTarget;
    }
  | {
      readonly op: 'setDrawingMetadata';
      readonly drawingNodeId: string;
      readonly title: string;
      readonly description: string;
      /** Omitted preserves existing `a:hlinkClick`; null removes it; a URL needs a package transaction. */
      readonly hyperlink?: string | null;
    }
  | {
      readonly op: 'setDrawingLocks';
      readonly drawingNodeId: string;
      readonly locks: DrawingLocksInput;
    }
  | {
      readonly op: 'transformDrawing';
      readonly drawingNodeId: string;
      readonly action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';
    }
  | {
      /**
       * Set the fill or outline of a shape, a text box, a line, or every shape of a group.
       * One undo unit; a VML fallback that draws the same shapes follows.
       */
      readonly op: 'setShapeFormat';
      /** The `w:drawing`, the `mc:AlternateContent` that holds it, or a legacy `w:pict`. */
      readonly drawingNodeId: string;
      /** One `wps:wsp` or VML shape of the drawing. Omitted formats every shape it holds. */
      readonly shapeNodeId?: string;
      readonly fill?: ShapeFillInput;
      readonly outline?: ShapeOutlineInput;
    }
  | {
      /**
       * Replace a detected TOC field's cached result paragraphs and ensure heading bookmarks.
       * Preserves field chrome / instruction. One undo unit (phase A of TOC refresh).
       */
      readonly op: 'replaceTocResult';
      readonly tocId: string;
      readonly entries: readonly {
        readonly level: number;
        readonly text: string;
        readonly headingParagraphId: string;
        readonly bookmarkName: string;
        readonly pageNumberText: string;
      }[];
      readonly bookmarksToCreate: readonly {
        readonly paragraphId: string;
        readonly name: string;
      }[];
    }
  | {
      /**
       * Remove a detected table of contents: its field, or the whole control the field fills.
       * Text before and after the field stays, in one paragraph. One undo unit.
       */
      readonly op: 'removeToc';
      readonly tocId: string;
    }
  | {
      /**
       * Rewrite page-number text runs inside existing TOC result paragraphs.
       * One undo unit (phase B of TOC refresh).
       */
      readonly op: 'rewriteTocPageNumbers';
      readonly tocId: string;
      readonly updates: readonly {
        readonly paragraphId: string;
        readonly pageNumberText: string;
      }[];
    }
  | SetTextFormFieldDefaultOp
  | CommitTextFormFieldOp
  | SetLegacyCheckboxOp
  | SetLegacyDropdownOp
  | InsertBuildingBlockOp
  | InsertBookmarkOp
  | DeleteBookmarkOp
  | {
      /**
       * Rewrite recognized fields' cached RESULT runs in place — between the `separate` and
       * `end` fldChars, or a `w:fldSimple`'s content. The instruction is never modified; a
       * result holding anything but plain runs is skipped (see `tree-op-field-results.ts`).
       */
      readonly op: 'refreshFieldResults';
      readonly updates: readonly {
        readonly paragraphId: string;
        /** Node id of the field's begin `w:fldChar`, or of the `w:fldSimple` element. */
        readonly fieldNodeId: string;
        readonly text: string;
      }[];
    };

/** Drawing mutation ops from typed-drawings-and-images task 11. */
export type DrawingTreeDocOp = Extract<
  TreeDocOp,
  {
    readonly op:
      | 'moveInlineDrawing'
      | 'insertDrawing'
      | 'replaceDrawingResource'
      | 'deleteDrawing'
      | 'resizeDrawing'
      | 'cropDrawing'
      | 'positionDrawing'
      | 'setDrawingWrap'
      | 'setDrawingMetadata'
      | 'setDrawingLocks'
      | 'transformDrawing'
      | 'setShapeFormat';
  }
>;

/**
 * A theme colour of a shape fill or outline: a slot of the document theme, lighter or darker by
 * `shift` percent (`40` is Lighter 40%, `-25` is Darker 25%). It writes `a:schemeClr` with the
 * `a:lumMod` and `a:lumOff` that the theme colour grid writes. @public
 */
export interface ShapeThemeColorInput {
  readonly name: ShapeThemeColorName;
  /** From -100 to 100; 0 or omitted is the theme colour itself. */
  readonly shift?: number;
}

/** The theme colour slots a shape colour can name. @public */
export type ShapeThemeColorName =
  | 'bg1'
  | 'tx1'
  | 'bg2'
  | 'tx2'
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6';

/**
 * A shape fill to write: none, or solid. A solid fill without `color` keeps the shape's colour,
 * or brings back the one a hidden fill kept. `transparency` runs from 0 (opaque) to 1 (clear).
 * With `theme`, the DrawingML shape takes the theme reference and `color` is the `RRGGBB` it
 * resolves to, which a VML copy writes.
 *
 * @public
 */
export type ShapeFillInput =
  | { readonly type: 'none' }
  | {
      readonly type: 'solid';
      readonly color?: string;
      readonly theme?: ShapeThemeColorInput;
      readonly transparency?: number;
    };

/**
 * A preset outline dash (ECMA-376 Part 1, 20.1.10.48 `ST_PresetLineDashVal`). `solid` is a
 * plain line; the `sys` presets scale with the line width in short steps. @public
 */
export type ShapeOutlineDash =
  | 'solid'
  | 'sysDot'
  | 'sysDash'
  | 'sysDashDot'
  | 'sysDashDotDot'
  | 'dot'
  | 'dash'
  | 'lgDash'
  | 'dashDot'
  | 'lgDashDot'
  | 'lgDashDotDot';

/**
 * A shape outline to write. Omitted fields keep their value. `color` is `RRGGBB`; `widthPt`
 * runs from 0.25 to 1584 points; `dash` writes `a:prstDash` (and `v:stroke/@dashstyle` on a
 * VML shape).
 *
 * @public
 */
export interface ShapeOutlineInput {
  readonly visible?: boolean;
  readonly color?: string;
  /** A theme reference for the DrawingML outline; `color` is then its `RRGGBB`. */
  readonly theme?: ShapeThemeColorInput;
  readonly widthPt?: number;
  readonly dash?: ShapeOutlineDash;
}

/** Just the `op` discriminants, for dispatch tables and validation. */
export type TreeDocOpKind = TreeDocOp['op'];

export { TREE_DOC_OP_KINDS } from './tree-op-kinds.ts';
export type { TreeOpRejection } from './tree-op-rejection.ts';

/**
 * How far a committed op can reach, so layout can scope its work (task 5.2).
 *
 * `text-local` touches one paragraph's characters; `paragraph-local` changes one
 * paragraph's own properties; `flow-structural` changes the block sequence and can
 * repaginate everything after it; `global` invalidates every page that shares the
 * edited story (header/footer parts attached to many sections/pages).
 */
/**
 * How far an op's effects reach — what layout must re-do after it.
 *
 * The knob incremental layout turns: a `text-local` edit re-breaks one paragraph, while a
 * `global` one invalidates the document.
 */
export type ImpactClass = 'text-local' | 'paragraph-local' | 'flow-structural' | 'global';

/**
 * What one applied op changed: the ids dirtied, created and deleted.
 *
 * These ids are what let layout and paint re-do only what moved instead of the whole document.
 */
export interface TreeOpEffect {
  readonly dirty: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
  readonly split?: { readonly from: string; readonly tail: string };
  /** One entry per boundary of a many-way split, in document order. */
  readonly splits?: readonly { readonly from: string; readonly tail: string }[];
  readonly join?: { readonly kept: string; readonly removed: string };
  readonly dependencyKeys: readonly string[];
  readonly impact: ImpactClass;
  /**
   * Post-edit caret paragraph, at `offset` (default 0). Structural ops set it, and
   * `insertFragment` sets it to the end of the inserted content.
   */
  readonly caret?: { readonly paragraphId: string; readonly offset?: number };
}

/** Post-edit caret target published by a committed store transaction. */
export interface TreeOpCaret {
  readonly paragraphId: string;
}

/** Whether an op applied, with the effect it produced or the reason it was refused. */
export type TreeOpResult =
  | { readonly ok: true; readonly part: OoxmlPart; readonly effect: TreeOpEffect }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };
