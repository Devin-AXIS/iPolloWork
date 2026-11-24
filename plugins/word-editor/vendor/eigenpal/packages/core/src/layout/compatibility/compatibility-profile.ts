// A document's compatibility profile, read once from `settings.xml`: the declared mode and the
// compatibility options that layout rules read.
//
// The mode is `w:compat/w:compatSetting` with `w:name="compatibilityMode"` and the Word URI
// ([MS-DOCX] 2.3.5). [MS-DOCX] defines 11 (Word 2003), 12 (Word 2007, the default), 14 (Word
// 2010) and 15 (Word 2013 and later); it covers Word 2007 through LTSC 2024 and defines no
// value above 15, and `WdCompatibilityMode` ends at `wdWord2013 = 15`. Word 2010 ignores 15
// ([MS-DOCX] Appendix B note 13). For how each value lays out, see `compatibilityModeClass`.
//
// The file is attacker-controlled. The walk visits each `w:compat` child once, accepts a mode
// of at most four digits, and keys results only by the names below, never by file strings.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  MODE_RULES,
  PROFILE_RULES,
  compatibilityModeClass,
  type CompatibilityModeClass,
  type CompatibilityRuleName,
  type ModeRuleName,
} from './compatibility-rules.ts';

const WORD_URI = 'http://schemas.microsoft.com/office/word';

/**
 * How each option is read, as the reader it replaced read it. `on-or-missing`: a missing value
 * or `1`, `true`, `on`. `not-off`: anything but `0`, `false`, `off`. `explicit-on`: only `1`,
 * `true`, `on`. Repeats: `last` occurrence wins, only the `first` occurrence in the first
 * `w:compat` counts, or a second occurrence makes the setting `ambiguous`.
 */
type Reading = readonly ['on-or-missing' | 'not-off' | 'explicit-on', 'last' | 'first' | 'refuse'];

/** `w:compat` children (ECMA-376 Part 1 §17.15.3 and Part 4 §14.8.3) that rules read. */
const LEGACY_OPTIONS = {
  adjustLineHeightInTable: ['not-off', 'last'],
  doNotBreakWrappedTables: ['on-or-missing', 'first'],
  doNotExpandShiftReturn: ['on-or-missing', 'last'],
  doNotUseHTMLParagraphAutoSpacing: ['on-or-missing', 'first'],
  doNotUseIndentAsNumberingTabStop: ['on-or-missing', 'first'],
  noColumnBalance: ['on-or-missing', 'last'],
  noExtraLineSpacing: ['on-or-missing', 'last'],
  splitPgBreakAndParaMark: ['on-or-missing', 'last'],
} as const satisfies Record<string, Reading>;

/** Word `w:compatSetting`s ([MS-DOCX] 2.3) that rules read. */
const WORD_SETTINGS = {
  allowTextAfterFloatingTableBreak: ['explicit-on', 'last'],
  enableOpenTypeFeatures: ['explicit-on', 'refuse'],
  overrideTableStyleFontSizeAndJustification: ['explicit-on', 'last'],
} as const satisfies Record<string, Reading>;

type LegacyOption = keyof typeof LEGACY_OPTIONS;
type WordSetting = keyof typeof WORD_SETTINGS;
const LEGACY_READINGS: ReadonlyMap<string, Reading> = new Map(Object.entries(LEGACY_OPTIONS));
const SETTING_READINGS: ReadonlyMap<string, Reading> = new Map(Object.entries(WORD_SETTINGS));

export interface CompatibilityProfile {
  /** The mode layout threads as `compatibilityMode`; `undefined` when absent or refused. */
  readonly modeValue: number | undefined;
  readonly modeClass: CompatibilityModeClass;
  /** A mode was declared but is duplicated or malformed, so no value is used. */
  readonly modeRefused: boolean;
  readonly legacy: Readonly<Partial<Record<LegacyOption, boolean>>>;
  readonly settings: Readonly<Partial<Record<WordSetting, boolean | 'ambiguous'>>>;
  has(rule: CompatibilityRuleName): boolean;
}

function attribute(element: OoxmlElement, name: string): string | undefined {
  return element.attributes.find(
    (item) => item.namespaceUri === WML_NAMESPACE_URI && item.localName === name
  )?.value;
}

function onOff(raw: string | undefined, reading: Reading[0]): boolean {
  if (reading === 'not-off') return raw === undefined || !['0', 'false', 'off'].includes(raw);
  if (raw === undefined) return reading === 'on-or-missing';
  return raw === '1' || raw === 'true' || raw === 'on';
}

/** Parse a settings root, or `null` for a document without one. */
export function compatibilityProfileFromSettings(root: OoxmlElement | null): CompatibilityProfile {
  const isSettings = root?.namespaceUri === WML_NAMESPACE_URI && root.localName === 'settings';
  const legacy: Partial<Record<LegacyOption, boolean>> = {};
  const settings: Partial<Record<WordSetting, boolean | 'ambiguous'>> = {};
  let modeDeclarations = 0;
  let modeValue: number | undefined;
  let firstCompat = true;
  for (const compat of root?.children ?? []) {
    if (
      compat.kind === 'textValue' ||
      compat.namespaceUri !== WML_NAMESPACE_URI ||
      compat.localName !== 'compat'
    )
      continue;
    const seen = new Set<string>();
    for (const option of compat.children) {
      if (option.kind === 'textValue' || option.namespaceUri !== WML_NAMESPACE_URI) continue;
      if (option.localName === 'compatSetting') {
        const name = attribute(option, 'name');
        if (name === undefined || attribute(option, 'uri') !== WORD_URI) continue;
        const raw = attribute(option, 'val');
        if (name === 'compatibilityMode') {
          if (!isSettings) continue;
          modeDeclarations++;
          const value = raw !== undefined && /^\d{1,4}$/.test(raw) ? Number(raw) : undefined;
          modeValue = value !== undefined && value >= 11 ? value : undefined;
          continue;
        }
        const reading = SETTING_READINGS.get(name);
        // The original reader of this setting accepted any part root.
        if (!reading || (!isSettings && name !== 'overrideTableStyleFontSizeAndJustification'))
          continue;
        const key = name as WordSetting;
        settings[key] =
          reading[1] === 'refuse' && Object.hasOwn(settings, key)
            ? 'ambiguous'
            : onOff(raw, reading[0]);
        continue;
      }
      const reading = isSettings ? LEGACY_READINGS.get(option.localName) : undefined;
      if (!reading) continue;
      const key = option.localName as LegacyOption;
      if (reading[1] === 'first') {
        if (!firstCompat || seen.has(key)) continue;
        seen.add(key);
      }
      legacy[key] = onOff(attribute(option, 'val'), reading[0]);
    }
    firstCompat = false;
  }
  // Two declarations are ambiguous; do not invent a winner.
  if (modeDeclarations > 1) modeValue = undefined;
  let modeRefused = modeDeclarations > 0 && modeValue === undefined;
  // A valid mode declared directly under `w:settings`, outside `w:compat`, applies when
  // `w:compat` holds no valid single declaration. An invalid value there is ignored, so it
  // neither sets nor refuses a mode.
  if (isSettings && modeValue === undefined && modeDeclarations <= 1) {
    const outside: number[] = [];
    for (const option of root!.children) {
      if (
        option.kind === 'textValue' ||
        option.namespaceUri !== WML_NAMESPACE_URI ||
        option.localName !== 'compatSetting' ||
        attribute(option, 'name') !== 'compatibilityMode' ||
        attribute(option, 'uri') !== WORD_URI
      )
        continue;
      const raw = attribute(option, 'val');
      const value = raw !== undefined && /^\d{1,4}$/.test(raw) ? Number(raw) : undefined;
      if (value !== undefined && value >= 11) outside.push(value);
    }
    if (outside.length === 1) {
      modeValue = outside[0];
      modeRefused = false;
    }
  }
  const profile: CompatibilityProfile = {
    modeValue,
    modeClass: compatibilityModeClass(modeValue),
    modeRefused,
    legacy,
    settings,
    has: (rule) =>
      Object.hasOwn(MODE_RULES, rule)
        ? MODE_RULES[rule as ModeRuleName].mode === profile.modeClass
        : PROFILE_RULES[rule as keyof typeof PROFILE_RULES].applies(profile),
  };
  return profile;
}

/**
 * The declared Word compatibility mode, or `undefined` when the settings declare none, declare
 * it twice, or declare a value that is not 11 to 9999. Branch on it only through
 * `hasCompatibilityRule`.
 */
export function compatibilityModeFromSettings(root: OoxmlElement | null): number | undefined {
  return compatibilityProfileFromSettings(root).modeValue;
}
