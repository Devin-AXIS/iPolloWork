import { carryLayoutReadCaches } from './layout-read-caches.ts';
import { carryFragmentPageRoutes } from './fragment-page-routes.ts';
import { carryParagraphPageRoutes, carryPageParagraphNames } from './paragraph-lines.ts';
import { carryPageOrder } from './document-order.ts';
import type { LayoutSession } from './layout-session.ts';
import type { SectionPrepass } from './section-prepass-types.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { BlockLayoutResult } from './column-balance-layout.ts';
import { withContentControlMetadata } from './content-control-boundary-layout.ts';
import { autofitContextMatches } from './autofit-context-reuse.ts';
import { valueDigest } from './autofit-value-token.ts';
import { autofitContextOf, carryTableAutofitScope } from './table-autofit-widths.ts';
import { updateTableText } from './table-text-update.ts';
import { registerTableWidthReuseScope } from './table-width-reuse-scope.ts';
import type { TablePageBand } from './table-width-update.ts';
import { carryPageTableContributions, carryTableCaretContexts } from './table-caret-context.ts';
import { offerPreviousRows, offerUnchangedTableRows } from './table-row-placement-reuse.ts';
import { tableTextStructureUnchanged } from './table-text-change.ts';
import { drawingInputsUnchangedByTextEdit } from './drawing-text-only-change.ts';

type Result = Omit<BlockLayoutResult, 'overflowShellAt'>;
function resultOf(session: LayoutSession): Result {
  const layout = session.previous!;
  return {
    layout,
    pages: layout.pages,
    lineCounter: session.endLineCounter,
    endCursorY: session.endCursorY,
    endSpaceAfter: session.endSpaceAfter,
    endsOpenPage: session.endsOpenPage,
  };
}
export function reuseUnchangedLayout(
  session: LayoutSession,
  revision: number,
  lineCounterStart: number
): Result {
  const previous = session.previous!;
  session.previous = withContentControlMetadata({ revision, pages: previous.pages }, previous);
  carryLayoutReadCaches(previous, session.previous);
  session.endLineCounter = lineCounterStart + session.endLineCounter - session.startLineCounter;
  session.startLineCounter = lineCounterStart;
  session.stats = {
    placed: 0,
    total: session.keys.length,
    reusedPages: previous.pages.length,
    fullPasses: session.stats.fullPasses,
  };
  return resultOf(session);
}
export function tryUpdateTableSession(input: {
  session: LayoutSession | undefined;
  previous: SectionPrepass | null | undefined;
  prepass: SectionPrepass;
  inputsEqual: boolean;
  /**
   * Unchanged section inputs except list items and numbering: each rebuilt table key proves its
   * own list and hosted-list tokens, and each cached cell its paragraphs' tokens.
   */
  rowInputsEqual?: boolean;
  eligible: boolean;
  firstChanged: number;
  commonSuffix: number;
  deps: TableFlowDeps;
  /** The body band of each previous page, by the index the pass fills it at. */
  pageBand: TablePageBand;
  revision: number;
  lineCounterStart: number;
}): Result | null {
  const { session, previous, prepass, firstChanged, deps, revision, lineCounterStart } = input;
  const sameInputs = carryTableAutofitScope(
    previous,
    prepass,
    input.inputsEqual,
    deps,
    input.rowInputsEqual === true
  );
  registerTableWidthReuseScope(deps, sameInputs);
  const rowInputsEqual =
    sameInputs ||
    (input.rowInputsEqual &&
      autofitContextMatches(
        previous,
        true,
        autofitContextOf(deps),
        [
          valueDigest(deps.fieldCodeRanges),
          valueDigest(deps.tocLinkStyleRanges),
          valueDigest(deps.noteMarks),
        ].join('\0')
      ));
  if (input.eligible && rowInputsEqual && previous && session?.previous)
    offerUnchangedTableRows(deps, previous, prepass, session.previous.pages);
  if (
    !input.eligible ||
    !sameInputs ||
    !session?.previous ||
    !previous ||
    prepass.prepared.length !== session.keys.length ||
    input.commonSuffix !== prepass.prepared.length - firstChanged - 1
  )
    return null;
  const oldEntry = previous.prepared[firstChanged];
  const entry = prepass.prepared[firstChanged];
  if (oldEntry?.kind !== 'table' || entry?.kind !== 'table') return null;
  const update = updateTableText(
    oldEntry.table,
    entry.table,
    session.previous.pages,
    prepass.contentWidth,
    deps,
    input.pageBand
  );
  if (!update) {
    // The full pagination that follows can still reuse every row that keeps its place. A
    // moved row keeps its old cell and row properties, so only a text-only edit offers rows.
    if (
      drawingInputsUnchangedByTextEdit(oldEntry.table, entry.table) ||
      tableTextStructureUnchanged(oldEntry.table, entry.table)
    )
      offerPreviousRows(entry.table, session.previous.pages);
    return null;
  }
  const reusedPages = update.pages.reduce(
    (count, page, index) => count + Number(page === session.previous!.pages[index]),
    0
  );
  const oldLayout = session.previous;
  session.previous = withContentControlMetadata(
    { ...session.previous, revision, pages: update.pages },
    session.previous
  );
  // updateTableText proves ordinary text edits and preserves all table occurrences.
  carryTableCaretContexts(oldLayout, session.previous);
  if (update.paragraphPagesUnchanged) {
    carryParagraphPageRoutes(oldLayout, session.previous);
    carryFragmentPageRoutes(oldLayout, session.previous);
    for (let index = 0; index < update.pages.length; index++) {
      const before = oldLayout.pages[index]!;
      const after = update.pages[index]!;
      if (before === after) continue;
      carryPageParagraphNames(before, after);
      carryPageTableContributions(before, after);
      carryPageOrder(before, after);
    }
  }
  session.keys = prepass.flowKeys;
  session.checkpoints = session.checkpoints.map((mark, index) => {
    // Checkpoints precede their block. A table edit cannot change an earlier checkpoint.
    if (index <= firstChanged) return mark;
    let fragments: (typeof mark.pageFragments)[number][] | undefined;
    for (let at = 0; at < mark.pageFragments.length; at += 1) {
      const fragment = mark.pageFragments[at]!;
      // Only table fragments enter the replacement map. Avoid hashing unrelated paragraphs.
      const replacement = fragment.kind === 'table' ? update.replacements.get(fragment) : undefined;
      if (replacement && replacement !== fragment) {
        fragments ??= mark.pageFragments.slice();
        fragments[at] = replacement;
      }
    }
    if (!fragments && update.lineDelta === 0) return mark;
    return {
      ...mark,
      lineCounter: mark.lineCounter + update.lineDelta,
      pageFragments: fragments ?? mark.pageFragments,
    };
  });
  session.endLineCounter =
    lineCounterStart + session.endLineCounter - session.startLineCounter + update.lineDelta;
  session.startLineCounter = lineCounterStart;
  session.stats = {
    placed: 1,
    total: prepass.prepared.length,
    reusedPages,
    fullPasses: session.stats.fullPasses,
  };
  return resultOf(session);
}
