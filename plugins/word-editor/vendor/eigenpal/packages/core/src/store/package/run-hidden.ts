// Direct hidden-text formatting on a run.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { readOnOffChild, WML_NAMESPACE_URI } from './ooxml-shared.ts';

/**
 * Whether a `w:r` sets `w:vanish` in its own `w:rPr`. Direct formatting is absolute for a
 * toggle property (ECMA-376 §17.7.3), so such a run is hidden whatever its styles say, and
 * layout neither measures nor paints it. A run hidden only through a style is not detected.
 * Layout reads the same direct property through `resolveRunStyle`
 * (`layout/drawing-atom-walk.ts`), with the same `w:val` spellings for off.
 */
export function runIsDirectlyHidden(run: OoxmlElement): boolean {
  for (const child of run.children as readonly OoxmlNode[]) {
    if (
      child.kind !== 'textValue' &&
      child.localName === 'rPr' &&
      child.namespaceUri === WML_NAMESPACE_URI
    )
      return readOnOffChild(child, 'vanish');
  }
  return false;
}
