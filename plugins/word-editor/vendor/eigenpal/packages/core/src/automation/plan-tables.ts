// Table protocol dispatch. Handles never expose canonical node identities.
import { findNode } from '../store/package/ooxml-edit.ts';
import { revisionDateNow } from './revision-date.ts';
import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { isWritableStyleName, styleDefinitionsOf } from './style-definitions.ts';
import { answered, refused } from './plan-results.ts';
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { AutomationErrorCode, AutomationHandle } from './protocol.ts';
import type { PlannedOperation } from './plan.ts';
import { resolveSpanRef, storyOfSpanRef } from './spans.ts';
import { mergeTargetCell } from '../store/store/tree-op-table-merge.ts';
import {
  tableNodes,
  tableRead,
  tableCellRead,
  planInsertTable,
  planTableMutation,
  type AutomationTableMutation,
} from './tables.ts';

export interface TablePlannerContext {
  readonly trackingAuthor?: string;
  readonly trackedRangeReplacement?: boolean;
  readonly handles: AutomationHandleTable;
  readonly reads: AutomationPackageReads;
  /** Pin story writes and reserve externally planned paragraph creation for commit reconciliation. */
  readonly admitWrite: (
    reads: AutomationStoryReads,
    expectedNewParagraphs: number,
    affectedParagraphIds: readonly string[],
    /** Paragraphs a merge moves, which later text edits in the batch cannot address. */
    reshapedParagraphIds?: readonly string[]
  ) => PlannedOperation | null;
}
// The shared frozen helpers; a table refusal's message is its detail, as it always was.
const refuse = (code: AutomationErrorCode, detail: string): PlannedOperation =>
  refused(code, detail, detail);
const query = answered;
const TABLE_OPS = new Set([
  'insertTableRows',
  'getTables',
  'getTable',
  'getTableRows',
  'getTableCells',
  'getTableCell',
  'getMergedTableCell',
  'getTableCellProperties',
  'getTableCellBody',
  'updateTable',
  'updateTableCell',
  'splitTableCell',
  'insertTable',
]);
function paragraphs(root: OoxmlNode): Set<string> {
  const out = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'paragraph') out.add(node.id);
    if (node.kind !== 'textValue') stack.push(...node.children);
  }
  return out;
}
function countNew(before: OoxmlNode, after: OoxmlNode): number {
  const old = paragraphs(before);
  return [...paragraphs(after)].filter((id) => !old.has(id)).length;
}
function parentTable(root: OoxmlNode, nodeId: string): OoxmlElement | undefined {
  const stack: { node: OoxmlNode; table?: OoxmlElement }[] = [{ node: root }];
  while (stack.length) {
    const { node, table } = stack.pop()!;
    if (node.id === nodeId) return table;
    if (node.kind === 'textValue') continue;
    const parent = node.kind === 'table' ? node : table;
    for (const child of node.children) stack.push({ node: child, table: parent });
  }
  return undefined;
}
/**
 * The table style name a read answers: the name that writes back to the same style, by the rule the
 * listing and the setter share, or an empty string where none does.
 */
function tableStyleName(reads: AutomationPackageReads, styleId: string | null | undefined): string {
  const part = reads.package && stylesPartOf(reads.package);
  if (!part || typeof styleId !== 'string') return '';
  return styleDefinitionsOf(part).nameOf('table', styleId) ?? '';
}

export function planTableOperation(
  operation: AutomationOperation,
  context: TablePlannerContext
): PlannedOperation | null {
  if (!TABLE_OPS.has(operation.op)) return null;
  const { handles, reads: packages } = context;
  if (operation.op === 'getTables' || operation.op === 'insertTable') {
    const scope = operation.op === 'getTables' ? operation.scope : operation.span;
    const story = storyOfSpanRef(scope, handles, packages);
    if (!story.ok) return refuse(story.code, story.detail);
    const resolved = resolveSpanRef(scope, handles, packages);
    if (!resolved.ok) return refuse(resolved.code, resolved.detail);
    const reads = story.value;
    if (operation.op === 'getTables') {
      const span = resolved.value;
      const listed = tableNodes(reads.root).filter((table) => {
        if ('body' in scope) return true;
        if (!span) return false;
        const ids = [...paragraphs(table)].sort((a, b) => reads.indexOf(a) - reads.indexOf(b));
        const first = ids[0],
          last = ids[ids.length - 1];
        if (!first || !last) return false;
        return reads.indexOf(first) >= span.start.index && reads.indexOf(last) <= span.end.index;
      });
      return query({
        kind: 'handles',
        handles: listed.map((t) => handles.table(t.id, reads.story)),
      });
    }
    if (!resolved.value) return refuse('invalid-offset', 'empty-table-insertion-range');
    if (!['Before', 'After'].includes(operation.location))
      return refuse('unsupported-content', 'table-insertion-location');
    const point = operation.location === 'Before' ? resolved.value.start : resolved.value.end;
    // A cell's body is a story rooted at the cell, so look for the table around it in the part.
    const around = parentTable(reads.part.root, point.paragraphId);
    if (around) {
      // A body's edge inside one of its own top-level tables: the body starts or ends with a
      // table. A new table there needs a paragraph between the two, which this call does not add.
      const edge =
        'body' in operation.span &&
        reads.root.kind !== 'textValue' &&
        reads.root.children.some(
          (child) => child.kind === 'table' && paragraphs(child).has(point.paragraphId)
        );
      return refuse('unsupported-content', edge ? 'table-at-body-edge' : 'nested-table-authoring');
    }
    const planned = planInsertTable(
      reads,
      point.paragraphId,
      point.offset,
      operation.rowCount,
      operation.columnCount,
      operation.values,
      context.trackingAuthor
        ? { author: context.trackingAuthor, date: revisionDateNow() }
        : undefined
    );
    if (!planned.ok) return refuse('unsupported-content', planned.reason);
    const admission = context.admitWrite(
      reads,
      countNew(reads.part.root, planned.resultPart.root),
      [point.paragraphId]
    );
    if (admission) return admission;
    const before = new Set(tableNodes(reads.root).map((t) => t.id));
    return {
      ok: true,
      kind: 'command',
      story: reads.story,
      ops: [
        {
          op: 'authorTable',
          action: {
            kind: 'insert',
            paragraphId: point.paragraphId,
            offset: point.offset,
            rowCount: operation.rowCount,
            columnCount: operation.columnCount,
            ...(operation.values ? { values: operation.values } : {}),
          },
          ...(context.trackingAuthor
            ? {
                revision: { author: context.trackingAuthor, date: revisionDateNow() },
              }
            : {}),
        },
      ],
      answer: (post) => {
        const current = post.story(reads.story);
        const table = current && tableNodes(current.root).find((t) => !before.has(t.id));
        return table
          ? { kind: 'handle', handle: handles.table(table.id, reads.story) }
          : { kind: 'applied' };
      },
    };
  }
  // Every remaining operation names an existing table, row, or cell.
  const named: 'table' | 'tableRow' | 'tableCell' =
    operation.op === 'getTableCells' || operation.op === 'insertTableRows'
      ? 'tableRow'
      : 'cell' in operation
        ? 'tableCell'
        : 'table';
  const handle: AutomationHandle =
    operation.op === 'getTableCells' || operation.op === 'insertTableRows'
      ? operation.row
      : 'cell' in operation
        ? operation.cell
        : 'table' in operation
          ? operation.table
          : ({ kind: 'document', ref: '' } as AutomationHandle);
  const target = handles.resolve(handle, named);
  if (!target || !('nodeId' in target) || !('story' in target))
    return refuse('invalid-handle', 'unknown-table-object');
  const reads = packages.story(target.story);
  if (!reads) return refuse('invalid-handle', 'missing-table-story');
  const node = findNode(reads.part, target.nodeId);
  if (!node || node.kind !== named) return refuse('invalid-handle', 'deleted-table-object');
  const table = named === 'table' ? node : parentTable(reads.root, target.nodeId);
  if (!table) return refuse('invalid-handle', 'missing-parent-table');
  const data = tableRead(reads, table.id);
  if (!data) return refuse('unsupported-content', 'unsupported-table-topology');
  switch (operation.op) {
    case 'getTable':
      return query({
        kind: 'table',
        table: {
          values: data.values,
          headerRowCount: data.headerRowCount,
          rowCount: data.rowIds.length,
          columnCount: data.columnCount,
          // The name that writes back to this style, or none: a read is always writable.
          style: tableStyleName(packages, data.styleId),
        },
      });
    case 'getTableRows':
      return query({
        kind: 'handles',
        handles: data.rowIds.map((id) => handles.tableRow(id, reads.story)),
      });
    case 'getTableCells': {
      const index = data.rowIds.indexOf(target.nodeId);
      return query({
        kind: 'handles',
        handles: (data.cellIds[index] ?? []).map((id) => handles.tableCell(id, reads.story)),
      });
    }
    case 'getTableCell': {
      if (!Number.isInteger(operation.rowIndex) || !Number.isInteger(operation.cellIndex))
        return refuse('invalid-offset', 'invalid-cell-index');
      const id = data.cellIds[operation.rowIndex]?.[operation.cellIndex];
      return id
        ? query({ kind: 'handle', handle: handles.tableCell(id, reads.story) })
        : refuse('invalid-handle', 'cell-not-found');
    }
    case 'getMergedTableCell': {
      const first = data.cellIds[operation.topRow]?.[operation.firstCell];
      const last = data.cellIds[operation.bottomRow]?.[operation.lastCell];
      if (!first || !last || operation.bottomRow < operation.topRow)
        return refuse('unsupported-content', 'invalid-table-index');
      // This read can run before a tracking-mode write in the same sync, so it answers the
      // rectangle only. The merge itself refuses pending revisions under the right mode.
      const merged = mergeTargetCell(
        reads.part,
        table.id,
        first === last ? [first] : [first, last]
      );
      if (merged.ok) {
        return query({ kind: 'handle', handle: handles.tableCell(merged.cellId, reads.story) });
      }
      return refuse('unsupported-content', merged.reason);
    }
    case 'getTableCellBody':
      return query({ kind: 'handle', handle: handles.body(reads.story, target.nodeId) });
    case 'getTableCellProperties': {
      const cell = tableCellRead(reads, table.id, target.nodeId);
      return cell
        ? query({
            kind: 'tableCell',
            cell: {
              value: cell.value,
              columnWidth: cell.columnWidth,
              shadingColor: cell.shadingColor,
              verticalAlignment: cell.verticalAlignment,
            },
          })
        : refuse('invalid-handle', 'cell-not-found');
    }
    case 'insertTableRows':
    case 'updateTable':
    case 'updateTableCell':
    case 'splitTableCell': {
      let mutation: AutomationTableMutation =
        operation.op === 'splitTableCell'
          ? {
              kind: 'splitCell',
              cellId: target.nodeId,
              rowCount: operation.rowCount,
              columnCount: operation.columnCount,
            }
          : operation.op === 'insertTableRows'
            ? {
                kind: 'insertRows',
                rowId: target.nodeId,
                location: operation.location,
                count: operation.count,
                ...(operation.values ? { values: operation.values } : {}),
              }
            : operation.op === 'updateTable'
              ? operation.mutation
              : { ...operation.properties, kind: 'cell', cellId: target.nodeId };
      if (mutation.kind === 'properties' && mutation.styleId !== undefined) {
        const wanted = mutation.styleId;
        // The same name rule the paragraph style setter applies, before any name is compared.
        if (typeof wanted !== 'string' || !isWritableStyleName(wanted))
          return refuse('unsupported-content', 'invalid-table-style-name');
        const stylesPart = packages.package && stylesPartOf(packages.package);
        if (!stylesPart) return refuse('unsupported-content', 'no-styles-defined: table');
        const styleId = styleDefinitionsOf(stylesPart).idOf('table', wanted);
        if (styleId === null) return refuse('unsupported-content', 'style-not-defined: table');
        mutation = { ...mutation, styleId };
      }
      const revision = context.trackingAuthor
        ? { author: context.trackingAuthor, date: revisionDateNow() }
        : undefined;
      if (
        revision &&
        context.trackedRangeReplacement === false &&
        (mutation.kind === 'values' || (mutation.kind === 'cell' && mutation.value !== undefined))
      )
        return refuse(
          'unsupported-capability',
          'tracked table value replacement is unsupported in collaboration'
        );
      const planned = planTableMutation(reads, table.id, mutation, revision);
      if (!planned.ok)
        return refuse(
          // Under tracking, a merge or split that meets a pending revision has no tracked form.
          revision &&
            planned.reason === 'cell-has-revision' &&
            (mutation.kind === 'mergeCells' || mutation.kind === 'splitCell')
            ? 'unsupported-capability'
            : planned.reason === 'unsupported-revision' || planned.reason === 'cell-has-revision'
              ? 'unsupported-revision'
              : planned.reason === 'tracked-table-deletion-unsupported' ||
                  planned.reason === 'unsupported-tracked-table-operation'
                ? 'unsupported-capability'
                : 'unsupported-content',
          planned.reason
        );
      const admission = context.admitWrite(
        reads,
        countNew(reads.part.root, planned.resultPart.root),
        mutation.kind === 'values'
          ? [...paragraphs(table)]
          : mutation.kind === 'cell' && mutation.value !== undefined
            ? [...paragraphs(node)]
            : [],
        // A merge moves paragraphs between cells, so a later text edit in the table refuses.
        mutation.kind === 'mergeCells' ? [...paragraphs(table)] : []
      );
      if (admission) return admission;
      const oldRows = new Set(data.rowIds);
      return {
        ok: true,
        kind: 'command',
        story: reads.story,
        ops: [
          {
            op: 'authorTable',
            action: { kind: 'existing', tableId: table.id, mutation },
            ...(revision ? { revision } : {}),
          },
        ],
        answer: (post) => {
          // The merged cell is the rectangle's top-left cell, which keeps its identity.
          if (mutation.kind !== 'addRows' && mutation.kind !== 'insertRows')
            return { kind: 'applied' };
          const current = post.story(reads.story);
          const updated = current && tableRead(current, table.id);
          return {
            kind: 'handles',
            handles: (updated?.rowIds ?? [])
              .filter((id) => !oldRows.has(id))
              .map((id) => handles.tableRow(id, reads.story)),
          };
        },
      };
    }
    default:
      return refuse('unsupported-content', 'unknown-table-operation');
  }
}
