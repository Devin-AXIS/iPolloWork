// Section line grid (`w:docGrid`, ECMA-376 §17.6.5) as it applies to paragraph lines.
//
// A section whose grid type is `lines`, `linesAndChars` or `snapToChars` declares a line
// pitch in twips. Every line of a paragraph that snaps to the grid takes a whole number of
// pitches: the natural line box rounds UP to the next multiple, and the glyphs sit centred
// in it. A 12pt line under an 18pt pitch is 18pt tall, and a 20pt heading is 36pt tall.
// This is a height rule, not an absolute position rule: the lines of a paragraph that
// starts part-way down a pitch keep that offset.
//
// A paragraph opts out with `w:pPr/w:snapToGrid w:val="0"` (inherited through the style
// cascade like any other paragraph property). `auto` and `atLeast` spacing snap; an `exact`
// line keeps its authored height. An `atLeast` value above the snapped line keeps its own
// height (a 20pt `atLeast` line of 11pt text under an 18pt pitch is 20pt, not two pitches),
// and a value below it takes the snapped line.
// The run-level `w:rPr/w:snapToGrid` is the CHARACTER grid and never reaches this file.
// Table cells do not snap unless the document sets the `w:adjustLineHeightInTable`
// compatibility option (§17.15.3.1).

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { ParagraphLineSpacing } from './paragraph-style.ts';

/**
 * The glyph box may overhang the pitch by this much before a line takes another pitch.
 * Converting twips and summing font metrics can land a line that exactly fills its pitch a
 * part in 1e12 above it, which would otherwise double the line.
 */
const GRID_FIT_TOLERANCE_PT = 0.001;

/** `ST_OnOff` read as an attribute value: anything but an explicit off is on. */
function isOn(raw: string | undefined): boolean {
  return raw === undefined || (raw !== '0' && raw !== 'false' && raw !== 'off');
}

/**
 * Whether a paragraph's lines snap to an active line grid (`w:pPr/w:snapToGrid`).
 *
 * `props` is the flattened cascade, lowest precedence first, so the LAST entry wins. An
 * absent element snaps: the schema default is on whenever a grid exists.
 */
export function paragraphSnapsToLineGrid(props: readonly OoxmlProperty[]): boolean {
  let snaps = true;
  for (const property of props) {
    if (property.localName === 'snapToGrid') snaps = isOn(property.attributes?.val);
  }
  return snaps;
}

/**
 * Attach the section's line pitch to a paragraph's resolved line spacing when its lines
 * snap. Returns the input unchanged when no grid applies, including for `exact` spacing.
 */
export function withLineGrid(
  spacing: ParagraphLineSpacing,
  props: readonly OoxmlProperty[],
  gridPitchPt: number | undefined,
  inTableCell: boolean,
  tableCellsSnap: boolean
): ParagraphLineSpacing {
  if (gridPitchPt === undefined || !(gridPitchPt > 0)) return spacing;
  if (spacing.rule === 'exact' || (inTableCell && !tableCellsSnap)) return spacing;
  if (!paragraphSnapsToLineGrid(props)) return spacing;
  return { ...spacing, gridPitch: gridPitchPt };
}

/**
 * A snapped line box. The natural box rounds up to whole pitches.
 *
 * An `auto` multiple counts in pitches, not in natural heights: the line takes the larger of
 * the snapped pitch count and the multiple, so double spacing is two pitches whatever the
 * font, and a line that already needs two pitches stays two pitches at 1.5 or double. A
 * multiple under one keeps the snapped line, the smallest line a snapping paragraph can have.
 * The glyphs sit centred in the whole box.
 *
 * An `atLeast` value at or below the snapped line takes the snapped line with centred glyphs.
 * A larger value keeps its own height: the snapped line sits at the foot of that box and the
 * extra height is above it.
 *
 * `trailing` is the box below the glyphs. Pagination lets that depth hang past the bottom
 * margin, so a line fits when its glyphs fit, and the line still advances by its whole box.
 */
export function gridLineBox(
  spacing: ParagraphLineSpacing & { readonly gridPitch: number },
  naturalHeight: number,
  naturalBaseline: number
): { height: number; baseline: number; trailing: number } {
  const pitch = spacing.gridPitch;
  const pitches = Math.max(1, Math.ceil((naturalHeight - GRID_FIT_TOLERANCE_PT) / pitch));
  const snapped = pitches * pitch;
  const snappedCentring = (snapped - naturalHeight) / 2;
  if (spacing.rule === 'atLeast' && spacing.value > snapped) {
    // The snapped line sits at the foot of the taller box; the extra is above it.
    const height = spacing.value;
    const baseline = naturalBaseline + height - snapped + snappedCentring;
    return { height, baseline, trailing: snappedCentring };
  }
  const multiple = spacing.rule === 'auto' ? spacing.value / 240 : 1;
  const height = Math.max(pitches, multiple) * pitch;
  const centring = (height - naturalHeight) / 2;
  return { height, baseline: naturalBaseline + centring, trailing: centring };
}

/**
 * Snap the lines of a story paragraph that the box flow resolved as a cell paragraph.
 *
 * Note stories flow through the same box walk as table cells, which never snap without
 * `w:adjustLineHeightInTable`. Their own paragraphs follow the section grid like body text, so
 * the walk passes the pitch here for paragraphs outside any cell. Opt-outs still apply.
 */
export function withStoryLineGrid<
  T extends {
    readonly lineSpacing: ParagraphLineSpacing;
    readonly props: readonly OoxmlProperty[];
  },
>(inputs: T, gridPitchPt: number | undefined): T {
  if (gridPitchPt === undefined || inputs.lineSpacing.gridPitch !== undefined) return inputs;
  const lineSpacing = withLineGrid(inputs.lineSpacing, inputs.props, gridPitchPt, false, false);
  return lineSpacing === inputs.lineSpacing ? inputs : { ...inputs, lineSpacing };
}
