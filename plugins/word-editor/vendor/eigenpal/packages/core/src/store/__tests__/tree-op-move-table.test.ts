// moveTable: a table moves among its siblings with every node id kept.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { semanticDigest } from '../package/ooxml-digest.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = WML_NAMESPACE_URI;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (text: string) =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p(text)}</w:tc></w:tr></w:tbl>`;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const body = (part: OoxmlPart) =>
  (part.root.children[0] as Extract<OoxmlNode, { children: unknown }>).children;
const text = (node: OoxmlNode): string =>
  node.kind === 'textValue' ? node.value : node.children.map(text).join('');
/** Each body block as `P:text` or `T:text`, in order. */
const blocks = (part: OoxmlPart) =>
  body(part)
    .filter((node) => node.kind === 'paragraph' || node.kind === 'table')
    .map((node) => `${node.kind === 'table' ? 'T' : 'P'}:${text(node)}`);
const idsUnder = (node: OoxmlNode): string[] =>
  node.kind === 'textValue' ? [node.id] : [node.id, ...node.children.flatMap(idsUnder)];
const blockAt = (part: OoxmlPart, index: number) =>
  body(part).filter((node) => node.kind === 'paragraph' || node.kind === 'table')[index]!;

describe('moveTable', () => {
  test('moves the table before another block and keeps every node id', () => {
    const part = load(p('one') + p('two') + table('cell') + p('three'));
    const moved = blockAt(part, 2);
    const result = applyTreeOp(part, {
      op: 'moveTable',
      tableId: moved.id,
      beforeBlockId: blockAt(part, 0).id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(blocks(result.part)).toEqual(['T:cell', 'P:one', 'P:two', 'P:three']);
    expect(idsUnder(blockAt(result.part, 0))).toEqual(idsUnder(moved));
    expect(result.effect.created).toEqual([]);
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('mints a separator on each side that would touch another table', () => {
    const part = load(table('A') + p('gap') + table('B') + p('end') + table('moving') + p('tail'));
    const result = applyTreeOp(part, {
      op: 'moveTable',
      tableId: blockAt(part, 4).id,
      beforeBlockId: blockAt(part, 2).id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Before `B`, after `gap`: only the next sibling is a table.
    expect(blocks(result.part)).toEqual([
      'T:A',
      'P:gap',
      'T:moving',
      'P:',
      'T:B',
      'P:end',
      'P:tail',
    ]);
    expect(result.effect.created).toHaveLength(1);
  });

  test('a moved table survives save and reopen in its new place', () => {
    const part = load(p('one') + table('cell') + p('two'));
    const result = applyTreeOp(part, {
      op: 'moveTable',
      tableId: blockAt(part, 1).id,
      beforeBlockId: blockAt(part, 0).id,
    });
    if (!result.ok) throw new Error(result.reason);
    const reopened = load(
      serializeOoxmlPart(result.part)
        .replace(/.*<w:body>/s, '')
        .replace(/<w:sectPr\/>.*/s, '')
    );
    expect(blocks(reopened)).toEqual(['T:cell', 'P:one', 'P:two']);
    expect(semanticDigest([reopened])).toEqual(semanticDigest([result.part]));
  });

  test('refuses an anchor under another parent, a non-table, and itself', () => {
    const part = load(p('one') + table('cell') + p('two'));
    const tableNode = blockAt(part, 1);
    const paragraphIn = (node: OoxmlNode): OoxmlNode | undefined =>
      node.kind === 'paragraph'
        ? node
        : node.kind === 'textValue'
          ? undefined
          : node.children.map(paragraphIn).find(Boolean);
    const cellParagraph = paragraphIn(tableNode)!.id;
    const refused = (op: Parameters<typeof applyTreeOp>[1]) => {
      const result = applyTreeOp(part, op);
      return result.ok ? null : result.reason;
    };
    expect(refused({ op: 'moveTable', tableId: tableNode.id, beforeBlockId: cellParagraph })).toBe(
      'not-adjacent-siblings'
    );
    expect(
      refused({ op: 'moveTable', tableId: blockAt(part, 0).id, beforeBlockId: blockAt(part, 2).id })
    ).toBe('not-a-block');
    expect(refused({ op: 'moveTable', tableId: tableNode.id, beforeBlockId: tableNode.id })).toBe(
      'not-a-block'
    );
    expect(refused({ op: 'moveTable', tableId: tableNode.id, beforeBlockId: 'missing' })).toBe(
      'unknown-block'
    );
  });
});
