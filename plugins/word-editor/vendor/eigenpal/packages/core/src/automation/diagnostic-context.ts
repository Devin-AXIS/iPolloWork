/**
 * Anonymous context for a failure: enough to reproduce and fix it, nothing from the file.
 *
 * A public code says what failed. These fields say where and how: the engine's own reason
 * token, the kind of package part, the class of an unexpected exception, and the kind of a
 * tracked change. Every value comes from a closed list in this file or from the engine's own
 * tables, so a part name, an element name or a message from the file can never pass through.
 */
import type { RevisionBatchSkipDetail, ReviewRevisionKind } from '../store/store/index.ts';
import { knownReasonTokens, reviewDiagnosticCode } from './diagnostics.ts';
import type {
  DiagnosticErrorName,
  DocumentPartKind,
  FormattingChangeKind,
  ReviewChangeKind,
  ReviewDiagnosticCode,
} from './diagnostic-vocabulary.ts';

/**
 * The browser binding's reasons. This lane runs headless and imports nothing from the binding,
 * so the list is plain text here; `editor/diagnostic-codes.ts` checks it against the binding's
 * type, and a new binding reason fails that check until it is listed.
 */
export const BINDING_CAUSES = [
  'paragraph-count-unexplained',
  'paragraph-reordered',
  'unknown-paragraph-id',
  'unknown-content-moved',
  'unsupported-node',
  'split-not-clean',
  'join-not-clean',
] as const;

/** Why an accept or reject could not resolve a change, by type, like the binding's. */
const REVIEW_SKIP_CAUSES: Readonly<Record<RevisionBatchSkipDetail, true>> = {
  unaddressed: true,
  'misplaced-marker': true,
  'nested-marker': true,
  'unsupported-structure': true,
  'unsupported-move': true,
  'unrecorded-properties': true,
  'read-only': true,
  'no-sites': true,
  'paired-change': true,
  'removed-content': true,
  'replaced-properties': true,
  'emptied-change': true,
  'enclosing-change': true,
  'grouped-change': true,
  'nested-table': true,
  'locked-content': true,
  'bound-content': true,
};

/** An exception the engine did not expect. */
const EXCEPTION_CAUSE = 'exception';

let causes: ReadonlySet<string> | undefined;

function causeSet(): ReadonlySet<string> {
  causes ??= new Set([
    // A reason with a colon is never a cause: `diagnosticCause` reports its token.
    ...knownReasonTokens().filter((token) => !token.includes(':')),
    ...BINDING_CAUSES,
    ...Object.keys(REVIEW_SKIP_CAUSES),
    EXCEPTION_CAUSE,
  ]);
  return causes;
}

/**
 * Every engine reason a diagnostic can carry as its `cause`. Causes are the engine's own
 * reasons and can change between engine versions; match on the public `code`, and read the
 * `cause` when you report or fix a failure.
 *
 * @public
 */
export function diagnosticCauses(): readonly string[] {
  return [...causeSet()];
}

/**
 * The engine reason token in a refusal reason, or undefined when the reason is not one the
 * engine knows, such as a sentence. Only the token before a colon counts; the detail after it
 * can name parts of the file and is never returned. A full reason such as
 * `unsupported-revision:foreign-insertion` reports its token; its public code names the rule.
 */
export function diagnosticCause(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const colon = reason.indexOf(':');
  const token = colon < 0 ? reason : reason.slice(0, colon);
  return causeSet().has(token) ? token : undefined;
}

/**
 * The review code and structure in a refused decision's reason, such as
 * `incomplete-group:paired-change`, or null when the reason names no review skip. The
 * structure is reported only when it is one of the engine's own skip details.
 *
 * @public
 */
export function reviewSkipOfReason(
  reason: string | undefined
): { readonly code: ReviewDiagnosticCode; readonly cause?: string } | null {
  if (!reason) return null;
  const colon = reason.indexOf(':');
  const code = reviewDiagnosticCode(colon < 0 ? reason : reason.slice(0, colon));
  if (!code) return null;
  const structure = colon < 0 ? undefined : reason.slice(colon + 1);
  return structure !== undefined && Object.hasOwn(REVIEW_SKIP_CAUSES, structure)
    ? { code, cause: structure }
    : { code };
}

/** The cause of a failure the engine did not name: an exception. */
export function exceptionCause(): string {
  return EXCEPTION_CAUSE;
}

const ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
]);

/**
 * The class of an exception, never its message. A subclass with its own name, which a host or a
 * file could shape, reports `'other'`.
 */
export function diagnosticErrorName(error: unknown): DiagnosticErrorName {
  const name = error instanceof Error ? error.name : undefined;
  return name && ERROR_NAMES.has(name) ? (name as DiagnosticErrorName) : 'other';
}

/** Part roles by the name's standard location and file name, checked in order. */
const PART_KINDS: readonly (readonly [RegExp, DocumentPartKind])[] = [
  [/^\[content_types\]\.xml$/, 'content-types'],
  [/\.rels$/, 'relationships'],
  [/^customxml\//, 'custom-xml'],
  [/^docprops\//, 'document-properties'],
  [/\/media\//, 'media'],
  [/\/embeddings\//, 'embedding'],
  [/\/glossary\//, 'glossary'],
  [/(?:^|\/)theme\/[^/]*\.xml$/, 'theme'],
  [/(?:^|\/)header\d*\.xml$/, 'header'],
  [/(?:^|\/)footer\d*\.xml$/, 'footer'],
  [/(?:^|\/)footnotes\.xml$/, 'footnotes'],
  [/(?:^|\/)endnotes\.xml$/, 'endnotes'],
  [/(?:^|\/)comments[a-z]*\.xml$/, 'comments'],
  [/(?:^|\/)people\.xml$/, 'people'],
  [/(?:^|\/)styles(?:witheffects)?\.xml$/, 'styles'],
  [/(?:^|\/)numbering\.xml$/, 'numbering'],
  [/(?:^|\/)websettings\.xml$/, 'web-settings'],
  [/(?:^|\/)settings\.xml$/, 'settings'],
  [/(?:^|\/)fonttable\.xml$/, 'font-table'],
  [/(?:^|\/)document\d*\.xml$/, 'main-document'],
];

/** Part names are short; a longer detail is not looked into. */
const PART_NAME_LIMIT = 512;

/**
 * The role of the part a failure names, from the part name at the start of a refusal detail.
 * The name itself never leaves this function. Undefined when there is no detail.
 */
export function documentPartKind(detail: string | undefined): DocumentPartKind | undefined {
  if (!detail) return undefined;
  // `word/document.xml: missing attribute`, `owner/rId1 -> target: reason`: the part comes first.
  const end = [': ', ' -> '].reduce((at, separator) => {
    const index = detail.indexOf(separator);
    return index >= 0 && index < at ? index : at;
  }, detail.length);
  if (end > PART_NAME_LIMIT) return 'other';
  const name = detail
    .slice(0, end)
    .replace(/^\/+/, '')
    .toLowerCase()
    // `owner.xml/rId4`: a relationship is reported by the part that owns it.
    .replace(/(\.(?:xml|rels))\/[^/]*$/, '$1');
  for (const [pattern, kind] of PART_KINDS) if (pattern.test(name)) return kind;
  return 'other';
}

/** The review queue's change kinds, by type: the two lists cannot drift apart. */
const CHANGE_KINDS: Readonly<Record<ReviewRevisionKind, true>> = {
  insert: true,
  delete: true,
  replace: true,
  moveFrom: true,
  moveTo: true,
  format: true,
  paragraphMark: true,
  structural: true,
};

/** A review change kind, or undefined for a value the queue does not list. */
export function reviewChangeKind(kind: string | undefined): ReviewChangeKind | undefined {
  return kind && Object.hasOwn(CHANGE_KINDS, kind) ? (kind as ReviewChangeKind) : undefined;
}

const FORMATTING_KINDS: ReadonlySet<string> = new Set([
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'tblGridChange',
  'trPrChange',
  'tcPrChange',
  'numberingChange',
]);

/**
 * The property change a formatting change is, from its OOXML element name. The name comes from
 * the file, so only the listed names pass; any other reports `'other'`.
 */
export function formattingChangeKind(name: string | undefined): FormattingChangeKind | undefined {
  if (!name) return undefined;
  return FORMATTING_KINDS.has(name) ? (name as FormattingChangeKind) : 'other';
}
