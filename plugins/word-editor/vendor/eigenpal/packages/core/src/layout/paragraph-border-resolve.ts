// Cascade-aware `w:pBdr` resolution for the layout prepass.
//
// `resolveParagraphLayoutInputs` publishes the bottom edge only; placement needs all six.
// The "does any style declare pBdr?" probe is cached per cascade table so documents without
// style borders skip a second cascade walk on every paragraph.

import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  cascadedParagraphBorders,
  paragraphBorders,
  type ParagraphBorders,
} from './paragraph-style.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from './style-cascade.ts';

const cascadeBorderDeclarations = new WeakMap<StyleCascadeTable, boolean>();

function styleCascadeDeclaresBorders(table: StyleCascadeTable): boolean {
  const cached = cascadeBorderDeclarations.get(table);
  if (cached !== undefined) return cached;
  const declaresPBdr = (props: readonly OoxmlProperty[]): boolean =>
    props.some((property) => property.localName === 'pBdr');
  let declares = declaresPBdr(table.docDefaultsParagraph);
  if (!declares) {
    for (const style of table.styles.values()) {
      if (declaresPBdr(style.paragraphProperties)) {
        declares = true;
        break;
      }
    }
  }
  cascadeBorderDeclarations.set(table, declares);
  return declares;
}

/**
 * Resolve `w:pBdr` for one paragraph, through the style cascade when a style could contribute.
 *
 * Direct `w:pPr` is enough when no style in the table declares a border; otherwise the same
 * edge-by-edge `w:pBdr` cascade is walked for all six edges.
 */
export function resolveParagraphBorders(
  pPr: OoxmlNode | undefined,
  styleCascade: StyleCascadeTable | undefined
): ParagraphBorders {
  if (!styleCascade || !styleCascadeDeclaresBorders(styleCascade)) return paragraphBorders(pPr);
  return cascadedParagraphBorders(
    cascadeParagraphFormatting(styleCascade, pPr).paragraphPropertyNodes
  );
}
