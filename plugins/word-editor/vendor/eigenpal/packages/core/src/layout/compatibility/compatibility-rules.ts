// Every layout behavior that depends on the Word compatibility mode or on a compatibility
// option, as a named rule. Layout asks `hasCompatibilityRule(compatibilityMode, 'name')` or
// `profile.has('name')` and never compares mode numbers itself; the
// `docx/no-raw-compatibility-mode` lint rule enforces that. See
// docs/architecture/compatibility-modes.md.

import type { CompatibilityProfile } from './compatibility-profile.ts';

/**
 * How a mode value lays out.
 *
 * - `legacy`: no declaration, 11, 12 or 14. Word lays out a document without a declaration
 *   as one that declares 12, the [MS-DOCX] default.
 * - `modern`: 15 and every value above it. Word lays out 16, 17, 99 and 9999 as 15.
 * - `unlisted`: any other value, such as 13, which Word reports as unreadable content. No
 *   rule applies.
 */
export type CompatibilityModeClass = 'legacy' | 'modern' | 'unlisted';

/** The class of a threaded mode value; `undefined` is an absent or refused declaration. */
export function compatibilityModeClass(value: number | undefined): CompatibilityModeClass {
  if (value === undefined || value === 11 || value === 12 || value === 14) return 'legacy';
  return value >= 15 ? 'modern' : 'unlisted';
}

interface Rule {
  /** What layout does when the rule applies. */
  readonly behavior: string;
  /** The specification section of the construct the rule acts on. */
  readonly source: string;
}

interface ModeRule extends Rule {
  readonly mode: 'legacy' | 'modern';
}

interface ProfileRule extends Rule {
  readonly applies: (profile: CompatibilityProfile) => boolean;
}

const modern = (behavior: string, source: string): ModeRule => ({
  mode: 'modern',
  behavior,
  source,
});
const legacy = (behavior: string, source: string): ModeRule => ({
  mode: 'legacy',
  behavior,
  source,
});

/** Rules that depend only on the mode. */
export const MODE_RULES = {
  autofitMinimumSkipsFirstLine: legacy(
    'An autofit column minimum leaves out a positive first-line indent: a word too wide for the first line breaks there',
    'ECMA-376 Part 1 §17.3.1.12 ind'
  ),
  autofitMinimumHyphenatesWords: modern(
    'With automatic hyphenation on, an autofit column minimum lets a word break between letters; legacy modes keep each word whole',
    'ECMA-376 Part 1 §17.15.1.10 autoHyphenation'
  ),
  autofitRefitsNestedCells: modern(
    'A nested autofit table whose stated cell widths pass its room gives way above each column content minimum',
    'ECMA-376 Part 1 §17.4.64 tblLayout'
  ),
  anchorOnlyParagraphSeeding: modern(
    'Seed the pages of consecutive anchor-only paragraphs before later bands wrap earlier text',
    'ECMA-376 Part 1 §20.4.2.3 anchor'
  ),
  anchorOnlyParagraphWrapExclusion: modern(
    'Anchor-only paragraphs and leading paragraph-relative anchors resolve their own wrap before first-fragment placement',
    'ECMA-376 Part 1 §20.4.2.3 anchor'
  ),
  anchorsLayOutInCell: modern(
    'Every anchored object in a table cell lays out in its cell; none is out of cell',
    'ECMA-376 Part 1 §20.4.2.3 anchor (layoutInCell)'
  ),
  distributedLinesSpreadCharacters: legacy(
    'A distributed paragraph spreads the slack of every line after every character, whatever the document defaults and run kerning. A space first takes up to its face average character width less its own advance',
    'ECMA-376 Part 1 §17.18.44 ST_Jc'
  ),
  fixedTableContentEdgeOrigin: legacy(
    'A table with an absolute width aligns the content edge of its aligned outer cell with the text column, with or without cell spacing; a leading alignment without a stated indent or table style keeps the outer edge',
    'ECMA-376 Part 1 §17.4.52 tblLayout'
  ),
  rowExceptionAlignment: legacy(
    "A table row places itself by its own w:tblPrEx alignment; a trailing-aligned row ends past the text edge by its first cell's leading margin",
    'ECMA-376 Part 1 §17.4.61 tblPrEx'
  ),
  firstRowExceptionAlignsTable: modern(
    "The first row's w:tblPrEx alignment aligns the whole table; later rows' alignments do not apply",
    'ECMA-376 Part 1 §17.4.61 tblPrEx'
  ),
  floatingTableContentOrigin: legacy(
    'A floating table with a numeric offset or a left, inside, right, or outside alignment positions its cell content, not its outer edge',
    'ECMA-376 Part 1 §17.4.57 tblpPr'
  ),
  floatingTableBandHoldsSpaceAfter: legacy(
    'The last line of a paragraph and its space after must both clear a floating table band; later modes test the line alone',
    'ECMA-376 Part 1 §17.4.57 tblpPr'
  ),
  raisedFloatKeepsUnbalancedPlace: legacy(
    'A text-anchored floating table raised above its anchor in balanced section columns keeps its place from the unbalanced layout',
    'ECMA-376 Part 1 §17.4.57 tblpPr'
  ),
  floatingTableOverlapMovesLeft: modern(
    'A floating table that may not overlap moves left of the table it meets when the right side has no room',
    'ECMA-376 Part 1 §17.4.56 tblOverlap'
  ),
  cellFloatMovedDownIndents: modern(
    'A floating table in a table cell that moves below an earlier one also moves right by its own left text distance',
    'ECMA-376 Part 1 §17.4.56 tblOverlap'
  ),
  headerFooterAnchorsWrapText: modern(
    'Header and footer text outside tables wraps around anchored objects',
    'ECMA-376 Part 1 §20.4.2.3 anchor'
  ),
  headerRowsKeepWithBody: modern(
    'Header rows keep with the opening body rows; the table starts on the next page if both do not fit',
    'ECMA-376 Part 1 §17.4.49 tblHeader'
  ),
  justifiedSpaceShrink: modern(
    'Justified lines may shrink spaces to fit one more word',
    'ECMA-376 Part 1 §17.3.1.13 jc'
  ),
  balancedSpaceShrink: modern(
    'With balanced single-byte and double-byte widths, a space at the balanced width keeps it when justified and distributed lines shrink their spaces',
    'ECMA-376 Part 1 §17.15.3.3 balanceSingleByteDoubleByteWidth'
  ),
  keepNextGivesTailLines: modern(
    'A keep-with-next paragraph that fits whole gives its last lines to the next page with its successor',
    'ECMA-376 Part 1 §17.3.1.15 keepNext'
  ),
  legacyPercentTableContentWidth: legacy(
    'A top-level percent-width table resolves its width against the legacy content width',
    'ECMA-376 Part 1 §17.4.63 tblW'
  ),
  legacySharedGridLineSideRules: legacy(
    'Collapsed side rules center on shared grid lines for every simple table, in either direction; a percent width keeps the legacy reference box',
    'ECMA-376 Part 1 §17.4.38 tblBorders'
  ),
  legacySpacedFrameRuleCenters: legacy(
    'A spaced table aligns the centers of its outer frame rules; later modes align their outer edges',
    'ECMA-376 Part 1 §17.4.38 tblBorders'
  ),
  modernBidiTableRuleShift: modern(
    'A right-to-left table sits half its mean outer side rule toward its visual left',
    'ECMA-376 Part 1 §17.4.1 bidiVisual'
  ),
  modernGridLineSideRules: modern(
    'Side rules center on grid lines for covered dxa/auto shapes and one-rule percent widths; edge-aligned grids move by half a rule',
    'ECMA-376 Part 1 §17.4.38 tblBorders'
  ),
  noteAreaHoldsLineSpacing: modern(
    'Auto line spacing below a body line must fit above the footnote area; legacy modes let it cross the area as it crosses a bottom margin',
    'ECMA-376 Part 1 §17.11 Footnotes and Endnotes'
  ),
  noteAreaHoldsSpaceAfter: modern(
    'A paragraph space after must fit above the footnote area; legacy modes let a paragraph that cites no footnote cross the area as it crosses a bottom margin',
    'ECMA-376 Part 1 §17.11 Footnotes and Endnotes'
  ),
  noteTableCellKeeps: modern(
    'Note reference bands in table rows honor cell widow control and keep-lines cuts',
    'ECMA-376 Part 1 §17.11 Footnotes and Endnotes'
  ),
  openingColumnBreakTakesNoLine: legacy(
    'A column break that opens a paragraph leaves no line in the column it ends',
    'ECMA-376 Part 1 §17.3.3.1 br'
  ),
  inlineObjectStaysBesideFloat: legacy(
    'An inline object that opens its line stays on it beside a float even when it is wider than the gap there, and runs past the margin or over the float. In modern modes it moves below the float',
    'ECMA-376 Part 1 §20.4.2.3 anchor'
  ),
  leftTabStopsPastMargin: legacy(
    'A custom left tab stop past the margin is honoured, and the text after it may run past the margin. In modern modes the stop reaches the margin and its text wraps there',
    'ECMA-376 Part 1 §17.3.1.37 tabs'
  ),
  oversizedRowKeepGroupReleases: legacy(
    'A kept row group that exceeds a fresh page starts beside preceding content, except directly below authored headers',
    'ECMA-376 Part 1 §17.3.1.15 keepNext'
  ),
  lineEndPunctuationAtEveryAlignment: legacy(
    'Line-end East Asian punctuation hangs past the margin at every paragraph alignment, and the text before it fills the measure. The paragraph kinsoku switch does not stop it. Modern modes hang only in justified and distributed paragraphs',
    'ECMA-376 Part 1 §17.3.1.21 overflowPunct'
  ),
  koreanHangingLineFills: modern(
    'A Korean paragraph-final mark that hangs past the margin lets the text before it fill the measure. Earlier modes keep that last line at its natural width',
    'ECMA-376 Part 1 §17.3.1.21 overflowPunct'
  ),
  largestWrapTieLeft: modern(
    'Square wrapping on the largest side keeps text on the physical left when both sides are equally wide; earlier modes keep it on the right',
    'ECMA-376 Part 1 §20.4.2.17 wrapSquare'
  ),
  wrapIgnoresMultipleSpacingExtra: modern(
    'A wrap band moves a line only where it crosses the text or picture of the line, not the extra space an auto line-spacing multiple adds below it',
    'ECMA-376 Part 1 §17.3.1.33 spacing'
  ),
  positionedTableBreaksAtMargin: modern(
    'A page- or margin-positioned table that breaks ends its first fragment at the bottom margin, not the page edge',
    'ECMA-376 Part 1 §17.4.57 tblpPr'
  ),
  omittedRepeatEndsPage: modern(
    'Content after a table whose last page leaves out the repeated header rows starts on the next page',
    'ECMA-376 Part 1 §17.4.49 tblHeader'
  ),
  pageBreakBeforeKeepsSpace: legacy(
    'A paragraph with a page break before keeps its space before at the top of the new page. In modern modes only the first block of a section keeps it',
    'ECMA-376 Part 1 §17.3.1.23 pageBreakBefore'
  ),
  pageBreakLinesStretch: legacy(
    'A justified line that ends in a page or column break stretches to the measure, unless it is the last line of its paragraph',
    'ECMA-376 Part 1 §17.3.3.1 br'
  ),
  repeatBoundaryUsesHeaderRule: legacy(
    "A complete body row directly below a repeated header row reserves the wider of its own top border and the header row's bottom border; modern modes keep the band of the row it follows in the table",
    'ECMA-376 Part 1 §17.4.49 tblHeader'
  ),
  repeatKeepsWholeRow: legacy(
    'Repeated header rows stay above a row that cannot split and does not fit below them, or a row whose first line, or the first row of a nested table that opens a cell, does not fit below them, also when the row continues from the previous page; the row stays whole and runs past the bottom margin',
    'ECMA-376 Part 1 §17.4.49 tblHeader'
  ),
  repeatedHeaderYieldsToTerminalRule: modern(
    'Repeated header rows are omitted when the last fixed-height row fits below them only without its bottom rule',
    'ECMA-376 Part 1 §17.4.49 tblHeader'
  ),
  rowPageBreakYieldsToKeep: modern(
    'A row with a page break does not start a page when the row before it keeps with it',
    'ECMA-376 Part 1 §17.3.1.15 keepNext'
  ),
  tallRowStaysWhole: legacy(
    'A row that cannot split and is taller than a page stays whole on its page and runs past the bottom margin',
    'ECMA-376 Part 1 §17.4.6 cantSplit'
  ),
  tableParagraphWidowControl: modern(
    'Paragraphs that split inside table cells apply widow and orphan control',
    'ECMA-376 Part 1 §17.3.1.44 widowControl'
  ),
  vMergeTextMovesPastHeadRow: modern(
    'Merged cell text moves whole into the next row when the head row cannot hold it',
    'ECMA-376 Part 1 §17.4.84 vMerge'
  ),
  wrappedAnchorsEndAtBottomMargin: modern(
    'A wrapping object positioned from its paragraph or line moves up to end at the bottom margin. When that would lift it above its line, the line moves to the next page, and an object that still crosses the margin there ends the page. In a table cell, the row splits before that line',
    'ECMA-376 Part 1 §20.4.2.11 positionV'
  ),
  wrappedAnchorsEndOnSheet: legacy(
    'A wrapping object positioned from its paragraph or line moves up to end at the bottom page edge, and never above the top page edge. A row whose cell object would cross the bottom margin moves to the next page',
    'ECMA-376 Part 1 §20.4.2.11 positionV'
  ),
  columnAlignmentFollowsIndents: legacy(
    'An object aligned left or right in its column aligns with the left or right indent of its anchor paragraph',
    'ECMA-376 Part 1 §20.4.2.10 positionH'
  ),
  lineAnchorsBeforeBandPush: legacy(
    'An object positioned from the first line of a paragraph measures from where that line was before a wrapping band above pushed it down',
    'ECMA-376 Part 1 §20.4.2.11 positionV'
  ),
  wrappedAnchorsStayBelowTopMargin: modern(
    'A wrapping object positioned from its paragraph never starts above the top margin',
    'ECMA-376 Part 1 §20.4.2.11 positionV'
  ),
  ownTableKeepsPageTopSpaceBefore: legacy(
    'A paragraph at the top of a page keeps its space before when a floating table it anchors covers the top of the text area',
    'ECMA-376 Part 1 §17.4.57 tblpPr'
  ),
} as const satisfies Record<string, ModeRule>;

/** Rules that read compatibility options, so they need the parsed settings. */
export const PROFILE_RULES = {
  noColumnBalance: {
    behavior:
      'Fill text columns in source order without balancing a section. Only legacy modes read the option',
    source: 'ECMA-376 Part 4 §14.8.3.27 noColumnBalance',
    applies: (p) => p.legacy.noColumnBalance === true && p.modeClass === 'legacy',
  },
  adjustLineHeightInTable: {
    behavior: 'Paragraphs in table cells snap to the section line grid',
    source: 'ECMA-376 Part 1 §17.15.3.1 adjustLineHeightInTable',
    applies: (p) => p.legacy.adjustLineHeightInTable === true,
  },
  doNotBreakWrappedTables: {
    behavior:
      'A floating table never breaks across pages, and moves up onto the sheet when it passes the bottom edge. Only legacy modes read the option',
    source: 'ECMA-376 Part 4 §14.8.3.10 doNotBreakWrappedTables',
    applies: (p) => p.legacy.doNotBreakWrappedTables === true && p.modeClass === 'legacy',
  },
  fixedParagraphSpacing: {
    behavior:
      'Adjacent paragraph spacing adds up, and automatic spacing keeps the authored measurement',
    source: 'ECMA-376 Part 4 §14.8.3.15 doNotUseHTMLParagraphAutoSpacing',
    applies: (p) => p.legacy.doNotUseHTMLParagraphAutoSpacing === true,
  },
  ignoreIndentAsNumberingTabStop: {
    behavior: 'A numbering suffix tab ignores the hanging indent as a tab stop',
    source: 'ECMA-376 Part 4 §14.8.3.16 doNotUseIndentAsNumberingTabStop',
    applies: (p) => p.legacy.doNotUseIndentAsNumberingTabStop === true,
  },
  optionalLigatures: {
    behavior:
      'Optional OpenType ligatures apply: as `enableOpenTypeFeatures` says, else in modern modes. A duplicated setting turns them off',
    source: '[MS-DOCX] enableOpenTypeFeatures',
    applies: (p) => {
      const declared = p.settings.enableOpenTypeFeatures;
      return declared === 'ambiguous' ? false : (declared ?? p.modeClass === 'modern');
    },
  },
  pageBreakMarkOnNextPage: {
    behavior:
      'A paragraph mark after a page break takes a line at the top of the next page. Only legacy modes read the option',
    source: 'ECMA-376 Part 4 §14.8.3 splitPgBreakAndParaMark',
    applies: (p) => p.legacy.splitPgBreakAndParaMark === true && p.modeClass === 'legacy',
  },
  preserveExactLineBaseline: {
    behavior:
      'With `w:noExtraLineSpacing`, an exact-height line keeps the face baseline in every compatibility mode, also a refused one',
    source: 'ECMA-376 Part 4 §14.8.3.28 noExtraLineSpacing',
    applies: (p) => p.legacy.noExtraLineSpacing === true,
  },
  strictTableStyleHierarchy: {
    behavior:
      'Table style font size and justification apply over the default paragraph style. Without the setting, compatibility mode 15 and later behave so too',
    source: '[MS-DOCX] 2.3.1 overrideTableStyleFontSizeAndJustification',
    applies: (p) => {
      const setting = p.settings.overrideTableStyleFontSizeAndJustification;
      return setting === undefined ? p.modeClass === 'modern' : setting === true;
    },
  },
  textBesideBrokenFloatingTable: {
    behavior:
      'Text after a text-anchored floating table that breaks across pages starts beside its first fragment, and every fragment wraps text. Only modern modes read the setting',
    source: '[MS-DOCX] 2.3.1 allowTextAfterFloatingTableBreak',
    applies: (p) =>
      p.settings.allowTextAfterFloatingTableBreak === true && p.modeClass === 'modern',
  },
  unstretchedManualBreakLines: {
    behavior:
      'A justified line that ends in a manual line break keeps its natural spacing, as a last line does. A distributed line still stretches',
    source: 'ECMA-376 Part 4 §14.8.3 doNotExpandShiftReturn',
    applies: (p) => p.legacy.doNotExpandShiftReturn === true,
  },
} as const satisfies Record<string, ProfileRule>;

export type ModeRuleName = keyof typeof MODE_RULES;
/** Any registered rule. A typo or an unregistered rule fails typecheck. */
export type CompatibilityRuleName = ModeRuleName | keyof typeof PROFILE_RULES;

/** Whether a mode rule applies to the threaded `compatibilityMode` value. */
export function hasCompatibilityRule(
  compatibilityMode: number | undefined,
  rule: ModeRuleName
): boolean {
  return MODE_RULES[rule].mode === compatibilityModeClass(compatibilityMode);
}
