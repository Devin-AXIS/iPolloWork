import type { TransactionContext } from './tree-store.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';

type PackageEdit = (pkg: OoxmlPackage) => OoxmlPackage;
const commentEdits = new WeakSet<PackageEdit>();

/** Internal capability for the comment writers; never exported from the store API. */
function commentPackageEdit(edit: PackageEdit): PackageEdit {
  commentEdits.add(edit);
  return edit;
}

export function isCommentPackageEdit(edit: PackageEdit): boolean {
  return commentEdits.has(edit);
}

/** Only the dedicated comment writers receive this package-write capability. */
export function commentPackageContext(ctx: TransactionContext): TransactionContext {
  return { ...ctx, applyPackage: (edit) => ctx.applyPackage(commentPackageEdit(edit)) };
}
