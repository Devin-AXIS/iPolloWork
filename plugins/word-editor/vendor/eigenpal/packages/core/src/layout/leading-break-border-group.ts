// Border groups around a paragraph that opens with a page break.
//
// Paragraphs with identical borders draw one box (`w:between`, §17.3.1.24). A paragraph whose
// text follows a leading page break does not join the box above it: its text opens a box of
// its own on the next sheet, and the paragraph above closes its box with its bottom rule.
//
// The paragraph above closes before the paragraph below is broken into lines, so the group
// decision reads the display projection that those lines are broken from. It refuses every
// paragraph that placement refuses (`opensWithPageBreak`): an anchored drawing, nothing
// visible after the break, a text frame on either side. A table anchors at the next regular
// paragraph, so a paragraph after a regular paragraph never anchors one.

import type { OoxmlElement, OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import { paragraphModelTextOf } from '../store/store/paragraph-model-text.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { BodyPageFieldContext } from './field-page-furniture.ts';
import { piecesOfParagraphForDisplay } from './field-projection-walk.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import type { RefFieldContext } from './field-ref.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import { cascadeRunProperties } from './style-cascade.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import { extendedFlowKey } from './flow-key-intern.ts';

type PreparedParagraph = Extract<PreparedBlock, { kind: 'paragraph' }>;

/** The layout inputs that decide what a paragraph displays. */
export type LeadingBreakView = Pick<
  SemanticLayoutOptions,
  | 'displayMode'
  | 'revisionAuthorFilter'
  | 'showFieldCodes'
  | 'fieldCodeRanges'
  | 'styleCascade'
  | 'inlineDrawingLayout'
  | 'noteMarks'
  | 'documentProperties'
> & { readonly refFields?: RefFieldContext };

const holdsBreak = new WeakMap<OoxmlElement, boolean>();

/** Whether the model text holds a page break at all: the cheap test before the projection. */
function modelHoldsPageBreak(paragraph: OoxmlElement): boolean {
  const known = holdsBreak.get(paragraph);
  if (known !== undefined) return known;
  const holds = paragraphModelTextOf(paragraph as OoxmlParagraphNode).includes(PAGE_BREAK_CHAR);
  holdsBreak.set(paragraph, holds);
  return holds;
}

/** Stands in for a column break so it counts as something after the opening break. */
const COLUMN_BREAK_MARK = '\u000e';

/** One layout pass's group rule. The answers are memoized for that pass only. */
export function createLeadingBreakGroups(
  view: LeadingBreakView,
  bodyPageFields: BodyPageFieldContext
) {
  const memo = new Map<OoxmlElement, boolean>();
  const displayOpensWithBreak = (block: PreparedParagraph): boolean => {
    const { styleCascade } = view;
    const pieces = piecesOfParagraphForDisplay(
      block.paragraph,
      block.inheritedRunProperties,
      undefined,
      styleCascade
        ? (inherited, direct) => cascadeRunProperties(inherited, direct, styleCascade)
        : undefined,
      undefined,
      view.noteMarks,
      view.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
      undefined,
      view.inlineDrawingLayout,
      styleCascade?.themeFonts,
      undefined,
      view.documentProperties,
      bodyPageFields,
      view.refFields,
      view.revisionAuthorFilter,
      view.showFieldCodes,
      view.fieldCodeRanges?.get(block.paragraph.id)
    );
    // The same test `opensWithPageBreak` applies to the lines: the first line holds only the
    // break, and a later line holds text, a picture, or another page or column break.
    let text = '';
    for (const piece of pieces)
      text +=
        piece.inlineDrawing || piece.equation
          ? '\uFFFC'
          : piece.breakKind === 'column'
            ? COLUMN_BREAK_MARK
            : piece.text;
    // Only line breaks after the opening break leave it alone on its line. A line break
    // directly after it cancels the break (`page-break-before-line-break.ts`).
    const rest = text.slice(PAGE_BREAK_CHAR.length);
    return text.startsWith(PAGE_BREAK_CHAR) && !rest.startsWith('\n') && /[^\n]/.test(rest);
  };

  /** Whether a paragraph's display opens with a page break followed by content or a break. */
  const opensWithBreak = (block: PreparedParagraph): boolean => {
    if (block.frame || !modelHoldsPageBreak(block.paragraph)) return false;
    const known = memo.get(block.paragraph);
    if (known !== undefined) return known;
    const context = view.inlineDrawingLayout;
    const opens =
      !(context && anchoredDrawingAtomsInParagraph(block.paragraph, context).length > 0) &&
      displayOpensWithBreak(block);
    memo.set(block.paragraph, opens);
    return opens;
  };

  /** Whether `block` leaves the group it shares with `before` because it opens with a break. */
  const leaves = (before: PreparedBlock | undefined, block: PreparedBlock | undefined): boolean =>
    block?.kind === 'paragraph' &&
    block.borderGroupKey !== '' &&
    before?.kind === 'paragraph' &&
    before.borderGroupKey === block.borderGroupKey &&
    !before.frame &&
    opensWithBreak(block);

  return {
    /** Whether `block` continues the border group of the block before it. */
    joins: (before: PreparedBlock | undefined, block: PreparedBlock | undefined): boolean =>
      block?.kind === 'paragraph' &&
      block.borderGroupKey !== '' &&
      before?.kind === 'paragraph' &&
      before.borderGroupKey === block.borderGroupKey &&
      !leaves(before, block),
    /**
     * Whether placement may keep the leading break of `block`. A paragraph in a group takes
     * the rule only when it left the group, so the paragraph above and this one agree.
     */
    admits: (before: PreparedBlock | undefined, block: PreparedParagraph): boolean =>
      block.borderGroupKey === '' ||
      before?.kind !== 'paragraph' ||
      before.borderGroupKey !== block.borderGroupKey ||
      leaves(before, block),
    /**
     * Flow keys that also say when the next paragraph leaves the group by opening with a page
     * break. The border-group flow keys compare group identities only, and that change moves
     * this paragraph's closing rule without touching its own key.
     */
    flowKeys: (keys: string[], prepared: readonly PreparedBlock[]): string[] => {
      let flow = keys;
      for (let index = 0; index + 1 < prepared.length; index += 1) {
        if (!leaves(prepared[index], prepared[index + 1])) continue;
        if (flow === keys) flow = [...keys];
        flow[index] = extendedFlowKey(flow[index]!, '~lbg', '');
      }
      return flow;
    },
  };
}
