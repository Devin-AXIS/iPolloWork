// Where an empty section mark stays when a page break precedes it or it carries its own.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { paragraphSectionNode, type DocumentSection } from './section-properties.ts';

/** Paragraph properties, a bookmark, or a run that holds only its properties. */
const isBareMarkChild = (child: OoxmlNode): boolean =>
  child.kind === 'paragraphProperties' ||
  child.kind === 'bookmarkStart' ||
  child.kind === 'bookmarkEnd' ||
  (child.kind === 'run' && child.children.every((part) => part.kind === 'runProperties'));

/**
 * Whether a paragraph holds nothing but its mark: no run text, tab, break, drawing, or field.
 * Hidden text counts as content. Paragraph properties (numbering, borders, shading) do not.
 */
function holdsOnlyItsMark(paragraph: OoxmlElement): boolean {
  return paragraph.children.every(isBareMarkChild);
}

/** Paragraph-level markers that take no width: proofing state, permission and comment ranges. */
const INERT_MARKERS: ReadonlySet<string> = new Set([
  'proofErr',
  'permStart',
  'permEnd',
  'commentRangeStart',
  'commentRangeEnd',
]);

const isInertMarker = (child: OoxmlNode): boolean =>
  child.kind !== 'textValue' &&
  child.namespaceUri === WML_NAMESPACE_URI &&
  INERT_MARKERS.has(child.localName) &&
  child.children.length === 0;

/**
 * Run content that takes no width: a zero-length `w:t` and the saved last-rendered page break,
 * which records an earlier layout and breaks nothing. A space is text.
 */
const isInertRunPart = (part: OoxmlNode): boolean => {
  if (part.kind === 'runProperties') return true;
  if (part.kind === 'textValue' || part.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (part.localName === 't') {
    return part.children.every((text) => text.kind === 'textValue' && text.value === '');
  }
  return part.localName === 'lastRenderedPageBreak' && part.children.length === 0;
};

/**
 * `holdsOnlyItsMark`, and also inert markers and runs of inert content. Text, a space, a tab,
 * hidden text, a field, and unknown content still count. Only the page-break-before rule
 * uses it; the mark-only section test keeps `holdsOnlyItsMark`.
 */
function holdsOnlyInertContent(paragraph: OoxmlElement): boolean {
  return paragraph.children.every(
    (child) =>
      isBareMarkChild(child) ||
      isInertMarker(child) ||
      (child.kind === 'run' && child.children.every(isInertRunPart))
  );
}

/**
 * Whether a section is nothing but its own empty mark paragraph. Structural, so the section
 * loop can ask it before any section is laid out; the flow pass still makes the final call
 * with measured lines.
 */
function isMarkOnlySection(blocks: readonly OoxmlElement[], section: DocumentSection): boolean {
  if (section.blockEndExclusive - section.blockStart !== 1) return false;
  const block = blocks[section.blockStart];
  return (
    block?.kind === 'paragraph' &&
    paragraphSectionNode(block) !== undefined &&
    holdsOnlyItsMark(block)
  );
}

/**
 * Whether a section's block at `at` is an empty section mark after the section's content.
 * Such a mark ignores its own `w:pageBreakBefore`: it ends the section on the sheet that
 * content reached, and the next section's break type alone decides where that section
 * starts. A mark that is its section's only block is that section's content, so its page
 * break still applies.
 */
export function markIgnoresPageBreakBefore(
  block: OoxmlElement,
  at: number,
  sectionBlockCount: number
): boolean {
  return (
    at > 0 &&
    at === sectionBlockCount - 1 &&
    block.kind === 'paragraph' &&
    paragraphSectionNode(block) !== undefined &&
    holdsOnlyInertContent(block)
  );
}

/**
 * For each section, whether the empty mark that ends it may stay on the sheet a page break
 * just closed, instead of opening a sheet of its own.
 *
 * A page break followed by an empty section mark advances ONE sheet when the next section
 * opens a new sheet anyway. Mark-only sections that continue on the same sheet in between
 * change nothing, so the answer passes through them. A section with content that continues
 * the sheet stops it: that content starts after the break, and the mark goes with it. The
 * last section has nothing after it, so a trailing break there keeps its empty sheet.
 *
 * One backward sweep, so a run of mark-only sections costs one step each rather than one
 * walk each: the section count comes from the file.
 *
 * `sharesSheet(index)` says whether section `index` continues the sheet of section
 * `index - 1`.
 */
export function sectionMarksJoiningBreakSheet(
  sections: readonly DocumentSection[],
  blocks: readonly OoxmlElement[],
  sharesSheet: (index: number) => boolean
): boolean[] {
  const joins = new Array<boolean>(sections.length).fill(false);
  for (let index = sections.length - 2; index >= 0; index -= 1) {
    const next = index + 1;
    joins[index] =
      !sharesSheet(next) || (isMarkOnlySection(blocks, sections[next]!) && joins[next]!);
  }
  return joins;
}

/**
 * Whether a paragraph is a bare section mark: it carries a paragraph-level `w:sectPr` and holds
 * nothing but inert content. Such a mark paints neither its borders nor its shading.
 */
export function isBareSectionMark(paragraph: OoxmlElement): boolean {
  return paragraphSectionNode(paragraph) !== undefined && holdsOnlyInertContent(paragraph);
}
