// Which stops a numbering suffix tab may use: a document setting, carried on tab stops.
//
// `w:doNotUseIndentAsNumberingTabStop` (§17.15.3) lives in `settings.xml`, outside every
// paragraph's property chain. The style cascade reads it once, and each paragraph's
// resolved stops carry it, so the tab-stop cache token covers it with no extra key.

import type { ResolvedTabStops } from './paragraph-tabs.ts';

/** The settings-derived part of the numbering-tab rule. */
export interface NumberingTabSettings {
  readonly ignoreIndentAsNumberingTabStop?: true;
}

/**
 * Republish a paragraph's stops under the document's numbering-tab rule. Returns the input
 * unchanged under the default rule, so the cache token stays the same.
 */
export function withNumberingTabRule(
  tabs: ResolvedTabStops,
  settings: NumberingTabSettings | undefined
): ResolvedTabStops {
  if (!settings?.ignoreIndentAsNumberingTabStop || tabs.ignoreIndentAsNumberingTabStop) {
    return tabs;
  }
  return { ...tabs, ignoreIndentAsNumberingTabStop: true };
}
