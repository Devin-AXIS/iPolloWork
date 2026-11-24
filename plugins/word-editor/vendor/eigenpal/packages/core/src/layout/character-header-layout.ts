// Character-style header values and body pagination settle together in a bounded pass.
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { drainLayoutSteps, type LayoutSteps } from './layout-steps.ts';
import { stableHash } from '../store/comparators/canonical.ts';
import { characterStyleFields, type CharacterStyleField } from './field-character-style.ts';
import {
  characterStyleIndex,
  characterStylePageValues,
  styleNamed,
} from './character-style-index.ts';
import { registerCharacterHeaderPages } from './character-header-pages.ts';
import { headersWithStyleValues } from './character-header-swap.ts';
import type { PageFurniture } from './page-furniture-insets.ts';
import type { SemanticLayout } from './semantic-records.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import { characterStyleValuesToken } from './character-style-tokens.ts';
import type { FieldPageContext } from './field-page-furniture.ts';
import type { HeaderFooterStoryLayout } from './hf-layout.ts';

const MAX_CHARACTER_HEADER_PASSES = 8;
const sessionSeeds = new WeakMap<
  object,
  {
    index: object;
    cacheToken: string;
    options: SemanticLayoutOptions;
    reserves: readonly number[];
    values: readonly ReadonlyMap<string, string>[];
    contexts: readonly FieldPageContext[];
  }
>();
const fieldsByPart = new WeakMap<OoxmlPart, readonly CharacterStyleField[]>();
function fields(part: OoxmlPart): readonly CharacterStyleField[] {
  let result = fieldsByPart.get(part);
  if (!result) {
    result = characterStyleFields(part.root);
    fieldsByPart.set(part, result);
  }
  return result;
}

export function layoutWithCharacterHeaders(
  part: OoxmlPart,
  options: SemanticLayoutOptions,
  run: (options: SemanticLayoutOptions) => SemanticLayout
): SemanticLayout {
  const setup = characterHeaderSetup(part, options);
  if (!setup) return run(options);
  const { furniture, dynamic, queries, index } = setup;
  const seed = resumableSeed(options, index);
  // Only live projections enter this history. A stale saved result is not a reserve floor.
  const reserves: number[] = seed ? [...seed.reserves] : [];
  let admittedReserves: number[] = seed ? [...seed.reserves] : [];
  const project = (
    values: readonly ReadonlyMap<string, string>[],
    contexts: readonly FieldPageContext[],
    token: string,
    warm = false
  ): SemanticLayoutOptions => {
    if (!warm) admittedReserves = [];
    const replacements = new Map<PageFurniture, PageFurniture>();
    for (const original of furniture) {
      const replacement: PageFurniture = { ...original };
      const cache = new Map<string, HeaderFooterStoryLayout>();
      const projectedHeights = new Map<number, number>();
      registerCharacterHeaderPages(replacement, {
        token,
        reserveHeight: (page) => {
          // A continued section can project its header without owning the sheet's
          // inset. Only an inset read admits its live height into reserve history.
          const height = Math.max(reserves[page] ?? 0, projectedHeights.get(page) ?? 0);
          reserves[page] = height;
          admittedReserves[page] = height;
          return height;
        },
        resolve(variant, page) {
          const story = original.headers.get(variant);
          const selected = values[page];
          if (!story || !dynamic.has(story) || !selected?.size) {
            projectedHeights.delete(page);
            return story;
          }
          const key = `${variant}:${page}`;
          let projected = cache.get(key);
          if (!projected) {
            projected = story.withPageContext({
              ...contexts[page]!,
              characterStyleValues: selected,
            });
            cache.set(key, projected);
          }
          projectedHeights.set(page, projected.flowHeight);
          return projected;
        },
      });
      replacements.set(original, replacement);
    }
    return {
      ...options,
      furniture: options.furniture ? replacements.get(options.furniture) : undefined,
      sectionFurniture: options.sectionFurniture?.map((value) =>
        value ? replacements.get(value) : undefined
      ),
    };
  };
  const textTokens = new Map<string, string>();
  const tokenOf = (
    values: readonly ReadonlyMap<string, string>[],
    contexts: readonly FieldPageContext[],
    includeReserves = true
  ) =>
    stableHash(
      JSON.stringify(
        values.map((value, page) => [
          characterStyleValuesToken(value, textTokens),
          contexts[page],
          includeReserves ? (reserves[page] ?? 0) : 0,
        ])
      )
    );
  const contextsOf = (layout: SemanticLayout): readonly FieldPageContext[] =>
    layout.pages.map((page) => ({
      pageNumber: page.pageFieldSource?.pageNumber ?? page.index + 1,
      pageCount: layout.pages.length,
      sectionPageCount: page.pageFieldSource?.sectionPageCount ?? layout.pages.length,
      format: page.pageFieldSource?.format,
      sheetNumber: page.index + 1,
    }));
  let previousToken = seed?.cacheToken ?? '';
  let previousValuesToken = seed ? tokenOf(seed.values, seed.contexts, false) : '';
  let current = run(
    seed?.index === index ? project(seed.values, seed.contexts, previousToken, true) : options
  );
  const seen = new Set<string>();
  if (previousToken) seen.add(previousToken);
  for (let pass = 0; pass < MAX_CHARACTER_HEADER_PASSES; pass += 1) {
    const values = characterStylePageValues(index, current, [...queries.values()]);
    const contexts = contextsOf(current);
    // The first pass showed saved results. When no header changes height under the values it
    // selects, that pass already placed the body the projected passes would place, so only
    // the header fragments change. A pass reused from an earlier revision can carry headers
    // that showed other values, so this also runs when every value is empty.
    if (pass === 0 && !previousToken) {
      const settled = headersWithStyleValues(current, values, contexts, furniture, dynamic);
      if (settled) return settled;
    }
    if (pass === 0 && !previousToken && values.every((value) => value.size === 0)) return current;
    const token = tokenOf(values, contexts);
    const valuesToken = tokenOf(values, contexts, false);
    // The inset reader raises and consumes the reserve together. Do not
    // repeat that admitted layout merely to encode the larger reserve in a token.
    const reservesWereAdmitted = current.pages.every(
      (_, page) => (admittedReserves[page] ?? 0) === (reserves[page] ?? 0)
    );
    if (token === previousToken || (valuesToken === previousValuesToken && reservesWereAdmitted)) {
      if (options.session)
        sessionSeeds.set(options.session, {
          index,
          cacheToken: previousToken,
          options,
          reserves: [...reserves],
          values,
          contexts,
        });
      return current;
    }
    if (seen.has(token)) throw new Error('character-style header layout did not converge');
    seen.add(token);
    previousToken = token;
    previousValuesToken = valuesToken;
    current = run(project(values, contexts, token));
  }
  throw new Error('character-style header layout exceeded its pass limit');
}

/** The same revision's settled state, when this pass repeats it with identical options. */
function resumableSeed(options: SemanticLayoutOptions, index: object) {
  const candidate = options.session ? sessionSeeds.get(options.session) : undefined;
  if (candidate?.index !== index) return undefined;
  const previous = candidate.options;
  const keys = new Set([...Object.keys(previous), ...Object.keys(options)]);
  for (const key of keys) {
    if (key === 'session') continue;
    const before = previous[key as keyof SemanticLayoutOptions];
    const after = options[key as keyof SemanticLayoutOptions];
    if (key === 'sectionFurniture' && Array.isArray(before) && Array.isArray(after)) {
      if (before.length !== after.length || before.some((value, i) => value !== after[i]))
        return undefined;
    } else if (before !== after) return undefined;
  }
  return candidate;
}

/** The header queries a pass must project, or null when none apply and one pass suffices. */
function characterHeaderSetup(part: OoxmlPart, options: SemanticLayoutOptions) {
  if (options.showFieldCodes) return null;
  const furniture = new Set<PageFurniture>();
  if (options.furniture) furniture.add(options.furniture);
  for (const value of options.sectionFurniture ?? []) if (value) furniture.add(value);
  const queries = new Map<string, CharacterStyleField>();
  const dynamic = new Set<HeaderFooterStoryLayout>();
  for (const value of furniture) {
    for (const story of value.headers.values()) {
      if (!story.part) continue;
      const found = fields(story.part);
      if (found.length) dynamic.add(story);
      for (const query of found) queries.set(query.key, query);
    }
  }
  const styles = options.styleCascade;
  if (!styles) return null;
  const paragraphStyles = new Set<string>();
  for (const [key, query] of queries) {
    const style = styleNamed(styles, query.name);
    if (!style) queries.delete(key);
    else if (style.type === 'paragraph') paragraphStyles.add(style.styleId);
  }
  if (!queries.size) return null;
  if (queries.size > 128) throw new Error('character-style header queries exceed their bound');
  const index = characterStyleIndex(part, options, paragraphStyles);
  if (!index) return null;
  return { furniture, dynamic, queries, index };
}

/**
 * {@link layoutWithCharacterHeaders} over a body run that may pause. A pass that does not repeat
 * a settled revision lays out the saved header results first, and that pass may pause; the
 * passes that settle the projected headers run synchronously. See `layout-steps.ts`.
 */
export function* layoutWithCharacterHeadersSteps(
  part: OoxmlPart,
  options: SemanticLayoutOptions,
  run: (options: SemanticLayoutOptions) => LayoutSteps<SemanticLayout>
): LayoutSteps<SemanticLayout> {
  const setup = characterHeaderSetup(part, options);
  if (!setup) return yield* run(options);
  let first = resumableSeed(options, setup.index) ? undefined : yield* run(options);
  return layoutWithCharacterHeaders(part, options, (opts) => {
    if (opts === options && first) {
      const layout = first;
      first = undefined;
      return layout;
    }
    return drainLayoutSteps(run(opts));
  });
}
