import type { TableAutofitContext } from './table-autofit-widths.ts';

const scopes = new WeakMap<
  object,
  {
    measurer: TableAutofitContext['measurer'];
    passToken: string | undefined;
    fieldToken: string;
    scope: object;
  }
>();
const contextScopes = new WeakMap<TableAutofitContext, object>();

/**
 * Internal section proof: every projection, numbering, and drawing input stayed unchanged.
 *
 * `onlyListsDiffer` keeps the measurement scope when the list items are the only input that
 * moved. Each cached cell then also proves its own paragraphs' list tokens
 * (`table-autofit-cell-cache.ts`): turning one paragraph into a list item built a new list
 * map, and every table after it measured its cells again. The answer stays false, because the
 * section inputs did change.
 */
export function carryAutofitScope(
  previous: object | null | undefined,
  next: object,
  inputsEqual: boolean,
  context: TableAutofitContext,
  fieldToken: string,
  onlyListsDiffer = false
): boolean {
  const known = previous ? scopes.get(previous) : undefined;
  const shared = autofitContextMatches(
    previous,
    inputsEqual || onlyListsDiffer,
    context,
    fieldToken
  );
  const scope = shared ? known!.scope : {};
  scopes.set(next, { measurer: context.measurer, passToken: context.passToken, fieldToken, scope });
  contextScopes.set(context, scope);
  return inputsEqual && shared;
}
export function autofitReuseScope(context: TableAutofitContext): object | undefined {
  return contextScopes.get(context);
}

/** Compare dynamic width inputs without sharing the paragraph measurement scope. */
export function autofitContextMatches(
  previous: object | null | undefined,
  inputsEqual: boolean,
  context: TableAutofitContext,
  fieldToken: string
): boolean {
  const known = previous ? scopes.get(previous) : undefined;
  return !!(
    inputsEqual &&
    known &&
    known.measurer === context.measurer &&
    known.passToken === context.passToken &&
    known.fieldToken === fieldToken
  );
}
