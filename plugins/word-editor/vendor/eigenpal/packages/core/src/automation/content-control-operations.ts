// Content control transport operations: list, read, write, wrap, and remove controls.
// Split out of `operations.ts`, which re-exports the types; `AutomationOperation` includes
// the union.

import type { AutomationSpanRef, AutomationTextProjection } from './operations.ts';
import type { AutomationHandle } from './protocol.ts';

/**
 * Where to look for content controls: a whole story, inside one control, or across a span.
 *
 * A control's own scope is how nesting is expressed. Listing every control of a story flat
 * would answer a form field and the group wrapping it as siblings, which is not what either of
 * them is. A SPAN scope is the exception on purpose: it answers every control the span
 * overlaps, at any depth, including a control that holds the whole span, because a caller asks
 * a range for its controls to learn what an edit through it would touch.
 */
export type AutomationContentControlScope =
  | { readonly body: AutomationHandle }
  | { readonly contentControl: AutomationHandle }
  | { readonly span: AutomationSpanRef };

/** The value a control accepts, by what kind of control it is. */
export type AutomationContentControlValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'listItem'; readonly value: string }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  | { readonly kind: 'date'; readonly iso: string };

/** The `ST_Lock` values an author may write. */
export type AutomationContentControlLock =
  'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';

/**
 * Which part of a control a range read answers.
 *
 * `whole` and `content` are the same stretch, and `before`/`after` are the content's own edges:
 * a control's boundary marks occupy no offset in the text a caller addresses, so there is no
 * position between a mark and the first character to answer with.
 */
export type AutomationContentControlRangeLocation =
  'whole' | 'content' | 'start' | 'end' | 'before' | 'after';

/** The control types an insertion may author. Picture and repeating section are deferred. */
export type AutomationContentControlSubtype =
  'richText' | 'plainText' | 'dropDownList' | 'comboBox' | 'date';

/** The content control operations of {@link AutomationOperation}. */
export type AutomationContentControlOperation =
  /**
   * The content controls a scope holds, outermost first and in document order.
   *
   * A control INSIDE another is reached through the one that holds it, never listed beside it:
   * a flat list of a document's controls makes a form field and the section wrapping it look
   * like siblings, and a caller iterating to fill a form would write into both.
   */
  | { readonly op: 'getContentControls'; readonly scope: AutomationContentControlScope }
  /**
   * The first control in a scope whose `w:id` is the one asked for.
   *
   * FIRST, not "the" — `w:id` is not unique in OOXML and a file may write the same number
   * twice. Both controls remain reachable by listing; only this lookup has to choose, and
   * choosing document order is the choice a caller can predict.
   */
  | {
      readonly op: 'getContentControlById';
      readonly scope: AutomationContentControlScope;
      readonly id: number;
    }
  /** Every control in a scope carrying a tag, in document order. */
  | {
      readonly op: 'getContentControlsByTag';
      readonly scope: AutomationContentControlScope;
      readonly tag: string;
    }
  /** Every control in a scope carrying a title (`w:alias`), in document order. */
  | {
      readonly op: 'getContentControlsByTitle';
      readonly scope: AutomationContentControlScope;
      readonly title: string;
    }
  /** `w:tag`, or empty where the file wrote none. Never invented. */
  | { readonly op: 'getContentControlTag'; readonly contentControl: AutomationHandle }
  /** `w:alias` — what Word's UI calls the title. Empty where absent. */
  | { readonly op: 'getContentControlTitle'; readonly contentControl: AutomationHandle }
  /**
   * `w:id` as a STRING, and empty where the file wrote none.
   *
   * Metadata, deliberately: the identity a caller holds is the handle. A file id answered as a
   * number would invite a caller to treat it as one, and an optional non-unique attribute is
   * not an identity however it is spelled.
   */
  | { readonly op: 'getContentControlFileId'; readonly contentControl: AutomationHandle }
  /** The control's type: `richText`, `plainText`, `dropDownList`, `comboBox`, `date`, … */
  | { readonly op: 'getContentControlSubtype'; readonly contentControl: AutomationHandle }
  /** The `ST_Lock` in force, INCLUDING what an enclosing control imposes. */
  | { readonly op: 'getContentControlLock'; readonly contentControl: AutomationHandle }
  /**
   * Whether the control declares `w:dataBinding`.
   *
   * Presence only: no XPath, namespace mapping, store id, or custom XML content crosses this
   * protocol boundary, and the binding target is never resolved or fetched.
   */
  | { readonly op: 'getContentControlIsBound'; readonly contentControl: AutomationHandle }
  /** Whether the control is showing its placeholder rather than a value (`w:showingPlcHdr`). */
  | { readonly op: 'getContentControlPlaceholderShown'; readonly contentControl: AutomationHandle }
  /** Whether the control removes itself on the first edit (`w:temporary`). */
  | { readonly op: 'getContentControlTemporary'; readonly contentControl: AutomationHandle }
  /** The text the control encloses, as the document reads it. */
  | {
      readonly op: 'getContentControlText';
      readonly contentControl: AutomationHandle;
      readonly projection?: AutomationTextProjection;
    }
  /** The paragraphs the control holds, in reading order. Empty for an inline control's own. */
  | { readonly op: 'getContentControlParagraphs'; readonly contentControl: AutomationHandle }
  /**
   * The span the control's content covers, so a caller can read or format it.
   *
   * `location` narrows it: `start`/`end` collapse onto the content's edges, and `before`/`after`
   * answer those same edges because a control's boundary marks occupy no offset here.
   */
  | {
      readonly op: 'getContentControlRange';
      readonly contentControl: AutomationHandle;
      readonly location?: AutomationContentControlRangeLocation;
    }
  /**
   * Write the control's value in the vocabulary its own type accepts.
   *
   * The refusals are the store's: `locked`, `bound`, `type-mismatch`, `invalid-value`. This
   * operation adds none of its own, because a script and a keystroke must be refused for the
   * same reasons or a form is only as protected as the path a caller happened to take.
   */
  | {
      readonly op: 'setContentControlValue';
      readonly contentControl: AutomationHandle;
      readonly value: AutomationContentControlValue;
    }
  /** Author tag, title or lock. An omitted member is left as it is; `null` removes it. */
  | {
      readonly op: 'setContentControlProperties';
      readonly cannotEdit?: boolean;
      readonly cannotDelete?: boolean;
      readonly contentControl: AutomationHandle;
      readonly tag?: string | null;
      readonly title?: string | null;
      readonly lock?: AutomationContentControlLock;
    }
  /** Remove the control. `keepContent` is Word's own "Remove content control". */
  | {
      readonly op: 'deleteContentControl';
      readonly contentControl: AutomationHandle;
      readonly keepContent: boolean;
    }
  /**
   * Put text into the control, at `replace` (its value) or at one edge of its content.
   *
   * The edge is resolved HERE and not by the caller: a script that read the span first and wrote
   * to it second could only write to where the control was when it asked, and the read and the
   * write would be two refusals instead of one.
   */
  | {
      readonly op: 'insertContentControlText';
      readonly contentControl: AutomationHandle;
      readonly text: string;
      readonly at: 'replace' | 'start' | 'end';
    }
  /** Wrap a span in a new control of the named type. */
  | {
      readonly op: 'insertContentControl';
      readonly returnHandle?: boolean;
      readonly span: AutomationSpanRef;
      readonly subtype: AutomationContentControlSubtype;
      readonly tag?: string;
      readonly title?: string;
    };
