// Lossless preservation for table row operations (table-editing task 3).

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FOREIGN = 'http://example.com/foreign';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function collectByKind(
  root: OoxmlNode,
  kind: string
): { id: string; kind: string; children: readonly OoxmlNode[] }[] {
  const found: { id: string; kind: string; children: readonly OoxmlNode[] }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

const CELL = (text: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const TABLE = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${rows.join('')}</w:tbl>`;

describe('table row ops lossless preservation', () => {
  test('insert row preserves unknown tcPr children on unaffected cells', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><x:ext/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>${CELL('b')}</w:tr>` +
        `${ROW(CELL('c'), CELL('d'))}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const rowId = collectByKind(part.root, 'tableRow')[1]!.id;
    const foreignBefore = collectByKind(part.root, 'generic').find((n) => n.localName === 'ext');

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const foreignAfter = collectByKind(result.part.root, 'generic').find(
      (n) => n.localName === 'ext'
    );
    expect(foreignAfter).toBe(foreignBefore);
  });

  test('insert row save/reopen matches edited fingerprint and semantic digest', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const rowId = collectByKind(part.root, 'tableRow')[0]!.id;

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);

    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(
      diffSemanticDigests(semanticDigest([result.part]), semanticDigest([reopened.part]))
    ).toEqual([]);
  });

  test('delete row save/reopen matches edited fingerprint and semantic digest', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const rowId = collectByKind(part.root, 'tableRow')[0]!.id;

    const result = applyTreeOp(part, { op: 'deleteTableRow', tableId: table.id, rowId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);

    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(
      diffSemanticDigests(semanticDigest([result.part]), semanticDigest([reopened.part]))
    ).toEqual([]);
    expect(collectByKind(reopened.part.root, 'tableRow')).toHaveLength(1);
  });

  test('nested-table insert save/reopen changes only the inner target', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tbl><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>` +
        `<w:tr>${CELL('nested-a')}</w:tr><w:tr>${CELL('nested-b')}</w:tr></w:tbl>${CELL('outer')}</w:tc></w:tr></w:tbl>`
    );
    const tables = collectByKind(part.root, 'table');
    const outer = tables[0]!;
    const inner = tables[1]!;
    const outerRowsBefore = outer.children.filter((c) => c.kind === 'tableRow').length;
    const innerRowId = inner.children.filter((c) => c.kind === 'tableRow')[0]!.id;

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: inner.id,
      rowId: innerRowId,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);

    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(
      diffSemanticDigests(semanticDigest([result.part]), semanticDigest([reopened.part]))
    ).toEqual([]);

    const reopenedTables = collectByKind(reopened.part.root, 'table');
    const reopenedOuter = reopenedTables.find((t) => t.id === outer.id)!;
    const reopenedInner = reopenedTables.find((t) => t.id === inner.id)!;
    expect(reopenedOuter.children.filter((c) => c.kind === 'tableRow')).toHaveLength(
      outerRowsBefore
    );
    expect(reopenedInner.children.filter((c) => c.kind === 'tableRow')).toHaveLength(3);
  });
});
