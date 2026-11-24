// Which compatibility rule applies in which mode, and with which options.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  MODE_RULES,
  PROFILE_RULES,
  compatibilityModeClass,
  hasCompatibilityRule,
  type ModeRuleName,
} from '../compatibility/compatibility-rules.ts';
import { compatibilityProfileFromSettings } from '../compatibility/compatibility-profile.ts';

test('mode values classify as legacy, modern or unlisted', () => {
  for (const value of [undefined, 11, 12, 14]) expect(compatibilityModeClass(value)).toBe('legacy');
  for (const value of [15, 15.5, 16, 17, 99, 9999])
    expect(compatibilityModeClass(value)).toBe('modern');
  for (const value of [0, 10, 13, 14.5, -1, NaN])
    expect(compatibilityModeClass(value)).toBe('unlisted');
});

/** Every mode rule and the class it applies in. A missing rule fails typecheck. */
const MODE_MATRIX = {
  anchorOnlyParagraphSeeding: 'modern',
  anchorOnlyParagraphWrapExclusion: 'modern',
  anchorsLayOutInCell: 'modern',
  cellFloatMovedDownIndents: 'modern',
  distributedLinesSpreadCharacters: 'legacy',
  fixedTableContentEdgeOrigin: 'legacy',
  rowExceptionAlignment: 'legacy',
  firstRowExceptionAlignsTable: 'modern',
  floatingTableContentOrigin: 'legacy',
  raisedFloatKeepsUnbalancedPlace: 'legacy',
  floatingTableOverlapMovesLeft: 'modern',
  headerFooterAnchorsWrapText: 'modern',
  headerRowsKeepWithBody: 'modern',
  justifiedSpaceShrink: 'modern',
  keepNextGivesTailLines: 'modern',
  legacyPercentTableContentWidth: 'legacy',
  legacySharedGridLineSideRules: 'legacy',
  legacySpacedFrameRuleCenters: 'legacy',
  modernBidiTableRuleShift: 'modern',
  modernGridLineSideRules: 'modern',
  noteTableCellKeeps: 'modern',
  oversizedRowKeepGroupReleases: 'legacy',
  positionedTableBreaksAtMargin: 'modern',
  omittedRepeatEndsPage: 'modern',
  pageBreakBeforeKeepsSpace: 'legacy',
  pageBreakLinesStretch: 'legacy',
  repeatBoundaryUsesHeaderRule: 'legacy',
  repeatKeepsWholeRow: 'legacy',
  repeatedHeaderYieldsToTerminalRule: 'modern',
  rowPageBreakYieldsToKeep: 'modern',
  tallRowStaysWhole: 'legacy',
  tableParagraphWidowControl: 'modern',
  vMergeTextMovesPastHeadRow: 'modern',
  wrappedAnchorsEndAtBottomMargin: 'modern',
  wrappedAnchorsEndOnSheet: 'legacy',
  wrappedAnchorsStayBelowTopMargin: 'modern',
  lineAnchorsBeforeBandPush: 'legacy',
  ownTableKeepsPageTopSpaceBefore: 'legacy',
  columnAlignmentFollowsIndents: 'legacy',
} as const satisfies Record<ModeRuleName, 'legacy' | 'modern'>;

test('each mode rule applies in exactly its class', () => {
  for (const [rule, mode] of Object.entries(MODE_MATRIX)) {
    for (const value of [undefined, 11, 12, 13, 14, 15, 16, 9999]) {
      expect([rule, value, hasCompatibilityRule(value, rule as ModeRuleName)]).toEqual([
        rule,
        value,
        compatibilityModeClass(value) === mode,
      ]);
    }
  }
});

test('every rule says what it does and where the construct is specified', () => {
  // `profile.has` tells the two registries apart by name, so no name may be in both.
  expect(Object.keys(MODE_RULES).filter((name) => Object.hasOwn(PROFILE_RULES, name))).toEqual([]);
  for (const rule of [...Object.values(MODE_RULES), ...Object.values(PROFILE_RULES)]) {
    expect(rule.behavior.length).toBeGreaterThan(0);
    expect(rule.source.length).toBeGreaterThan(0);
  }
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const URI = 'http://schemas.microsoft.com/office/word';
const setting = (name: string, value: string) =>
  `<w:compatSetting w:name="${name}" w:uri="${URI}" w:val="${value}"/>`;
function profile(compat: string) {
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:compat>${compat}</w:compat></w:settings>`,
    { name: '/word/settings.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return compatibilityProfileFromSettings(read.part.root);
}

const MODES: Record<string, string> = {
  absent: '',
  '11': setting('compatibilityMode', '11'),
  '12': setting('compatibilityMode', '12'),
  '13': setting('compatibilityMode', '13'),
  '14': setting('compatibilityMode', '14'),
  '15': setting('compatibilityMode', '15'),
  '16': setting('compatibilityMode', '16'),
  refused: setting('compatibilityMode', '14') + setting('compatibilityMode', '15'),
};
const EVERY_MODE = Object.keys(MODES);

/** Each option rule: the markup that turns it on, and the modes it then applies in. */
const PROFILE_MATRIX: Record<
  keyof typeof PROFILE_RULES,
  { options: string; on: readonly string[]; withoutOptions?: readonly string[] }
> = {
  // Only legacy modes read the option; mode 13 has no rules.
  noColumnBalance: {
    options: '<w:noColumnBalance/>',
    on: ['absent', '11', '12', '14', 'refused'],
  },
  adjustLineHeightInTable: { options: '<w:adjustLineHeightInTable/>', on: EVERY_MODE },
  doNotBreakWrappedTables: {
    options: '<w:doNotBreakWrappedTables/>',
    on: ['absent', '11', '12', '14', 'refused'],
  },
  fixedParagraphSpacing: { options: '<w:doNotUseHTMLParagraphAutoSpacing/>', on: EVERY_MODE },
  ignoreIndentAsNumberingTabStop: {
    options: '<w:doNotUseIndentAsNumberingTabStop/>',
    on: EVERY_MODE,
  },
  optionalLigatures: {
    options: setting('enableOpenTypeFeatures', '1'),
    on: EVERY_MODE,
    withoutOptions: ['15', '16'],
  },
  preserveExactLineBaseline: {
    options: '<w:noExtraLineSpacing/>',
    on: EVERY_MODE,
  },
  // Without the setting, mode 15 and later apply the table style over the default style.
  strictTableStyleHierarchy: {
    options: setting('overrideTableStyleFontSizeAndJustification', '1'),
    on: EVERY_MODE,
    withoutOptions: ['15', '16'],
  },
  // Modes 12 and 14 ignore the setting.
  textBesideBrokenFloatingTable: {
    options: setting('allowTextAfterFloatingTableBreak', '1'),
    on: ['15', '16'],
  },
  unstretchedManualBreakLines: { options: '<w:doNotExpandShiftReturn/>', on: EVERY_MODE },
};

test('each option rule applies with its option, in its modes', () => {
  for (const [rule, row] of Object.entries(PROFILE_MATRIX)) {
    const name = rule as keyof typeof PROFILE_RULES;
    for (const [mode, declaration] of Object.entries(MODES)) {
      expect([rule, mode, profile(declaration + row.options).has(name)]).toEqual([
        rule,
        mode,
        row.on.includes(mode),
      ]);
      expect([rule, mode, profile(declaration).has(name)]).toEqual([
        rule,
        mode,
        (row.withoutOptions ?? []).includes(mode),
      ]);
    }
  }
});

test('an explicit off table style setting keeps the legacy hierarchy in every mode', () => {
  for (const declaration of Object.values(MODES)) {
    const off = setting('overrideTableStyleFontSizeAndJustification', '0');
    expect(profile(declaration + off).has('strictTableStyleHierarchy')).toBe(false);
    // The last of several declarations decides.
    const on = setting('overrideTableStyleFontSizeAndJustification', '1');
    expect(profile(declaration + on + on + off).has('strictTableStyleHierarchy')).toBe(false);
  }
});

test('an explicit off or a duplicated OpenType setting turns ligatures off', () => {
  for (const declaration of Object.values(MODES)) {
    expect(
      profile(declaration + setting('enableOpenTypeFeatures', '0')).has('optionalLigatures')
    ).toBe(false);
    expect(
      profile(declaration + setting('enableOpenTypeFeatures', '1').repeat(2)).has(
        'optionalLigatures'
      )
    ).toBe(false);
  }
});

test('a profile answers mode rules from its own mode, and ignores unknown names', () => {
  for (const declaration of Object.values(MODES)) {
    const parsed = profile(declaration);
    for (const rule of Object.keys(MODE_MATRIX) as ModeRuleName[])
      expect(parsed.has(rule)).toBe(hasCompatibilityRule(parsed.modeValue, rule));
  }
  const hostile = profile(
    '<w:__proto__/>' + setting('constructor', '1') + setting('toString', '1')
  );
  expect(Object.keys(hostile.legacy)).toEqual([]);
  expect(Object.keys(hostile.settings)).toEqual([]);
  expect(profile(setting('compatibilityMode', 'x')).modeRefused).toBe(true);
  expect(profile('').modeRefused).toBe(false);
});
