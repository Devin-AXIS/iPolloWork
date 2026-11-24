import {
  parentNodeOf,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  collectFlowBlocks,
  isContentControl,
  isContentControlContent,
} from '../store/package/content-control-walk.ts';

/** Flatten content controls within one flow; tables and story roots remain boundaries. */
export function previousListParagraphs(
  part: OoxmlPart,
  paragraph: OoxmlElement
): readonly OoxmlElement[] {
  let parent = parentNodeOf(part, paragraph.id);
  for (let depth = 0; parent && depth < 64; depth += 1) {
    const transparent =
      (parent.namespaceUri === WML_NAMESPACE_URI && parent.localName === 'customXml') ||
      isContentControl(parent) ||
      isContentControlContent(parent);
    if (!transparent) break;
    parent = parentNodeOf(part, parent.id);
  }
  if (!parent) return [];
  const blocks = collectFlowBlocks(parent.children);
  const index = blocks.findIndex((node) => node.id === paragraph.id);
  return index >= 2 ? blocks.slice(index - 2, index) : [];
}

/** Text projection alone cannot distinguish an empty paragraph from an image or field. */
export function isBlankListSeparator(paragraph: OoxmlElement): boolean {
  const blank = (node: OoxmlNode): boolean => {
    if (node.kind === 'textValue') return /^[ \t\u00a0]*$/.test(node.value);
    if (node.namespaceUri !== WML_NAMESPACE_URI) return false;
    if (node.localName === 'pPr')
      return !node.children.some(
        (child) => child.kind !== 'textValue' && child.localName === 'sectPr'
      );
    if (node.localName === 'rPr' || node.localName === 'tab') return true;
    if (
      ['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'proofErr'].includes(
        node.localName
      )
    )
      return true;
    if (!['p', 'r', 't', 'hyperlink'].includes(node.localName)) return false;
    return node.children.every(blank);
  };
  return blank(paragraph);
}
