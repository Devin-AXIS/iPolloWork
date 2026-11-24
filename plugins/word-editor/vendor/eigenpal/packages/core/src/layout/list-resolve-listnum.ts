// LISTNUM fields inside the story's list walk.
//
// A LISTNUM field counts on the same counters as the numbered paragraphs of its list, so it
// is counted in the walk that numbers them, in reading order: a paragraph's own number first,
// then its fields. Which list and which level a field takes:
//
// - List. A name that matches a `w:abstractNum` `w:name` (case-insensitive) is that list.
//   Any other name is the built-in list (`field-listnum.ts`). Without a name, the field takes
//   the list of its own numbered paragraph, else the list of the last numbered paragraph
//   before it, else the built-in list.
// - Level. `\l` wins. Otherwise a field on its paragraph's own list is one level below the
//   paragraph; a field after another field of its list in the same paragraph takes that
//   field's level; a field on the list of the last numbered paragraph takes that paragraph's
//   level; on the built-in list it takes its paragraph's outline level, or one below the last
//   heading before it, or the first level; on any other list the first level.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { builtInListNumLevels, type ListNumLevel } from './field-listnum.ts';
import { listNumFieldsOf } from './field-listnum-scan.ts';
import {
  advanceListNumField,
  type ListCounterState,
  type ListNumLevelOf,
} from './list-counters.ts';
import {
  abstractNumNameOf,
  resolveNumberingLevel,
  type NumberingIndex,
} from './numbering-index.ts';

/** The built-in list's counter key; never a file id (an XML name cannot hold U+0000). */
const BUILT_IN_LIST_KEY = '\u0000listnum';

/** What a field needs to know about one numbered paragraph. */
interface NumberedContext {
  readonly numId: string;
  readonly abstractNumId: string;
  readonly ilvl: number;
}

/** The LISTNUM values one story walk produced. */
export interface ListNumValues {
  /** Display text by field anchor id. */
  readonly byAnchor: ReadonlyMap<string, string>;
  /** Display texts of each paragraph, folded into one token, by paragraph id. */
  readonly tokenByParagraph: ReadonlyMap<string, string>;
}

const valuesByItems = new WeakMap<object, ListNumValues>();

/**
 * A copy of a resolved item map that keeps the LISTNUM values recorded for the original. The
 * values are keyed by map identity, so a plain copy would lose them.
 */
export function copyListItemsWithListNum<K, V>(items: ReadonlyMap<K, V>): Map<K, V> {
  const copy = new Map(items);
  const values = valuesByItems.get(items);
  if (values) valuesByItems.set(copy, values);
  return copy;
}

/** The LISTNUM values recorded for a resolved item map, or undefined for none. */
export function listNumValuesOf(items: object | undefined): ListNumValues | undefined {
  return items ? valuesByItems.get(items) : undefined;
}

/** Counts the LISTNUM fields of a story walk; one per walk. */
export interface ListNumWalker {
  /**
   * Visit one walked paragraph after its own number counted. `numbered` is its counted list
   * reference, or null; `outlineLevel` is its outline level 0-8, or null for body text.
   */
  visit(
    paragraph: OoxmlElement,
    numbered: NumberedContext | null,
    outlineLevel: number | null
  ): void;
  /** Attach the recorded values to the walk's item map. */
  finish(items: object): void;
}

export function createListNumWalker(
  index: NumberingIndex,
  counters: ListCounterState
): ListNumWalker {
  let lastNumbered: NumberedContext | null = null;
  let lastHeading: number | null = null;
  const byAnchor = new Map<string, string>();
  const tokenByParagraph = new Map<string, string>();
  let byName: Map<string, string> | null = null;

  const namedAbstract = (name: string): string | undefined => {
    if (!byName) {
      byName = new Map();
      for (const [id, definition] of index.abstractNums) {
        const own = abstractNumNameOf(definition);
        if (own !== undefined && !byName.has(own)) byName.set(own, id);
      }
    }
    return byName.get(name.toLowerCase());
  };
  const abstractLevels =
    (abstractNumId: string): ListNumLevelOf =>
    (ilvl) =>
      index.abstractNums.get(abstractNumId)?.levels.get(ilvl);
  const numLevels =
    (numId: string): ListNumLevelOf =>
    (ilvl) =>
      resolveNumberingLevel(index, numId, ilvl)?.level;

  return {
    visit(paragraph, numbered, outlineLevel) {
      if (numbered) lastNumbered = numbered;
      if (outlineLevel !== null) lastHeading = outlineLevel;
      const fields = listNumFieldsOf(paragraph);
      if (fields.length === 0) return;
      const shown: string[] = [];
      // The level of the last field on each list in this paragraph.
      const levelInParagraph = new Map<string, number>();
      for (const field of fields) {
        const { name, level, start } = field.spec;
        let key: string;
        let levelOf: ListNumLevelOf;
        let context: NumberedContext | null = null;
        const named = name === null ? undefined : namedAbstract(name);
        if (named !== undefined) {
          key = named;
          levelOf = abstractLevels(named);
          context = lastNumbered?.abstractNumId === named ? lastNumbered : null;
        } else if (name === null && lastNumbered) {
          context = lastNumbered;
          key = context.abstractNumId;
          levelOf = numLevels(context.numId);
        } else {
          key = BUILT_IN_LIST_KEY;
          const builtIn: readonly ListNumLevel[] = builtInListNumLevels(name);
          levelOf = (ilvl) => builtIn[ilvl];
        }
        let ilvl: number;
        if (level !== null) ilvl = level;
        else if (context && context === numbered) ilvl = Math.min(8, context.ilvl + 1);
        else if (levelInParagraph.has(key)) ilvl = levelInParagraph.get(key)!;
        else if (context) ilvl = context.ilvl;
        else if (key === BUILT_IN_LIST_KEY) {
          ilvl = outlineLevel ?? (lastHeading === null ? 0 : Math.min(8, lastHeading + 1));
        } else ilvl = 0;
        levelInParagraph.set(key, ilvl);
        const text = advanceListNumField(counters, key, ilvl, levelOf, start ?? undefined);
        if (text === null || text.length === 0) continue;
        byAnchor.set(field.anchorId, text);
        shown.push(field.anchorId, text);
      }
      if (shown.length > 0) tokenByParagraph.set(paragraph.id, JSON.stringify(shown));
    },
    finish(items) {
      if (byAnchor.size > 0) valuesByItems.set(items, { byAnchor, tokenByParagraph });
    },
  };
}
