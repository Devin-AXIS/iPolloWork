import { WML_NAMESPACE_URI, type OoxmlNode } from '../store/package/ooxml-tree.ts';
import { MAX_PART_SCAN_ELEMENTS } from '../store/package/drawing-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { editableTableParagraph } from './table-ordinary-paragraph.ts';

/** Preserve table structure and paragraph properties while replacing ordinary inline content. */
export function tableTextStructureUnchanged(before: OoxmlNode, after: OoxmlNode): boolean {
  let visited = 0;
  const visit = (previous: OoxmlNode, next: OoxmlNode, depth: number): boolean => {
    if (++visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) return false;
    if (previous === next) return true;
    if (previous.kind === 'textValue' || next.kind === 'textValue') return false;
    if (
      previous.id !== next.id ||
      previous.kind !== next.kind ||
      previous.namespaceUri !== WML_NAMESPACE_URI ||
      next.namespaceUri !== previous.namespaceUri ||
      previous.localName !== next.localName ||
      previous.prefix !== next.prefix ||
      previous.attributes !== next.attributes ||
      previous.namespaceBindings !== next.namespaceBindings
    )
      return false;
    if (previous.kind === 'paragraph' && next.kind === 'paragraph') {
      const properties = (node: typeof previous) =>
        node.children.filter(
          (child) => child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'pPr'
        );
      const oldProperties = properties(previous);
      const newProperties = properties(next);
      return (
        oldProperties.length === newProperties.length &&
        oldProperties.every((node, index) => node === newProperties[index]) &&
        editableTableParagraph(previous) &&
        editableTableParagraph(next)
      );
    }
    if (previous.children.length !== next.children.length) return false;
    return previous.children.every((child, index) =>
      visit(child, next.children[index]!, depth + 1)
    );
  };
  return visit(before, after, 0);
}
