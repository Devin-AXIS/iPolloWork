// The generic class of a font family: serif, sans-serif or monospace.
//
// A family the host cannot supply falls back to another face, and that face should at least
// be of the same kind: a serif face set in a sans-serif one changes the look of every line.
// The font table records the kind (`w:family`, `w:pitch`); when it does not, the name often
// says it ("… Serif", "… Mono"). Nothing here is fetched or resolved; it only classifies.

export type FontFamilyClass = 'serif' | 'sans' | 'mono';

/**
 * `w:family` values (ST_FontFamily) that name a class. `script`, `decorative`, `auto` do not.
 * A Map, not an object: the value is file-derived, and `constructor` must not find a prototype.
 */
const FONT_TABLE_FAMILY_CLASSES: ReadonlyMap<string, FontFamilyClass> = new Map([
  ['roman', 'serif'],
  ['swiss', 'sans'],
  ['modern', 'mono'],
]);

/** The class a font table entry records, or undefined when it records none. */
export function fontTableFamilyClass(
  family: string | undefined,
  pitch: string | undefined
): FontFamilyClass | undefined {
  if (pitch === 'fixed') return 'mono';
  return family ? FONT_TABLE_FAMILY_CLASSES.get(family) : undefined;
}

/** Common families whose class their name does not state. */
const KNOWN_FAMILY_CLASSES: ReadonlyMap<string, FontFamilyClass> = new Map([
  ['calibri', 'sans'],
  ['arial', 'sans'],
  ['helvetica', 'sans'],
  ['verdana', 'sans'],
  ['tahoma', 'sans'],
  ['segoe ui', 'sans'],
  ['aptos', 'sans'],
  ['century gothic', 'sans'],
  ['carlito', 'sans'],
  ['cambria', 'serif'],
  ['times new roman', 'serif'],
  ['georgia', 'serif'],
  ['garamond', 'serif'],
  ['book antiqua', 'serif'],
  ['palatino linotype', 'serif'],
  ['caladea', 'serif'],
  ['courier new', 'mono'],
  ['consolas', 'mono'],
]);

/** The class a family's name states, or undefined when it states none. */
export function fontFamilyClassFromName(name: string): FontFamilyClass | undefined {
  const key = name.trim().toLowerCase();
  const known = KNOWN_FAMILY_CLASSES.get(key);
  if (known) return known;
  const words = key.split(/[\s_-]+/);
  if (words.includes('mono') || words.includes('monospace') || words.includes('courier')) {
    return 'mono';
  }
  if (words.includes('sans')) return 'sans';
  if (words.includes('serif') || words.includes('roman')) return 'serif';
  return undefined;
}

/** The face a missing family of each class falls back to, as a family a host can supply. */
export const CLASS_FALLBACK_FAMILIES: Readonly<Record<FontFamilyClass, string>> = {
  serif: 'Times New Roman',
  sans: 'Arial',
  mono: 'Courier New',
};
