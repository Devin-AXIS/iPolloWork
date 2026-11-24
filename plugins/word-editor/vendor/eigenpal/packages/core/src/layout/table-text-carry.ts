// Text beside every fragment of a text-anchored floating table that breaks across pages.
//
// With `allowTextAfterFloatingTableBreak` ([MS-DOCX] 2.3.1) in a modern compatibility mode
// (`textBesideBrokenFloatingTable`), a text-anchored positioned table (ECMA-376 Part 1, 17.4.57)
// that breaks does not move the text after it to its last page (`table-text-float-break.ts`).
// The text starts at the table's anchor on the page of the first fragment and wraps beside it.
// Each later fragment opens its page and wraps the text that reaches that page.
//
// The body flow fills one page at a time. So while such a table breaks, this module holds its
// later fragments instead of opening their pages; the flow then resumes on the first fragment's
// page, and each page the flow opens next starts with the fragments held for it. The held pages
// are flow state: checkpoints carry and compare them.
//
// A table that leaves no passage for text in its column breaks as before. Limits: one-column
// sections only, not on the first sheet of a continued section, and a held page has the content
// height of the page the table started on.

import { TABLE_WRAP_MIN_PASSAGE_PT } from './drawing-exclusion.ts';
import type { BlockFragmentRecord } from './semantic-records.ts';
import { sameFragments } from './semantic-fragment-signature.ts';
import { withFloatingWrap } from './table-float-exclusion.ts';
import type { PositionedTableAnchor } from './table-float-position.ts';

const EPSILON = 0.001;

/** Fragments held for the pages after the one being filled, in page order. */
export type HeldTablePages = readonly (readonly BlockFragmentRecord[])[];

/** The body pass that fills pages. */
export interface CarryHost {
  /** The fragments of the page being filled. */
  readonly fragments: () => BlockFragmentRecord[];
  readonly setFragments: (fragments: BlockFragmentRecord[]) => void;
  /** The text column of the page being filled. */
  readonly column: () => { readonly left: number; readonly width: number };
  /** `textBesideBrokenFloatingTable` holds for the document. */
  readonly enabled: boolean;
  /** The section and page allow the carry now (see the header). */
  readonly applies: () => boolean;
}

/** One table's placement under the carry. Inert when the table does not qualify. */
export interface TableCarry {
  /** Counts a fragment the paginator published; the argument is ignored. */
  published(pageFragmentCount?: number): void;
  /** Holds the page being filled in place of opening the next one. False: open it as usual. */
  hold(flow: { cursorY: number }): boolean;
  /** After an ordinary advance: a table that moves before its first fragment takes its anchor. */
  moved(cursorY: number): number;
  /** Ends the table. The body position to resume at, or `undefined` when nothing was held. */
  close(): number | undefined;
}

/** Whether `fragment` leaves more than a quarter inch beside it, as `leavesPassage` does. */
function leavesPassage(
  fragment: BlockFragmentRecord,
  column: { readonly left: number; readonly width: number },
  distances: PositionedTableAnchor['float']['distances']
): boolean {
  const { left, width } = column;
  const before = fragment.box.x - (distances?.left ?? 0) - left;
  const after = left + width - (fragment.box.x + fragment.box.width + (distances?.right ?? 0));
  return Math.max(before, after) > TABLE_WRAP_MIN_PASSAGE_PT + EPSILON;
}

export class TextTableCarry {
  private held: BlockFragmentRecord[][] = [];

  constructor(private readonly host: CarryHost) {}

  /** Whether pages still wait for held fragments. */
  get pending(): boolean {
    return this.held.length > 0;
  }

  /** The fragments the next page opens with. */
  nextPage(): BlockFragmentRecord[] {
    return this.held.shift() ?? [];
  }

  checkpoint(): HeldTablePages | undefined {
    return this.held.length > 0 ? this.held.map((page) => [...page]) : undefined;
  }

  restore(pages: HeldTablePages | undefined): void {
    this.held = (pages ?? []).map((page) => [...page]);
  }

  /**
   * Starts one table that the paginator places in the body flow, `anchorY` below the top of the
   * page being filled. Inert for a table that is not text-anchored, or when the carry is off.
   */
  open(positioned: PositionedTableAnchor | undefined, anchorY: number): TableCarry {
    const { host } = this;
    const float = positioned?.float;
    if (!host.enabled || float?.vertAnchor !== 'text' || float.ySpec || !host.applies())
      return INERT;
    const column = host.column();
    const start = host.fragments().length;
    let published = 0;
    let resumeY = anchorY;
    let first: BlockFragmentRecord[] | undefined;
    let qualifies = true;
    const pages: BlockFragmentRecord[][] = [];
    return {
      published: () => void (published += 1),
      hold: (flow) => {
        if (!qualifies || published === 0) return false;
        const current = host.fragments();
        if (first) pages.push(current);
        else if (leavesPassage(current.at(-1)!, column, float.distances)) first = current;
        else return (qualifies = false);
        host.setFragments([]);
        flow.cursorY = 0;
        return true;
      },
      moved: (cursorY) => {
        if (published === 0) resumeY = cursorY;
        return cursorY;
      },
      close: () => {
        if (!first) return undefined;
        pages.push(host.fragments());
        const wrap = (fragment: BlockFragmentRecord) =>
          fragment.kind === 'table' ? withFloatingWrap(fragment, positioned, 0, true) : fragment;
        host.setFragments([...first.slice(0, start), ...first.slice(start).map(wrap)]);
        pages.forEach((page, index) => {
          this.held[index] = [...(this.held[index] ?? []), ...page.map(wrap)];
        });
        return resumeY;
      },
    };
  }
}

const INERT: TableCarry = {
  published: () => undefined,
  hold: () => false,
  moved: (cursorY) => cursorY,
  close: () => undefined,
};

/** Whether two checkpoints hold the same fragments for the same pages. */
export function sameHeldTablePages(
  a: HeldTablePages | undefined,
  b: HeldTablePages | undefined
): boolean {
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false;
  return (a ?? []).every((page, index) => sameFragments(page, b![index]!));
}
