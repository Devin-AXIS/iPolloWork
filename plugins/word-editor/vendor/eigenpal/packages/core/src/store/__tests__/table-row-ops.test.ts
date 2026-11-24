// Row insertion and deletion through TreeDocumentStore (table-editing task 3).

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import { validateTableRowOp } from '../store/tree-op-tables.ts';
import { wmlChildNamed } from '../store/tree-op-table-shared.ts';
import { isValidParaId, paraIdOf } from '../package/para-id.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';

const W = WML_NAMESPACE_URI;
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const FOREIGN = 'http://example.com/foreign';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function collectByKind(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

function firstTable(part: OoxmlPart): OoxmlElement {
  const tables = collectByKind(part.root, 'table');
  if (tables.length === 0) throw new Error('no table');
  return tables[0]!;
}

function rowIds(part: OoxmlPart, tableId: string): string[] {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) throw new Error('table missing');
  return table.children.filter((c) => c.kind === 'tableRow').map((c) => c.id);
}

function paragraphText(part: OoxmlPart, paragraphId: string): string {
  const visit = (node: OoxmlNode): string => {
    if (node.kind === 'textValue') return node.value;
    return node.children.map(visit).join('');
  };
  const find = (node: OoxmlNode): OoxmlNode | null => {
    if (node.id === paragraphId) return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  const p = find(part.root);
  if (!p || p.kind === 'textValue') return '';
  return visit(p);
}

const CELL = (text: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;

const TABLE = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${rows.join('')}</w:tbl>`;

describe('insertTableRow', () => {
  test('inserts above the target row in document order', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = rowIds(result.part, table.id);
    expect(ids).toHaveLength(3);
    expect(ids[2]).toBe(second);
    expect(ids[1]).not.toBe(second);
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('inserts below the target row', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = rowIds(result.part, table.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(first);
    expect(ids[1]).not.toBe(first);
  });

  test('mints fresh row, cell, and paragraph ids', () => {
    const part = load(TABLE(ROW(CELL('only'), CELL('x'))));
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);
    const beforeIds = new Set<string>();
    const walk = (node: OoxmlNode): void => {
      beforeIds.add(node.id);
      if (node.kind === 'textValue') return;
      for (const child of node.children) walk(child);
    };
    walk(part.root);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const id of result.effect.created) expect(beforeIds.has(id)).toBe(false);
    expect(
      result.effect.created.some((id) =>
        collectByKind(result.part.root, 'paragraph').some((p) => p.id === id)
      )
    ).toBe(true);
  });

  test('ends every new cell with one empty paragraph', () => {
    const part = load(TABLE(ROW(CELL('src1'), CELL('src2'))));
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRowId = result.effect.created.find((id) =>
      collectByKind(result.part.root, 'tableRow').some((r) => r.id === id)
    );
    expect(newRowId).toBeDefined();
    const newRow = collectByKind(result.part.root, 'tableRow').find((r) => r.id === newRowId)!;
    for (const child of newRow.children) {
      if (child.kind !== 'tableCell') continue;
      const paragraphs = child.children.filter((c) => c.kind === 'paragraph');
      expect(paragraphs).toHaveLength(1);
      expect(paragraphText(result.part, paragraphs[0]!.id)).toBe('');
    }
  });

  test('copies safe row and cell properties without content', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:trPr><w:tblHeader/><w:trHeight w:val="400"/></w:trPr>` +
            `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:shd w:fill="FF0000" w:val="clear"/></w:tcPr>` +
            `<w:p><w:r><w:t>keep-out</w:t></w:r></w:p></w:tc>` +
            CELL('side')
        )
      )
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    expect(wmlChildNamed(newRow, 'trPr')?.children.some((c) => c.localName === 'tblHeader')).toBe(
      true
    );
    const firstCell = newRow.children.find((c) => c.kind === 'tableCell')!;
    const tcPr = wmlChildNamed(firstCell, 'tcPr');
    expect(tcPr?.children.some((c) => c.localName === 'shd')).toBe(true);
    expect(
      paragraphText(result.part, firstCell.children.find((c) => c.kind === 'paragraph')!.id)
    ).toBe('');
  });

  test('strips revision payloads and active vMerge from copied skeletons', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:trPr><w:ins w:id="1" w:author="a"/><w:trHeight w:val="300"/></w:trPr>` +
            `<w:tc><w:tcPr><w:vMerge w:val="restart"/><w:cellIns w:id="2" w:author="a"/><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>` +
            `<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`
        )
      )
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    const trPr = wmlChildNamed(newRow, 'trPr');
    expect(trPr?.children.some((c) => c.localName === 'ins')).toBe(false);
    expect(trPr?.children.some((c) => c.localName === 'trHeight')).toBe(true);
    const cell = newRow.children.find((c) => c.kind === 'tableCell')!;
    const tcPr = wmlChildNamed(cell, 'tcPr');
    expect(tcPr?.children.some((c) => c.localName === 'vMerge')).toBe(false);
    expect(tcPr?.children.some((c) => c.localName === 'cellIns')).toBe(false);
    expect(tcPr?.children.some((c) => c.localName === 'tcW')).toBe(true);
  });

  test('preserves unaffected row identity', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const rowsBefore = collectByKind(part.root, 'tableRow');
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rowsAfter = collectByKind(result.part.root, 'tableRow');
    expect(rowsAfter.find((r) => r.id === rowsBefore[0]!.id)).toBe(rowsBefore[0]);
    expect(rowsAfter.find((r) => r.id === rowsBefore[1]!.id)).toBe(rowsBefore[1]);
  });

  test('preserves foreign row children on source row only', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><x:marker id="keep"/><w:trPr><w:tblHeader/></w:trPr>${CELL('a')}</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);
    const sourceRow = collectByKind(part.root, 'tableRow').find((r) => r.id === row)!;
    const foreignBefore = sourceRow.children.find((c) => c.namespaceUri === FOREIGN);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sourceAfter = collectByKind(result.part.root, 'tableRow').find((r) => r.id === row)!;
    expect(sourceAfter.children.find((c) => c.namespaceUri === FOREIGN)).toBe(foreignBefore);

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    expect(newRow.children.some((c) => c.namespaceUri === FOREIGN)).toBe(false);
  });

  test('strips foreign tcPr children from inserted skeleton', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><x:ext/></w:tcPr>` +
        `<w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    const tcPr = wmlChildNamed(
      newRow.children.find((c) => c.kind === 'tableCell')!,
      'tcPr'
    );
    expect(tcPr?.children.some((c) => c.namespaceUri === FOREIGN)).toBe(false);
    expect(tcPr?.children.some((c) => c.localName === 'tcW')).toBe(true);
  });

  test('drops nested forbidden WML payload under allowlisted tcBorders', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:tc><w:tcPr><w:tcBorders>` +
            `<w:top w:val="single" w:sz="8" w:color="FF0000"/>` +
            `<w:commentRangeStart w:id="9"/>` +
            `</w:tcBorders></w:tcPr>` +
            `<w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>`
        )
      )
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);
    const sourceCell = collectByKind(part.root, 'tableCell')[0]!;
    const sourceTcBorders = wmlChildNamed(wmlChildNamed(sourceCell, 'tcPr')!, 'tcBorders')!;

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      wmlChildNamed(sourceCell, 'tcPr')?.children.find((c) => c.localName === 'tcBorders')
    ).toBe(sourceTcBorders);

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    const newCell = newRow.children.find((c) => c.kind === 'tableCell')!;
    expect(newCell.attributes).toEqual([]);
    expect(newCell.namespaceBindings).toEqual([]);
    const tcBorders = wmlChildNamed(wmlChildNamed(newCell, 'tcPr')!, 'tcBorders');
    expect(tcBorders?.children.map((c) => c.localName)).toEqual(['top']);
    expect(tcBorders?.children.some((c) => c.localName === 'commentRangeStart')).toBe(false);
  });

  test('does not copy provenance-like row and cell attributes into inserted skeleton', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr w:rsidR="00AB1234" w:rsidTr="00CD5678">` +
        `<w:tc w:rsidR="00EF9012"><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>` +
        `<w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);
    const sourceRow = collectByKind(part.root, 'tableRow').find((r) => r.id === row)!;
    const sourceCell = collectByKind(part.root, 'tableCell')[0]!;

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sourceRow.attributes.some((a) => a.localName === 'rsidR')).toBe(true);
    expect(sourceCell.attributes.some((a) => a.localName === 'rsidR')).toBe(true);

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    expect(newRow.attributes).toEqual([]);
    expect(newRow.namespaceBindings).toEqual([]);
    const newCell = newRow.children.find((c) => c.kind === 'tableCell')!;
    expect(newCell.attributes).toEqual([]);
    expect(newCell.namespaceBindings).toEqual([]);
  });

  test('projects only allowlisted WML attributes on simple property leaves', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr>` +
        `<w:tcW xmlns:x="${FOREIGN}" x:payload="1" w:w="2400" w:type="dxa" w:rsidR="00AB1234" w:unknown="drop"/>` +
        `</w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);
    const sourceTcW = wmlChildNamed(
      wmlChildNamed(collectByKind(part.root, 'tableCell')[0]!, 'tcPr')!,
      'tcW'
    )!;

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sourceTcW.attributes.some((a) => a.namespaceUri === FOREIGN)).toBe(true);
    expect(sourceTcW.attributes.some((a) => a.localName === 'rsidR')).toBe(true);

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    const tcW = wmlChildNamed(
      wmlChildNamed(
        newRow.children.find((c) => c.kind === 'tableCell')!,
        'tcPr'
      )!,
      'tcW'
    )!;
    expect(tcW.namespaceBindings).toEqual([]);
    expect(tcW.children).toEqual([]);
    expect(tcW.attributes.map((a) => a.localName).sort()).toEqual(['type', 'w']);
    expect(tcW.attributes.every((a) => a.namespaceUri === W && a.prefix === 'w')).toBe(true);
  });

  test('omits simple property leaves with attacker text or unknown WML attrs only', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:tc><w:tcPr>` +
            `<w:tcW w:w="2400" w:type="dxa">evil</w:tcW>` +
            `<w:shd w:val="clear" w:fill="FF0000" w:author="attacker"/>` +
            `</w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>`
        )
      )
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    const tcPr = wmlChildNamed(
      newRow.children.find((c) => c.kind === 'tableCell')!,
      'tcPr'
    )!;
    expect(tcPr.children.some((c) => c.localName === 'tcW')).toBe(false);
    const shd = wmlChildNamed(tcPr, 'shd');
    expect(shd).toBeDefined();
    expect(shd!.attributes.map((a) => a.localName).sort()).toEqual(['fill', 'val']);
  });

  test('mints paraId when source cell shadows w14 but target table ancestry does not', () => {
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc xmlns:w14="urn:evil"><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>` +
        `<w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>` +
        `</w:tbl></w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    const paragraph = newRow.children
      .flatMap((c) => (c.kind === 'tableCell' ? c.children : []))
      .find((c) => c.kind === 'paragraph')!;
    const paraId = paraIdOf(paragraph);
    expect(paraId).not.toBeNull();
    expect(isValidParaId(paraId!)).toBe(true);

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
    const reopenedPara = collectByKind(reopened.part.root, 'paragraph').find(
      (p) => paraIdOf(p) === paraId
    );
    expect(reopenedPara).toBeDefined();
  });

  test('mints paraId when source row shadows w14 but target table ancestry does not', () => {
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr xmlns:w14="urn:evil">${CELL('a')}</w:tr></w:tbl></w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    expect(newRow.namespaceBindings).toEqual([]);
    const paragraph = newRow.children
      .flatMap((c) => (c.kind === 'tableCell' ? c.children : []))
      .find((c) => c.kind === 'paragraph')!;
    const paraId = paraIdOf(paragraph);
    expect(paraId).not.toBeNull();
    expect(isValidParaId(paraId!)).toBe(true);

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

  test('omits paraId when target table ancestry shadows the root w14 prefix', () => {
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        `<w:tbl xmlns:w14="urn:evil"><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a')}</w:tr></w:tbl></w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
      result.effect.created.includes(r.id)
    )!;
    const paragraph = newRow.children
      .flatMap((c) => (c.kind === 'tableCell' ? c.children : []))
      .find((c) => c.kind === 'paragraph')!;
    expect(paraIdOf(paragraph)).toBeNull();

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

  test('rejects zero-cell source rows before allocation', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:trPr/></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    expect(
      validateTreeOp(part, { op: 'insertTableRow', tableId: table.id, rowId: row!, where: 'below' })
    ).toBe('tree-invariant');
  });

  test('mints valid unique w14 paraIds with one shared used set', () => {
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${TABLE(ROW(CELL('a1'), CELL('a2')))}</w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);
    const beforeIds = new Set(
      collectByKind(part.root, 'paragraph')
        .map((p) => paraIdOf(p))
        .filter((id): id is string => id !== null)
    );

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const minted = result.effect.created
      .map((id) => collectByKind(result.part.root, 'paragraph').find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map((p) => paraIdOf(p))
      .filter((id): id is string => id !== null);

    expect(minted).toHaveLength(2);
    const unique = new Set(minted.map((id) => id.toUpperCase()));
    expect(unique.size).toBe(2);
    for (const id of minted) {
      expect(isValidParaId(id)).toBe(true);
      expect(beforeIds.has(id.toUpperCase())).toBe(false);
    }
  });

  test('w14 paraIds stay stable through save/reopen', () => {
    const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${TABLE(ROW(CELL('a')))}</w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: row!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mintedBefore = collectByKind(result.part.root, 'paragraph')
      .map((p) => paraIdOf(p))
      .filter((id): id is string => id !== null);

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);

    const mintedAfter = collectByKind(reopened.part.root, 'paragraph')
      .map((p) => paraIdOf(p))
      .filter((id): id is string => id !== null);
    expect(mintedAfter).toEqual(expect.arrayContaining(mintedBefore));
  });

  test('rejects unknown table and row ids', () => {
    const part = load(TABLE(ROW(CELL('a'))));
    const table = firstTable(part);

    expect(
      validateTreeOp(part, {
        op: 'insertTableRow',
        tableId: 'missing-table',
        rowId: rowIds(part, table.id)[0]!,
        where: 'below',
      })
    ).toBe('unknown-table');

    expect(
      validateTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: 'missing-row',
        where: 'below',
      })
    ).toBe('unknown-row');
  });

  test('does not mutate nested tables when editing the outer table', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tbl><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>` +
        `<w:tr>${CELL('nested')}</w:tr></w:tbl></w:tc>${CELL('outer')}</w:tr></w:tbl>`
    );
    const outer = firstTable(part);
    const nestedTable = collectByKind(part.root, 'table')[1]!;
    const outerRow = rowIds(part, outer.id)[0]!;

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: outer.id,
      rowId: outerRow,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nestedAfter = collectByKind(result.part.root, 'table')[1]!;
    expect(nestedAfter).toBe(nestedTable);
  });

  describe('WML namespace context for fresh row skeletons', () => {
    function assertEditedReopens(
      resultPart: OoxmlPart,
      partName: string,
      contentType: string
    ): void {
      const serialized = serializeOoxmlPart(resultPart);
      const reopened = readOoxmlPart(serialized, { name: partName, contentType });
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(resultPart));
      expect(
        diffSemanticDigests(semanticDigest([resultPart]), semanticDigest([reopened.part]))
      ).toEqual([]);
    }

    test('uses in-scope wx alias when w is not declared', () => {
      const opened = readOoxmlPart(
        `<wx:document xmlns:wx="${W}"><wx:body>` +
          `<wx:tbl><wx:tblGrid><wx:gridCol wx:w="2400"/></wx:tblGrid>` +
          `<wx:tr><wx:tc><wx:tcPr><wx:tcW wx:w="2400" wx:type="dxa"/></wx:tcPr>` +
          `<wx:p><wx:r><wx:t>a</wx:t></wx:r></wx:p></wx:tc></wx:tr>` +
          `</wx:tbl></wx:body></wx:document>`,
        {
          name: '/word/document.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        }
      );
      if (!opened.ok) throw new Error(opened.reason);
      const part = opened.part;
      const table = firstTable(part);
      const [row] = rowIds(part, table.id);

      const result = applyTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: row!,
        where: 'below',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
        result.effect.created.includes(r.id)
      )!;
      expect(newRow.prefix).toBe('wx');
      expect(newRow.namespaceBindings).toEqual([]);
      const tcW = wmlChildNamed(
        wmlChildNamed(
          newRow.children.find((c) => c.kind === 'tableCell')!,
          'tcPr'
        )!,
        'tcW'
      )!;
      expect(tcW.prefix).toBe('wx');
      expect(tcW.attributes.every((a) => a.prefix === 'wx' && a.namespaceUri === W)).toBe(true);
      expect(tcW.attributes.find((a) => a.localName === 'w')?.value).toBe('2400');
      expect(tcW.attributes.find((a) => a.localName === 'type')?.value).toBe('dxa');
      assertEditedReopens(result.part, part.name, part.contentType);
    });

    test('uses default element namespace with in-scope w for projected attributes', () => {
      const opened = readOoxmlPart(
        `<document xmlns="${W}"><body>` +
          `<tbl xmlns:w="${W}"><tblGrid><gridCol w:w="2400"/></tblGrid>` +
          `<tr><tc><tcPr><tcW w:w="2400" w:type="dxa"/></tcPr>` +
          `<p><r><t>a</t></r></p></tc></tr></tbl></body></document>`,
        {
          name: '/word/document.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        }
      );
      if (!opened.ok) throw new Error(opened.reason);
      const part = opened.part;
      const table = firstTable(part);
      const [row] = rowIds(part, table.id);

      const result = applyTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: row!,
        where: 'below',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
        result.effect.created.includes(r.id)
      )!;
      expect(newRow.prefix).toBeUndefined();
      expect(newRow.namespaceBindings).toEqual([]);
      const tcW = wmlChildNamed(
        wmlChildNamed(
          newRow.children.find((c) => c.kind === 'tableCell')!,
          'tcPr'
        )!,
        'tcW'
      )!;
      expect(tcW.prefix).toBeUndefined();
      expect(tcW.attributes.every((a) => a.prefix === 'w')).toBe(true);
      assertEditedReopens(result.part, part.name, part.contentType);
    });

    test('declares a safe generated alias when hostile w shadows the WML binding', () => {
      const hostile = 'urn:attacker/wml-shadow';
      const opened = readOoxmlPart(
        `<wx:document xmlns:wx="${W}"><wx:body>` +
          `<wx:tbl xmlns:w="${hostile}"><wx:tblGrid><wx:gridCol wx:w="2400"/></wx:tblGrid>` +
          `<wx:tr><wx:tc><wx:tcPr><wx:tcW wx:w="2400" wx:type="dxa"/></wx:tcPr>` +
          `<wx:p><wx:r><wx:t>a</wx:t></wx:r></wx:p></wx:tc></wx:tr>` +
          `</wx:tbl></wx:body></wx:document>`,
        {
          name: '/word/document.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        }
      );
      if (!opened.ok) throw new Error(opened.reason);
      const part = opened.part;
      const table = firstTable(part);
      const [row] = rowIds(part, table.id);

      const result = applyTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: row!,
        where: 'below',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
        result.effect.created.includes(r.id)
      )!;
      expect(newRow.prefix).toBe('wx');
      expect(newRow.namespaceBindings).toEqual([]);
      const tcW = wmlChildNamed(
        wmlChildNamed(
          newRow.children.find((c) => c.kind === 'tableCell')!,
          'tcPr'
        )!,
        'tcW'
      )!;
      expect(tcW.attributes.every((a) => a.prefix === 'wx' && a.namespaceUri === W)).toBe(true);
      expect(tcW.attributes.find((a) => a.localName === 'w')?.value).toBe('2400');
      assertEditedReopens(result.part, part.name, part.contentType);
    });

    test('allocates a row binding when default WML lacks a non-empty attribute prefix', () => {
      const opened = readOoxmlPart(
        `<document xmlns="${W}"><body>` +
          `<tbl><tblGrid><gridCol/></tblGrid>` +
          `<tr><tc><tcPr><cantSplit/></tcPr><p><r><t>a</t></r></p></tc></tr>` +
          `</tbl></body></document>`,
        {
          name: '/word/document.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        }
      );
      if (!opened.ok) throw new Error(opened.reason);
      const part = opened.part;
      const table = firstTable(part);
      const [row] = rowIds(part, table.id);

      const result = applyTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: row!,
        where: 'below',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
        result.effect.created.includes(r.id)
      )!;
      expect(newRow.prefix).toBeUndefined();
      expect(newRow.namespaceBindings).toEqual([{ prefix: 'w', namespaceUri: W }]);
      assertEditedReopens(result.part, part.name, part.contentType);
    });

    test('projects safe property attributes with preserved values under alternate prefixes', () => {
      const opened = readOoxmlPart(
        `<wx:document xmlns:wx="${W}"><wx:body>` +
          `<wx:tbl><wx:tblGrid><wx:gridCol wx:w="2400"/></wx:tblGrid>` +
          `<wx:tr><wx:tc><wx:tcPr>` +
          `<wx:tcW wx:w="1800" wx:type="dxa"/>` +
          `<wx:shd wx:val="clear" wx:fill="FF0000"/>` +
          `</wx:tcPr><wx:p><wx:r><wx:t>a</wx:t></wx:r></wx:p></wx:tc></wx:tr>` +
          `</wx:tbl></wx:body></wx:document>`,
        {
          name: '/word/document.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        }
      );
      if (!opened.ok) throw new Error(opened.reason);
      const part = opened.part;
      const table = firstTable(part);
      const [row] = rowIds(part, table.id);

      const result = applyTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: row!,
        where: 'below',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const newRow = collectByKind(result.part.root, 'tableRow').find((r) =>
        result.effect.created.includes(r.id)
      )!;
      const tcPr = wmlChildNamed(
        newRow.children.find((c) => c.kind === 'tableCell')!,
        'tcPr'
      )!;
      const tcW = wmlChildNamed(tcPr, 'tcW')!;
      const shd = wmlChildNamed(tcPr, 'shd')!;
      expect(tcW.attributes.find((a) => a.localName === 'w')?.value).toBe('1800');
      expect(shd?.attributes.find((a) => a.localName === 'fill')?.value).toBe('FF0000');
      expect(
        [...tcW.attributes, ...(shd?.attributes ?? [])].every(
          (a) => a.prefix === 'wx' && a.namespaceUri === W
        )
      ).toBe(true);
      assertEditedReopens(result.part, part.name, part.contentType);
    });
  });
});

describe('deleteTableRow', () => {
  test('pending deletions cannot keep a table alive for another row suggestion', () => {
    const part = load(TABLE(ROW(CELL('remove')), ROW(CELL('keep'))));
    const table = firstTable(part);
    const [first, second] = rowIds(part, table.id);
    const revision = { author: 'Writer', date: '2026-10-01T00:00:00Z' };
    const proposed = applyTreeOp(part, {
      op: 'deleteTableRow',
      tableId: table.id,
      rowId: first!,
      revision,
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const before = serializeOoxmlPart(proposed.part);
    expect(
      applyTreeOp(proposed.part, {
        op: 'deleteTableRow',
        tableId: table.id,
        rowId: second!,
        revision,
      })
    ).toMatchObject({ ok: false, reason: 'block-required' });
    expect(serializeOoxmlPart(proposed.part)).toBe(before);
  });

  test('removes the targeted row and its cell paragraphs', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);
    const deletedParagraphs = collectByKind(part.root, 'paragraph')
      .filter((p) => {
        const row = collectByKind(part.root, 'tableRow').find((r) => r.id === first);
        return row?.children.some(
          (c) => c.kind === 'tableCell' && c.children.some((ch) => ch.id === p.id)
        );
      })
      .map((p) => p.id);

    const result = applyTreeOp(part, { op: 'deleteTableRow', tableId: table.id, rowId: first! });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(rowIds(result.part, table.id)).toHaveLength(1);
    expect(result.effect.deleted).toContain(first!);
    for (const id of deletedParagraphs) expect(result.effect.deleted).toContain(id);
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('refuses deleting the final row without mutation', () => {
    const part = load(TABLE(ROW(CELL('only'))));
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const result = applyTreeOp(part, { op: 'deleteTableRow', tableId: table.id, rowId: row! });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('block-required');
    expect(rowIds(part, table.id)).toHaveLength(1);
  });

  test('preserves unaffected row identity', () => {
    const part = load(TABLE(ROW(CELL('a')), ROW(CELL('b'))));
    const table = firstTable(part);
    const rowsBefore = collectByKind(part.root, 'tableRow');
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, { op: 'deleteTableRow', tableId: table.id, rowId: first! });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(collectByKind(result.part.root, 'tableRow')[0]).toBe(rowsBefore[1]);
  });
});

describe('table row resource limits', () => {
  test('refuses insertion that would exceed maxRows', () => {
    const rows = Array.from({ length: 3 }, () => ROW(CELL('x'))).join('');
    const part = load(`<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${rows}</w:tbl>`);
    const table = firstTable(part);
    const [row] = rowIds(part, table.id);

    const rejection = validateTableRowOp(
      part,
      { op: 'insertTableRow', tableId: table.id, rowId: row!, where: 'below' },
      { maxRows: 3, maxColumns: 1024, maxTraversalNodes: 1_000_000 }
    );
    expect(rejection).toBe('resource-limit');
  });
});
