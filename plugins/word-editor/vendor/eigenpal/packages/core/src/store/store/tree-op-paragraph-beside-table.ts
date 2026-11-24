// A paragraph beside a table that opens or closes its story. Every other paragraph insert
// splits a neighbouring paragraph, and at a story edge the only neighbour is the table.

import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { usedParaIds, w14PrefixInScopeAt } from '../package/para-id.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import type { InsertParagraphBesideTableOp } from './table-placement-op-types.ts';
import {
  BLOCK_CONTAINERS,
  emptyParagraph,
  insertedMarkProperties,
} from './tree-op-insert-table.ts';
import {
  effectiveContentLockAt,
  fromEdit,
  isBoundAt,
  parentOf,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export function validateInsertParagraphBesideTable(
  part: OoxmlPart,
  op: InsertParagraphBesideTableOp
): TreeOpRejection | null {
  if (typeof op.tableId !== 'string' || typeof op.text !== 'string') return 'invalidArgs';
  if (op.where !== 'before' && op.where !== 'after') return 'invalidArgs';
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) return 'invalidArgs';
  const table = findNode(part, op.tableId);
  if (!table) return 'unknown-block';
  if (table.kind !== 'table') return 'not-a-block';
  const parent = parentOf(part, op.tableId);
  if (!parent || !BLOCK_CONTAINERS.has(parent.localName)) return 'not-a-block';
  if (isBoundAt(part, op.tableId)) return 'bound';
  if (effectiveContentLockAt(part, op.tableId).content) return 'locked';
  return null;
}

export function applyInsertParagraphBesideTable(
  part: OoxmlPart,
  op: InsertParagraphBesideTableOp,
  options: EditOptions | undefined,
  applyOp: (part: OoxmlPart, op: TreeDocOp, options?: EditOptions) => TreeOpResult
): TreeOpResult {
  const rejection = validateInsertParagraphBesideTable(part, op);
  if (rejection) return { ok: false, reason: rejection };
  const parent = parentOf(part, op.tableId)!;
  const index = parent.children.findIndex((child) => child.id === op.tableId);
  const nextId = createNodeIdAllocator(part);
  const wml = wmlFreshNamespaceContextAt(part, parent);
  const blank = emptyParagraph(
    w14PrefixInScopeAt(part, parent),
    `${op.tableId}:${op.where}`,
    new Set(usedParaIds(part.root)),
    nextId,
    wml
  );
  // A proposed paragraph proposes its mark, so rejecting it leaves no empty line behind.
  const paragraph = op.revision
    ? {
        ...blank,
        children: [
          insertedMarkProperties(
            { id: options?.revisionIds?.() ?? nextRevisionId(part)(), revision: op.revision },
            nextId,
            wml
          ),
        ],
      }
    : blank;
  const placed = fromEdit(
    insertChildren(
      part,
      parent.id,
      op.where === 'before' ? index : index + 1,
      [paragraph],
      options
    ),
    {
      dirty: [parent.id],
      created: [paragraph.id],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
    }
  );
  if (!placed.ok || op.text.length === 0) return placed;
  const written = applyOp(
    placed.part,
    {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 0,
      text: op.text,
      ...(op.revision ? { revision: op.revision } : {}),
    },
    options
  );
  if (!written.ok) return written;
  return {
    ok: true,
    part: written.part,
    effect: {
      ...placed.effect,
      dirty: [...new Set([...placed.effect.dirty, ...written.effect.dirty])],
      created: [...new Set([...placed.effect.created, ...written.effect.created])],
      dependencyKeys: [
        ...new Set([...placed.effect.dependencyKeys, ...written.effect.dependencyKeys]),
      ],
    },
  };
}
