import { projectDrawingsInPackage } from './drawing-projection.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveImageRelationship } from './relationships.ts';

/** Include embedded members of composite previews without manufacturing package relationships. */
export function countDrawingImageReferences(pkg: OoxmlPackage, partName: string): number {
  let count = 0;
  for (const projection of projectDrawingsInPackage(pkg)) {
    const references = projection.legacyGraphic
      ? projection.legacyGraphic.fragments.flatMap((fragment) =>
          typeof fragment === 'string' ? [] : [fragment.relationshipId]
        )
      : [
          (projection.picture ?? projection.groupPicture)?.embeddedRelationshipId,
          ...(projection.groupPictureLayers ?? []).map((layer) => layer.embeddedRelationshipId),
        ];
    for (const id of references) {
      if (!id) continue;
      const resolved = resolveImageRelationship(
        pkg.relationships.get(projection.ownerPartName) ?? [],
        projection.ownerPartName,
        id
      );
      if (resolved.mode === 'internal' && resolved.partName === partName) count++;
    }
  }
  return count;
}
