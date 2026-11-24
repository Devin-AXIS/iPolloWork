import type { StyleCascadeTable } from './style-cascade.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { DocumentSection } from './section-properties.ts';
import { paragraphMergeGroupOf, storyBlocks } from './story-roots.ts';

interface ParagraphSectionIndexMemo {
  blocks: readonly OoxmlElement[];
  boundsFingerprint: string;
  map: ReadonlyMap<string, number>;
}

const indexMemos = new WeakMap<object, ParagraphSectionIndexMemo>();
const tableParagraphIdMemos = new WeakMap<OoxmlNode, readonly string[]>();

function sectionBoundsFingerprint(
  sections: readonly DocumentSection[],
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): string {
  const bounds = sections
    .map((section) => `${section.blockStart}-${section.blockEndExclusive}`)
    .join(',');
  return `${displayMode};${authorFilter?.cacheKey ?? ''};${bounds}`;
}

function paragraphIdsRepresentedBy(paragraph: OoxmlElement): readonly string[] {
  const merge = paragraphMergeGroupOf(paragraph);
  return merge ? merge.members.map((member) => member.id) : [paragraph.id];
}

function tableParagraphIdsOf(table: OoxmlNode): readonly string[] {
  const cached = tableParagraphIdMemos.get(table);
  if (cached) return cached;
  const ids: string[] = [];
  const walk = (node: OoxmlNode, depth: number): void => {
    if (depth > 32 || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      ids.push(node.id);
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(table, 0);
  tableParagraphIdMemos.set(table, ids);
  return ids;
}

function blockParagraphIdsEqual(next: OoxmlElement, previous: OoxmlElement): boolean {
  if (next.kind !== previous.kind) return false;
  const nextIds =
    next.kind === 'paragraph' ? paragraphIdsRepresentedBy(next) : tableParagraphIdsOf(next);
  const previousIds =
    previous.kind === 'paragraph'
      ? paragraphIdsRepresentedBy(previous)
      : tableParagraphIdsOf(previous);
  return (
    nextIds.length === previousIds.length && nextIds.every((id, index) => id === previousIds[index])
  );
}

/** Map every laid-out paragraph identity, including absorbed merge members, to its section. */
export function paragraphSectionIndexOf(
  part: OoxmlPart,
  sections: readonly DocumentSection[],
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined,
  memoHost?: object,
  styles?: StyleCascadeTable,
  numberingIndex?: NumberingIndex
): ReadonlyMap<string, number> {
  const blocks = storyBlocks(part, displayMode, authorFilter, styles, numberingIndex);
  const boundsFingerprint = sectionBoundsFingerprint(sections, displayMode, authorFilter);
  const memo = memoHost ? indexMemos.get(memoHost) : undefined;
  if (
    memo?.boundsFingerprint === boundsFingerprint &&
    memo.blocks.length === blocks.length &&
    blocks.every(
      (block, index) =>
        block === memo.blocks[index] || blockParagraphIdsEqual(block, memo.blocks[index]!)
    )
  ) {
    memo.blocks = blocks;
    return memo.map;
  }
  const map = new Map<string, number>();
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    for (let index = section.blockStart; index < section.blockEndExclusive; index += 1) {
      const block = blocks[index];
      if (!block) continue;
      const ids =
        block.kind === 'paragraph' ? paragraphIdsRepresentedBy(block) : tableParagraphIdsOf(block);
      for (const id of ids) map.set(id, sectionIndex);
    }
  }
  if (memoHost) indexMemos.set(memoHost, { blocks, boundsFingerprint, map });
  return map;
}
