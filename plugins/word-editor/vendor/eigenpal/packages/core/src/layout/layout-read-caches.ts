import { carryFragmentPageRoutes } from './fragment-page-routes.ts';
import { carryParagraphPageRoutes } from './paragraph-lines.ts';
import { carryTableCaretContexts } from './table-caret-context.ts';
import type { SemanticLayout } from './semantic-records.ts';

/** Carry geometry-free reads through metadata wrappers that preserve paragraph membership. */
export function carryLayoutReadCaches(previous: SemanticLayout, next: SemanticLayout): void {
  carryTableCaretContexts(previous, next);
  carryParagraphPageRoutes(previous, next);
  carryFragmentPageRoutes(previous, next);
}
