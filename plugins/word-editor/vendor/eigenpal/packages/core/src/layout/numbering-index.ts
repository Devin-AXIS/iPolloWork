import { withNumberingParagraphProperties } from './numbering-paragraph-properties.ts';
// Bounded projection of `/word/numbering.xml` for semantic list layout.
//
// Projection only — never mutation or serialization authority. Hostile values are dropped
// or clamped; missing definitions resolve to "no list" rather than guessing.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { readTwipsMeasure, WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import { propertiesOfRunContainer } from './field-projection.ts';
import {
  readNumberingPictureBullets,
  type NumberingPictureBullet,
} from './numbering-picture-bullet.ts';

/** Soft ceiling on abstractNum / num entries read from one part. */
export const MAX_NUMBERING_DEFINITIONS = 512;

/** Soft ceiling on override entries per `w:num`. */
export const MAX_LVL_OVERRIDES = 9;

/** Maximum hanging / indent magnitude from a level, in points (≈22"). */
export const MAX_LEVEL_INDENT_PT = 31_680 / 20;

/**
 * Soft ceiling on a `w:numStyleLink` chain (§17.9.21).
 *
 * A definition delegates to a style, whose `w:numPr` names a `w:num`, whose abstract may
 * delegate again. Real templates never chain; the cap plus the visited set is what stops a
 * file-authored cycle from spinning here.
 */
export const MAX_NUM_STYLE_LINK_HOPS = 8;

/** Style ids are bounded strings; a link target longer than this is not one. */
const MAX_STYLE_LINK_LENGTH = 128;

/** `w:suff` — what separates a list marker from the text after it. */
export type ListSuffix = 'tab' | 'space' | 'nothing';
/** `w:lvlJc` — how a list marker aligns within its own indent. */
export type ListMarkerAlign = 'left' | 'center' | 'right';

/**
 * One level's indent, plus which parts the level actually AUTHORED.
 *
 * The provenance matters: `w:ind` cascades per-attribute, so a level that authored only `left`
 * must not overwrite an inherited `hanging` with a synthesized zero.
 */
export interface NumberingLevelIndent {
  /**
   * The sides as the level spells them, in points. `left` and `start` both name the leading
   * indent, and `right` and `end` the trailing one; `left`/`right` below hold those two.
   */
  readonly authored?: {
    readonly left?: number;
    readonly right?: number;
    readonly start?: number;
    readonly end?: number;
  };
  readonly left: number;
  readonly right: number;
  readonly hanging: number;
  readonly firstLine: number;
  /**
   * Which of these the LEVEL actually authored.
   *
   * A level's `w:pPr/w:ind` sits between the formatting it outranks and the formatting that
   * outranks it (`mergeListIndent`), so the merge has to tell "the level says left = 0" from
   * "the level says nothing about left and the style's value stands". Absent (the default) reads as "says nothing", which is what a
   * hand-built level in a test means.
   */
  readonly stated?: {
    readonly left: boolean;
    readonly right: boolean;
    /** `w:hanging`/`w:firstLine` are one mutually exclusive slot (§17.3.1.10, §17.3.1.12). */
    readonly firstLineOffset: boolean;
  };
}

/** One `w:lvl`: how this depth numbers, what its marker looks like, and how it indents. */
export interface NumberingLevel {
  readonly ilvl: number;
  readonly start: number;
  readonly numFmt: string;
  readonly lvlText: string;
  readonly lvlJc: ListMarkerAlign;
  readonly suff: ListSuffix;
  readonly indent: NumberingLevelIndent;
  /**
   * `w:lvlRestart` one-based trigger level, or `0` when the level never restarts.
   * Omitted in XML → restart when the previous level (or any earlier level) is used.
   */
  readonly lvlRestart?: number;
  /**
   * `w:isLgl` (§17.9.9): render EVERY level referenced by this level's `w:lvlText` in
   * decimal, whatever number format those levels declare for themselves.
   */
  readonly isLgl: boolean;
  /**
   * `w:lvlPicBulletId` (§17.9.12): this level's marker is the `w:numPicBullet` of that id,
   * drawn INSTEAD of `w:lvlText`. Absent on every ordinary level.
   */
  readonly picBulletId?: string;
  /**
   * `w:pStyle` (§17.9.23): the paragraph style this level is linked to, as in a heading
   * numbering. A paragraph that joins the list at this level takes that style.
   */
  readonly pStyle?: string;
  /** Level `w:rPr` as flat properties (for marker face / vanish). */
  readonly runProperties: readonly OoxmlProperty[];
  /** True when level run props request vanish — marker must not paint. */
  readonly vanish: boolean;
}

/**
 * One `w:lvlOverride` on a `w:num`: a restart value, a replacement level, or both.
 *
 * How two lists share an abstract definition while numbering independently.
 */
export interface LevelOverride {
  readonly startOverride?: number;
  /** Full level replacement when `w:lvl` is present under the override. */
  readonly level?: NumberingLevel;
}

/**
 * One `w:abstractNum` — the shape of a list, without being a list.
 *
 * Never referenced by a paragraph directly. Paragraphs name a {@link NumDefinition}, which names
 * one of these, so several lists can share a definition and still count separately.
 */
export interface AbstractNumDefinition {
  readonly abstractNumId: string;
  readonly levels: ReadonlyMap<number, NumberingLevel>;
  /**
   * `w:numStyleLink` (§17.9.21): this definition carries no levels of its own — the numbering
   * lives on the named style. Word follows the link; resolve it with
   * {@link resolveNumberingStyleLinks} before reading levels, or every paragraph on this
   * abstract renders with NO marker at all.
   */
  readonly numStyleLink?: string;
  /**
   * `w:styleLink` (§17.9.23): the definition side of the same pair — this abstract IS the
   * numbering of the named style. Kept so a link can be verified rather than assumed.
   */
  readonly styleLink?: string;
}

/**
 * One `w:num` — the thing a paragraph's `w:numId` actually names.
 *
 * Points at an {@link AbstractNumDefinition} and may override any of its levels.
 */
export interface NumDefinition {
  readonly numId: string;
  readonly abstractNumId: string;
  readonly overrides: ReadonlyMap<number, LevelOverride>;
}

/**
 * The bounded projection of `numbering.xml` that list layout resolves against.
 *
 * Projection ONLY — never a mutation or serialization authority. Hostile values are dropped or
 * clamped, and a missing definition resolves to "no list" rather than a guess.
 */
export interface NumberingIndex {
  readonly abstractNums: ReadonlyMap<string, AbstractNumDefinition>;
  readonly nums: ReadonlyMap<string, NumDefinition>;
  /**
   * `w:numPicBullet` declarations keyed by `w:numPicBulletId` (§17.9.20).
   *
   * Optional so a hand-built index stays valid; absent reads as "this part declares none",
   * which is what a level's `w:lvlPicBulletId` then falls back from.
   */
  readonly pictureBullets?: ReadonlyMap<string, NumberingPictureBullet>;
}

function isWml(node: OoxmlNode, localName: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function attr(element: OoxmlElement, localName: string): string | undefined {
  for (const a of element.attributes) {
    if (a.localName === localName) return a.value;
  }
  return undefined;
}

function child(element: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const c of element.children) {
    if (isWml(c, localName)) return c;
  }
  return undefined;
}

function integerAttr(raw: string | undefined, allowNegative = false): number | null {
  if (raw === undefined) return null;
  if (!(allowNegative ? /^-?\d{1,9}$/ : /^\d{1,9}$/).test(raw)) return null;
  return Number(raw);
}

/** An unsigned twips attribute: a negative value is not a measurement. */
function unsignedTwips(raw: string | undefined): number | null {
  const value = readTwipsMeasure(raw);
  return value !== null && value >= 0 ? value : null;
}

function clampNonNegativePt(twips: number): number {
  const pt = twips / 20;
  if (!Number.isFinite(pt) || pt <= 0) return 0;
  return pt > MAX_LEVEL_INDENT_PT ? MAX_LEVEL_INDENT_PT : pt;
}

/**
 * Clamp a SIGNED indent (`ST_SignedTwipsMeasure`) to the bounded range.
 *
 * `w:ind/@w:start`(`left`) and `@w:end`(`right`) are signed in CT_Ind (§17.3.1.12): Word
 * honours a negative one by pulling the paragraph OUT into the margin. Clamping it to zero
 * moved the whole list back to the text edge. Magnitude is still bounded both ways, because
 * the value is file-derived.
 */
function clampSignedPt(twips: number): number {
  const pt = twips / 20;
  if (!Number.isFinite(pt)) return 0;
  if (pt > MAX_LEVEL_INDENT_PT) return MAX_LEVEL_INDENT_PT;
  if (pt < -MAX_LEVEL_INDENT_PT) return -MAX_LEVEL_INDENT_PT;
  return pt;
}

function parseIndent(pPr: OoxmlElement | undefined): NumberingLevelIndent {
  const empty = { left: 0, right: 0, hanging: 0, firstLine: 0 };
  if (!pPr) return empty;
  const ind = child(pPr, 'ind');
  if (!ind) return empty;
  const authored: { left?: number; right?: number; start?: number; end?: number } = {};
  for (const side of ['left', 'right', 'start', 'end'] as const) {
    const value = readTwipsMeasure(attr(ind, side));
    if (value !== null) authored[side] = clampSignedPt(value);
  }
  const leftTwips = readTwipsMeasure(attr(ind, 'left') ?? attr(ind, 'start'));
  const rightTwips = readTwipsMeasure(attr(ind, 'right') ?? attr(ind, 'end'));
  // `w:hanging` is unsigned in the schema, and a negative one is meaningless: the hanging
  // slot cannot be to the RIGHT of the text it hangs from.
  const hangingTwips = unsignedTwips(attr(ind, 'hanging'));
  // `w:firstLine` is declared unsigned, but Word's model keeps ONE signed first-line indent
  // where negative means hanging — which is why the two attributes are mutually exclusive.
  // A negative one is therefore read as authored rather than flattened to zero.
  const firstLineTwips = readTwipsMeasure(attr(ind, 'firstLine'));
  return {
    ...(authored.start !== undefined || authored.end !== undefined ? { authored } : {}),
    left: leftTwips === null ? 0 : clampSignedPt(leftTwips),
    right: rightTwips === null ? 0 : clampSignedPt(rightTwips),
    hanging: hangingTwips === null ? 0 : clampNonNegativePt(hangingTwips),
    firstLine: firstLineTwips === null ? 0 : clampSignedPt(firstLineTwips),
    stated: {
      left: leftTwips !== null,
      right: rightTwips !== null,
      firstLineOffset: hangingTwips !== null || firstLineTwips !== null,
    },
  };
}

function parseSuffix(raw: string | undefined): ListSuffix {
  if (raw === 'space') return 'space';
  if (raw === 'nothing') return 'nothing';
  return 'tab';
}

function parseAlign(raw: string | undefined): ListMarkerAlign {
  if (raw === 'center') return 'center';
  if (raw === 'right' || raw === 'end') return 'right';
  return 'left';
}

/** `CT_OnOff` child element: present means on unless it explicitly says otherwise. */
function onOffChild(parent: OoxmlElement, localName: string): boolean {
  const element = child(parent, localName);
  if (!element) return false;
  const val = attr(element, 'val');
  return val !== '0' && val !== 'false' && val !== 'off';
}

/** Bounded read of a link target (`w:styleLink` / `w:numStyleLink` `@w:val`). */
function linkTarget(lvlParent: OoxmlElement, localName: string): string | undefined {
  const element = child(lvlParent, localName);
  if (!element) return undefined;
  const val = attr(element, 'val');
  if (val === undefined || val.length === 0 || val.length > MAX_STYLE_LINK_LENGTH) return undefined;
  return val;
}

function toggleOn(props: readonly OoxmlProperty[], localName: string): boolean {
  for (const property of props) {
    if (property.localName !== localName) continue;
    const val = property.attributes?.val;
    if (val === '0' || val === 'false') return false;
    return true;
  }
  return false;
}

function parseLevel(lvl: OoxmlElement): NumberingLevel | null {
  const ilvlRaw = integerAttr(attr(lvl, 'ilvl'));
  if (ilvlRaw === null || ilvlRaw < 0 || ilvlRaw > 8) return null;

  const startNode = child(lvl, 'start');
  let startVal = 1;
  if (startNode) {
    const parsed = integerAttr(attr(startNode, 'val'));
    if (parsed !== null && parsed >= 0) startVal = Math.min(parsed, 9999);
  }

  const numFmtNode = child(lvl, 'numFmt');
  const numFmtVal = (numFmtNode ? attr(numFmtNode, 'val') : undefined) ?? 'decimal';

  const lvlTextNode = child(lvl, 'lvlText');
  const lvlText = lvlTextNode ? (attr(lvlTextNode, 'val') ?? '') : '';

  const lvlJcNode = child(lvl, 'lvlJc');
  const lvlJc = parseAlign(lvlJcNode ? attr(lvlJcNode, 'val') : undefined);

  const suffNode = child(lvl, 'suff');
  const suff = parseSuffix(suffNode ? attr(suffNode, 'val') : undefined);

  const lvlRestartNode = child(lvl, 'lvlRestart');
  let lvlRestart: number | undefined;
  if (lvlRestartNode) {
    const parsed = integerAttr(attr(lvlRestartNode, 'val'));
    if (parsed !== null && parsed >= 0 && parsed <= 9) lvlRestart = parsed;
  }

  const picBulletNode = child(lvl, 'lvlPicBulletId');
  const picBulletRaw = picBulletNode ? attr(picBulletNode, 'val') : undefined;
  const picBulletId =
    picBulletRaw !== undefined && picBulletRaw.length > 0 && picBulletRaw.length <= 64
      ? picBulletRaw
      : undefined;

  const pStyle = linkTarget(lvl, 'pStyle');
  const pPr = child(lvl, 'pPr');
  const rPr = child(lvl, 'rPr');
  const runProperties = rPr ? propertiesOfRunContainer(rPr) : [];

  return withNumberingParagraphProperties(
    {
      ilvl: ilvlRaw,
      start: startVal,
      numFmt: numFmtVal.length > 64 ? 'decimal' : numFmtVal,
      lvlText: lvlText.length > 64 ? lvlText.slice(0, 64) : lvlText,
      lvlJc,
      suff,
      indent: parseIndent(pPr),
      ...(lvlRestart !== undefined ? { lvlRestart } : {}),
      ...(picBulletId !== undefined ? { picBulletId } : {}),
      ...(pStyle !== undefined ? { pStyle } : {}),
      isLgl: onOffChild(lvl, 'isLgl'),
      runProperties,
      vanish: toggleOn(runProperties, 'vanish'),
    },
    pPr
  );
}

function parseAbstractNum(node: OoxmlElement): AbstractNumDefinition | null {
  const abstractNumId = attr(node, 'abstractNumId');
  if (abstractNumId === undefined || abstractNumId.length === 0 || abstractNumId.length > 64) {
    return null;
  }
  const levels = new Map<number, NumberingLevel>();
  for (const childNode of node.children) {
    if (!isWml(childNode, 'lvl')) continue;
    if (levels.size >= 9) break;
    const level = parseLevel(childNode);
    if (level && !levels.has(level.ilvl)) levels.set(level.ilvl, level);
  }
  const numStyleLink = linkTarget(node, 'numStyleLink');
  const styleLink = linkTarget(node, 'styleLink');
  const name = child(node, 'name');
  const nameValue = name ? attr(name, 'val') : undefined;
  return {
    abstractNumId,
    levels,
    ...(numStyleLink !== undefined ? { numStyleLink } : {}),
    ...(styleLink !== undefined ? { styleLink } : {}),
    // A symbol key, so the public definition type stays as it is; a copy keeps it.
    ...(nameValue && nameValue.length <= 255 ? { [abstractNumNameKey]: nameValue } : {}),
  };
}

const abstractNumNameKey = Symbol('abstract-num-name');

/** The `w:name` of an abstract list, lower-cased, or undefined when it states none. */
export function abstractNumNameOf(definition: AbstractNumDefinition): string | undefined {
  return (definition as { [abstractNumNameKey]?: string })[abstractNumNameKey]?.toLowerCase();
}

function parseOverride(node: OoxmlElement): { ilvl: number; override: LevelOverride } | null {
  const ilvl = integerAttr(attr(node, 'ilvl'));
  if (ilvl === null || ilvl < 0 || ilvl > 8) return null;
  const startNode = child(node, 'startOverride');
  let startOverride: number | undefined;
  if (startNode) {
    const parsed = integerAttr(attr(startNode, 'val'));
    if (parsed !== null && parsed >= 0) startOverride = Math.min(parsed, 9999);
  }
  const lvlNode = child(node, 'lvl');
  const level = lvlNode ? (parseLevel(lvlNode) ?? undefined) : undefined;
  if (startOverride === undefined && level === undefined) {
    return { ilvl, override: {} };
  }
  return {
    ilvl,
    override: {
      ...(startOverride !== undefined ? { startOverride } : {}),
      ...(level ? { level } : {}),
    },
  };
}

function parseNum(node: OoxmlElement): NumDefinition | null {
  const numId = attr(node, 'numId');
  if (numId === undefined || numId.length === 0 || numId.length > 64) return null;
  const absRef = child(node, 'abstractNumId');
  const abstractNumId = absRef ? attr(absRef, 'val') : undefined;
  if (!abstractNumId || abstractNumId.length > 64) return null;

  const overrides = new Map<number, LevelOverride>();
  for (const childNode of node.children) {
    if (!isWml(childNode, 'lvlOverride')) continue;
    if (overrides.size >= MAX_LVL_OVERRIDES) break;
    const parsed = parseOverride(childNode);
    if (parsed && !overrides.has(parsed.ilvl)) overrides.set(parsed.ilvl, parsed.override);
  }
  return { numId, abstractNumId, overrides };
}

/**
 * Build a numbering index from the root of a numbering part (`w:numbering`).
 *
 * Empty / missing roots yield an empty index. Duplicate ids keep the first definition.
 */
/**
 * Project `numbering.xml` into the bounded index.
 *
 * Every ceiling here exists because the input is file-derived: definition counts, override
 * counts, indent magnitudes and style-link hop depth are all capped, and nothing from the file
 * becomes a loop bound or an allocation size.
 */
export function buildNumberingIndex(
  root: OoxmlElement | null | undefined,
  pictureBulletPixelHeight?: (relationshipId: string) => number | undefined
): NumberingIndex {
  const abstractNums = new Map<string, AbstractNumDefinition>();
  const nums = new Map<string, NumDefinition>();
  if (!root) {
    return { abstractNums, nums };
  }

  let abstractCount = 0;
  let numCount = 0;
  for (const childNode of root.children) {
    if (isWml(childNode, 'abstractNum')) {
      if (abstractCount >= MAX_NUMBERING_DEFINITIONS) continue;
      abstractCount += 1;
      const def = parseAbstractNum(childNode);
      if (def && !abstractNums.has(def.abstractNumId)) {
        abstractNums.set(def.abstractNumId, def);
      }
      continue;
    }
    if (isWml(childNode, 'num')) {
      if (numCount >= MAX_NUMBERING_DEFINITIONS) continue;
      numCount += 1;
      const def = parseNum(childNode);
      if (def && !nums.has(def.numId)) nums.set(def.numId, def);
    }
  }

  const pictureBullets = readNumberingPictureBullets(root, pictureBulletPixelHeight);
  return pictureBullets.size > 0 ? { abstractNums, nums, pictureBullets } : { abstractNums, nums };
}

/**
 * `styleId` → the `w:numId` that style's `w:numPr` names, or undefined.
 *
 * Supplied by the caller because styles.xml is not this module's material. Every value it
 * returns is file-derived and is only ever used as a lookup key here.
 */
export type NumberingStyleLookup = (styleId: string) => string | undefined;

/**
 * Follow one abstract definition's `w:numStyleLink` chain to the definition that owns levels.
 *
 * `numStyleLink` → style → the style's `w:numId` → that num's abstract. Word's own
 * List Bullet / List Number styles are exactly this shape. Returns null when the chain
 * breaks or CYCLES (a style whose numbering links back to itself is reachable from any
 * `.docx`, so the visited set is a guard, not a nicety).
 */
function followNumStyleLink(
  index: NumberingIndex,
  start: AbstractNumDefinition,
  lookup: NumberingStyleLookup
): AbstractNumDefinition | null {
  const visited = new Set<string>([start.abstractNumId]);
  let current = start;
  for (let hop = 0; hop < MAX_NUM_STYLE_LINK_HOPS; hop += 1) {
    const link = current.numStyleLink;
    if (link === undefined) return current;
    const numId = lookup(link);
    if (numId === undefined) return null;
    const num = index.nums.get(numId);
    if (!num) return null;
    const next = index.abstractNums.get(num.abstractNumId);
    if (!next || visited.has(next.abstractNumId)) return null;
    visited.add(next.abstractNumId);
    current = next;
  }
  return null;
}

/**
 * Resolve `w:numStyleLink` delegation against a style→numId lookup (§17.9.21).
 *
 * A delegating abstract has no `w:lvl` of its own, so without this every paragraph on it
 * resolves to no level, no marker text, and renders as plain text with the bullet MISSING.
 * Returns the input unchanged when nothing delegates, so layout cache identity is kept, and
 * is idempotent: re-resolving an already-linked index changes nothing.
 */
export function resolveNumberingStyleLinks(
  index: NumberingIndex,
  lookup: NumberingStyleLookup
): NumberingIndex {
  let changed = false;
  const abstractNums = new Map(index.abstractNums);
  for (const [id, definition] of index.abstractNums) {
    if (definition.numStyleLink === undefined) continue;
    const target = followNumStyleLink(index, definition, lookup);
    if (!target || target.levels === definition.levels || target.levels.size === 0) continue;
    // The link is kept so the resolve is idempotent and the delegation stays inspectable.
    abstractNums.set(id, { ...definition, levels: target.levels });
    changed = true;
  }
  if (!changed) return index;
  return index.pictureBullets
    ? { abstractNums, nums: index.nums, pictureBullets: index.pictureBullets }
    : { abstractNums, nums: index.nums };
}

/** Resolve the effective level for a `numId` + `ilvl`, applying overrides. */
/**
 * The effective level for one paragraph's numbering reference, after overrides and style links.
 *
 * Answers null for a reference the index cannot resolve — a paragraph naming a definition the
 * file never declared is an unnumbered paragraph, not an error.
 */
export function resolveNumberingLevel(
  index: NumberingIndex,
  numId: string,
  ilvl: number
): {
  readonly abstractNumId: string;
  readonly level: NumberingLevel;
  readonly startOverride?: number;
} | null {
  if (ilvl < 0 || ilvl > 8) return null;
  const num = index.nums.get(numId);
  if (!num) return null;
  const abstract = index.abstractNums.get(num.abstractNumId);
  if (!abstract) return null;
  const override = num.overrides.get(ilvl);
  const level = override?.level ?? abstract.levels.get(ilvl);
  if (!level) return null;
  return {
    abstractNumId: num.abstractNumId,
    level,
    ...(override?.startOverride !== undefined ? { startOverride: override.startOverride } : {}),
  };
}

/** Empty index for tests / documents without numbering. */
export const EMPTY_NUMBERING_INDEX: NumberingIndex = Object.freeze({
  abstractNums: new Map(),
  nums: new Map(),
});
