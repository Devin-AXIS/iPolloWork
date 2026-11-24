import type { ThemeFonts } from './run-style.ts';

/**
 * The theme as cache-key material: every face present, `null` when the theme has none.
 *
 * `ThemeFonts` leaves the East Asian, complex-script, and supplemental faces optional,
 * and a producer that reads a theme with no such scheme hands over `undefined` for
 * them. The comparator behind `stableHash` refuses `undefined` by design, so a key built
 * from the raw object failed layout for any document whose theme lacked one of those
 * faces.
 */
export function themeCacheMaterial(themeFonts: ThemeFonts): Record<string, unknown> {
  return {
    major: themeFonts.major ?? null,
    minor: themeFonts.minor ?? null,
    majorEastAsia: themeFonts.majorEastAsia ?? null,
    minorEastAsia: themeFonts.minorEastAsia ?? null,
    majorBidi: themeFonts.majorBidi ?? null,
    minorBidi: themeFonts.minorBidi ?? null,
    majorSupplemental: themeFonts.majorSupplemental ?? null,
    minorSupplemental: themeFonts.minorSupplemental ?? null,
    chineseFontTableFaces: themeFonts.chineseFontTableFaces ?? null,
  };
}
