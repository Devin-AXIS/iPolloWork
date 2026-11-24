import type { TableAutofitContext } from './table-autofit-widths.ts';

// Only the section's complete dependency proof registers a key. The ordinary AutoFit scope
// can survive list or reference changes and still requires individual paragraph tokens.
const verified = new WeakMap<TableAutofitContext, string>();

export function setVerifiedAutofitScope(
  context: TableAutofitContext,
  key: string | undefined
): void {
  if (key === undefined) verified.delete(context);
  else verified.set(context, key);
}

export function verifiedAutofitScope(context: TableAutofitContext): string | undefined {
  return verified.get(context);
}
