// The story-parity rule: what an operation may do differently depending on which story the
// caret is in.
//
// A DOCX holds several independent stories: the body, each header and footer part, and the
// footnote and endnote parts. Two specs already require that editing behaves the same in all
// of them:
//
//   - `scoped-header-footer-editing/specs/header-footer-editing/spec.md`: a command enabled in
//     an open header scope "SHALL apply to that story with the same semantics it would have on
//     equivalent body content".
//   - `typed-notes-footnotes-endnotes/specs/notes-authoring-surface/spec.md`: typing, formatting
//     and undo "SHALL behave as in the body", and the toolbar reflects the formatting there.
//
// Nothing enforced that, so the engine drifted: reads indexed the body while writes stayed
// scoped, and the two disagreed. This file is the machine-readable rule. Its tests check the
// engine against it by running the same operation on an identical paragraph in every story.
//
// `SLOT_PARITY` is a `Record<ChromeSlotId, ...>`, so a slot added to `CHROME_GROUPS` without a
// declared rule has no rule to satisfy. That is caught by the `every chrome slot declares a
// rule` test, NOT by the compiler: `packages/core/tsconfig.json` excludes every `__tests__`
// directory, so nothing here is typechecked. If that exclusion is ever lifted, the `Record`
// annotation starts failing the build too, which is strictly better — but do not rely on it
// today, and do not repeat the claim that it already happens.

import type { ChromeSlotId } from '../chrome-controls.ts';

/** The stories the contract covers. Text boxes are not an editable scope yet. */
export type StoryKind = 'body' | 'header' | 'footer' | 'footnote' | 'endnote';

export const STORY_KINDS: readonly StoryKind[] = [
  'body',
  'header',
  'footer',
  'footnote',
  'endnote',
];

/** Every story that is not the body. The ones a body-only read gets wrong. */
export const FURNITURE_AND_NOTE_STORIES: readonly StoryKind[] = [
  'header',
  'footer',
  'footnote',
  'endnote',
];

/**
 * What a control may do differently per story.
 *
 * `bodyOnly` and `furnitureOnly` carry the REQUIRED refusal reason, and the tests assert it in
 * every story that must refuse. That field is the point of the type. A refusal that merely
 * says "disabled" cannot be told apart from one the engine never meant to make, and a rule
 * that only checked "is it disabled" would ratify both.
 */
export type ParityRule =
  /** Identical enabled / active / value in every story. */
  | { readonly parity: 'same' }
  /**
   * Live in the body, refused everywhere else with exactly `reason`.
   *
   * `bodyRefusedAt` names the probe labels where the body legitimately refuses it too, for a
   * reason that has nothing to do with story scope. It is deliberately a LIST rather than a
   * blanket exemption: dropping the body-liveness check wholesale would let a body-only
   * command go dead at three of four carets and still pass, because every story would refuse
   * it identically and identical refusals read as parity.
   */
  | {
      readonly parity: 'bodyOnly';
      readonly reason: string;
      readonly bodyRefusedAt?: readonly string[];
    }
  /** Live in a header or footer, refused in the body and in notes with exactly `reason`. */
  | { readonly parity: 'furnitureOnly'; readonly reason: string };

/**
 * The rule for every chrome slot.
 *
 * Almost everything is `same`. A control that formats, inserts or deletes text has no business
 * caring which story it is in, which is what both specs say. The exceptions are the four
 * commands that address body structure (a table of contents, the two note references, a
 * section break) and the four that address page furniture (the page-number fields).
 */
export const SLOT_PARITY: Readonly<Record<ChromeSlotId, ParityRule>> = Object.freeze({
  'history.undo': { parity: 'same' },
  'history.redo': { parity: 'same' },
  'zoom.level': { parity: 'same' },
  'styles.style': { parity: 'same' },
  'font.family': { parity: 'same' },
  'font.size': { parity: 'same' },
  'text.bold': { parity: 'same' },
  'text.italic': { parity: 'same' },
  'text.underline': { parity: 'same' },
  'text.strike': { parity: 'same' },
  'text.color': { parity: 'same' },
  'text.highlight': { parity: 'same' },
  'text.link': { parity: 'same' },
  'script.super': { parity: 'same' },
  'script.sub': { parity: 'same' },
  'alignment.left': { parity: 'same' },
  'alignment.center': { parity: 'same' },
  'alignment.right': { parity: 'same' },
  'alignment.justify': { parity: 'same' },
  'direction.ltr': { parity: 'same' },
  'direction.rtl': { parity: 'same' },
  'list.bullet': { parity: 'same' },
  'list.numbered': { parity: 'same' },

  // The Paragraph dialog writes paragraph formatting, which is the whole subject of this
  // contract: alignment, indents and spacing mean the same thing in a header as in the body.
  // Declared `same` and left to the sweep to prove rather than assumed.
  'paragraph.dialog': { parity: 'same' },
  'list.outdent': { parity: 'same' },
  'list.indent': { parity: 'same' },
  'list.lineSpacing': { parity: 'same' },
  // The painter copies and paints run and paragraph formatting, which is the whole subject
  // of this contract: it means the same thing in a header as in the body.
  'format.painter': { parity: 'same' },
  'format.clear': { parity: 'same' },
  'review.comments': { parity: 'same' },
  'review.revisionMarkup': { parity: 'same' },
  'review.simpleMarkup': { parity: 'same' },
  'review.allMarkup': { parity: 'same' },
  'review.noMarkup': { parity: 'same' },
  'review.original': { parity: 'same' },
  'review.previousChange': { parity: 'same' },
  'review.nextChange': { parity: 'same' },
  'review.acceptAllChanges': { parity: 'same' },
  'review.rejectAllChanges': { parity: 'same' },
  'review.paragraphMarks': { parity: 'same' },
  'review.bookmarks': { parity: 'same' },
  'review.protectDocument': { parity: 'same' },
  // Compare works on the whole document, so the caret's story does not change it.
  'review.compareDocuments': { parity: 'same' },
  'review.addComment': { parity: 'same' },
  'review.authors': { parity: 'same' },
  'review.editingMode': { parity: 'same' },
  'contentControl.showAll': { parity: 'same' },
  'contentControl.formFill': { parity: 'same' },
  'contentControl.inspector': { parity: 'same' },
  'contentControl.remove': { parity: 'same' },
  'image.insert': { parity: 'same' },
  'image.properties': { parity: 'same' },
  'image.wrap': { parity: 'same' },
  'image.altText': { parity: 'same' },
  'image.editChart': { parity: 'same' },
  'image.formatShape': { parity: 'same' },
  'shape.fill': { parity: 'same' },
  'shape.fillTransparency': { parity: 'same' },
  'shape.outlineColor': { parity: 'same' },
  'shape.outlineWidth': { parity: 'same' },
  'shape.outlineDash': { parity: 'same' },
  'chart.type': { parity: 'same' },
  'chart.title': { parity: 'same' },
  'chart.legend': { parity: 'same' },
  'chart.dataLabels': { parity: 'same' },
  'chart.axes': { parity: 'same' },
  'chart.gridlines': { parity: 'same' },
  'chart.categoryAxisTitle': { parity: 'same' },
  'chart.valueAxisTitle': { parity: 'same' },
  'chart.seriesColor': { parity: 'same' },
  'chart.data': { parity: 'same' },
  'insert.chart': { parity: 'same' },
  'table.insert': { parity: 'same' },
  'table.borderTarget': { parity: 'same' },
  'table.borderColor': { parity: 'same' },
  'table.borderStyle': { parity: 'same' },
  'table.borderWidth': { parity: 'same' },
  'table.cellFill': { parity: 'same' },
  'table.mergeCells': { parity: 'same' },
  'table.splitCell': { parity: 'same' },
  'file.open': { parity: 'same' },
  'file.save': { parity: 'same' },
  'file.exportMarkdown': { parity: 'same' },
  'file.exportPdf': { parity: 'same' },
  'file.print': { parity: 'same' },
  'file.pageSetup': { parity: 'same' },
  'insert.watermark': { parity: 'same' },
  'insert.bookmark': { parity: 'same' },
  'insert.goToBookmark': { parity: 'same' },

  // A note reference is a body-story concept: `w:footnoteReference` lives in the main document
  // part, and Word refuses a note inside a note for the same reason.
  'insert.textBox': {
    parity: 'bodyOnly',
    reason: 'Textboxes can only be inserted in body editing mode',
  },
  'insert.footnote': { parity: 'bodyOnly', reason: 'insertNote requires body scope' },
  'insert.endnote': { parity: 'bodyOnly', reason: 'insertNote requires body scope' },

  // A table of contents indexes the body outline and lives in the body.
  'insert.toc': {
    parity: 'bodyOnly',
    reason: 'a table of contents can only be inserted in the editable document body',
    // Word refuses a TOC inside a content control, in the body as much as anywhere else. The
    // engine publishes one string for every `canInsertToc` falsehood, so the reason it gives
    // there talks about the body while the caret IS in the body — misleading, and the reason
    // this is an exemption rather than a passing assertion.
    bodyRefusedAt: ['a block content control'],
  },

  // Only the body paginates. A header is laid out once per variant at flow height and attached
  // to every page; a note flows inside the note area. A `w:br w:type="page"` in either is markup
  // nothing reads, so the command used to report `ok`, change the part, and change nothing on
  // screen. Declaring it `same` would have ratified that.
  'insert.pageBreak': {
    parity: 'bodyOnly',
    reason: 'a page break can only be inserted in the editable document body',
  },

  // A section break splits the body's `w:sectPr` chain, and `insertSectionBreak` refuses
  // outside the body. That refusal used to be invisible — `can` saw only the static break
  // vocabulary — so the control rendered live in a header and pressing it did nothing. The
  // reason below is what the gate publishes now.
  'insert.sectionBreakNextPage': {
    parity: 'bodyOnly',
    reason: 'a section break can only be inserted in the editable document body',
  },
  // The continuous break splits the same `w:sectPr` chain, so it refuses outside the body for
  // the same reason its next-page twin does.
  'insert.sectionBreakContinuous': {
    parity: 'bodyOnly',
    reason: 'a section break can only be inserted in the editable document body',
  },

  // PAGE / NUMPAGES / SECTIONPAGES project per page, so they mean something only in furniture.
  'insert.pageNumber': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
  'insert.totalPages': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
  'insert.sectionPages': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
  'insert.pageXofY': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
} as const);

/** Which observable a defect shows up in, so an entry cannot be kept alive by an unrelated one. */
export type ParityDimension = 'enabled' | 'active' | 'value' | 'reason';

export interface KnownBroken {
  /** The dimension that must still diverge. A defect fixed in `active` cannot hide behind `enabled`. */
  readonly dimension: ParityDimension;
  /** The root cause, named precisely enough to start from. */
  readonly cause: string;
}

/**
 * Slots the engine does NOT satisfy yet.
 *
 * EMPTY. The change that introduced this contract drained it; the machinery stays for the next
 * parity defect, which is the point at which arguing about whether to keep it would cost more
 * than it saves.
 *
 * When it has entries, the tests assert each still fails IN THE NAMED DIMENSION, so the list
 * cannot rot: fixing one without removing its entry fails as loudly as breaking one. Every
 * entry is a defect with a known root cause, never "this is fine really" — a control that is
 * legitimately different belongs in {@link SLOT_PARITY} as `bodyOnly` or `furnitureOnly`.
 */
export const KNOWN_BROKEN: Readonly<Partial<Record<ChromeSlotId, KnownBroken>>> = Object.freeze({});
