// OOXML paragraph tab stops for shared paragraph flow (body, cells, headers, footers).
//
// Positions are twips → points relative to the paragraph content origin (the left edge of
// the flow box / page content). Custom stops come from cascaded `w:pPr/w:tabs`; when no
// explicit stop lies past the cursor, a bounded default-tab interval advances as a left tab.
// Right/center/decimal stops size the tab glyph from the measured following segment so the
// segment's end/center/decimal lands on the stop — never a mere cursor jump.
//
// Hostile authored values are dropped or clamped; stop count is capped; nothing from the
// file is used as a loop bound or allocation size.

import { readTwipsMeasure, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';

/** Soft ceiling matching Word's practical custom-tab UI limit. */
export const MAX_TAB_STOPS = 64;

/**
 * Soft ceiling on a tab position (31_680 twips ≈ 22"), matching paragraph-spacing bounds so
 * a hostile stop cannot shove layout into pathological widths.
 */
export const MAX_TAB_POSITION_TWIPS = 31_680;

/** OOXML / Word default when `w:settings/w:defaultTabStop` is absent: 720 twips = 0.5". */
export const DEFAULT_TAB_INTERVAL_TWIPS = 720;

/** The default tab interval in points — {@link DEFAULT_TAB_INTERVAL_TWIPS} converted. */
export const DEFAULT_TAB_INTERVAL_PT = DEFAULT_TAB_INTERVAL_TWIPS / 20;

/**
 * How a tab stop positions the text that follows it.
 *
 * Only `left` is a plain cursor jump. The other three size the tab glyph from the MEASURED
 * following segment, so its end, centre or decimal point lands on the stop.
 */
export type TabAlignment = 'left' | 'center' | 'right' | 'decimal';

/**
 * `w:tab/@w:leader` (ECMA-376 §17.3.1.38, ST_TabTlc): the character repeated across the
 * space a tab reserves. `none` is the default and is represented by an absent leader.
 *
 * This is the difference between a Word table of contents and a column of headings floating
 * next to a column of page numbers, so it is carried through layout to paint rather than
 * dropped as a geometry-irrelevant attribute.
 */
export type TabLeader = 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';

/**
 * The character each leader repeats (§17.3.1.38, ST_TabTlc).
 *
 * Lives with the type rather than with the painter because LAYOUT has to measure it: a
 * leader is the same character typed over and over, and the only way to space it the way
 * typing it would is to ask the measurer how wide it actually is.
 */
export const TAB_LEADER_GLYPH: ReadonlyMap<TabLeader, string> = new Map([
  ['dot', '.'],
  ['hyphen', '-'],
  ['underscore', '_'],
  ['heavy', '_'],
  ['middleDot', '\u00B7'],
]);

/**
 * The fields a `\t` span takes from the stop it reached: the stop's leader, with one leader
 * glyph measured by `measure` in the run's face, and the stop's alignment when it is not
 * `left`.
 */
export function tabStopSpanFields(
  destination: { readonly alignment: TabAlignment; readonly leader?: TabLeader },
  measure: (glyph: string) => number
): {
  readonly tabLeader?: TabLeader;
  readonly tabLeaderAdvancePt?: number;
  readonly tabAlignment?: Exclude<TabAlignment, 'left'>;
} {
  return {
    ...(destination.leader
      ? {
          tabLeader: destination.leader,
          tabLeaderAdvancePt: measure(TAB_LEADER_GLYPH.get(destination.leader) ?? '.'),
        }
      : {}),
    ...(destination.alignment !== 'left' ? { tabAlignment: destination.alignment } : {}),
  };
}

/** One authored `w:tab`: where it sits, how it aligns, and what fills the gap. */
export interface TabStop {
  /** Position from the paragraph content origin, in points. */
  readonly positionPt: number;
  readonly alignment: TabAlignment;
  /** Legacy `num` stop: positions a numbering suffix, not a tab in ordinary text. */
  readonly numberingOnly?: true;
  /**
   * Supplied at a hanging paragraph's text indent, not authored. It positions ordinary text
   * tabs only: the numbering suffix treats the indent by its own rule.
   */
  readonly implied?: true;
  /** Absent for `none` — the schema default and the overwhelming majority of stops. */
  readonly leader?: TabLeader;
}

/**
 * A paragraph's tab stops after the style cascade, with the default interval that applies past
 * the last explicit one.
 */
export interface ResolvedTabStops {
  /** Custom stops sorted by ascending position. */
  readonly stops: readonly TabStop[];
  /** Default-tab interval in points (always positive and bounded). */
  readonly defaultIntervalPt: number;
  /**
   * `w:doNotUseIndentAsNumberingTabStop` (§17.15.3): a numbering suffix tab goes to the
   * first authored stop past the marker, wherever it is, before it falls back to the indent.
   */
  readonly ignoreIndentAsNumberingTabStop?: true;
}

/** The frozen "no custom stops" value, so a paragraph without tabs mints no object. */
export const EMPTY_TAB_STOPS: ResolvedTabStops = Object.freeze({
  stops: Object.freeze([]),
  defaultIntervalPt: DEFAULT_TAB_INTERVAL_PT,
});

/**
 * `ST_TabJc` (§17.18.83) spellings this lane places, mapped to a physical alignment.
 *
 * `start`/`end` are the direction-relative names ISO 29500 Strict uses where Transitional
 * writes `left`/`right`, and a Strict-saved document writes nothing else. Dropping them
 * discarded the stop ENTIRELY — a right-aligned TOC stop became a default-interval left tab
 * and every page number in the table of contents slid inboard. `w:pPr/w:ind` and `w:jc`
 * already read the Strict spellings (`paragraph-style.ts`, `paragraph-flow.ts`); this makes
 * tabs agree with them. `num` is a legacy numbering-only stop; `bar` remains unhandled.
 *
 * This lane is left-to-right, so `start` is `left` and `end` is `right`, exactly as
 * `paragraphAlignment` resolves `w:jc`.
 */
const TAB_ALIGNMENTS = new Map<string, TabAlignment>([
  ['left', 'left'],
  ['start', 'left'],
  ['center', 'center'],
  ['right', 'right'],
  ['end', 'right'],
  ['decimal', 'decimal'],
]);

const TAB_LEADERS = new Set<string>(['dot', 'hyphen', 'underscore', 'heavy', 'middleDot']);

/** A resolved stop before ordering: position is the map key. */
interface TabStopEntry {
  readonly alignment: TabAlignment;
  readonly numberingOnly?: true;
  readonly leader?: TabLeader;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function childNamed(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

function integerTwips(raw: string | undefined): number | null {
  // Up to 9 integer digits so oversized values reach the clamp; longer strings are garbage.
  return readTwipsMeasure(raw);
}

function clampPositionTwips(twips: number): number | null {
  if (!Number.isFinite(twips)) return null;
  if (twips < 0) return null;
  return twips > MAX_TAB_POSITION_TWIPS ? MAX_TAB_POSITION_TWIPS : twips;
}

/**
 * Apply one `w:tabs` element onto a position→stop map.
 *
 * `clear` removes a stop at that position; recognised alignments upsert. Unknown `val` and
 * non-stop kinds (`bar`, …) are ignored. At most `MAX_TAB_STOPS` survive.
 */
function applyTabsElement(
  byTwips: Map<number, TabStopEntry>,
  tabs: OoxmlElement | undefined
): void {
  if (!tabs) return;
  // Cap the walk — never `tabs.children.length` as a bound for allocation.
  let seen = 0;
  for (const child of tabs.children) {
    if (seen >= MAX_TAB_STOPS * 2) break;
    seen += 1;
    if (!isElement(child) || child.localName !== 'tab') continue;
    const twips = clampPositionTwips(integerTwips(attributeValue(child, 'pos')) ?? NaN);
    if (twips === null) continue;
    const val = attributeValue(child, 'val') ?? 'left';
    if (val === 'clear') {
      byTwips.delete(twips);
      continue;
    }
    const alignment = val === 'num' ? 'left' : TAB_ALIGNMENTS.get(val);
    if (alignment === undefined) continue;
    if (byTwips.size >= MAX_TAB_STOPS && !byTwips.has(twips)) continue;
    // An unrecognised leader is `none`, not a rejected stop: the geometry is still authored.
    const leader = attributeValue(child, 'leader');
    byTwips.set(twips, {
      alignment,
      ...(val === 'num' ? { numberingOnly: true as const } : {}),
      ...(leader !== undefined && TAB_LEADERS.has(leader) ? { leader: leader as TabLeader } : {}),
    });
  }
}

function mapToResolved(
  byTwips: Map<number, TabStopEntry>,
  defaultIntervalPt: number = DEFAULT_TAB_INTERVAL_PT
): ResolvedTabStops {
  const ordered = [...byTwips.entries()].sort((a, b) => a[0] - b[0]);
  const stops: TabStop[] = [];
  for (let index = 0; index < ordered.length && index < MAX_TAB_STOPS; index += 1) {
    const [twips, entry] = ordered[index]!;
    stops.push({ positionPt: twips / 20, ...entry });
  }
  return {
    stops: Object.freeze(stops),
    defaultIntervalPt,
  };
}

/**
 * Resolve tab stops from cascaded `w:pPr` nodes (docDefaults → style chain → direct).
 *
 * Each `w:tabs` merges with `clear` support; absence inherits. The leader travels with the
 * stop that declared it — a `clear` at the same position discards both together.
 */
export function cascadedTabStops(paragraphPropertyNodes: readonly OoxmlNode[]): ResolvedTabStops {
  const byTwips = new Map<number, TabStopEntry>();
  for (const node of paragraphPropertyNodes) {
    if (!node || !isElement(node)) continue;
    applyTabsElement(byTwips, childNamed(node, 'tabs'));
  }
  return mapToResolved(byTwips);
}

/** Direct `w:pPr` only — used when no style cascade table is present. */
export function paragraphTabStops(pPr: OoxmlNode | undefined): ResolvedTabStops {
  if (!pPr || !isElement(pPr)) return EMPTY_TAB_STOPS;
  const byTwips = new Map<number, TabStopEntry>();
  applyTabsElement(byTwips, childNamed(pPr, 'tabs'));
  return mapToResolved(byTwips);
}

/**
 * Republish stops under a document-wide default-tab interval (`w:defaultTabStop`).
 *
 * The cascade resolves stops from the paragraph's own property chain, which cannot see
 * `settings.xml`; the interval is a document constant that arrives from the session. Returns
 * the input unchanged when nothing moves, so a cache-key fingerprint stays stable.
 */
export function withDefaultTabInterval(
  tabs: ResolvedTabStops,
  defaultIntervalPt: number | undefined
): ResolvedTabStops {
  if (defaultIntervalPt === undefined) return tabs;
  if (!Number.isFinite(defaultIntervalPt) || defaultIntervalPt <= 0) return tabs;
  if (defaultIntervalPt === tabs.defaultIntervalPt) return tabs;
  return { ...tabs, defaultIntervalPt };
}

/**
 * Read `w:settings/w:defaultTabStop` (ECMA-376 §17.15.1.25), in points.
 *
 * Word's own interval, not a constant: a metric-locale template writes `w:val="1134"` (2cm)
 * and every default-interval tab in the document lands on that grid instead of the 0.5"
 * one. The value is FILE-DERIVED, so a non-integer, non-positive or out-of-range `val` falls
 * back to the schema default rather than being trusted into layout arithmetic.
 *
 * `ST_TwipsMeasure` also admits a universal measure (`"2cm"`); Word writes plain twips, and
 * the spelled form falls back to the default rather than being parsed here.
 */
export function defaultTabIntervalFromSettings(settings: OoxmlNode | null | undefined): number {
  if (!settings || !isElement(settings)) return DEFAULT_TAB_INTERVAL_PT;
  const element = childNamed(settings, 'defaultTabStop');
  if (!element) return DEFAULT_TAB_INTERVAL_PT;
  const twips = integerTwips(attributeValue(element, 'val'));
  if (twips === null || twips <= 0 || twips > MAX_TAB_POSITION_TWIPS) {
    return DEFAULT_TAB_INTERVAL_PT;
  }
  return twips / 20;
}

/** Where one tab character lands: the resolved x, and the stop that decided it. */
export interface TabDestination {
  readonly positionPt: number;
  readonly alignment: TabAlignment;
  /** Leader of the stop that was reached; absent for `none` and for default-interval tabs. */
  readonly leader?: TabLeader;
}

/**
 * Next tab destination strictly past `currentX`, preferring custom stops then the default
 * interval. Destination is clamped to `rightEdge` so stops cannot escape the content box.
 */
export function nextTabDestination(
  tabs: ResolvedTabStops,
  currentX: number,
  rightEdge: number,
  forNumbering = false
): TabDestination {
  const edge = Math.max(currentX, rightEdge);
  for (const stop of tabs.stops) {
    if (stop.numberingOnly && !forNumbering) continue;
    if (stop.implied && forNumbering) continue;
    if (stop.positionPt > currentX) {
      return {
        positionPt: Math.min(stop.positionPt, edge),
        alignment: stop.alignment,
        ...(stop.leader ? { leader: stop.leader } : {}),
      };
    }
  }
  const interval = tabs.defaultIntervalPt > 0 ? tabs.defaultIntervalPt : DEFAULT_TAB_INTERVAL_PT;
  let next = Math.ceil((currentX + 1e-9) / interval) * interval;
  if (next <= currentX) next += interval;
  // A default-interval tab has no leader: only an authored `w:tab` can carry one.
  return {
    positionPt: Math.min(next, edge),
    alignment: 'left',
  };
}

/**
 * Width of a tab glyph so the following segment lands on the destination.
 *
 * `segmentWidth` / `decimalOffset` are already measured in points. Decimal offset is the
 * advance from the segment start to the decimal point (0 when none — treated like right).
 */
export function tabAdvanceWidth(
  alignment: TabAlignment,
  currentX: number,
  destinationX: number,
  segmentWidth: number,
  decimalOffset: number
): number {
  let target = destinationX;
  switch (alignment) {
    case 'center':
      target = destinationX - segmentWidth / 2;
      break;
    case 'right':
      target = destinationX - segmentWidth;
      break;
    case 'decimal':
      target = destinationX - decimalOffset;
      break;
    default:
      // left: following text starts at the stop
      target = destinationX;
  }
  const advance = target - currentX;
  return advance > 0 ? advance : 0;
}

/**
 * Stable fingerprint for layout cache keys — nested `w:tabs` are not in flat `OoxmlProperty`
 * bags, so style-inherited stops must be named explicitly or breaks would collide.
 */
export function tabStopsFingerprint(tabs: ResolvedTabStops): string {
  // The leader is in the key because the BREAK is what paint reads: a cached line reused
  // after a leader-only change would keep painting the old dots (or none).
  const stops = tabs.stops
    .map(
      (stop) =>
        `${stop.alignment}@${Math.round(stop.positionPt * 1000)}${stop.numberingOnly ? '#num' : ''}${stop.implied ? '#implied' : ''}${stop.leader ? `/${stop.leader}` : ''}`
    )
    .join(',');
  // The numbering rule moves a list's first line, so a break cached under the other rule
  // must not be reused.
  const rule = tabs.ignoreIndentAsNumberingTabStop ? '|numStop' : '';
  return `tabs(${stops}|d${Math.round(tabs.defaultIntervalPt * 1000)}${rule})`;
}
