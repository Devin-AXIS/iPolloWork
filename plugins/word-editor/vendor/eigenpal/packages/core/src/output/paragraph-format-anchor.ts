import type { ParagraphFragmentRecord, RevisionAttribution } from '@docx-editor.dev/core/layout';
import { formatRevisionOf } from '@docx-editor.dev/core/layout';

/** Expose formatting decisions on the existing paragraph hit area without inserting a glyph. */
export function applyParagraphFormatAnchor(
  element: HTMLElement,
  fragment: ParagraphFragmentRecord,
  markOnly = false
): void {
  const paragraph = markOnly
    ? null
    : formatRevisionOf(fragment.props.filter((property) => property.localName === 'pPrChange'));
  const revision = paragraph ?? fragment.markFormatRevision;
  if (!revision) return;
  applyFormatAnchor(element, revision, paragraph ? 'pPrChange' : 'rPrChange');
  element.dataset.paragraphId = fragment.paragraphId;
  element.dataset.reviewStart = String(fragment.range.start);
  element.dataset.reviewEnd = String(fragment.range.end);
}

function applyFormatAnchor(
  element: HTMLElement,
  revision: RevisionAttribution,
  kind: string
): void {
  element.dataset.revisionKind = 'format';
  element.dataset.revisionId = revision.id;
  element.dataset.formattingKind = kind;
  if (revision.author) element.dataset.reviewAuthor = revision.author;
  if (revision.date !== undefined) element.dataset.revisionDate = revision.date;
}
