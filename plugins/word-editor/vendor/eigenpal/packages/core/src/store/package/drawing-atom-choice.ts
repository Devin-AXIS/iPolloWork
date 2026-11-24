// The modern drawing a run-level `mc:AlternateContent` selects, for edits made without the
// package. A shape whose paint comes from the theme or a shape style projects only with the
// package's theme and styles; without them the atom projection shows the VML fallback, which
// is read-only. A frame edit still belongs to the selected modern drawing.

import { holdsShapeGraphic } from './diagram-frame.ts';
import {
  DEFAULT_SUPPORTED_MC_REQUIRES,
  isRunLevelMcAlternateContent,
  resolveRunLevelMcAtom,
} from './drawing-projection.ts';
import { emptyNamespaceScope, namespaceScopeForNode } from './drawing-projection-walk.ts';
import { drawingAtomProjection } from './drawing-atom-projection.ts';
import { findNode } from './ooxml-edit.ts';
import type { DrawingProjection } from './drawing-projection.ts';
import type { OoxmlDrawingNode, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

/** Node visits before the search gives up. */
const MAX_VISITS = 1 << 20;

/** The selected modern shape drawing of the wrapper `wrapperId`, or null. */
function shapeChoiceDrawing(part: OoxmlPart, wrapperId: string): OoxmlDrawingNode | null {
  const stack: { node: OoxmlNode; scope: ReadonlyMap<string, string> }[] = [
    { node: part.root, scope: emptyNamespaceScope() },
  ];
  let visits = 0;
  while (stack.length && visits++ < MAX_VISITS) {
    const { node, scope: inherited } = stack.pop()!;
    if (node.kind === 'textValue') continue;
    const scope = namespaceScopeForNode(inherited, node);
    if (node.id === wrapperId) {
      if (!isRunLevelMcAlternateContent(node)) return null;
      const drawing = resolveRunLevelMcAtom(node, scope, DEFAULT_SUPPORTED_MC_REQUIRES).drawing;
      return drawing && holdsShapeGraphic(drawing) ? drawing : null;
    }
    for (let at = node.children.length - 1; at >= 0; at -= 1)
      stack.push({ node: node.children[at]!, scope });
  }
  return null;
}

/**
 * The atom projection a part-level edit acts on: the modern shape the wrapper selects when the
 * atom, projected without the package, shows its fallback in its place.
 */
export function atomProjectionForEdit(
  part: OoxmlPart,
  atomId: string,
  project: (part: OoxmlPart, drawing: OoxmlDrawingNode) => DrawingProjection | null
): DrawingProjection | null {
  const atom = drawingAtomProjection(part, atomId);
  if (!atom || atom.drawingNodeId === atomId) return atom;
  if (findNode(part, atom.drawingNodeId)?.kind === 'drawing') return atom;
  const choice = shapeChoiceDrawing(part, atomId);
  return choice ? project(part, choice) : atom;
}
