// What the cells of an autofit table say about its columns beyond their minimums, as the
// minimum measuring in `table-autofit-widths.ts` collects it.
import type { SpanRequirement } from './table-autofit-distribution.ts';

/** What a table's cells say about its columns beyond their minimums. */
export interface AutofitColumnContent {
  /** Each column's widest unwrapped content, with the insets of the widened geometry. */
  readonly maximums: number[];
  /** Columns no single-column cell gives a preferred width: sized by their content. */
  readonly sizedByContent: boolean[];
  /** The widest absolute preferred width a single-column cell states, where one does. */
  readonly preferredWidths: (number | undefined)[];
  /** Columns a single-column cell gives a percentage preferred width. */
  readonly percentColumns: boolean[];
  /** Columns a single-column cell of horizontal text measured. */
  readonly measured: boolean[];
  /**
   * Each column's widest horizontal content insets, as its cells have them now. A table whose
   * minimums overflow keeps these whole and narrows only the content.
   */
  readonly insets: number[];
  /** The width each cell of vertical text has across the columns it covers. */
  readonly verticalHolds: SpanRequirement[];
  /** What each cell spanning several columns needs across them. */
  readonly spans: SpanRequirement[];
}

export function emptyColumnContent(): AutofitColumnContent {
  return {
    maximums: [],
    sizedByContent: [],
    preferredWidths: [],
    percentColumns: [],
    measured: [],
    insets: [],
    verticalHolds: [],
    spans: [],
  };
}

/** A table's column needs: its minimums now and once widened, and what its cells say. */
export interface AutofitColumnNeeds {
  readonly minimumsNow: number[];
  readonly ifWidened: number[];
  readonly content: AutofitColumnContent;
}

/**
 * Takes the larger need of each column between `needs` and a second reading of the same
 * table, such as the one that shows deleted content. `measure` fills the reading's widened
 * minimums and content and returns its minimums now.
 */
export function mergeMarkupNeeds(
  needs: AutofitColumnNeeds,
  measure: (widened: number[], content: AutofitColumnContent) => readonly number[]
): void {
  const { minimumsNow, ifWidened, content } = needs;
  const widened: number[] = [];
  const other = emptyColumnContent();
  for (const [column, minimum] of measure(widened, other).entries()) {
    if (!other.measured[column]) continue;
    minimumsNow[column] = Math.max(minimumsNow[column]!, minimum);
    ifWidened[column] = Math.max(ifWidened[column]!, widened[column]!);
    content.insets[column] = Math.max(content.insets[column]!, other.insets[column]!);
    content.maximums[column] = Math.max(content.maximums[column]!, other.maximums[column]!);
  }
}
