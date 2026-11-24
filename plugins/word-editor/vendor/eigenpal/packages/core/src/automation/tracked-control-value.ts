// A content control value written under change tracking: the revision the store op carries,
// and where the proposed text lands, so the range a write returns names the inserted words.

import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { retractedLengthOf } from '../store/store/tree-op-retraction.ts';
import type { RevisionAttributionInput, TreeDocOp } from '../store/store/tree-op-types.ts';
import { revisionDateNow } from './revision-date.ts';

/** The attribution of a tracked control value, or nothing when tracking is off. */
export function controlValueRevision(author: string | undefined): {
  readonly revision?: RevisionAttributionInput;
} {
  return author === undefined
    ? {}
    : { revision: { author: author.trim(), date: revisionDateNow() } };
}

/** The store op writing a control's value, proposed when `author` tracks the write. */
export function controlValueOp(
  controlId: string,
  value: Extract<TreeDocOp, { op: 'setContentControlValue' }>['value'],
  author: string | undefined
): TreeDocOp {
  return { op: 'setContentControlValue', controlId, value, ...controlValueRevision(author) };
}

interface Point {
  readonly paragraphId: string;
  readonly offset: number;
}

/**
 * Where a tracked value's text starts in the control. The store strikes the shown text, a
 * prompt included, and appends the new text after it, inside the control; the author's own
 * pending insertion retracts rather than being struck.
 */
export function trackedValueStart<P extends Point>(
  part: OoxmlPart,
  span: { readonly start: P; readonly end: P },
  author: string
): P {
  const { start, end } = span;
  if (start.paragraphId !== end.paragraphId) return start;
  const paragraph = findNode(part, start.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return start;
  const retracted = retractedLengthOf(paragraph, start.offset, end.offset, author.trim());
  return { ...start, offset: end.offset - retracted };
}
