import {
  indexInlineDrawingProjectionsInPart,
  type DrawingProjection,
} from './drawing-projection.ts';
import { packageDrawingProjectionContext } from './drawing-projection-context.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlPart } from './ooxml-tree.ts';
import { createRecentRootCache } from '../store/recent-root-cache.ts';

const indexes = createRecentRootCache<ReadonlyMap<string, DrawingProjection>>(16);
const packageIndexes = createRecentRootCache<{
  readonly pkg: OoxmlPackage;
  readonly index: ReadonlyMap<string, DrawingProjection>;
}>(16);

/**
 * Resolve the selected compatibility branch of a run-level drawing atom.
 *
 * Pass the package the part belongs to whenever it is at hand. A shape whose paint comes from
 * the theme or a shape style projects only with the package's theme and styles; without them
 * the atom resolves to its read-only fallback branch.
 */
export function drawingAtomProjection(
  part: OoxmlPart,
  atomId: string,
  pkg?: OoxmlPackage
): DrawingProjection | null {
  if (pkg) {
    let entry = packageIndexes.get(part.root);
    if (!entry || entry.pkg !== pkg) {
      entry = {
        pkg,
        index: indexInlineDrawingProjectionsInPart(
          part,
          packageDrawingProjectionContext(pkg, part.name)
        ),
      };
      packageIndexes.set(part.root, entry);
    }
    return entry.index.get(atomId) ?? null;
  }
  let index = indexes.get(part.root);
  if (!index) {
    index = indexInlineDrawingProjectionsInPart(part);
    indexes.set(part.root, index);
  }
  return index.get(atomId) ?? null;
}
