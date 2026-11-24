import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { buildNumberingIndex, type NumberingLevel } from '../layout/numbering-index.ts';

export interface HtmlNumberingIndex {
  readonly numToAbstract: ReadonlyMap<string, string>;
  readonly levelFormats: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly levelStarts: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly startOverrides: ReadonlyMap<string, number>;
  /** `w:lvlOverride/w:lvl` replacement formats, keyed `numId:ilvl`. */
  readonly formatOverrides: ReadonlyMap<string, string>;
  /** `w:numStyleLink` per abstract id: the numbering style holding the real levels. */
  readonly styleLinks: ReadonlyMap<string, string>;
}

/** The HTML-facing format of one level. `w:isLgl` (§17.9.9) renders decimal
 *  whatever the level declares — the same rule the painter applies, so the
 *  copied HTML never shows roman where the editor shows decimal. */
function levelFormat(level: NumberingLevel): string {
  return level.isLgl ? 'decimal' : level.numFmt;
}

/**
 * The copy lane's flat view over `layout/numbering-index.ts`'s
 * `buildNumberingIndex` — ONE parser of `numbering.xml`, so its caps
 * (MAX_NUMBERING_DEFINITIONS, MAX_LVL_OVERRIDES), duplicate rules and
 * hardenings apply to paint and copy alike instead of drifting apart.
 * Per ECMA-376 §17.9.11 an explicit `w:startOverride` outranks a replacement
 * level's own `w:start`.
 */
export function htmlNumberingIndexOf(root: OoxmlElement | null): HtmlNumberingIndex {
  const index = buildNumberingIndex(root);
  const numToAbstract = new Map<string, string>();
  const levelFormats = new Map<string, Map<string, string>>();
  const levelStarts = new Map<string, Map<string, number>>();
  const startOverrides = new Map<string, number>();
  const formatOverrides = new Map<string, string>();
  const styleLinks = new Map<string, string>();
  for (const [abstractId, abstract] of index.abstractNums) {
    if (abstract.numStyleLink !== undefined) styleLinks.set(abstractId, abstract.numStyleLink);
    const formats = new Map<string, string>();
    const starts = new Map<string, number>();
    for (const [ilvl, level] of abstract.levels) {
      formats.set(String(ilvl), levelFormat(level));
      starts.set(String(ilvl), level.start);
    }
    levelFormats.set(abstractId, formats);
    levelStarts.set(abstractId, starts);
  }
  for (const [numId, num] of index.nums) {
    numToAbstract.set(numId, num.abstractNumId);
    for (const [ilvl, override] of num.overrides) {
      const key = `${numId}:${ilvl}`;
      const start = override.startOverride ?? override.level?.start;
      if (start !== undefined) startOverrides.set(key, start);
      if (override.level !== undefined) formatOverrides.set(key, levelFormat(override.level));
    }
  }
  return { numToAbstract, levelFormats, levelStarts, startOverrides, formatOverrides, styleLinks };
}
