// Resource bounds for table topology reads (table-editing task 2).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlElement } from '../package/ooxml-tree.ts';
import { readEditableTableTopology } from '../store/tree-op-table-topology.ts';
import {
  MAX_TABLE_COLUMNS,
  MIN_TABLE_COLUMN_WIDTH_TWIPS,
  resolveTableTopologyLimits,
  type TableTopologyLimits,
} from '../store/table-constraints.ts';
import { MAX_TABLE_COLUMNS as LAYOUT_MAX_TABLE_COLUMNS } from '../../layout/table-widths.ts';

const W = WML_NAMESPACE_URI;

function generic(localName: string, children: OoxmlElement[], id: string): OoxmlElement {
  return {
    id,
    kind: 'generic',
    namespaceUri: W,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as OoxmlElement;
}

function load(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function tableId(part: ReturnType<typeof load>): string {
  const visit = (node: {
    kind: string;
    id: string;
    children: readonly unknown[];
  }): string | null => {
    if (node.kind === 'table') return node.id;
    for (const child of node.children) {
      if (typeof child === 'object' && child !== null && 'kind' in child) {
        const hit = visit(child as { kind: string; id: string; children: readonly unknown[] });
        if (hit) return hit;
      }
    }
    return null;
  };
  const id = visit(part.root as { kind: string; id: string; children: readonly unknown[] });
  if (!id) throw new Error('no table');
  return id;
}

function gridCols(count: number): string {
  return Array.from({ length: count }, () => '<w:gridCol w:w="100"/>').join('');
}

function rowCells(count: number): string {
  return `<w:tr>${Array.from({ length: count }, () => '<w:tc><w:p/></w:tc>').join('')}</w:tr>`;
}

describe('table constraint authority', () => {
  test('layout and store share one MAX_TABLE_COLUMNS bound', () => {
    expect(MAX_TABLE_COLUMNS).toBe(LAYOUT_MAX_TABLE_COLUMNS);
    expect(MAX_TABLE_COLUMNS).toBe(1024);
  });

  test('MIN_TABLE_COLUMN_WIDTH_TWIPS matches resize minimum', () => {
    expect(MIN_TABLE_COLUMN_WIDTH_TWIPS).toBe(300);
  });
});

describe('readEditableTableTopology resource limits', () => {
  test('rejects tables exceeding maxRows before large allocation', () => {
    const rows = Array.from({ length: 50 }, () => '<w:tr><w:tc><w:p/></w:tc></w:tr>').join('');
    const part = load(`<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${rows}</w:tbl>`);
    const tight: TableTopologyLimits = {
      maxRows: 10,
      maxColumns: MAX_TABLE_COLUMNS,
      maxTraversalNodes: 1_000_000,
    };
    const result = readEditableTableTopology(part.root, tableId(part), tight);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('resource-limit');
    expect(result.detail).toBe('maxRows');
  });

  test('rejects tables exceeding maxColumns before large allocation', () => {
    const part = load(`<w:tbl><w:tblGrid>${gridCols(50)}</w:tblGrid>${rowCells(50)}</w:tbl>`);
    const tight: TableTopologyLimits = {
      maxRows: 10_000,
      maxColumns: 20,
      maxTraversalNodes: 1_000_000,
    };
    const result = readEditableTableTopology(part.root, tableId(part), tight);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('resource-limit');
    expect(result.detail).toBe('maxColumns');
  });

  test('accepts exactly MAX_TABLE_COLUMNS grid columns', () => {
    const part = load(
      `<w:tbl><w:tblGrid>${gridCols(MAX_TABLE_COLUMNS)}</w:tblGrid>${rowCells(1)}</w:tbl>`
    );
    const result = readEditableTableTopology(part.root, tableId(part));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.gridColumns).toHaveLength(MAX_TABLE_COLUMNS);
  });

  test('rejects 1025 grid columns without returning an oversized topology', () => {
    const part = load(
      `<w:tbl><w:tblGrid>${gridCols(MAX_TABLE_COLUMNS + 1)}</w:tblGrid>${rowCells(1)}</w:tbl>`
    );
    const result = readEditableTableTopology(part.root, tableId(part));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('resource-limit');
    expect(result.detail).toBe('maxColumns');
  });

  test('clamps caller maxColumns above 1024 down to the store ceiling', () => {
    const part = load(`<w:tbl><w:tblGrid>${gridCols(30)}</w:tblGrid>${rowCells(30)}</w:tbl>`);
    const result = readEditableTableTopology(part.root, tableId(part), {
      maxRows: 10_000,
      maxColumns: 2048,
      maxTraversalNodes: 1_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.gridColumns).toHaveLength(30);

    const over = load(
      `<w:tbl><w:tblGrid>${gridCols(MAX_TABLE_COLUMNS + 1)}</w:tblGrid>${rowCells(1)}</w:tbl>`
    );
    const overResult = readEditableTableTopology(over.root, tableId(over), {
      maxRows: 10_000,
      maxColumns: Number.MAX_SAFE_INTEGER,
      maxTraversalNodes: 1_000_000,
    });
    expect(overResult.ok).toBe(false);
  });

  test('resolveTableTopologyLimits rejects fractional and nonpositive maxColumns', () => {
    expect(resolveTableTopologyLimits({ maxColumns: 512.9 }).maxColumns).toBe(512);
    expect(resolveTableTopologyLimits({ maxColumns: 0 }).maxColumns).toBe(MAX_TABLE_COLUMNS);
    expect(resolveTableTopologyLimits({ maxColumns: -5 }).maxColumns).toBe(MAX_TABLE_COLUMNS);
    expect(resolveTableTopologyLimits({ maxColumns: Infinity }).maxColumns).toBe(MAX_TABLE_COLUMNS);
  });

  test('accepts tables within limits', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`
    );
    const result = readEditableTableTopology(part.root, tableId(part), {
      maxRows: 100,
      maxColumns: 100,
      maxTraversalNodes: 1_000_000,
    });
    expect(result.ok).toBe(true);
  });

  test('rejects before iterating trap children when pending capacity is exhausted', () => {
    const trapChildren = [generic('safe', [], 'safe-leaf')] as OoxmlElement[];
    Object.defineProperty(trapChildren, 'length', { value: 2, writable: true });
    Object.defineProperty(trapChildren, '1', {
      get(): OoxmlElement {
        throw new Error('trap-child-accessed');
      },
      enumerable: true,
      configurable: true,
    });
    const trapParent = {
      id: 'trap-parent',
      kind: 'generic' as const,
      namespaceUri: W,
      localName: 'trap',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: trapChildren,
    } as OoxmlElement;
    const root = {
      id: 'pending-root',
      kind: 'document' as const,
      namespaceUri: W,
      localName: 'document',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [
        trapParent,
        generic('filler-a', [], 'filler-a'),
        generic('filler-b', [], 'filler-b'),
      ],
    } as OoxmlElement;

    const run = () =>
      readEditableTableTopology(root, 'missing-table', {
        maxRows: 10_000,
        maxColumns: MAX_TABLE_COLUMNS,
        maxTraversalNodes: 5,
      });

    expect(run).not.toThrow();
    const result = run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('resource-limit');
    expect(result.detail).toBe('traversal');
  });

  test('rejects wide hostile generic roots before stack growth', () => {
    const tableXml = `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`;
    const part = load(tableXml);
    const id = tableId(part);
    const noise = Array.from({ length: 50_000 }, (_, index) =>
      generic('noise', [], `noise-${index}`)
    );
    const root = {
      id: 'wide-root',
      kind: 'document' as const,
      namespaceUri: W,
      localName: 'document',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [part.root, ...noise],
    } as OoxmlElement;
    const result = readEditableTableTopology(root, id, {
      maxRows: 10_000,
      maxColumns: MAX_TABLE_COLUMNS,
      maxTraversalNodes: 20,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('resource-limit');
    expect(result.detail).toBe('traversal');
  });

  test('rejects traversal budget exhaustion on deep generic trees', () => {
    const tableXml = `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`;
    const part = load(tableXml);
    const id = tableId(part);
    let node: OoxmlElement = part.root;
    for (let depth = 0; depth < 200; depth += 1) {
      const wrapper = generic('wrap', [node], `wrap-${depth}`);
      node = {
        id: `root-wrap-${depth}`,
        kind: 'document',
        namespaceUri: W,
        localName: 'document',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: [wrapper],
      } as OoxmlElement;
    }
    const result = readEditableTableTopology(node, id, {
      maxRows: 10_000,
      maxColumns: MAX_TABLE_COLUMNS,
      maxTraversalNodes: 20,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('resource-limit');
    expect(result.detail).toBe('traversal');
  });
});
