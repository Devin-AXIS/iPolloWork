// What a placed table fragment holds, without where it holds it.
//
// Readers that only ask whether a fragment holds some paragraph or nested table, and how many
// lines it counts, need none of its geometry. These facts follow the fragment's rows the way
// such readers walk them: a repeated header row is skipped at every nesting level (its
// paragraphs belong to the row's first occurrence), and nested tables are entered.
//
// Facts are computed once per immutable fragment. A width-only table update proves that each
// replacement has the same rows, header-row repeats, cells, paragraphs and line counts as the
// fragment it replaces (`sameRowHeights` in `table-width-update.ts`), and shares the facts,
// so the replacement is never walked for them.
//
// `paragraphIds` names each paragraph fragment by its own id. A merged paragraph fragment also
// draws the paragraphs it absorbed (`fragmentParagraphs`); readers keyed by every drawn
// paragraph use `tableFormattingMembers`, which includes them.

import { fragmentParagraphs } from './line-segments.ts';
import type {
  BlockFragmentRecord,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from './semantic-records.ts';

export interface TableFragmentFacts {
  /** Paragraph ids outside repeated header rows, nested tables included. */
  readonly paragraphIds: ReadonlySet<string>;
  /** Ids of nested tables outside repeated header rows; not the fragment's own id. */
  readonly nestedTableIds: ReadonlySet<string>;
  /** Lines of those paragraphs. */
  readonly lineCount: number;
}

const known = new WeakMap<TableFragmentRecord, TableFragmentFacts>();

let observer: {
  computed: number;
  shared: number;
  skipped: number;
  membersComputed: number;
  skipOff: boolean;
} | null = null;

/**
 * @internal Counts facts computed by walking rows, facts shared by a width-only update,
 * tables a reader skipped, and formatting memberships computed by walking rows. `skipOff`
 * makes {@link linesOfUnneededTable} always answer null, so tests can compare against the
 * full walk.
 */
export function tableFragmentFactsTestRecorder(options: { readonly skipOff?: boolean } = {}): {
  readonly computed: number;
  readonly shared: number;
  readonly skipped: number;
  readonly membersComputed: number;
  dispose(): void;
} {
  const counts = {
    computed: 0,
    shared: 0,
    skipped: 0,
    membersComputed: 0,
    skipOff: options.skipOff === true,
  };
  observer = counts;
  return {
    get computed() {
      return counts.computed;
    },
    get shared() {
      return counts.shared;
    },
    get skipped() {
      return counts.skipped;
    },
    get membersComputed() {
      return counts.membersComputed;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

/** The fragment's facts, from the memo or one walk of its rows. */
export function tableFragmentFacts(fragment: TableFragmentRecord): TableFragmentFacts {
  const cached = known.get(fragment);
  if (cached) return cached;
  const paragraphIds = new Set<string>();
  const nestedTableIds = new Set<string>();
  let lineCount = 0;
  const visitRows = (table: TableFragmentRecord): void => {
    for (const row of table.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) visitBlocks(cell.blocks);
    }
  };
  const visitBlocks = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        paragraphIds.add(block.paragraphId);
        lineCount += block.lines.length;
        continue;
      }
      nestedTableIds.add(block.tableId);
      visitRows(block);
    }
  };
  visitRows(fragment);
  const facts: TableFragmentFacts = { paragraphIds, nestedTableIds, lineCount };
  known.set(fragment, facts);
  if (observer) observer.computed += 1;
  return facts;
}

/**
 * Give `next` the facts and formatting members already known for `previous`. The caller proves
 * that `next` has the same rows, header-row repeats, cells, paragraphs, nested tables and line
 * counts, and that no paragraph fragment of either draws another paragraph. Nothing not yet
 * known for `previous` is computed here.
 */
export function shareTableFragmentFacts(
  previous: TableFragmentRecord,
  next: TableFragmentRecord
): void {
  if (previous === next) return;
  const facts = known.get(previous);
  if (facts) {
    known.set(next, facts);
    if (observer) observer.shared += 1;
  }
  // Members that name only the paragraphs themselves: the same for the same paragraphs.
  const members = formattingMembers.get(previous);
  if (members && !members.drawsOthers) formattingMembers.set(next, members);
}

interface FormattingMembers {
  readonly ids: ReadonlySet<string>;
  /** Some paragraph fragment names another paragraph in a line, span or drawing. */
  readonly drawsOthers: boolean;
}

const formattingMembers = new WeakMap<TableFragmentRecord, FormattingMembers>();

/** A line, span or drawing of `fragment` names a paragraph other than its own. */
function namesOtherParagraphs(fragment: ParagraphFragmentRecord): boolean {
  const own = fragment.paragraphId;
  for (const line of fragment.lines ?? []) {
    if (line.range.paragraphId !== own) return true;
    for (const span of line.spans) if (span.range.paragraphId !== own) return true;
    for (const drawing of line.drawings ?? []) if (drawing.paragraphId !== own) return true;
  }
  return false;
}

/**
 * Every paragraph the fragment's paragraph fragments draw (`fragmentParagraphs`), outside
 * repeated header rows and with nested tables entered: the rows a formatting read walks.
 * Unlike `paragraphIds`, it holds the paragraphs a merged fragment absorbed. Computed once per
 * fragment; a fragment that draws no other paragraph shares the facts' own id set.
 */
export function tableFormattingMembers(fragment: TableFragmentRecord): ReadonlySet<string> {
  const cached = formattingMembers.get(fragment);
  if (cached) return cached.ids;
  const own = new Set<string>();
  // Assigned in the walk below; the cast keeps the type from narrowing to `null` here.
  let drawn = null as Set<string> | null;
  const visitRows = (table: TableFragmentRecord): void => {
    for (const row of table.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) visitBlocks(cell.blocks);
    }
  };
  const visitBlocks = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const block of blocks) {
      if (block.kind !== 'paragraph') {
        visitRows(block);
        continue;
      }
      own.add(block.paragraphId);
      // Only a name in a line, span or drawing can add a member; the segments decide.
      if (!namesOtherParagraphs(block)) continue;
      drawn ??= new Set<string>();
      for (const id of fragmentParagraphs(block)) drawn.add(id);
    }
  };
  visitRows(fragment);
  let ids: ReadonlySet<string>;
  if (drawn) {
    for (const id of own) drawn.add(id);
    ids = drawn;
  } else ids = known.get(fragment)?.paragraphIds ?? own;
  formattingMembers.set(fragment, { ids, drawsOthers: drawn !== null });
  if (observer) observer.membersComputed += 1;
  return ids;
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const id of small) if (large.has(id)) return true;
  return false;
}

/**
 * The line count of `fragment` when a reader needs none of the paragraphs or nested tables
 * inside it, or null when it must walk the rows. The fragment's own id is the caller's to
 * check: it needs no row.
 */
export function linesOfUnneededTable(
  fragment: TableFragmentRecord,
  neededBlockIds: ReadonlySet<string>,
  neededParagraphIds: ReadonlySet<string>
): number | null {
  if (observer?.skipOff) return null;
  const facts = tableFragmentFacts(fragment);
  if (
    intersects(facts.paragraphIds, neededBlockIds) ||
    intersects(facts.paragraphIds, neededParagraphIds) ||
    intersects(facts.nestedTableIds, neededBlockIds)
  )
    return null;
  if (observer) observer.skipped += 1;
  return facts.lineCount;
}
