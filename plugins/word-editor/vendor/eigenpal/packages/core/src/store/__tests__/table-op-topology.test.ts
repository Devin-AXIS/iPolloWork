// Bounded direct-child table topology and lossless property patching (table-editing task 2).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { readEditableTableTopology } from '../store/tree-op-table-topology.ts';
import { cachedUniqueNode, findNode, insertChildren } from '../package/ooxml-edit.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { withRepeated } from './repeated-node-support.ts';
import {
  CT_TBLPR_SEQUENCE,
  CT_TRPR_SEQUENCE,
  CT_TCPR_SEQUENCE,
  insertTblGridColumn,
  patchPropertyChild,
  patchTblGridColumn,
  patchTblPrChild,
  patchTcPrChild,
  patchTrPrChild,
  removeTcPrChild,
  removeTblPrChild,
  removeTrPrChild,
} from '../store/tree-op-table-properties.ts';
import {
  DEFAULT_TABLE_TOPOLOGY_LIMITS,
  MAX_TABLE_COLUMNS,
  resolveTableTopologyLimits,
  type TableTopologyLimits,
} from '../store/table-constraints.ts';

const W = WML_NAMESPACE_URI;
const FOREIGN = 'http://example.com/foreign';
const limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function generic(
  localName: string,
  children: OoxmlNode[] = [],
  attrs: Record<string, string> = {},
  id?: string
): OoxmlElement {
  return {
    id: id ?? `${localName}-${Math.random()}`,
    kind: 'generic',
    namespaceUri: W,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: Object.entries(attrs).map(([localName, value]) => ({
      kind: 'genericExtension' as const,
      namespaceUri: W,
      localName,
      prefix: 'w',
      value,
    })),
    children,
  } as OoxmlElement;
}

function foreignElement(localName: string, id?: string): OoxmlElement {
  return {
    id: id ?? `foreign-${localName}`,
    kind: 'generic',
    namespaceUri: FOREIGN,
    localName,
    prefix: 'x',
    namespaceBindings: [{ prefix: 'x', namespaceUri: FOREIGN }],
    attributes: [],
    children: [],
  } as OoxmlElement;
}

function collectByKind(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function firstTable(part: OoxmlPart): OoxmlElement {
  const tables = collectByKind(part.root, 'table');
  if (tables.length === 0) throw new Error('no table');
  return tables[0]!;
}

const CELL =
  '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>';

describe('readEditableTableTopology', () => {
  test('uses the warm index while bounding the addressed table subtree', () => {
    const part = load('<w:p/>'.repeat(200) + `<w:tbl><w:tr>${CELL}</w:tr></w:tbl>`);
    const table = firstTable(part);
    const tight = { ...limits, maxTraversalNodes: 30 };
    expect(readEditableTableTopology(part.root, table.id, tight).ok).toBe(false);
    expect(findNode(part, table.id)).toBe(table);
    expect(readEditableTableTopology(part.root, table.id, tight).ok).toBe(true);
    expect(
      readEditableTableTopology(part.root, table.id, { ...tight, maxTraversalNodes: 2 }).ok
    ).toBe(false);
    const paragraph = collectByKind(part.root, 'paragraph')[0]!;
    const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 0 });
    expect(split.ok).toBe(true);
    if (split.ok) {
      expect(cachedUniqueNode(split.part.root, table.id)).toBe(table);
      expect(readEditableTableTopology(split.part.root, table.id, tight).ok).toBe(true);
    }
  });

  test('a warm index never hides duplicate ids introduced by a deferred edit', () => {
    const part = load(`<w:tbl><w:tr>${CELL}</w:tr></w:tbl>`);
    const table = firstTable(part);
    findNode(part, table.id);
    const body = part.root.children.find((node) => node.kind === 'body')!;
    const changed = insertChildren(part, body.id, 1, [table], { deferValidation: true });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const result = readEditableTableTopology(changed.part.root, table.id);
    expect(result).toMatchObject({ ok: false, reason: 'duplicate-node-id' });
  });

  test('reads direct rows and cells only', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL}${CELL}</w:tr><w:tr>${CELL}${CELL}</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.rows).toHaveLength(2);
    expect(result.topology.rows[0]!.cells).toHaveLength(2);
    expect(result.topology.gridColumns).toHaveLength(2);
  });

  test('missing grid yields undefined grid and empty gridColumns', () => {
    const part = load(`<w:tbl><w:tr>${CELL}</w:tr></w:tbl>`);
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.grid).toBeUndefined();
    expect(result.topology.gridColumns).toEqual([]);
  });

  test('isolates nested tables', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tbl><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>` +
        `<w:tr>${CELL}</w:tr></w:tbl><w:p/></w:tc></w:tr></w:tbl>`
    );
    const tables = collectByKind(part.root, 'table');
    const outer = tables[0]!;
    const nestedCells = collectByKind(part.root, 'tableCell').filter((cell) => {
      const nested = readEditableTableTopology(part.root, tables[1]!.id, limits);
      return (
        nested.ok && nested.topology.rows.some((row) => row.cells.some((c) => c.id === cell.id))
      );
    });
    const nestedCellId = nestedCells[0]!.id;
    const result = readEditableTableTopology(part.root, outer.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.rows[0]!.cells).not.toContainEqual(
      expect.objectContaining({ id: nestedCellId })
    );
  });

  test('records merge topology without refusing the table', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr>` +
        `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>` +
        `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.hasMerge).toBe(true);
  });

  test('detects hMerge as horizontal merge from WML only', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:hMerge w:val="1"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.hasMerge).toBe(true);
  });

  test('ignores foreign-namespace merge leaves', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><x:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.hasMerge).toBe(false);
  });

  test('reads irregular row cell counts', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL}${CELL}</w:tr><w:tr>${CELL}${CELL}${CELL}</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.rows[0]!.cells).toHaveLength(2);
    expect(result.topology.rows[1]!.cells).toHaveLength(3);
  });

  test('reads a repeated trPr as merged, and refuses one only for repeated revision markup', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:trPr/><x:trPr/>${CELL}</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);

    const read = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:trPr/><w:trPr/>${CELL}</w:tr></w:tbl>`
    );
    // A file with two opens with one; a tree a merge left with two reads as the heal leaves it.
    expect(readEditableTableTopology(read.root, firstTable(read).id, limits).ok).toBe(true);
    const dup = withRepeated(read, 'trPr');
    expect(readEditableTableTopology(dup.root, firstTable(dup).id, limits).ok).toBe(true);

    // Two copies that each carry a row change cannot merge: which history survives is open.
    const tracked = withRepeated(
      load(
        `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:trPr>` +
          `<w:trPrChange w:id="1" w:author="A"><w:trPr/></w:trPrChange></w:trPr>${CELL}</w:tr></w:tbl>`
      ),
      'trPr'
    );
    const refused = readEditableTableTopology(tracked.root, firstTable(tracked).id, limits);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe('duplicate-property-container');
  });

  test('reads a repeated tcPr as merged, and refuses one only for repeated revision markup', () => {
    const foreignOk = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr/><x:tcPr/><w:p/></w:tc></w:tr></w:tbl>`
    );
    expect(readEditableTableTopology(foreignOk.root, firstTable(foreignOk).id, limits).ok).toBe(
      true
    );

    const read = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr/><w:tcPr/><w:p/></w:tc></w:tr></w:tbl>`
    );
    expect(readEditableTableTopology(read.root, firstTable(read).id, limits).ok).toBe(true);
    const part = withRepeated(read, 'tcPr');
    expect(readEditableTableTopology(part.root, firstTable(part).id, limits).ok).toBe(true);

    const tracked = withRepeated(
      load(
        `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr>` +
          `<w:cellIns w:id="1" w:author="A"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
      ),
      'tcPr'
    );
    const result = readEditableTableTopology(tracked.root, firstTable(tracked).id, limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-property-container');
  });

  test('rejects duplicate grid-column ids', () => {
    const col1 = generic('gridCol', [], { w: '2400' }, 'dup-grid-id');
    const col2 = generic('gridCol', [], { w: '3600' }, 'dup-grid-id');
    const grid = {
      id: 'grid-1',
      kind: 'tableGrid' as const,
      namespaceUri: W,
      localName: 'tblGrid',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [col1, col2],
    };
    const row = {
      id: 'row-1',
      kind: 'tableRow' as const,
      namespaceUri: W,
      localName: 'tr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [
        {
          id: 'cell-1',
          kind: 'tableCell' as const,
          namespaceUri: W,
          localName: 'tc',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [],
          children: [generic('p', [generic('r', [generic('t', [], {}, 't-1')])])],
        },
      ],
    };
    const table = {
      id: 'table-dup-grid',
      kind: 'table' as const,
      namespaceUri: W,
      localName: 'tbl',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [grid, row],
    };
    const root = {
      id: 'root',
      kind: 'document' as const,
      namespaceUri: W,
      localName: 'document',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [
        {
          id: 'body',
          kind: 'body' as const,
          namespaceUri: W,
          localName: 'body',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [],
          children: [table],
        },
      ],
    };
    const result = readEditableTableTopology(root, 'table-dup-grid', limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-node-id');
  });

  test('rejects duplicate table ids during lookup', () => {
    const table = {
      id: 'dup-table-id',
      kind: 'table' as const,
      namespaceUri: W,
      localName: 'tbl',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [
        {
          id: 'grid-1',
          kind: 'tableGrid' as const,
          namespaceUri: W,
          localName: 'tblGrid',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [],
          children: [generic('gridCol', [], { w: '2400' }, 'col-1')],
        },
      ],
    };
    const impostor = foreignElement('tbl', 'dup-table-id');
    const root = {
      id: 'root',
      kind: 'document' as const,
      namespaceUri: W,
      localName: 'document',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [
        {
          id: 'body',
          kind: 'body' as const,
          namespaceUri: W,
          localName: 'body',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [],
          children: [table, impostor],
        },
      ],
    };
    const result = readEditableTableTopology(root, 'dup-table-id', limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-node-id');
  });

  test('collects WML gridCol elements only', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/><x:gridCol/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr>${CELL}${CELL}</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const result = readEditableTableTopology(part.root, table.id, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.gridColumns).toHaveLength(2);
  });
});

describe('patchPropertyChild', () => {
  test('replaces one named property in schema order', () => {
    const container = generic('tblPr', [
      generic('tblW', [], { w: '5000', type: 'dxa' }),
      generic('jc', [], { val: 'center' }),
    ]);
    const replacement = generic('tblW', [], { w: '9000', type: 'dxa' });
    const patched = patchPropertyChild(container, replacement, CT_TBLPR_SEQUENCE, 'tblW');
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    const names = patched.container.children
      .filter((c) => c.kind !== 'textValue')
      .map((c) => c.localName);
    expect(names.indexOf('tblW')).toBeLessThan(names.indexOf('jc'));
  });

  test('removes a property by expanded name', () => {
    const shd = generic('shd', [], { fill: 'FF0000' });
    const container = generic('tcPr', [generic('tcW', [], { w: '2400', type: 'dxa' }), shd]);
    const patched = removeTcPrChild(container, 'shd');
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(
      patched.container.children.some((c) => c.kind !== 'textValue' && c.localName === 'shd')
    ).toBe(false);
    expect(patched.container.children[0]).toBe(container.children[0]);
  });

  test('returns original container on no-op removal', () => {
    const container = generic('tblPr', [generic('tblW', [], { w: '5000', type: 'dxa' })]);
    const patched = removeTblPrChild(container, 'jc');
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.container).toBe(container);
  });

  test('returns original container when replacement is identical', () => {
    const tblW = generic('tblW', [], { w: '5000', type: 'dxa' });
    const container = generic('tblPr', [tblW, generic('jc', [], { val: 'center' })]);
    const patched = patchPropertyChild(container, tblW, CT_TBLPR_SEQUENCE, 'tblW');
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.container).toBe(container);
  });

  test('preserves foreign same-local-name siblings and their order during ranking', () => {
    const foreignTblW = foreignElement('tblW', 'foreign-tblW');
    const foreignJc = foreignElement('jc', 'foreign-jc');
    const container = generic('tblPr', [
      foreignTblW,
      generic('jc', [], { val: 'center' }),
      foreignJc,
    ]);
    const replacement = generic('tblW', [], { w: '9000', type: 'dxa' });
    const patched = patchPropertyChild(container, replacement, CT_TBLPR_SEQUENCE, 'tblW');
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.container.children[0]).toBe(foreignTblW);
    expect(patched.container.children[3]).toBe(foreignJc);
    const wmlTblW = patched.container.children.find(
      (c) => c.kind !== 'textValue' && c.namespaceUri === W && c.localName === 'tblW'
    );
    expect(wmlTblW).toBe(replacement);
  });

  test('rejects foreign-namespace replacement leaves', () => {
    const container = generic('tcPr', []);
    const foreign = foreignElement('shd');
    const patched = patchPropertyChild(container, foreign, CT_TCPR_SEQUENCE, 'shd');
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.reason).toBe('wrong-expanded-name');
  });

  test('matches WML property leaves without touching foreign same-local-name leaves', () => {
    const wmlShd = generic('shd', [], { fill: '111111' });
    const foreignShd = foreignElement('shd', 'foreign-shd');
    const container = generic('tcPr', [wmlShd, foreignShd]);
    const replacement = generic('shd', [], { fill: '222222' });
    const patched = patchPropertyChild(container, replacement, CT_TCPR_SEQUENCE, 'shd');
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    const shds = patched.container.children.filter(
      (c) => c.kind !== 'textValue' && c.localName === 'shd'
    );
    expect(shds).toHaveLength(2);
    expect(shds[0]).toBe(replacement);
    expect(shds[1]).toBe(foreignShd);
  });

  test('normalizes out-of-order tblPr on identical replacement', () => {
    const tblW = generic('tblW', [], { w: '5000', type: 'dxa' });
    const jc = generic('jc', [], { val: 'center' });
    const container = generic('tblPr', [jc, tblW]);
    const result = patchPropertyChild(container, tblW, CT_TBLPR_SEQUENCE, 'tblW');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.container).not.toBe(container);
    const names = result.container.children
      .filter((c) => c.kind !== 'textValue')
      .map((c) => c.localName);
    expect(names.indexOf('tblW')).toBeLessThan(names.indexOf('jc'));
  });

  test('normalizes out-of-order trPr on absent removal', () => {
    const cantSplit = generic('cantSplit');
    const tblHeader = generic('tblHeader');
    const container = generic('trPr', [tblHeader, cantSplit]);
    const result = removeTrPrChild(container, 'missing');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.container).not.toBe(container);
    const names = result.container.children
      .filter((c) => c.kind !== 'textValue')
      .map((c) => c.localName);
    expect(names.indexOf('cantSplit')).toBeLessThan(names.indexOf('tblHeader'));
  });

  test('normalizes out-of-order tcPr on identical replacement', () => {
    const tcW = generic('tcW', [], { w: '2400', type: 'dxa' });
    const shd = generic('shd', [], { fill: 'FF0000', val: 'clear' });
    const container = generic('tcPr', [shd, tcW]);
    const result = patchPropertyChild(container, tcW, CT_TCPR_SEQUENCE, 'tcW');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.container).not.toBe(container);
    const names = result.container.children
      .filter((c) => c.kind !== 'textValue')
      .map((c) => c.localName);
    expect(names.indexOf('tcW')).toBeLessThan(names.indexOf('shd'));
  });

  test('retains identity for already ordered semantic no-op replacement', () => {
    const tblW = generic('tblW', [], { w: '5000', type: 'dxa' });
    const jc = generic('jc', [], { val: 'center' });
    const container = generic('tblPr', [tblW, jc]);
    const result = patchPropertyChild(container, tblW, CT_TBLPR_SEQUENCE, 'tblW');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.container).toBe(container);
  });

  test('retains identity for already ordered absent removal', () => {
    const container = generic('trPr', [generic('cantSplit'), generic('tblHeader')]);
    const result = removeTrPrChild(container, 'missing');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.container).toBe(container);
  });
});

describe('patchTblGridColumn', () => {
  test('replaces one grid column by id', () => {
    const col1 = generic('gridCol', [], { w: '2400' }, 'col-1');
    const col2 = generic('gridCol', [], { w: '3600' }, 'col-2');
    const grid = generic('tblGrid', [col1, col2]);
    const replacement = generic('gridCol', [], { w: '4800' }, 'col-1-new');
    const result = patchTblGridColumn(grid, 'col-1', replacement);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grid.children[0]).toBe(replacement);
    expect(result.grid.children[1]).toBe(col2);
  });

  test('removes one grid column by id', () => {
    const col1 = generic('gridCol', [], { w: '2400' }, 'col-1');
    const col2 = generic('gridCol', [], { w: '3600' }, 'col-2');
    const grid = generic('tblGrid', [col1, col2]);
    const result = patchTblGridColumn(grid, 'col-1', null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grid.children).toHaveLength(1);
    expect(result.grid.children[0]).toBe(col2);
  });

  test('rejects unknown grid-column id without appending', () => {
    const grid = generic('tblGrid', [generic('gridCol', [], { w: '2400' }, 'col-1')]);
    const result = patchTblGridColumn(
      grid,
      'missing',
      generic('gridCol', [], { w: '1000' }, 'new')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-grid-column');
    expect(grid.children).toHaveLength(1);
  });

  test('rejects duplicate grid-column ids', () => {
    const col = generic('gridCol', [], { w: '2400' }, 'dup');
    const grid = generic('tblGrid', [col, generic('gridCol', [], { w: '3600' }, 'dup')]);
    const result = patchTblGridColumn(
      grid,
      'dup',
      generic('gridCol', [], { w: '1000' }, 'replacement')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
  });

  test('rejects extension-node id collision without a WML gridCol', () => {
    const ext = foreignElement('gridCol', 'collision');
    const grid = generic('tblGrid', [ext]);
    const result = patchTblGridColumn(
      grid,
      'collision',
      generic('gridCol', [], { w: '2400' }, 'replacement')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('extension-collision');
  });

  test('insertTblGridColumn appends explicitly', () => {
    const grid = generic('tblGrid', [generic('gridCol', [], { w: '2400' }, 'col-1')]);
    const added = generic('gridCol', [], { w: '3600' }, 'col-2');
    const result = insertTblGridColumn(grid, added);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grid.children).toHaveLength(2);
    expect(result.grid.children[1]).toBe(added);
  });

  test('rejects mixed WML gridCol and extension id collision', () => {
    const wmlCol = generic('gridCol', [], { w: '2400' }, 'mixed-id');
    const ext = foreignElement('gridCol', 'mixed-id');
    const grid = generic('tblGrid', [wmlCol, ext]);
    const result = patchTblGridColumn(
      grid,
      'mixed-id',
      generic('gridCol', [], { w: '4800' }, 'replacement')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('extension-collision');
    expect(grid.children[0]).toBe(wmlCol);
  });

  test('insertTblGridColumn rejects duplicate child ids', () => {
    const grid = generic('tblGrid', [generic('gridCol', [], { w: '2400' }, 'taken-id')]);
    const duplicate = generic('gridCol', [], { w: '3600' }, 'taken-id');
    const result = insertTblGridColumn(grid, duplicate);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
    expect(grid.children).toHaveLength(1);
  });

  test('insertTblGridColumn rejects extension id collision', () => {
    const ext = foreignElement('gridCol', 'taken-id');
    const grid = generic('tblGrid', [ext]);
    const result = insertTblGridColumn(grid, generic('gridCol', [], { w: '3600' }, 'taken-id'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
  });

  test('insertTblGridColumn rejects id colliding with a direct text child', () => {
    const textChild = { id: 'text-id', kind: 'textValue' as const, value: 'noise' };
    const grid = generic('tblGrid', [textChild]);
    const result = insertTblGridColumn(grid, generic('gridCol', [], { w: '3600' }, 'text-id'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
    expect(grid.children).toHaveLength(1);
    expect(grid.children[0]).toBe(textChild);
  });

  test('returns original grid on identical replacement', () => {
    const col = generic('gridCol', [], { w: '2400' }, 'col-1');
    const grid = generic('tblGrid', [col]);
    const result = patchTblGridColumn(grid, 'col-1', col);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grid).toBe(grid);
  });

  test('rejects replacement id colliding with another WML gridCol', () => {
    const col1 = generic('gridCol', [], { w: '2400' }, 'col-1');
    const col2 = generic('gridCol', [], { w: '3600' }, 'col-2');
    const grid = generic('tblGrid', [col1, col2]);
    const result = patchTblGridColumn(
      grid,
      'col-1',
      generic('gridCol', [], { w: '4800' }, 'col-2')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
    expect(grid.children[0]).toBe(col1);
    expect(grid.children[1]).toBe(col2);
  });

  test('rejects replacement id colliding with an extension child', () => {
    const col1 = generic('gridCol', [], { w: '2400' }, 'col-1');
    const ext = foreignElement('gridCol', 'ext-id');
    const grid = generic('tblGrid', [col1, ext]);
    const result = patchTblGridColumn(
      grid,
      'col-1',
      generic('gridCol', [], { w: '4800' }, 'ext-id')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
    expect(grid.children[0]).toBe(col1);
    expect(grid.children[1]).toBe(ext);
  });

  test('rejects replacement id colliding with a direct text child', () => {
    const col1 = generic('gridCol', [], { w: '2400' }, 'col-1');
    const textChild = { id: 'text-id', kind: 'textValue' as const, value: 'noise' };
    const grid = generic('tblGrid', [col1, textChild]);
    const result = patchTblGridColumn(
      grid,
      'col-1',
      generic('gridCol', [], { w: '4800' }, 'text-id')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
    expect(grid.children[0]).toBe(col1);
    expect(grid.children[1]).toBe(textChild);
  });

  test('rejects identical replacement when a text child duplicates the target id', () => {
    const col = generic('gridCol', [], { w: '2400' }, 'col-1');
    const textChild = { id: 'col-1', kind: 'textValue' as const, value: 'noise' };
    const grid = generic('tblGrid', [col, textChild]);
    const result = patchTblGridColumn(grid, 'col-1', col);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-grid-column');
    expect(grid.children[0]).toBe(col);
    expect(grid.children[1]).toBe(textChild);
  });
});

describe('topology on real fixtures', () => {
  test('with-tables.docx outer table reads without nested cell leakage', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../../../../e2e/fixtures/with-tables.docx`);
    const pkg = readOoxmlPackage(bytes);
    if (!pkg.ok) throw new Error(pkg.reason);
    const part = pkg.package.parts.get(pkg.package.mainDocumentPart)!;
    for (const table of collectByKind(part.root, 'table')) {
      const result = readEditableTableTopology(part.root, table.id, limits);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.topology.grid).toBeUndefined();
      expect(result.topology.gridColumns).toEqual([]);
    }
  });
});

describe('resolveTableTopologyLimits', () => {
  test('clamps custom maxColumns to MAX_TABLE_COLUMNS', () => {
    expect(resolveTableTopologyLimits({ maxColumns: 2048 }).maxColumns).toBe(1024);
    expect(resolveTableTopologyLimits({ maxColumns: Infinity }).maxColumns).toBe(1024);
    expect(resolveTableTopologyLimits({ maxColumns: 0.5 }).maxColumns).toBe(1024);
    expect(resolveTableTopologyLimits({ maxColumns: -1 }).maxColumns).toBe(1024);
  });
});
