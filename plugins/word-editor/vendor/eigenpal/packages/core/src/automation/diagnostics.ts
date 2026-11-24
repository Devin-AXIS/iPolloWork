/**
 * Anonymous diagnostics, the neutral half: store reasons → public codes, size and count
 * buckets, and one delivery path. The browser editor and the headless automation runtime both
 * build their diagnostics here, so a refusal gets the same public code on either host.
 *
 * Only the RESULT of a lookup leaves the engine. A raw reason can be a sentence, and a package
 * `detail` can name parts of the file, so neither is ever copied into a diagnostic.
 */
import { TARGET_REMOVED } from './target-removed.ts';
import type {
  ByteSizeBucket,
  CountBucket,
  DocumentOpenDiagnosticCode,
  EditDiagnosticCode,
  ReviewDiagnosticCode,
} from './diagnostic-vocabulary.ts';
import { isEditDiagnosticCode } from './diagnostic-hints.ts';
import type { ChangeTrackingRefusal } from './change-tracking.ts';
import type { OoxmlPackageRejection } from '../store/package/index.ts';
import type {
  RevisionBatchSkipReason,
  StoryTargetRejection,
  TreeOpRejection,
} from '../store/store/index.ts';

/** Version of the diagnostic shape; mirrors `DIAGNOSTIC_SCHEMA_VERSION` in the contract. */
const SCHEMA_VERSION = 1;

/**
 * Every open refusal the package reader and the session can return, by type: a new store
 * reason fails the type check here until it has a public code.
 */
const OPEN_CODES: Readonly<
  Record<
    Exclude<OoxmlPackageRejection, 'too-large'> | 'no-main-document-tree' | 'unsupported',
    DocumentOpenDiagnosticCode
  >
> = {
  unsupported: 'open.unsupported-source',
  'inflate-error': 'open.zip-corrupt',
  'bad-name': 'open.zip-invalid-entry-name',
  'too-many-entries': 'open.zip-entry-limit',
  'parse-error': 'open.xml-malformed',
  'missing-root': 'open.xml-malformed',
  'multiple-roots': 'open.xml-malformed',
  'invalid-name': 'open.xml-malformed',
  'invalid-namespace': 'open.xml-malformed',
  'undeclared-prefix': 'open.xml-malformed',
  'duplicate-expanded-attribute': 'open.xml-malformed',
  'dtd-forbidden': 'open.xml-dtd-forbidden',
  'entity-forbidden': 'open.xml-dtd-forbidden',
  'too-deep': 'open.xml-depth-limit',
  'too-many-elements': 'open.xml-element-limit',
  'invalid-limits': 'open.invalid-limits',
  'no-content-types': 'open.content-types-invalid',
  'bad-content-types': 'open.content-types-invalid',
  'no-main-document': 'open.missing-main-document',
  'no-main-document-tree': 'open.missing-main-document',
  'bad-relationship-target': 'open.relationships-invalid',
  'duplicate-relationship-id': 'open.relationships-invalid',
  'too-many-relationships': 'open.relationship-limit',
  'too-many-xml-parts': 'open.part-limit',
};

/**
 * The public code for a refused open. `too-large` is the one reason two layers share: the
 * archive reports it WITH the limit it crossed, a single XML part reports it without one.
 *
 * @public
 */
export function openDiagnosticCode(reason: string, limit?: string): DocumentOpenDiagnosticCode {
  if (reason === 'too-large') {
    if (limit === 'zip.maxRatio') return 'open.zip-ratio-limit';
    return limit === 'zip.maxTotalBytes' ? 'open.zip-size-limit' : 'open.xml-part-size-limit';
  }
  return own<DocumentOpenDiagnosticCode>(OPEN_CODES, reason) ?? 'open.failed';
}

/** Reasons the hosts write themselves, beside the store's. */
type HostRejectionToken =
  | 'automation-structural-tracking-unsupported'
  | 'unsupported-tracked-table-operation'
  | 'unsupported-story'
  | 'experimental-collaboration-body-text-only'
  | 'comment-author-mismatch'
  | 'unsupported-comment-body'
  | 'review-module-required'
  | 'no-document'
  | 'table-insert-refused'
  | 'table-of-contents-refused'
  | 'field-unsupported'
  | 'field-result-range-unsupported'
  | 'ooxml-unsupported'
  | 'style-not-defined'
  | 'no-styles-defined'
  | 'refresh-in-progress'
  | 'preview-active'
  | 'preview-operation-unsupported'
  | 'preview-composition-active'
  | 'collaboration-session-not-ready'
  | 'collaboration-session-not-attached'
  | 'collaboration-session-destroyed'
  | 'collaboration-text-limit'
  // Automation handles whose object an edit removed. See `target-removed.ts`.
  | typeof TARGET_REMOVED
  | 'paragraph-not-in-body'
  | 'no-such-story'
  | 'cell-not-in-story'
  | 'deleted-table-object'
  | 'missing-parent-table'
  | 'missing-table-story';

/** Exhaustive over the store and story reasons, like {@link OPEN_CODES}. */
const STORE_EDIT_CODES: Readonly<
  Record<
    TreeOpRejection | StoryTargetRejection | HostRejectionToken | ChangeTrackingRefusal,
    EditDiagnosticCode
  >
> = {
  locked: 'edit.protected-content',
  bound: 'edit.protected-content',
  'drawing-locked': 'edit.protected-content',
  'not-adjacent-siblings': 'edit.cross-structure-join',
  'indivisible-content': 'edit.indivisible-content',
  'field-structure': 'edit.field-structure',
  'field-result-unsupported': 'edit.field-structure',
  'field-unsupported': 'edit.field-unsupported',
  'field-result-range-unsupported': 'edit.field-result-unsupported',
  'ooxml-unsupported': 'edit.ooxml-unsupported',
  'style-not-defined': 'edit.style-not-defined',
  'no-styles-defined': 'edit.no-styles-defined',
  'carries-section-mark': 'edit.section-mark',
  'story-end-paragraph': 'edit.operation-unsupported',
  // Not a stale target: the block exists, and the story, cell, or table must keep it.
  'block-required': 'edit.content-required',
  'table-has-merge': 'edit.table-structure-unsupported',
  'row-hides-cell': 'edit.table-structure-unsupported',
  'unknown-grid-column': 'edit.table-structure-unsupported',
  'cross-cell-drawing': 'edit.table-structure-unsupported',
  'cells-not-rectangle': 'edit.table-merge-not-rectangle',
  'split-rows-not-divisor': 'edit.table-split-unsupported',
  'cell-too-narrow': 'edit.table-split-unsupported',
  'split-needs-grid': 'edit.table-split-unsupported',
  'cell-has-revision': 'edit.revision-unsupported',
  'unsupported-cell-content': 'edit.unsupported-content',
  trackedDrawingDeletionUnsupported: 'edit.tracked-drawing-delete-unsupported',
  packageTransactionRequired: 'edit.tracked-structure-unsupported',
  'automation-structural-tracking-unsupported': 'edit.tracked-structure-unsupported',
  'unsupported-tracked-table-operation': 'edit.tracked-structure-unsupported',
  'unsupported-revision': 'edit.revision-unsupported',
  'unsupported-revision:foreign-insertion': 'edit.tracked-foreign-revision-unsupported',
  'unknown-revision': 'edit.stale-target',
  'resource-limit': 'edit.resource-limit',
  'fragment-too-deep': 'edit.resource-limit',
  'fragment-resource-budget': 'edit.resource-limit',
  'fragment-invalid-block': 'edit.unsupported-content',
  unsupported: 'edit.unsupported-content',
  'unsupported-property': 'edit.unsupported-content',
  'not-a-picture-drawing': 'edit.unsupported-content',
  'not-a-shape-drawing': 'edit.unsupported-content',
  'no-solid-fill': 'edit.invalid-argument',
  'chart-drawing': 'edit.unsupported-content',
  'unknown-op': 'edit.invalid-argument',
  'invalid-range': 'edit.invalid-argument',
  'offset-out-of-range': 'edit.invalid-argument',
  'splits-surrogate-pair': 'edit.invalid-argument',
  'invalid-text': 'edit.invalid-argument',
  'invalid-property-value': 'edit.invalid-argument',
  'invalid-drawing-value': 'edit.invalid-argument',
  'not-a-list-paragraph': 'edit.invalid-argument',
  typeMismatch: 'edit.invalid-argument',
  invalidArgs: 'edit.invalid-argument',
  'unknown-paragraph': 'edit.stale-target',
  // A handle the document no longer resolves: an edit, a peer, or an undo removed or merged
  // its object. A handle that never named a valid target keeps its own reason, or none.
  [TARGET_REMOVED]: 'edit.stale-target',
  'paragraph-not-in-body': 'edit.stale-target',
  'no-such-story': 'edit.stale-target',
  'cell-not-in-story': 'edit.stale-target',
  'deleted-table-object': 'edit.stale-target',
  'missing-parent-table': 'edit.stale-target',
  'missing-table-story': 'edit.stale-target',
  'not-a-paragraph': 'edit.stale-target',
  'unknown-block': 'edit.stale-target',
  'not-a-block': 'edit.stale-target',
  'unknown-part': 'edit.stale-target',
  'unknown-content-control': 'edit.stale-target',
  'not-a-content-control': 'edit.stale-target',
  'unknown-control': 'edit.stale-target',
  'unknown-table': 'edit.stale-target',
  'unknown-row': 'edit.stale-target',
  'unknown-drawing': 'edit.stale-target',
  'not-a-drawing': 'edit.stale-target',
  'tree-invariant': 'edit.internal-invariant',
  'package-invariant': 'edit.internal-invariant',
  'package-changed': 'edit.internal-invariant',
  'duplicate-property-container': 'edit.internal-invariant',
  'unknown-scope': 'edit.unsupported-story',
  'dangling-relationship': 'edit.unsupported-story',
  'wrong-relationship-type': 'edit.unsupported-story',
  'external-relationship': 'edit.unsupported-story',
  'missing-part': 'edit.unsupported-story',
  'bad-relationship-target': 'edit.unsupported-story',
  'not-a-story-part': 'edit.unsupported-story',
  'too-many-story-stores': 'edit.resource-limit',
  'unsupported-story': 'edit.unsupported-story',
  'experimental-collaboration-body-text-only': 'edit.unsupported-story',
  'review-module-required': 'edit.review-module-required',
  'comment-author-mismatch': 'edit.comment-author-mismatch',
  'unsupported-comment-body': 'edit.unsupported-content',
  'no-document': 'edit.stale-target',
  'table-insert-refused': 'edit.table-insert-refused',
  'table-of-contents-refused': 'edit.table-of-contents-refused',
  'refresh-in-progress': 'edit.refresh-in-progress',
  'preview-active': 'edit.preview-active',
  'preview-operation-unsupported': 'edit.preview-unsupported',
  'preview-composition-active': 'edit.preview-composing',
  'collaboration-session-not-ready': 'edit.collaboration-not-ready',
  'collaboration-session-not-attached': 'edit.collaboration-not-ready',
  'collaboration-session-destroyed': 'edit.collaboration-not-ready',
  'collaboration-text-limit': 'edit.collaboration-text-limit',
  'change-tracking-unsupported-host': 'edit.tracking-unsupported-host',
  'change-tracking-mode-unsupported': 'edit.tracking-mode-unsupported',
  'change-tracking-author-required': 'edit.tracking-author-required',
  'change-tracking-operation-unsupported': 'edit.tracked-operation-unsupported',
};

/**
 * The public code for a store or host refusal reason, or `null` for a reason this table does
 * not know (a sentence, a binding reason). `unsupported-revision:<kind>` counts as
 * `unsupported-revision`, except `unsupported-revision:foreign-insertion`, which has its own
 * code.
 *
 * @public
 */
export function storeEditDiagnosticCode(reason: string): EditDiagnosticCode | null {
  // A store reason with its own code names it in full.
  const exact = own<EditDiagnosticCode>(STORE_EDIT_CODES, reason);
  if (exact) return exact;
  // Otherwise a detail after a colon never selects the code; only the token before it does.
  const colon = reason.indexOf(':');
  const token = colon < 0 ? reason : reason.slice(0, colon);
  // A browser host answers with the public code when the surface refused in a sentence.
  if (isEditDiagnosticCode(token)) return token;
  return own<EditDiagnosticCode>(STORE_EDIT_CODES, token) ?? null;
}

const REVIEW_CODES: Readonly<Record<RevisionBatchSkipReason, ReviewDiagnosticCode>> = {
  'unsupported-revision': 'review.revision-unsupported',
  'incomplete-group': 'review.incomplete-group',
  'retained-structure': 'review.retained-structure',
  'unknown-revision': 'review.stale-revision',
};

/** The skip details that name a review code of their own. */
const REVIEW_DETAIL_CODES: Readonly<Record<string, ReviewDiagnosticCode>> = {
  'locked-content': 'review.locked-content',
  'bound-content': 'review.bound-content',
};

/**
 * The public code for a skipped tracked change, such as an entry of `reviewChangesResolved`'s
 * `skipped` list: the detail's own code when it has one (`review.locked-content`,
 * `review.bound-content`), else the reason's.
 *
 * @example
 * ```ts
 * editor.on('reviewChangesResolved', ({ skipped }) => {
 *   for (const skip of skipped) console.warn(reviewCodeOfSkip(skip));
 * });
 * ```
 *
 * @public
 */
export function reviewCodeOfSkip(skip: {
  readonly reason: string;
  readonly detail?: string;
}): ReviewDiagnosticCode | null {
  return (
    (skip.detail === undefined
      ? null
      : own<ReviewDiagnosticCode>(REVIEW_DETAIL_CODES, skip.detail)) ??
    reviewDiagnosticCode(skip.reason)
  );
}

/** The public code for a skipped tracked change, or null for a reason with no public code. */
export function reviewDiagnosticCode(reason: string): ReviewDiagnosticCode | null {
  return (
    own<ReviewDiagnosticCode>(REVIEW_CODES, reason) ??
    own<ReviewDiagnosticCode>(REVIEW_DETAIL_CODES, reason) ??
    null
  );
}

/** Every open, store, host and review reason token the tables above know. */
export function knownReasonTokens(): readonly string[] {
  return [
    ...Object.keys(OPEN_CODES),
    'too-large',
    ...Object.keys(STORE_EDIT_CODES),
    ...Object.keys(REVIEW_CODES),
    ...Object.keys(REVIEW_DETAIL_CODES),
  ];
}

const KIB = 1024;
const SIZE_BUCKETS: readonly (readonly [number, ByteSizeBucket])[] = [
  [64 * KIB, '0-64KiB'],
  [128 * KIB, '64-128KiB'],
  [256 * KIB, '128-256KiB'],
  [512 * KIB, '256-512KiB'],
  [1024 * KIB, '512KiB-1MiB'],
  [2 * 1024 * KIB, '1-2MiB'],
  [4 * 1024 * KIB, '2-4MiB'],
  [8 * 1024 * KIB, '4-8MiB'],
  [16 * 1024 * KIB, '8-16MiB'],
  [32 * 1024 * KIB, '16-32MiB'],
  [64 * 1024 * KIB, '32-64MiB'],
  [128 * 1024 * KIB, '64-128MiB'],
  [256 * 1024 * KIB, '128-256MiB'],
  [512 * 1024 * KIB, '256-512MiB'],
];

/** The power-of-two bucket of a byte size. */
export function byteSizeBucket(bytes: number): ByteSizeBucket {
  for (const [limit, bucket] of SIZE_BUCKETS) if (bytes < limit) return bucket;
  return '512MiB+';
}

/** The order-of-magnitude bucket of a count. */
export function countBucket(count: number): CountBucket {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count < 10) return '2-9';
  if (count < 100) return '10-99';
  return count < 1000 ? '100-999' : '1000+';
}

/** A diagnostic without the fields the emitter adds. Distributes over the union. */
export type DiagnosticPayload<T> = T extends unknown
  ? Omit<T, 'schemaVersion' | 'editorSessionId' | 'time'>
  : never;

let sessionCounter = 0;

function randomSessionId(): string {
  const crypto = (
    globalThis as {
      crypto?: { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (crypto?.randomUUID) return `e_${crypto.randomUUID()}`;
  // `randomUUID` needs a secure context; `getRandomValues` works on plain HTTP pages too.
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `e_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  // No Web Crypto at all: unique in this process, which is all a correlation id needs.
  sessionCounter += 1;
  return `e_${Date.now().toString(36)}_${sessionCounter.toString(36)}`;
}

/** One delivery path for one editor or runtime instance. */
export interface DiagnosticEmitter<E> {
  /** Random for this instance and never stored. */
  readonly editorSessionId: string;
  /** Stamp the payload and hand it to every listener. A listener that throws is ignored. */
  deliver(payload: DiagnosticPayload<E>): void;
}

/**
 * A delivery path over `listeners`, read at each delivery so a later listener is heard. Generic
 * over the event union, which the editor contracts own: this lane never names them.
 */
export function createDiagnosticEmitter<E>(
  listeners: () => Iterable<(event: E) => unknown>,
  now: () => number = () => Date.now()
): DiagnosticEmitter<E> {
  const editorSessionId = randomSessionId();
  return {
    editorSessionId,
    deliver(payload) {
      const event = Object.freeze({
        ...payload,
        schemaVersion: SCHEMA_VERSION,
        editorSessionId,
        time: now(),
      }) as E;
      for (const listener of listeners()) {
        try {
          // An async listener's rejection is contained too: it must not surface as unhandled.
          const returned: unknown = listener(event);
          if (returned && typeof (returned as PromiseLike<unknown>).then === 'function')
            (returned as Promise<unknown>).then(undefined, () => {});
        } catch {
          /* an observer must never break the editor it observes */
        }
      }
    },
  };
}

/** Own-property lookup, so a reason such as `constructor` cannot reach `Object.prototype`. */
function own<T>(table: object, key: string): T | undefined {
  return Object.hasOwn(table, key) ? (table as Record<string, T>)[key] : undefined;
}
