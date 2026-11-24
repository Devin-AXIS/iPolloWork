import { tableTextStructureUnchanged } from './table-text-change.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { SemanticTableStructure } from './semantic-table.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { drawingInputsUnchangedByTextEdit } from './drawing-text-only-change.ts';
import { mergedFlowBlocks } from './story-roots.ts';

interface Context {
  readonly contentWidthPt: number;
  readonly depth: number;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  readonly compatibilityMode: number | undefined;
  /** The table is a top-level table of a text box story. */
  readonly textBox: boolean;
}
interface Memo extends Context {
  readonly table: OoxmlNode;
  readonly structure: SemanticTableStructure | null;
}
function sameContext(a: Context, b: Context): boolean {
  return (
    a.contentWidthPt === b.contentWidthPt &&
    a.depth === b.depth &&
    a.styleCascade === b.styleCascade &&
    a.displayMode === b.displayMode &&
    a.authorFilter === b.authorFilter &&
    a.compatibilityMode === b.compatibilityMode &&
    a.textBox === b.textBox
  );
}

/**
 * Reuse resolved table geometry only when an immutable edit changes ordinary text.
 *
 * Entries live under the table's `w:tblPr` node, which survives ordinary edits, and only the
 * latest two table revisions per view stay. Keying by the table node itself kept one structure
 * for every revision the undo history holds: a long table grew by megabytes per edit.
 */
function createStructureCache() {
  // Tables without `w:tblPr` have no stable owner; they are keyed by the table itself.
  const roots = new WeakMap<OoxmlNode, Memo[]>();
  // Immutable table properties survive ordinary text edits. Keep reviewer views separate.
  const latest = new WeakMap<OoxmlNode, Memo[]>();
  const rememberLatest = (owner: OoxmlNode, memo: Memo): void => {
    const entries = latest.get(owner) ?? [];
    // An incremental update reads both sides. Keep two versions per view so reading
    // the previous table cannot evict the current structure and its width measurements.
    const kept: Memo[] = [memo];
    let sameView = 0;
    for (const entry of entries) {
      if (sameContext(entry, memo)) {
        if (entry.table === memo.table || sameView++ > 0) continue;
      }
      if (kept.length < 8) kept.push(entry);
    }
    latest.set(owner, kept);
  };
  return function cachedTableStructure(
    table: OoxmlNode,
    context: Context,
    read: () => SemanticTableStructure | null
  ): SemanticTableStructure | null {
    const owner =
      table.kind === 'table' ? table.children.find((n) => n.localName === 'tblPr') : undefined;
    const entries = owner ? undefined : (roots.get(table) ?? []);
    const known = (owner ? latest.get(owner) : entries)?.find(
      (entry) => entry.table === table && sameContext(entry, context)
    );
    if (known) return known.structure;
    const previous = owner
      ? latest.get(owner)?.find((entry) => sameContext(entry, context))
      : undefined;
    let structure: SemanticTableStructure | null | undefined;
    if (
      previous?.structure &&
      sameContext(previous, context) &&
      (drawingInputsUnchangedByTextEdit(previous.table, table) ||
        tableTextStructureUnchanged(previous.table, table))
    ) {
      const cells = new Map<string, OoxmlNode>();
      const visit = (before: OoxmlNode, after: OoxmlNode): void => {
        if (before === after || before.kind === 'textValue' || after.kind === 'textValue') return;
        if (after.kind === 'tableCell') {
          cells.set(after.id, after);
          return;
        }
        for (let i = 0; i < before.children.length; i++)
          visit(before.children[i]!, after.children[i]!);
      };
      visit(previous.table, table);
      structure = {
        ...previous.structure,
        rows: previous.structure.rows.map((row) => {
          if (!row.cells.some((cell) => cells.has(cell.id))) return row;
          return {
            ...row,
            cells: row.cells.map((cell) => {
              const node = cells.get(cell.id);
              return node && node.kind !== 'textValue'
                ? {
                    ...cell,
                    blocks: mergedFlowBlocks(
                      node.children,
                      context.displayMode,
                      context.authorFilter
                    ),
                  }
                : cell;
            }),
          };
        }),
      };
    }
    structure ??= read();
    const memo = { ...context, table, structure };
    if (owner) rememberLatest(owner, memo);
    else if (entries) {
      // Keep common reviewer views independent without retaining unbounded width variants.
      if (entries.length === 4) entries.shift();
      entries.push(memo);
      roots.set(table, entries);
    }
    return structure;
  };
}
export const cachedTableStructure = createStructureCache();
