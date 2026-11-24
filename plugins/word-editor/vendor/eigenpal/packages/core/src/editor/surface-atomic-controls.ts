// Content controls the caret treats as ONE unit.
//
// A `w:showingPlcHdr` prompt always is one: the first keystroke replaces it. With
// `lockedControlNavigation: 'atomic'`, an inline control whose content is locked is one too, so
// arrows step over it and a press inside selects it. Both rules live here, over the model range
// the layout publishes on each inline control record — positions come from the model, never
// back from geometry. Only a block-level prompt, which covers whole paragraphs, still reads its
// paragraphs from the boxes its fragments touch.

import {
  documentOrder,
  paragraphTextFromLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '../layout/semantic-interaction.ts';
import type {
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  LayoutBox,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../layout/semantic-records.ts';
import { MAX_TABLE_NESTING } from '../layout/semantic-table.ts';

export interface PositionRange {
  readonly from: SemanticPosition;
  readonly to: SemanticPosition;
}

function overlapArea(a: LayoutBox, b: LayoutBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

/** True when boxes share area, or a zero-width control box sits on `inner`. */
function boxesTouch(outer: LayoutBox, inner: LayoutBox): boolean {
  if (overlapArea(outer, inner) > 0) return true;
  if (outer.width === 0) {
    return (
      inner.x <= outer.x &&
      outer.x <= inner.x + inner.width &&
      !(outer.y + outer.height < inner.y || inner.y + inner.height < outer.y)
    );
  }
  return false;
}

function comparePositions(
  layout: SemanticLayout,
  a: SemanticPosition,
  b: SemanticPosition
): number {
  if (a.paragraphId === b.paragraphId) return a.offset - b.offset;
  const order = documentOrder(layout);
  return order.indexOf(a.paragraphId) - order.indexOf(b.paragraphId);
}

/**
 * Document-order paragraph walk that descends table rows/cells within {@link MAX_TABLE_NESTING}.
 *
 * Header-repeat rows are skipped so each caret stop is considered once. Nested tables inside
 * cells share the same bound layout already uses when refusing deeper nesting.
 */
function visitParagraphBlocks(
  blocks: readonly BlockFragmentRecord[],
  depth: number,
  visit: (paragraph: ParagraphFragmentRecord) => void
): void {
  if (depth > MAX_TABLE_NESTING) return;
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      visit(block);
      continue;
    }
    if (depth >= MAX_TABLE_NESTING) continue;
    for (const row of block.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) visitParagraphBlocks(cell.blocks, depth + 1, visit);
    }
  }
}

/**
 * The positions a control covers. An inline control answers from its published model range. A
 * block, row or cell control covers the whole paragraphs its fragments touch — row and cell
 * wrappers are structural units the same way block wrappers are.
 */
function controlSelectionRange(
  layout: SemanticLayout,
  control: ContentControlBoundaryRecord
): PositionRange | null {
  if (control.range) {
    const { paragraphId, start, end } = control.range;
    return { from: { paragraphId, offset: start }, to: { paragraphId, offset: end } };
  }
  if (control.level === 'inline' || control.fragments.length === 0) return null;

  let from: SemanticPosition | null = null;
  let to: SemanticPosition | null = null;
  for (const fragment of control.fragments) {
    const page = layout.pages[fragment.pageIndex];
    if (!page) continue;
    visitParagraphBlocks(page.fragments, 0, (block) => {
      if (!boxesTouch(fragment.box, block.box)) return;
      const start = { paragraphId: block.paragraphId, offset: 0 };
      const end = {
        paragraphId: block.paragraphId,
        offset: paragraphTextFromLayout(layout, block.paragraphId).length,
      };
      if (!from || comparePositions(layout, start, from) < 0) from = start;
      if (!to || comparePositions(layout, end, to) > 0) to = end;
    });
  }
  return from && to ? { from, to } : null;
}

/** Full addressable range of a placeholder control. */
export function placeholderSelectionRange(
  layout: SemanticLayout,
  control: ContentControlBoundaryRecord
): PositionRange | null {
  return control.placeholder ? controlSelectionRange(layout, control) : null;
}

/**
 * Whether `lockedControlNavigation: 'atomic'` makes this control ONE caret unit: an inline
 * control whose content typing can never enter (`contentLocked` / `sdtContentLocked`, which is
 * what `insertOwnerOf` and `refusesTypedContent` already treat as an atom for keystrokes).
 * Placeholders have their own, older rule and are not repeated here.
 */
export function isLockedAtomicControl(control: ContentControlBoundaryRecord): boolean {
  return (
    !control.placeholder &&
    control.level === 'inline' &&
    control.range !== undefined &&
    (control.effectiveLock === 'contentLocked' || control.effectiveLock === 'sdtContentLocked')
  );
}

/**
 * Whether a COLLAPSED caret on an edge of `control` is inside it. A prompt is replaced by the
 * first keystroke, so a caret touching it is "in" it. A locked control is typed BESIDE, and an
 * edge caret is exactly where the author aims to do that.
 */
function edgeCountsAsInside(control: ContentControlBoundaryRecord): boolean {
  return control.placeholder;
}

/** Locked atomic control ranges by paragraph, built once per layout. */
const lockedRangesByLayout = new WeakMap<SemanticLayout, Map<string, PositionRange[]>>();

function lockedRangesIn(layout: SemanticLayout, paragraphId: string): readonly PositionRange[] {
  let byParagraph = lockedRangesByLayout.get(layout);
  if (!byParagraph) {
    byParagraph = new Map();
    for (const control of layout.contentControls ?? []) {
      if (!isLockedAtomicControl(control)) continue;
      const range = controlSelectionRange(layout, control)!;
      const list = byParagraph.get(range.from.paragraphId) ?? [];
      list.push(range);
      byParagraph.set(range.from.paragraphId, list);
    }
    lockedRangesByLayout.set(layout, byParagraph);
  }
  return byParagraph.get(paragraphId) ?? [];
}

/**
 * The OUTERMOST locked atomic control that strictly contains `position` (an edge is outside),
 * as the range it covers; null when the position is outside every one. Outermost, because an
 * inner control inherits the outer lock, and stopping at its edge would leave the caret inside
 * the outer unit.
 */
export function atomicRangeAt(
  layout: SemanticLayout,
  position: SemanticPosition
): PositionRange | null {
  let outermost: PositionRange | null = null;
  for (const range of lockedRangesIn(layout, position.paragraphId)) {
    if (position.offset <= range.from.offset || position.offset >= range.to.offset) continue;
    if (
      !outermost ||
      range.from.offset < outermost.from.offset ||
      (range.from.offset === outermost.from.offset && range.to.offset > outermost.to.offset)
    ) {
      outermost = range;
    }
  }
  return outermost;
}

/**
 * Where a caret that a motion from `origin` landed INSIDE an atomic control goes instead. A
 * motion within one paragraph crosses the control in the direction it travelled — read from
 * the offsets, not the key, because ArrowRight moves backwards through right-to-left text. A
 * vertical motion counts too: taking the nearer edge of a control that wraps over several
 * lines can hand back the line the motion started on, so the caret never gets past it. A
 * motion that arrives from another paragraph takes the nearer edge.
 */
export function leaveAtomicControl(
  layout: SemanticLayout,
  origin: SemanticPosition,
  landed: SemanticPosition
): SemanticPosition {
  const around = atomicRangeAt(layout, landed);
  if (!around) return landed;
  const travelled = origin.paragraphId === landed.paragraphId ? landed.offset - origin.offset : 0;
  if (travelled > 0) return around.to;
  if (travelled < 0) return around.from;
  const middle = (around.from.offset + around.to.offset) / 2;
  return landed.offset < middle ? around.from : around.to;
}

/**
 * Expand a selection so every atomic control it touches is selected as a unit: every
 * `w:showingPlcHdr` prompt, and with `atomic` (`lockedControlNavigation: 'atomic'`) every inline
 * control whose content is locked. A collapsed caret on a control's edge is absorbed only when
 * {@link edgeCountsAsInside}.
 *
 * Used by pointer drag / shift-click and the keyboard extend path, so both share one rule.
 */
export function absorbAtomicControls(
  layout: SemanticLayout,
  selection: SemanticSelection,
  options: { readonly atomic?: boolean } = {}
): SemanticSelection {
  const controls = layout.contentControls ?? [];
  if (controls.length === 0) return selection;

  const headIsEnd = comparePositions(layout, selection.anchor, selection.head) <= 0;
  let from = headIsEnd ? selection.anchor : selection.head;
  let to = headIsEnd ? selection.head : selection.anchor;

  let changed = true;
  while (changed) {
    changed = false;
    for (const control of controls) {
      const locked = options.atomic === true && isLockedAtomicControl(control);
      if (!control.placeholder && !locked) continue;
      const range = controlSelectionRange(layout, control);
      if (!range) continue;
      const collapsed = comparePositions(layout, from, to) === 0;
      const startsAt = comparePositions(layout, from, range.from);
      const intersects = collapsed
        ? (edgeCountsAsInside(control) ? startsAt >= 0 : startsAt > 0) &&
          comparePositions(layout, from, range.to) < 0
        : comparePositions(layout, from, range.to) < 0 &&
          comparePositions(layout, to, range.from) > 0;
      if (!intersects) continue;
      if (comparePositions(layout, range.from, from) < 0) {
        from = range.from;
        changed = true;
      }
      if (comparePositions(layout, range.to, to) > 0) {
        to = range.to;
        changed = true;
      }
    }
  }

  // Preserve which end the user is dragging (head) relative to the original orientation.
  return headIsEnd ? { anchor: from, head: to } : { anchor: to, head: from };
}
