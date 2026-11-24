// Whether a package edit reached beyond one story part.
//
// `TreePackageStore.transact` syncs the transacted STORY PART back into the package after a
// commit. Everything else a `ctx.applyPackage` edit can write — a relationship, a content
// type, binary part bytes, another part — needs the package-unit promotion the image and
// paste lanes perform. This predicate is how the transact tail decides, so it compares by
// identity only: an edit produces new objects exactly where it wrote.

import type { OoxmlPackage } from '../package/ooxml-package.ts';

/** True when `next` differs from `previous` anywhere the story-part sync cannot carry. */
export function packageEditTouchesShell(
  previous: OoxmlPackage,
  next: OoxmlPackage,
  storyPartName: string
): boolean {
  if (
    previous.relationships !== next.relationships ||
    previous.contentTypes !== next.contentTypes ||
    previous.partBytes !== next.partBytes ||
    previous.externalTargets !== next.externalTargets ||
    previous.mainDocumentPart !== next.mainDocumentPart
  ) {
    return true;
  }
  if (previous.parts === next.parts) return false;
  if (previous.parts.size !== next.parts.size) return true;
  for (const [name, part] of next.parts) {
    if (name === storyPartName) continue;
    if (previous.parts.get(name) !== part) return true;
  }
  return false;
}
