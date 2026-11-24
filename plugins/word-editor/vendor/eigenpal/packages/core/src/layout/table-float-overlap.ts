// `w:tblOverlap w:val="never"` (ECMA-376 Part 1 §17.4.56): floating tables that may not overlap.
//
// The property only constrains floating tables against each other. Paragraph text wraps
// around such a table like around any other floating table.
//
// A text-anchored floating table that would cover an earlier floating table on its page moves
// when either of the two refuses overlap. The later table moves, never the earlier one:
//
// - First to the right, so that its wrap band (grid plus `w:leftFromText` and the like) touches
//   the earlier table's band, when its grid then still fits between the margins.
// - Since mode 15, then to the left in the same way (`floatingTableOverlapMovesLeft`).
// - Otherwise down, so that its band starts where the earlier band ends. It keeps its
//   horizontal position, and the next collision is resolved the same way.
//
// Known limits: page- and margin-anchored tables keep their authored position. A floating table
// an earlier section left on a shared sheet moves only a later table that refuses overlap. A
// table whose move down would cross the page bottom keeps its authored position, and so does
// every table on a page with more than `MAX_NO_OVERLAP_OBSTACLES` refusing obstacles.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

const EPSILON = 0.001;
/** Each step clears one obstacle, so the bound only guards against a hostile page. */
const MAX_DISPLACEMENT_STEPS = 64;
/**
 * More refusing tables than this on one page keep their authored position: the search is
 * quadratic in the obstacles, and a page that crowded is not a layout to resolve.
 */
const MAX_NO_OVERLAP_OBSTACLES = 64;

/** A wrap band in page-content points. */
export interface FloatBand {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A floating table already placed on the page. */
export interface NoOverlapObstacle extends FloatBand {
  readonly refusesOverlap: boolean;
}

/** The grid box of a table about to be placed, with its text distances. */
export interface NoOverlapCandidate {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly distances: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly refusesOverlap: boolean;
}

/** Whether a table's own `w:tblPr` carries `w:tblOverlap w:val="never"`. */
export function tableRefusesOverlap(table: OoxmlElement): boolean {
  const properties = table.children.find((node) => node.kind === 'tableProperties');
  if (!properties || properties.kind === 'textValue') return false;
  return properties.children.some(
    (node) =>
      node.kind !== 'textValue' &&
      node.localName === 'tblOverlap' &&
      node.attributes.some(
        (attr) =>
          attr.namespaceUri === WML_NAMESPACE_URI &&
          attr.localName === 'val' &&
          attr.value === 'never'
      )
  );
}

const overlaps = (a: FloatBand, b: FloatBand): boolean =>
  a.left < b.right - EPSILON &&
  a.right > b.left + EPSILON &&
  a.top < b.bottom - EPSILON &&
  a.bottom > b.top + EPSILON;

function bandOf(candidate: NoOverlapCandidate, left: number, top: number): FloatBand {
  const { distances } = candidate;
  return {
    left: left - distances.left,
    top: top - distances.top,
    right: left + candidate.width + distances.right,
    bottom: top + candidate.height + distances.bottom,
  };
}

/**
 * How far a table that may not overlap moves, as `dx`/`dy` from its authored grid position.
 *
 * `frame` is the horizontal room between the margins. `movesLeft` enables the left-side move.
 */
export function noOverlapShift(
  candidate: NoOverlapCandidate,
  obstacles: readonly NoOverlapObstacle[],
  frame: { readonly left: number; readonly right: number },
  movesLeft: boolean
): { readonly dx: number; readonly dy: number } {
  const relevant = obstacles.filter(
    (obstacle) => candidate.refusesOverlap || obstacle.refusesOverlap
  );
  if (relevant.length === 0 || relevant.length > MAX_NO_OVERLAP_OBSTACLES) return { dx: 0, dy: 0 };
  const { width, distances } = candidate;
  let left = candidate.left;
  let top = candidate.top;
  const clearAt = (x: number): boolean =>
    x >= frame.left - EPSILON &&
    x + width <= frame.right + EPSILON &&
    !relevant.some((obstacle) => overlaps(bandOf(candidate, x, top), obstacle));
  for (let step = 0; step < MAX_DISPLACEMENT_STEPS; step += 1) {
    const band = bandOf(candidate, left, top);
    const blocker = relevant.find((obstacle) => overlaps(band, obstacle));
    if (!blocker) break;
    const right = blocker.right + distances.left;
    if (clearAt(right)) {
      left = right;
      break;
    }
    const leftSide = blocker.left - distances.right - width;
    if (movesLeft && clearAt(leftSide)) {
      left = leftSide;
      break;
    }
    top = blocker.bottom + distances.top;
  }
  return { dx: left - candidate.left, dy: top - candidate.top };
}

/**
 * Table deps for a floating table's own cells, which never wrap around another floating table:
 * the two overlap, or the later one moved off the earlier one. Other wrap zones still apply.
 * The filtered list keeps its identity while the page's zones do.
 */
export function withoutFloatingTableZones(deps: TableFlowDeps): TableFlowDeps {
  const zonesOf = deps.pageExclusionZones;
  if (!zonesOf) return deps;
  const cached = withoutTableZones.get(deps);
  if (cached) return cached;
  let source: readonly ExclusionZone[] | undefined;
  let filtered: readonly ExclusionZone[] = [];
  const derived: TableFlowDeps = {
    ...deps,
    pageExclusionZones: () => {
      const zones = zonesOf();
      if (zones !== source) {
        source = zones;
        filtered = zones.some((zone) => zone.sourceKind === 'table')
          ? zones.filter((zone) => zone.sourceKind !== 'table')
          : zones;
      }
      return filtered;
    },
  };
  withoutTableZones.set(deps, derived);
  return derived;
}

/** One derived deps object per body pass, so memos keyed by deps keep working. */
const withoutTableZones = new WeakMap<TableFlowDeps, TableFlowDeps>();
