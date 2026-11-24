// Blank sheets that give a section the page parity it must start on.
//
// Two rules put an empty sheet in front of a section that starts a new page:
//
// - `w:type` `oddPage` / `evenPage` (ECMA-376 §17.18.77) starts the section on the next page
//   whose DISPLAYED number is odd / even. The skipped sheet takes the number in between.
// - Under `w:evenAndOddHeaders` (§17.10.1) a section that restarts its numbering starts on a
//   sheet whose continued number has the parity of the restarted number. A restart on a
//   shared continuous sheet does not reset that sequence.
//
// A restarted number does not move when a sheet is added. With alternating headers enabled,
// an explicit odd/even break selects physical sheet parity before the restart is applied.
// Otherwise the restart selects that parity. Without alternating headers, a restart adds no
// sheet. Continuous sections share the previous sheet and never get one.
//
// The sheet is empty: no body, header, footer, drawing, or page border. It is not a page of
// either section, so SECTIONPAGES does not count it. NUMPAGES counts it like every sheet.

import { verticalMarginInsets } from './page-body-margins.ts';
import type { DocumentSection } from './section-properties.ts';
import type { PageGeometry, PageRecord, SemanticLayout } from './semantic-records.ts';

export interface ParitySheetInputs {
  readonly breakType: DocumentSection['properties']['breakType'];
  /** `w:pgNumType/@w:start` when the section restarts its numbering. */
  readonly restart: number | undefined;
  /** The continued number before applying this section's restart or adding a blank. */
  readonly nextDisplayed: number;
  /** Continued sheet number, excluding restarts on a shared sheet. */
  readonly nextParity?: number;
  /** The document index of the section's first sheet when nothing is inserted. */
  readonly sheetIndex: number;
  readonly evenAndOddHeaders: boolean;
}

/** Whether the section needs one blank sheet in front of it. */
export function sectionNeedsParitySheet(inputs: ParitySheetInputs): boolean {
  if (inputs.breakType === 'continuous' || inputs.sheetIndex === 0) return false;
  if (inputs.restart !== undefined) {
    // Ordinary restarts continue the preceding sheet sequence. Explicit odd/even breaks
    // select a physical sheet, independently of the displayed number restarted there.
    const parity =
      inputs.breakType === 'oddPage' ? 1 : inputs.breakType === 'evenPage' ? 0 : inputs.restart;
    const explicit = inputs.breakType === 'oddPage' || inputs.breakType === 'evenPage';
    const continued = explicit
      ? inputs.sheetIndex + 1
      : (inputs.nextParity ?? inputs.nextDisplayed);
    return inputs.evenAndOddHeaders && (parity - continued) % 2 !== 0;
  }
  if (inputs.breakType === 'oddPage') return inputs.nextDisplayed % 2 === 0;
  if (inputs.breakType === 'evenPage') return inputs.nextDisplayed % 2 !== 0;
  return false;
}

/**
 * The blank sheet at `index`, `sheetY` down the stack, sized by the section it precedes.
 *
 * `previous` is the sheet the last pass published for the same section. It is returned by
 * identity when nothing about it moved, so paint and the finalized-page restore keep it.
 */
export function paritySheetAt(
  index: number,
  sheetY: number,
  geometry: PageGeometry,
  previous: PageRecord | undefined
): PageRecord {
  const margins = verticalMarginInsets(geometry);
  if (
    previous &&
    previous.index === index &&
    previous.box.y === sheetY &&
    previous.box.width === geometry.width &&
    previous.box.height === geometry.height &&
    previous.contentBox.x === geometry.margin.left &&
    previous.contentBox.y === sheetY + margins.top &&
    previous.contentBox.width === geometry.width - geometry.margin.left - geometry.margin.right &&
    previous.contentBox.height === geometry.height - margins.top - margins.bottom
  ) {
    return previous;
  }
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: sheetY, width: geometry.width, height: geometry.height },
    contentBox: {
      x: geometry.margin.left,
      y: sheetY + margins.top,
      width: geometry.width - geometry.margin.left - geometry.margin.right,
      height: geometry.height - margins.top - margins.bottom,
    },
    fragments: [],
    hasBodyPageFields: false,
    parityBlank: true,
  };
}

/** Where one section's own sheets begin, and what decides its parity and numbering. */
export interface SectionSheetStart {
  /** Body-pass index of the section's first own sheet, after any blank sheet in front. */
  readonly pageIndex: number;
  readonly breakType: DocumentSection['properties']['breakType'];
  readonly restart: number | undefined;
  /** The body pass's running displayed number before any blank sheet in front. */
  readonly runningBefore: number;
  /** Overflow sheets of a section that began on the preceding section's sheet. */
  readonly continuesPreviousSheet?: boolean;
  readonly geometry: PageGeometry;
}

interface ParityPlan {
  readonly evenAndOddHeaders: boolean;
  readonly starts: ReadonlyMap<number, SectionSheetStart>;
  /** Running number after a body-pass sheet, where it is not the sheet's stamp + 1. */
  readonly runningAfter: ReadonlyMap<number, number>;
}

/**
 * Keyed by the body layout the notes pass receives, like the overflow shell resolver. The
 * notes pass inserts sheets after the parity decision, so it needs these inputs to decide
 * again against the final positions.
 */
const parityPlans = new WeakMap<SemanticLayout, ParityPlan>();

/** Whether the layout alternates header and footer variants on odd and even page numbers. */
export function layoutUsesEvenAndOddHeaders(layout: SemanticLayout): boolean {
  return parityPlans.get(layout)?.evenAndOddHeaders ?? false;
}

export function registerParityPlan(
  layout: SemanticLayout,
  evenAndOddHeaders: boolean,
  starts: readonly SectionSheetStart[],
  runningAfter: ReadonlyMap<number, number>
): void {
  parityPlans.set(layout, {
    evenAndOddHeaders,
    starts: new Map(starts.map((start) => [start.pageIndex, start])),
    runningAfter: new Map(runningAfter),
  });
}

/**
 * Decide the blank parity sheets and the continued page numbers again after the notes pass
 * inserted sheets.
 *
 * Uses the body pass's running displayed number, moved by `shift`: the numbered sheets the
 * notes pass inserted since the last restart, plus blank sheets added, minus blank sheets
 * dropped. A restart, visible or ending on a shared sheet, sets the shift back to zero. So a
 * note sheet moves only the unrestarted numbers after it, and a section's number and blank
 * sheet never depend on a note sheet that comes later. Every blank sheet is dropped and the
 * rule runs again at each section start. Runs while body-pass pages still carry their
 * body-pass index.
 */
export function resettleParitySheets(
  pages: readonly PageRecord[],
  layout: SemanticLayout
): readonly PageRecord[] {
  const plan = parityPlans.get(layout);
  if (!plan) return pages;
  const next: PageRecord[] = [];
  let shift = 0;
  /** The running displayed number the next sheet gets, in final terms. */
  let running = 1;
  let parityRunning = 1;
  const numbered = (page: PageRecord, pageNumber: number): PageRecord => {
    const source = page.pageFieldSource;
    return source && source.pageNumber !== pageNumber
      ? { ...page, pageFieldSource: { ...source, pageNumber } }
      : page;
  };
  for (const page of pages) {
    if (page.parityBlank) continue;
    const stored = page.pageFieldSource?.pageNumber;
    if (page.noteStream !== undefined) {
      // A sheet the notes pass inserted takes the running number and moves what follows.
      next.push(numbered(page, running));
      running += 1;
      parityRunning += 1;
      shift += 1;
      continue;
    }
    if (stored === undefined) {
      next.push(page);
      running += 1;
      parityRunning += 1;
      continue;
    }
    const start = plan.starts.get(page.index);
    if (start) {
      let displayed = start.restart ?? start.runningBefore + shift;
      if (
        sectionNeedsParitySheet({
          breakType: start.breakType,
          restart: start.restart,
          nextDisplayed: start.restart === undefined ? displayed : running,
          nextParity: parityRunning,
          sheetIndex: next.length,
          evenAndOddHeaders: plan.evenAndOddHeaders,
        })
      ) {
        next.push(paritySheetAt(start.pageIndex, 0, start.geometry, undefined));
        if (start.restart === undefined) displayed += 1;
        parityRunning += 1;
      }
      // A restarted section's stamps are already final; an unrestarted one moves with the
      // sheets in front of it. Its stamp is the body pass's running number, blank included.
      shift = start.restart === undefined ? displayed - stored : 0;
    }
    if (
      start &&
      start.restart !== undefined &&
      !(start.continuesPreviousSheet ?? start.breakType === 'continuous')
    ) {
      parityRunning = stored + shift;
    }
    parityRunning += 1;
    next.push(numbered(page, stored + shift));
    const restartedAfter = plan.runningAfter.get(page.index);
    if (restartedAfter !== undefined) {
      // A restart ended on this shared sheet: the running number is absolute from here.
      running = restartedAfter;
      shift = 0;
    } else {
      running = stored + shift + 1;
    }
  }
  return next;
}
