// The reuse-context key of one layout pass.
//
// Every per-block cache key and every flow checkpoint describes the block it belongs to. The
// inputs a pass measures AGAINST — page geometry, where the flow starts, the furniture it
// avoids, the column grid, the page frame — live in no block, so a change to one of them
// would let each reuse path hand back the previous sheets. This string is where those inputs
// meet; a pass whose string differs from the previous pass's starts over.
import { pageBordersFingerprint, type SectionPageBorders } from './page-borders.ts';
import type { PageContentInsets } from './page-furniture-insets.ts';
import type { ResolvedSectionColumns } from './section-columns.ts';
import type { PageGeometry } from './semantic-records.ts';

export interface LayoutPassContextInputs {
  readonly geometry: PageGeometry;
  readonly flowStartY: number;
  readonly spaceBeforeCarry: number;
  /** The host sheet's content box when this section continues on another section's page. */
  readonly continuedInsets: PageContentInsets | undefined;
  /** Wrap zones of the host sheet's furniture on a continued section's local page 0. */
  readonly continuedZones?: string;
  /** The header/footer half of the key, from `furnitureLayoutContext`. */
  readonly furnitureContext: string;
  readonly columns: ResolvedSectionColumns;
  /** Set while a column-balance probe caps the flow at a page-local bottom. */
  readonly columnRegionBottom: number | undefined;
  readonly columnRegionPage?: number;
  readonly sectionPageBorders: SectionPageBorders | undefined;
  /** Set when a continuous section follows, so an empty section mark takes no flow height. */
  readonly sectionMarkCollapses?: boolean;
}

/**
 * Builds the context key for a pass. The notes reserve part is a parameter because the pass
 * computes it twice: once up front, and once more at the end against the pages it produced.
 *
 * Body line ids are paragraph-local, so a changed line count in an earlier section does not
 * invalidate this section. Geometry and flow start still do. The document page index is
 * deliberately NOT here — numbers re-project at finalize and shells renumber at remap; keying
 * on it re-laid every section below an Enter that added one page. The one real dependence,
 * page PARITY, is checked by `comparable` through the session parity fields.
 *
 * The producer is compared BESIDE the context (`session.producer`), not embedded in it: it
 * carries the control token, which runs to kilobytes on a control-heavy document, and
 * embedding it copied that token into every section's context string on every pass.
 */
export function layoutPassContextKey(
  inputs: LayoutPassContextInputs
): (notesReserveKey: string) => string {
  const { geometry, columns, columnRegionBottom, continuedInsets } = inputs;
  const columnsContext = `|cols:${columns.widths.join(',')};${columns.gaps.join(',')};${columns.lefts.join(',')};${columns.separator ? 1 : 0}${columnRegionBottom !== undefined ? `;bal:${inputs.columnRegionPage ?? 0}:${columnRegionBottom}` : ''}`;
  // The host sheet's box is an INPUT to this section's flow, so a host whose own variant moved
  // must not let this section resume a flow measured against the box it used to have. The
  // host's furniture wrap zones are an input too. Their token embeds part names from the file,
  // so it is length-framed: a printable separator would be a forgeable boundary.
  const zones = inputs.continuedZones ?? '';
  const continuedContext = continuedInsets
    ? `|cont:${continuedInsets.top},${continuedInsets.height};z${zones.length}:${zones}`
    : '';
  // A `w:pgBorders` edit moves NO paragraph key: the frame is drawn beside the text and never
  // through it, so every per-block key and every checkpoint still matches and each reuse path
  // would hand back the previous sheets carrying the previous frame. Geometry is already in
  // this string for the same reason; the frame is geometry the flow happens not to read.
  const pageBordersContext = inputs.sectionPageBorders
    ? `|pgb:${pageBordersFingerprint(inputs.sectionPageBorders)}`
    : '';
  const head = `${geometry.width}x${geometry.height}|${geometry.margin.top},${geometry.margin.right},${geometry.margin.bottom},${geometry.margin.left}|fs:${inputs.flowStartY},${inputs.spaceBeforeCarry}${continuedContext}${inputs.furnitureContext}`;
  // `markJoinsBreakSheet` is not here: only a section's last two blocks read it, so it folds
  // into their flow keys (`markJoinFlowKeys`) and a section that gains a successor keeps its
  // checkpoints.
  const markContext = inputs.sectionMarkCollapses ? '|smc' : '';
  return (notesReserveKey) =>
    `${head}${notesReserveKey}${columnsContext}${pageBordersContext}${markContext}`;
}
