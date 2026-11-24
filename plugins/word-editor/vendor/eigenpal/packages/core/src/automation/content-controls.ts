// The content controls of one story, as the protocol answers them.
//
// A CONTROL IS ADDRESSED BY ITS CANONICAL NODE, and `w:id` is answered as metadata beside it.
// The attribute is optional in the schema and unique nowhere, so a file may write none, or write
// 5 twice; a lane that used it as identity would leave the first control unreachable and make the
// second pair one object. Nesting is answered as nesting rather than flattened, because the
// controls of a control are not the controls of the story that holds it.
//
// Everything here is derived per operation from the current package. A control's text, its lock
// and the paragraphs it holds are all facts about the document NOW, and a read remembered from
// when the handle was minted would describe the document as it was.

import { LINE_BREAK_TEXT } from '../store/store/tree-op-inline-elements.ts';
import {
  contentControlContentNodeOf,
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  type ContentControlLock,
  type ContentControlProperties,
} from '../store/package/content-control-nodes.ts';
import { collectStoryParagraphs } from '../store/package/story-blocks.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import { contentControlLockAt } from '../store/store/tree-op-content-controls.ts';
import { paragraphModelTextOf } from '../store/store/paragraph-model-text.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { AutomationTextProjection } from './operations.ts';
import type { AutomationStoryReads } from './reads.ts';
import { projectParagraphText } from './text-projection.ts';

/**
 * Ceiling on how many controls one scope answers.
 *
 * A hostile document may declare a million; a caller iterating them would allocate a handle for
 * each. Past the bound the extra controls are still preserved on save — they are simply not
 * addressable, which is the fail-closed half of "unknown content never locks editing".
 */
const MAX_CONTROLS_PER_SCOPE = 10_000;

/** One content control of a story: what it is, and where its content sits. */
export interface AutomationContentControlRead {
  /** The canonical node id — the private half of the handle, never answered to a caller. */
  readonly nodeId: string;
  readonly properties: ContentControlProperties;
  /** The lock in force, including what an enclosing control imposes. */
  readonly lock: ContentControlLock;
  /** Paragraphs the control HOLDS. Empty for an inline control, which holds none. */
  readonly paragraphIds: readonly string[];
}

/**
 * The controls directly inside a scope, in document order.
 *
 * `scope` is a story root or one control's node; either way only its OWN controls are answered,
 * and a nested one is reached by asking the control that holds it.
 */
export function contentControlReads(
  reads: AutomationStoryReads,
  scope: OoxmlNode
): readonly AutomationContentControlRead[] {
  const out: AutomationContentControlRead[] = [];
  const root = scope.kind === 'contentControl' ? contentControlContentNodeOf(scope) : scope;
  if (!root) return out;
  for (const entry of contentControlsIn(root)) {
    // DIRECT children only: `contentControlsIn` walks the whole subtree, and a control with an
    // ancestor inside this scope belongs to that ancestor.
    if (entry.ancestors.length > 0) continue;
    if (out.length >= MAX_CONTROLS_PER_SCOPE) break;
    out.push(readOf(reads, entry.node));
  }
  return out;
}

/** One control's read, by the node a handle names. Null once the document no longer holds it. */
export function contentControlReadOf(
  reads: AutomationStoryReads,
  nodeId: string
): AutomationContentControlRead | null {
  for (const entry of contentControlsIn(reads.root)) {
    if (entry.node.id === nodeId) return readOf(reads, entry.node);
  }
  return null;
}

/** The node a handle names, for the operations that need the markup rather than the read. */
export function contentControlNodeOf(
  reads: AutomationStoryReads,
  nodeId: string
): OoxmlNode | null {
  for (const entry of contentControlsIn(reads.root)) {
    if (entry.node.id === nodeId) return entry.node;
  }
  return null;
}

function paragraphContainingControl(
  reads: AutomationStoryReads,
  nodeId: string
): OoxmlParagraphNode | null {
  for (const paragraphId of reads.paragraphIds) {
    const paragraph = reads.node(paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    if (contentControlsIn(paragraph).some((entry) => entry.node.id === nodeId)) return paragraph;
  }
  return null;
}

/**
 * The span a control's content covers, in the story's own addressing.
 *
 * A BLOCK control spans its first paragraph's start to its last paragraph's end. An INLINE one
 * spans the offsets its content occupies inside the paragraph that holds it — which is exactly
 * the contribution the offset walk already gives it, so a range read here and a caret placed
 * there agree by construction rather than by two derivations that happen to match.
 */
export function contentControlSpan(
  reads: AutomationStoryReads,
  node: OoxmlNode
): {
  readonly start: { readonly paragraphId: string; readonly offset: number };
  readonly end: { readonly paragraphId: string; readonly offset: number };
} | null {
  const held = paragraphsHeldBy(node);
  if (held.length > 0) {
    const first = held[0]!;
    const last = held[held.length - 1]!;
    const lastText = reads.rawText(last);
    if (lastText === null || !reads.has(first)) return null;
    return {
      start: { paragraphId: first, offset: 0 },
      end: { paragraphId: last, offset: lastText.length },
    };
  }
  // Inline controls can sit inside links, revisions, or other controls. The bounded shared
  // control index finds them at any supported depth, while the offset index remains authoritative.
  const paragraph = paragraphContainingControl(reads, node.id);
  if (!paragraph) return null;
  const span = paragraphOffsetIndex(paragraph).spanOf(node);
  if (!span) return null;
  return {
    start: { paragraphId: paragraph.id, offset: span.start },
    end: { paragraphId: paragraph.id, offset: span.end },
  };
}

function inlineContentControlText(
  reads: AutomationStoryReads,
  node: OoxmlNode,
  projection: Exclude<AutomationTextProjection, 'allMarkup'>
): string | null {
  const paragraph = paragraphContainingControl(reads, node.id);
  const content = contentControlContentNodeOf(node);
  if (!paragraph || !content) return null;
  const scopedParagraph: OoxmlParagraphNode = {
    ...paragraph,
    children: content.children as OoxmlParagraphNode['children'],
  };
  const rawText = paragraphModelTextOf(scopedParagraph);
  return projectParagraphText(scopedParagraph, rawText, projection).text;
}

/** The text the control encloses, as the document reads it. */
export function contentControlText(
  reads: AutomationStoryReads,
  node: OoxmlNode,
  projection: AutomationTextProjection = 'allMarkup'
): string {
  // Control values keep their established semantics. They omit struck text and paragraph marks.
  if (projection === 'allMarkup') return contentControlTextOf(node, LINE_BREAK_TEXT);
  // Project inline content from its own subtree. An enclosing revision changes placement,
  // but it does not erase the value returned for the control itself.
  const inlineText = inlineContentControlText(reads, node, projection);
  if (inlineText !== null) return inlineText;
  const span = contentControlSpan(reads, node);
  if (!span) return '';
  const first = reads.indexOf(span.start.paragraphId);
  const last = reads.indexOf(span.end.paragraphId);
  if (first < 0 || last < first) return '';
  const text: string[] = [];
  for (let index = first; index <= last; index += 1) {
    const paragraphId = reads.paragraphIds[index]!;
    const projected = reads.projectedText(paragraphId, projection);
    const raw = reads.rawText(paragraphId);
    if (!projected || raw === null) return '';
    text.push(
      projected.sliceRaw(
        index === first ? span.start.offset : 0,
        index === last ? span.end.offset : raw.length
      )
    );
  }
  return text.join('\r');
}

function readOf(reads: AutomationStoryReads, node: OoxmlNode): AutomationContentControlRead {
  return {
    nodeId: node.id,
    properties: contentControlPropertiesOf(node),
    lock: contentControlLockAt(reads.part, node.id),
    paragraphIds: paragraphsHeldBy(node),
  };
}

/** The paragraphs inside a control's content, flattening nested controls and tables. */
/** The paragraphs a block control holds, in reading order. Empty for an inline control. */
export function paragraphsHeldBy(node: OoxmlNode): readonly string[] {
  const content = contentControlContentNodeOf(node);
  if (!content) return [];
  const found: OoxmlNode[] = [];
  collectStoryParagraphs(content.children, found, 0);
  return found.map((paragraph) => paragraph.id);
}
