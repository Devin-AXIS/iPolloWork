import { blockMetadataIdentity } from '../layout/block-metadata-identity.ts';
// What a block list holds that page-level consumers need without its geometry: the review
// authors it names and whether it can paint a drawing at all.
//
// Both answers used to come from separate whole-list walks. A table edit that changes column
// widths replaces every page the table crosses, so each walk read every cell paragraph of the
// table on every keystroke. One walk now answers both, memoised on the list's identity.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from '../layout/semantic-records.ts';

export interface BlockContentSummary {
  /**
   * Every author the list attributes anything to, in reading order: text authors depth-first,
   * then cell-only authors depth-first. A repeated header row adds its cells, not its text.
   */
  readonly authors: readonly string[];
  /**
   * True when no paragraph at any depth, repeated header rows included, publishes an inline
   * drawing or a picture bullet. Story-level anchored drawings are the caller's to check.
   */
  readonly drawingFree: boolean;
}

const summaries = new WeakMap<object, BlockContentSummary>();

/**
 * The author of the first tracked format change in one run's properties: `''` when it names
 * none, `null` when there is no change.
 *
 * Property lists are short; scan them without retaining another entry for every run.
 */
function formatChangeAuthor(props: readonly OoxmlProperty[]): string | null {
  let author: string | null = null;
  for (const property of props) {
    if (property.localName !== 'rPrChange' && property.localName !== 'pPrChange') continue;
    author = property.attributes?.author ?? '';
    break;
  }
  return author;
}

export function blockContentSummary(blocks: readonly BlockFragmentRecord[]): BlockContentSummary {
  const identity = blockMetadataIdentity(blocks);
  const cached = summaries.get(identity);
  if (cached) return cached;
  const found: string[] = [];
  const seen = new Set<string>();
  let drawingFree = true;
  const see = (author: string): void => {
    // A MISSING `w:author` is not a person. `@w:author` is required by the schema and a
    // malformed file can still omit it, and recording `''` made the blank a roster entry that
    // took slot 0 — pushing the first real reviewer off the colour Word gives them, and
    // putting an empty, colour-consuming chip in any legend built from the roster. The review
    // queue's own walk already skips it, so recording it here made the two disagree.
    if (author === '' || seen.has(author)) return;
    seen.add(author);
    found.push(author);
  };
  const paragraph = (fragment: ParagraphFragmentRecord): void => {
    for (const property of fragment.props) {
      if (property.localName === 'pPrChange') see(property.attributes?.author ?? '');
    }
    for (const line of fragment.lines) {
      if (line.changeSites) for (const revision of line.changeSites) see(revision.author);
      for (const span of line.spans) {
        // Index loops with an explicit guard: `?? []` allocated a throwaway array and an
        // iterator for every untracked span, which is the overwhelming majority of them.
        const revisions = span.revisions;
        if (revisions !== undefined) {
          for (let i = 0; i < revisions.length; i += 1) see(revisions[i]!.author);
        }
        // A tracked FORMAT change alters no characters, so it appears in neither list.
        // `formatRevisionOf` defaults a missing `@w:author` to the empty string, which `see`
        // then drops: an anonymous change is not a person and must not take a ramp slot from
        // one. It paints in slot 0's colour as any unknown author does.
        const format = formatChangeAuthor(span.props);
        if (format !== null) see(format);
      }
    }
    for (const line of fragment.lines) {
      // Tracked inline DRAWINGS, after the line's spans: a reviewer whose only change is a
      // picture is still a reviewer, and leaving them out silently painted their cue in
      // slot 0's colour. A separate pass so a drawing mid-line cannot renumber the text
      // authors around it relative to the pre-#479 assignment.
      const drawings = line.drawings;
      if (drawings === undefined) continue;
      for (let i = 0; i < drawings.length; i += 1) {
        const revisions = drawings[i]!.revisions;
        if (revisions !== undefined) {
          for (let j = 0; j < revisions.length; j += 1) see(revisions[j]!.author);
        }
        // An inline text box paints its own story on this line. Layout gives a story inside
        // that story no text-box layout, so this descends one level at most.
        const story = drawings[i]!.accessibility.hidden ? undefined : drawings[i]!.textboxStory;
        if (story) for (const author of blockContentSummary(story.fragments).authors) see(author);
      }
    }
    // The paragraph MARK last: it carries no span of its own, and the pilcrow paints at the
    // END of the fragment's final line. Reading it first gave a reviewer who only pressed
    // Enter a lower slot than the author of the text beside them.
    const marks = fragment.markRevisions;
    if (marks) for (let i = 0; i < marks.length; i += 1) see(marks[i]!.author);
  };
  // Any drawing, hidden ones included, and any picture bullet: the resource walks read both.
  const mayDraw = (fragment: ParagraphFragmentRecord): void => {
    if (fragment.marker?.picture) drawingFree = false;
    for (const line of fragment.lines) if ((line.drawings?.length ?? 0) > 0) drawingFree = false;
  };
  // Cell-only revisions carry no text span attribution, and they rank after every text
  // author of the list. They are gathered in the same walk, in the same depth-first order,
  // and read once the text is done. A repeated header row adds its cells, not its text: the
  // text belongs to the row's first occurrence, which is where the reading order meets it.
  const cellAuthors: string[] = [];
  const walk = (items: readonly BlockFragmentRecord[], text: boolean): void => {
    for (const block of items) {
      if (block.kind === 'paragraph') {
        if (text) paragraph(block);
        if (drawingFree) mayDraw(block);
        continue;
      }
      for (const row of block.rows) {
        const rowText = text && !row.isHeaderRepeat;
        for (const cell of row.cells) {
          if (cell.revisionShadingAuthor) cellAuthors.push(cell.revisionShadingAuthor);
          walk(cell.blocks, rowText);
        }
      }
    }
  };
  walk(blocks, true);
  for (const author of cellAuthors) see(author);
  const summary: BlockContentSummary = { authors: found, drawingFree };
  summaries.set(identity, summary);
  return summary;
}
