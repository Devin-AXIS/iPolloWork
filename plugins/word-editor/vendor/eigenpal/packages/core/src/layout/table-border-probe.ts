// Bounded eligibility checks for speculative table-border measurement.
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAX_CANDIDATE_NODES = 8192;
const MAX_CANDIDATE_DEPTH = 32;
// Resolved structures are immutable. Do not scan a large table again on every page.
const mergePresence = new WeakMap<SemanticTableStructure, boolean>();
export function hasTableMerge(structure: SemanticTableStructure): boolean {
  const known = mergePresence.get(structure);
  if (known !== undefined) return known;
  const present = structure.rows.some((row) => row.cells.some((cell) => cell.vMergeContinue));
  mergePresence.set(structure, present);
  return present;
}
const CONTENT_ELEMENTS = new Set([
  'p',
  'r',
  't',
  'tab',
  'br',
  'cr',
  'noBreakHyphen',
  'softHyphen',
  'hyperlink',
  'fldSimple',
  'fldChar',
  'instrText',
  'bookmarkStart',
  'bookmarkEnd',
  'proofErr',
  'pPr',
  'rPr',
]);

// Boundary sweeps run in physical grid order; RTL row arrays retain document order.
export function physicalCells(row: SemanticTableRow): SemanticTableRow['cells'] {
  return row.cells[0]?.logicalGridColumn === undefined ? row.cells : [...row.cells].reverse();
}

/** Text-only rows keep the candidate probe independent of drawing and note publication. */
export function canProbeBorderRows(rows: readonly SemanticTableRow[], columns: number): boolean {
  let visited = 0;
  for (const row of rows) {
    let end = 0;
    for (const cell of physicalCells(row)) {
      if (cell.vMergeContinue || cell.textDirection !== 'horizontal' || cell.gridColumn !== end)
        return false;
      end += cell.gridSpan;
      if (end > columns) return false;
      for (const block of cell.blocks) {
        if (block.kind !== 'paragraph') return false;
        const stack: { node: OoxmlNode; depth: number; properties: boolean }[] = [
          { node: block, depth: 0, properties: false },
        ];
        while (stack.length > 0) {
          const { node, depth, properties } = stack.pop()!;
          if (++visited > MAX_CANDIDATE_NODES || depth > MAX_CANDIDATE_DEPTH) return false;
          if (node.kind === 'textValue') continue;
          if (node.namespaceUri !== W || (!properties && !CONTENT_ELEMENTS.has(node.localName)))
            return false;
          if (
            node.localName === 'br' &&
            node.attributes.some(
              (attribute) => attribute.localName === 'type' && attribute.value !== 'textWrapping'
            )
          )
            return false;
          // Drawing, nested story and merge markup are not paragraph/run formatting.
          if (
            ['drawing', 'pict', 'object', 'txbxContent', 'tbl', 'vMerge', 'framePr'].includes(
              node.localName
            )
          )
            return false;
          if (visited + stack.length + node.children.length > MAX_CANDIDATE_NODES) return false;
          const childProperties =
            properties || node.localName === 'pPr' || node.localName === 'rPr';
          for (const child of node.children)
            stack.push({ node: child, depth: depth + 1, properties: childProperties });
        }
      }
    }
    if (end !== columns) return false;
  }
  return true;
}
