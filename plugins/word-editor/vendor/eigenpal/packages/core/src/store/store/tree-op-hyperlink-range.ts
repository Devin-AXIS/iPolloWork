import { findNode } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { parentOf } from './tree-op-nodes.ts';
import { paragraphOffsetIndex, splitsSurrogate } from './tree-op-segments.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

/** Partial link writes support ordinary text runs; opaque inline content remains untouched. */
export function isTextHyperlink(node: OoxmlNode): boolean {
  return (
    node.kind === 'hyperlink' &&
    node.children.every(
      (run) =>
        run.kind === 'run' &&
        run.children.every(
          (child) =>
            child.namespaceUri === WML_NAMESPACE_URI &&
            (child.localName === 'rPr' || child.localName === 't')
        )
    )
  );
}

export function validateHyperlinkRange(
  part: OoxmlPart,
  linkId: string,
  range: { readonly start: number; readonly end: number }
): TreeOpRejection | null {
  const link = findNode(part, linkId);
  const paragraph = link && parentOf(part, linkId);
  if (!link || !isTextHyperlink(link) || paragraph?.kind !== 'paragraph')
    return 'invalid-property-value';
  const span = paragraphOffsetIndex(paragraph).spanOf(link);
  if (
    !span ||
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < span.start ||
    range.end > span.end ||
    range.start >= range.end
  )
    return 'invalid-range';
  if (splitsSurrogate(paragraph, range.start) || splitsSurrogate(paragraph, range.end))
    return 'splits-surrogate-pair';
  return null;
}
