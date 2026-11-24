// The resolvers a part's drawings project with: styles, relationships, theme colours and
// style matrices, and the diagram parts behind SmartArt drawings.

import { createDiagramPartResolver } from './diagram-parts.ts';
import { createDrawingRelationshipResolver } from './drawing-projection.ts';
import { stylesPartOf } from './ooxml-indexes.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { createPackageShapeThemeResolvers } from './theme-color-resolution.ts';

/** Projection context for the drawings of `ownerPartName` in `pkg`. */
export function packageDrawingProjectionContext(pkg: OoxmlPackage, ownerPartName: string) {
  const theme = createPackageShapeThemeResolvers(pkg);
  return {
    stylesPart: stylesPartOf(pkg),
    resolveRelationship: createDrawingRelationshipResolver(pkg, ownerPartName),
    resolveSchemeColor: theme.resolveSchemeColor,
    resolveStyleMatrixReference: theme.resolveStyleMatrixReference,
    resolveDiagramParts: createDiagramPartResolver(pkg, ownerPartName),
  };
}
