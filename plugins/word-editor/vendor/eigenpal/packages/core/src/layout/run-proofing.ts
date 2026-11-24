// Proofing settings of one run, through the same style cascade as layout: `w:vanish` hides
// the text from a reader, `w:noProof` asks proofing tools to skip it, and `w:lang` names the
// language to check it in. Complex-script text (`w:rtl` or `w:cs`) checks in `w:bidi`, and
// East Asian characters check in `w:eastAsia`, split by the classifier that picks the East
// Asian font slot.

import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import { runPropertiesOf } from './field-run-text.ts';
import { resolveRunStyle } from './run-style.ts';
import { eastAsiaRunsOfSegments } from './script-itemization.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';

/** What a proofing tool needs to know about one run. @internal */
export interface RunProofing {
  /** The run is hidden text (`w:vanish`), so a reader does not see it. */
  readonly hidden: boolean;
  /** Proofing tools skip the run (`w:noProof`). */
  readonly noProof: boolean;
  /**
   * The language tag to check the run's non-East Asian text in, or null when no level of the
   * cascade sets one. Complex-script runs (`w:rtl` or `w:cs`) use `w:bidi`, else `w:val`.
   */
  readonly lang: string | null;
  /**
   * The language tag for East Asian characters (`w:eastAsia`), or null when no level sets
   * one. A complex-script run uses {@link RunProofing.lang} for every character.
   */
  readonly eastAsiaLang: string | null;
}

const OFF = new Set(['0', 'false', 'off']);

function isOn(property: OoxmlProperty): boolean {
  const value = property.attributes?.val;
  return value === undefined || !OFF.has(String(value).toLowerCase());
}

function languageTag(value: unknown): string | null {
  // A tag is short ASCII; anything else from the file is not a language tag.
  return typeof value === 'string' && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}$/.test(value)
    ? value
    : null;
}

/**
 * Proofing settings of a run in `paragraph`, read through the document styles. A paragraph in
 * a table cell passes the cell's table style formatting, which sits below the paragraph style,
 * as it does in layout. @internal
 */
export function createRunProofingReader(
  styles: StyleCascadeTable | undefined
): (paragraph: OoxmlNode, run: OoxmlNode, cellStyle?: TableCellStyleFormatting) => RunProofing {
  let inheritedFor: OoxmlNode | undefined;
  let inheritedCell: TableCellStyleFormatting | undefined;
  let inherited: readonly OoxmlProperty[] = [];
  const cascade = styles
    ? (base: readonly OoxmlProperty[], direct: readonly OoxmlProperty[]) =>
        cascadeRunProperties(base, direct, styles)
    : undefined;
  return (paragraph, run, cellStyle) => {
    if (inheritedFor !== paragraph || inheritedCell !== cellStyle) {
      inheritedFor = paragraph;
      inheritedCell = cellStyle;
      const pPr =
        paragraph.kind === 'textValue'
          ? undefined
          : paragraph.children.find((child) => child.kind === 'paragraphProperties');
      inherited = styles ? cascadeParagraphFormatting(styles, pPr, cellStyle).runProperties : [];
    }
    const props = runPropertiesOf(run, inherited, cascade);
    let noProof = false;
    let rtl = false;
    let cs = false;
    let latin: string | null = null;
    let eastAsia: string | null = null;
    let bidi: string | null = null;
    // Later levels of the cascade come later in the list, so the last value wins: a direct
    // `w:rtl w:val="0"` turns off a style's `w:rtl`.
    for (const property of props) {
      if (property.localName === 'noProof') noProof = isOn(property);
      else if (property.localName === 'rtl') rtl = isOn(property);
      else if (property.localName === 'cs') cs = isOn(property);
      else if (property.localName === 'lang') {
        latin = languageTag(property.attributes?.val) ?? latin;
        eastAsia = languageTag(property.attributes?.eastAsia) ?? eastAsia;
        bidi = languageTag(property.attributes?.bidi) ?? bidi;
      }
    }
    const complex = rtl || cs;
    const lang = complex ? (bidi ?? latin) : latin;
    return {
      hidden: resolveRunStyle(props).hidden,
      noProof,
      lang,
      eastAsiaLang: complex ? lang : eastAsia,
    };
  };
}

/**
 * The `[from, to)` ranges of `text` that are East Asian text, classified as one paragraph by
 * the same rule that picks the East Asian font slot. @internal
 */
export function eastAsianTextRanges(
  text: string
): readonly { readonly from: number; readonly to: number }[] {
  return eastAsiaRunsOfSegments([text]).map(({ from, to }) => ({ from, to }));
}
