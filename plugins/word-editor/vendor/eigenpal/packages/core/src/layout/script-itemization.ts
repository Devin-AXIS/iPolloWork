import type { BidiEmbeddingLevels } from './bidi.ts';
import type { TextDirection } from './shaped-run.ts';
import { withFontFamily, type ResolvedRunStyle } from './run-style.ts';
import { isEastAsiaHinted, type EastAsiaHintScope } from './east-asia-symbol-hint.ts';
import { segmentGraphemes } from './grapheme.ts';
import {
  classifyFontSlot,
  type FontSlot,
  type FontSlotClass,
} from '../store/package/font-slot-classes.ts';

export type { FontSlot };

/**
 * A run of text sharing one script, direction and font slot — the unit handed to the shaper.
 *
 * Shaping cannot span a script change: Arabic and Latin in one call would produce wrong joining
 * behaviour, so a run is itemized into these first.
 */
export interface ScriptItem {
  readonly from: number;
  readonly to: number;
  readonly direction: TextDirection;
  readonly bidiLevel: number;
  /** The shaping script. The public union restates the shared slot policy's set. */
  readonly script:
    | 'Zyyy'
    | 'Latn'
    | 'Grek'
    | 'Cyrl'
    | 'Hani'
    | 'Hebr'
    | 'Arab'
    | 'Deva'
    | 'Beng'
    | 'Thai'
    | 'Khmr';
  readonly slot: FontSlot;
}

// Fails to compile when the public script union and the shared slot policy drift apart.
type SameScripts = [ScriptItem['script'], FontSlotClass['script']] extends [
  FontSlotClass['script'],
  ScriptItem['script'],
]
  ? true
  : never;
const SCRIPTS_MATCH: SameScripts = true;
void SCRIPTS_MATCH;

type Classified = Omit<ScriptItem, 'from' | 'to' | 'direction' | 'bidiLevel'> | null;

/**
 * A code point whose script this engine does not itemize.
 *
 * Carries the offending `codePoint` so the caller can report which character stopped it, rather
 * than failing anonymously somewhere in the middle of a paragraph.
 */
export class UnsupportedScriptError extends Error {
  readonly name = 'UnsupportedScriptError';
  readonly code = 'unsupportedScript';
  readonly codePoint: number;

  constructor(codePoint: number) {
    super(`Unsupported Unicode script at U+${codePoint.toString(16).toUpperCase()}`);
    this.codePoint = codePoint;
  }
}

/** The shared slot policy (`classifyFontSlot`), throwing for scripts outside it. */
const classify = (codePoint: number): Classified => {
  const classified = classifyFontSlot(codePoint);
  if (classified === undefined) throw new UnsupportedScriptError(codePoint);
  return classified;
};

/**
 * Per-code-point classification with the inheritance passes applied: Common/inherited
 * characters take the preceding strong item's answer, and leading Common text takes the
 * following one. Shared by full itemization and the slot-only pass below.
 */
function classifiedCodePoints(
  text: string
): { from: number; to: number; classified: Classified }[] {
  const codePoints: { from: number; to: number; classified: Classified }[] = [];
  for (let from = 0; from < text.length;) {
    const codePoint = text.codePointAt(from)!;
    const to = from + (codePoint > 0xffff ? 2 : 1);
    codePoints.push({ from, to, classified: classify(codePoint) });
    from = to;
  }
  let inherited: Classified = null;
  for (const item of codePoints) {
    if (item.classified) inherited = item.classified;
    else if (inherited) item.classified = inherited;
  }
  inherited = null;
  for (let index = codePoints.length - 1; index >= 0; index -= 1) {
    const item = codePoints[index]!;
    if (item.classified) inherited = item.classified;
    else if (inherited) item.classified = inherited;
  }
  return codePoints;
}

/**
 * Split text into shapeable runs by script, bidi level and font slot.
 *
 * Consumes the bidi levels rather than re-deriving direction, so itemization and reordering agree
 * by construction instead of by two implementations happening to match.
 */
export function itemizeScriptFontSlots(
  text: string,
  paragraphOffset: number,
  embedding: BidiEmbeddingLevels
): readonly ScriptItem[] {
  const codePoints = classifiedCodePoints(text);

  const out: ScriptItem[] = [];
  const commonOnlySlot: FontSlot = codePoints.every(({ from }) => text.codePointAt(from)! <= 0x7f)
    ? 'ascii'
    : 'hAnsi';
  for (const item of codePoints) {
    const bidiLevel = embedding.levels[paragraphOffset + item.from] ?? 0;
    const direction: TextDirection = (bidiLevel & 1) === 1 ? 'rtl' : 'ltr';
    const classified =
      item.classified ??
      ({
        slot: commonOnlySlot,
        script: 'Zyyy',
      } as const);
    const previous = out.at(-1);
    if (
      previous &&
      previous.to === item.from &&
      previous.bidiLevel === bidiLevel &&
      previous.slot === classified.slot &&
      previous.script === classified.script
    ) {
      out[out.length - 1] = { ...previous, to: item.to };
    } else {
      out.push({
        from: item.from,
        to: item.to,
        direction,
        bidiLevel,
        script: classified.script,
        slot: classified.slot,
      });
    }
  }
  return out;
}

/**
 * The style a piece's text is MEASURED AND PAINTED in, given the font slot it carries.
 *
 * This is the measurer-boundary resolution: pieces and spans keep the run's real resolved
 * style — with `fontFamily` and `fontFamilyEastAsia` both intact, so formatting readback
 * and the format painter see the run as authored — and every consumer that turns text into
 * geometry or ink resolves the face through here. The derived object is memoized per
 * (style, family) by {@link withFontFamily}, so measurers amortizing over style identity
 * keep their caches.
 */
export function styleForFontSlot(
  style: ResolvedRunStyle,
  slot: FontSlot | undefined
): ResolvedRunStyle {
  if (slot !== 'eastAsia') return style;
  const family = style.fontFamilyEastAsia;
  return family === null ? style : withFontFamily(style, family);
}

/** An eastAsia-slot run of text inside segment `segment` of the classified sequence. */
export interface SegmentSlotRange {
  readonly segment: number;
  readonly from: number;
  readonly to: number;
}

/** How one code point participates in slot resolution. */
type SlotClass = 'eastAsia' | 'base' | 'common';

/**
 * {@link classify}, projected to the eastAsia-or-not question, never throwing.
 *
 * An unsupported code point answers 'base' — a strong classification confined to that one
 * character, so a single Tamil sign in a CJK piece costs itself the East Asian face and
 * nothing else.
 */
const slotClassOf = (codePoint: number): SlotClass => {
  let classified: Classified;
  try {
    classified = classify(codePoint);
  } catch (error) {
    if (error instanceof UnsupportedScriptError) return 'base';
    throw error;
  }
  if (classified === null) return 'common';
  return classified.slot === 'eastAsia' ? 'eastAsia' : 'base';
};

/** Whether `text` holds only code units below U+0080 — text that can never touch the eastAsia slot. */
const pureAscii = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) >= 0x80) return false;
  }
  return true;
};

/**
 * The `[from, to)` UTF-16 ranges that resolve through the `eastAsia` font slot, across a
 * SEQUENCE of text segments classified as one paragraph. Merged and in order; `[]` means
 * everything stays in the base (Latin) slots.
 *
 * One classification over the whole sequence, not one per segment, because Common
 * characters inherit from their strong neighbours and `w:t` boundaries are not script
 * boundaries: a fullwidth comma alone in its own run between two CJK runs is East Asian
 * text. Inheritance follows {@link itemizeScriptFontSlots} — preceding strong item first,
 * following strong item for leading Common text — with one restriction: an ASCII code
 * point NEVER resolves through the eastAsia slot, because ECMA-376 routes ASCII-range
 * characters through `w:ascii` and Word measures the `, ` in `中文, Hello` in the Latin
 * face. Which face a character uses does not depend on its embedding level, so this pass
 * is independent of bidi analysis.
 *
 * Cost discipline: a pure-ASCII segment (`charCodeAt` prescan) contributes its strong
 * class without per-code-point classification, so the pure-Latin paragraphs of a document
 * whose docDefaults author an East Asian face pay two compares per character, not a
 * classifier call.
 */
export function eastAsiaRunsOfSegments(
  segments: readonly string[],
  hintedSegments: readonly (boolean | EastAsiaHintScope)[] = []
): readonly SegmentSlotRange[] {
  const out: SegmentSlotRange[] = [];
  const addEastAsia = (segment: number, from: number, to: number): void => {
    const previous = out.at(-1);
    if (previous && previous.segment === segment && previous.to === from) {
      out[out.length - 1] = { segment, from: previous.from, to };
    } else {
      out.push({ segment, from, to });
    }
  };

  /** Strongly classified text seen so far, or null while only Common text has streamed by. */
  let precedingStrong: Exclude<SlotClass, 'common'> | null = null;
  // Segment only when the hint can change a face. Joining once keeps clusters intact
  // across w:t boundaries, without adding segmentation to ordinary Latin/CJK paragraphs.
  const needsGraphemes = segments.some((text, index) => {
    if (!hintedSegments[index] || pureAscii(text)) return false;
    for (const character of text) {
      if (isEastAsiaHinted(character.codePointAt(0)!, hintedSegments[index])) return true;
    }
    return false;
  });
  const graphemes = needsGraphemes ? segmentGraphemes(segments.join('')) : null;
  let graphemeIndex = 0;
  let segmentOffset = 0;
  let clusterHinted = false;
  /** Leading Common units waiting for the FOLLOWING strong item; `ascii` blocks eastAsia. */
  const pending: { segment: number; from: number; to: number; ascii: boolean }[] = [];
  const resolvePending = (strong: Exclude<SlotClass, 'common'>): void => {
    for (const unit of pending) {
      if (strong === 'eastAsia' && !unit.ascii) addEastAsia(unit.segment, unit.from, unit.to);
    }
    pending.length = 0;
  };

  for (let segment = 0; segment < segments.length; segment += 1) {
    const text = segments[segment]!;
    const offset = segmentOffset;
    segmentOffset += text.length;
    if (!graphemes && pureAscii(text)) {
      // Never eastAsia, so only the strong/Common distinction matters: any alphanumeric
      // is a strong Latin item; pure punctuation and whitespace stay transparent.
      if (/[0-9A-Za-z]/.test(text)) {
        resolvePending('base');
        precedingStrong = 'base';
      }
      continue;
    }
    for (let from = 0; from < text.length;) {
      let codePoint = text.codePointAt(from)!;
      let to = from + (codePoint > 0xffff ? 2 : 1);
      let hinted = false;
      if (graphemes) {
        const position = offset + from;
        while (graphemes[graphemeIndex]!.utf16To <= position) graphemeIndex += 1;
        const cluster = graphemes[graphemeIndex]!;
        codePoint = cluster.text.codePointAt(0)!;
        to = Math.min(text.length, cluster.utf16To - offset);
        if (position === cluster.utf16From) {
          clusterHinted = isEastAsiaHinted(codePoint, hintedSegments[segment]);
        }
        hinted = clusterHinted;
      }
      // The base selects the face for its whole cluster. Marks and ZWJ components
      // cannot select another face, even when a cluster crosses a text segment.
      // The hint changes the face, but preserves the base's script strength.
      if (hinted) {
        const underlyingClass = slotClassOf(codePoint);
        if (underlyingClass !== 'common') {
          resolvePending(underlyingClass);
          precedingStrong = underlyingClass;
        }
        addEastAsia(segment, from, to);
        from = to;
        continue;
      }
      const slotClass = slotClassOf(codePoint);
      if (slotClass === 'common') {
        if (precedingStrong === null) {
          pending.push({ segment, from, to, ascii: codePoint <= 0x7f });
        } else if (precedingStrong === 'eastAsia' && codePoint > 0x7f) {
          addEastAsia(segment, from, to);
        }
      } else {
        resolvePending(slotClass);
        precedingStrong = slotClass;
        if (slotClass === 'eastAsia') addEastAsia(segment, from, to);
      }
      from = to;
    }
  }
  // A sequence of nothing but Common text has no strong item to inherit from on either
  // side; it stays in the base slots, exactly as it did before slot resolution existed.
  //
  // Leading Common units resolve only once the strong item AFTER them arrives, and a hinted
  // symbol between the two is emitted first, so the list can be out of document order.
  // The consumer slices pieces with a monotonic cursor, so order and merge here.
  if (out.length < 2) return out;
  out.sort((a, b) => a.segment - b.segment || a.from - b.from);
  const merged: { segment: number; from: number; to: number }[] = [out[0]!];
  for (let index = 1; index < out.length; index += 1) {
    const range = out[index]!;
    const previous = merged[merged.length - 1]!;
    if (previous.segment === range.segment && range.from <= previous.to) {
      if (range.to > previous.to) merged[merged.length - 1] = { ...previous, to: range.to };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
