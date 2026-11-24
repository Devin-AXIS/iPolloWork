import { carryIndexToHistoryRoot } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';

/** Move lookup storage across validated history roots instead of retaining one per undo. */
export function restoreHistoryPackage(current: OoxmlPackage, restored: OoxmlPackage): OoxmlPackage {
  for (const [name, next] of restored.parts) {
    const previous = current.parts.get(name);
    // Added or replaced parts have no shared root lineage to patch.
    if (!previous || previous.root === next.root || previous.root.id !== next.root.id) continue;
    carryIndexToHistoryRoot(previous.root, next.root);
  }
  return restored;
}
