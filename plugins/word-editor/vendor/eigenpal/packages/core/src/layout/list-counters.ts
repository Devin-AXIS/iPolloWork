// Per-story OOXML list counter state (ECMA-376 numbering).
//
// Counters belong to the ABSTRACT list: every `w:num` that names one `w:abstractNum` counts on
// one shared vector, so a second `w:num` over the same definition continues the first. A
// `w:num` restarts that shared vector only through `w:startOverride`, once, at its first
// paragraph on an overridden level (see `createListCounterState`).

import {
  resolveNumberingLevel,
  type NumberingIndex,
  type NumberingLevel,
} from './numbering-index.ts';
import { expandLvlText } from './numbering-format.ts';
import type { ListNumLevel } from './field-listnum.ts';

/**
 * The result of counting ONE list paragraph: the level that applied, the counter vector after it,
 * and the marker text a reader sees.
 *
 * Counters are a vector across all nine levels, not a single number, because a deeper level
 * restarting resets the ones below it while leaving those above intact.
 */
export interface ListCounterAdvance {
  /** Effective abstract numbering template for this num instance. */
  readonly abstractNumId: string;
  readonly numId: string;
  readonly ilvl: number;
  readonly level: NumberingLevel;
  /** Counter vector after this item was counted (indices 0..8). */
  readonly counters: readonly number[];
  /** Expanded marker text (empty when vanished / empty lvlText). */
  readonly markerText: string;
}

/**
 * The running counters for one layout pass over one story.
 *
 * Stateful and order-dependent by nature: a list number is a function of every numbered paragraph
 * before it, which is why markers are computed during layout and cannot be read off a paragraph
 * in isolation.
 */
export interface ListCounterState {
  /**
   * Advance counters for one list paragraph.
   *
   * Returns null when the numbering definition cannot be resolved — callers treat the
   * paragraph as non-list (inert fallback).
   */
  advance(numId: string, ilvl: number): ListCounterAdvance | null;
}

/**
 * The value each level of `numId` starts from, indices 0..8.
 *
 * A `w:startOverride` names it. When the same `w:lvlOverride` also replaces the level, the
 * replacement's `w:start` wins over the `w:startOverride` value.
 */
function effectiveStartsForNum(index: NumberingIndex, numId: string): number[] {
  const num = index.nums.get(numId);
  const starts: number[] = [];
  for (let ilvl = 0; ilvl <= 8; ilvl += 1) {
    const resolved = resolveNumberingLevel(index, numId, ilvl);
    if (!resolved) {
      starts.push(1);
      continue;
    }
    const override = num?.overrides.get(ilvl);
    const startOverride = override?.startOverride;
    starts.push(
      startOverride === undefined ? resolved.level.start : (override?.level?.start ?? startOverride)
    );
  }
  return starts;
}

/** The levels of `numId` that carry a `w:startOverride`, or null when none does. */
function restartLevelsOfNum(index: NumberingIndex, numId: string): ReadonlySet<number> | null {
  const num = index.nums.get(numId);
  if (!num) return null;
  let levels: Set<number> | null = null;
  for (const [ilvl, override] of num.overrides) {
    if (override.startOverride === undefined) continue;
    (levels ??= new Set()).add(ilvl);
  }
  return levels;
}

function levelFormats(
  index: NumberingIndex,
  numId: string,
  starts: readonly number[]
): { formats: string[]; starts: number[] } {
  const formats: string[] = [];
  for (let ilvl = 0; ilvl <= 8; ilvl += 1) {
    const resolved = resolveNumberingLevel(index, numId, ilvl);
    formats.push(resolved?.level.numFmt ?? 'decimal');
  }
  return { formats, starts: [...starts] };
}

/**
 * `w:isLgl` (§17.9.9): a legal-numbering level renders EVERY level its `w:lvlText` references
 * in decimal, whatever format those levels declare — `Artikel I.01` is authored, `Artikel 1.1`
 * is what Word paints. `bullet` and `none` are left alone: neither prints a counter, so
 * "display it as decimal" would invent one. ONE helper for marker expansion and for
 * cross-reference composition below, so the two renderings of the same number cannot drift.
 */
function legalEffectiveFormats(formats: readonly string[], isLgl: boolean): readonly string[] {
  if (!isLgl) return formats;
  return formats.map((format) => (format === 'bullet' || format === 'none' ? format : 'decimal'));
}

/**
 * Highest ilvl whose use restarts level `targetIlvl`, per `w:lvlRestart` on that level.
 *
 * Returns null when the level never restarts (`lvlRestart` = 0 or trigger above target).
 */
function lvlRestartTriggerIlvl(targetIlvl: number, lvlRestart: number | undefined): number | null {
  if (lvlRestart === 0) return null;
  if (lvlRestart === undefined) return targetIlvl - 1;
  const triggerIlvl = lvlRestart - 1;
  if (triggerIlvl >= targetIlvl) return null;
  return triggerIlvl;
}

/**
 * An item on level `ilvl` counts every level above it that has no item yet (since that level
 * last started again) once, at that level's start. The next item on such a parent level then
 * continues from there: a level 1 item before any level 0 item makes the next level 0 item `2.`.
 * List paragraphs and LISTNUM fields share this rule.
 */
function countSkippedParents(
  counters: number[],
  initialized: boolean[],
  ilvl: number,
  startOf: (parent: number) => number
): void {
  for (let parent = 0; parent < ilvl; parent += 1) {
    if (initialized[parent]) continue;
    counters[parent] = startOf(parent);
    initialized[parent] = true;
  }
}

/** The counter values of one bag at one point of its walk. */
export interface ListCounterSnapshot {
  /** Keyed by abstractNumId. */
  readonly counters: ReadonlyMap<string, readonly number[]>;
  /** Keyed by abstractNumId. */
  readonly initialized: ReadonlyMap<string, readonly boolean[]>;
  /** The numIds whose `w:startOverride` restart has already applied. */
  readonly restarted: ReadonlySet<string>;
}

const counterSnapshots = new WeakMap<
  ListCounterState,
  { save(): ListCounterSnapshot; load(snapshot: ListCounterSnapshot): void }
>();

/** @internal The values `state` holds now, for a later walk to resume from. */
export function saveListCounters(state: ListCounterState): ListCounterSnapshot {
  return counterSnapshots.get(state)!.save();
}

/** @internal Put `state` back to `snapshot`, taken from a bag over the same numbering. */
export function loadListCounters(state: ListCounterState, snapshot: ListCounterSnapshot): void {
  counterSnapshots.get(state)!.load(snapshot);
}

const copyArrays = <T>(source: ReadonlyMap<string, readonly T[]>): Map<string, T[]> =>
  new Map([...source].map(([id, values]) => [id, values.slice()]));

/**
 * Create a fresh counter bag for one story (body, or one header/footer part).
 *
 * Every `w:num` over one `w:abstractNum` counts on the same vector. A `w:num` with a
 * `w:startOverride` restarts it once: at its first paragraph whose level carries an override,
 * that level starts again from the `w:num`'s value. The restart applies to that level alone and
 * is then spent, so a later paragraph of the same `w:num` on another overridden level continues.
 * A level that starts again after a parent level takes the start of the `w:num` counting it.
 */
export function createListCounterState(index: NumberingIndex): ListCounterState {
  /** abstractNumId → current counter values[0..8]. */
  const byAbstract = new Map<string, number[]>();
  /** abstractNumId → whether each level has emitted at least once since its last restart. */
  const initializedByAbstract = new Map<string, boolean[]>();
  /** numId → authored effective starts[0..8]. */
  const startsByNumId = new Map<string, number[]>();
  /** numId → the levels its `w:startOverride` names, or null for none. */
  const restartLevelsByNumId = new Map<string, ReadonlySet<number> | null>();
  /** numIds whose one `w:startOverride` restart has applied. */
  const restarted = new Set<string>();

  const ensure = (
    abstractNumId: string,
    numId: string
  ): { counters: number[]; initialized: boolean[]; starts: number[] } => {
    let counters = byAbstract.get(abstractNumId);
    if (!counters) {
      counters = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      byAbstract.set(abstractNumId, counters);
    }
    let initialized = initializedByAbstract.get(abstractNumId);
    if (!initialized) {
      initialized = [false, false, false, false, false, false, false, false, false];
      initializedByAbstract.set(abstractNumId, initialized);
    }
    let starts = startsByNumId.get(numId);
    if (!starts) {
      starts = effectiveStartsForNum(index, numId);
      startsByNumId.set(numId, starts);
    }
    return { counters, initialized, starts };
  };

  const restartLevelsOf = (numId: string): ReadonlySet<number> | null => {
    let levels = restartLevelsByNumId.get(numId);
    if (levels === undefined) {
      levels = restartLevelsOfNum(index, numId);
      restartLevelsByNumId.set(numId, levels);
    }
    return levels;
  };

  const state: ListCounterState = {
    advance(numId, ilvl) {
      if (ilvl < 0 || ilvl > 8) return null;
      if (numId.length === 0 || numId.length > 64) return null;
      const resolved = resolveNumberingLevel(index, numId, ilvl);
      if (!resolved) return null;

      const { abstractNumId, level } = resolved;
      const { counters, initialized, starts } = ensure(abstractNumId, numId);
      const { formats } = levelFormats(index, numId, starts);

      if (!restarted.has(numId) && restartLevelsOf(numId)?.has(ilvl)) {
        initialized[ilvl] = false;
        restarted.add(numId);
      }

      // Deeper levels restart per `w:lvlRestart` when this ilvl is used.
      for (let deeper = ilvl + 1; deeper <= 8; deeper += 1) {
        const deeperLevel = resolveNumberingLevel(index, numId, deeper);
        if (!deeperLevel) continue;
        const trigger = lvlRestartTriggerIlvl(deeper, deeperLevel.level.lvlRestart);
        if (trigger !== null && ilvl <= trigger) {
          initialized[deeper] = false;
        }
      }

      countSkippedParents(counters, initialized, ilvl, (parent) => starts[parent] ?? 1);

      // Increment this level from its authored baseline.
      const effectiveStart = starts[ilvl] ?? level.start;
      if (!initialized[ilvl]) {
        counters[ilvl] = effectiveStart;
        initialized[ilvl] = true;
      } else {
        counters[ilvl] += 1;
      }

      const snapshot = counters.slice() as number[];
      const initializedSnapshot = initialized.slice();
      // For expansion, unused deeper levels should still substitute as their start (Word
      // shows them when lvlText references them).
      const expandCounters = snapshot.map((value, idx) => {
        if (!initializedSnapshot[idx]) {
          return starts[idx] ?? 1;
        }
        return value;
      });

      const effectiveFormats = legalEffectiveFormats(formats, level.isLgl);

      const markerText = level.vanish
        ? ''
        : level.numFmt === 'bullet' && !/%[1-9]/.test(level.lvlText)
          ? level.lvlText
          : expandLvlText(level.lvlText, expandCounters, effectiveFormats);

      const advance: ListCounterAdvance = {
        abstractNumId,
        numId,
        ilvl,
        level,
        counters: snapshot,
        markerText,
      };
      // Side channel rather than a member: `ListCounterAdvance` is public API, and the
      // substitution-ready vector (uninitialized levels already at their starts) cannot be
      // rebuilt from `counters` alone — a level whose authored start IS its current value
      // looks exactly like one that never emitted.
      expandCountersByAdvance.set(advance, expandCounters);
      return advance;
    },
  };
  fieldAdvancers.set(state, (counterKey, ilvl, levelOf, setValue) => {
    const level = levelOf(ilvl);
    if (!level || ilvl < 0 || ilvl > 8) return null;
    let counters = byAbstract.get(counterKey);
    let initialized = initializedByAbstract.get(counterKey);
    if (!counters || !initialized) {
      counters = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      initialized = [false, false, false, false, false, false, false, false, false];
      byAbstract.set(counterKey, counters);
      initializedByAbstract.set(counterKey, initialized);
    }
    for (let deeper = ilvl + 1; deeper <= 8; deeper += 1) {
      const trigger = lvlRestartTriggerIlvl(deeper, levelOf(deeper)?.lvlRestart);
      if (trigger !== null && ilvl <= trigger) initialized[deeper] = false;
    }
    countSkippedParents(counters, initialized, ilvl, (parent) => levelOf(parent)?.start ?? 1);
    if (setValue !== undefined) counters[ilvl] = setValue;
    else if (initialized[ilvl]) counters[ilvl] += 1;
    else counters[ilvl] = level.start;
    initialized[ilvl] = true;
    const expand = counters.map((value, index) =>
      initialized![index] ? value : (levelOf(index)?.start ?? 1)
    );
    const formats = counters.map((_, index) => levelOf(index)?.numFmt ?? 'decimal');
    if (level.vanish || level.numFmt === 'bullet') return null;
    return expandLvlText(level.lvlText, expand, legalEffectiveFormats(formats, !!level.isLgl));
  });
  counterSnapshots.set(state, {
    save: () => ({
      counters: copyArrays(byAbstract),
      initialized: copyArrays(initializedByAbstract),
      restarted: new Set(restarted),
    }),
    load(snapshot) {
      byAbstract.clear();
      for (const [id, values] of copyArrays(snapshot.counters)) byAbstract.set(id, values);
      initializedByAbstract.clear();
      for (const [id, values] of copyArrays(snapshot.initialized))
        initializedByAbstract.set(id, values);
      restarted.clear();
      for (const id of snapshot.restarted) restarted.add(id);
    },
  });
  return state;
}

/** The levels one LISTNUM field counts on, by level index. */
export type ListNumLevelOf = (ilvl: number) => ListNumLevel | undefined;

const fieldAdvancers = new WeakMap<
  ListCounterState,
  (counterKey: string, ilvl: number, levelOf: ListNumLevelOf, setValue?: number) => string | null
>();

/**
 * Count one LISTNUM field on the counters `state` keeps under `counterKey` (an
 * abstractNumId, so the field and the list's paragraphs continue each other), and return the
 * text it displays, or null when it displays none. `setValue` is the field's `\s` value.
 *
 * @internal
 */
export function advanceListNumField(
  state: ListCounterState,
  counterKey: string,
  ilvl: number,
  levelOf: ListNumLevelOf,
  setValue?: number
): string | null {
  return fieldAdvancers.get(state)?.(counterKey, ilvl, levelOf, setValue) ?? null;
}

/** Substitution-ready counter vectors, keyed on the advance results that produced them. */
const expandCountersByAdvance = new WeakMap<ListCounterAdvance, readonly number[]>();

/** The substitution-ready vector behind one advance, for cross-reference composition. */
export function expandCountersOf(advance: ListCounterAdvance): readonly number[] {
  return expandCountersByAdvance.get(advance) ?? advance.counters;
}

/** Matches what the `\t` filter drops from a `w:lvlText`: literal letters and whitespace. */
const SUPPRESSED_LVL_TEXT_CHAR = /[\p{L}\s]/u;

/**
 * The `REF \t` filter over one level's `w:lvlText`: keep the counter placeholders and the
 * delimiter characters, drop the literal words.
 *
 * DESIGN DECISION — what counts as a delimiter: every non-letter, non-whitespace character
 * (`.`, `(`, `)`, `-`, `/`, `:`, literal digits) is KEPT wherever it sits, including the
 * leading and trailing parentheses of `(%3)` — Word's cached `\t` values for such levels
 * read `(c)`, not `c`. Literal LETTERS drop (they are the text the switch suppresses), and
 * whitespace drops with them: it exists to set the dropped words off, and Word's cached
 * values show compact joins (`Section 4.2` caches as `4.2`). The filter runs on the
 * TEMPLATE, never the expanded string, because expanded a letter or roman COUNTER (`(c)`,
 * `(ii)`) is indistinguishable from a literal word. One linear pass over a length-capped
 * string; the per-field calibration gate in `field-ref.ts` keeps any document whose cached
 * values disagree on its cache.
 */
function suppressNonDelimiterLvlText(lvlText: string): string {
  let out = '';
  for (let index = 0; index < lvlText.length; index += 1) {
    const char = lvlText[index]!;
    const next = lvlText[index + 1];
    if (char === '%' && next !== undefined && next >= '1' && next <= '9') {
      out += char + next;
      index += 1;
      continue;
    }
    if (SUPPRESSED_LVL_TEXT_CHAR.test(char)) continue;
    out += char;
  }
  return out;
}

/**
 * What composing a paragraph's FULL-CONTEXT number needs: levels 0..8 of its `w:num`, resolved
 * through the linked index when the paragraph was counted, and the substitution-ready counters.
 *
 * The levels, not the index: a list item outlives the numbering revision it was counted under
 * (an unchanged item is reused), and holding the index kept one whole index per revision.
 */
export interface FullContextNumberSource {
  readonly levels: readonly (NumberingLevel | null)[];
  readonly ilvl: number;
  readonly expandCounters: readonly number[];
}

const numberLevelsByIndex = new WeakMap<
  NumberingIndex,
  Map<string, readonly (NumberingLevel | null)[]>
>();

/** Levels 0..8 of `numId` in `index`, shared by every item of that list. */
export function numberLevelsOf(
  index: NumberingIndex,
  numId: string
): readonly (NumberingLevel | null)[] {
  let byNum = numberLevelsByIndex.get(index);
  if (!byNum) {
    byNum = new Map();
    numberLevelsByIndex.set(index, byNum);
  }
  let levels = byNum.get(numId);
  if (!levels) {
    const resolved: (NumberingLevel | null)[] = [];
    for (let lvl = 0; lvl <= 8; lvl += 1) {
      resolved.push(resolveNumberingLevel(index, numId, lvl)?.level ?? null);
    }
    levels = resolved;
    byNum.set(numId, levels);
  }
  return levels;
}

/**
 * The paragraph's number in full context — what a `REF \w` paints for a multilevel target.
 *
 * A level like `(%3)` states only its OWN placeholder, so its marker (`(c)`) is not the number
 * a reader cites; Word's cross-reference shows `1.2(c)`. Composed by walking levels 0..ilvl:
 * each level's `w:lvlText` expands through the SAME substitution and `w:isLgl` mapping the
 * marker uses, and a level whose own placeholder already appears in a DEEPER kept level's text
 * is dropped (the standard `%1.` / `%1.%2` shape would otherwise paint `1.1.2`). Bullet /
 * `none` / empty levels contribute nothing; a target that is one resolves to null (the caller
 * falls back). Bounded: at most nine levels, each expansion under the marker-length caps.
 *
 * `ownLevelOnly` keeps just the target level's expansion — what a `REF \n` paints (`(c)`,
 * `(ii)`), per Word's own cached values for that switch. `suppressNonDelimiterText` applies
 * the `REF \t` template filter (see {@link suppressNonDelimiterLvlText}) to every kept level
 * before it expands. The keep/drop decisions above it read the ORIGINAL texts — the filter
 * preserves placeholders, so both views agree on which levels contribute.
 */
export function composeFullContextNumber(
  source: FullContextNumberSource,
  ownLevelOnly = false,
  suppressNonDelimiterText = false
): string | null {
  const { ilvl, expandCounters } = source;
  if (ilvl < 0 || ilvl > 8) return null;
  const levels: (NumberingLevel | null)[] = [];
  const formats: string[] = [];
  for (let lvl = 0; lvl <= 8; lvl += 1) {
    const resolved = source.levels[lvl] ?? null;
    levels.push(lvl <= ilvl ? resolved : null);
    formats.push(resolved?.numFmt ?? 'decimal');
  }
  const numbered = (level: NumberingLevel | null): level is NumberingLevel =>
    level !== null &&
    level.numFmt !== 'bullet' &&
    level.numFmt !== 'none' &&
    level.lvlText.length > 0;
  if (!numbered(levels[ilvl] ?? null)) return null;

  // Deepest-up: keep the target, then keep each shallower numbered level unless a KEPT deeper
  // text already displays its placeholder — a dropped level's text paints nothing, so only
  // kept texts can stand in for it.
  const kept: number[] = [];
  const keptTexts: string[] = [];
  for (let lvl = ilvl; lvl >= 0; lvl -= 1) {
    if (ownLevelOnly && lvl !== ilvl) break;
    const level = levels[lvl];
    if (!numbered(level)) continue;
    if (lvl !== ilvl && keptTexts.some((text) => text.includes(`%${lvl + 1}`))) continue;
    kept.push(lvl);
    keptTexts.push(level.lvlText);
  }
  kept.reverse();

  let out = '';
  for (const lvl of kept) {
    const level = levels[lvl]!;
    const template = suppressNonDelimiterText
      ? suppressNonDelimiterLvlText(level.lvlText)
      : level.lvlText;
    out += expandLvlText(template, expandCounters, legalEffectiveFormats(formats, level.isLgl));
  }
  return out.length > 0 ? out : null;
}
