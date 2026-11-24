/**
 * Placeholder / ICU integrity checks for locale JSON files.
 *
 * Pure module: no file I/O, no CLI side effects. `scripts/validate-i18n.mjs`
 * feeds it parsed JSON; `scripts/i18n-integrity.test.mjs` exercises it
 * directly.
 *
 * ICU parsing mirrors the runtime formatter in `packages/i18n/src/index.ts`
 * (`formatMessage` / `parseBranches`). Validation also rejects unmatched
 * branch syntax that the runtime skips. Raw `{...}` syntax fails
 * `malformed_braces`.
 *
 * Violation codes:
 *   placeholder_mismatch    — placeholder-name set differs from English
 *   plural_var_mismatch     — plural variable name is not the English one
 *   invalid_branch_label    — branch label is neither `=N` nor a valid category
 *   missing_other           — plural block lacks the required `other` branch
 *   missing_exact_branch    — an English `=N` branch was dropped
 *   malformed_braces        — stray brace or unmatched plural branch syntax
 *   lang_mismatch           — declared `_lang` differs from the file stem
 */

/** Matches an ICU plural block; verbatim twin of the runtime plural regex. */
const PLURAL_BLOCK_RE = /\{(\w+),\s*plural,((?:[^{}]|\{[^{}]*\})*)\}/g;

/** Verbatim twin of the runtime `parseBranches` regex. */
const BRANCH_RE = /(=\d+|\w+)\s*\{([^}]*)\}/g;

/** Simple interpolation token, e.g. `{count}`. */
const SIMPLE_TOKEN_RE = /\{(\w+)\}/g;

/** ICU exact-match branch label, e.g. `=0`. */
const EXACT_BRANCH_RE = /^=\d+$/;

// `Intl.PluralRules` construction is not free; one lookup per locale code
// per process is plenty.
const pluralCategoriesCache = new Map();

function pluralCategoriesFor(code) {
  const cached = pluralCategoriesCache.get(code);
  if (cached) return cached;
  let categories;
  try {
    categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  } catch {
    // Structurally invalid tag — fall back to the English categories, the
    // same shape the runtime falls back to when construction throws.
    categories = ['one', 'other'];
  }
  pluralCategoriesCache.set(code, categories);
  return categories;
}

/**
 * Parse the branches of a plural block, mirroring the runtime
 * `parseBranches`. Returns every match (the runtime map keeps the last
 * duplicate; validation wants to see all labels).
 *
 * @param {string} branchStr
 * @returns {Array<{ label: string, text: string }>}
 */
function parseBranches(branchStr) {
  const branches = [];
  for (const match of branchStr.matchAll(BRANCH_RE)) {
    branches.push({ label: match[1], text: match[2] });
  }
  return branches;
}

/**
 * Extract placeholder structure from a message.
 *
 * - `simple` — names of `{name}` tokens outside plural blocks.
 * - `plurals` — every ICU plural block with its variable name and branches.
 * - `malformedBraces` — true when a `{` or `}` remains after recognized
 *   placeholders and plural blocks are stripped (e.g. an unclosed `{count`
 *   typo, or a `{name}` nested inside a plural branch, which the runtime
 *   cannot parse and would render as raw ICU syntax).
 *
 * @param {string} message
 * @returns {{
 *   simple: string[],
 *   plurals: Array<{ name: string, branches: Array<{ label: string, text: string }> }>,
 *   malformedBraces: boolean
 * }}
 */
export function extractMessageInfo(message) {
  const plurals = [];
  const outside = [];
  let malformedPlural = false;
  let cursor = 0;
  for (const match of message.matchAll(PLURAL_BLOCK_RE)) {
    outside.push(message.slice(cursor, match.index));
    plurals.push({ name: match[1], branches: parseBranches(match[2]) });
    if (match[2].replace(BRANCH_RE, '').trim()) malformedPlural = true;
    cursor = match.index + match[0].length;
  }
  outside.push(message.slice(cursor));

  const simple = [];
  let residual = '';
  for (const segment of outside) {
    let pos = 0;
    for (const match of segment.matchAll(SIMPLE_TOKEN_RE)) {
      simple.push(match[1]);
      residual += segment.slice(pos, match.index);
      pos = match.index + match[0].length;
    }
    residual += segment.slice(pos);
  }

  return { simple, plurals, malformedBraces: malformedPlural || /[{}]/.test(residual) };
}

/** Placeholder-name set: simple tokens plus every plural block's variable. */
function placeholderNames(info) {
  const names = new Set(info.simple);
  for (const plural of info.plurals) names.add(plural.name);
  return names;
}

function describeNameDiff(missing, extra) {
  const parts = [];
  if (missing.length > 0) parts.push(`missing ${missing.map((n) => `{${n}}`).join(', ')}`);
  if (extra.length > 0) parts.push(`unexpected ${extra.map((n) => `{${n}}`).join(', ')}`);
  return `placeholder set differs from English — ${parts.join('; ')}`;
}

/**
 * Validate one translated leaf against its English source. Expects two
 * non-`null` strings; the caller skips everything else.
 */
function checkLeaf(key, enText, locText, code, violations) {
  const enInfo = extractMessageInfo(enText);
  const locInfo = extractMessageInfo(locText);

  const enNames = placeholderNames(enInfo);
  const locNames = placeholderNames(locInfo);
  const missing = [...enNames].filter((n) => !locNames.has(n));
  const extra = [...locNames].filter((n) => !enNames.has(n));
  if (missing.length > 0 || extra.length > 0) {
    violations.push({
      key,
      code: 'placeholder_mismatch',
      message: describeNameDiff(missing, extra),
    });
  }

  if (locInfo.plurals.length > 0) {
    const enPluralNames = new Set(enInfo.plurals.map((p) => p.name));
    // Labels copied verbatim from the English plural block stay valid: the
    // translation may preserve the source's branch set (e.g. `zh-CN`/`id`
    // keep English's `one` branch even though their CLDR category set is
    // `['other']`; the runtime never selects it, so it is harmless). Every
    // other label must be a CLDR plural category of the locale.
    const localeCategories = pluralCategoriesFor(code);

    for (const plural of locInfo.plurals) {
      const enLabels = new Set(
        enInfo.plurals
          .filter((source) => source.name === plural.name)
          .flatMap((source) => source.branches.map((branch) => branch.label))
      );
      if (enPluralNames.size > 0) {
        if (!enPluralNames.has(plural.name)) {
          violations.push({
            key,
            code: 'plural_var_mismatch',
            message: `plural variable "${plural.name}" must match the English plural variable "${[...enPluralNames].join('", "')}"`,
          });
        }
      } else if (!enInfo.simple.includes(plural.name)) {
        const hint = enInfo.simple.length
          ? `must reuse an English placeholder name (${enInfo.simple.map((n) => `"${n}"`).join(', ')})`
          : 'has no English placeholder to attach to';
        violations.push({
          key,
          code: 'plural_var_mismatch',
          message: `plural variable "${plural.name}" ${hint}`,
        });
      }

      for (const branch of plural.branches) {
        if (EXACT_BRANCH_RE.test(branch.label)) continue;
        if (localeCategories.includes(branch.label) || enLabels.has(branch.label)) continue;
        violations.push({
          key,
          code: 'invalid_branch_label',
          message: `branch label "${branch.label}" is not a CLDR plural category for "${code}" and not an English branch label`,
        });
      }

      const locLabels = new Set(
        locInfo.plurals
          .filter((translated) => translated.name === plural.name)
          .flatMap((translated) => translated.branches.map((branch) => branch.label))
      );
      for (const exact of enLabels) {
        if (!EXACT_BRANCH_RE.test(exact) || locLabels.has(exact)) continue;
        violations.push({
          key,
          code: 'missing_exact_branch',
          message: `English exact-match branch "${exact}" must be preserved for "${plural.name}"`,
        });
      }

      if (!plural.branches.some((b) => b.label === 'other')) {
        violations.push({
          key,
          code: 'missing_other',
          message: `plural block "${plural.name}" is missing the required "other" branch`,
        });
      }
    }
  }

  // A plain `{count}` in place of an English plural block keeps the plural
  // forms out, but an English `=N` branch carries distinct wording (e.g.
  // "no steps") that a bare number cannot express, so it is still required.
  const locPluralNames = new Set(locInfo.plurals.map((p) => p.name));
  const plainNames = new Set(locInfo.simple.filter((name) => !locPluralNames.has(name)));
  const reported = new Set();
  for (const source of enInfo.plurals) {
    if (!plainNames.has(source.name)) continue;
    for (const { label } of source.branches) {
      const id = `${source.name}\u0000${label}`;
      if (!EXACT_BRANCH_RE.test(label) || reported.has(id)) continue;
      reported.add(id);
      violations.push({
        key,
        code: 'missing_exact_branch',
        message: `English exact-match branch "${label}" must be preserved for "${source.name}"`,
      });
    }
  }

  if (locInfo.malformedBraces) {
    violations.push({
      key,
      code: 'malformed_braces',
      message: 'stray braces or unrecognized syntax within a plural block',
    });
  }
}

/**
 * Walk matching leaves of the English source and the locale in lockstep.
 * Top-level `_*` metadata (`_lang`) is skipped; locale leaves are read via
 * `Object.hasOwn` so a missing key never resolves through the prototype
 * chain.
 */
function walkLeafPairs(enObj, locObj, prefix, visit) {
  for (const [k, enVal] of Object.entries(enObj)) {
    if (prefix === '' && k.startsWith('_')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    const hasLoc = locObj !== null && typeof locObj === 'object' && Object.hasOwn(locObj, k);
    const locVal = hasLoc ? locObj[k] : undefined;
    if (enVal !== null && typeof enVal === 'object' && !Array.isArray(enVal)) {
      walkLeafPairs(enVal, locVal, key, visit);
    } else if (typeof enVal === 'string') {
      visit(key, enVal, locVal);
    }
  }
}

/**
 * Check a whole locale file against the English source.
 *
 * `null` (or missing, or non-string) translations are skipped — they fall
 * back to English at runtime and are covered by the key-sync rule. The
 * `_lang` key itself is metadata, checked separately against the file stem.
 *
 * @param {Record<string, unknown>} enStrings parsed `en.json`
 * @param {Record<string, unknown>} localeStrings parsed locale JSON
 * @param {string} code locale code (file stem), e.g. `'pt-BR'`
 * @returns {{ ok: boolean, violations: Array<{ key: string, code: string, message: string }> }}
 */
export function checkLocaleIntegrity(enStrings, localeStrings, code) {
  const violations = [];
  const locale = localeStrings ?? {};

  if (Object.hasOwn(locale, '_lang') && locale._lang !== code) {
    violations.push({
      key: '_lang',
      code: 'lang_mismatch',
      message: `_lang ${JSON.stringify(locale._lang)} must equal the locale code "${code}"`,
    });
  }

  walkLeafPairs(enStrings ?? {}, locale, '', (key, enText, locText) => {
    if (typeof locText !== 'string') return;
    checkLeaf(key, enText, locText, code, violations);
  });

  return { ok: violations.length === 0, violations };
}
