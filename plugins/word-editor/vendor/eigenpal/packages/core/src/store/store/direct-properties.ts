// What a node ITSELF authors, and how a property write is split per run.
//
// These are pure tree reads with no layout, no DOM and no session in them, and they live in the
// store lane because TWO lanes need the same answers: the editor's toolbar writes formatting
// through them, and the automation lane's object model writes formatting through them on a server
// where there is no layout at all. They used to live beside the surface, which put them out of
// reach of a DOM-free lane — and a second copy of "what does this run author" is exactly the kind
// of duplicate that ends with two lanes disagreeing about a run inside a hyperlink.
//
// THE BASE A WRITE MERGES AGAINST IS THE AUTHORED SET, never a cascade. `setRunProperties` and
// `setParagraphProperties` REPLACE the properties they name and DROP the authorable ones they do
// not, so a write has to carry the node's existing bag forward. Handing it a cascaded bag instead
// has two visible effects: names outside the accepted boundary (`w:lang`, `w:noProof`,
// `w:outlineLvl`) make the op refuse outright, and the ones that get through restate inherited
// values as direct formatting, so editing the style stops moving the text.
//
// `surface-formatting.ts` re-exports these under the names the editor lane already used.

import { findNode } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { nullRecord } from '../package/safe-record.ts';
import {
  clippedFormattableRuns,
  DEFAULT_FORMATTING_DISPLAY_MODE,
  formattableRunsOfParagraph,
  type FormattingDisplayMode,
  type FormattingRevisionAuthorFilter,
} from './formattable-runs.ts';
import { paragraphOffsetIndex, segmentsOf } from './tree-op-segments.ts';
import { formattingRunBesideRestrictedControl } from './tree-op-restricted-edge.ts';
import { noteReferenceEndingAt, noteTypingSourceRun } from './note-typing-boundary.ts';
import {
  containerIsComplexScript,
  withComplexScriptCompanions,
} from './complex-script-companions.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  type OoxmlProperty,
} from './tree-op-types.ts';

/** The D8 paragraph op vocabulary. */
export const AUTHORABLE_PARAGRAPH_PROPERTIES: ReadonlySet<string> = new Set(
  ACCEPTED_PARAGRAPH_PROPERTIES
);

/** The D8 run op vocabulary, for `w:rPr` on a run and on the paragraph mark alike. */
export const AUTHORABLE_RUN_PROPERTIES: ReadonlySet<string> = new Set(ACCEPTED_RUN_PROPERTIES);

/**
 * Whether an op may name this run property at all.
 *
 * The stored-marks lane needs this AT ARM TIME. Every other write reaches the store in the same
 * turn as the press, so a name the store refuses surfaces immediately; an ARMED property is not
 * applied until the user types, and it rides the keystroke's own transaction — a name outside the
 * vocabulary would take the typed characters down with it, silently, on every keystroke until the
 * caret moved.
 */
export function isAuthorableRunProperty(localName: string): boolean {
  return AUTHORABLE_RUN_PROPERTIES.has(localName);
}

/**
 * A node's own property container (`w:pPr`, `w:rPr`) among its children.
 *
 * A container the canonical read demoted to generic is still the node's own properties —
 * matching only the typed kind lost the whole set.
 */
export function propertyContainer(
  parent: OoxmlNode | null | undefined,
  kind: 'paragraphProperties' | 'runProperties',
  localName: 'pPr' | 'rPr'
): OoxmlNode | undefined {
  if (!parent || parent.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = parent.children;
  return children.find(
    (child) =>
      child.kind === kind ||
      (child.kind === 'generic' &&
        child.localName === localName &&
        child.namespaceUri === WML_NAMESPACE_URI)
  );
}

/** What a container itself authors, narrowed to the names an op is allowed to carry. */
export function authoredProperties(
  container: OoxmlNode | undefined,
  authorable: ReadonlySet<string>
): readonly OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const properties: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (
      child.kind === 'textValue' ||
      child.namespaceUri !== WML_NAMESPACE_URI ||
      !authorable.has(child.localName)
    )
      continue;
    // Null-prototype: these keys come from the file (D14).
    const attributes = nullRecord<string>();
    for (const entry of child.attributes) {
      if (entry.namespaceUri === WML_NAMESPACE_URI) attributes[entry.localName] = entry.value;
    }
    properties.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return properties;
}

/**
 * What a paragraph itself authors: its own `w:pPr`, narrowed to what an op can express.
 *
 * Properties outside the vocabulary are dropped from the OP, not from the paragraph: the applier
 * keeps every `w:pPr` child an op cannot name (the mark, `w:sectPr`, `w:pBdr`, `w:outlineLvl`)
 * exactly as authored.
 */
export function directParagraphProperties(
  part: OoxmlPart,
  paragraphId: string
): readonly OoxmlProperty[] {
  const paragraph = findNode(part, paragraphId);
  return authoredProperties(
    propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
    AUTHORABLE_PARAGRAPH_PROPERTIES
  );
}

/**
 * What a paragraph MARK itself authors: `w:pPr/w:rPr`, narrowed to the run vocabulary.
 *
 * Same rule as a run's own `w:rPr`, for the same reason — the mark is a run property container,
 * and `setParagraphMarkProperties` rewrites the names its op carries.
 */
export function directParagraphMarkProperties(
  part: OoxmlPart,
  paragraphId: string
): readonly OoxmlProperty[] {
  const paragraph = findNode(part, paragraphId);
  const pPr = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
  return authoredProperties(
    propertyContainer(pPr, 'runProperties', 'rPr'),
    AUTHORABLE_RUN_PROPERTIES
  );
}

/**
 * Merge properties into a set, replacing any entry with the same name.
 *
 * `setRunProperties` and `setParagraphProperties` REPLACE the whole container, so sending one
 * property alone deleted every other: pressing Bold stripped a run's font, size and colour, and
 * pressing Centre stripped a paragraph's style, numbering and indents.
 *
 * Takes one property or a list, because a toolbar press carries one and an object-model
 * formatting write carries several at once — and applying several one at a time would be the
 * same fold written at every call site.
 */
export function mergedProperties(
  existing: readonly OoxmlProperty[],
  incoming: OoxmlProperty | readonly OoxmlProperty[]
): OoxmlProperty[] {
  const additions = Array.isArray(incoming)
    ? (incoming as readonly OoxmlProperty[])
    : [incoming as OoxmlProperty];
  const names = new Set(additions.map((property) => property.localName));
  const kept = existing.filter((entry) => !names.has(entry.localName));
  return [...kept, ...additions];
}

/**
 * The four font SLOTS `w:rFonts` carries, and the theme reference that outranks each.
 *
 * One element, four independent scripts: Latin (`ascii`), Cyrillic and the rest of the
 * high range (`hAnsi`), East Asian, and complex script. A theme attribute names a slot
 * indirectly and WINS over the explicit name beside it, so a slot being set has to have its
 * theme reference cleared with it or the pick resolves back to the theme font.
 */
const FONT_SLOT_THEMES: ReadonlyMap<string, string> = new Map([
  ['ascii', 'asciiTheme'],
  ['hAnsi', 'hAnsiTheme'],
  ['eastAsia', 'eastAsiaTheme'],
  // Lowercase `t` is the schema's own spelling, not a typo (`CT_Fonts`).
  ['cs', 'cstheme'],
]);

/**
 * A `w:rFonts` write merged over what the run already authors, slot by slot.
 *
 * `w:rFonts` is the one run property carrying SEVERAL independent settings, so replacing it
 * wholesale to change the Latin font deleted the run's East Asian and complex-script faces
 * and its `w:hint`. That loss is invisible here — this engine resolves the Latin slot — and
 * shows up on save: CJK text in that run reopens in Word in a different font.
 *
 * `w:hint` rides along untouched. It says which slot ambiguous characters resolve through,
 * which is a property of the text, not of the font just picked.
 */
export function mergedFontProperty(
  authored: readonly OoxmlProperty[],
  incoming: OoxmlProperty
): OoxmlProperty {
  const existing = authored.find((entry) => entry.localName === 'rFonts')?.attributes;
  if (!existing) return incoming;
  const merged: Record<string, string> = { ...existing, ...(incoming.attributes ?? {}) };
  for (const slot of Object.keys(incoming.attributes ?? {})) {
    const theme = FONT_SLOT_THEMES.get(slot);
    if (theme) delete merged[theme];
  }
  return { localName: 'rFonts', attributes: merged };
}

/** Per-run UTF-16 ranges from `segmentsOf` (fields/notes collapse to one unit on begin). */
export function runAddressRanges(
  paragraph: Extract<OoxmlNode, { kind: 'paragraph' }>
): Map<string, { start: number; end: number }> {
  const runRanges = new Map<string, { start: number; end: number }>();
  for (const segment of segmentsOf(paragraph)) {
    const ids =
      segment.formatRunIds && segment.formatRunIds.length > 0
        ? segment.formatRunIds
        : segment.runId
          ? [segment.runId]
          : [];
    for (const runId of ids) {
      const existing = runRanges.get(runId);
      if (!existing) runRanges.set(runId, { start: segment.start, end: segment.end });
      else {
        existing.start = Math.min(existing.start, segment.start);
        existing.end = Math.max(existing.end, segment.end);
      }
    }
  }
  return runRanges;
}

/** Runs that own field-result formatting for atoms in this paragraph. */
export function formatOwnedRunIds(
  paragraph: Extract<OoxmlNode, { kind: 'paragraph' }>
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const segment of segmentsOf(paragraph)) {
    if (!segment.formatRunIds) continue;
    for (const runId of segment.formatRunIds) ids.add(runId);
  }
  return ids;
}

/** One run's share of a range edit: the slice it covers and the properties to write there. */
export interface RunPropertyEdit {
  readonly start: number;
  readonly end: number;
  readonly properties: readonly OoxmlProperty[];
  /**
   * When set, `setRunProperties` formats only these runs (field result ownership). Needed when
   * several result runs share one atom offset so each keeps its own merged bag.
   */
  readonly targetRunIds?: readonly string[];
}

/**
 * One incoming write merged over what the node authors, for the properties that carry
 * SEVERAL independent settings in one element.
 *
 * Almost every run property is one setting and replaces cleanly. Two are not: `w:rFonts`
 * carries a font per script (see {@link mergedFontProperty}), and `w:u` carries the
 * underline style AND its colour, so toggling the style off and on again dropped an
 * authored `w:color` and repainted a red underline black.
 *
 * Exported because the editor lane keeps its own content-control-aware run walk beside this
 * one, and the two must reach the same answer.
 */
export function mergedMultiSettingProperty(
  authored: readonly OoxmlProperty[],
  incoming: OoxmlProperty
): OoxmlProperty {
  if (incoming.localName === 'rFonts') return mergedFontProperty(authored, incoming);
  if (incoming.localName !== 'u') return incoming;
  const existing = authored.find((entry) => entry.localName === 'u')?.attributes;
  if (!existing) return incoming;
  return { localName: 'u', attributes: { ...existing, ...(incoming.attributes ?? {}) } };
}

/** Internal style context; direct formatting remains the only write base. */
export type ComplexScriptContext = (
  paragraph: OoxmlNode,
  container: OoxmlNode | undefined,
  mark: boolean,
  part: OoxmlPart,
  displayMode?: FormattingDisplayMode,
  authorFilter?: FormattingRevisionAuthorFilter
) => boolean;

/**
 * A paragraph MARK's own properties with one write merged in, per attribute where it counts.
 *
 * The mark carries a `w:rPr` like any run, so a font change has to keep its other font slots
 * for the same reason a run does — without this the marker of a CJK list item lost its East
 * Asian face while the text beside it kept one. Lives here because BOTH lanes write the mark:
 * the editor's toolbar and the automation object model.
 */

export function mergedParagraphMarkProperties(
  part: OoxmlPart,
  paragraphId: string,
  incoming: OoxmlProperty | readonly OoxmlProperty[]
): OoxmlProperty[] {
  return mergedParagraphMarkPropertiesWithContext(part, paragraphId, incoming);
}

export function mergedParagraphMarkPropertiesWithContext(
  part: OoxmlPart,
  paragraphId: string,
  incoming: OoxmlProperty | readonly OoxmlProperty[],
  context?: ComplexScriptContext
): OoxmlProperty[] {
  const authored = directParagraphMarkProperties(part, paragraphId);
  const pPr = propertyContainer(findNode(part, paragraphId), 'paragraphProperties', 'pPr');
  const paragraph = findNode(part, paragraphId);
  const container = propertyContainer(pPr, 'runProperties', 'rPr');
  const complex =
    context && paragraph
      ? context(paragraph, container, true, part)
      : containerIsComplexScript(container);
  return mergedProperties(authored, withMultiSettingsKept(authored, incoming, complex));
}

/**
 * A run write merged over the run's own properties the way a range write merges it:
 * multi-setting elements per attribute, and the complex-script companions on a `w:rtl`
 * or `w:cs` run. The caret's armed formatting lands through this, so typing after Bold
 * matches bolding a selection.
 */
export function mergedRunWrite(
  authored: readonly OoxmlProperty[],
  incoming: readonly OoxmlProperty[],
  complex: boolean
): OoxmlProperty[] {
  return mergedProperties(authored, withMultiSettingsKept(authored, incoming, complex));
}

/**
 * Whether the run the caret at `offset` types into is a complex-script run: the run ending
 * at the caret, else the one starting there, else the paragraph mark — the same owner
 * `authoredRunPropertiesAt` reads the typing format from.
 */
export function complexScriptAt(
  part: OoxmlPart,
  paragraphId: string,
  offset: number,
  context?: ComplexScriptContext,
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter
): boolean {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return false;
  const owner = formattingRunAt(paragraph, offset, displayMode, authorFilter);
  const container = owner
    ? propertyContainer(owner, 'runProperties', 'rPr')
    : propertyContainer(
        propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
        'runProperties',
        'rPr'
      );
  return context
    ? context(paragraph, container, false, part, displayMode, authorFilter)
    : containerIsComplexScript(container);
}

/** Internal shared caret owner for authored properties and effective formatting lanes. */
export function formattingRunAt(
  paragraph: OoxmlNode,
  offset: number,
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter
): OoxmlNode | null {
  if (paragraph.kind !== 'paragraph') return null;
  // After a note reference, the run whose face typing takes, never the reference run.
  if (noteReferenceEndingAt(paragraph, offset)) return noteTypingSourceRun(paragraph, offset);
  // Beside a control that typing cannot enter, the run the store will copy, whatever the view.
  const beside = formattingRunBesideRestrictedControl(
    paragraph,
    offset,
    paragraphOffsetIndex(paragraph)
  );
  if (beside !== undefined) return beside;
  const ranges = runAddressRanges(paragraph);
  let left: OoxmlNode | null = null;
  let right: OoxmlNode | null = null;
  for (const run of formattableRunsOfParagraph(paragraph, displayMode, authorFilter)) {
    const range = ranges.get(run.id);
    if (!range || range.end <= range.start) continue;
    if (range.start < offset && offset <= range.end) left = run;
    if (!right && range.start <= offset && offset < range.end) right = run;
  }
  return left ?? right;
}

/**
 * Where text typed at `offset` beside a control that typing cannot enter takes its formatting
 * from, for a reader that resolves formatting by offset, such as the toolbar: the offsets of
 * the source run, `null` when the text gets no direct formatting, or `undefined` when the
 * ordinary rule applies. See `formattingRunBesideRestrictedControl`.
 */
export function formattingRangeBesideRestrictedControl(
  paragraph: OoxmlNode,
  offset: number
): { readonly start: number; readonly end: number } | null | undefined {
  if (paragraph.kind !== 'paragraph') return undefined;
  const offsets = paragraphOffsetIndex(paragraph);
  const run = formattingRunBesideRestrictedControl(paragraph, offset, offsets);
  if (!run) return run;
  return offsets.spanOf(run) ?? undefined;
}

function withMultiSettingsKept(
  authored: readonly OoxmlProperty[],
  incoming: OoxmlProperty | readonly OoxmlProperty[],
  complex: boolean
): readonly OoxmlProperty[] {
  const additions = withComplexScriptCompanions(
    complex,
    Array.isArray(incoming) ? (incoming as readonly OoxmlProperty[]) : [incoming as OoxmlProperty]
  );
  return additions.map((property) => mergedMultiSettingProperty(authored, property));
}

/**
 * A range run-property change, split into ONE edit per run it covers, each merged over that
 * run's own `w:rPr`.
 *
 * Neither half of that is optional. The base MUST be the run's own properties (see this file's
 * header). And the split MUST be per run: the op REPLACES the properties it names across its
 * whole range, so one op carrying one run's bag over a mixed selection homogenised it — bolding
 * `hello ` + `Georgia` rewrote the second run's `w:rFonts` with the first's. Runs are addressed by
 * offset rather than by id because these edits apply in sequence and the applier splits runs at
 * the range edges; offsets are unmoved by a property write, ids are not.
 */
export function runPropertyEdits(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  incoming: OoxmlProperty | readonly OoxmlProperty[],
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter
): readonly RunPropertyEdit[] {
  return runPropertyEditsWithContext(
    part,
    paragraphId,
    start,
    end,
    incoming,
    displayMode,
    authorFilter
  );
}

export function runPropertyEditsWithContext(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  incoming: OoxmlProperty | readonly OoxmlProperty[],
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter,
  context?: ComplexScriptContext
): readonly RunPropertyEdit[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const edits: RunPropertyEdit[] = [];
  // Field/note atoms contribute one unit on the begin run (segmentsOf). Field format
  // ownership maps the atom onto result runs via `formatRunIds`.
  const formatOwned = formatOwnedRunIds(paragraph);
  // ONE container walk and ONE clip, shared with every other formatting question — see
  // `formattable-runs.ts`. Two lanes disagreeing about which runs a range covers is the whole
  // bug class this replaces.
  for (const covered of clippedFormattableRuns(
    paragraph,
    runAddressRanges(paragraph),
    start,
    end,
    displayMode,
    authorFilter
  )) {
    const container = propertyContainer(covered.run, 'runProperties', 'rPr');
    const authored = authoredProperties(container, AUTHORABLE_RUN_PROPERTIES);
    const complex = context
      ? context(paragraph, container, false, part, displayMode, authorFilter)
      : containerIsComplexScript(container);
    edits.push({
      start: covered.start,
      end: covered.end,
      properties: mergedProperties(authored, withMultiSettingsKept(authored, incoming, complex)),
      ...(formatOwned.has(covered.run.id) ? { targetRunIds: [covered.run.id] } : {}),
    });
  }
  return edits;
}

/**
 * The slices of `[start, end)` a formatting write may reach, coalesced, in document order.
 *
 * For the one write that does NOT split per run: the eraser states `properties: []` over a
 * whole range, and a single op there is right — clearing is the one change that legitimately
 * homogenises what it covers, since there is no bag to carry forward. But the applier derives
 * its run set from `segmentsOf`, which knows nothing about display modes, so one op over the
 * whole range reached hidden revision halves at the same offsets: erasing a visible selection
 * cleared a tracked deletion's `w:rPr` and — in suggesting mode — raised a review card for a
 * change nobody could see made.
 *
 * Slicing solves it without a per-run op: a hidden half is a GAP in the offset space between
 * two visible runs, so the ranges either side of it never coalesce across it.
 */
export function formattableRanges(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter
): readonly { readonly start: number; readonly end: number }[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph' || end <= start) return [];
  const slices: { start: number; end: number }[] = [];
  for (const covered of clippedFormattableRuns(
    paragraph,
    runAddressRanges(paragraph),
    start,
    end,
    displayMode,
    authorFilter
  )) {
    // Field result runs share ONE atom offset, so slices overlap as often as they abut.
    const last = slices[slices.length - 1];
    if (last && covered.start <= last.end) last.end = Math.max(last.end, covered.end);
    else slices.push({ start: covered.start, end: covered.end });
  }
  return slices;
}

/**
 * Every run that contributes at least one character of `[start, end)`, in document order.
 *
 * A COLLAPSED range answers the run it sits inside, which is what a caret reads. Callers that
 * want the empty answer for a collapsed range check the offsets themselves.
 */
export function runsCovering(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter
): readonly OoxmlNode[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const runRanges = runAddressRanges(paragraph);
  const runs: OoxmlNode[] = [];
  // The read must cover exactly the runs the write splits, so it walks through the same
  // shared container walk `runPropertyEdits` does.
  for (const run of formattableRunsOfParagraph(paragraph, displayMode, authorFilter)) {
    const range = runRanges.get(run.id);
    if (!range || range.end <= range.start) continue;
    const overlaps =
      end > start
        ? Math.max(range.start, start) < Math.min(range.end, end)
        : range.start <= start && start < range.end;
    if (overlaps) runs.push(run);
  }
  return runs;
}
