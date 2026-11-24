// The last step of a paragraph's field projection: field codes or buffered revision markup,
// then East Asian font slots.

import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import { displayFieldCodes } from './field-code-display.ts';
import type { FieldCodeRange } from './field-code-toc.ts';
import {
  applyEastAsiaFontSlots,
  type FieldAwarePiece,
  type MutableChangeSite,
} from './field-pieces.ts';
import type { RunPropertyCascader } from './field-run-text.ts';
import { projectBufferedRevisionMarkup } from './revision-markup-projection.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { ThemeFonts } from './run-style.ts';
import { applyHAnsiFontSlots } from './hansi-font-slots.ts';
import { applyComplexRunDigitFaces } from './complex-run-digits.ts';

/** Finish a walked paragraph's pieces for display. */
export function finishParagraphPieces(
  paragraph: OoxmlNode,
  pieces: FieldAwarePiece[],
  options: {
    readonly showFieldCodes: boolean;
    readonly inheritedRunProperties: readonly OoxmlProperty[];
    readonly cascadeRuns: RunPropertyCascader | undefined;
    readonly themeFonts: ThemeFonts | undefined;
    readonly displayMode: RevisionDisplayMode;
    readonly authorFilter: RevisionAuthorFilter | undefined;
    readonly fieldCodeRanges: readonly FieldCodeRange[] | undefined;
    readonly changeSites: MutableChangeSite[] | undefined;
    /** False when the walk stopped before buffering any revision markup. */
    readonly projectMarkup?: boolean;
  }
): FieldAwarePiece[] {
  const shown = options.showFieldCodes
    ? displayFieldCodes(
        paragraph,
        pieces,
        options.inheritedRunProperties,
        options.cascadeRuns,
        options.themeFonts,
        options.displayMode,
        options.authorFilter,
        options.fieldCodeRanges
      )
    : options.projectMarkup === false
      ? pieces
      : projectBufferedRevisionMarkup(
          pieces,
          paragraph,
          options.displayMode,
          options.authorFilter,
          options.changeSites
        );
  return applyComplexRunDigitFaces(
    applyHAnsiFontSlots(applyEastAsiaFontSlots(shown, options.themeFonts), options.themeFonts)
  );
}
