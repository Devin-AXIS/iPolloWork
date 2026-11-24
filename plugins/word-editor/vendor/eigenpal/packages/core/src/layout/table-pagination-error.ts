// The bounded failure a table that cannot be paginated as authored raises.

/**
 * Why a table could not be paginated as authored.
 *
 * Each is a bound: a row taller than a page, a row that cannot be split, or a row producing more
 * fragments than the limit allows.
 */
export type TablePaginationErrorCode =
  'table-row-overheight' | 'table-row-split-unsupported' | 'table-row-fragment-limit';

/**
 * Bounded table pagination failure. Prefer this over emitting a fragment that overflows
 * the page content box.
 */
export class TablePaginationError extends Error {
  readonly code: TablePaginationErrorCode;
  constructor(code: TablePaginationErrorCode, message: string) {
    super(message);
    this.name = 'TablePaginationError';
    this.code = code;
  }
}
