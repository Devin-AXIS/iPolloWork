import type { TableRowFragmentRecord } from '../layout/semantic-records.ts';

/** Mark a tracked table row's element with its revision class and attribution. */
export function markTrackedRow(
  rowElement: HTMLElement,
  row: TableRowFragmentRecord,
  revisionMarkup: boolean
): void {
  if (!row.revisionKind) return;
  if (revisionMarkup) rowElement.style.backgroundColor = 'transparent';
  rowElement.classList.add(
    'docx-table-row--revision',
    row.revisionKind === 'insert' ? 'layout-revision-ins' : 'layout-revision-del'
  );
  // The same attribution datasets revision SPANS carry, so chrome that maps a hovered
  // element to its review decision treats a tracked row like any other tracked change.
  // Dataset assignment escapes; the values are attacker-controlled and never markup.
  rowElement.dataset.revisionKind = row.revisionKind;
  if (row.revisionId !== undefined) rowElement.dataset.revisionId = row.revisionId;
  if (row.revisionAuthor !== undefined) rowElement.dataset.reviewAuthor = row.revisionAuthor;
  if (row.revisionDate !== undefined) rowElement.dataset.revisionDate = row.revisionDate;
}
