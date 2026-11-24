// Selected-cell border and fill TreeDocOps (table-editing task 6).

import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
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
import { validateTableCellPropertyOp } from '../store/tree-op-tables.ts';
import { withRepeated } from './repeated-node-support.ts';
import {
  resetTestPhysicalGridSlotScanCount,
  resetTestVisualOwnerCounters,
  testPhysicalGridSlotScanCount,
  testVisualMemberCheckCount,
  testVisualOwnerGroupValidationCount,
} from '../store/tree-op-table-cell-properties.ts';
import { wmlAttributeValue, wmlChildNamed } from '../store/tree-op-table-shared.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { MAX_TABLE_CELL_SELECTION_COUNT, MAX_TABLE_COLUMNS } from '../store/table-constraints.ts';
import { TABLE_BORDER_STYLES } from '../table-border-style.ts';
import {
  MIN_TABLE_BORDER_SIZE_EIGHTHS,
  MAX_TABLE_BORDER_SIZE_EIGHTHS,
} from '../store/table-constraints.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { readTableStructure } from '../../layout/semantic-table.ts';
import { buildStyleCascadeTable } from '../../layout/style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

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

function tableById(part: OoxmlPart, tableId: string): OoxmlElement {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) throw new Error(`table missing: ${tableId}`);
  return table;
}

function cellAt(part: OoxmlPart, rowIndex: number, colIndex: number): OoxmlElement {
  const rows = collectByKind(part.root, 'tableRow');
  const row = rows[rowIndex];
  if (!row) throw new Error('row missing');
  const cells = row.children.filter((c) => c.kind === 'tableCell');
  const cell = cells[colIndex];
  if (!cell || cell.kind === 'textValue') throw new Error('cell missing');
  return cell;
}

function cellIds(part: OoxmlPart, coords: readonly (readonly [number, number])[]): string[] {
  return coords.map(([row, col]) => cellAt(part, row, col).id);
}

function borderSideVal(
  part: OoxmlPart,
  cellId: string,
  side: 'top' | 'left' | 'bottom' | 'right'
): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcBorders = tcPr && wmlChildNamed(tcPr, 'tcBorders');
  const sideEl = tcBorders && wmlChildNamed(tcBorders, side);
  return sideEl?.attributes.find((a) => a.localName === 'val')?.value;
}

function borderSideSz(
  part: OoxmlPart,
  cellId: string,
  side: 'top' | 'left' | 'bottom' | 'right'
): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcBorders = tcPr && wmlChildNamed(tcPr, 'tcBorders');
  const sideEl = tcBorders && wmlChildNamed(tcBorders, side);
  return sideEl?.attributes.find((a) => a.localName === 'sz')?.value;
}

function borderSideColor(
  part: OoxmlPart,
  cellId: string,
  side: 'top' | 'left' | 'bottom' | 'right'
): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcBorders = tcPr && wmlChildNamed(tcPr, 'tcBorders');
  const sideEl = tcBorders && wmlChildNamed(tcBorders, side);
  return sideEl?.attributes.find((a) => a.localName === 'color')?.value;
}

function shdFill(part: OoxmlPart, cellId: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const shd = tcPr && wmlChildNamed(tcPr, 'shd');
  return shd?.attributes.find((a) => a.localName === 'fill')?.value;
}

const CELL = (text: string, tcPr = ''): string =>
  `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const TABLE = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${rows.join('')}</w:tbl>`;

const SPEC = {
  style: 'single' as const,
  size: 8,
  color: { kind: 'hex' as const, value: '336699' },
};

const MARKED_STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="Marked"><w:name w:val="Marked"/>' +
  '<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="band2Horz"><w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr></w:tblStylePr>' +
  '</w:style></w:styles>';

function styleCascade() {
  const styles = readOoxmlPart(MARKED_STYLES, {
    name: '/word/styles.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  });
  if (!styles.ok) throw new Error(styles.reason);
  return buildStyleCascadeTable(styles.part.root);
}

function structureOf(part: OoxmlPart, tableId: string) {
  return readTableStructure(tableById(part, tableId), 468, 0, styleCascade())!;
}

function paintedTableCell(part: OoxmlPart, cellId: string, cascade = styleCascade()): HTMLElement {
  const layout = layoutSemanticDocument(part, 468, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: cascade,
  });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const cell = container.querySelector(`[data-cell-id="${cellId}"]`) as HTMLElement | null;
  if (!cell) throw new Error(`painted cell missing: ${cellId}`);
  return cell;
}

describe('setTableCellBorders', () => {
  test('applies all borders to one cell with symmetric sides on a 2x2 selection', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'all',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(borderSideVal(result.part, ids[0]!, 'top')).toBe('single');
    expect(borderSideVal(result.part, ids[0]!, 'right')).toBe('single');
    expect(borderSideVal(result.part, ids[1]!, 'left')).toBe('single');
    expect(borderSideVal(result.part, ids[2]!, 'top')).toBe('single');
    expect(borderSideVal(result.part, ids[0]!, 'bottom')).toBe('single');
    expect(borderSideVal(result.part, ids[2]!, 'bottom')).toBe('single');
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('outside scope targets only the selection hull', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'outside',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(borderSideVal(result.part, ids[0]!, 'top')).toBe('single');
    expect(borderSideVal(result.part, ids[1]!, 'top')).toBe('single');
    expect(borderSideVal(result.part, ids[2]!, 'bottom')).toBe('single');
    expect(borderSideVal(result.part, ids[3]!, 'right')).toBe('single');
    const innerTop = borderSideVal(result.part, ids[2]!, 'top');
    expect(innerTop).toBeUndefined();
  });

  test('inside scope authors symmetric facing edges on the cross', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'inside',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(borderSideVal(result.part, ids[0]!, 'bottom')).toBe('single');
    expect(borderSideVal(result.part, ids[2]!, 'top')).toBe('single');
    expect(borderSideVal(result.part, ids[0]!, 'right')).toBe('single');
    expect(borderSideVal(result.part, ids[1]!, 'left')).toBe('single');
    expect(borderSideVal(result.part, ids[0]!, 'top')).toBeUndefined();
  });

  test('top left right bottom scopes target one edge family each', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    for (const scope of ['top', 'left', 'right', 'bottom'] as const) {
      const scoped = applyTreeOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: ids,
        scope,
        spec: { ...SPEC, color: { kind: 'hex', value: 'AABBCC' } },
      });
      expect(scoped.ok).toBe(true);
      if (!scoped.ok) continue;
      if (scope === 'top') {
        expect(borderSideVal(scoped.part, ids[0]!, 'top')).toBe('single');
        expect(borderSideVal(scoped.part, ids[2]!, 'top')).toBeUndefined();
      }
      if (scope === 'bottom') {
        expect(borderSideVal(scoped.part, ids[2]!, 'bottom')).toBe('single');
        expect(borderSideVal(scoped.part, ids[0]!, 'bottom')).toBeUndefined();
      }
      if (scope === 'left') {
        expect(borderSideVal(scoped.part, ids[0]!, 'left')).toBe('single');
        expect(borderSideVal(scoped.part, ids[1]!, 'left')).toBeUndefined();
      }
      if (scope === 'right') {
        expect(borderSideVal(scoped.part, ids[1]!, 'right')).toBe('single');
        expect(borderSideVal(scoped.part, ids[0]!, 'right')).toBeUndefined();
      }
    }
  });

  test('none clears only the active target edge', () => {
    const part = load(
      TABLE(
        ROW(
          CELL(
            'a1',
            `<w:tcW w:w="2400" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="8" w:color="FF0000"/><w:left w:val="single" w:sz="8" w:color="FF0000"/></w:tcBorders>`
          ),
          CELL('a2')
        ),
        ROW(CELL('b1'), CELL('b2'))
      )
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'none',
      target: 'top',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(borderSideVal(result.part, id, 'top')).toBe('none');
    expect(borderSideVal(result.part, id, 'left')).toBe('single');
  });

  test('refuses non-rectangular partial merge selections', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:gridSpan w:val="2"/>`)}</w:tr>` +
        `${ROW(CELL('b1'), CELL('b2'))}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const onlyBottomLeft = cellAt(part, 1, 0).id;
    const onlyTopSpan = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [onlyBottomLeft, onlyTopSpan],
        scope: 'all',
        spec: SPEC,
      })
    ).toBe('invalidArgs');
  });

  test('allows formatting a fully selected merged anchor cell', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="continue"/>`)}${CELL('b2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'outside',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
  });

  test('refuses foreign nested cell ids and duplicate ids', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="4800"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc>` +
        `<w:tbl><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>` +
        `${ROW(CELL('n1'), CELL('n2'))}</w:tbl></w:tc>` +
        `${CELL('outer')}</w:tr></w:tbl>`
    );
    const outer = collectByKind(part.root, 'table')[0]!;
    const innerTable = collectByKind(part.root, 'table')[1]!;
    const innerCell = collectByKind(innerTable, 'tableCell')[0]!;
    expect(innerCell).toBeDefined();
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: outer.id,
        cellIds: [innerCell!.id],
        scope: 'all',
        spec: SPEC,
      })
    ).toBe('invalidArgs');
    const outerCell = cellAt(part, 0, 1);
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: outer.id,
        cellIds: [outerCell.id, outerCell.id],
        scope: 'all',
        spec: SPEC,
      })
    ).toBe('invalidArgs');
  });

  test('refuses invalid specs colors and runtime shapes', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'all',
        spec: { style: 'groove' as 'single', size: 8, color: { kind: 'hex', value: '336699' } },
      })
    ).toBe('invalid-property-value');
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'all',
        spec: { style: 'single', size: 0, color: { kind: 'hex', value: '336699' } },
      })
    ).toBe('invalid-property-value');
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'all',
        spec: { style: 'single', size: 8, color: { kind: 'hex', value: 'css(red)' } },
      })
    ).toBe('invalid-property-value');
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'inside',
      } as never)
    ).toBe('invalidArgs');
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'none',
        target: 'top',
        spec: SPEC,
      } as never)
    ).toBe('invalidArgs');
  });

  test('preserves unknown tcPr children and foreign shd', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:tcW w:w="2400" w:type="dxa"/><x:ext/><w:shd w:fill="FF0000"/>`)}${CELL('a2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const foreignBefore = wmlChildNamed(wmlChildNamed(cellAt(part, 0, 0), 'tcPr')!, 'shd');
    const extBefore = cellAt(part, 0, 0)
      .children.find((c) => c.kind !== 'textValue' && c.localName === 'tcPr')
      ?.children.find((c) => c.kind !== 'textValue' && c.prefix !== 'w');
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'all',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterCell = cellAt(result.part, 0, 0);
    const tcPr = wmlChildNamed(afterCell, 'tcPr')!;
    expect(tcPr.children.some((c) => c === extBefore)).toBe(true);
    expect(wmlChildNamed(tcPr, 'shd')).toBe(foreignBefore);
  });
});

describe('setTableCellFill', () => {
  test('writes hex fill and clears direct fill with null', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const filled = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: { kind: 'hex', value: 'FFEECC' },
    });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(shdFill(filled.part, id)).toBe('FFEECC');
    const cleared = applyTreeOp(filled.part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    // A `w:shd` left with no fill would still paint no colour over a table style, so the
    // whole element goes.
    const shd = wmlChildNamed(wmlChildNamed(cellAt(cleared.part, 0, 0), 'tcPr')!, 'shd');
    expect(shd ?? null).toBeNull();
    expect(shdFill(cleared.part, id)).toBeUndefined();
  });

  test('clearing removes a leftover w:shd that states no fill', () => {
    const part = load(TABLE(ROW(CELL('a1', '<w:shd w:val="clear" w:color="auto"/>'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const cleared = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const shd = wmlChildNamed(wmlChildNamed(cellAt(cleared.part, 0, 0), 'tcPr')!, 'shd');
    expect(shd ?? null).toBeNull();
  });

  test('clearing the fill of a pattern keeps the pattern over white', () => {
    const part = load(
      TABLE(
        ROW(
          '<w:tc><w:tcPr><w:shd w:val="pct50" w:color="FF0000" w:fill="FFFF00"/></w:tcPr>' +
            '<w:p><w:r><w:t>a1</w:t></w:r></w:p></w:tc>'
        )
      )
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const cleared = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const shd = wmlChildNamed(wmlChildNamed(cellAt(cleared.part, 0, 0), 'tcPr')!, 'shd')!;
    expect(shd.attributes.find((a) => a.localName === 'val')?.value).toBe('pct50');
    expect(shdFill(cleared.part, id)).toBeUndefined();
    expect(structureOf(cleared.part, table.id).rows[0]!.cells[0]!.shading).toBe('FF7F7F');
  });

  test('writes theme fill metadata with literal fill for layout', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const result = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: { kind: 'theme', slot: 'accent1', resolvedHex: '445566', tint: 0.4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shd = wmlChildNamed(wmlChildNamed(cellAt(result.part, 0, 0), 'tcPr')!, 'shd')!;
    expect(shd.attributes.find((a) => a.localName === 'themeFill')?.value).toBe('accent1');
    expect(shd.attributes.find((a) => a.localName === 'themeFillTint')?.value).toBe('66');
    expect(shdFill(result.part, id)).toBe('445566');
  });
});

describe('setTableCellVerticalAlignment', () => {
  test('writes direct vAlign to every selected cell', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
    ]);
    const result = applyTreeOp(part, {
      op: 'setTableCellVerticalAlignment',
      tableId: table.id,
      cellIds: ids,
      alignment: 'center',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let column = 0; column < 2; column += 1) {
      const tcPr = wmlChildNamed(cellAt(result.part, 0, column), 'tcPr')!;
      expect(wmlAttributeValue(wmlChildNamed(tcPr, 'vAlign')!, 'val')).toBe('center');
    }
  });
});

describe('table cell property history and D9', () => {
  test('one undo step restores border edit', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const before = store.part;
    const table = collectByKind(store.part.root, 'table')[0]!;
    const id = cellAt(store.part, 0, 0).id;
    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'all',
        spec: SPEC,
      });
    });
    expect(result.ok).toBe(true);
    store.undo();
    expect(store.part).toBe(before);
  });

  test('border fill and clear survive save reopen D9', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    let current = part;
    const border = applyTreeOp(current, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'outside',
      spec: SPEC,
    });
    expect(border.ok).toBe(true);
    if (!border.ok) return;
    current = border.part;
    const fill = applyTreeOp(current, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [ids[0]!],
      color: { kind: 'hex', value: 'DDEEFF' },
    });
    expect(fill.ok).toBe(true);
    if (!fill.ok) return;
    current = fill.part;
    const cleared = applyTreeOp(current, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [ids[0]!],
      color: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    current = cleared.part;
    expect(shdFill(current, ids[0]!)).toBeUndefined();
    const serialized = serializeOoxmlPart(current);
    const reopened = readOoxmlPart(serialized, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(canonicalOoxmlFingerprint(reopened.part)).toEqual(canonicalOoxmlFingerprint(current));
    expect(diffSemanticDigests(semanticDigest([current]), semanticDigest([reopened.part]))).toEqual(
      []
    );
  });
});

describe('table cell property resource limits', () => {
  test('rejects hostile cell id list sizes before allocation', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const hostile = Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_, index) => `missing-${index}`);
    expect(
      validateTableCellPropertyOp(
        part,
        {
          op: 'setTableCellBorders',
          tableId: table.id,
          cellIds: hostile,
          scope: 'all',
          spec: SPEC,
        },
        { maxRows: 1, maxColumns: 2, maxTraversalNodes: 1_000_000 }
      )
    ).toBe('resource-limit');
  });
});

describe('table cell property layout readback', () => {
  test('store border edit resolves through layout conflict reader', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const edited = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'inside',
      spec: { style: 'dashed', size: 16, color: { kind: 'hex', value: '112233' } },
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const tableNode = tableById(edited.part, table.id);
    const structure = readTableStructure(tableNode, 468, 0);
    expect(structure).toBeDefined();
    const borders = structure!.rows[0]!.cells[0]!.borders;
    expect(borders.bottom.state).toBe('edge');
    if (borders.bottom.state === 'edge') {
      expect(borders.bottom.style).toBe('dashed');
      expect(borders.bottom.color).toBe('112233');
    }
  });
});

describe('table cell property namespace context', () => {
  test('declares safe WML binding under hostile prefix shadow', () => {
    const hostile = 'urn:attacker/wml-shadow';
    const opened = readOoxmlPart(
      `<wx:document xmlns:wx="${W}"><wx:body>` +
        `<wx:tbl xmlns:w="${hostile}"><wx:tblGrid><wx:gridCol wx:w="2400"/><wx:gridCol wx:w="2400"/></wx:tblGrid>` +
        `<wx:tr><wx:tc><wx:tcPr><wx:tcW wx:w="2400" wx:type="dxa"/></wx:tcPr><wx:p/></wx:tc>` +
        `<wx:tc><wx:tcPr><wx:tcW wx:w="2400" wx:type="dxa"/></wx:tcPr><wx:p/></wx:tc></wx:tr></wx:tbl>` +
        `</wx:body></wx:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'all',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tcBorders = wmlChildNamed(
      wmlChildNamed(cellAt(result.part, 0, 0), 'tcPr')!,
      'tcBorders'
    )!;
    expect(tcBorders.prefix).toBe('wx');
    expect(tcBorders.children.every((c) => c.kind === 'textValue' || c.prefix === 'wx')).toBe(true);
  });

  test('idempotent border proposal succeeds without history under hostile prefix', () => {
    const hostile = 'urn:attacker/wml-shadow';
    const opened = readOoxmlPart(
      `<wx:document xmlns:wx="${W}"><wx:body>` +
        `<wx:tbl xmlns:w="${hostile}"><wx:tblGrid><wx:gridCol wx:w="2400"/><wx:gridCol wx:w="2400"/></wx:tblGrid>` +
        `<wx:tr><wx:tc><wx:tcPr><wx:tcW wx:w="2400" wx:type="dxa"/></wx:tcPr><wx:p/></wx:tc>` +
        `<wx:tc><wx:p/></wx:tc></wx:tr></wx:tbl></wx:body></wx:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const first = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'all',
      spec: SPEC,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const repeat = applyTreeOp(first.part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'all',
      spec: SPEC,
    });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.part).toBe(first.part);
    expect(repeat.effect.dirty).toEqual([]);
  });
});

describe('table cell property ownership and lossless patching', () => {
  test('inside scope suppresses gridSpan internal vertical seam', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('span', `<w:gridSpan w:val="2"/>`)}</w:tr>` +
        `${ROW(CELL('b1'), CELL('b2'))}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    const spanId = cellAt(part, 0, 0).id;
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'inside',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(borderSideVal(result.part, spanId, 'right')).toBeUndefined();
    expect(borderSideVal(result.part, spanId, 'left')).toBeUndefined();
  });

  test('outside bottom on vMerge lands on restart owner for layout readback', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="continue"/>`)}${CELL('b2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const restartId = cellAt(part, 0, 0).id;
    const continueId = cellAt(part, 1, 0).id;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'outside',
      spec: { style: 'double', size: 12, color: { kind: 'hex', value: 'AABBCC' } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(borderSideVal(result.part, restartId, 'bottom')).toBe('double');
    expect(borderSideVal(result.part, continueId, 'bottom')).toBeUndefined();
    const structure = readTableStructure(tableById(result.part, table.id), 468, 0);
    const bottom = structure!.rows[0]!.cells[0]!.borders.bottom;
    expect(bottom.state).toBe('edge');
    if (bottom.state === 'edge') {
      expect(bottom.style).toBe('double');
      expect(bottom.color).toBe('AABBCC');
    }
  });

  test('border patch preserves insideH and side node ids', () => {
    const part = load(
      TABLE(
        ROW(
          CELL(
            'a1',
            `<w:tcBorders><w:insideH w:val="single" w:sz="4" w:color="111111"/><w:top w:val="single" w:sz="4" w:color="222222" w:space="0"/></w:tcBorders>`
          ),
          CELL('a2')
        )
      )
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const beforeTcBorders = wmlChildNamed(wmlChildNamed(cellAt(part, 0, 0), 'tcPr')!, 'tcBorders')!;
    const insideHBefore = wmlChildNamed(beforeTcBorders, 'insideH')!;
    const topBefore = wmlChildNamed(beforeTcBorders, 'top')!;
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'top',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterTcBorders = wmlChildNamed(
      wmlChildNamed(cellAt(result.part, 0, 0), 'tcPr')!,
      'tcBorders'
    )!;
    expect(wmlChildNamed(afterTcBorders, 'insideH')).toBe(insideHBefore);
    expect(wmlChildNamed(afterTcBorders, 'top')?.id).toBe(topBefore.id);
    expect(topBefore.attributes.find((a) => a.localName === 'space')?.value).toBe('0');
  });

  test('fill clear strips only fill attrs and preserves shd payload', () => {
    const part = load(
      TABLE(ROW(CELL('a1', `<w:shd w:val="pct10" w:fill="FF0000" w:color="222222"/>`), CELL('a2')))
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const shdBefore = wmlChildNamed(wmlChildNamed(cellAt(part, 0, 0), 'tcPr')!, 'shd')!;
    const result = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shdAfter = wmlChildNamed(wmlChildNamed(cellAt(result.part, 0, 0), 'tcPr')!, 'shd')!;
    expect(shdAfter.id).toBe(shdBefore.id);
    expect(shdAfter.attributes.find((a) => a.localName === 'val')?.value).toBe('pct10');
    expect(shdAfter.attributes.find((a) => a.localName === 'color')?.value).toBe('222222');
    expect(shdFill(result.part, id)).toBeUndefined();
  });

  test('reads repeated tcBorders as the edit that heals them leaves them', () => {
    // A file with two opens with one; a tree a merge left with two is judged healed.
    const part = withRepeated(
      load(TABLE(ROW(CELL('a1', `<w:tcBorders/>`), CELL('a2')))),
      'tcBorders'
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellFill',
        tableId: table.id,
        cellIds: [id],
        color: { kind: 'hex', value: 'AABBCC' },
      })
    ).toBeNull();
  });

  test('rejects restart selected without full vertical merge chain', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="continue"/>`)}${CELL('b2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const partial = [cellAt(part, 0, 0).id, cellAt(part, 0, 1).id, cellAt(part, 1, 1).id];
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: partial,
        scope: 'all',
        spec: SPEC,
      })
    ).toBe('invalidArgs');
  });
});

describe('table cell property styles colors and bounds', () => {
  test('accepts all six allowlisted border styles', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    for (const style of TABLE_BORDER_STYLES) {
      const result = applyTreeOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'top',
        spec: { style, size: 8, color: { kind: 'hex', value: '112233' } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(borderSideVal(result.part, id, 'top')).toBe(style);
    }
  });

  test('enforces border size bounds', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'top',
        spec: {
          style: 'single',
          size: MIN_TABLE_BORDER_SIZE_EIGHTHS - 1,
          color: { kind: 'hex', value: '112233' },
        },
      })
    ).toBe('invalid-property-value');
    const maxOk = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'top',
      spec: {
        style: 'single',
        size: MAX_TABLE_BORDER_SIZE_EIGHTHS,
        color: { kind: 'hex', value: '112233' },
      },
    });
    expect(maxOk.ok).toBe(true);
  });

  test('theme and auto border colors preserve OOXML auto semantics', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const autoResult = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'top',
      spec: { style: 'single', size: 8, color: { kind: 'auto', resolvedHex: '010203' } },
    });
    expect(autoResult.ok).toBe(true);
    if (!autoResult.ok) return;
    expect(borderSideColor(autoResult.part, id, 'top')).toBe('auto');
    const themeColor = { kind: 'theme' as const, slot: 'accent2', resolvedHex: '040506' };
    const themeResult = applyTreeOp(autoResult.part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'top',
      spec: { style: 'single', size: 8, color: themeColor },
    });
    expect(themeResult.ok).toBe(true);
    if (!themeResult.ok) return;
    expect(borderSideColor(themeResult.part, id, 'top')).toBe(themeColor.resolvedHex.toUpperCase());
    const structure = readTableStructure(tableById(themeResult.part, table.id), 468, 0);
    const top = structure!.rows[0]!.cells[0]!.borders.top;
    if (top.state === 'edge') expect(top.color).toBe(themeColor.resolvedHex.toUpperCase());
  });

  test('valid idempotent fill returns success with empty dirty', () => {
    const part = load(TABLE(ROW(CELL('a1', `<w:shd w:fill="AABBCC"/>`), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const result = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: { kind: 'hex', value: 'AABBCC' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.part).toBe(part);
    expect(result.effect.dirty).toEqual([]);
  });
});

describe('table cell property resource limits default cap', () => {
  test('rejects selection at default 65536 cap without large allocation', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const hostile = Array.from(
      { length: MAX_TABLE_CELL_SELECTION_COUNT + 1 },
      (_, index) => `ghost-${index}`
    );
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: hostile,
        scope: 'all',
        spec: SPEC,
      })
    ).toBe('resource-limit');
  });
});

describe('table cell property fix round 2', () => {
  test('accepts vertical merge terminated by an ordinary cell before table bottom', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="continue"/>`)}${CELL('b2')}</w:tr>` +
        `${ROW(CELL('c1'), CELL('c2'))}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: ids,
        scope: 'outside',
        spec: SPEC,
      })
    ).toBeNull();
  });

  test('rejects hostile physical hull work before ownership allocation', () => {
    const part = load(
      TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2')), ROW(CELL('c1'), CELL('c2')))
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
    ]);
    expect(
      validateTableCellPropertyOp(
        part,
        {
          op: 'setTableCellBorders',
          tableId: table.id,
          cellIds: ids,
          scope: 'all',
          spec: SPEC,
        },
        { maxRows: 10_000, maxColumns: 1024, maxTraversalNodes: 10 }
      )
    ).toBe('resource-limit');
  });

  test('sets fill on existing w:shd val=nil through layout and paint', () => {
    const part = load(TABLE(ROW(CELL('a1', `<w:shd w:val="nil" w:color="222222"/>`), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const filled = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: { kind: 'hex', value: 'AABBCC' },
    });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(shdFill(filled.part, id)).toBe('AABBCC');
    expect(
      wmlChildNamed(wmlChildNamed(cellAt(filled.part, 0, 0), 'tcPr')!, 'shd')!.attributes.find(
        (a) => a.localName === 'val'
      )?.value
    ).toBe('clear');
    expect(structureOf(filled.part, table.id).rows[0]!.cells[0]!.shading).toBe('AABBCC');
    expect(paintedTableCell(filled.part, id).style.backgroundColor.toLowerCase()).toBe('#aabbcc');
  });

  test('theme and auto fill resolve through layout and paint', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    for (const color of [
      { kind: 'theme' as const, slot: 'accent1', resolvedHex: '445566' },
      { kind: 'auto' as const, resolvedHex: '778899' },
    ]) {
      const result = applyTreeOp(part, {
        op: 'setTableCellFill',
        tableId: table.id,
        cellIds: [id],
        color,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(structureOf(result.part, table.id).rows[0]!.cells[0]!.shading).toBe(
        color.resolvedHex.toUpperCase()
      );
      expect(paintedTableCell(result.part, id).style.backgroundColor.toLowerCase()).toBe(
        `#${color.resolvedHex}`
      );
    }
  });

  test('clearing direct fill exposes table-style band shading again', () => {
    const part = load(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>` +
        `<w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}${ROW(CELL('b1'), CELL('b2'))}${ROW(CELL('c1'), CELL('c2'))}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 1, 0).id;
    const filled = applyTreeOp(part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: { kind: 'hex', value: 'FF00FF' },
    });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(structureOf(filled.part, table.id).rows[1]!.cells[0]!.shading).toBe('FF00FF');
    const cleared = applyTreeOp(filled.part, {
      op: 'setTableCellFill',
      tableId: table.id,
      cellIds: [id],
      color: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(structureOf(cleared.part, table.id).rows[1]!.cells[0]!.shading).toBe('EEEEEE');
    expect(paintedTableCell(cleared.part, id).style.backgroundColor.toLowerCase()).toBe('#eeeeee');
  });

  test('nested border and fill edits stay isolated from the outer table', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="4800"/></w:tblGrid>` +
        `<w:tr><w:tc>` +
        `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `${ROW(CELL('n1'), CELL('n2'))}</w:tbl>` +
        `</w:tc></w:tr></w:tbl>`
    );
    const inner = collectByKind(part.root, 'table')[1]!;
    const outerWrap = cellAt(part, 0, 0);
    const innerId = cellAt(part, 1, 0).id;
    const border = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: inner.id,
      cellIds: [innerId],
      scope: 'all',
      spec: SPEC,
    });
    expect(border.ok).toBe(true);
    if (!border.ok) return;
    expect(borderSideVal(border.part, innerId, 'top')).toBe('single');
    expect(borderSideVal(border.part, outerWrap.id, 'top')).toBeUndefined();
    const fill = applyTreeOp(border.part, {
      op: 'setTableCellFill',
      tableId: inner.id,
      cellIds: [innerId],
      color: { kind: 'hex', value: 'CCDDEE' },
    });
    expect(fill.ok).toBe(true);
    if (!fill.ok) return;
    expect(shdFill(fill.part, innerId)).toBe('CCDDEE');
    expect(shdFill(fill.part, outerWrap.id)).toBeUndefined();
  });

  test('reads a repeated shd as healed, and rejects duplicate side leaves', () => {
    const duplicateShd = withRepeated(
      load(TABLE(ROW(CELL('a1', `<w:shd w:fill="111111"/>`), CELL('a2')))),
      'shd'
    );
    const duplicateSide = load(
      TABLE(
        ROW(
          CELL(
            'a1',
            `<w:tcBorders><w:top w:val="single" w:sz="8" w:color="111111"/><w:top w:val="single" w:sz="8" w:color="222222"/></w:tcBorders>`
          ),
          CELL('a2')
        )
      )
    );
    const shdTable = collectByKind(duplicateShd.root, 'table')[0]!;
    const sideTable = collectByKind(duplicateSide.root, 'table')[0]!;
    const shdId = cellAt(duplicateShd, 0, 0).id;
    const sideId = cellAt(duplicateSide, 0, 0).id;
    expect(
      validateTableCellPropertyOp(duplicateShd, {
        op: 'setTableCellFill',
        tableId: shdTable.id,
        cellIds: [shdId],
        color: { kind: 'hex', value: 'AABBCC' },
      })
    ).toBeNull();
    expect(
      validateTableCellPropertyOp(duplicateSide, {
        op: 'setTableCellBorders',
        tableId: sideTable.id,
        cellIds: [sideId],
        scope: 'top',
        spec: SPEC,
      })
    ).toBe('duplicate-property-container');
  });

  test('rejects extra own keys on color spec and fill op', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellFill',
        tableId: table.id,
        cellIds: [id],
        color: { kind: 'hex', value: 'AABBCC', extra: true },
      } as never)
    ).toBe('invalid-property-value');
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'top',
        spec: {
          style: 'single',
          size: 8,
          color: { kind: 'hex', value: 'AABBCC', inherited: true },
        },
      } as never)
    ).toBe('invalid-property-value');
  });

  test('fill edit publishes target-local dirty ids and survives undo redo', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = collectByKind(store.part.root, 'table')[0]!;
    const id = cellAt(store.part, 0, 0).id;
    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableCellFill',
        tableId: table.id,
        cellIds: [id],
        color: { kind: 'hex', value: 'FFEEDD' },
      });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.change?.dirty.sort()).toEqual([id]);
    expect(shdFill(store.part, id)).toBe('FFEEDD');
    store.undo();
    expect(store.part).toBe(part);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(shdFill(store.part, id)).toBe('FFEEDD');
  });

  test('border scope publishes only touched cell dirty ids', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const result = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: ids,
      scope: 'top',
      spec: SPEC,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.effect.dirty)).toEqual(new Set([ids[0]!, ids[1]!]));
  });

  test('accepts minimum border size and rejects below-min/out-of-bound sizes', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    const minOk = applyTreeOp(part, {
      op: 'setTableCellBorders',
      tableId: table.id,
      cellIds: [id],
      scope: 'top',
      spec: {
        style: 'single',
        size: MIN_TABLE_BORDER_SIZE_EIGHTHS,
        color: { kind: 'hex', value: '112233' },
      },
    });
    expect(minOk.ok).toBe(true);
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'top',
        spec: {
          style: 'single',
          size: MIN_TABLE_BORDER_SIZE_EIGHTHS - 1,
          color: { kind: 'hex', value: '112233' },
        },
      })
    ).toBe('invalid-property-value');
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'top',
        spec: {
          style: 'single',
          size: MAX_TABLE_BORDER_SIZE_EIGHTHS + 1,
          color: { kind: 'hex', value: '112233' },
        },
      })
    ).toBe('invalid-property-value');
  });
});

describe('table cell property transaction no-ops', () => {
  test('transact border no-op leaves revision history and part untouched', () => {
    const part = load(
      TABLE(
        ROW(
          CELL(
            'a1',
            `<w:tcBorders><w:top w:val="single" w:sz="8" w:color="336699"/></w:tcBorders>`
          ),
          CELL('a2')
        )
      )
    );
    const store = new TreeDocumentStore(part);
    const table = collectByKind(store.part.root, 'table')[0]!;
    const id = cellAt(store.part, 0, 0).id;
    const changes: unknown[] = [];
    store.subscribe((change) => changes.push(change));
    const beforeRev = store.revision;
    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: [id],
        scope: 'top',
        spec: SPEC,
      });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.change).toBeNull();
    expect(store.part).toBe(part);
    expect(store.revision).toBe(beforeRev);
    expect(store.canUndo).toBe(false);
    expect(changes).toHaveLength(0);
  });

  test('transact fill no-op under hostile namespace creates no publication', () => {
    const hostile = 'urn:attacker/wml-shadow';
    const opened = readOoxmlPart(
      `<wx:document xmlns:wx="${W}"><wx:body>` +
        `<wx:tbl xmlns:w="${hostile}"><wx:tblGrid><wx:gridCol wx:w="2400"/><wx:gridCol wx:w="2400"/></wx:tblGrid>` +
        `<wx:tr><wx:tc><wx:tcPr><wx:shd wx:fill="AABBCC"/></wx:tcPr><wx:p/></wx:tc>` +
        `<wx:tc><wx:p/></wx:tc></wx:tr></wx:tbl></wx:body></wx:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const store = new TreeDocumentStore(opened.part);
    const table = collectByKind(store.part.root, 'table')[0]!;
    const id = cellAt(store.part, 0, 0).id;
    const changes: unknown[] = [];
    store.subscribe((change) => changes.push(change));
    const beforeRev = store.revision;
    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableCellFill',
        tableId: table.id,
        cellIds: [id],
        color: { kind: 'hex', value: 'AABBCC' },
      });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.change).toBeNull();
    expect(store.part).toBe(opened.part);
    expect(store.revision).toBe(beforeRev);
    expect(store.canUndo).toBe(false);
    expect(changes).toHaveLength(0);
  });
});

describe('table cell property fix round 3', () => {
  test('accepts back-to-back restart merge groups on the same interval', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="continue"/>`)}${CELL('b2')}</w:tr>` +
        `<w:tr>${CELL('c1', `<w:vMerge w:val="restart"/>`)}${CELL('c2')}</w:tr>` +
        `<w:tr>${CELL('d1', `<w:vMerge w:val="continue"/>`)}${CELL('d2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: ids,
        scope: 'outside',
        spec: SPEC,
      })
    ).toBeNull();
  });

  test('accepts a one-row restart followed by another restart', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="restart"/>`)}${CELL('b2')}</w:tr>` +
        `${ROW(CELL('c1'), CELL('c2'))}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: ids,
        scope: 'all',
        spec: SPEC,
      })
    ).toBeNull();
  });

  test('rejects orphan continuation without a restart', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="continue"/>`)}${CELL('a2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellFill',
        tableId: table.id,
        cellIds: [id],
        color: { kind: 'hex', value: 'AABBCC' },
      })
    ).toBe('tree-invariant');
  });

  test('rejects continuation after a gap in the merge chain', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `${ROW(CELL('b1'), CELL('b2'))}` +
        `<w:tr>${CELL('c1', `<w:vMerge w:val="continue"/>`)}${CELL('c2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [2, 0],
    ]);
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: ids,
        scope: 'top',
        spec: SPEC,
      })
    ).toBe('tree-invariant');
  });

  test('rejects continuation at a shifted span interval', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="continue"/><w:gridSpan w:val="2"/>`)}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
    ]);
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellBorders',
        tableId: table.id,
        cellIds: ids,
        scope: 'left',
        spec: SPEC,
      })
    ).toBe('tree-invariant');
  });

  test('rejects incomplete selected visual merge group', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('a1', `<w:vMerge w:val="restart"/>`)}${CELL('a2')}</w:tr>` +
        `<w:tr>${CELL('b1', `<w:vMerge w:val="continue"/>`)}${CELL('b2')}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const restartId = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(part, {
        op: 'setTableCellFill',
        tableId: table.id,
        cellIds: [restartId],
        color: { kind: 'hex', value: 'AABBCC' },
      })
    ).toBe('invalidArgs');
  });

  test('rejects hostile wide-span hull before physical slot scans', () => {
    resetTestPhysicalGridSlotScanCount();
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr>${CELL('wide', `<w:gridSpan w:val="500"/>`)}</w:tr></w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const id = cellAt(part, 0, 0).id;
    expect(
      validateTableCellPropertyOp(
        part,
        {
          op: 'setTableCellBorders',
          tableId: table.id,
          cellIds: [id],
          scope: 'all',
          spec: SPEC,
        },
        { maxRows: 10_000, maxColumns: 1024, maxTraversalNodes: 100 }
      )
    ).toBe('resource-limit');
    expect(testPhysicalGridSlotScanCount).toBe(0);
  });

  test('rejects continuation-heavy tables before physical slot scans', () => {
    resetTestPhysicalGridSlotScanCount();
    const mergeRows = Array.from({ length: 200 }, (_, rowIndex) =>
      rowIndex === 0
        ? `<w:tr>${CELL(`r${rowIndex}`, `<w:vMerge w:val="restart"/>`)}${CELL(`x${rowIndex}`)}</w:tr>`
        : `<w:tr>${CELL(`r${rowIndex}`, `<w:vMerge w:val="continue"/>`)}${CELL(`x${rowIndex}`)}</w:tr>`
    ).join('');
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${mergeRows}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [1, 0],
    ]);
    expect(
      validateTableCellPropertyOp(
        part,
        {
          op: 'setTableCellBorders',
          tableId: table.id,
          cellIds: ids,
          scope: 'top',
          spec: SPEC,
        },
        { maxRows: 10_000, maxColumns: 1024, maxTraversalNodes: 50 }
      )
    ).toBe('resource-limit');
    expect(testPhysicalGridSlotScanCount).toBe(0);
  });

  test('accepts an ordinary valid hull under the custom budget', () => {
    resetTestPhysicalGridSlotScanCount();
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = collectByKind(part.root, 'table')[0]!;
    const ids = cellIds(part, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    expect(
      validateTableCellPropertyOp(
        part,
        {
          op: 'setTableCellBorders',
          tableId: table.id,
          cellIds: ids,
          scope: 'outside',
          spec: SPEC,
        },
        { maxRows: 10_000, maxColumns: 1024, maxTraversalNodes: 100 }
      )
    ).toBeNull();
    expect(testPhysicalGridSlotScanCount).toBeGreaterThan(0);
  });
});

describe('table cell property fix round 4', () => {
  test('rejects continuation-heavy ownership work before buildPhysicalGrid', () => {
    resetTestPhysicalGridSlotScanCount();
    resetTestVisualOwnerCounters();
    const rowCount = 40;
    // Differential budget (N=40 two-cell rows, all 80 cells selected):
    // topology lookup needs ~550 visits (446 nodes + stack-capacity guard);
    // round-3 estimate ≈ 7N = 280 (placed + hull + hull-row cells + rows);
    // current estimate adds owner links, member checks, and group validations ≈ 561.
    // budget 550 clears topology and round-3 but refuses on owner-group/member terms.
    const traversalBudget = 550;
    const mergeRows = Array.from({ length: rowCount }, (_, rowIndex) =>
      rowIndex === 0
        ? `<w:tr>${CELL(`r${rowIndex}`, `<w:vMerge w:val="restart"/>`)}${CELL(`x${rowIndex}`)}</w:tr>`
        : `<w:tr>${CELL(`r${rowIndex}`, `<w:vMerge w:val="continue"/>`)}${CELL(`x${rowIndex}`)}</w:tr>`
    ).join('');
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${mergeRows}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids: string[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      ids.push(cellAt(part, rowIndex, 0).id, cellAt(part, rowIndex, 1).id);
    }
    expect(
      validateTableCellPropertyOp(
        part,
        {
          op: 'setTableCellBorders',
          tableId: table.id,
          cellIds: ids,
          scope: 'outside',
          spec: SPEC,
        },
        { maxRows: 10_000, maxColumns: 1024, maxTraversalNodes: traversalBudget }
      )
    ).toBe('resource-limit');
    expect(testPhysicalGridSlotScanCount).toBe(0);
    expect(testVisualOwnerGroupValidationCount).toBe(0);
    expect(testVisualMemberCheckCount).toBe(0);
  });

  test('validates large continuation chain with linear owner/member work', () => {
    resetTestPhysicalGridSlotScanCount();
    resetTestVisualOwnerCounters();
    const rowCount = 100;
    const mergeRows = Array.from({ length: rowCount }, (_, rowIndex) =>
      rowIndex === 0
        ? `<w:tr>${CELL(`r${rowIndex}`, `<w:vMerge w:val="restart"/>`)}${CELL(`x${rowIndex}`)}</w:tr>`
        : `<w:tr>${CELL(`r${rowIndex}`, `<w:vMerge w:val="continue"/>`)}${CELL(`x${rowIndex}`)}</w:tr>`
    ).join('');
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${mergeRows}</w:tbl>`
    );
    const table = collectByKind(part.root, 'table')[0]!;
    const ids: string[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      ids.push(cellAt(part, rowIndex, 0).id, cellAt(part, rowIndex, 1).id);
    }
    expect(
      validateTableCellPropertyOp(
        part,
        {
          op: 'setTableCellBorders',
          tableId: table.id,
          cellIds: ids,
          scope: 'all',
          spec: SPEC,
        },
        { maxRows: 10_000, maxColumns: 1024, maxTraversalNodes: 10_000 }
      )
    ).toBeNull();
    expect(testVisualOwnerGroupValidationCount).toBe(rowCount + 1);
    expect(testVisualMemberCheckCount).toBe(rowCount * 2);
    expect(testVisualMemberCheckCount).toBeLessThan(rowCount * rowCount);
    expect(testPhysicalGridSlotScanCount).toBeGreaterThan(0);
  });
});
