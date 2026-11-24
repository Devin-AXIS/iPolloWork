// Snapshot equality (editor lane).
//
// Split out of docx-editor-support.ts, which is at its line cap. Everything here answers
// one question — has this piece of the snapshot actually moved? — which is what keeps
// `snapshot()` reference-stable for `useSyncExternalStore`. Re-exported from
// docx-editor-support.ts so importers keep one entry point.

import type {
  ParagraphDisagreements,
  DocAnchor,
  DocRange,
  EditorSnapshot,
  PageSetup,
  RunFormatting,
  TableContext,
} from '@docx-editor.dev/core/contracts/editor';
import { isDocAnchorRange } from './anchor-resolution.ts';

/**
 * Compile-time exhaustiveness for `formattingEqual`, in the manner of the content-node
 * switches: every key of `RunFormatting` is listed, so ADDING a field fails `typecheck`
 * here until its comparison is written.
 *
 * A field the comparator misses is a field the cache reports as unchanged. The previous
 * object is handed back, a host reading `snapshot().formatting` by reference never sees the
 * value move, and the control that made the write goes on showing the old state while the
 * document holds the new one — a silent, one-line-of-omission bug that no test of the write
 * path can catch, because the write is fine. A comment asking the next author to remember
 * is not a guarantee; this is.
 */
const COMPARED_FORMATTING_KEYS: Record<keyof Required<RunFormatting>, true> = {
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  color: true,
  highlight: true,
  fontFamily: true,
  fontSizePt: true,
  superscript: true,
  subscript: true,
  alignment: true,
  direction: true,
  styleId: true,
  lineSpacing: true,
  spaceBeforePt: true,
  spaceAfterPt: true,
  indent: true,
  paragraphFlags: true,
  tabStops: true,
  disagrees: true,
};
void COMPARED_FORMATTING_KEYS;

/** Value equality for the snapshot's `formatting` sub-object (color compared by value). */
/**
 * Exhaustive by construction: the key list is typed against `ParagraphDisagreements`, so a
 * member added there fails to compile until it is compared here. A comment asking the next
 * author to remember is not a guarantee — the same argument `COMPARED_FORMATTING_KEYS`
 * makes above.
 */
const COMPARED_DISAGREEMENT_KEYS: readonly (keyof ParagraphDisagreements)[] = [
  'alignment',
  'direction',
  'spaceBeforePt',
  'spaceAfterPt',
  'lineSpacing',
  'tabStops',
];

function sameDisagreements(a: RunFormatting['disagrees'], b: RunFormatting['disagrees']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return COMPARED_DISAGREEMENT_KEYS.every((key) => a[key] === b[key]);
}

export function formattingEqual(a: RunFormatting | null, b: RunFormatting | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.bold !== b.bold ||
    a.italic !== b.italic ||
    a.underline !== b.underline ||
    a.strike !== b.strike ||
    a.superscript !== b.superscript ||
    a.subscript !== b.subscript ||
    a.highlight !== b.highlight ||
    a.fontFamily !== b.fontFamily ||
    a.fontSizePt !== b.fontSizePt ||
    a.alignment !== b.alignment ||
    a.direction !== b.direction ||
    a.styleId !== b.styleId ||
    a.spaceBeforePt !== b.spaceBeforePt ||
    a.spaceAfterPt !== b.spaceAfterPt ||
    a.lineSpacing?.rule !== b.lineSpacing?.rule ||
    a.lineSpacing?.value !== b.lineSpacing?.value ||
    // FIELD BY FIELD, like `lineSpacing` above. `indent` is a fresh object on every derive,
    // so comparing it by reference would report every tick as a change, hand back a new
    // sub-object each time, and re-render every `snapshot().formatting` subscriber on each
    // keystroke — the exact opposite of what this cache exists for.
    a.indent?.left !== b.indent?.left ||
    a.indent?.right !== b.indent?.right ||
    a.indent?.firstLine !== b.indent?.firstLine ||
    a.indent?.mixed.left !== b.indent?.mixed.left ||
    a.indent?.mixed.right !== b.indent?.mixed.right ||
    a.indent?.mixed.firstLine !== b.indent?.mixed.firstLine ||
    a.indent?.rtl !== b.indent?.rtl ||
    // Field by field for the same reason as `indent`: a fresh object every derive, so a
    // reference compare would report every tick as a change.
    a.paragraphFlags?.contextualSpacing !== b.paragraphFlags?.contextualSpacing ||
    a.paragraphFlags?.keepNext !== b.paragraphFlags?.keepNext ||
    a.paragraphFlags?.keepLines !== b.paragraphFlags?.keepLines ||
    a.paragraphFlags?.widowControl !== b.paragraphFlags?.widowControl ||
    a.paragraphFlags?.pageBreakBefore !== b.paragraphFlags?.pageBreakBefore ||
    !sameDisagreements(a.disagrees, b.disagrees) ||
    // By VALUE: a fresh array per derive, so a reference compare would report every tick as
    // a change and re-render every `snapshot().formatting` subscriber on each keystroke.
    a.tabStops?.length !== b.tabStops?.length ||
    (a.tabStops ?? []).some(
      (stop, index) =>
        stop.positionTwips !== b.tabStops?.[index]?.positionTwips ||
        stop.alignment !== b.tabStops?.[index]?.alignment ||
        (stop.leader ?? 'none') !== (b.tabStops?.[index]?.leader ?? 'none')
    )
  ) {
    return false;
  }
  if (a.color === b.color) return true;
  if (!a.color || !b.color) return false;
  // ColorValue is a small tagged union of primitives; key-by-key compare covers all arms.
  const left = a.color as Record<string, unknown>;
  const right = b.color as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
}

/** Value equality for the snapshot's `page` sub-object. */
export function pageEqual(a: EditorSnapshot['page'], b: EditorSnapshot['page']): boolean {
  return a.current === b.current && a.total === b.total;
}

/**
 * Value equality for the snapshot's `table` sub-object. Without the reuse it enables, every
 * tick with the caret in a table derived a new snapshot, and each table control re-rendered.
 */
export function tableContextEqual(a: TableContext | null, b: TableContext | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.rows === b.rows &&
    a.columns === b.columns &&
    a.rowIndex === b.rowIndex &&
    a.columnIndex === b.columnIndex
  );
}

/** Value equality for the snapshot's `pageSetup` sub-object. */
export function pageSetupEqual(a: PageSetup | null, b: PageSetup | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.pageWidthTwips === b.pageWidthTwips &&
    a.pageHeightTwips === b.pageHeightTwips &&
    a.orientation === b.orientation &&
    a.marginsTwips.top === b.marginsTwips.top &&
    a.marginsTwips.right === b.marginsTwips.right &&
    a.marginsTwips.bottom === b.marginsTwips.bottom &&
    a.marginsTwips.left === b.marginsTwips.left &&
    a.gutterTwips === b.gutterTwips
  );
}

function docAnchorEndpointEqual(
  a: DocRange['from'] | undefined,
  b: DocRange['from'] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = a as Partial<DocAnchor>;
  const right = b as Partial<DocAnchor>;
  return (
    left.paraId === right.paraId &&
    left.search === right.search &&
    left.occurrence === right.occurrence
  );
}

/**
 * Value equality for the snapshot's `selection`. Emitted ranges carry bare DocAnchor
 * endpoints, but all anchor fields are compared for honesty; a DocLocation endpoint
 * (never emitted today) compares unequal unless reference-equal.
 */
export function docRangeEqual(a: DocRange | null, b: DocRange | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (!isDocAnchorRange(a) || !isDocAnchorRange(b)) return false;
  return docAnchorEndpointEqual(a.from, b.from) && docAnchorEndpointEqual(a.to, b.to);
}

/**
 * A reference-stable cache for the right-click TOC context.
 *
 * A fresh object per derivation would make {@link snapshotsEqual} report every tick as
 * a change and hand every subscriber a new snapshot, which is the opposite of what the
 * snapshot cache is for. The id is the only value, so one object per id is enough.
 */
export function createTocContextCache(): (id: string | null) => { readonly id: string } | null {
  let cached: { readonly id: string } | null = null;
  return (id) => {
    if (id === null) cached = null;
    else if (cached?.id !== id) cached = Object.freeze({ id });
    return cached;
  };
}

/**
 * Every member the snapshot carries has to be compared in {@link snapshotsEqual} or it
 * cannot move a subscriber: the comments button stayed pressed after the pane closed
 * because the old hand-written list did not know the pane existed, and `hasReviewContent`
 * was missing from it entirely. The `satisfies` clause makes a new `EditorSnapshot` field
 * a compile error here until it is classified, in the manner of
 * `COMPARED_FORMATTING_KEYS` above and `PAGE_REUSE_GUARDS` in the layout lane.
 *
 * Every field is `'compared'` today: after sub-object reuse, each one is a primitive or a
 * reference-stable object, so `===` is the whole comparison.
 */
const SNAPSHOT_FIELDS = {
  scope: 'compared',
  isLoading: 'compared',
  isOpening: 'compared',
  parseError: 'compared',
  openFailure: 'compared',
  editable: 'compared',
  zoom: 'compared',
  zoomMode: 'compared',
  selection: 'compared',
  // Load-bearing: `selection` is a paraId range with no offsets, so collapsing a range
  // INSIDE one paragraph leaves it identical. Without this compare, a control gated on
  // the caret/range distinction would never see the moment it changed.
  selectionCollapsed: 'compared',
  // Reference-stable by value in `selection-range-read.ts`; moves with every caret move.
  selectionRange: 'compared',
  formatting: 'compared',
  table: 'compared',
  tocContext: 'compared',
  image: 'compared',
  chart: 'compared',
  page: 'compared',
  canUndo: 'compared',
  canRedo: 'compared',
  pageSetup: 'compared',
  reviewPaneOpen: 'compared',
  reviewPane: 'compared',
  showParagraphMarks: 'compared',
  showBookmarks: 'compared',
  documentProtection: 'compared',
  reviewDisplayMode: 'compared',
  revisionMarkup: 'compared',
  hasReviewContent: 'compared',
  hiddenReviewAuthors: 'compared',
  collaborationStatus: 'compared',
  editingMode: 'compared',
  lastRejection: 'compared',
  fontSubstitutions: 'compared',
  formatPainter: 'compared',
} as const satisfies Record<keyof EditorSnapshot, 'compared'>;

const SNAPSHOT_KEYS = Object.keys(SNAPSHOT_FIELDS) as readonly (keyof EditorSnapshot)[];

/**
 * Whether two snapshots are value-equal AFTER sub-object reuse — i.e. every field can be
 * compared by reference or primitive. When true, the previous snapshot object itself is
 * kept, so `snapshot()` returns the same reference across ticks that changed nothing.
 */
export function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return SNAPSHOT_KEYS.every((key) => a[key] === b[key]);
}
