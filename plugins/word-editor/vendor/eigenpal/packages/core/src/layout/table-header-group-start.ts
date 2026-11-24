// Where the leading `w:tblHeader` rows (ECMA-376 Part 1 §17.4.49) of a table open.
//
// The contiguous header rows at the top of a table form one group. How that group opens
// below content already on the page depends on the layout generation
// (`headerRowsKeepWithBody`):
//
// - Mode 15 and later keep the group whole and with the opening of the body rows. A group
//   taller than a fresh page still leaves a page that holds content: the table starts on the
//   next page, and the group lays out there as ordinary rows.
// - Earlier modes never move the group. When it does not fit below the content, its rows lay
//   out as ordinary rows that each move whole, so the group can break between two of them.
//   Repeats start after the last of them.
//
// A group taller than a fresh page at the top of a page lays out as ordinary rows in every mode.

/** How the authored header group opens; see the module comment. */
export type HeaderGroupStart =
  /** Place the group whole where it is. */
  | 'atomic'
  /** Place the group whole, unless it and the body opening need the next page. */
  | 'kept'
  /** Lay out the header rows as ordinary rows where they are. */
  | 'ordinary'
  /** As `ordinary`, but every header row keeps whole like a `w:cantSplit` row (§17.4.6). */
  | 'whole-rows'
  /** Start the table on the next page, then lay out the header rows as ordinary rows. */
  | 'ordinary-next-page';

export interface HeaderGroupStartInput {
  /** `headerRowsKeepWithBody` applies (mode 15 and later). */
  readonly laterLayout: boolean;
  /** The table flows with the text and can break pages (it has no `w:tblpPr`). */
  readonly breaksPages: boolean;
  /** No header rows, a group that fits a fresh page, or a group taller than a fresh page. */
  readonly group: 'none' | 'fits' | 'tall';
  /** Content already precedes the table in its region. */
  readonly followsContent: boolean;
  /** Top of the table, in points. */
  readonly top: number;
  /** Space left below the whole group on the current page, in points. */
  readonly room: number;
}

export function headerGroupStart(input: HeaderGroupStartInput): HeaderGroupStart {
  const { laterLayout, breaksPages, group, followsContent } = input;
  if (group === 'none') return 'atomic';
  const belowContent = breaksPages && input.top > 0.001;
  if (group === 'tall') {
    return laterLayout && belowContent && followsContent ? 'ordinary-next-page' : 'ordinary';
  }
  if (laterLayout) return belowContent && followsContent ? 'kept' : 'atomic';
  return belowContent && input.room < -0.001 ? 'whole-rows' : 'atomic';
}
