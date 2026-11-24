import type { SemanticLayout } from './semantic-records.ts';

// Sparse routes retain page numbers, never fragments from an earlier layout.
const routes = new WeakMap<SemanticLayout, Map<string, number>>();
const MAX_ROUTES = 32;

export function fragmentPageRoute(layout: SemanticLayout, paragraphId: string): number | undefined {
  return routes.get(layout)?.get(paragraphId);
}

export function rememberFragmentPageRoute(
  layout: SemanticLayout,
  paragraphId: string,
  pageIndex: number
): void {
  let known = routes.get(layout);
  if (!known) routes.set(layout, (known = new Map()));
  if (!known.has(paragraphId) && known.size >= MAX_ROUTES) known.delete(known.keys().next().value!);
  known.set(paragraphId, pageIndex);
}

/** Caller proves every fragment and drawn paragraph keeps its page membership. */
export function carryFragmentPageRoutes(before: SemanticLayout, after: SemanticLayout): void {
  if (before === after) return;
  const known = routes.get(before);
  // Every valid answer is the same in both layouts; sharing keeps this bounded across edits.
  if (known && before.pages.length === after.pages.length) routes.set(after, known);
}
