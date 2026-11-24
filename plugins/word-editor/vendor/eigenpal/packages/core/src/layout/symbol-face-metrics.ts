// Metrics of the legacy symbol-encoded faces, for when the face itself is unavailable.
//
// Symbol, Wingdings, Wingdings 2, Wingdings 3 and Webdings draw private-use codes that no text
// face carries, so no text face can stand in for them: a substitute draws missing glyphs and
// sizes the line by its own ascent. The engine therefore leaves the face unresolved and paints
// the Unicode twin of each glyph (`symbol-encoding.ts`) in a glyph fallback face. That keeps the
// glyph visible, but the fallback measurer knows nothing of the original face, so the line box
// and the advances drift from the authored layout.
//
// No metric-compatible open face exists for these encodings. The geometry needs only two facts
// per face, though: the vertical extent (`OS/2` usWinAscent and usWinDescent, which set single
// line spacing; `hhea.lineGap` is 0 in all five) and the advance of each of the 224 bytes the
// encoding defines. Those are numbers, not outlines, so a table restores the geometry without
// shipping a face. A run that measures through this table lays out as if the face were present,
// whichever face later paints it.
//
// Units are 1/2048 em (every face here has unitsPerEm 2048). Advances run from byte 0x20 to
// 0xFF; 0 marks a byte the face does not map, which keeps the fallback measurement.

import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { layoutRunHalfPointsOf } from './layout-run-shape.ts';
import { isSymbolEncodedFamily, symbolFaceByteOf } from './symbol-encoding.ts';

const UNITS_PER_EM = 2048;
const FIRST_BYTE = 0x20;

interface SymbolFaceMetrics {
  /** usWinAscent, font units. */
  readonly ascent: number;
  /** usWinDescent, font units. */
  readonly descent: number;
  /** Advance per byte from 0x20, font units; 0 is an unmapped byte. */
  readonly advances: readonly number[];
}

const SYMBOL_FACE_METRICS: ReadonlyMap<string, SymbolFaceMetrics> = new Map([
  [
    'symbol',
    {
      ascent: 2059,
      descent: 450,
      advances: [
        512, 682, 1460, 1024, 1124, 1706, 1593, 899, 682, 682, 1024, 1124, 512, 1124, 512, 569,
        1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024, 569, 569, 1124, 1124, 1124, 909,
        1124, 1479, 1366, 1479, 1253, 1251, 1563, 1235, 1479, 682, 1292, 1479, 1405, 1821, 1479,
        1479, 1573, 1518, 1139, 1212, 1251, 1413, 899, 1573, 1321, 1628, 1251, 682, 1767, 682, 1348,
        1024, 1024, 1292, 1124, 1124, 1012, 899, 1067, 842, 1235, 674, 1235, 1124, 1124, 1180, 1067,
        1124, 1124, 1067, 1124, 1235, 899, 1180, 1460, 1405, 1010, 1405, 1012, 983, 410, 983, 1124,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1270, 506, 1124, 342, 1460, 1024, 1542, 1542, 1542, 1542, 2134, 2021, 1235, 2021,
        1235, 819, 1124, 842, 1124, 1124, 1460, 1012, 942, 1124, 1124, 1124, 1124, 2048, 1235, 2048,
        1348, 1686, 1405, 1628, 2021, 1573, 1573, 1686, 1573, 1573, 1460, 1460, 1460, 1460, 1460,
        1460, 1460, 1573, 1460, 1618, 1618, 1823, 1686, 1124, 512, 1460, 1235, 1235, 2134, 2021,
        1235, 2021, 1235, 1012, 674, 1618, 1618, 1610, 1460, 786, 786, 786, 786, 786, 786, 1012,
        1012, 1012, 1012, 0, 674, 561, 1405, 1405, 1405, 786, 786, 786, 786, 786, 786, 1012, 1012,
        1012, 0,
      ],
    },
  ],
  [
    'wingdings',
    {
      ascent: 1841,
      descent: 432,
      advances: [
        2048, 2110, 2344, 2665, 2752, 1830, 2492, 938, 2220, 1826, 2319, 2319, 2399, 2399, 2951,
        2956, 2245, 2751, 1431, 1431, 1826, 1135, 1233, 2196, 1941, 2208, 1924, 1825, 1826, 1826,
        1825, 1863, 1863, 1203, 1624, 1381, 1381, 1929, 1929, 1124, 1124, 1826, 1727, 1727, 1727,
        2275, 1352, 1739, 2230, 1819, 1803, 1332, 1665, 1529, 1529, 1480, 1420, 1627, 1813, 1826,
        1834, 1825, 2368, 2159, 1974, 2233, 1927, 1911, 1937, 2099, 1902, 2245, 2181, 1597, 2150,
        2603, 1529, 1951, 1529, 1825, 1825, 1825, 1825, 937, 1529, 2020, 1825, 1183, 2171, 2171,
        1825, 1826, 1826, 1086, 1086, 0, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826,
        1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 641, 937, 641, 1825, 1825, 1825, 1825, 1825, 1951, 937, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825,
        2146, 2146, 2146, 2146, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2566,
        2566, 1627, 1627, 1825, 1825, 1825, 1825, 1825, 1825, 2006, 2006, 1825, 1825, 1589, 1589,
        1589, 1589, 2186, 2186, 1825, 1825, 1787, 1787, 1787, 1787, 1825, 1825, 1660, 1660, 2171,
        1660, 1601, 1601, 1601, 1601, 987, 789, 1301, 1609, 1826, 1826, 2119,
      ],
    },
  ],
  [
    'wingdings 2',
    {
      ascent: 1727,
      descent: 432,
      advances: [
        2048, 2110, 2090, 2073, 2086, 2344, 2045, 2220, 989, 1431, 1431, 1826, 1431, 1431, 1826,
        1431, 1431, 1826, 1431, 1431, 2320, 2246, 1826, 1826, 1826, 2320, 2170, 2170, 1381, 1381,
        1938, 1938, 1938, 1938, 1928, 1928, 1928, 1928, 1047, 1047, 1047, 1047, 1178, 1178, 1178,
        1178, 1826, 1321, 1568, 1826, 1826, 1826, 1826, 1825, 1825, 1826, 1826, 2226, 1727, 1548,
        1579, 984, 1035, 864, 1018, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 1826, 1826,
        1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826, 1826,
        1826, 1826, 1826, 1826, 1826, 0, 1899, 1899, 1453, 1453, 1673, 1332, 1431, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 2048, 2048, 542, 740, 1135, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 542, 740, 1135, 1825, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 624, 764, 903, 1461, 2020, 2020, 2020, 2020, 2020, 542, 641, 740, 1135,
        1529, 1529, 1085, 1085, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1496, 1825, 0, 0, 0, 0, 0, 0,
      ],
    },
  ],
  [
    'wingdings 3',
    {
      ascent: 1900,
      descent: 432,
      advances: [
        2048, 1825, 1825, 1135, 1135, 1444, 1444, 1444, 1444, 1825, 1825, 1135, 1135, 1677, 1677,
        1135, 1135, 1135, 1135, 1135, 1135, 1135, 1135, 1135, 1135, 1135, 1825, 1825, 1455, 1455,
        1455, 1455, 2010, 2010, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1825, 1825, 2220, 1825, 1751, 1114, 1115, 1660, 1660, 1930, 1930,
        1930, 1930, 1924, 1924, 1924, 1924, 1930, 1930, 1931, 1931, 1825, 1825, 1232, 1232, 1444,
        1444, 1444, 1444, 1825, 1232, 2005, 2005, 2005, 2005, 1801, 1801, 1801, 1801, 1801, 1801,
        1801, 1801, 1085, 1085, 1825, 0, 1825, 1825, 1825, 1825, 1825, 1627, 1627, 1825, 1825, 1825,
        1825, 789, 789, 1825, 1825, 987, 987, 1825, 1825, 1184, 1184, 1825, 1825, 1579, 1579, 1825,
        1825, 888, 888, 1825, 1825, 1381, 1381, 1825, 1825, 1875, 1875, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 789, 592, 493, 394, 1825, 1825, 1825, 1825, 1825, 1085, 1085, 1381, 1381,
        1628, 1628, 1184, 1184, 900, 900, 1825, 1825, 1019, 1019, 1825, 1825, 1825, 1825, 1825,
        1825, 1825, 1825, 1825, 1825, 1291, 1291, 1291, 1291, 1961, 1961, 1825, 1825, 1540, 1540,
        1540, 1540, 2096, 2096, 1825, 1825, 1688, 1688, 1688, 1688, 2277, 2277, 1825, 1825, 1885,
        1885, 1885, 1885, 543, 543, 1234, 1234, 766, 766, 1234, 1234, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
      ],
    },
  ],
  [
    'webdings',
    {
      ascent: 1638,
      descent: 410,
      advances: [
        1024, 2048, 2048, 2048, 2048, 2028, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 1100, 1100, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 1144, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 0, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2500, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 1377, 1377, 2048, 1726, 1058, 2048, 2048, 2048, 2048, 877,
        1240, 2048, 2048, 2048, 2048, 1357, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048,
        2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2645, 2048, 2048, 2048, 2048,
      ],
    },
  ],
]);

/** The face metrics for a symbol-encoded family, or undefined for any other family. */
export function symbolFaceMetrics(
  fontFamily: string | null | undefined
): SymbolFaceMetrics | undefined {
  if (!isSymbolEncodedFamily(fontFamily)) return undefined;
  return SYMBOL_FACE_METRICS.get(fontFamily!.toLowerCase());
}

/** Per-character advances at the run size, or undefined when one character is not a face byte. */
function faceAdvances(
  face: SymbolFaceMetrics,
  family: string,
  text: string,
  style: ResolvedRunStyle
): number[] | undefined {
  const scale =
    ((layoutRunHalfPointsOf(style) / 2) *
      glyphSizeFactorOf(style) *
      (style.horizontalScalePercent / 100)) /
    UNITS_PER_EM;
  const advances: number[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    const byte = symbolFaceByteOf(text.charCodeAt(offset), family);
    const units = byte === null ? 0 : (face.advances[byte - FIRST_BYTE] ?? 0);
    if (units === 0) return undefined;
    advances.push(units * scale + style.characterSpacingPt);
  }
  return advances;
}

/**
 * Wrap a fallback measurer so that unavailable symbol-encoded faces keep their own geometry.
 *
 * Only runs in one of the five families change, and only for what the table knows: line
 * metrics always, widths when every character is a mapped byte of the face. Every other run,
 * and every other text, measures exactly as the wrapped measurer would.
 */
export function withSymbolFaceMetrics(fallback: TextMeasurer): TextMeasurer {
  const faces = new WeakMap<ResolvedRunStyle, SymbolFaceMetrics | null>();
  const faceOf = (style: ResolvedRunStyle): SymbolFaceMetrics | null => {
    let face = faces.get(style);
    if (face === undefined) {
      face = symbolFaceMetrics(style.fontFamily) ?? null;
      faces.set(style, face);
    }
    return face;
  };
  return {
    ...fallback,
    measure(text, style) {
      const face = faceOf(style);
      const advances = face && faceAdvances(face, style.fontFamily!, text, style);
      if (!advances) return fallback.measure(text, style);
      let total = 0;
      for (const advance of advances) total += advance;
      return total;
    },
    caretAdvances(text, style) {
      const face = faceOf(style);
      const advances = face && faceAdvances(face, style.fontFamily!, text, style);
      if (!advances) return fallback.caretAdvances?.(text, style);
      const edges = [0];
      for (const advance of advances) edges.push(edges[edges.length - 1]! + advance);
      return edges;
    },
    lineMetrics(style, text) {
      const face = faceOf(style);
      if (!face) return fallback.lineMetrics(style, text);
      const sizePt = (layoutRunHalfPointsOf(style) / 2) * glyphSizeFactorOf(style);
      return {
        height: ((face.ascent + face.descent) * sizePt) / UNITS_PER_EM,
        baseline: (face.ascent * sizePt) / UNITS_PER_EM,
      };
    },
  };
}
