import type { SemanticTableCell } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { cellParagraphInputs } from './cell-paragraph-inputs.ts';
import type { ParagraphLayoutInputs, StyleCascadeTable } from './style-cascade.ts';
import { markRunPropertiesWithoutCharacterStyle } from './paragraph-mark-run.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle } from './run-style.ts';
import { applyLineSpacing, type ParagraphSpacing } from './paragraph-style.ts';
import { hasShownRunContent } from './cell-end-paragraph-content.ts';
import { cellHidesEndMark } from './table-cell-terminator.ts';

const markStyles = new WeakMap<
  ParagraphLayoutInputs['markRunProperties'],
  {
    readonly theme: StyleCascadeTable['themeFonts'] | undefined;
    readonly style: ReturnType<typeof resolveRunStyle>;
  }
>();

function endMarkStyle(inputs: ParagraphLayoutInputs, deps: TableFlowDeps) {
  const mark = markRunPropertiesWithoutCharacterStyle(inputs.markRunProperties);
  if (mark.length === 0) return DEFAULT_RUN_STYLE;
  const theme = deps.styleCascade?.themeFonts;
  const known = markStyles.get(mark);
  if (known && known.theme === theme) return known.style;
  const style = resolveRunStyle(mark, theme);
  markStyles.set(mark, { theme, style });
  return style;
}

/** The end-of-cell paragraph's own line box and the gaps it asks for around it. */
interface EndMarkBox {
  readonly linePt: number;
  readonly spacing: ParagraphSpacing;
}

/**
 * The line the end-of-cell glyph occupies, with the paragraph spacing that frames it.
 *
 * `null` when the mark contributes nothing: `w:hideMark` excludes it from row height by
 * definition (17.4.25), a `w:vanish` mark is not measured, and a face that did not resolve
 * cannot be measured at all.
 */
function endMarkBox(
  cell: SemanticTableCell,
  width: number,
  deps: TableFlowDeps
): EndMarkBox | null {
  if (cellHidesEndMark(cell, deps.documentFirstParagraphId)) return null;
  const paragraph = cell.blocks.at(-1);
  if (paragraph?.kind !== 'paragraph') return null;
  const inputs = cellParagraphInputs(
    paragraph,
    width,
    deps.styleCascade,
    deps.listItems?.get(paragraph.id),
    cell.styleFormatting,
    deps.paragraphLineUnitPt
  );
  // The floor also stands under a cell with content, so it reads the mark WITHOUT its
  // character style (`paragraph-mark-run.ts`). An empty end paragraph's own line has it.
  const style = endMarkStyle(inputs, deps);
  if (style.hidden || deps.measurer.hasResolvedFont?.(style) === false) return null;
  const metrics = deps.measurer.lineMetrics(style);
  return {
    linePt: applyLineSpacing(inputs.lineSpacing, metrics.height, metrics.baseline).height,
    spacing: inputs.spacing,
  };
}

/**
 * The row minimum an ordinary cell's end-of-cell mark sets: its line, but only when the end
 * paragraph holds nothing else. Under text the mark sets no minimum. Measured with a 20pt
 * mark under 5pt text and a 10pt mark under 1pt text, in left-to-right and right-to-left
 * paragraphs, in compatibility modes 14 and 15 and with no mode: each row was as tall as its
 * text line. An empty end paragraph takes the mark's line, 24pt for the 20pt mark, and so
 * does one that holds only hidden or deleted runs.
 */
export function cellEndMarkHeight(
  cell: SemanticTableCell,
  width: number,
  deps: TableFlowDeps
): number {
  const paragraph = cell.blocks.at(-1);
  if (paragraph?.kind === 'paragraph' && hasShownRunContent(paragraph, deps.styleCascade)) return 0;
  return endMarkBox(cell, width, deps)?.linePt ?? 0;
}

/**
 * What a row asks of a `w:vMerge` continuation cell when NOTHING ELSE can size it.
 *
 * A continuation cell is excluded from its row's height, the same way it is excluded from
 * painting: `vmerge-continuation-control.docx` t8 puts a continuation authoring 18pt of
 * `w:after` beside a plain one-line cell, and the reference row is 15.60pt — the plain
 * cell's line, with the continuation's box contributing nothing.
 *
 * A row whose cells are ALL continuations has nothing left to size it, and the reference
 * then sizes it from the END-OF-CELL paragraph's box: spacing before, the mark's line, and
 * spacing after. Same control, same capture, row-2 content between the painted rules:
 *
 *   t1 bare `w:p` inheriting Normal `w:after="120"`   21.60 = 15.60 line + 6
 *   t2 `w:after="0"`                                  15.60 = the line alone
 *   t3 `w:before="240" w:after="360"`                 45.60 = 15.60 + 12 + 18
 *   t4 THREE paragraphs of text, `w:after="0"`        15.36 - the mark, NOT the content
 *   t5 mark at `w:sz="32"`                            22.32 = the 16pt line
 *   t7 two continuation rows                          21.36 and 21.60 - per row, not per span
 *
 * t4 is why this reads the end mark rather than flowing the cell: three paragraphs of text
 * that the cell does not paint measure the same as one empty paragraph.
 *
 * t8 cannot separate "contributes nothing" from "contributes its bare mark line", because
 * there the two are both 15.60. This takes the first reading, which is the one that leaves
 * every mixed row in the corpus where it already is.
 *
 * OPEN: t6 gives a continuation `w:hideMark` and the reference row is 23.52pt, neither zero
 * nor any line this file can derive. `hideMark` keeps its engine-wide meaning here until a
 * control explains that number; no corpus document sets it on a continuation.
 */
export function cellContinuationHeight(
  cell: SemanticTableCell,
  width: number,
  deps: TableFlowDeps
): number {
  const box = endMarkBox(cell, width, deps);
  if (box === null) return 0;
  return Math.max(0, box.spacing.before) + box.linePt + Math.max(0, box.spacing.after);
}

/**
 * The two heights an end-of-cell paragraph can reserve, resolved together.
 *
 * `markFloor` is what an ordinary cell reserves for its own end mark. `continuation` is
 * what a row reserves when every one of its cells continues a vertical merge or holds
 * `btLr` text that waits for the row (`waitsForRowHeight`), so no other content sizes it.
 * They are mutually exclusive by construction. A `btLr` cell reserves no mark floor: its
 * text runs along the row, so only a row that nothing else sizes takes its end mark.
 */
export function cellReservedMarkHeights(
  cell: SemanticTableCell,
  widthPt: number,
  deps: TableFlowDeps,
  options: { readonly vertical: boolean; readonly markSizedRow: boolean }
): { readonly markFloor: number; readonly continuation: number } {
  if (!cell.vMergeContinue && !options.vertical)
    return { markFloor: cellEndMarkHeight(cell, widthPt, deps), continuation: 0 };
  return {
    markFloor: 0,
    continuation: options.markSizedRow ? cellContinuationHeight(cell, widthPt, deps) : 0,
  };
}
