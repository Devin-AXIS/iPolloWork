import { WML_NAMESPACE_URI, type OoxmlNode } from '../store/package/ooxml-tree.ts';
import { MAX_PART_SCAN_ELEMENTS } from '../store/package/drawing-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';

/** Prove that an immutable edit only changes existing ordinary text values. */
export function drawingInputsUnchangedByTextEdit(before: OoxmlNode, after: OoxmlNode): boolean {
  let visited = 0;
  const visit = (previous: OoxmlNode, next: OoxmlNode, depth: number): boolean => {
    visited += 1;
    if (visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) return false;
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
      previous.namespaceBindings !== next.namespaceBindings ||
      previous.children.length !== next.children.length
    )
      return false;
    // Text inside a drawing or embedded object can change that atom's projection.
    if (['drawing', 'pict', 'object'].includes(previous.localName)) return false;
    for (let index = 0; index < previous.children.length; index += 1) {
      const oldChild = previous.children[index]!;
      const newChild = next.children[index]!;
      if (
        previous.localName === 't' &&
        oldChild.kind === 'textValue' &&
        newChild.kind === 'textValue' &&
        oldChild.id === newChild.id
      ) {
        visited += 1;
        if (visited > MAX_PART_SCAN_ELEMENTS) return false;
        continue;
      }
      if (!visit(oldChild, newChild, depth + 1)) return false;
    }
    return true;
  };
  return visit(before, after, 0);
}
