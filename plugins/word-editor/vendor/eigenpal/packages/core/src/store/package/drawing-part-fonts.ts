// Faces named by the parts a drawing renders from: chart parts, saved diagram drawings, and
// EMF and WMF pictures.
//
// Their labels lower to stories that live outside every document story, so a collector that
// walks the stories never sees the faces they name. Theme font tokens (`+mn-lt`, `+mj-lt`)
// name the theme's faces, which chart text also takes when it names none. The walk and the
// result are bounded: family names are file-supplied.
//
// An East Asian or complex script face renders only text in its script. A chart template
// names `+mn-ea` and `+mn-cs` on every label, so a part asks for those faces only when its
// text has such characters: a Latin chart must not load a CJK face.

import { CHART_NAMESPACE_URI } from './chart-parts.ts';
import { DIAGRAM_DRAWING_NAMESPACE_URI } from './diagram-parts.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { validFontFamily } from './run-defaults.ts';
import { isEastAsianCodePoint } from './east-asian-code-points.ts';
import { metafileFontFamilies } from './metafile-fonts.ts';

const MAX_NODES = 200_000;
const MAX_FAMILIES = 32;
const FACE_ELEMENTS = new Set(['latin', 'ea', 'cs']);

/** The theme's faces for theme font tokens, East Asian and complex script after language. */
export interface DrawingPartThemeFonts {
  readonly major?: string | null;
  readonly minor?: string | null;
  readonly majorEastAsia?: string | null;
  readonly minorEastAsia?: string | null;
  readonly majorBidi?: string | null;
  readonly minorBidi?: string | null;
}

/** The face a theme font token (`+mn-lt`, `+mj-cs`, …) names, or undefined for none. */
function themeTokenFace(typeface: string, theme: DrawingPartThemeFonts): string | null | undefined {
  const match = /^\+(mn|mj)-(lt|ea|cs)$/.exec(typeface);
  if (!match) return undefined;
  const major = match[1] === 'mj';
  if (match[2] === 'ea') return major ? theme.majorEastAsia : theme.minorEastAsia;
  if (match[2] === 'cs') return major ? theme.majorBidi : theme.minorBidi;
  return major ? theme.major : theme.minor;
}

/** A face slot of DrawingML text: Latin, East Asian, or complex script. */
type FaceSlot = 'latin' | 'ea' | 'cs';

/** The faces one part names, in order, and the scripts its text uses. */
interface PartFaces {
  readonly faces: readonly { readonly slot: FaceSlot; readonly typeface: string }[];
  readonly eastAsian: boolean;
  readonly complex: boolean;
}

/** Parts are immutable, so the walk is kept per root. */
const PART_FACES = new WeakMap<OoxmlElement, PartFaces>();

/**
 * Whether a code point is complex script text: Hebrew through the Arabic extensions, the
 * Indic scripts, Thai and Lao, and the Hebrew and Arabic presentation forms.
 */
function isComplexScriptCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0590 && codePoint <= 0x08ff) ||
    (codePoint >= 0x0900 && codePoint <= 0x0eff) ||
    (codePoint >= 0xfb1d && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfeff)
  );
}

function partFaces(root: OoxmlElement): PartFaces {
  const cached = PART_FACES.get(root);
  if (cached) return cached;
  const faces: { slot: FaceSlot; typeface: string }[] = [];
  const seen = new Set<string>();
  let eastAsian = false;
  let complex = false;
  const stack: OoxmlElement[] = [root];
  let visited = 0;
  while (stack.length > 0 && ++visited <= MAX_NODES) {
    const node = stack.pop()!;
    if (node.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI && FACE_ELEMENTS.has(node.localName)) {
      const typeface = schemaAttributeValue(node.attributes, 'typeface');
      const slot = node.localName as FaceSlot;
      const key = `${slot}\u0000${typeface}`;
      if (typeface && !seen.has(key) && faces.length < MAX_FAMILIES) {
        seen.add(key);
        faces.push({ slot, typeface });
      }
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue') {
        stack.push(child as OoxmlElement);
        continue;
      }
      if (eastAsian && complex) continue;
      for (const char of child.value) {
        const codePoint = char.codePointAt(0)!;
        if (!eastAsian && isEastAsianCodePoint(codePoint)) eastAsian = true;
        else if (!complex && isComplexScriptCodePoint(codePoint)) complex = true;
        if (eastAsian && complex) break;
      }
    }
  }
  const result: PartFaces = { faces, eastAsian, complex };
  PART_FACES.set(root, result);
  return result;
}

/** Faces named in chart and saved diagram parts, in part order. */
export function drawingPartFontFamilies(
  pkg: OoxmlPackage,
  theme: DrawingPartThemeFonts = {}
): readonly string[] {
  const byFold = new Map<string, string>();
  const add = (raw: string | null | undefined): void => {
    const family = raw ? validFontFamily(raw) : null;
    if (family === null || byFold.size >= MAX_FAMILIES) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };
  for (const part of pkg.parts.values()) {
    const root = part.root;
    if (
      root.namespaceUri !== CHART_NAMESPACE_URI &&
      root.namespaceUri !== DIAGRAM_DRAWING_NAMESPACE_URI
    )
      continue;
    // Text that names no face takes the theme's body face.
    add(theme.minor);
    const named = partFaces(root);
    for (const { slot, typeface } of named.faces) {
      if (slot === 'ea' && !named.eastAsian) continue;
      if (slot === 'cs' && !named.complex) continue;
      if (typeface.startsWith('+')) add(themeTokenFace(typeface, theme));
      else add(typeface);
    }
  }
  // EMF and WMF pictures name their text faces in their own font records.
  for (const face of metafileFontFamilies(pkg, validFontFamily)) add(face);
  return [...byFold.values()];
}
