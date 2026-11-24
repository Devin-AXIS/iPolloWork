import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { insertionDestination, paragraphOffsetIndex } from './tree-op-segments.ts';

/** An explicit left bias keeps a leading control outside the resolved insertion path. */
export function insertsBeforePrompt(
  paragraph: OoxmlParagraphNode,
  offset: number,
  control: OoxmlNode,
  bias?: 'left' | 'right'
): boolean {
  return (
    bias === 'left' &&
    paragraphOffsetIndex(paragraph).spanOf(control)?.start === offset &&
    !insertionDestination(paragraph, offset, null, bias).path.has(control.id)
  );
}
