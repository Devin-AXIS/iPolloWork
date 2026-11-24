// The compatibility options the style cascade carries for layout. Each is present only when
// its rule applies, and the cascade folds the whole set into its cache token, so layout
// measured under one set is never reused under another.

import type { CompatibilityProfile } from './compatibility-profile.ts';

export interface CascadeCompatibility {
  readonly noColumnBalance?: true;
  readonly preserveExactLineBaseline?: true;
  readonly adjustLineHeightInTable?: true;
  readonly ignoreIndentAsNumberingTabStop?: true;
  readonly doNotBreakWrappedTables?: true;
  readonly fixedParagraphSpacing?: true;
  readonly unstretchedManualBreakLines?: true;
  readonly pageBreakLinesStretch?: true;
  readonly pageBreakMarkOnNextPage?: true;
  readonly textBesideBrokenFloatingTable?: true;
}

const CASCADE_RULES = [
  'noColumnBalance',
  'preserveExactLineBaseline',
  'adjustLineHeightInTable',
  'ignoreIndentAsNumberingTabStop',
  'doNotBreakWrappedTables',
  'fixedParagraphSpacing',
  'unstretchedManualBreakLines',
  'pageBreakLinesStretch',
  'pageBreakMarkOnNextPage',
  'textBesideBrokenFloatingTable',
] as const satisfies readonly (keyof CascadeCompatibility)[];

/** The cascade options a profile turns on, in a fixed key order. */
export function cascadeCompatibility(profile: CompatibilityProfile): CascadeCompatibility {
  const options: { -readonly [Key in keyof CascadeCompatibility]: true } = {};
  for (const rule of CASCADE_RULES) if (profile.has(rule)) options[rule] = true;
  return options;
}
