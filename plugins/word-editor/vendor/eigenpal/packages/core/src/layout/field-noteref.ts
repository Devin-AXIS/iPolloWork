// NOTEREF fields (§17.16.5.48): the number of the footnote/endnote whose reference mark sits
// inside the bookmarked range. The display number derives through the SAME numbering path the
// painter uses — `deriveNoteDisplayMarksResolved` over per-section resolved note properties —
// so the field and the note area cannot disagree on what a note is called. The parser arm
// lives with the REF grammar in `field-ref.ts`; this module owns resolution only.
//
// CONSTRAINTS, each falling back to the field's cached result (never a guess):
//   - Sites are collected pre-pagination, in document order over the body story blocks. A
//     kind whose numbering restarts `eachPage` is refused outright: page assignment does not
//     exist yet, and a guessed page paints exactly the wrong number the cache avoids.
//   - The scan reads the canonical tree, not a revision display mode's projection. A document
//     where hidden tracked deletions renumber notes keeps its NOTEREF caches through the
//     per-field calibration gate instead of painting a diverged value.
//   - `w:customMarkFollows` sites consume no automatic number and paint an authored glyph
//     this module never sees; a NOTEREF aimed at one stays cached.
//   - The note reference must sit inside the target paragraph's stretch of the bookmark —
//     the same in-paragraph deviation plain-REF extraction takes, and the same bound that
//     keeps a hostile range from widening any scan.
//
// Everything here is bounded: per-paragraph site scans ride the segment model and memoize on
// the immutable paragraph node, the story aggregate is capped, and the bookmark walk shares
// the field-scan budget and depth cap.

import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { noteIdOf, noteReferenceKindOf, type NoteKind } from '../store/package/note-nodes.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import {
  authoredDocumentEndnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
  type ResolvedEndnoteProperties,
  type ResolvedFootnoteProperties,
} from '../store/package/note-properties.ts';
import { segmentsOf } from '../store/store/tree-op-segments.ts';
import {
  consumeScanNode,
  createScanBudget,
  MAX_STORY_FIELD_SCAN_DEPTH,
} from './field-instruction.ts';
import { walkStoryParagraphs } from './list-resolve.ts';
import { deriveNoteDisplayMarksResolved, type NoteReferenceSite } from './note-numbering.ts';
import {
  enumerateDocumentSectionsFromBlocks,
  sectionPropertiesNodes,
} from './section-properties.ts';

/** Ceiling on note reference sites one story contributes; sites past it resolve to cache. */
const MAX_NOTEREF_SITES = 4096;

/** One section's block range, the minimum a site needs to pick its resolved properties. */
export interface NoteRefSectionRange {
  readonly blockStart: number;
  readonly blockEndExclusive: number;
}

/**
 * What NOTEREF resolution numbers against: the section bounds of the SAME walk that resolves
 * the fields, paired with the per-section note properties the notes pass numbers with —
 * the exact pairing `attachNotesToLayout` uses, so field and note area agree by construction.
 */
export interface NoteRefNumberingInput {
  readonly sections: readonly NoteRefSectionRange[];
  readonly footnotePropsBySection: readonly ResolvedFootnoteProperties[];
  readonly endnotePropsBySection: readonly ResolvedEndnoteProperties[];
  readonly documentFootnoteProps: ResolvedFootnoteProperties;
  readonly documentEndnoteProps: ResolvedEndnoteProperties;
}

/** The note-properties slice of a `NotesLayoutInput`, structural so no import cycle forms. */
export interface NoteRefNumberingSource {
  readonly footnotePropsBySection: readonly ResolvedFootnoteProperties[];
  readonly endnotePropsBySection: readonly ResolvedEndnoteProperties[];
  readonly documentFootnoteProps: ResolvedFootnoteProperties;
  readonly documentEndnoteProps: ResolvedEndnoteProperties;
}

/**
 * Memoized per source object: the notes input is session-stable and the section enumeration
 * is cached per blocks array, so an unchanged pass reuses the wrapper BY IDENTITY — which is
 * what keeps the REF context memo (validated on this identity) serving its no-change hit.
 */
const numberingInputMemos = new WeakMap<
  NoteRefNumberingSource,
  { sections: readonly NoteRefSectionRange[]; input: NoteRefNumberingInput }
>();

/** The layout pass's numbering input, from its notes input and its own section bounds. */
export function noteRefNumberingFromNotes(
  notes: NoteRefNumberingSource,
  sections: readonly NoteRefSectionRange[]
): NoteRefNumberingInput {
  const memo = numberingInputMemos.get(notes);
  if (memo && memo.sections === sections) return memo.input;
  const input: NoteRefNumberingInput = {
    sections,
    footnotePropsBySection: notes.footnotePropsBySection,
    endnotePropsBySection: notes.endnotePropsBySection,
    documentFootnoteProps: notes.documentFootnoteProps,
    documentEndnoteProps: notes.documentEndnoteProps,
  };
  numberingInputMemos.set(notes, { sections, input });
  return input;
}

/**
 * The save-refresh path's numbering input, rebuilt from the package the way the surface
 * builds its notes input (each section's own `w:sectPr` — a paragraph's, or the body-level one
 * for the final section — with only the endnote position falling back to settings.xml), so a
 * refreshed NOTEREF result carries the value the pages paint.
 */
export function noteRefNumberingForPart(
  pkg: OoxmlPackage,
  part: OoxmlPart,
  blocks: readonly OoxmlElement[]
): NoteRefNumberingInput {
  // settings.xml contributes only the endnote position; numbering is per section.
  const docEnAuthored = authoredDocumentEndnoteProperties(settingsPartOf(pkg));
  const documentFootnoteProps = resolveFootnoteProperties();
  const documentEndnoteProps = resolveEndnoteProperties(undefined, docEnAuthored);
  const sections = enumerateDocumentSectionsFromBlocks(part, blocks).sections;
  const sectPrs = sectionPropertiesNodes(part, blocks, sections);
  return {
    sections,
    footnotePropsBySection: sectPrs.map((sectPr) =>
      resolveFootnoteProperties(authoredFootnotePropertiesFromSectPr(sectPr))
    ),
    endnotePropsBySection: sectPrs.map((sectPr) =>
      resolveEndnoteProperties(authoredEndnotePropertiesFromSectPr(sectPr), docEnAuthored)
    ),
    documentFootnoteProps,
    documentEndnoteProps,
  };
}

/** One note reference mark inside a paragraph, before its section is known. */
interface ParagraphNoteSite {
  readonly nodeId: string;
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly customMarkFollows: boolean;
}
const EMPTY_SITES: readonly ParagraphNoteSite[] = Object.freeze([]);

function customMarkFollowsOf(node: OoxmlElement): boolean {
  for (const attribute of node.attributes) {
    if (attribute.localName !== 'customMarkFollows') continue;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI && attribute.namespaceUri !== '') continue;
    const value = attribute.value;
    return !(value === '0' || value === 'false' || value === 'off');
  }
  return false;
}

/**
 * Memoized per immutable paragraph node. Segment-aligned, like the lifecycle's own reference
 * scan: only typed `noteReference` nodes count, so generic/demoted wrappers never invent a
 * numbered site the painter would not number.
 */
const paragraphNoteSites = new FieldResultsModeMemo<OoxmlElement, readonly ParagraphNoteSite[]>();

function noteSitesOfParagraph(paragraph: OoxmlElement): readonly ParagraphNoteSite[] {
  const memo = paragraphNoteSites.get(paragraph);
  if (memo) return memo;
  let sites: ParagraphNoteSite[] | null = null;
  for (const segment of segmentsOf(paragraph as OoxmlParagraphNode)) {
    const node = segment.node;
    if (node.kind !== 'noteReference') continue;
    const noteKind = noteReferenceKindOf(node);
    const noteId = noteIdOf(node);
    if (noteKind === null || noteId === null) continue;
    (sites ??= []).push({
      nodeId: node.id,
      noteKind,
      noteId,
      customMarkFollows: customMarkFollowsOf(node),
    });
  }
  const result = sites === null ? EMPTY_SITES : Object.freeze(sites);
  paragraphNoteSites.set(paragraph, result);
  return result;
}

/** The painter's per-section fallback chain, verbatim: section entry, section 0, document. */
function footnotePropsAt(
  input: NoteRefNumberingInput,
  sectionIndex: number
): ResolvedFootnoteProperties {
  return (
    input.footnotePropsBySection[sectionIndex] ??
    input.footnotePropsBySection[0] ??
    input.documentFootnoteProps
  );
}
function endnotePropsAt(
  input: NoteRefNumberingInput,
  sectionIndex: number
): ResolvedEndnoteProperties {
  return (
    input.endnotePropsBySection[sectionIndex] ??
    input.endnotePropsBySection[0] ??
    input.documentEndnoteProps
  );
}

const EMPTY_MARK_INDEX: ReadonlyMap<string, string> = new Map();

/**
 * Memo per blocks array, validated on the numbering input's identity (see the wrapper memo).
 * Built from the mode-keyed note sites, so it is keyed on the field-result mode too.
 */
const markIndexMemos = new FieldResultsModeMemo<
  readonly OoxmlElement[],
  { input: NoteRefNumberingInput; index: ReadonlyMap<string, string> }
>();

/**
 * Reference-mark node id → the display number the painter gives that citation, over the body
 * story blocks in document order. Built lazily (only a story that holds a NOTEREF pays for
 * it) and memoized on the blocks array, so a repeated resolve is a pointer lookup.
 */
export function noteRefMarkIndex(
  blocks: readonly OoxmlElement[],
  input: NoteRefNumberingInput
): ReadonlyMap<string, string> {
  const memo = markIndexMemos.get(blocks);
  if (memo && memo.input === input) return memo.index;

  const footnoteSites: NoteReferenceSite[] = [];
  const footnoteNodeIds: string[] = [];
  const endnoteSites: NoteReferenceSite[] = [];
  const endnoteNodeIds: string[] = [];
  let total = 0;
  let sectionCursor = 0;
  for (
    let blockIndex = 0;
    blockIndex < blocks.length && total < MAX_NOTEREF_SITES;
    blockIndex += 1
  ) {
    while (
      sectionCursor < input.sections.length - 1 &&
      blockIndex >= input.sections[sectionCursor]!.blockEndExclusive
    ) {
      sectionCursor += 1;
    }
    const sectionIndex = input.sections.length > 0 ? sectionCursor : 0;
    for (const paragraph of walkStoryParagraphs([blocks[blockIndex]!])) {
      for (const site of noteSitesOfParagraph(paragraph)) {
        // Sites past the cap resolve to the cached result; the prefix keeps painter order,
        // so every number BELOW the cap is still the number the note area shows.
        if (total >= MAX_NOTEREF_SITES) break;
        total += 1;
        const reference: NoteReferenceSite = {
          noteId: site.noteId,
          sectionIndex,
          customMarkFollows: site.customMarkFollows,
        };
        if (site.noteKind === 'footnote') {
          footnoteSites.push(reference);
          footnoteNodeIds.push(site.nodeId);
        } else {
          endnoteSites.push(reference);
          endnoteNodeIds.push(site.nodeId);
        }
      }
    }
  }

  let index: Map<string, string> | null = null;
  const addKind = (
    kind: NoteKind,
    sites: readonly NoteReferenceSite[],
    nodeIds: readonly string[],
    propsAt: (sectionIndex: number) => ResolvedFootnoteProperties | ResolvedEndnoteProperties
  ): void => {
    if (sites.length === 0) return;
    // `eachPage` restart needs the page each site lands on, which only pagination knows.
    // Check the same list the fallback chain can consult, and refuse the kind whole.
    const consulted =
      kind === 'footnote'
        ? input.footnotePropsBySection.length > 0
          ? input.footnotePropsBySection
          : [input.documentFootnoteProps]
        : input.endnotePropsBySection.length > 0
          ? input.endnotePropsBySection
          : [input.documentEndnoteProps];
    if (consulted.some((props) => props.numRestart === 'eachPage')) return;
    const marks = deriveNoteDisplayMarksResolved(kind, sites, propsAt);
    for (let i = 0; i < marks.length; i += 1) {
      const mark = marks[i]!.mark;
      const nodeId = nodeIds[i];
      // A suppressed mark (customMarkFollows) never joins: its citation paints an authored
      // glyph, and a NOTEREF at it keeps the cache.
      if (mark !== null && mark.length > 0 && nodeId !== undefined) {
        (index ??= new Map()).set(nodeId, mark);
      }
    }
  };
  addKind('footnote', footnoteSites, footnoteNodeIds, (si) => footnotePropsAt(input, si));
  addKind('endnote', endnoteSites, endnoteNodeIds, (si) => endnotePropsAt(input, si));

  const result: ReadonlyMap<string, string> = index ?? EMPTY_MARK_INDEX;
  markIndexMemos.set(blocks, { input, index: result });
  return result;
}

function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

/** First note-reference id per (target paragraph, name), memoized on the immutable node. */
const bookmarkNoteRefMemos = new WeakMap<OoxmlElement, Map<string, string | null>>();

/**
 * The FIRST typed note reference between the named `w:bookmarkStart` and its matching
 * `w:bookmarkEnd` (same `w:id`), or to the paragraph's end when the range runs past it —
 * the plain-REF extraction bound. Null when the range holds none.
 */
export function firstNoteReferenceIdInBookmark(
  paragraph: OoxmlElement,
  name: string
): string | null {
  let memo = bookmarkNoteRefMemos.get(paragraph);
  const cached = memo?.get(name);
  if (cached !== undefined) return cached;

  let collecting = false;
  let done = false;
  let endId: string | undefined;
  let found: string | null = null;
  const budget = createScanBudget();

  const visit = (node: OoxmlNode, depth: number, containerDepth: number): void => {
    if (done || node.kind === 'textValue') return;
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (budget.exhausted || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'bookmarkStart') {
      if (!collecting && wmlAttribute(node, 'name') === name) {
        collecting = true;
        endId = wmlAttribute(node, 'id');
      }
      return;
    }
    if (node.kind === 'bookmarkEnd') {
      if (collecting && endId !== undefined && wmlAttribute(node, 'id') === endId) done = true;
      return;
    }
    if (collecting && node.kind === 'noteReference') {
      found = node.id;
      done = true;
      return;
    }
    if (!consumeScanNode(budget)) return;
    const nextDepth = nextInlineContainerDepth(node, containerDepth);
    for (const child of node.children) visit(child, depth + 1, nextDepth);
  };
  for (const child of paragraph.children) {
    if (done || !consumeScanNode(budget)) break;
    visit(child, 1, 0);
  }

  if (!memo) {
    memo = new Map();
    bookmarkNoteRefMemos.set(paragraph, memo);
  }
  memo.set(name, found);
  return found;
}
