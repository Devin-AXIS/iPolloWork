import type { RevisionBatchResult } from '../store/store/revision-batch.ts';
import type { RevisionAuthorResult } from '../store/store/revision-author-change.ts';
// The automation host protocol.
//
// One interface, two implementations: a headless host that owns a package it opened from
// bytes, and a browser host that borrows the live editor's session. Both answer the same
// operations with the same results, because the operations themselves are implemented once,
// above this protocol, over a canonical package neither host is allowed to bypass.
//
// EVERYTHING HERE IS TRANSPORT-SHAPED ON PURPOSE. A request is data, a response is data, and
// a handle is a name rather than a pointer — so the same host can sit behind a worker
// message port, an HTTP boundary, or nothing at all, without the protocol changing shape at
// the moment it crosses one. That is also why nothing in this file names an `OoxmlNode`, a
// store, or a DOM node: a value a consumer receives must not be a reference into the engine.

import type { AutomationFontRead, AutomationParagraphFormatRead } from './formatting.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationParagraphBorderRead } from './paragraph-borders.ts';
import type { AutomationPageSetupRead } from './sections.ts';

/**
 * What kind of document object a handle names.
 *
 * `body` is one STORY — the main body, a header or footer variant of a section, or one note — so
 * every object reached through a body is reached in a named story rather than in "the document".
 */
export type AutomationObjectKind =
  | 'document'
  | 'body'
  | 'paragraph'
  | 'section'
  | 'note'
  | 'comment'
  | 'revision'
  | 'bookmark'
  | 'list'
  | 'contentControl'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'field'
  | 'inlinePicture'
  | 'shape';

declare const AUTOMATION_HANDLE_BRAND: unique symbol;

/**
 * An opaque host-minted name for a document object.
 *
 * Branded so a consumer cannot invent one: the only way to hold a ref is to have been given
 * it by the host that minted it. Its CONTENT is deliberately meaningless — it is not a node
 * id, not a part name, not a path. A host that returned engine identity here would hand
 * every consumer a way to address the canonical tree directly, and the next thing to arrive
 * would be a second write path.
 *
 * SCOPED TO ONE HOST. Each host draws a random token when it starts and stamps it into every
 * ref it mints, so a ref carries no meaning anywhere else: passed to another host — including
 * one open on the same bytes — it is `invalid-handle`, not a paragraph.
 */
export type AutomationHandleRef = string & { readonly [AUTOMATION_HANDLE_BRAND]: 'handle' };

/** A stable reference to one document object, valid for the life of the host that minted it. */
export interface AutomationHandle<K extends AutomationObjectKind = AutomationObjectKind> {
  readonly kind: K;
  readonly ref: AutomationHandleRef;
}

/**
 * What a host supports, fixed at construction and frozen.
 *
 * Immutable because capability is a property of the host, not a mode it can be talked into:
 * a consumer that branched on `capabilities` once must not find the answer different later.
 * A headless host reports `selection`, `scrolling` and `layout` false — it paints nothing and
 * has no reader to move — and refuses those operations rather than approximating them.
 */
export interface AutomationCapabilities {
  /** Reading and editing document content. Every document operation requires it. */
  readonly document: boolean;
  /** Serializing the current document back to DOCX bytes. */
  readonly save: boolean;
  /** Change notification through {@link AutomationHost.subscribe}. */
  readonly events: boolean;
  /** A reader's selection or caret exists and can be addressed. */
  readonly selection: boolean;
  /** The document is displayed in something that can be scrolled to a position. */
  readonly scrolling: boolean;
  /** Paginated layout exists, so pages and page geometry can be asked about. */
  readonly layout: boolean;
}

/**
 * Why an operation was refused, as a value to branch on.
 *
 * Deliberately distinguishable rather than one "failed": the object model above this protocol
 * maps each code to a different consumer-facing error, and a caller that retries a
 * `stale-revision` must not retry an `invalid-handle`.
 */
export type AutomationErrorCode =
  /**
   * Nothing was applied because the request was built from an older read: `expectedRevision`
   * did not match the host's current revision, or an endpoint's `readAt` names a position
   * that moved since. Read again before retrying; resending the same endpoints fails again.
   */
  | 'stale-revision'
  /** A handle this host never minted, or one naming a different kind of object. */
  | 'invalid-handle'
  /** A UTF-16 offset that is not an integer inside the target's bounds. */
  | 'invalid-offset'
  /** The operation needs a capability this host reports false. */
  | 'unsupported-capability'
  /** The host has been disposed. Every subsequent call fails this way. */
  | 'disposed'
  /** The canonical mutation path refused the transaction; nothing was applied. */
  | 'transaction-refused'
  /** The operation is not one this protocol version defines. */
  | 'unknown-operation'
  /**
   * The value asked to be written is one this host will not write — text carrying a paragraph
   * mark, a delimiter set with nothing in it. Not `invalid-offset` and not
   * `unsupported-capability`: the request is well-formed and the host is capable, the CONTENT
   * is the problem, and writing an approximation of it would mean something else.
   */
  | 'unsupported-content'
  /** A tracked-change kind this engine preserves but cannot yet accept or reject safely. */
  | 'unsupported-revision'
  /**
   * File-authored identities are ambiguous, so exposing either object would alias another.
   *
   * This is document corruption, not an invalid caller argument or an unsupported capability.
   */
  | 'ambiguous-document'
  /**
   * Two operations in one batch make claims on the same paragraph that cannot both hold.
   *
   * A batch is one ordered transaction, so its commands are planned against the state at its
   * start. That is unambiguous until two of them restructure the same paragraph — inserting a
   * paragraph before it AND writing into it, splitting it twice — where the second command's
   * positions describe a paragraph the first one already reshaped. Refusing the batch is the
   * only answer that is not a guess; the caller sequences them across two syncs.
   */
  | 'conflicting-operations'
  /**
   * The host is live but has no document to act on right now — a browser host whose editor
   * is detached between mounts. Distinct from `disposed`: the host may answer again later.
   */
  | 'document-unavailable';

/**
 * One refused operation. Plain data, not an `Error` — it crosses transports.
 *
 * `code` is the stable part; `message` and `detail` are for logs. The object model above this
 * protocol deliberately does NOT copy `detail` into what a consumer sees, because a store's
 * rejection reason would become documented API the moment somebody matched on it.
 */
export interface AutomationError {
  readonly code: AutomationErrorCode;
  /** Human-readable, for a log or a thrown error in a layer above. Never parsed. */
  readonly message: string;
  /** Machine-ish specifics: the offending offset, the store's own rejection reason. */
  readonly detail?: string;
}

/**
 * One end of a stretch of a story: a paragraph, and a UTF-16 offset in it.
 *
 * The only addressing vocabulary in this protocol. A stable paragraph handle plus a raw model
 * offset is what tree operations, selection, and layout use. Display text reads can expand field
 * atoms and apply a review view. A client must not calculate offsets from display text. It can
 * request the `model` projection when it needs text in this offset vocabulary. Painted DOM
 * indices and document-wide character counters appear nowhere.
 */
export interface AutomationEndpoint {
  /**
   * Typed as a handle of any kind on purpose. A ref is opaque, so the only thing that can
   * establish what one names is the host that minted it — every operation resolves the kind at
   * the boundary and answers `invalid-handle`. Narrowing the phantom here would add a
   * compile-time check that holds only inside this repository, while forcing a cast at every
   * point an object model carries a handle it received from a response.
   */
  readonly paragraph: AutomationHandle;
  readonly offset: number;
  /**
   * The host revision this endpoint was read at. Hosts stamp every endpoint they answer with
   * it; send it back unchanged. An endpoint whose paragraph text changed since then is refused
   * with `stale-revision` instead of addressing whatever text now sits at its offset. Omit it
   * for an endpoint built by hand, which the host then takes as current.
   */
  readonly readAt?: number;
}

/** A stretch of a story between two endpoints, in reading order. */
export interface AutomationSpan {
  readonly start: AutomationEndpoint;
  readonly end: AutomationEndpoint;
}

/** What an operation answered with. */
export type AutomationValue =
  | { readonly kind: 'revisionBatch'; readonly result: RevisionBatchResult }
  | { readonly kind: 'revisionAuthors'; readonly result: RevisionAuthorResult }
  | { readonly kind: 'field'; readonly field: { readonly code: string } }
  | {
      readonly kind: 'table';
      readonly table: {
        readonly values: readonly (readonly string[])[];
        readonly style: string;
        readonly headerRowCount: number;
        readonly rowCount: number;
        readonly columnCount: number;
      };
    }
  | {
      readonly kind: 'tableCell';
      readonly cell: {
        readonly value: string;
        readonly columnWidth: number;
        readonly shadingColor: string;
        readonly verticalAlignment: 'Top' | 'Center' | 'Bottom';
      };
    }
  | {
      readonly kind: 'inlinePicture';
      readonly picture: import('./pictures.ts').AutomationInlinePictureRead;
    }
  | { readonly kind: 'shape'; readonly shape: import('./shapes.ts').AutomationShapeRead }
  | { readonly kind: 'shapeFill'; readonly fill: import('./shape-fill.ts').AutomationShapeFillRead }
  | { readonly kind: 'handle'; readonly handle: AutomationHandle }
  | { readonly kind: 'handles'; readonly handles: readonly AutomationHandle[] }
  | { readonly kind: 'text'; readonly text: string }
  /** Several strings, in document order: the names of the bookmarks a range holds. */
  | { readonly kind: 'texts'; readonly texts: readonly string[] }
  | { readonly kind: 'span'; readonly span: AutomationSpan }
  | { readonly kind: 'spans'; readonly spans: readonly AutomationSpan[] }
  /**
   * A bag of property values, rather than a document object.
   *
   * Typed per KIND rather than as one generic record, for the same reason the operation
   * vocabulary is: a caller destructures a named shape, and a new kind of answer has to be
   * declared before it can be sent. A record keyed by strings would let a host answer anything.
   */
  | { readonly kind: 'font'; readonly font: AutomationFontRead }
  | { readonly kind: 'paragraphFormat'; readonly format: AutomationParagraphFormatRead }
  /** A paragraph's five borders, in collection order. */
  | {
      readonly kind: 'paragraphBorders';
      readonly borders: readonly AutomationParagraphBorderRead[];
    }
  /** One section's page geometry, in points. */
  | { readonly kind: 'pageSetup'; readonly setup: AutomationPageSetupRead }
  /**
   * A number the document states: a list's `w:numId`, a list item's level.
   *
   * Its own kind rather than a stringified `text`, because a caller that has to parse an answer
   * back into a number is a caller that can parse it wrongly.
   */
  | { readonly kind: 'number'; readonly value: number }
  /** A yes-or-no the document states: whether a comment thread is resolved. */
  | { readonly kind: 'flag'; readonly value: boolean }
  /**
   * A paragraph style NAME, or null where nothing names one — the paragraphs disagree, or the
   * document declares no styles at all.
   */
  | { readonly kind: 'style'; readonly name: string | null }
  /** The styles a document defines, in the order its styles part writes them. */
  | {
      readonly kind: 'styles';
      readonly styles: readonly import('./style-listing.ts').AutomationStyleRead[];
    }
  /** A command that committed. The observable effect is the response's revision/changed. */
  | { readonly kind: 'applied' };

/**
 * One operation's outcome.
 *
 * `skipped` is what makes an atomic batch honest. When a batch fails, every operation other
 * than the one that failed reports `skipped` — including the ones that came BEFORE it and
 * including reads. Reporting those as `ok` would describe a document state that was never
 * published, which is exactly the partial-application illusion the batch exists to prevent.
 */
export type AutomationOperationResult =
  | { readonly status: 'ok'; readonly value: AutomationValue }
  | { readonly status: 'error'; readonly error: AutomationError }
  | { readonly status: 'skipped' };

/**
 * One ordered batch: what to run, and the revision it was planned against.
 *
 * Transport-shaped data, never references into the engine, so the same request crosses a worker
 * port or an HTTP boundary unchanged.
 */
export interface AutomationBatchRequest {
  /** Queries and commands, in the order they are to be interpreted. */
  readonly operations: readonly AutomationOperation[];
  /**
   * Refuse the whole batch unless the host is at this revision.
   *
   * How an object model built on cached reads stays honest: it read the document at a
   * revision, decided what to write, and says so. Omitted means "apply against whatever the
   * current state is", which is what an unconditional command wants.
   */
  readonly expectedRevision?: number;
}

/**
 * What one batch produced: a verdict, one result per operation, and the revision afterwards.
 *
 * `results` is positionally aligned with the request, so a failed operation is identified by its
 * index rather than by anything the caller has to correlate.
 */
export interface AutomationBatchResponse {
  /** True only when every operation succeeded and any commands committed. */
  readonly ok: boolean;
  /** One entry per requested operation, in request order. */
  readonly results: readonly AutomationOperationResult[];
  /** The host's revision AFTER the batch. Unchanged when nothing committed. */
  readonly revision: number;
  /** Whether the batch moved the document. False for a read-only or refused batch. */
  readonly changed: boolean;
}

/**
 * DOCX bytes, or why they could not be produced.
 *
 * A browser host that borrows an editor refuses with `unsupported-capability`: it does not own
 * the document and serializing one behind the editor's back would answer bytes the user's
 * session never agreed to.
 */
export type AutomationSaveResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: AutomationError };

/** The document moved. Coarse on purpose: a consumer re-reads what it cares about. */
export interface AutomationChangeEvent {
  readonly revision: number;
}

/** What an automation subscription returns. Calling it twice is safe. */
export type AutomationUnsubscribe = () => void;

/**
 * The protocol both hosts implement: a headless one owning bytes it opened, and a browser one
 * borrowing the live editor's session.
 *
 * Both answer the same operations identically, because the operations are implemented ONCE above
 * this interface over a canonical package neither host may bypass. A batch is one revision, one
 * undo unit, and one transaction.
 */
export interface AutomationHost {
  readonly capabilities: AutomationCapabilities;
  /** Monotonic revision of the document this host acts on. */
  revision(): number;
  /**
   * Run one ordered batch.
   *
   * Queries answer against the state as of the START of the batch; every command in the
   * batch commits as ONE transaction at its end. So a batch is one revision, one undo unit
   * and one change event however many commands it carries — and if any operation is refused,
   * nothing is written at all.
   */
  execute(request: AutomationBatchRequest): AutomationBatchResponse;
  /** Settle optional pagination resources before a field-update batch. Does not write content. */
  prepare?(request: AutomationBatchRequest): Promise<void>;
  /** The current document as DOCX bytes, through the normalizing serializer. */
  save(): AutomationSaveResult;
  /** Change notification. Returns an unsubscribe that is safe to call more than once. */
  subscribe(listener: (event: AutomationChangeEvent) => void): AutomationUnsubscribe;
  /** Release everything this host holds. Idempotent; every later call fails `disposed`. */
  dispose(): void;
}
