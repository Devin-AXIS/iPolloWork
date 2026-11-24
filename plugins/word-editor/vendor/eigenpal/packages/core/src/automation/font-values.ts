// Exact Office.js to OOXML font value mappings. Unsupported domains refuse before mutation.
import type { OoxmlProperty } from '../store/store/tree-ops.ts';
import type { AutomationFontWrite, FormattingPlan } from './formatting.ts';

const UNDERLINES: Readonly<Record<string, string>> = Object.freeze({
  None: 'none',
  Single: 'single',
  Word: 'words',
  Double: 'double',
  Thick: 'thick',
  Dotted: 'dotted',
  DottedHeavy: 'dottedHeavy',
  DashLine: 'dash',
  DashLineHeavy: 'dashedHeavy',
  DashLineLong: 'dashLong',
  DashLineLongHeavy: 'dashLongHeavy',
  DotDashLine: 'dotDash',
  DotDashLineHeavy: 'dashDotHeavy',
  TwoDotDashLine: 'dotDotDash',
  TwoDotDashLineHeavy: 'dashDotDotHeavy',
  Wave: 'wave',
  WaveHeavy: 'wavyHeavy',
  WaveDouble: 'wavyDouble',
});
// Office color names differ from the OOXML ST_HighlightColor vocabulary.
const HIGHLIGHTS = [
  ['Yellow', 'yellow', '#FFFF00'],
  ['Lime', 'green', '#00FF00'],
  ['Turquoise', 'cyan', '#00FFFF'],
  ['Pink', 'magenta', '#FF00FF'],
  ['Blue', 'blue', '#0000FF'],
  ['Red', 'red', '#FF0000'],
  ['DarkBlue', 'darkBlue', '#000080'],
  ['Teal', 'darkCyan', '#008080'],
  ['Green', 'darkGreen', '#008000'],
  ['Purple', 'darkMagenta', '#800080'],
  ['DarkRed', 'darkRed', '#800000'],
  ['Olive', 'darkYellow', '#808000'],
  ['Gray', 'darkGray', '#808080'],
  ['LightGray', 'lightGray', '#C0C0C0'],
  ['Black', 'black', '#000000'],
  ['White', 'white', '#FFFFFF'],
] as const;

export function underlineName(value: string | null): string | null {
  return Object.entries(UNDERLINES).find(([, xml]) => xml === value)?.[0] ?? null;
}
export function highlightHex(value: string | null): string | null {
  return HIGHLIGHTS.find(([, xml]) => xml === value)?.[2] ?? null;
}
export function extendedFontProperties(
  request: AutomationFontWrite
): FormattingPlan<OoxmlProperty[]> {
  const properties: OoxmlProperty[] = [];
  if (request.underline !== undefined) {
    const value =
      typeof request.underline === 'string' && Object.hasOwn(UNDERLINES, request.underline)
        ? UNDERLINES[request.underline]
        : undefined;
    if (!value) return { ok: false, detail: 'underline: unsupported underline style' };
    properties.push({ localName: 'u', attributes: { val: value } });
  }
  if (request.strikeThrough !== undefined) {
    if (typeof request.strikeThrough !== 'boolean')
      return { ok: false, detail: 'strikeThrough: not a boolean' };
    properties.push({
      localName: 'strike',
      attributes: { val: request.strikeThrough ? '1' : '0' },
    });
  }
  for (const field of ['subscript', 'superscript'] as const) {
    if (request[field] !== undefined && typeof request[field] !== 'boolean')
      return { ok: false, detail: `${field}: not a boolean` };
  }
  if (request.subscript === true && request.superscript === true)
    return { ok: false, detail: 'subscript and superscript are mutually exclusive' };
  // Vertical alignment is resolved against each run by fontVerticalProperties.
  if (request.highlightColor !== undefined) {
    const color = request.highlightColor;
    const row =
      typeof color === 'string'
        ? HIGHLIGHTS.find(
            ([name, , hex]) =>
              name.toLowerCase() === color.toLowerCase() || hex === color.toUpperCase()
          )
        : undefined;
    if (color !== null && !row)
      return {
        ok: false,
        detail: 'highlightColor: use an exact Word palette color or null to clear',
      };
    properties.push({ localName: 'highlight', attributes: { val: row?.[1] ?? 'none' } });
  }
  return { ok: true, value: properties };
}
