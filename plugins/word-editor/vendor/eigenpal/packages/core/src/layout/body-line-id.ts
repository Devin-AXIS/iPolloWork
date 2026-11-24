/**
 * Paragraph-local body line id, stable when edits before an explicit break shift global order.
 * @internal
 */
export function bodyLineId(
  paragraphId: string,
  start: number,
  lineIndex: number,
  occurrence?: string
): string {
  const local = `line:${paragraphId}:${lineIndex}:${start}`;
  return occurrence === undefined ? local : `${local}:occ:${occurrence}`;
}
