// The block that opens or closes a story, for writes addressed to the story's start or end.
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { removalEndsStoryWithTable } from '../store/package/ooxml-story-end-repair.ts';
import type { AutomationHandleTable } from './handles.ts';
import { PARAGRAPH_MARK_IN_TEXT } from './line-break-text.ts';
import type { AutomationParagraphRef } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationBlockRead, AutomationPackageReads } from './reads.ts';
import { storyOfHandle } from './spans.ts';

const BLOCKS = new Set(['p', 'tbl', 'sdt', 'customXml', 'altChunk']);

/**
 * The table that opens or closes the story a paragraph reference names by its edge, or null.
 * Its first or last paragraph is then inside a cell, so a paragraph written at that edge goes
 * beside the table instead of into the cell. A cell's body is its own story here.
 */
export function edgeTableOf(
  ref: AutomationParagraphRef,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): string | null {
  if (!('body' in ref)) return null;
  const story = storyOfHandle(ref.body, 'body', handles, reads);
  return story.ok ? storyEdgeTable(story.value.root, ref.at) : null;
}

function storyEdgeTable(root: OoxmlNode, at: 'first' | 'last'): string | null {
  if (root.kind === 'textValue') return null;
  const blocks = root.children.filter(
    (child) => child.kind !== 'textValue' && BLOCKS.has(child.localName)
  );
  const edge = at === 'first' ? blocks[0] : blocks[blocks.length - 1];
  return edge && edge.kind !== 'textValue' && edge.localName === 'tbl' ? edge.id : null;
}

/** The refusal for text that cannot be one paragraph's content, or null. */
export function paragraphTextRefusal(text: unknown): PlannedOperation | null {
  if (typeof text !== 'string')
    return {
      ok: false,
      error: {
        code: 'unsupported-content',
        message: 'insertParagraph needs text',
        detail: 'text',
      },
    };
  if (PARAGRAPH_MARK_IN_TEXT.test(text))
    return {
      ok: false,
      error: {
        code: 'unsupported-content',
        message: 'a paragraph mark inside a paragraph’s text is not written by this host',
        detail: 'paragraph-mark-in-text',
      },
    };
  return null;
}

/**
 * The removable paragraph a whole-story replace keeps to hold the text. With no other block
 * left, that is the first paragraph. A story the removal would leave ending with a table keeps
 * its last paragraph, as a deletion does (`ooxml-story-end-repair.ts`).
 */
export function storyKeeper(
  part: OoxmlPart,
  removed: readonly AutomationBlockRead[],
  survivors: number
): AutomationBlockRead | undefined {
  const paragraphs = removed.filter((block) => block.kind === 'paragraph');
  if (survivors === 0) return paragraphs[0];
  const ids = removed.map((block) => block.id);
  return removalEndsStoryWithTable(ids, (id) => parentNodeOf(part, id))
    ? paragraphs.at(-1)
    : undefined;
}
