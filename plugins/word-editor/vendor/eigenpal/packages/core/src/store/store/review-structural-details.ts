import type { ReviewRevisionItem } from './review-items.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

/** Keep mixed row/cell decisions descriptive without deriving structure in an adapter. */
export function structuralChangeOf(
  site: RevisionSite
): NonNullable<ReviewRevisionItem['structuralChanges']>[number] | undefined {
  if (site.parent?.localName === 'trPr') {
    if (site.node.localName === 'ins') return 'rowInsert';
    if (site.node.localName === 'del') return 'rowDelete';
  }
  if (site.parent?.localName === 'tcPr') {
    if (site.node.localName === 'cellIns') return 'cellInsert';
    if (site.node.localName === 'cellDel') return 'cellDelete';
    if (site.node.localName === 'cellMerge') return 'cellMerge';
  }
  if (site.parent?.localName === 'numPr' && site.node.localName === 'ins') return 'numberingInsert';
  return undefined;
}
