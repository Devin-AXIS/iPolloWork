// Which list a bullet or numbering toggle puts its paragraphs on.
//
// Switching items between bullets and numbers changes their markers, never their place. The
// toggle rejoins a list of the wanted kind when one fits, and otherwise mints a definition
// with the geometry of the list the items are leaving.

import type {
  ListDefinitionGeometry,
  ListLevelGeometry,
  TreeDocOp,
} from '@docx-editor.dev/core/store';
import type { ListMarkerRecord, ParagraphIndent } from '@docx-editor.dev/core/layout';
import type { IndentSides } from './list-level-geometry.ts';

export type ListKind = 'bullet' | 'ordered';

/** The numbering reads a toggle needs, resolved the way layout paints markers. */
export interface ListSwitchReads {
  /** Each level of `numId` as layout paints it, for a definition of the other kind. */
  listGeometryOf(numId: string): ListDefinitionGeometry;
  /** Which kind of marker `numId` draws at `level`, or null when it does not resolve. */
  listLevelKindOf(numId: string, level: number): ListKind | null;
  /** The paragraph style `numId` links at `level` through `w:pStyle`, or null. */
  listLevelStyleOf(numId: string, level: number): string | null;
  /** The abstract definition `numId` counts on, or null when it does not resolve. */
  listAbstractOf(numId: string): string | null;
}

export interface ListSwitchDeps extends ListSwitchReads {
  /** Paragraph ids in reading order for the active scope. */
  order(): readonly string[];
  markerOf(paragraphId: string): ListMarkerRecord | null;
  ensureListDefinition(kind: ListKind, geometry?: ListDefinitionGeometry): string | null;
  /** Whether `numId`'s `level` numbers a heading style, as a heading numbering does. */
  headingLevel(numId: string, level: number): boolean;
  /** The paragraph's effective indent, list merge included, or null when it is not laid out. */
  indentOf(paragraphId: string): ParagraphIndent | null;
  /** The sides the paragraph's own `w:ind` states. */
  directIndentSides(paragraphId: string): IndentSides;
  /** The sides its numbering style states over the level, or null when it names its list. */
  styleNumberedIndentSides(paragraphId: string): IndentSides | null;
}

/** The indent sides, in twips, a style-numbered item shows over its level's values. */
interface StyleIndent {
  left?: number;
  right?: number;
  /** Signed: negative is a hanging indent. */
  firstLine?: number;
}

const kindOf = (marker: ListMarkerRecord): ListKind =>
  marker.numFmt === 'bullet' ? 'bullet' : 'ordered';

const twips = (points: number): number => Math.round(points * 20);

/**
 * The list item just before the selection, when it draws a list of the same kind, or null.
 *
 * Turning a list back on continues the list above it rather than minting a second definition,
 * so re-bulleting one item in the middle of a list keeps its neighbours' glyph. The list
 * below never counts: reference renderings start a new list for a paragraph above a list
 * item, and above a heading of a heading numbering.
 */
export function adjacentListMarker(
  deps: Pick<ListSwitchDeps, 'order' | 'markerOf'>,
  touched: readonly string[],
  kind: ListKind
): ListMarkerRecord | null {
  const order = deps.order();
  const first = order.indexOf(touched[0] ?? '');
  const previous = first > 0 ? order[first - 1] : undefined;
  const marker = previous ? deps.markerOf(previous) : null;
  return marker && kindOf(marker) === kind ? marker : null;
}

/**
 * How a selection mixes list items and paragraphs that are no list item: `'plain-first'` when
 * its first paragraph is no list item, `'item-first'` for any other mix, or null when it holds
 * only one of the two.
 *
 * A heading of a heading numbering counts as neither when the selection is weighed, since it
 * keeps its style and level whatever the selection does; as the first paragraph it is no
 * plain paragraph, so the mix starts a list of its own.
 */
export function mixedListSelection(
  deps: Pick<ListSwitchDeps, 'markerOf' | 'headingLevel'>,
  touched: readonly string[]
): 'plain-first' | 'item-first' | null {
  let plain = false;
  let item = false;
  for (const paragraphId of touched) {
    const marker = deps.markerOf(paragraphId);
    if (marker === null) plain = true;
    else if (!deps.headingLevel(marker.numId, marker.level)) item = true;
  }
  if (!plain || !item) return null;
  return deps.markerOf(touched[0] ?? '') === null ? 'plain-first' : 'item-first';
}

/** Where an item its style numbers sits on sides `level` states otherwise, or null. */
function styleIndentOver(
  deps: ListSwitchDeps,
  paragraphId: string,
  level: ListLevelGeometry | undefined
): StyleIndent | null {
  const style = level ? deps.styleNumberedIndentSides(paragraphId) : null;
  const indent = style ? deps.indentOf(paragraphId) : null;
  if (!level || !style || !indent) return null;
  // A side the paragraph states itself outranks every level, before and after.
  const direct = deps.directIndentSides(paragraphId);
  const shown: StyleIndent = {};
  const left = twips(indent.left);
  const right = twips(indent.right);
  if (style.left && !direct.left && level.left !== undefined && level.left !== left) {
    shown.left = left;
  }
  if (style.right && !direct.right && level.right !== undefined && level.right !== right) {
    shown.right = right;
  }
  const offset = indent.hanging > 0 ? -twips(indent.hanging) : twips(indent.firstLine);
  const levelOffset = level.hanging !== undefined ? -level.hanging : level.firstLine;
  if (style.offset && !direct.offset && levelOffset !== undefined && levelOffset !== offset) {
    shown.firstLine = offset;
  }
  return Object.keys(shown).length > 0 ? shown : null;
}

const sameStyleIndent = (left: StyleIndent, right: StyleIndent): boolean =>
  left.left === right.left && left.right === right.right && left.firstLine === right.firstLine;

/** `level` with the sides `shown` states replaced. */
function withStyleIndent(level: ListLevelGeometry, shown: StyleIndent): ListLevelGeometry {
  const { hanging, firstLine, ...rest } = level;
  const offset =
    shown.firstLine === undefined
      ? {
          ...(hanging !== undefined ? { hanging } : {}),
          ...(firstLine !== undefined ? { firstLine } : {}),
        }
      : shown.firstLine < 0
        ? { hanging: -shown.firstLine }
        : { firstLine: shown.firstLine };
  return {
    ...rest,
    ...(shown.left !== undefined ? { left: shown.left } : {}),
    ...(shown.right !== undefined ? { right: shown.right } : {}),
    ...offset,
  };
}

/**
 * The `w:numId` each of `touched` names to become a `kind` list, or null when one cannot be
 * made.
 *
 * A list fits only when it draws `kind` at every level the items will be at (a paragraph
 * that is no list item yet lands at level 0): one definition can number level 0 and bullet
 * level 1, and naming it again for every item would change nothing. The list around the
 * selection comes first, then one the selection already holds. Otherwise definitions are
 * minted from the level geometry of the lists the items are leaving, so items keep their
 * place rather than taking the stock indents.
 *
 * Bullets count nothing, so every item keeps its own place: items mint one definition per
 * list they leave, and an item its numbering STYLE numbers at another indent than its level
 * gets one whose level states that indent. (The switch names the list on the paragraph,
 * which ranks the level above every style; a shared level would move the other items, and
 * a direct indent would outrank the levels Tab moves the item through.)
 *
 * Numbers count per definition, and the items must stay one list. They share one copy of the
 * list most of them leave, with a style's indent on a level only when every item at that
 * level shows it. Those items keep their place; an item whose level sat elsewhere takes the
 * shared indent, because one counted list has one indent per level.
 */
export function switchedListNumIds(
  deps: ListSwitchDeps,
  touched: readonly string[],
  kind: ListKind,
  /** The level a paragraph that is no list item takes when it joins the list above. */
  joinLevel: (paragraphId: string) => number = () => 0,
  /** How the selection mixes items and plain paragraphs: {@link mixedListSelection}. */
  mixed: ReturnType<typeof mixedListSelection> = mixedListSelection(deps, touched)
): Map<string, string> | null {
  // A heading of a heading numbering is not a list the selection is in: reference renderings
  // put a plain paragraph and such a heading on a new list together, the heading keeping its
  // style and level. A template list such as List Bullet links its levels to styles too, but
  // those are no headings, and its items keep their list and indents.
  const markers = touched.map((paragraphId) => {
    const marker = deps.markerOf(paragraphId);
    return marker && !deps.headingLevel(marker.numId, marker.level) ? marker : null;
  });
  const everyItem = (numId: string | null) =>
    numId === null ? null : new Map(touched.map((paragraphId) => [paragraphId, numId]));
  const fits = (numId: string | null | undefined): numId is string =>
    typeof numId === 'string' &&
    markers.every((marker) => deps.listLevelKindOf(numId, marker?.level ?? 0) === kind);
  // A selection of items and plain paragraphs joins the list above only when it starts with a
  // plain paragraph, and its items then join at that paragraph's level. Any other mix starts a
  // stock list of its own: never the list above, nor one an item is on.
  // Only a plain list above takes items along: a heading numbering would turn them into
  // headings, which no reference rendering showed.
  const above = adjacentListMarker(deps, touched, kind);
  if (mixed === 'item-first' || (mixed && above && deps.headingLevel(above.numId, above.level))) {
    return everyItem(deps.ensureListDefinition(kind));
  }
  // The list above must draw `kind` where each paragraph lands on it: an item at its own
  // level, or at the first paragraph's level in a mix, and any other paragraph at the level
  // it joins at.
  const adjacent = above?.numId;
  const lead = mixed === 'plain-first' ? joinLevel(touched[0]!) : null;
  const joinable =
    typeof adjacent === 'string' &&
    touched.every((paragraphId, index) => {
      const marker = markers[index];
      const level = marker
        ? (lead ?? marker.level)
        : deps.markerOf(paragraphId)
          ? 0
          : joinLevel(paragraphId);
      return deps.listLevelKindOf(adjacent, level) === kind;
    });
  if (joinable) return everyItem(adjacent);
  if (mixed !== null) return everyItem(deps.ensureListDefinition(kind));
  const held = markers.find((marker) => fits(marker?.numId))?.numId;
  if (held) return everyItem(held);
  const leaving = mostUsedNumId(markers);
  if (leaving === null) return everyItem(deps.ensureListDefinition(kind));
  if (kind === 'ordered') {
    // A level takes a style's indent only when every item at it shows that same indent.
    const base = deps.listGeometryOf(leaving);
    const agreed = new Map<number, StyleIndent | null>();
    touched.forEach((paragraphId, index) => {
      const marker = markers[index];
      const level = marker?.level ?? 0;
      const shown =
        marker?.numId === leaving ? styleIndentOver(deps, paragraphId, base[level]) : null;
      const taken = agreed.get(level);
      if (taken === undefined) agreed.set(level, shown);
      else if (taken && !(shown && sameStyleIndent(taken, shown))) agreed.set(level, null);
    });
    const geometry = base.map((level, ilvl) => {
      const shown = agreed.get(ilvl);
      return level && shown ? withStyleIndent(level, shown) : level;
    });
    return everyItem(deps.ensureListDefinition(kind, geometry));
  }

  const geometries = new Map<string, ListDefinitionGeometry>();
  const geometryOf = (numId: string): ListDefinitionGeometry => {
    let geometry = geometries.get(numId);
    if (!geometry) {
      geometry = deps.listGeometryOf(numId);
      geometries.set(numId, geometry);
    }
    return geometry;
  };
  const groups: {
    readonly numId: string;
    readonly shown: Map<number, StyleIndent | null>;
    readonly items: string[];
  }[] = [];
  touched.forEach((paragraphId, index) => {
    const marker = markers[index];
    // A paragraph that is no list item yet takes level 0 of the list most items leave.
    const numId = marker?.numId ?? leaving;
    const level = marker?.level ?? 0;
    const shown = marker ? styleIndentOver(deps, paragraphId, geometryOf(numId)[level]) : null;
    let group = groups.find((candidate) => {
      if (candidate.numId !== numId) return false;
      const taken = candidate.shown.get(level);
      if (taken === undefined) return true;
      return shown ? taken !== null && sameStyleIndent(taken, shown) : taken === null;
    });
    if (!group) {
      group = { numId, shown: new Map(), items: [] };
      groups.push(group);
    }
    // Null reserves this level for items that keep the original level indent.
    group.shown.set(level, shown);
    group.items.push(paragraphId);
  });

  const numIds = new Map<string, string>();
  for (const group of groups) {
    const geometry = geometryOf(group.numId).map((level, ilvl) => {
      const shown = group.shown.get(ilvl);
      return level && shown ? withStyleIndent(level, shown) : level;
    });
    const numId = deps.ensureListDefinition(kind, geometry);
    if (numId === null) return null;
    for (const paragraphId of group.items) numIds.set(paragraphId, numId);
  }
  return numIds;
}

/** The `w:numId` most of `markers` name, the first of them on a tie, or null for none. */
function mostUsedNumId(markers: readonly (ListMarkerRecord | null)[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const marker of markers) {
    if (!marker) continue;
    const count = (counts.get(marker.numId) ?? 0) + 1;
    counts.set(marker.numId, count);
    if (best === null || count > counts.get(best)!) best = marker.numId;
  }
  return best;
}

/** What {@link linkedStyleOps} reads. */
export interface LinkedStyleReads extends Pick<
  ListSwitchReads,
  'listLevelStyleOf' | 'listAbstractOf'
> {
  /** The paragraph's own list level, or null when it is no list item. */
  levelOf(paragraphId: string): number | null;
  /** The list and level a paragraph style numbers its paragraphs on, or null. */
  styleNumberingOf(styleId: string): { readonly numId: string; readonly ilvl: number } | null;
  /** The write that puts a paragraph in a style, or null when no such paragraph style exists. */
  linkedStyleOp(paragraphId: string, styleId: string): TreeDocOp | null;
}

/**
 * The style writes for the paragraphs a toggle puts on a level linked to a paragraph style.
 *
 * Joining a heading numbering puts the paragraph in the heading style the level names, the way
 * reference renderings do, and the style then numbers it. That holds only when the style
 * numbers on the same definition and level, whichever `w:num` instance names it: a style that
 * numbers elsewhere, or not at all, would leave the paragraph on another list or with no
 * number, so those paragraphs keep their own `w:numPr`. A plain paragraph joins at the level
 * `joinedLevel` gives it: with no indent, level 0, so below a Heading 2 it becomes a Heading 1.
 */
export function linkedStyleOps(
  numIds: ReadonlyMap<string, string>,
  reads: LinkedStyleReads
): Map<string, TreeDocOp> {
  const ops = new Map<string, TreeDocOp>();
  for (const [paragraphId, numId] of numIds) {
    const level = reads.levelOf(paragraphId) ?? 0;
    const styleId = reads.listLevelStyleOf(numId, level);
    const numbering = styleId ? reads.styleNumberingOf(styleId) : null;
    if (!styleId || !numbering || numbering.ilvl !== level) continue;
    const abstract = reads.listAbstractOf(numId);
    if (abstract === null || reads.listAbstractOf(numbering.numId) !== abstract) continue;
    const op = reads.linkedStyleOp(paragraphId, styleId);
    if (op) ops.set(paragraphId, op);
  }
  return ops;
}
