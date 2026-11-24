// Saved-result visibility for the complex-field markers inside one field scope.
//
// A field nested inside another field's instruction is input to that field. Content between
// a begin and its separate is never saved result text, at any nesting level. A begin counts
// only when the scope holds its matching separate or end, so a malformed begin never hides
// the rest of a saved result. The store's saved-result text and layout's `w:fldSimple`
// display both read this one rule.

import { collectFieldRunChildren, isFldChar, type FieldRunChildRef } from './field-nodes.ts';
import type { OoxmlNode } from './ooxml-tree.ts';

/** One open field in a marker scope. @internal */
export interface FieldMarkerState {
  readonly beginId: string;
  separated: boolean;
}

/** Begin, separate, and end pairings for one marker scope. @internal */
export interface FieldMarkerPlan {
  readonly activeBegins: ReadonlySet<string>;
  readonly separateBegin: ReadonlyMap<string, string>;
  readonly endBegin: ReadonlyMap<string, string>;
}

/** Pair the markers in `entries[from, to)`, optionally inside an already open begin. @internal */
export function fieldMarkerPlan(
  entries: readonly FieldRunChildRef[],
  from = 0,
  to = entries.length,
  enclosingBeginId?: string
): FieldMarkerPlan {
  const activeBegins = new Set<string>();
  const separateBegin = new Map<string, string>();
  const endBegin = new Map<string, string>();
  const stack = enclosingBeginId ? [enclosingBeginId] : [];
  if (enclosingBeginId) activeBegins.add(enclosingBeginId);
  for (let index = from; index < to; index += 1) {
    const node = entries[index]!.node;
    if (isFldChar(node, 'begin')) {
      stack.push(node.id);
      continue;
    }
    if (isFldChar(node, 'separate')) {
      const beginId = stack[stack.length - 1];
      if (beginId) {
        activeBegins.add(beginId);
        separateBegin.set(node.id, beginId);
      }
      continue;
    }
    if (isFldChar(node, 'end')) {
      const beginId = stack.pop();
      if (beginId) {
        activeBegins.add(beginId);
        endBegin.set(node.id, beginId);
      }
    }
  }
  return { activeBegins, separateBegin, endBegin };
}

/** Apply one node to the open fields. Returns false when the node is not a field marker. @internal */
export function consumeFieldMarker(
  states: FieldMarkerState[],
  markers: FieldMarkerPlan,
  node: OoxmlNode
): boolean {
  if (isFldChar(node, 'begin')) {
    if (markers.activeBegins.has(node.id)) states.push({ beginId: node.id, separated: false });
    return true;
  }
  if (isFldChar(node, 'separate')) {
    const beginId = markers.separateBegin.get(node.id);
    const state = states[states.length - 1];
    if (beginId && state?.beginId === beginId) state.separated = true;
    return true;
  }
  if (isFldChar(node, 'end')) {
    const beginId = markers.endBegin.get(node.id);
    const state = states[states.length - 1];
    if (beginId && state?.beginId === beginId) states.pop();
    return true;
  }
  return false;
}

/** Whether the current position is saved result text for every open field. @internal */
export function fieldMarkerStatesVisible(states: readonly FieldMarkerState[]): boolean {
  for (const state of states) if (!state.separated) return false;
  return true;
}

/** Marker visibility for one `w:fldSimple` saved result, fed in document order. @internal */
export interface SimpleFieldMarkerScope {
  /** Apply one node. Returns false when the node is not a field marker. */
  consume(node: OoxmlNode): boolean;
  /** Whether the current position is saved result text. */
  visible(): boolean;
}

/**
 * The marker scope of one `w:fldSimple` saved result.
 *
 * The scope covers the field's own run content, not the content of nested `w:fldSimple`
 * elements, which open their own scopes. When `budget` runs out, markers after that point
 * stay unpaired and hide nothing.
 */
export function simpleFieldMarkerScope(
  simple: OoxmlNode,
  budget?: { left: number }
): SimpleFieldMarkerScope {
  const entries: FieldRunChildRef[] = [];
  collectFieldRunChildren(simple, entries, budget);
  const markers = fieldMarkerPlan(entries);
  const states: FieldMarkerState[] = [];
  return {
    consume: (node) => consumeFieldMarker(states, markers, node),
    visible: () => fieldMarkerStatesVisible(states),
  };
}
