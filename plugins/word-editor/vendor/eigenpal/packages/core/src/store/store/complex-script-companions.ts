// Run formatting writes that must also reach the complex-script lane.
//
// Word formats a `w:rtl` or `w:cs` run from `w:bCs`, `w:iCs`, `w:szCs` and `w:rFonts/@w:cs`
// and ignores the Latin properties there (layout's `resolveRunStyle`). A Bold press that
// wrote `w:b` alone would do nothing visible to Arabic or Hebrew text, so a write to such a
// run carries the companion too — the pair Word itself saves there. Other runs get exactly
// what was asked for: Word writes a bare `w:b` on most left-to-right runs.

import type { OoxmlNode } from '../package/ooxml-tree.ts';
import type { OoxmlProperty } from './tree-op-types.ts';

const COMPANIONS: ReadonlyMap<string, string> = new Map([
  ['b', 'bCs'],
  ['i', 'iCs'],
  ['sz', 'szCs'],
]);

const ON_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'on']);

/**
 * Whether a `w:rPr` container puts its run in the complex-script lane (`w:rtl` or `w:cs`
 * on). Read from the container itself, because neither element is an authorable run
 * property and so never appears in an op's property bag.
 */
export function containerIsComplexScript(container: OoxmlNode | undefined): boolean {
  if (!container || container.kind === 'textValue') return false;
  let rtl = false;
  let forced = false;
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName !== 'rtl' && child.localName !== 'cs') continue;
    const value = child.attributes.find((attribute) => attribute.localName === 'val')?.value;
    const on = value === undefined || ON_VALUES.has(value);
    if (child.localName === 'rtl') rtl = on;
    else forced = on;
  }
  return rtl || forced;
}

/**
 * `incoming` with the complex-script companion of each entry when the target run is in the
 * complex-script lane. A font pick fills the `cs` slot from the Latin family it names. An
 * entry the write already names is never duplicated.
 */
export function withComplexScriptCompanions(
  complex: boolean,
  incoming: readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  if (!complex) return incoming;
  const named = new Set(incoming.map((property) => property.localName));
  const out: OoxmlProperty[] = [];
  for (const property of incoming) {
    const attributes = property.attributes;
    if (property.localName === 'rFonts' && attributes?.ascii && attributes.cs === undefined) {
      out.push({ localName: 'rFonts', attributes: { ...attributes, cs: attributes.ascii } });
      continue;
    }
    out.push(property);
    const companion = COMPANIONS.get(property.localName);
    if (companion && !named.has(companion)) out.push({ ...property, localName: companion });
  }
  return out;
}
