import { WML_NAMESPACE_URI, type OoxmlNode } from '../store/package/ooxml-tree.ts';
import { MAX_PART_SCAN_ELEMENTS } from '../store/package/drawing-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { ordinaryDrawingParagraph } from './table-ordinary-paragraph.ts';

/** Elements that are, or host, a projected drawing atom. */
const DRAWING_HOSTS = new Set(['drawing', 'pict', 'object']);
const drawingFreeParagraphs = new WeakMap<OoxmlNode, boolean>();

/**
 * A paragraph with no drawing atom in it: only WordprocessingML elements, none of them a
 * drawing, a picture, or an object. A drawing's projection reads its own paragraph's
 * properties (a frame makes an object preview), so a property edit is safe only here. Fields,
 * bookmarks, and other properties carry no atom, so they do not stop the proof.
 */
function drawingFreeParagraph(paragraph: OoxmlNode): boolean {
  const known = drawingFreeParagraphs.get(paragraph);
  if (known !== undefined) return known;
  let visited = 0;
  const visit = (node: OoxmlNode, depth: number): boolean => {
    if (++visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) return false;
    if (node.kind === 'textValue') return true;
    if (node.namespaceUri !== WML_NAMESPACE_URI || DRAWING_HOSTS.has(node.localName)) {
      return false;
    }
    return node.children.every((child) => visit(child, depth + 1));
  };
  const result = visit(paragraph, 0);
  drawingFreeParagraphs.set(paragraph, result);
  return result;
}

/** Prove that paragraph edits preserve drawing atoms, their order, and their ancestors. */
export function drawingInputsUnchangedByParagraphEdit(
  before: OoxmlNode,
  after: OoxmlNode
): boolean {
  let visited = 0;
  const ordinary = (node: OoxmlNode): boolean =>
    node.kind === 'paragraph' && (ordinaryDrawingParagraph(node) || drawingFreeParagraph(node));
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
      previous.prefix !== next.prefix
    )
      return false;
    // Neither paragraph contains a drawing atom, so its edit moves no projection.
    if (ordinary(previous) && ordinary(next)) return true;
    if (
      previous.attributes !== next.attributes ||
      previous.namespaceBindings !== next.namespaceBindings ||
      ['drawing', 'pict', 'object'].includes(previous.localName)
    )
      return false;
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < previous.children.length || newIndex < next.children.length) {
      const oldChild = previous.children[oldIndex];
      const newChild = next.children[newIndex];
      if (oldChild && newChild && oldChild.id === newChild.id) {
        if (
          !(
            previous.localName === 't' &&
            oldChild.kind === 'textValue' &&
            newChild.kind === 'textValue'
          ) &&
          !visit(oldChild, newChild, depth + 1)
        )
          return false;
        oldIndex += 1;
        newIndex += 1;
      } else if (oldChild && ordinary(oldChild)) {
        oldIndex += 1;
      } else if (newChild && ordinary(newChild)) {
        newIndex += 1;
      } else return false;
    }
    return true;
  };
  return visit(before, after, 0);
}
