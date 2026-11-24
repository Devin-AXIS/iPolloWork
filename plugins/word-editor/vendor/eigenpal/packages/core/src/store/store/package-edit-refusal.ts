// A package edit that refuses its transaction, rather than crashing it.
//
// `TransactionContext.applyPackage` takes a pure `(pkg) => pkg` function, which has no way to
// say "no" except to throw. A plain throw escaped `transact` and reached the caller as an
// untyped `Error`, which a script cannot tell apart from a crash. An edit that cannot apply throws
// this instead, and the store turns it into an ordinary refusal: nothing applied, no revision, a
// reason the caller can read. The reason defaults to `package-changed`, for an edit that finds a
// package other than the one it was planned against; an edit refused for its own cause names it.

import type { TreeOpRejection } from './tree-op-types.ts';

const PACKAGE_EDIT_REFUSAL = Symbol.for('docx-editor.package-edit-refusal');

/**
 * Thrown by a `ctx.applyPackage` edit to refuse the whole transaction with `reason`.
 *
 * @internal
 */
export class PackageEditRefusal extends Error {
  readonly [PACKAGE_EDIT_REFUSAL] = true;

  /** `message` is the refusal's detail. */
  constructor(
    detail: string,
    readonly reason: TreeOpRejection = 'package-changed'
  ) {
    super(detail);
    this.name = 'PackageEditRefusal';
  }
}

/**
 * Whether `error` is a {@link PackageEditRefusal}, branded rather than `instanceof` so a
 * refusal from another copy of the module is still recognized.
 *
 * @internal
 */
export function isPackageEditRefusal(error: unknown): error is PackageEditRefusal {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { [PACKAGE_EDIT_REFUSAL]?: unknown })[PACKAGE_EDIT_REFUSAL] === true
  );
}
