import { visibleHyphenText } from './hyphen-text.ts';
import { resolveTocSources, type TocSourceHeading } from './toc-sources.ts';
import { fldCharType, isInstrTextNode, instrTextValue } from './field-nodes.ts';
import { sliceTocParagraph } from './toc-result.ts';
// Resolve a cached TOC result row back to the heading it stands for.
//
// A refresh that only rewrites page numbers must not assume the cached rows line up with the
// current outline: the whole reason the command exists is that they may not. Word matches a
// row to its heading through the row's own `PAGEREF`, so this reads the row's identity from
// the row — its hyperlink anchor first, its title text second — and never from its position.

import { buildBookmarkIndex } from './bookmarks.ts';
import { hyperlinkAnchorOf } from './hyperlink.ts';
import { findNode } from './ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH, nextInlineContainerDepth } from './ooxml-shared.ts';
import { tocEntryText, type TocOutlineHeading } from './toc-build.ts';
import type { DetectedToc } from './toc-detect.ts';

/** The anchor of the first `w:hyperlink` in a row, or undefined for a plain row. */
function rowAnchor(paragraph: OoxmlNode, depth = 0): string | undefined {
  if (paragraph.kind === 'textValue') return undefined;
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return undefined;
  if (paragraph.kind === 'hyperlink') {
    const anchor = hyperlinkAnchorOf(paragraph);
    if (anchor !== undefined && anchor.length > 0) return anchor;
  }
  const childDepth = nextInlineContainerDepth(paragraph, depth);
  for (const child of paragraph.children) {
    if (child.kind === 'textValue') continue;
    const nested = rowAnchor(child, childDepth);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Word can link a plain TOC row through PAGEREF without a hyperlink wrapper. */
function rowPageRefAnchor(paragraph: OoxmlNode): string | undefined {
  const stack: { instruction: string; separated: boolean }[] = [];
  let overflow = 0;
  let anchor: string | undefined;
  const read = (instruction: string) => {
    if (instruction.length > 256) return;
    const match = /^\s*PAGEREF\s+(?:"([^"\r\n]+)"|([^\s\\]+))/i.exec(instruction);
    anchor ??= match?.[1] ?? match?.[2];
  };
  const walk = (node: OoxmlNode, depth: number): void => {
    if (anchor || node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    const type = fldCharType(node);
    if (type === 'begin') {
      if (overflow || stack.length >= 4) overflow++;
      else stack.push({ instruction: '', separated: false });
      return;
    }
    if (type === 'end') {
      if (overflow) overflow--;
      else {
        const field = stack.pop();
        if (field) read(field.instruction);
      }
      return;
    }
    if (type === 'separate') {
      if (!overflow && stack.length) stack[stack.length - 1]!.separated = true;
      return;
    }
    if (!overflow && node.kind === 'fldSimple') {
      read(node.attributes.find((attr) => attr.localName === 'instr')?.value ?? '');
      return;
    }
    if (!overflow && isInstrTextNode(node)) {
      const field = stack[stack.length - 1];
      if (field && !field.separated) {
        const chunk = instrTextValue(node);
        field.instruction = (field.instruction + chunk).slice(0, 257);
      }
      return;
    }
    for (const child of node.children) walk(child, nextInlineContainerDepth(node, depth));
  };
  walk(paragraph, 0);
  return anchor;
}

/**
 * A row's title: the text before the tab that carries the page number.
 *
 * The final tab separates the page number; earlier tabs can belong to TC entry text.
 * Also try the complete title for entries whose page number is omitted.
 */
function rowTitles(paragraph: OoxmlNode): readonly string[] {
  let title = '';
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (node.localName === 'pPr' || node.localName === 'rPr') return;
    if (node.kind === 'tab' || node.localName === 'ptab') {
      title += '\t';
      return;
    }
    // The same text a heading's outline entry carries, so a row matches its source.
    const hyphen = visibleHyphenText(node);
    if (hyphen !== null) {
      title += hyphen;
      return;
    }
    if (node.kind === 'revisionDelete') return;
    if (node.kind === 'text') {
      for (const child of node.children) if (child.kind === 'textValue') title += child.value;
      return;
    }
    const childDepth = nextInlineContainerDepth(node, depth);
    for (const child of node.children) walk(child, childDepth);
  };
  walk(paragraph, 0);
  const pageTab = title.lastIndexOf('\t');
  return [tocEntryText(pageTab < 0 ? title : title.slice(0, pageTab)), tocEntryText(title)];
}

/** A stale cached label can still identify an omitted-number TC entry through its anchor. */
export function tocRowOmitsPageNumber(
  part: OoxmlPart,
  paragraph: OoxmlNode,
  sources: readonly TocSourceHeading[]
): boolean {
  const titles = rowTitles(paragraph);
  const fullTitle = titles[titles.length - 1];
  const anchor = rowAnchor(paragraph) ?? rowPageRefAnchor(paragraph);
  const target = anchor === undefined ? undefined : buildBookmarkIndex(part).get(anchor);
  if (!target) {
    return sources.some(
      (source) => source.omitPageNumber && tocEntryText(source.text) === fullTitle
    );
  }
  const candidates = sources.filter((source) => source.blockId === target.paragraphId);
  const matching = candidates.filter((source) => titles.includes(tocEntryText(source.text)));
  // One paragraph can carry several TC entries. Prefer an exact cached title match;
  // when every label is stale, preserve ambiguous titles instead of replacing one with a number.
  return (matching.length ? matching : candidates).some((source) => source.omitPageNumber);
}

/**
 * The heading each cached result row stands for, aligned with `toc.resultParagraphIds`.
 *
 * `null` for a row that names no heading this document still has — a stale row, or the
 * chrome/blank paragraphs a cached result can carry. Callers leave those alone rather than
 * writing another row's number into them.
 */
export function resolveTocRowHeadings(
  part: OoxmlPart,
  toc: DetectedToc,
  outline: readonly TocOutlineHeading[],
  excludeParagraphIds: ReadonlySet<string>
): readonly (string | null)[] {
  const candidates = (resolveTocSources(part, outline, toc.instruction) ?? []).filter(
    (heading) => !excludeParagraphIds.has(heading.blockId)
  );
  const byParagraphId = new Set(candidates.map((heading) => heading.blockId));

  const bookmarks = buildBookmarkIndex(part);
  // Titles are matched in document order and consumed as they are used, so two headings that
  // share a title still resolve to distinct rows.
  const unusedByTitle = new Map<string, string[]>();
  for (const heading of candidates) {
    const key = tocEntryText(heading.text);
    const bucket = unusedByTitle.get(key);
    if (bucket) bucket.push(heading.blockId);
    else unusedByTitle.set(key, [heading.blockId]);
  }

  return toc.resultParagraphIds.map((paragraphId) => {
    const paragraph = findNode(part, paragraphId);
    if (!paragraph || paragraph.kind === 'textValue') return null;

    const result = sliceTocParagraph(paragraph, toc, 'result');
    const anchor = rowAnchor(result) ?? rowPageRefAnchor(result);
    const anchored = anchor === undefined ? undefined : bookmarks.get(anchor);
    if (anchored && byParagraphId.has(anchored.paragraphId)) {
      const bucket = unusedByTitle.get(
        tocEntryText(
          candidates.find((heading) => heading.blockId === anchored.paragraphId)?.text ?? ''
        )
      );
      const at = bucket?.indexOf(anchored.paragraphId) ?? -1;
      if (bucket && at >= 0) bucket.splice(at, 1);
      return anchored.paragraphId;
    }

    for (const title of rowTitles(result)) {
      const bucket = unusedByTitle.get(title);
      if (bucket?.length) return bucket.shift() ?? null;
    }
    return null;
  });
}
