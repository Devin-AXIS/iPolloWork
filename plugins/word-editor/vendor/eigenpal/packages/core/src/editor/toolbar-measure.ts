// Shared by both adapters: the bar is plain DOM whichever framework renders it, so the
// width reads live once, beside the fit they feed.
//
// Pure width accounting for the measured toolbar row.
//
// Collapsible groups are costed with the separator slot that precedes them on the bar:
// separator border-box width, inline margins, and flex gaps on both sides. That
// overstates the first group by one separator — the safe direction — but must not
// undercount margins or the bar clips before it collapses.
//
// Fixed groups and the More trigger never receive that separator allowance: More sits
// after flex content with margin-inline-start: auto, not after a rule.

import { hostWindowOf, isElementNode } from './host-realm.ts';
import { TOOLBAR_ITEM_ATTRIBUTE } from './toolbar-item-fit.ts';

/**
 * Leading separator slot cost for one collapsible group (px).
 *
 * @internal
 */
export function separatorLeadingCost(
  separatorWidth: number,
  marginInlineStart: number,
  marginInlineEnd: number,
  gap: number
): number {
  return separatorWidth + marginInlineStart + marginInlineEnd + gap * 2;
}

/**
 * Flex gap charged after a fixed group or the More trigger.
 *
 * @internal
 */
export function trailingGapCost(width: number, gap: number): number {
  return width + gap;
}

/**
 * Read inline margins from computed style (px).
 *
 * @internal
 */
export function readInlineMargins(style: CSSStyleDeclaration): {
  readonly start: number;
  readonly end: number;
} {
  const start = Number.parseFloat(style.marginInlineStart || style.marginLeft);
  const end = Number.parseFloat(style.marginInlineEnd || style.marginRight);
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
  };
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parse column gap from toolbar computed style.
 *
 * @internal
 */
export function readColumnGap(style: CSSStyleDeclaration): number {
  return px(style.columnGap);
}

/**
 * What {@link barRoomWidth} measures against, all in px.
 *
 * @internal
 */
export interface BarRoomInput {
  /** The bar's current content width: its client width less its inline padding. */
  readonly own: number;
  /** The parent's content-box width. `0` or less means it is unknown. */
  readonly parentContent: number;
  /** Width the bar's siblings take on the same line, gaps included. */
  readonly siblings: number;
  /** The bar's inline margins, auto margins excluded. */
  readonly margins: number;
  /** The bar's inline padding, border, and scrollbar. */
  readonly chrome: number;
  /** The bar's resolved `max-width` as a border-box width, or null for none. */
  readonly maxWidth: number | null;
}

/**
 * The content width the bar CAN take, which is what decides what fits.
 *
 * A bar that fills its container can take exactly the box it has. A bar as wide as its
 * content (`width: max-content`, a floating pill) shrinks when a group leaves, so its own box
 * never shows the room outside it, and a collapsed group would never come back. The room is
 * the parent's content width, less the siblings on the same line and the bar's margins,
 * capped by the bar's `max-width`. It is never less than the box the bar already has.
 *
 * @internal
 */
export function barRoomWidth(input: BarRoomInput): number {
  if (!(input.parentContent > 0)) return input.own;
  let outer = input.parentContent - input.siblings - input.margins;
  if (input.maxWidth !== null) outer = Math.min(outer, input.maxWidth);
  return Math.max(input.own, outer - input.chrome);
}

function outOfFlow(style: CSSStyleDeclaration): boolean {
  return style.position === 'absolute' || style.position === 'fixed' || style.display === 'none';
}

/** The minimal Typed OM surface this file reads. */
type SpecifiedStyle = { get(property: string): unknown } | null;

/**
 * The element's specified (not used) values, through Typed OM. Null where the browser has no
 * `computedStyleMap`: the caller then keeps the bar's own measurement.
 */
function specifiedStyle(element: Element): SpecifiedStyle {
  const read = (element as { computedStyleMap?: () => SpecifiedStyle }).computedStyleMap;
  if (typeof read !== 'function') return null;
  try {
    return read.call(element);
  } catch {
    return null;
  }
}

/** The keyword a property specifies (`auto`, `max-content`), or null for a length. */
function keywordOf(style: SpecifiedStyle, property: string): string | null {
  const value = style?.get(property) as { value?: unknown } | undefined;
  return value && typeof value.value === 'string' ? value.value : null;
}

/** Widths that size an element to its content rather than to its container. */
const CONTENT_WIDTHS = new Set(['auto', 'max-content', 'fit-content', 'min-content']);

/** True for a single-line flex row. */
function isFlexRow(style: CSSStyleDeclaration): boolean {
  return (
    style.display.includes('flex') &&
    !style.flexDirection.startsWith('column') &&
    !style.flexWrap.startsWith('wrap')
  );
}

/** An inline margin as the room it takes: an `auto` margin takes none. */
function marginWidth(
  specified: SpecifiedStyle,
  style: CSSStyleDeclaration,
  side: 'left' | 'right'
) {
  if (keywordOf(specified, `margin-${side}`) === 'auto') return 0;
  return px(side === 'left' ? style.marginLeft : style.marginRight);
}

/** True when an element has something to show: a form control, graphics, children, or text. */
function hasContent(element: Element): boolean {
  if (/^(input|textarea|select|button|img|video|canvas|iframe|svg)$/i.test(element.tagName)) {
    return true;
  }
  return element.children.length > 0 || (element.textContent ?? '').trim().length > 0;
}

/**
 * The width one growing flex item needs, or null when it cannot be known.
 *
 * A growing item fills the free space, so its box is not what it needs. It needs its flex
 * basis, or its `min-width` when that is larger. An item with content and an automatic
 * minimum (a title field, a search box) needs at least its content width, which this file
 * cannot read; so does one whose minimum is not in px.
 */
function growingItemWidth(
  element: Element,
  style: CSSStyleDeclaration,
  specified: SpecifiedStyle
): number | null {
  const basis = style.flexBasis.trim();
  const basisWidth = basis.endsWith('px') ? px(basis) : 0;
  const minWidth = keywordOf(specified, 'min-width') ?? style.minWidth.trim();
  if (minWidth === 'auto' || minWidth === '') return hasContent(element) ? null : basisWidth;
  if (/^[\d.]+px$/.test(minWidth)) return Math.max(basisWidth, px(minWidth));
  return null;
}

/** The widths of the in-flow items of a flex row, flattening `display: contents`. */
function rowItems(
  container: Element,
  bar: HTMLElement,
  out: { width: number; items: number }
): boolean {
  for (const node of container.childNodes) {
    // Loose text is an anonymous flex item whose width this file cannot read.
    if (node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return false;
    if (!isElementNode(node)) continue;
    const style = hostWindowOf(node).getComputedStyle(node);
    if (style.display === 'contents') {
      if (!rowItems(node, bar, out)) return false;
      continue;
    }
    if (outOfFlow(style)) continue;
    out.items += 1;
    if (node === bar) continue;
    const specified = specifiedStyle(node);
    const grows = Number.parseFloat(style.flexGrow) > 0;
    const box = grows
      ? growingItemWidth(node, style, specified)
      : node.getBoundingClientRect().width;
    if (box === null) return false;
    out.width +=
      box + marginWidth(specified, style, 'left') + marginWidth(specified, style, 'right');
  }
  return true;
}

/**
 * The width that siblings take beside the bar in a single-line flex row, gaps included, or
 * null when it cannot be known. Every element counts, an `<svg>` logo included, and the
 * children of a `display: contents` wrapper count as items of the row. Auto margins are
 * free space.
 */
function readSiblingWidth(bar: HTMLElement, parentStyle: CSSStyleDeclaration): number | null {
  if (!isFlexRow(parentStyle) || !bar.parentElement) return 0;
  const out = { width: 0, items: 0 };
  if (!rowItems(bar.parentElement, bar, out)) return null;
  return out.width + Math.max(0, out.items - 1) * px(parentStyle.columnGap);
}

/**
 * The bar's resolved `max-width` as a border-box width, null for `none`, or undefined for a
 * value this file cannot resolve (`calc()`, `min()`, a font-relative unit).
 */
function readMaxWidth(
  style: CSSStyleDeclaration,
  parentContent: number,
  chrome: number
): number | null | undefined {
  const value = style.maxWidth.trim();
  if (value === 'none' || value === '') return null;
  let width: number;
  if (/^-?[\d.]+%$/.test(value)) width = (Number.parseFloat(value) / 100) * parentContent;
  else if (/^-?[\d.]+px$/.test(value)) width = Number.parseFloat(value);
  else return undefined;
  if (!Number.isFinite(width)) return undefined;
  return style.boxSizing === 'border-box' ? width : width + chrome;
}

/** The bar's in-flow controls: its groups, fixed blocks, and the "⋯" trigger. */
const CONTROLS = '[data-toolbar-group], [data-toolbar-fixed], [data-toolbar-more]';

/**
 * True when one of the bar's controls runs past its content box, false when they all fit,
 * and null when the bar has no layout to read (a zero-width box, as in a DOM without
 * layout). Measured from the controls, not `scrollWidth`, so an open popup (the More panel,
 * the table grid) that reaches past the bar's edge is not mistaken for an overflow.
 *
 * @internal
 */
export function controlsOverflow(bar: HTMLElement, style: CSSStyleDeclaration): boolean | null {
  const box = bar.getBoundingClientRect();
  if (!(box.width > 0)) return null;
  const start = box.left + bar.clientLeft + px(style.paddingLeft);
  const end = box.left + bar.clientLeft + bar.clientWidth - px(style.paddingRight);
  for (const control of bar.querySelectorAll(CONTROLS)) {
    const rect = control.getBoundingClientRect();
    if (rect.width === 0) continue;
    if (rect.right > end + 1 || rect.left < start - 1) return true;
  }
  return false;
}

/**
 * Per bar: the width the parent-based room proved too large for, and the parent content
 * width it was learned at. While the parent keeps that width the bar's room is capped there,
 * so a room estimate that is wrong cannot bring groups back, overflow, collapse them, and
 * bring them back again on every frame.
 */
const roomCaps = new WeakMap<
  HTMLElement,
  { readonly parentContent: number; readonly cap: number }
>();
/** Per bar: whether the last answer gave it more than its own box. */
const grewFromRoom = new WeakMap<HTMLElement, boolean>();

/** The room for a content-sized bar, or null when the layout is not one this file reads. */
function readRoom(
  bar: HTMLElement,
  style: CSSStyleDeclaration,
  own: number,
  padding: number
): { readonly room: number; readonly parentContent: number } | null {
  const parent = bar.parentElement;
  if (!parent || outOfFlow(style)) return null;
  if ((style.cssFloat || style.getPropertyValue('float') || 'none') !== 'none') return null;
  const specified = specifiedStyle(bar);
  const width = keywordOf(specified, 'width');
  if (width === null || !CONTENT_WIDTHS.has(width)) return null;
  const parentStyle = hostWindowOf(parent).getComputedStyle(parent);
  const flexItem = isFlexRow(parentStyle);
  // A flex column lays its items out one per line, like a block container.
  const column =
    parentStyle.display.includes('flex') && parentStyle.flexDirection.startsWith('column');
  const blockChild =
    (parentStyle.display === 'block' || parentStyle.display === 'flow-root' || column) &&
    !style.display.startsWith('inline');
  if (!flexItem && !blockChild) return null;
  if (flexItem && Number.parseFloat(style.flexGrow) > 0) return null;
  const parentContent =
    parent.clientWidth - px(parentStyle.paddingLeft) - px(parentStyle.paddingRight);
  const chrome = Math.max(0, bar.offsetWidth - bar.clientWidth) + padding;
  const siblings = readSiblingWidth(bar, parentStyle);
  const maxWidth = readMaxWidth(style, parentContent, chrome);
  if (siblings === null || maxWidth === undefined) return null;
  const room = barRoomWidth({
    own,
    parentContent,
    siblings,
    margins: marginWidth(specified, style, 'left') + marginWidth(specified, style, 'right'),
    chrome,
    maxWidth,
  });
  return { room, parentContent };
}

/**
 * The bar's available content width.
 *
 * The bar's own box, except for a CONTENT-SIZED bar (specified width `auto`, `max-content`,
 * `fit-content`, or `min-content`, and not growing as a flex item) in a layout this file
 * understands: a block-level bar in a `block` or `flow-root` parent, or an item of a
 * single-line flex row. That bar gets the room it can take, see {@link barRoomWidth}. A grid
 * cell, a table cell, an inline bar, a floated bar, an explicit width, an out-of-flow bar, a
 * `max-width` that does not resolve, a growing sibling with content, loose text in the row,
 * and a browser without Typed OM all keep the bar's own box: the safe side, which collapses
 * early rather than overflowing the next column.
 *
 * The parent-based room only ever brings groups BACK. A bar whose controls overflow its box
 * measures its own box, so the fit collapses groups until they fit. When that overflow
 * follows groups that came back from the room, the room was wrong: the bar's width becomes
 * a cap until the parent's width changes, so the bar does not flicker.
 *
 * @internal
 */
export function readAvailableWidth(bar: HTMLElement, style: CSSStyleDeclaration): number {
  const padding = px(style.paddingLeft) + px(style.paddingRight);
  const own = bar.clientWidth - padding;
  const measured = readRoom(bar, style, own, padding);
  if (!measured) {
    roomCaps.delete(bar);
    grewFromRoom.delete(bar);
    return own;
  }
  const previous = roomCaps.get(bar);
  if (previous && previous.parentContent !== measured.parentContent) roomCaps.delete(bar);
  if (controlsOverflow(bar, style) === true) {
    if (grewFromRoom.get(bar))
      roomCaps.set(bar, { parentContent: measured.parentContent, cap: own });
    grewFromRoom.set(bar, false);
    return own;
  }
  const cap = roomCaps.get(bar)?.cap ?? Number.POSITIVE_INFINITY;
  const room = Math.max(own, Math.min(measured.room, cap));
  grewFromRoom.set(bar, room > own);
  return room;
}

/**
 * Widths that survive a control leaving the bar: a control in the "⋯" menu renders nothing
 * to measure, and forgetting its width would mean never knowing whether it could come back.
 *
 * @internal
 */
export interface ToolbarRowMemory {
  /** `toolbarItemKey(group, item)` -> width, in layout px. */
  readonly itemWidths: Map<string, number>;
  /** Group id -> separator slot plus the group's own padding, in layout px. */
  readonly groupBases: Map<string, number>;
  /** Group id -> the flex gap between that group's controls, in layout px. */
  readonly groupGaps: Map<string, number>;
  /** The "⋯" trigger's cost, in layout px. Seed it with an assumed width. */
  more: number;
}

/**
 * One measurement of the bar, for the item fit. Every width is in layout px, the unit of
 * `clientWidth`, so a bar inside a scaled container compares like with like.
 *
 * @internal
 */
export interface ToolbarRowReading {
  /** The content width the bar can take. */
  readonly available: number;
  /** The bar's flex gap. */
  readonly gap: number;
  /** Width of everything that never collapses. */
  readonly fixed: number;
  /** The "⋯" trigger's cost. */
  readonly more: number;
  /** {@link controlsOverflow} for this reading: true, false, or null without layout. */
  readonly overflowing: boolean | null;
}

/**
 * Converts box widths to layout px. `getBoundingClientRect` reports transformed widths (a
 * scaled container shrinks them) with their fraction; `offsetWidth` reports layout px rounded.
 * The bar's own two widths give the ratio, so a control keeps its fraction in layout px.
 */
function layoutScale(bar: HTMLElement): number {
  const box = bar.getBoundingClientRect().width;
  return box > 0 && bar.offsetWidth > 0 ? bar.offsetWidth / box : 1;
}

function layoutWidth(element: Element, scale: number): number {
  const box = element.getBoundingClientRect().width;
  if (box > 0) return box * scale;
  const offset = (element as HTMLElement).offsetWidth;
  return typeof offset === 'number' && offset > 0 ? offset : 0;
}

/**
 * True when an item is a flex item: it has an element or any text child. This is the CSS
 * `:empty` test the stylesheet hides empty items with, which ignores only comments, so a Vue
 * part that renders null (a comment) is empty in both adapters.
 */
function drawsSomething(item: Element): boolean {
  if (item.children.length > 0) return true;
  for (const node of item.childNodes) {
    if (node.nodeType === 3 && (node.textContent ?? '').length > 0) return true;
  }
  return false;
}

/** A group's own flex gap, or the bar's when the group does not set one in px. */
function groupGap(view: ReturnType<typeof hostWindowOf>, group: Element, fallback: number): number {
  const value = view.getComputedStyle(group).columnGap.trim();
  // `normal` is 0 in a flex container; an unreadable value keeps the bar's gap.
  if (value === 'normal') return 0;
  return /^-?[\d.]+px$/.test(value) ? Number.parseFloat(value) : fallback;
}

/**
 * Reads the bar into `memory` and returns what the item fit needs.
 *
 * Each `[data-toolbar-group]` element is a collapsible group. Its direct
 * `[data-toolbar-item]` children are its controls, stored under `itemKey(group, item)`. A
 * group with no item children (the contextual table block) is one control whose id is the
 * group id. `[data-toolbar-fixed]` elements never collapse, and `[data-toolbar-more]` is the
 * trigger. An item that draws nothing is stored as 0 wide: it takes no room, now or later.
 *
 * Every group is charged a leading separator slot, the first one included. That overstates
 * the row by one separator, so the bar collapses a few px early: the safe direction.
 *
 * @internal
 */
export function readToolbarRow(
  bar: HTMLElement,
  memory: ToolbarRowMemory,
  itemKey: (groupId: string, itemId: string) => string
): ToolbarRowReading {
  const view = hostWindowOf(bar);
  const style = view.getComputedStyle(bar);
  const gap = readColumnGap(style);
  const available = readAvailableWidth(bar, style);
  const scale = layoutScale(bar);
  const separator = bar.querySelector<HTMLElement>('.docx-toolbar__separator');
  let separatorLeading = gap * 2;
  if (separator) {
    const margins = readInlineMargins(view.getComputedStyle(separator));
    separatorLeading = separatorLeadingCost(
      layoutWidth(separator, scale),
      margins.start,
      margins.end,
      gap
    );
  }

  for (const group of bar.querySelectorAll<HTMLElement>('[data-toolbar-group]')) {
    const id = group.getAttribute('data-toolbar-group');
    // A group mid-transition can measure zero; keeping the last real width beats recording a
    // zero that would make it look free forever.
    const width = layoutWidth(group, scale);
    if (!id || !(width > 0)) continue;
    const items: Element[] = [];
    for (const child of group.children) {
      if (child.hasAttribute(TOOLBAR_ITEM_ATTRIBUTE)) items.push(child);
    }
    if (items.length === 0) {
      memory.itemWidths.set(itemKey(id, id), width);
      memory.groupBases.set(id, separatorLeading);
      continue;
    }
    const ownGap = groupGap(view, group, gap);
    memory.groupGaps.set(id, ownGap);
    let content = 0;
    let shown = 0;
    for (const item of items) {
      const itemId = item.getAttribute(TOOLBAR_ITEM_ATTRIBUTE) ?? '';
      if (!drawsSomething(item)) {
        memory.itemWidths.set(itemKey(id, itemId), 0);
        continue;
      }
      const itemWidth = layoutWidth(item, scale);
      if (!(itemWidth > 0)) continue;
      memory.itemWidths.set(itemKey(id, itemId), itemWidth);
      content += itemWidth;
      shown += 1;
    }
    const own = Math.max(0, width - content - Math.max(0, shown - 1) * ownGap);
    memory.groupBases.set(id, separatorLeading + own);
  }

  let fixed = 0;
  for (const element of bar.querySelectorAll<HTMLElement>('[data-toolbar-fixed]')) {
    const width = layoutWidth(element, scale);
    if (width > 0) fixed += trailingGapCost(width, gap);
  }
  const more = bar.querySelector<HTMLElement>('[data-toolbar-more]');
  // More follows flex content; it is not preceded by a separator rule.
  if (more) {
    const width = layoutWidth(more, scale);
    if (width > 0) memory.more = trailingGapCost(width, gap);
  }
  return { available, gap, fixed, more: memory.more, overflowing: controlsOverflow(bar, style) };
}
