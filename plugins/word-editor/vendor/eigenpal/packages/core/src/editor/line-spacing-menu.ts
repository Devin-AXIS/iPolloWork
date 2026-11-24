// The rows of the toolbar's line-spacing menu, derived from the spacing in force.
//
// One answer for both adapters: which presets the menu lists, which row carries the tick,
// what each row applies, and how a spacing the presets cannot express still shows as the
// current one. A menu that ticks nothing over a 1.08 or an "Exactly 12 pt" paragraph reads
// as "no spacing applied", which is the one thing it is never true of.

import type { EditorCommand } from '../contracts/editor.ts';
import type { SurfaceFormatting } from './paginated-surface-contract.ts';

/** The multiples the line-spacing menu offers, in lines. @public */
export const LINE_SPACING_PRESETS: readonly number[] = Object.freeze([1, 1.15, 1.5, 2, 2.5, 3]);

/** The line spacing a menu row stands for: lines for `multiple`, points otherwise. @public */
export type LineSpacingMenuValue = NonNullable<SurfaceFormatting['lineSpacing']>;

/** One row of the line-spacing menu. @public */
export interface LineSpacingMenuRow {
  /** The spacing the row stands for. */
  readonly spacing: LineSpacingMenuValue;
  /**
   * What picking the row executes, or null for the selected row: it already holds, and
   * its value is the read rounded to two decimals, so writing it back would quietly move
   * an authored `w:line="253"` to 252. Picking a null row only closes the menu.
   */
  readonly command: Extract<EditorCommand, { type: 'setLineSpacing' }> | null;
  /**
   * The number as the row shows it: one decimal for a multiple unless it needs two (`1.0`,
   * `1.15`), and the point value for `exact` and `atLeast`.
   */
  readonly text: string;
  /**
   * The i18n key whose `{value}` placeholder takes `text`, or null when `text` is the
   * whole label (a multiple).
   */
  readonly labelKey: 'lineSpacing.exactlyPoints' | 'lineSpacing.atLeastPoints' | null;
  /** Whether this is the spacing in force across the whole selection. */
  readonly selected: boolean;
  /** False for the extra row that shows a current spacing no preset matches. */
  readonly preset: boolean;
}

function multipleText(lines: number): string {
  return Number.isInteger(lines * 10) ? lines.toFixed(1) : String(lines);
}

function rowFor(spacing: LineSpacingMenuValue, selected: boolean, preset: boolean) {
  const multiple = spacing.rule === 'multiple';
  return {
    spacing,
    command: selected
      ? null
      : ({ type: 'setLineSpacing', rule: spacing.rule, value: spacing.value } as const),
    text: multiple ? multipleText(spacing.value) : String(spacing.value),
    labelKey: multiple
      ? null
      : spacing.rule === 'exact'
        ? 'lineSpacing.exactlyPoints'
        : 'lineSpacing.atLeastPoints',
    selected,
    preset,
  } satisfies LineSpacingMenuRow;
}

/**
 * The line-spacing menu rows for the spacing in force.
 *
 * A current multiple that is not a preset joins the list in order, ticked; a current
 * `exact` or `atLeast` leads the list as its own ticked row. A selection whose paragraphs
 * disagree (`current` null) ticks nothing, because no one row is true of all of it.
 * @public
 */
export function lineSpacingMenuRows(
  current: SurfaceFormatting['lineSpacing']
): readonly LineSpacingMenuRow[] {
  const rows: LineSpacingMenuRow[] = LINE_SPACING_PRESETS.map((lines) =>
    rowFor(
      { rule: 'multiple', value: lines },
      current?.rule === 'multiple' && current.value === lines,
      true
    )
  );
  if (!current || rows.some((row) => row.selected)) return rows;
  const extra = rowFor(current, true, false);
  if (current.rule !== 'multiple') return [extra, ...rows];
  const at = rows.findIndex((row) => row.spacing.value > current.value);
  rows.splice(at === -1 ? rows.length : at, 0, extra);
  return rows;
}

function formatNumber(value: number, minimumFractionDigits: number, locale?: string): string {
  const options = { minimumFractionDigits, maximumFractionDigits: 2 };
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // A malformed host language tag must not take the menu down with it.
    return new Intl.NumberFormat('en', options).format(value);
  }
}

/**
 * A row's visible label, with its number in `locale`'s format (`1,5` in German).
 *
 * `label` resolves an i18n key without interpolation, as a toolbar's host translation
 * does, so the `{value}` placeholder is filled here. Without a `locale` the number reads
 * as `text` does.
 * @public
 */
export function lineSpacingMenuRowLabel(
  row: LineSpacingMenuRow,
  label: (key: string) => string,
  locale?: string
): string {
  // A multiple keeps at least one decimal (`1.0`, `1.15`), as `text` does.
  const number =
    locale === undefined
      ? row.text
      : formatNumber(row.spacing.value, row.spacing.rule === 'multiple' ? 1 : 0, locale);
  return row.labelKey ? label(row.labelKey).replace('{value}', number) : number;
}
