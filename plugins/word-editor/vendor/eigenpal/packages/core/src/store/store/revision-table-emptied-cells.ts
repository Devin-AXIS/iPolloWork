import { parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import { holdsNoLiveText } from './revision-paragraph-merge.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

/** The deleted-mark record of a paragraph, when its properties carry one. */
function deletedMarkOf(paragraph: OoxmlElement): string | undefined {
  for (const properties of paragraph.children) {
    if (properties.kind === 'textValue' || properties.localName !== 'pPr') continue;
    for (const run of properties.children) {
      if (run.kind === 'textValue' || run.localName !== 'rPr') continue;
      for (const mark of run.children)
        if (
          mark.kind !== 'textValue' &&
          mark.namespaceUri === WML_NAMESPACE_URI &&
          mark.localName === 'del'
        )
          return mark.id;
    }
  }
  return undefined;
}

/**
 * Cells that accepting `sites` empties completely: every block is a paragraph whose mark is
 * among the deletions and whose content is deleted text. Such a cell goes as a deleted cell
 * does, each with the paragraph mark deletions that remove it.
 */
export function emptiedTableCells(
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  action: 'accept' | 'reject'
): ReadonlyMap<string, readonly string[]> {
  const emptied = new Map<string, readonly string[]>();
  if (action !== 'accept') return emptied;
  const chosen = sites.filter((site) => !site.refused);
  const deleted = new Set(
    chosen.filter((site) => site.node.localName === 'del').map((site) => site.node.id)
  );
  const cells = new Map<string, OoxmlElement>();
  for (const site of sites) {
    if (!site.paragraphMark || !deleted.has(site.node.id) || !site.parent) continue;
    const properties = parentNodeOf(part, site.parent.id);
    const paragraph = properties && parentNodeOf(part, properties.id);
    const cell = paragraph && parentNodeOf(part, paragraph.id);
    if (cell?.kind === 'tableCell') cells.set(cell.id, cell);
  }
  for (const cell of cells.values()) {
    const marks: string[] = [];
    const blocks = cell.children.filter(
      (node) => node.kind !== 'textValue' && node.localName !== 'tcPr'
    );
    const empties = blocks.every((block) => {
      if (block.kind !== 'paragraph') return false;
      const mark = deletedMarkOf(block);
      if (!mark || !deleted.has(mark)) return false;
      marks.push(mark);
      // Deleted text not yet decided goes too: removing the cell takes the changes in it along.
      return block.children.every((node) => node.localName === 'pPr' || holdsNoLiveText(node));
    });
    if (blocks.length && empties) emptied.set(cell.id, marks);
  }
  return emptied;
}
