// Moving a whole table among its siblings, as the table handle's drag does.

import {
  applyEdits,
  createNodeIdAllocator,
  findNode,
  insertChildren,
  moveChild,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { usedParaIds, w14PrefixInScopeAt } from '../package/para-id.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import type { MoveTableOp } from './table-placement-op-types.ts';
import { BLOCK_CONTAINERS, emptyParagraph } from './tree-op-insert-table.ts';
import {
  effectiveContentLockAt,
  fromEdit,
  isBoundAt,
  parentOf,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import { deleteBlockTouchesContentRestriction } from './tree-op-validate-controls.ts';

const isTable = (node: OoxmlNode | undefined): boolean =>
  node !== undefined && node.kind !== 'textValue' && node.localName === 'tbl';

export function validateMoveTable(part: OoxmlPart, op: MoveTableOp): TreeOpRejection | null {
  if (typeof op.tableId !== 'string' || typeof op.beforeBlockId !== 'string')
    return 'unknown-block';
  if (op.tableId === op.beforeBlockId) return 'not-a-block';
  const table = findNode(part, op.tableId);
  const before = findNode(part, op.beforeBlockId);
  if (!table || !before) return 'unknown-block';
  if (table.kind !== 'table' || (before.kind !== 'paragraph' && before.kind !== 'table')) {
    return 'not-a-block';
  }
  const parent = parentOf(part, op.tableId);
  if (!parent || !BLOCK_CONTAINERS.has(parent.localName)) return 'not-a-block';
  // One parent keeps the move a single reorder: a reparent could put a table inside itself.
  if (parentOf(part, op.beforeBlockId)?.id !== parent.id) return 'not-adjacent-siblings';
  const restriction = deleteBlockTouchesContentRestriction(part, table);
  if (restriction) return restriction;
  for (const id of [op.tableId, op.beforeBlockId]) {
    if (isBoundAt(part, id)) return 'bound';
    if (effectiveContentLockAt(part, id).content) return 'locked';
  }
  return null;
}

export function applyMoveTable(
  part: OoxmlPart,
  op: MoveTableOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = validateMoveTable(part, op);
  if (rejection) return { ok: false, reason: rejection };
  const parent = parentOf(part, op.tableId)!;
  const siblings = parent.children.filter((child) => child.id !== op.tableId);
  const index = siblings.findIndex((child) => child.id === op.beforeBlockId);

  const nextId = createNodeIdAllocator(part);
  const wml = wmlFreshNamespaceContextAt(part, parent);
  const w14Prefix = w14PrefixInScopeAt(part, parent);
  const usedParagraphIds = new Set(usedParaIds(part.root));
  const separator = (side: string) =>
    emptyParagraph(w14Prefix, `${op.tableId}:${side}`, usedParagraphIds, nextId, wml);
  const before = isTable(siblings[index - 1]) ? separator('sep-before') : null;
  const after = isTable(siblings[index]) ? separator('sep-after') : null;

  return fromEdit(
    applyEdits(
      part,
      [
        (current) => moveChild(current, parent.id, op.tableId, op.beforeBlockId, options),
        ...(before
          ? [(current: OoxmlPart) => insertChildren(current, parent.id, index, [before], options)]
          : []),
        ...(after
          ? [
              (current: OoxmlPart) =>
                insertChildren(current, parent.id, index + (before ? 2 : 1), [after], options),
            ]
          : []),
      ],
      options
    ),
    {
      dirty: [parent.id, op.tableId],
      created: [before, after].flatMap((paragraph) => (paragraph ? [paragraph.id] : [])),
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
    }
  );
}
