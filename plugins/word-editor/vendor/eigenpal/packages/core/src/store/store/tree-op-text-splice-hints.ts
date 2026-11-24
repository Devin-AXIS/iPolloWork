// Where an insertion lands in the text values beside its paragraph offset, for the journal.
import {
  isCanonicalPrimitiveCaptureActive,
  withTextSpliceHints,
} from '../package/canonical-primitive-capture.ts';
import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';

/**
 * Run an insertion at `offset` of a paragraph with the offset it names in each text value that
 * holds or borders it. Text compared before and after reads typing `[` before a `[` as typing
 * it after, and a peer's caret, which follows letters by identity, then jumps into the new
 * text. The lowering uses a hint only where it explains the change exactly.
 */
export function withInsertionHints<T>(
  part: OoxmlPart,
  paragraphId: string,
  offset: number,
  run: () => T
): T {
  if (!isCanonicalPrimitiveCaptureActive()) return run();
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return run();
  const index = paragraphOffsetIndex(paragraph);
  const hints = new Map<string, number>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      const span = index.spanOf(node);
      if (span && span.end - span.start === node.value.length) {
        if (span.start <= offset && offset <= span.end) hints.set(node.id, offset - span.start);
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(paragraph);
  return hints.size === 0 ? run() : withTextSpliceHints(hints, run);
}
