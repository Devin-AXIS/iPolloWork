import type { AutomationAuthoringOperation } from './authoring-operations.ts';
import type {
  AutomationContentControlLock,
  AutomationContentControlOperation,
} from './content-control-operations.ts';
// Operations read one package snapshot or commit through the canonical transaction path.
// Reads resolve existing handles before writes commit. Created objects become addressable
// after commit. Endpoints use paragraph handles and UTF-16 offsets, or story edges.

import type { AutomationFontWrite, AutomationParagraphFormatWrite } from './formatting.ts';
import type { AutomationEndpoint, AutomationHandle } from './protocol.ts';
import type { AutomationPageSetupWrite } from './sections.ts';
import type { HeaderFooterVariant } from '../store/package/hf-references.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';

/**
 * A position in a story.
 *
 * Either exact, or an EDGE of something the host can measure: a story, or one paragraph.
 * `{ body, at: 'end' }` is the position after the last character of the last paragraph, which is
 * what "append to the document" means; `{ paragraph, at: 'end' }` is the same for one paragraph.
 *
 * The edges are not sugar. A caller has no way to know a paragraph's length without reading it
 * first, so "insert at the end of this paragraph" would otherwise cost a round trip and then
 * carry an offset that a concurrent edit could have invalidated. The host knows the length at
 * the moment it plans, so the edge is both shorter and correct.
 */
export type AutomationPoint =
  | AutomationEndpoint
  | { readonly paragraph: AutomationHandle; readonly at: 'start' | 'end' }
  | { readonly body: AutomationHandle; readonly at: 'start' | 'end' };

/**
 * A stretch of a story to read, replace, or select.
 *
 * `{ body }` is the whole story — every paragraph, first offset to last — and `{ paragraph }` is
 * the whole of one paragraph. Spelling both as their own shapes rather than making the caller
 * find the edges keeps "replace the body" and "clear this paragraph" single operations, which is
 * what makes each of them one transaction.
 */
export type AutomationSpanRef =
  | { readonly start: AutomationPoint; readonly end: AutomationPoint }
  | { readonly paragraph: AutomationHandle }
  | { readonly body: AutomationHandle };

export type {
  AutomationContentControlLock,
  AutomationContentControlRangeLocation,
  AutomationContentControlScope,
  AutomationContentControlSubtype,
  AutomationContentControlValue,
} from './content-control-operations.ts';

/**
 * Which paragraph a structural command is anchored at.
 *
 * A story edge resolves to its first or last paragraph. An empty story has neither, and the
 * command is refused rather than inventing a block: creating a paragraph in a story that holds
 * none is a different operation than inserting beside one, and this protocol has only the
 * second (see the object model's recorded omissions).
 */
export type AutomationParagraphRef =
  | { readonly paragraph: AutomationHandle }
  | { readonly body: AutomationHandle; readonly at: 'first' | 'last' };

/**
 * How a story search is narrowed.
 *
 * Every flag is either honoured or REFUSED — never accepted and ignored. A search that quietly
 * dropped `matchWildcards` would answer plain-text matches to a caller who asked for pattern
 * ones, which is worse than saying no.
 */
export interface AutomationSearchOptions {
  readonly matchCase?: boolean;
  readonly matchWholeWord?: boolean;
  /** Display or raw model text to search. `allMarkup` preserves the historical behavior. */
  readonly projection?: AutomationTextProjection;
  /** Not supported; `true` is refused. Punctuation-insensitive matching is not implemented. */
  readonly ignorePunct?: boolean;
  /** Not supported; `true` is refused. Whitespace-insensitive matching is not implemented. */
  readonly ignoreSpace?: boolean;
  /** Not supported; `true` is refused. There is no wildcard grammar behind this protocol. */
  readonly matchWildcards?: boolean;
  /** Tighten the result cap. Clamped to the engine's own limit; never raised past it. */
  readonly limit?: number;
}

/**
 * Which text an automation read exposes.
 *
 * `allMarkup` includes pending insertions, deletions, and both sides of replacements. `original`
 * matches Word's Original review view: deletions remain visible and insertions are hidden.
 * Both are display text and expand saved field results. `model` returns raw model text with
 * atomic fields represented by `U+FFFC`. Only `model` shares the protocol's offset vocabulary.
 */
export type AutomationTextProjection = 'allMarkup' | 'original' | 'model';

/** Where a selection lands. `start`/`end` collapse it to one edge of the span. */
export type AutomationSelectionMode = 'select' | 'start' | 'end';

/**
 * Every operation a host answers: the whole read-and-write vocabulary, as one discriminated
 * union keyed on `op`.
 *
 * Reads never open a transaction; commands in one batch commit together. Handles are NAMES the
 * host minted, never pointers, so an operation is plain transport data.
 */
export type AutomationOperation =
  | AutomationAuthoringOperation
  | AutomationContentControlOperation
  | { readonly op: 'getChangeTrackingMode' }
  | {
      readonly op: 'setChangeTrackingMode';
      readonly mode: 'Off' | 'TrackAll' | 'TrackMineOnly';
      readonly author?: string;
    }
  /** The document itself — the root every other handle is reached through. */
  | { readonly op: 'getDocument' }
  | { readonly op: 'removeDocumentInformation'; readonly removeDocInfoType: string }
  /**
   * Compare the document (the original) with a revised DOCX given as base64 and record the
   * differences as tracked changes in this document. Needs a host compare engine.
   */
  | {
      readonly op: 'compareFromBase64';
      readonly base64: string;
      readonly authorName?: string;
      readonly detectFormatChanges?: boolean;
      readonly removeDateAndTime?: boolean;
    }
  /**
   * Replace the whole document with a DOCX given as base64, as one undoable edit that a
   * collaboration session shares like any other. Answers the new body's whole span.
   */
  | { readonly op: 'replaceDocumentFromBase64'; readonly base64: string }
  | {
      readonly op: 'getDocumentProperty';
      readonly name: import('../store/package/document-property-writes.ts').DocumentPropertyName;
    }
  /**
   * The styles `styles.xml` defines, of every kind, in part order. `setStyle` accepts paragraph
   * style names only; character, table, and numbering names are listed but refused there.
   *
   * Give at most one of these to ask a narrower question:
   * - `name`: the answer holds at most the one style that name finds. Names compare without case
   *   and surrounding spaces, as `setStyle` compares them, and a paragraph style wins over another
   *   kind with the same name. A name longer than 255 characters finds nothing.
   * - `id`: the answer holds at most the listed style with that `w:styleId`.
   * - `count: true`: the answer is the number of listed styles, as a `number` value.
   */
  | {
      readonly op: 'getStyles';
      readonly name?: string;
      readonly id?: string;
      readonly count?: true;
    }
  | {
      readonly op: 'setDocumentProperties';
      readonly values: import('../store/package/document-property-writes.ts').DocumentPropertyWrites;
    }
  /** The main story of a document. */
  | { readonly op: 'getBody'; readonly document: AutomationHandle }
  /**
   * A story's paragraphs, in reading order.
   *
   * Includes paragraphs inside tables — descending through rows, cells and nested tables — and
   * inside block-level content controls, because those are ordinary editable paragraphs and
   * Word's own paragraph collection contains them. A story with no paragraphs answers none.
   */
  | { readonly op: 'getParagraphs'; readonly body: AutomationHandle }
  /** The paragraphs a span covers, in reading order. */
  | { readonly op: 'getSpanParagraphs'; readonly span: AutomationSpanRef }
  /**
   * Text of a body or a paragraph.
   *
   * A story reads as its paragraphs joined by a carriage return — one paragraph mark, one
   * `\r` — which is the separator Word's own text property uses. Display projections expand
   * fields, so clients must not derive model offsets from this text.
   */
  | {
      readonly op: 'getText';
      readonly target: AutomationHandle;
      readonly projection?: AutomationTextProjection;
    }
  /**
   * Display text between two endpoints, with a carriage return at each paragraph boundary.
   * Use the `model` projection when a client needs text in the endpoint offset vocabulary.
   */
  | {
      readonly op: 'getSpanText';
      readonly span: AutomationSpanRef;
      readonly projection?: AutomationTextProjection;
    }
  /**
   * A span split into ranges that each end after one of `endingMarks`, or at a paragraph end.
   *
   * Boundaries come from the model text, so a field, an equation, or another atom is never
   * split. `trimSpacing` removes spaces, tabs, and column breaks from each range's edges and
   * drops a range left empty. A range the projection shows no character of is not answered.
   */
  | {
      readonly op: 'getTextRanges';
      readonly scope: AutomationSpanRef;
      readonly endingMarks: readonly string[];
      readonly trimSpacing?: boolean;
      readonly projection?: AutomationTextProjection;
    }
  /**
   * A paragraph's text in a view, as `texts` with one text, or with none when the paragraph
   * left its story. A paragraph that is gone is an answer here, not a refusal, so a client that
   * checks many paragraphs it read earlier keeps the rest of its batch.
   */
  | {
      readonly op: 'getParagraphTextIfPresent';
      readonly paragraph: AutomationHandle;
      readonly projection?: AutomationTextProjection;
    }
  /**
   * The model span of a non-empty range of a paragraph's text in a view. `start` and `length`
   * count UTF-16 code units of the text `getText` answers with the same projection. A range
   * inside an expanded field result answers the whole field.
   */
  | {
      readonly op: 'getParagraphTextSpan';
      readonly paragraph: AutomationHandle;
      readonly start: number;
      readonly length: number;
      readonly projection?: AutomationTextProjection;
    }
  /** The smallest span covering both spans. Both must be in one story. */
  | { readonly op: 'expandSpan'; readonly span: AutomationSpanRef; readonly to: AutomationSpanRef }
  /**
   * A span's text as if every pending revision were accepted (`current`) or rejected
   * (`original`), with a carriage return at each paragraph mark that view keeps.
   */
  | {
      readonly op: 'getReviewedText';
      readonly span: AutomationSpanRef;
      readonly version: 'original' | 'current';
    }
  /**
   * A paragraph's own identity as the DOCUMENT writes it (`w14:paraId`).
   *
   * Not an index and not a handle ref: it survives paragraphs being inserted or deleted around
   * it, and it is the same value a file written by Word carries.
   */
  | { readonly op: 'getParagraphId'; readonly paragraph: AutomationHandle }
  /**
   * Every occurrence of `text` inside a scope, in reading order, as spans.
   *
   * The scope is a span, so `{ body }` searches a whole story and a pair of endpoints searches
   * part of one. There is no "search the whole document" — a document is several stories, and
   * answering one story's matches to that request would be a claim about the others.
   */
  | {
      readonly op: 'search';
      readonly scope: AutomationSpanRef;
      readonly text: string;
      readonly options?: AutomationSearchOptions;
    }
  /**
   * Insert text at a position. Answers the span the inserted text occupies.
   *
   * Offsets in one batch are validated against the state at the START of the batch, and the
   * commands apply in order INSIDE one transaction — so two insertions into the same paragraph
   * shift each other exactly as two sequential edits would, and the second answer's offsets are
   * the ones it was planned with. Addressing distinct paragraphs keeps a batch
   * order-independent.
   */
  /** Explicit inline Word revision, independent of a browser's editing mode. */
  | {
      readonly op: 'proposeInsertion';
      readonly span: AutomationSpanRef;
      readonly text: string;
      readonly where: 'Before' | 'After';
      readonly author: string;
    }
  | {
      readonly op: 'proposeDeletion';
      readonly span: AutomationSpanRef;
      readonly author: string;
    }
  | {
      readonly op: 'proposeReplacement';
      readonly span: AutomationSpanRef;
      readonly text: string;
      readonly author: string;
    }
  | { readonly op: 'insertText'; readonly at: AutomationPoint; readonly text: string }
  /**
   * Replace a span with text, which may be empty — that is how a deletion is spelled.
   *
   * A span that crosses paragraph marks removes the paragraphs between its endpoints and joins
   * what is left, because that is what deleting a stretch of a document means. A join across a
   * table-cell boundary is refused by the canonical mutation path, and the whole batch is then
   * refused: half a deletion is not an outcome this protocol offers.
   */
  | { readonly op: 'replaceSpan'; readonly span: AutomationSpanRef; readonly text: string }
  /**
   * Replace a story's complete block structure with fresh plain paragraphs.
   *
   * This is the fresh-document operation. It removes tables, content controls, paragraph-level
   * section marks, comments, and revisions. A body's final page-level section properties survive.
   */
  | {
      readonly op: 'replaceStoryBlocks';
      readonly body: AutomationHandle;
      readonly paragraphs: readonly string[];
    }
  /**
   * Insert a paragraph beside another one. Answers the NEW paragraph's handle.
   *
   * Resolved after the commit, because the paragraph it names does not exist until then.
   */
  | {
      readonly op: 'insertParagraph';
      readonly anchor: AutomationParagraphRef;
      readonly where: 'before' | 'after';
      readonly text: string;
    }
  /**
   * Split a paragraph at every occurrence of any delimiter. Answers a span per resulting
   * paragraph, in reading order, including the one that keeps the original identity.
   */
  | {
      readonly op: 'splitParagraph';
      readonly paragraph: AutomationHandle;
      readonly delimiters: readonly string[];
      /** Drop the delimiter characters themselves. */
      readonly trimDelimiters?: boolean;
      /** Drop leading and trailing whitespace from each resulting paragraph. */
      readonly trimSpacing?: boolean;
    }
  /**
   * What the characters a span covers AGREE about their formatting.
   *
   * Not "what does this text look like": a value inherited from `styles.xml` reads as no agreed
   * value, because this lane reads what the document authors and a write merges against the
   * same thing. See `formatting.ts`.
   */
  | { readonly op: 'getFont'; readonly span: AutomationSpanRef }
  /**
   * Author run properties over a span. Only the fields present are written.
   *
   * A span covering a WHOLE paragraph also writes the paragraph MARK's own `w:rPr`, which is
   * what Word does — the pilcrow carries the formatting a list marker inherits its face from,
   * so sizing a bulleted paragraph without it leaves the bullet at the old size.
   */
  | { readonly op: 'setFont'; readonly span: AutomationSpanRef; readonly font: AutomationFontWrite }
  /**
   * The paragraph style NAME every paragraph a span covers agrees on.
   *
   * The name a reader sees (`heading 1`), not the internal `w:styleId` (`Heading1`) — the two are
   * routinely different, and the id is not the vocabulary an object model talks in.
   */
  | { readonly op: 'getStyle'; readonly span: AutomationSpanRef }
  /**
   * Apply a paragraph style, by name, to every paragraph a span covers.
   *
   * A name the document does not already define is REFUSED. Minting the definition would report a
   * style applied for one with no formatting in it — the paragraph unchanged on screen, styled when
   * read back — and would turn a caller's string into a new part.
   */
  | { readonly op: 'setStyle'; readonly span: AutomationSpanRef; readonly name: string }
  /** One paragraph's own paragraph properties, in points. */
  | { readonly op: 'getParagraphFormat'; readonly paragraph: AutomationParagraphRef }
  /**
   * The five borders a paragraph shows, in collection order: top, left, bottom, right, then the
   * border between paragraphs. Resolved through the style cascade, as the page paints them.
   */
  | { readonly op: 'getParagraphBorders'; readonly paragraph: AutomationParagraphRef }
  /** Author paragraph properties. Only the fields present are written. */
  | {
      readonly op: 'setParagraphFormat';
      readonly paragraph: AutomationParagraphRef;
      readonly format: AutomationParagraphFormatWrite;
    }
  /** Remove a paragraph and everything in it. */
  | { readonly op: 'deleteParagraph'; readonly paragraph: AutomationHandle }
  /**
   * The document's sections, in document order.
   *
   * A document nobody sectioned still has one: the body-level `w:sectPr` Word writes even for a
   * file that has never been sectioned. The index a section answers to is the one the furniture
   * lifecycle ops take, so a read here and a header written afterwards agree about which section
   * is which.
   */
  | { readonly op: 'getSections'; readonly document: AutomationHandle }
  /** One section's page geometry, in points. */
  | { readonly op: 'getPageSetup'; readonly section: AutomationHandle }
  /**
   * Author page geometry on ONE section — Word's "Apply to: This section".
   *
   * Only the fields present are written; the rest of that `w:sectPr` is left exactly as authored.
   * `orientation` without dimensions swaps the section's own, so a document of mixed paper sizes
   * survives a flip. A dimension outside what a page can be is refused rather than clamped.
   */
  | {
      readonly op: 'setPageSetup';
      readonly section: AutomationHandle;
      readonly setup: AutomationPageSetupWrite;
    }
  /**
   * The header or footer story a section declares or inherits, as a BODY.
   *
   * A variant the document has neither declared nor inherited is still answered, as an empty
   * body: every read on it answers what it answers for an empty story. Asking does not create
   * the part. The first text written into the body creates it; any other write that would change
   * the body is refused until then.
   */
  | {
      readonly op: 'getFurniture';
      readonly section: AutomationHandle;
      readonly kind: 'header' | 'footer';
      readonly variant: HeaderFooterVariant;
    }
  /**
   * Every footnote or endnote the document holds, in the order its notes part writes them.
   *
   * The reserved separator and continuation-separator notes (`w:id` -1 and 0) are not notes a
   * caller can reach: reporting them would say the document has two more footnotes than it has.
   */
  | {
      readonly op: 'getNotes';
      readonly document: AutomationHandle;
      readonly noteKind: NoteKind;
      readonly scope?: AutomationHandle;
    }
  /** One note's story, as a BODY. Two notes in one part are two stories. */
  | { readonly op: 'getNoteBody'; readonly note: AutomationHandle }
  /**
   * One note's story as plain text.
   *
   * Exactly the same projection as reading `getText` from the body returned by `getNoteBody`,
   * without requiring that intermediate handle: paragraphs joined by one `\r` paragraph mark.
   */
  | {
      readonly op: 'getNoteText';
      readonly note: AutomationHandle;
      readonly projection?: AutomationTextProjection;
    }
  /** Whether a note is a footnote or an endnote. */
  | { readonly op: 'getNoteKind'; readonly note: AutomationHandle }
  /**
   * Delete a note: its body in the notes part and every reference that reached it.
   *
   * A PACKAGE-level transaction, so it shares its batch with nothing — see
   * `AUTOMATION_SOLITARY_OPERATIONS`.
   */
  | { readonly op: 'deleteNote'; readonly note: AutomationHandle }
  /**
   * Every list one story holds, in the order its numbers first appear.
   *
   * A list is the paragraphs that share a `w:numId`, so this is derived rather than walked: there
   * is no list element in a `.docx` to enumerate. Two stories that number with the same value are
   * still two lists, because the paragraphs are not in the same story.
   */
  | { readonly op: 'getLists'; readonly body: AutomationHandle }
  /** A list's `w:numId`, as the number the file states. */
  | { readonly op: 'getListId'; readonly list: AutomationHandle }
  /**
   * One story's list by the `w:numId` its paragraphs share, refused where none does.
   *
   * Refused rather than answered for an unused number: a `w:numId` with no paragraph names a
   * numbering DEFINITION, and a list handle for it would answer no paragraphs forever.
   */
  | { readonly op: 'getListById'; readonly body: AutomationHandle; readonly id: number }
  /**
   * A list's paragraphs in reading order, or only the ones at one level.
   *
   * `level` is `w:ilvl` — 0-8. A level the list has no paragraphs at answers none, which is not an
   * error: a list is free to skip a level.
   */
  | { readonly op: 'getListParagraphs'; readonly list: AutomationHandle; readonly level?: number }
  /**
   * The list a paragraph is in.
   *
   * A paragraph in none is REFUSED rather than answered an empty list of its own: "this paragraph
   * is not a list item" is a different fact from "this list has one paragraph", and a caller that
   * cannot tell them apart will indent prose.
   */
  | { readonly op: 'getParagraphList'; readonly paragraph: AutomationHandle }
  /** A list item's `w:ilvl`. Refused for a paragraph that is in no list. */
  | { readonly op: 'getListLevel'; readonly paragraph: AutomationHandle }
  /**
   * Move a list item to another level — Increase/Decrease Indent on a list.
   *
   * The level selects the format out of `numbering.xml`, so the marker changes with it. A level
   * outside 0-8 is refused rather than clamped: nothing defines a format there.
   */
  | { readonly op: 'setListLevel'; readonly paragraph: AutomationHandle; readonly level: number }
  /**
   * Add a paragraph to a list, at one of its edges. Answers the NEW paragraph.
   *
   * The new paragraph is numbered with the list it joins, at the level of the item it is inserted
   * beside — which is what continuing a list means, and what Word does when the caret is at the
   * end of one and Enter is pressed.
   */
  | {
      readonly op: 'insertListParagraph';
      readonly list: AutomationHandle;
      readonly where: 'start' | 'end';
      readonly text: string;
    }
  /**
   * Where a span points: an absolute URL, `#anchor`, or empty for text in no link.
   *
   * Empty rather than an error, because "this text is not a link" is an ordinary fact about a
   * document. Also empty when no SINGLE link covers the whole span — a span half in and half out
   * of a link is not that link's, and answering its target would tell a caller the words they
   * measured are all linked when some of them are not.
   *
   * The answer is the SANITIZED target. A file may carry `javascript:`; nothing reads it back out
   * of this protocol as a target, because a caller handed one would put it in front of a reader.
   */
  | { readonly op: 'getHyperlink'; readonly span: AutomationSpanRef }
  /**
   * Make a span a link, re-aim the link it already is, or unlink it.
   *
   * `''` unlinks: the `w:hyperlink` element goes and its runs stay exactly as they were, which is
   * what Word's Remove Hyperlink does. `#name` points at a bookmark THIS document declares — an
   * anchor nothing declares is refused rather than written as a jump to nowhere. Anything else is
   * an external address, and it is authored only if the engine would open it: a refused scheme
   * never reaches the package, and nothing is written at all.
   */
  | { readonly op: 'setHyperlink'; readonly span: AutomationSpanRef; readonly target: string }
  /**
   * The bookmarks a scope holds, in document order.
   *
   * `{ body }` is a whole story; a narrower span answers the ones it OVERLAPS, which is what
   * "the bookmarks of this range" means. Word's own scratch names (`_GoBack` and the rest of the
   * underscore-prefixed ones) are not answered, matching Word's default.
   */
  | { readonly op: 'getBookmarks'; readonly scope: AutomationSpanRef }
  /** The name a bookmark is declared with. */
  | { readonly op: 'getBookmarkName'; readonly bookmark: AutomationHandle }
  /**
   * The range a bookmark's two markers enclose.
   *
   * Refused once the document no longer declares the name: the markers are gone with the text
   * that held them, and a stale range would point a caller at whatever moved into their place.
   */
  | { readonly op: 'getBookmarkRange'; readonly bookmark: AutomationHandle }
  /**
   * The names of the bookmarks a span overlaps, in document order: `Range.getBookmarks`.
   *
   * A non-empty span holds a bookmark when the two share text, and a point bookmark when the
   * point is inside the span. An empty span holds the bookmarks around it. `includeAdjacent`
   * adds the bookmarks that only touch the span; `includeHidden` adds names starting with `_`.
   */
  | {
      readonly op: 'getBookmarkNames';
      readonly scope: AutomationSpanRef;
      readonly includeHidden: boolean;
      readonly includeAdjacent: boolean;
    }
  /**
   * The range of the bookmark with this name, compared without case, in any story: main text
   * first, then headers, footers and notes. Answers no span when nothing declares the name.
   */
  | {
      readonly op: 'getBookmarkRangeByName';
      readonly document: AutomationHandle;
      readonly name: string;
    }
  /**
   * Add a bookmark around a span, or at a point. A bookmark any story declares under the same
   * name, compared without case, moves here in the same write.
   */
  | { readonly op: 'insertBookmark'; readonly span: AutomationSpanRef; readonly name: string }
  /**
   * Remove a bookmark: by name anywhere in the document, or the one a handle names. The text
   * stays. A name nothing declares is not an error and changes nothing.
   */
  | {
      readonly op: 'deleteBookmark';
      readonly target:
        | { readonly document: AutomationHandle; readonly name: string }
        | { readonly bookmark: AutomationHandle };
    }
  /**
   * The comments anchored in a scope, in document order — the TOP-LEVEL ones.
   *
   * A reply is reached through the comment it answers rather than listed beside it, because a flat
   * list makes a conversation look like several remarks and loses which answered which.
   */
  | { readonly op: 'getComments'; readonly scope: AutomationSpanRef }
  /** Replies to one comment, in document order. */
  | { readonly op: 'getCommentReplies'; readonly comment: AutomationHandle }
  /** The `w:id` the comments part holds a comment under. */
  | { readonly op: 'getCommentId'; readonly comment: AutomationHandle }
  /** Who wrote a comment. `CT_TrackChange` requires it, so a comment always has one. */
  | { readonly op: 'getCommentAuthor'; readonly comment: AutomationHandle }
  /** `@w:date` verbatim, or empty where the file wrote none. Never invented. */
  | { readonly op: 'getCommentDate'; readonly comment: AutomationHandle }
  /** A comment's body as plain text. */
  | { readonly op: 'getCommentText'; readonly comment: AutomationHandle }
  /** The words a comment is about. Refused for a comment the file gave no usable range. */
  | { readonly op: 'getCommentRange'; readonly comment: AutomationHandle }
  /** Whether the thread is resolved (`w15:commentEx/@w15:done`). */
  | { readonly op: 'getCommentResolved'; readonly comment: AutomationHandle }
  /**
   * Create a top-level comment anchored to a span.
   *
   * Empty spans are valid insertion-point comments. A span may cross paragraphs in one story,
   * but not table-cell boundaries: range markers cannot safely open in one cell and close in
   * another. `author` and non-empty, single-paragraph `text` are required by this slice.
   *
   * Answers the NEW comment whose id is minted inside the package transaction.
   */
  | {
      readonly op: 'insertComment';
      readonly span: AutomationSpanRef;
      readonly text: string;
      readonly author: string;
      /** ISO-8601. Omitted writes no `@w:date` — inventing one is a content change. */
      readonly date?: string;
    }
  /**
   * Resolve a comment thread, or reopen it.
   *
   * A THREAD: the comment and its replies together, which is what resolving means in Word. Marking
   * the parent alone would leave a reply reading as open under a closed remark.
   */
  | {
      readonly op: 'setCommentResolved';
      readonly comment: AutomationHandle;
      readonly resolved: boolean;
    }
  /** Replace a supported comment or reply body as its configured runtime author. */
  | {
      readonly op: 'setCommentText';
      readonly comment: AutomationHandle;
      readonly text: string;
      readonly author: string;
    }
  /**
   * Reply to a comment, over the same words it is anchored to.
   *
   * `author` is required and must not be blank: `CT_TrackChange` makes `@w:author` mandatory, so a
   * reply without one is invalid XML rather than an anonymous remark.
   *
   * Answers the NEW comment, because its `w:id` is minted inside the package transaction and a
   * caller that had to re-read the thread to find its own reply would be reading a document that
   * another writer may have changed in between.
   */
  | {
      readonly op: 'replyToComment';
      readonly comment: AutomationHandle;
      readonly text: string;
      readonly author: string;
      /** ISO-8601. Omitted writes no `@w:date` — inventing one is a content change. */
      readonly date?: string;
    }
  /**
   * Delete one comment object.
   *
   * A top-level comment removes its whole thread and anchors. A reply removes only that reply;
   * its parent and siblings remain. Several delete operations may share one batch and commit as
   * one package transaction and one undo unit, but they cannot share a batch with any other write.
   */
  | { readonly op: 'deleteComment'; readonly comment: AutomationHandle }
  /**
   * The tracked changes of a story, in document order.
   *
   * Structural revisions are omitted because this protocol does not publish their exact Word
   * subtype. Collection accept/reject can still resolve structural revisions the store supports,
   * such as a complete tracked row.
   */
  | { readonly op: 'getRevisions'; readonly body: AutomationHandle }
  /**
   * The listed tracked changes whose characters a span overlaps, in document order. A collapsed
   * span lists the changes it touches. Handles are the story-wide listing's handles.
   */
  | { readonly op: 'getRevisions'; readonly scope: AutomationSpanRef }
  /**
   * The listed tracked changes a review-queue key names: one, or the two halves of a paired
   * replacement. A key naming nothing answers no handles.
   */
  | { readonly op: 'getRevisions'; readonly key: string }
  /**
   * The stretch a review-queue key names: `revision-<id>`, a paired `revision-replace:<a>+<b>`,
   * or `comment-<id>`. Answers `spans` holding one span covering every range of the item, or no
   * span when the key names nothing this document holds.
   */
  | { readonly op: 'getReviewItemRange'; readonly key: string }
  /** Resolve eligible decisions in one story. Omit revisions to select every canonical decision. */
  | {
      readonly op: 'resolveRevisionBatch';
      readonly body: AutomationHandle;
      readonly action: 'accept' | 'reject';
      readonly revisions?: readonly AutomationHandle[];
    }
  /**
   * Attribute pending decisions in one story to another author, keeping them pending. Omit
   * revisions to select every canonical decision. `date` is `xsd:dateTime`; omitted keeps each.
   */
  | {
      readonly op: 'setRevisionAuthorBatch';
      readonly body: AutomationHandle;
      readonly author: string;
      readonly date?: string;
      readonly revisions?: readonly AutomationHandle[];
      /** Keep only changes these authors made. Not allowed with `revisions`. */
      readonly authors?: readonly string[];
    }
  /** Word's name for the kind of change: `Insert`, `Delete`, `Replace`, `Property`, … */
  | { readonly op: 'getRevisionType'; readonly revision: AutomationHandle }
  | { readonly op: 'getRevisionAuthor'; readonly revision: AutomationHandle }
  /** `@w:date` verbatim, or empty where the file wrote none. */
  | { readonly op: 'getRevisionDate'; readonly revision: AutomationHandle }
  /** The words a change covers. Empty-range changes — a formatting one — answer their site. */
  | { readonly op: 'getRevisionRange'; readonly revision: AutomationHandle }
  /**
   * Accept one change, resolving every site that carries its identity.
   *
   * Both halves of a replacement go together: accepting the deletion and leaving the insertion
   * unproposed is a state no reviewer asked for.
   */
  | { readonly op: 'acceptRevision'; readonly revision: AutomationHandle }
  | { readonly op: 'rejectRevision'; readonly revision: AutomationHandle }
  /**
   * Accept every change in one story, as ONE decision and one undo unit.
   *
   * The document-handle form names the main story. The body-handle form names that story: a
   * header, footer, or the main body uses the part-wide store op; a note uses one store
   * all-decision scoped to that exact canonical note root. Both forms agree for the main story.
   */
  | { readonly op: 'acceptAllRevisions'; readonly body: AutomationHandle }
  | { readonly op: 'acceptAllRevisions'; readonly document: AutomationHandle }
  | { readonly op: 'rejectAllRevisions'; readonly body: AutomationHandle }
  | { readonly op: 'rejectAllRevisions'; readonly document: AutomationHandle }
  /**
   * Accept or reject every change a span overlaps, or the changes a review-queue key names, as
   * one transaction. Structural changes absent from listings are included. Refused whole when
   * any of them is read-only or cannot be resolved, and when the key names nothing.
   */
  | { readonly op: 'acceptAllRevisions'; readonly scope: AutomationSpanRef }
  | { readonly op: 'rejectAllRevisions'; readonly scope: AutomationSpanRef }
  | { readonly op: 'acceptAllRevisions'; readonly key: string }
  | { readonly op: 'rejectAllRevisions'; readonly key: string }
  /**
   * Put the reader's selection on a span. Requires the `selection` capability, so a headless
   * host refuses it rather than pretending to have a caret.
   */
  | {
      readonly op: 'selectSpan';
      readonly span: AutomationSpanRef;
      readonly mode: AutomationSelectionMode;
    }
  /**
   * Put the reader's selection on the range a bookmark currently encloses.
   *
   * The bookmark is resolved inside the batch so callers do not need a separate round trip to
   * obtain an addressable range. Requires the `selection` capability, like `selectSpan`.
   */
  | {
      readonly op: 'selectBookmark';
      readonly bookmark: AutomationHandle;
      readonly mode: AutomationSelectionMode;
    }
  /**
   * Insert a custom node: a tagged inline control, optionally bound to a payload.
   *
   * `w:tag` caps at 64 characters, so a node whose identity is a query string fits and a node
   * carrying authors, a year and a locator does not. The payload answers that — it lives in a
   * customXml data part and the control points at it — and the store, the node and the control
   * are ONE transaction. A control bound to a store that was never written is a document Word
   * offers to repair, and repairing it throws the control away.
   *
   * It lives HERE rather than on the editor session so both hosts answer it identically: a
   * payload write needs package scope, and putting it on the session would make the browser the
   * real implementation and leave the headless host to reimplement it or do without.
   *
   * `at` is a position; `span` wraps existing text instead. Exactly one, because a node with
   * both would be an insertion the caller thinks is a wrap.
   */
  | {
      readonly op: 'insertCustomNode';
      /** Where the node goes. Omitted with `span`, which supplies its own place. */
      readonly at?: AutomationPoint;
      /** Text to wrap, in place of `at`. The node's label replaces it. */
      readonly span?: AutomationSpanRef;
      /** The node's identity, as its definition encoded it. Word caps this at 64 characters. */
      readonly tag: string;
      /** The literal text the control holds — what Word and a reader without this library see. */
      readonly text: string;
      /** `w:alias` — the title Word shows on the control. */
      readonly title?: string;
      /** `w:lock`; omitted writes none. */
      readonly lock?: AutomationContentControlLock;
      /** The payload, and where it lives. Omitted authors a control with no store. */
      readonly payload?: AutomationCustomNodePayload;
    };

/**
 * A custom node's payload, and the store it lives in.
 *
 * `data` is a STRING and stays one all the way down. A schema belongs to the definition that
 * declared it, and an automation lane that parsed payloads would be a second opinion about what
 * a host's node means — carried over a transport that cannot hold the schema in the first place.
 *
 * @public
 */
export interface AutomationCustomNodePayload {
  /** Namespace of the store's root element. One store per namespace, per document. */
  readonly namespaceUri: string;
  /** Local name of that root. An NCName; anything else refuses. */
  readonly rootLocalName: string;
  /** The node's id inside the store, which the binding's xpath quotes. */
  readonly nodeId: string;
  /** The text Word paints the control from. Empty is an empty chip. */
  readonly label: string;
  /** The payload, serialized. */
  readonly data: string;
}

/** Just the `op` discriminants of {@link AutomationOperation}, for dispatch tables. */
export type AutomationOperationKind = AutomationOperation['op'];

export {
  AUTOMATION_QUERY_OPERATIONS,
  AUTOMATION_COMMAND_OPERATIONS,
  AUTOMATION_SOLITARY_OPERATIONS,
  isAutomationCommand,
  isSolitaryAutomationCommand,
} from './operation-classification.ts';
