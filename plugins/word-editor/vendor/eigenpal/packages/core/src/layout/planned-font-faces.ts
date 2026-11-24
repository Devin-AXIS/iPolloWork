// The faces a font resolver loads for a document: the faces its text uses, carried over to the
// families that stand in for them, so a resolver that loads only the faces it is told about
// still loads the fallback a missing family draws in.

import type { FontFaceRequest } from '../contracts/editor.ts';

/** The planned families, with the families that stand in for each one. */
interface PlannedFamilies {
  readonly families: readonly string[];
  readonly standIns?: ReadonlyMap<string, readonly string[]>;
}

const fold = (family: string): string => family.trim().toLowerCase();

/**
 * The faces to ask a resolver for:
 * - each face that text uses, of a family the request names (`families` or `defaultFamily`);
 * - the same face of each family that stands in for it (an English name, a font-table
 *   alternate, a script or class default);
 * - the regular face of a requested family that no laid-out text uses, such as a family
 *   that only chart labels or a picked font name.
 */
export function plannedFontFaces(
  plan: PlannedFamilies,
  defaultFamily: string,
  faces: readonly FontFaceRequest[]
): readonly FontFaceRequest[] {
  // Only the families the request names: a face of a family past the family cap stays out.
  const asked = new Set([...plan.families, defaultFamily].map(fold));
  const planned = new Map<string, FontFaceRequest>();
  const withFace = new Set<string>();
  const add = (family: string, weight: number, style: FontFaceRequest['style']): void => {
    const key = fold(family);
    if (!asked.has(key)) return;
    withFace.add(key);
    const faceKey = `${key}\u0000${weight}\u0000${style}`;
    if (!planned.has(faceKey)) planned.set(faceKey, { family, weight, style });
  };
  for (const face of faces) {
    add(face.family, face.weight, face.style);
    for (const standIn of plan.standIns?.get(fold(face.family)) ?? [])
      add(standIn, face.weight, face.style);
  }
  for (const family of plan.families) if (!withFace.has(fold(family))) add(family, 400, 'normal');
  return [...planned.values()];
}
