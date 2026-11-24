import { WML_NAMESPACE_URI, type OoxmlNode } from '../store/package/ooxml-tree.ts';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { MAX_PART_SCAN_ELEMENTS } from '../store/package/drawing-projection.ts';

const allowedElements = new Set([
  'adjustRightInd',
  'bCs',
  'cnfStyle',
  'p',
  'pPr',
  'r',
  'rPr',
  't',
  'tab',
  'br',
  'b',
  'i',
  'u',
  'sz',
  'szCs',
  'rFonts',
  'color',
  'lang',
  'spacing',
  'jc',
  'ind',
  'keepNext',
  'keepLines',
  'widowControl',
  'contextualSpacing',
  'pStyle',
  'rStyle',
  'noProof',
  'proofErr',
  'kern',
  'position',
  'vertAlign',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'shd',
  'highlight',
]);
const ordinaryParagraphs = new WeakMap<OoxmlNode, boolean>();
const drawingParagraphs = new WeakMap<OoxmlNode, boolean>();
const revisionParagraphs = new WeakMap<OoxmlNode, boolean>();
const numberingElements = new Set(['numPr', 'numId', 'ilvl']);

function ordinaryParagraph(root: OoxmlNode, numbering: boolean, revisions = false): boolean {
  const cache = revisions ? revisionParagraphs : numbering ? drawingParagraphs : ordinaryParagraphs;
  const known = cache.get(root);
  if (known !== undefined) return known;
  let visited = 0;
  const visit = (node: OoxmlNode, depth: number, parent = ''): boolean => {
    if (++visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) return false;
    if (node.kind === 'textValue') return true;
    if (node.namespaceUri !== WML_NAMESPACE_URI) return false;
    // A saved pagination marker carries no content or break instruction.
    if (node.localName === 'lastRenderedPageBreak') return node.children.length === 0;
    if (
      !allowedElements.has(node.localName) &&
      !(numbering && numberingElements.has(node.localName)) &&
      !(
        revisions &&
        ((['ins', 'del'].includes(node.localName) && ['p', 'ins', 'del'].includes(parent)) ||
          node.localName === 'delText')
      )
    )
      return false;
    return node.children.every((child) => visit(child, depth + 1, node.localName));
  };
  const result = visit(root, 0);
  cache.set(root, result);
  return result;
}

export function ordinaryTableParagraph(root: OoxmlNode): boolean {
  return ordinaryParagraph(root, false);
}

/** Numbering affects paragraph flow, but does not introduce projected drawing atoms. */
export function ordinaryDrawingParagraph(root: OoxmlNode): boolean {
  return ordinaryParagraph(root, true);
}

/** Ordinary cell content with inline insertion and deletion wrappers. */
export function editableTableParagraph(root: OoxmlNode): boolean {
  return ordinaryParagraph(root, false, true);
}
