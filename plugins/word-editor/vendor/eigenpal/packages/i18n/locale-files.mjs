// Single source of truth for "which JSON files in `packages/i18n/` are
// locale data." Consumed by `tsup.config.ts` (to build one entry per locale)
// and `scripts/validate-i18n.mjs` (to drive codegen + validation). Keeping
// the rule here means a future change to the BCP-47 pattern only has to land
// in one file — the bundler and the validator can't silently diverge.

import { readdirSync } from 'node:fs';

/**
 * Matches BCP-47-shaped JSON filenames: `<lang>(-<region|script>)*.json`.
 * Filters out config files (package.json, tsconfig.json) that happen to sit
 * next to the locale data.
 */
export const BCP47_FILENAME = /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*\.json$/;

/**
 * Return every locale code shipped from a `packages/i18n/`-shaped directory.
 * Codes are the filename stem (e.g. `pt-BR`, `zh-CN`) sorted lexically.
 */
export function readLocaleCodes(i18nDir) {
  return readdirSync(i18nDir)
    .filter((f) => BCP47_FILENAME.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}
