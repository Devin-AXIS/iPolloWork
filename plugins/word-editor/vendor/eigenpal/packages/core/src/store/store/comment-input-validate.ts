// Trust-boundary validation for comment author, body and date before any write lands.
//
// Every value here is caller- or host-supplied and must be checked with the same XML scalar
// rules the serializer uses, because a comment write commits package parts outside the tree-op
// lane that would otherwise catch an illegal character only on save.

import { isValidXmlText } from '../package/sinks.ts';
import { normalizeSdtFullDate } from './tree-op-nodes.ts';

/** Longest `@w:author` a caller may write. Attribute-bound and conservative. */
export const MAX_COMMENT_AUTHOR_UTF16 = 256;

/** Longest comment body in UTF-16 code units — one paragraph, one `w:t`. */
export const MAX_COMMENT_TEXT_UTF16 = 65_535;

/** Longest `@w:date` string; matches the content-control ISO gate. */
export const MAX_COMMENT_DATE_UTF16 = 64;

export type CommentInputRejection =
  'invalid-author' | 'invalid-text' | 'invalid-date' | 'resource-limit';

export type CommentDateNormalization =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly rejection: CommentInputRejection };

function overUtf16Limit(value: string, max: number): boolean {
  return value.length > max;
}

/** Whether `author` may be written on a `w:comment`. Blank after trim is refused. */
export function validateCommentAuthor(author: unknown): CommentInputRejection | null {
  if (typeof author !== 'string' || author.trim().length === 0) return 'invalid-author';
  if (overUtf16Limit(author, MAX_COMMENT_AUTHOR_UTF16)) return 'resource-limit';
  if (!isValidXmlText(author)) return 'invalid-author';
  return null;
}

/** Whether comment body text may be written. Empty is refused. */
export function validateCommentText(text: unknown): CommentInputRejection | null {
  if (typeof text !== 'string' || text.length === 0) return 'invalid-text';
  if (overUtf16Limit(text, MAX_COMMENT_TEXT_UTF16)) return 'resource-limit';
  if (!isValidXmlText(text)) return 'invalid-text';
  return null;
}

/**
 * Normalize caller-supplied `@w:date` input to canonical `xsd:dateTime`, or name why it cannot.
 *
 * Date-only input becomes midnight UTC (`YYYY-MM-DDT00:00:00Z`). The normalized string is what
 * every comment write must persist — never the raw date-only form.
 */
export function normalizeCommentDateValue(date: unknown): CommentDateNormalization {
  if (typeof date !== 'string') return { ok: false, rejection: 'invalid-date' };
  const trimmed = date.trim();
  if (overUtf16Limit(trimmed, MAX_COMMENT_DATE_UTF16))
    return { ok: false, rejection: 'resource-limit' };
  if (!isValidXmlText(trimmed)) return { ok: false, rejection: 'invalid-date' };
  const normalized = normalizeSdtFullDate(trimmed);
  if (normalized === null) return { ok: false, rejection: 'invalid-date' };
  if (overUtf16Limit(normalized, MAX_COMMENT_DATE_UTF16))
    return { ok: false, rejection: 'resource-limit' };
  return { ok: true, value: normalized };
}

/** Whether an optional `@w:date` may be written. */
export function validateCommentDate(date: unknown): CommentInputRejection | null {
  if (date === undefined) return null;
  const normalized = normalizeCommentDateValue(date);
  return normalized.ok ? null : normalized.rejection;
}

/** Map a field rejection to the store refusal code `addComment` returns. */
export function commentInputStoreRejection(
  rejection: CommentInputRejection
): 'invalid-author' | 'invalid-text' | 'invalid-property-value' | 'resource-limit' {
  switch (rejection) {
    case 'invalid-author':
      return 'invalid-author';
    case 'invalid-text':
      return 'invalid-text';
    case 'invalid-date':
      return 'invalid-property-value';
    case 'resource-limit':
      return 'resource-limit';
  }
}
