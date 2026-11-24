// The writes a bullet or numbering toggle makes over the paragraphs it touches.
//
// Turning a list off drops each paragraph's numbering. Turning one on picks the list
// (`switchedListNumIds`), then writes either the List Paragraph style and `w:numPr`, or, for a
// level linked to a paragraph style, that style alone (`linkedStyleOps`). A paragraph that
// joins the list above takes the level `joinedLevel` gives it and loses its own indent.

import type { ParagraphIndent, StyleCascadeTable } from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { styleNumberingOf } from './list-level-geometry.ts';
import { joinedLevel } from './surface-list-join.ts';
import {
  adjacentListMarker,
  linkedStyleOps,
  mixedListSelection,
  switchedListNumIds,
  type ListKind,
  type ListSwitchDeps,
} from './surface-list-switch.ts';
import type { ListStyleWrites } from './surface-list-style.ts';

export interface ListToggleDeps {
  readonly listSwitch: ListSwitchDeps;
  readonly listStyle: ListStyleWrites;
  /** The write that takes a paragraph out of its list. */
  leaveOp(paragraphId: string): TreeDocOp;
  /** The paragraph's own list level, or null when it is no list item. */
  levelOf(paragraphId: string): number | null;
  kindOf(paragraphId: string): ListKind | null;
  styleCascade(): StyleCascadeTable | undefined;
  /** The paragraph's effective indent, in points, or null when it is not laid out. */
  indentOf(paragraphId: string): ParagraphIndent | null;
  /** `w:defaultTabStop` in points. */
  defaultTabStopPt(): number;
}

/** The ops that toggle `kind` over `touched`, or null when no list can be found or made. */
export function listToggleOps(
  deps: ListToggleDeps,
  touched: readonly string[],
  kind: ListKind
): TreeDocOp[] | null {
  // The toggle turns OFF only when the whole selection is already that list; a mixed
  // selection becomes one list rather than clearing half of it. Turning a list off leaves
  // the style alone: an outdented item stays in List Paragraph until the user picks another.
  if (touched.every((paragraphId) => deps.kindOf(paragraphId) === kind)) {
    return touched.map((paragraphId) => deps.leaveOp(paragraphId));
  }
  // The paragraphs that are no list item yet and go on the list just above the selection.
  const above = adjacentListMarker(deps.listSwitch, touched, kind);
  const reads = { ...deps, listLevelStyleOf: deps.listSwitch.listLevelStyleOf };
  const levels = new Map<string, number>();
  const joinLevel = (paragraphId: string): number => {
    let level = levels.get(paragraphId);
    if (level === undefined) {
      level = above ? joinedLevel(reads, paragraphId, above) : 0;
      levels.set(paragraphId, level);
    }
    return level;
  };
  const mixed = mixedListSelection(deps.listSwitch, touched);
  const numIds = switchedListNumIds(deps.listSwitch, touched, kind, joinLevel, mixed);
  if (numIds === null) return null;
  const joined = new Map<string, number>();
  if (above) {
    for (const paragraphId of touched) {
      if (deps.levelOf(paragraphId) !== null || numIds.get(paragraphId) !== above.numId) continue;
      // Another path can pick the same list; a level that draws another kind does not join.
      const level = joinLevel(paragraphId);
      if (deps.listSwitch.listLevelKindOf(above.numId, level) !== kind) continue;
      joined.set(paragraphId, level);
    }
  }
  // A mix that starts with a plain paragraph and joins the list above takes its items along,
  // to that paragraph's level. The level change drops their own indent, as Tab does.
  const lead = joined.get(touched[0] ?? '');
  const moved = new Map<string, number>();
  if (lead !== undefined && mixed === 'plain-first') {
    for (const paragraphId of touched) {
      // A heading of a heading numbering keeps its style and level whatever the selection does.
      const marker = deps.listSwitch.markerOf(paragraphId);
      if (!marker || deps.listSwitch.headingLevel(marker.numId, marker.level)) continue;
      if (marker.level !== lead) moved.set(paragraphId, lead);
    }
  }
  const levelOf = (paragraphId: string) => joined.get(paragraphId) ?? deps.levelOf(paragraphId);
  // A level linked to a style moves an item by its style, so that write takes the new level.
  const linked = linkedStyleOps(numIds, {
    listLevelStyleOf: deps.listSwitch.listLevelStyleOf,
    listAbstractOf: deps.listSwitch.listAbstractOf,
    levelOf: (paragraphId) => moved.get(paragraphId) ?? levelOf(paragraphId),
    styleNumberingOf: (styleId) => styleNumberingOf(deps.styleCascade(), styleId),
    // A joined paragraph loses its whole indent; a moved item, as a level change, keeps its end.
    linkedStyleOp: (paragraphId, styleId) =>
      deps.listStyle.linkedStyleOp(
        paragraphId,
        styleId,
        joined.has(paragraphId) ? 'all' : moved.has(paragraphId) ? 'level' : false
      ),
  });
  const ops: TreeDocOp[] = [
    ...deps.listStyle.applyOps(
      touched.filter((paragraphId) => !linked.has(paragraphId)),
      (paragraphId) => joined.has(paragraphId)
    ),
    ...linked.values(),
  ];
  for (const paragraphId of touched) {
    if (linked.has(paragraphId)) continue;
    // `w:numPr` carries the level AND the definition, and the op mints a fresh one, so a call
    // that names no level silently resets `w:ilvl` to 0. A bullet converts to a number IN
    // PLACE: pressing Numbered on a level-2 item leaves it at level 2.
    const level = levelOf(paragraphId);
    ops.push({
      op: 'setListNumbering',
      paragraphId,
      numId: numIds.get(paragraphId) ?? null,
      ...(level !== null ? { level } : {}),
    });
    const to = moved.get(paragraphId);
    if (to !== undefined) ops.push({ op: 'setListLevel', paragraphId, level: to });
  }
  return ops;
}
