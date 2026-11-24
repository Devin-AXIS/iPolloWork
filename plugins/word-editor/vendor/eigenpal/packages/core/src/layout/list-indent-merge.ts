// How a numbering level's indent merges with the paragraph's own and its style's.

import { readTwipsMeasure } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { MAX_LEVEL_INDENT_PT, type NumberingLevelIndent } from './numbering-index.ts';
import { paragraphIndent } from './paragraph-flow.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';

/** Bound a file-derived indent both ways — negative is legal, unbounded is not. */
function clampIndentPt(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  if (pt > MAX_LEVEL_INDENT_PT) return MAX_LEVEL_INDENT_PT;
  if (pt < -MAX_LEVEL_INDENT_PT) return -MAX_LEVEL_INDENT_PT;
  return pt;
}

/** The first-line slot as one `w:ind` states it, or null when it states neither spelling. */
function firstLineOffsetOf(
  props: readonly OoxmlProperty[]
): { hanging: number; firstLine: number } | null {
  let found: { hanging: number; firstLine: number } | null = null;
  for (const property of props) {
    if (property.localName !== 'ind') continue;
    const h = property.attributes?.hanging;
    const f = property.attributes?.firstLine;
    // Mutually exclusive (§17.3.1.10, §17.3.1.12): one signed first-line offset, two spellings,
    // so an `w:ind` stating either replaces both. `w:firstLine` is read SIGNED because Word
    // keeps a negative value as a hang. A bare `w:left` states neither and leaves them alone.
    if (h === undefined && f === undefined) continue;
    const hanging = readTwipsMeasure(h);
    const firstLine = readTwipsMeasure(f);
    found = {
      hanging: hanging !== null && hanging >= 0 ? clampIndentPt(hanging / 20) : 0,
      firstLine: firstLine !== null ? clampIndentPt(firstLine / 20) : 0,
    };
  }
  return found;
}

/** Whether any `w:ind` in the list states the leading indent (`w:left` or `w:start`). */
function statesLeading(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'ind' &&
      (property.attributes?.left !== undefined || property.attributes?.start !== undefined)
  );
}

/** Whether any `w:ind` in the list states the trailing indent (`w:right` or `w:end`). */
function statesTrailing(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'ind' &&
      (property.attributes?.right !== undefined || property.attributes?.end !== undefined)
  );
}

/** Whether any `w:ind` in the list states the physical left side in this direction. */
function statesLeft(props: readonly OoxmlProperty[], rtl: boolean): boolean {
  return rtl ? statesTrailing(props) : statesLeading(props);
}

function statesRight(props: readonly OoxmlProperty[], rtl: boolean): boolean {
  return rtl ? statesLeading(props) : statesTrailing(props);
}

/**
 * The effective indent of a list paragraph: `inherited`, then the numbering LEVEL, then
 * `direct`, per attribute.
 *
 * A level's `w:pPr/w:ind` applies per attribute between the two tiers, and the ordering
 * matters on real documents. A converted agreement numbers its `(a)` items with a level
 * stating `left=1512 hanging=738` under a `ListParagraph` style stating
 * `left=775 hanging=624`, and states only `hanging="737"` on the paragraph itself. Reading
 * the flattened cascade as "the paragraph's indent" gave the STYLE's 775 to a level that had
 * overridden it, so every lettered sub-item hung a full indent step to the left of where
 * Word puts it.
 *
 * `inherited` is what the level outranks and `direct` is what outranks it. When the
 * paragraph's own `w:pPr` states a `w:numPr`, these are the style chain (after the document
 * defaults) and that `w:pPr`. Otherwise the level sits directly below the nearest style that
 * states a `w:numPr`: that style, the styles based on it and the paragraph's own `w:pPr` go
 * in `direct`, and the defaults and that style's bases go in `inherited`.
 */
export function mergeListIndent(
  levelIndent: NumberingLevelIndent,
  inherited: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[] = []
): NumberingLevelIndent {
  const rtl = paragraphIsRtl([...inherited, ...direct]);
  const direction: OoxmlProperty = { localName: 'bidi', attributes: { val: rtl ? '1' : '0' } };
  // A level's `left`/`right` are its leading and trailing indents (`w:left` or `w:start`,
  // `w:right` or `w:end`); a right-to-left paragraph puts the leading one on the right.
  if (rtl) {
    levelIndent = {
      ...levelIndent,
      left: levelIndent.right,
      right: levelIndent.left,
      ...(levelIndent.stated
        ? {
            stated: {
              ...levelIndent.stated,
              left: levelIndent.stated.right,
              right: levelIndent.stated.left,
            },
          }
        : {}),
    };
  }
  // A level built by hand (a unit test, not a file) carries no presence record; it then
  // states nothing and the style still wins, which is the behaviour those callers had.
  const levelStates = levelIndent.stated ?? {
    left: false,
    right: false,
    firstLineOffset: false,
  };
  const inheritedIndent = paragraphIndent([...inherited, direction]);
  const directIndent = paragraphIndent([...direct, direction]);
  const levelOffset = { hanging: levelIndent.hanging, firstLine: levelIndent.firstLine };

  const left = statesLeft(direct, rtl)
    ? directIndent.left
    : levelStates.left
      ? levelIndent.left
      : statesLeft(inherited, rtl)
        ? inheritedIndent.left
        : levelIndent.left;
  const right = statesRight(direct, rtl)
    ? directIndent.right
    : levelStates.right
      ? levelIndent.right
      : statesRight(inherited, rtl)
        ? inheritedIndent.right
        : levelIndent.right;
  const firstLineOffset =
    firstLineOffsetOf(direct) ??
    (levelStates.firstLineOffset ? levelOffset : (firstLineOffsetOf(inherited) ?? levelOffset));

  return { left, right, ...firstLineOffset };
}
