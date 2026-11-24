// Visible cached text for atomic Word fields.
//
// Field instructions are inert source text. This walk exposes only saved result content.
// It follows the same typed run vocabulary as `paragraphTextOf`. Unknown generic content,
// drawings, and note references stay invisible. Nested fields in a saved result expose their
// own results; nested fields in an instruction add nothing (`field-marker-scope.ts`).
// Exhausting a field's node budget returns its atom placeholder. The walk fails soft and
// never makes a file-sized allocation.

import { symbolDisplayText } from './symbol-glyph.ts';
import { isSymbolElement } from './hyphen-text.ts';
import {
  collectFieldRunChildren,
  FIELD_ATOM_CHAR,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
  fieldResultInlineTextOf,
  isFldChar,
  isFldSimple,
  isInstrText,
  type AtomicFieldSpan,
  type FieldRunChildRef,
} from './field-nodes.ts';
import {
  consumeFieldMarker,
  fieldMarkerPlan,
  fieldMarkerStatesVisible,
  type FieldMarkerPlan,
  type FieldMarkerState,
} from './field-marker-scope.ts';
import type { OoxmlNode, OoxmlParagraphNode } from './ooxml-tree.ts';

/**
 * Review view applied to cached field-result content. `original` drops pending insertions and
 * `current` drops pending deletions, as if every revision were rejected or accepted.
 */
export type FieldResultTextView = 'allMarkup' | 'original' | 'current';

/** Whether a review view hides one field-machine entry. */
function hiddenIn(view: FieldResultTextView, entry: FieldRunChildRef): boolean {
  return view === 'original' ? entry.hiddenInOriginal : view === 'current' && entry.hiddenInCurrent;
}

/** One visible interval contributed by a result run. @internal */
export interface FieldResultRunBoundary {
  readonly runId: string;
  readonly start: number;
  readonly end: number;
}

/** Visible cached result text and its result-run intervals. @internal */
export interface FieldResultProjection {
  readonly text: string;
  readonly runs: readonly FieldResultRunBoundary[];
  /** Offsets in `text` of the symbols (`w:sym`, read as "("), which search never matches. */
  readonly symbols?: readonly number[];
  /** What each of those symbols shows as plain text, in the same order. */
  readonly symbolDisplays?: readonly string[];
}

interface ActiveComplexField {
  readonly span: AtomicFieldSpan;
  readonly owned: ReadonlySet<string>;
  readonly states: FieldMarkerState[];
  readonly markers: FieldMarkerPlan;
  readonly endId: string;
  readonly result: MutableFieldResult;
  readonly chars: CharacterBudget;
  nodesLeft: number;
  overflow: boolean;
}

/** Fixed node budget for one field's saved result. @internal */
export const MAX_FIELD_RESULT_NODES = 4_096;

/**
 * Fixed UTF-16 budget for one field's cached result.
 *
 * Sixteen instruction-sized buffers admit unusually long generated labels and references,
 * while capping the text that projection and case-folding can copy to about 128 KiB of UTF-16
 * payload per field. Lengths are checked before append; file-supplied strings are never sliced.
 */
export const MAX_FIELD_RESULT_CHARS = MAX_FIELD_INSTRUCTION_CHARS * 16;

interface CharacterBudget {
  left: number;
}

interface MutableFieldResult {
  readonly out: string[];
  readonly runs: FieldResultRunBoundary[];
  readonly symbols: number[];
  readonly symbolDisplays: string[];
  length: number;
}

function emptyFieldResult(): MutableFieldResult {
  return { out: [], runs: [], symbols: [], symbolDisplays: [], length: 0 };
}

function appendRunBoundary(
  result: MutableFieldResult,
  runId: string,
  start: number,
  end: number
): void {
  if (runId.length === 0 || start === end) return;
  const previous = result.runs[result.runs.length - 1];
  if (previous?.runId === runId && previous.end === start) {
    result.runs[result.runs.length - 1] = { runId, start: previous.start, end };
    return;
  }
  result.runs.push({ runId, start, end });
}

function appendResultText(
  result: MutableFieldResult,
  node: OoxmlNode,
  runId: string,
  budget: CharacterBudget
): boolean {
  const text = fieldResultInlineTextOf(node);
  if (text.length > budget.left) return false;
  budget.left -= text.length;
  if (text.length > 0) {
    const start = result.length;
    if (isSymbolElement(node)) {
      result.symbols.push(start);
      result.symbolDisplays.push(symbolDisplayText(node));
    }
    result.out.push(text);
    result.length += text.length;
    appendRunBoundary(result, runId, start, result.length);
  }
  return true;
}

function appendNestedResult(result: MutableFieldResult, nested: FieldResultProjection): void {
  const start = result.length;
  if (nested.text.length > 0) result.out.push(nested.text);
  result.length += nested.text.length;
  for (const run of nested.runs) {
    appendRunBoundary(result, run.runId, start + run.start, start + run.end);
  }
  for (const symbol of nested.symbols ?? []) result.symbols.push(start + symbol);
  for (const display of nested.symbolDisplays ?? []) result.symbolDisplays.push(display);
}

function finishFieldResult(result: MutableFieldResult): FieldResultProjection {
  const text = result.out.join('');
  return result.symbols.length > 0
    ? { text, runs: result.runs, symbols: result.symbols, symbolDisplays: result.symbolDisplays }
    : { text, runs: result.runs };
}

const EMPTY_FIELD_RESULT: FieldResultProjection = Object.freeze({ text: '', runs: [] });

function placeholderResult(): FieldResultProjection {
  return { text: FIELD_ATOM_CHAR, runs: [] };
}

function plainFieldResultText(
  node: OoxmlNode,
  view: FieldResultTextView,
  budget: { left: number },
  chars: CharacterBudget
): FieldResultProjection | null {
  const initial: FieldRunChildRef[] = [];
  if (!collectFieldRunChildren(node, initial, budget)) return null;
  const pending = initial.reverse();
  const result = emptyFieldResult();
  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (hiddenIn(view, entry)) continue;
    if (isFldSimple(entry.node)) {
      const nested: FieldRunChildRef[] = [];
      if (!collectFieldRunChildren(entry.node, nested, budget)) return null;
      for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
      continue;
    }
    if (isInstrText(entry.node)) continue;
    if (!appendResultText(result, entry.node, entry.runId, chars)) return null;
  }
  return finishFieldResult(result);
}

function scanSimpleEntries(
  entries: readonly FieldRunChildRef[],
  view: FieldResultTextView,
  budget: { left: number },
  chars: CharacterBudget,
  depth: number
): FieldResultProjection | null {
  const result = emptyFieldResult();
  const states: FieldMarkerState[] = [];
  const markers = fieldMarkerPlan(entries);
  for (const entry of entries) {
    const node = entry.node;
    if (consumeFieldMarker(states, markers, node)) continue;
    if (isInstrText(node)) continue;
    if (!fieldMarkerStatesVisible(states)) continue;
    if (hiddenIn(view, entry)) continue;
    if (isFldSimple(node)) {
      const nested =
        depth >= MAX_FIELD_NESTING
          ? plainFieldResultText(node, view, budget, chars)
          : simpleFieldResultText(node, view, budget, chars, depth + 1);
      if (nested === null) return null;
      // The recursive scan already charged every character to this field's shared budget.
      appendNestedResult(result, nested);
      continue;
    }
    if (!appendResultText(result, node, entry.runId, chars)) return null;
  }
  return finishFieldResult(result);
}

function simpleFieldResultText(
  node: OoxmlNode,
  view: FieldResultTextView,
  budget: { left: number },
  chars: CharacterBudget,
  depth: number
): FieldResultProjection | null {
  const entries: FieldRunChildRef[] = [];
  if (!collectFieldRunChildren(node, entries, budget)) return null;
  return scanSimpleEntries(entries, view, budget, chars, depth);
}

function consumeComplexEntry(
  active: ActiveComplexField,
  entry: FieldRunChildRef,
  view: FieldResultTextView
): boolean {
  const node = entry.node;
  if (active.owned.has(node.id)) {
    active.nodesLeft -= 1;
    if (active.nodesLeft < 0) active.overflow = true;
  }
  if (node.id === active.endId) return true;
  // The span's own begin opened `states` already.
  if (node.id === active.span.node.id) return false;
  if (consumeFieldMarker(active.states, active.markers, node)) return false;
  if (
    active.overflow ||
    isInstrText(node) ||
    isFldSimple(node) ||
    !active.owned.has(node.id) ||
    !fieldMarkerStatesVisible(active.states) ||
    hiddenIn(view, entry)
  ) {
    return false;
  }
  if (!appendResultText(active.result, node, entry.runId, active.chars)) active.overflow = true;
  return false;
}

/** Visible cached result projections for all supplied atomic spans, from one paragraph scan. */
export function fieldResultProjectionsOf(
  paragraph: OoxmlParagraphNode,
  spans: readonly AtomicFieldSpan[],
  view: FieldResultTextView = 'allMarkup'
): ReadonlyMap<string, FieldResultProjection> {
  const results = new Map<string, FieldResultProjection>();
  const complexByBegin = new Map<string, AtomicFieldSpan>();
  const simpleByNode = new Map<string, AtomicFieldSpan>();
  for (const span of spans) {
    if (span.kind === 'complex') complexByBegin.set(span.node.id, span);
    else simpleByNode.set(span.node.id, span);
  }

  const entries: FieldRunChildRef[] = [];
  collectFieldRunChildren(paragraph, entries);
  const entryIndexById = new Map<string, number>();
  for (let index = 0; index < entries.length; index += 1) {
    entryIndexById.set(entries[index]!.node.id, index);
  }
  let active: ActiveComplexField | null = null;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    const simple = simpleByNode.get(entry.node.id);
    if (simple) {
      if (active !== null && !fieldMarkerStatesVisible(active.states)) {
        // Inside an atomic field's instruction, a simple field is input to that field. It
        // keeps its model unit and adds no text; the outer saved result shows instead.
        results.set(simple.node.id, EMPTY_FIELD_RESULT);
      } else {
        const budget = { left: MAX_FIELD_RESULT_NODES };
        const chars = { left: MAX_FIELD_RESULT_CHARS };
        const text = simpleFieldResultText(simple.node, view, budget, chars, 0);
        results.set(simple.node.id, text ?? placeholderResult());
      }
    }

    if (active === null) {
      const complex = complexByBegin.get(entry.node.id);
      if (!complex) continue;
      const owned = new Set(complex.removeNodeIds);
      let endIndex = -1;
      for (let index = complex.removeNodeIds.length - 1; index >= 0; index -= 1) {
        const candidateIndex = entryIndexById.get(complex.removeNodeIds[index]!);
        if (candidateIndex === undefined || candidateIndex <= entryIndex) continue;
        if (isFldChar(entries[candidateIndex]!.node, 'end')) {
          endIndex = candidateIndex;
          break;
        }
      }
      const endEntry = entries[endIndex];
      if (!endEntry) {
        results.set(complex.node.id, placeholderResult());
        continue;
      }
      active = {
        span: complex,
        owned,
        states: [{ beginId: complex.node.id, separated: false }],
        markers: fieldMarkerPlan(entries, entryIndex + 1, endIndex, complex.node.id),
        endId: endEntry.node.id,
        result: emptyFieldResult(),
        chars: { left: MAX_FIELD_RESULT_CHARS },
        nodesLeft: MAX_FIELD_RESULT_NODES,
        overflow: false,
      };
    }

    if (consumeComplexEntry(active, entry, view)) {
      results.set(
        active.span.node.id,
        active.overflow ? placeholderResult() : finishFieldResult(active.result)
      );
      active = null;
    }
  }
  if (active !== null) results.set(active.span.node.id, placeholderResult());
  return results;
}

/** Visible cached results for all supplied atomic spans, from one paragraph scan. */
export function fieldResultTextsOf(
  paragraph: OoxmlParagraphNode,
  spans: readonly AtomicFieldSpan[],
  view: FieldResultTextView = 'allMarkup'
): ReadonlyMap<string, string> {
  const projections = fieldResultProjectionsOf(paragraph, spans, view);
  const results = new Map<string, string>();
  for (const [nodeId, projection] of projections) results.set(nodeId, projection.text);
  return results;
}
