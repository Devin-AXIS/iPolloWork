// The file-supplied count never reaches `.repeat()` unclamped.
const MAX_TAB_RUN = 64;

/** Map Word's `mso-tab-count` to semantic tab elements, clamped to a fixed bound. */
export function htmlTabRunContents(raw: string | undefined): string {
  if (raw === undefined) return '';
  const trimmed = raw.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return '';
  return '<w:tab/>'.repeat(Math.min(Number.parseInt(trimmed, 10), MAX_TAB_RUN));
}

/** Map Word's closed positional-tab attributes to a semantic `w:ptab`. */
export function htmlPositionalTabXml(element: Element): string {
  const alignment = element.getAttribute('alignment')?.trim().toLowerCase();
  const relativeTo = element.getAttribute('relativeto')?.trim().toLowerCase();
  const leader = element.getAttribute('leader')?.trim().toLowerCase();
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return '';
  if (relativeTo !== 'margin' && relativeTo !== 'indent') return '';
  if (
    leader !== 'none' &&
    leader !== 'dot' &&
    leader !== 'hyphen' &&
    leader !== 'underscore' &&
    leader !== 'middledot'
  ) {
    return '';
  }
  const normalizedLeader = leader === 'middledot' ? 'middleDot' : leader;
  return (
    `<w:ptab w:alignment="${alignment}" ` +
    `w:relativeTo="${relativeTo}" w:leader="${normalizedLeader}"/>`
  );
}
