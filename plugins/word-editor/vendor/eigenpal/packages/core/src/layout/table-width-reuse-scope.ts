// A section-owned proof for grouped cell geometry. Unregistered flows cannot reuse groups.
import { autofitReuseScope } from './autofit-context-reuse.ts';
import { autofitContextOf } from './table-autofit-context.ts';
import { setVerifiedAutofitScope } from './autofit-verified-scope.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identity(value: object | undefined): number {
  if (!value) return 0;
  let known = identities.get(value);
  if (known === undefined) identities.set(value, (known = nextIdentity++));
  return known;
}

interface ScopeRecord {
  readonly inputs: readonly (string | number | boolean | undefined)[];
  readonly key: string;
}
const scopes = new WeakMap<object, ScopeRecord>();
const flowKeys = new WeakMap<TableFlowDeps, string>();
let nextKey = 1;

/**
 * Called only after the section validates drawing/projection epochs, numbering, styles,
 * and field inputs. A list-only carry is insufficient: its paragraph tokens still differ.
 * Stored signatures contain scalars, never documents, measurers, or layout callbacks.
 */
export function registerTableWidthReuseScope(
  deps: TableFlowDeps,
  sectionInputsEqual: boolean
): void {
  flowKeys.delete(deps);
  const context = autofitContextOf(deps);
  setVerifiedAutofitScope(context, undefined);
  if (!sectionInputsEqual) return;
  const scope = autofitReuseScope(context);
  if (!scope) return;
  const inputs = [
    identity(deps.styleCascade),
    identity(deps.listItems),
    identity(deps.outOfCellFloatParagraphs),
    deps.refFields?.valuesToken,
    deps.paragraphLineUnitPt,
    deps.defaultTabStopPt,
    deps.compatibilityMode,
    deps.displayMode,
    identity(deps.revisionAuthorFilter),
    deps.revisionAuthorFilter?.cacheKey,
    deps.anchorsWrapText,
    deps.tableNestingOffset,
    deps.textBoxStory,
  ];
  let known = scopes.get(scope);
  if (!known || inputs.some((value, index) => !Object.is(value, known!.inputs[index]))) {
    known = { inputs, key: `cell-width-scope:${nextKey++}` };
    scopes.set(scope, known);
  }
  flowKeys.set(deps, known.key);
  setVerifiedAutofitScope(context, known.key);
}

/** Missing registration means the caller must use full cell validation and placement. */
export function tableWidthReuseScope(deps: TableFlowDeps): string | undefined {
  return flowKeys.get(deps);
}
