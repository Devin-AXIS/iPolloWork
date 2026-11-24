// Table command planning and editor execution (table-editing task 7).
//
// Targets are stamped from `layout().revision` and planner input from `packageRevision()`,
// never from `session.revision()`. The fixtures here are body-only, where the body store's
// counter happens to equal the package's, so a body-space stamp passes every test in this
// file and refuses every real command the moment a header, footer or note edit moves the
// two apart. `revision-space.test.ts` is what actually holds that line.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import {
  planTableCommand,
  resetTableCommandPlannerCallCount,
  tableCommandPlannerCallCount,
} from '../table-command-plan.ts';
import {
  lowerColorValueForBorder,
  lowerColorValueForFill,
  resolveThemeColorHex,
  applyThemeTint,
  applyThemeShade,
} from '../color-value-lower.ts';
import { selectCellRectangle } from './paginated-surface-fixtures.ts';
import {
  tableColumnDividerResizeTargetOf,
  tableRightEdgeResizeTargetOf,
  tableColumnOccurrenceTargetFrom,
  tableRowOccurrenceTargetFrom,
  visitTableOccurrences,
} from '../../layout/table-interaction-targets.ts';
import { readEditableTableTopology } from '../../store/store/tree-op-table-topology.ts';
import { tableCommandState } from '../docx-editor-derive.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  canonicalOoxmlFingerprint,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../../store/package/ooxml-digest.ts';
import { wmlChildNamed } from '../../store/store/tree-op-table-shared.ts';
import { MAX_TABLE_COLUMNS } from '../../store/store/table-constraints.ts';
import { MERGE_NEEDS_SELECTION } from '../table-cell-structure-plan.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TABLE_2X2 =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

const CUSTOM_ACCENT2 = 'ED7D31';

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

function tableCount(part: OoxmlPart): number {
  return collectByKind(part.root, 'table').length;
}

function cellAtTableIndex(
  part: OoxmlPart,
  tableIndex: number,
  row: number,
  col: number
): OoxmlElement {
  const table = collectByKind(part.root, 'table')[tableIndex];
  if (!table) throw new Error('table missing');
  const rows = table.children.filter((c) => c.kind === 'tableRow');
  const cells = rows[row]!.children.filter((c) => c.kind === 'tableCell');
  const cell = cells[col];
  if (!cell || cell.kind === 'textValue') throw new Error('cell missing');
  return cell;
}

function borderSideAttrs(
  part: OoxmlPart,
  cellId: string,
  side: 'top' | 'left' | 'bottom' | 'right'
): Record<string, string> {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) throw new Error('cell missing');
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcBorders = tcPr && wmlChildNamed(tcPr, 'tcBorders');
  const sideEl = tcBorders && wmlChildNamed(tcBorders, side);
  if (!sideEl) throw new Error('border side missing');
  const out: Record<string, string> = {};
  for (const attr of sideEl.attributes) {
    if (attr.localName) out[attr.localName] = String(attr.value);
  }
  return out;
}

function themeModifierHex(fraction: number): string {
  return Math.round(fraction * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
}

function ecmaTintHexIndependent(baseHex: string, themeRetained: number): string {
  const tintByte = Math.max(0, Math.min(255, Math.round((1 - themeRetained) * 255)));
  const t = tintByte / 255;
  const r = parseInt(baseHex.slice(0, 2), 16);
  const g = parseInt(baseHex.slice(2, 4), 16);
  const b = parseInt(baseHex.slice(4, 6), 16);
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
  return `${byte(t * 255 + (1 - t) * r)}${byte(t * 255 + (1 - t) * g)}${byte(t * 255 + (1 - t) * b)}`;
}

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function paragraphByText(
  text: string,
  surface: NonNullable<DocxEditorInstance['surface']>
): string {
  for (const id of surface.session.paragraphIds()) {
    if (paragraphTextOf(surface.session.part(), id) === text) return id;
  }
  throw new Error(`paragraph ${text} not found`);
}

function caret(
  surface: NonNullable<DocxEditorInstance['surface']>,
  paragraphId: string,
  offset = 1
): void {
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function tableFragment(surface: NonNullable<DocxEditorInstance['surface']>) {
  for (const page of surface.layout().pages) {
    const block = page.fragments.find((b) => b.kind === 'table');
    if (block?.kind === 'table') return block;
  }
  throw new Error('no table in layout');
}

function assertCanExecParity(
  editor: DocxEditorInstance,
  command: Parameters<DocxEditorInstance['can']>[0]
): void {
  const can = editor.can(command);
  const exec = editor.exec(command);
  expect(exec.ok).toBe(can.ok);
  if (!can.ok && !exec.ok) {
    expect(exec.code).toBe(can.code);
    expect(exec.reason).toBe(can.reason);
  }
}

const gridReason = 'this table has a cell the editor cannot place in the grid';

describe('table command planner and editor parity', () => {
  test('insertRow can and exec agree outside a table', () => {
    const editor = mount(p('hello'));
    const cmd = { type: 'insertRow' as const, where: 'below' as const };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    if (can.ok) return;
    expect(can.reason).toBe('the selection is not inside a table');
    const exec = editor.exec(cmd);
    expect(exec).toEqual(can);
  });

  test('insertRow below commits one row from a caret cell', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const beforeRows = editor.getSelectedTable()!.rowCount;
    const revision = surface.session.revision();
    expect(editor.can({ type: 'insertRow', where: 'below' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertRow', where: 'below' }).ok).toBe(true);
    expect(surface.session.revision()).toBeGreaterThan(revision);
    expect(editor.getSelectedTable()!.rowCount).toBe(beforeRows + 1);
    expect(editor.query({ type: 'tableContext' })).not.toBeNull();
  });

  test('deleteRow on the final row removes the table and keeps the paragraph after it', () => {
    const editor = mount(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>' +
        p('only') +
        '</w:tc></w:tr></w:tbl>'
    );
    const surface = editor.surface!;
    caret(surface, paragraphByText('only', surface));
    const cmd = { type: 'deleteRow' as const };
    const can = editor.can(cmd);
    // The paragraph the body reads after its final table takes the caret, so the table goes.
    expect([can.ok, editor.exec(cmd).ok, editor.getSelectedTable()]).toEqual([true, true, null]);
    expect(surface.session.paragraphIds()).toHaveLength(1);
  });

  test('caret in plain body text answers null table context, and flips with the caret', () => {
    // The snapshot derive gates `tableContextAt` on the store's parent index: a caret whose
    // paragraph provably has no tableCell ancestor must answer null WITHOUT building the
    // layout's table index — and the gate must not change any answer. The document contains
    // a table so the null is the gate's, not an empty document's.
    const editor = mount(p('plain lead') + TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('plain lead', surface));
    expect(editor.getSelectedTable()).toBeNull();
    expect(editor.query({ type: 'tableContext' })).toBeNull();
    expect(editor.snapshot().table).toBeNull();

    // Into a cell: the full path answers with the exact table.
    caret(surface, paragraphByText('B1', surface));
    expect(editor.getSelectedTable()).toEqual({
      blockId: expect.any(String),
      rowCount: 2,
      columnCount: 2,
      cell: { row: 0, column: 1 },
    });
    expect(editor.query({ type: 'tableContext' })).toEqual({
      rows: 2,
      columns: 2,
      rowIndex: 0,
      columnIndex: 1,
    });

    // Back out: the gate answers null again for the same snapshot surface.
    caret(surface, paragraphByText('plain lead', surface));
    expect(editor.getSelectedTable()).toBeNull();
    expect(editor.query({ type: 'tableContext' })).toBeNull();
    expect(editor.snapshot().table).toBeNull();
  });

  test('getSelectedTable and tableContext query return real values in a cell', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A2', surface));
    const selected = editor.getSelectedTable();
    expect(selected).toEqual({
      blockId: expect.any(String),
      rowCount: 2,
      columnCount: 2,
      cell: { row: 1, column: 0 },
    });
    expect(editor.query({ type: 'tableContext' })).toEqual({
      rows: 2,
      columns: 2,
      rowIndex: 1,
      columnIndex: 0,
    });
    expect(editor.snapshot().table).toEqual(editor.query({ type: 'tableContext' }));
  });

  test('viewing mode refuses mutating table commands', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    const cmd = { type: 'deleteRow' as const };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    expect(can.reason).toBe('the document is open for viewing');
    expect(editor.exec(cmd)).toEqual(can);
  });

  test('mergeCells at a caret asks for a cell selection', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const cmd = { type: 'mergeCells' as const };
    const can = editor.can(cmd);
    expect(can).toMatchObject({ ok: false, reason: MERGE_NEEDS_SELECTION });
    expect(editor.exec(cmd)).toEqual(can);
  });

  test('stale explicit resize target refuses without mutation', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const table = tableFragment(surface);
    const topo = readEditableTableTopology(surface.session.part().root, table.tableId);
    expect(topo.ok).toBe(true);
    if (!topo.ok) return;
    const revision = surface.layout().revision;
    const target = tableColumnDividerResizeTargetOf(
      surface.layout(),
      revision,
      table.tableId,
      table.rows[0]!.id,
      false,
      topo.topology.gridColumns[0]!.id,
      topo.topology.gridColumns[1]!.id
    );
    expect(target?.isHeaderRepeat).toBe(false);
    surface.type('X');
    const cmd = {
      type: 'commitTableColumnDividerResize' as const,
      target: target!,
      leftWidthTwips: 2400,
      rightWidthTwips: 3600,
    };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    expect(can.reason).toBe('the table target is stale');
    expect(editor.exec(cmd)).toEqual(can);
  });

  test('nested table context targets the innermost table', () => {
    const nested =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      `<w:tr><w:tc>${p('inner')}</w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      `<w:tr><w:tc>${nested}</w:tc><w:tc>${p('outer')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(outer);
    const surface = editor.surface!;
    caret(surface, paragraphByText('inner', surface));
    const selected = editor.getSelectedTable()!;
    expect(selected.rowCount).toBe(1);
    expect(selected.columnCount).toBe(1);
    expect(selected.cell).toEqual({ row: 0, column: 0 });
    assertCanExecParity(editor, { type: 'insertRow', where: 'below' });
  });

  test('rectangular cell selection plans fill for every selected cell', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    const cmd = { type: 'setCellFill' as const, color: { kind: 'hex' as const, value: 'FF0000' } };
    const can = editor.can(cmd);
    expect(can.ok).toBe(true);
    const revision = surface.session.revision();
    assertCanExecParity(editor, cmd);
    expect(surface.session.revision()).toBe(revision + 1);
    expect(surface.state().cellSelection?.cellIds).toHaveLength(4);
  });

  test('missing-grid insertColumn uses referenceCellId', () => {
    const noGrid =
      '<w:tbl>' +
      `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
      `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(noGrid);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const plan = planTableCommand({
      command: { type: 'insertColumn', where: 'right' },
      part: surface.session.part(),
      layout: surface.layout(),
      storeRevision: surface.session.packageRevision(),
      selection: surface.state().selection,
      cellSelection: surface.state().cellSelection,
      themeColors: surface.session.documentThemeColors(),
      editable: true,
      viewing: false,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ops[0]).toMatchObject({
      op: 'insertTableColumn',
      referenceCellId: expect.any(String),
    });
    expect(plan.ops[0]).not.toHaveProperty('gridColumnId');
  });

  test('deleteColumn on the final column removes the table and keeps the paragraph after it', () => {
    const oneCol =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      `<w:tr><w:tc>${p('only')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(oneCol);
    const surface = editor.surface!;
    caret(surface, paragraphByText('only', surface));
    const cmd = { type: 'deleteColumn' as const };
    const can = editor.can(cmd);
    // The paragraph the body reads after its final table takes the caret, so the table goes.
    expect([can.ok, editor.exec(cmd).ok, editor.getSelectedTable()]).toEqual([true, true, null]);
    expect(surface.session.paragraphIds()).toHaveLength(1);
  });

  test('repeated can and plan calls do not mutate store revision', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const beforeRevision = surface.session.revision();
    const beforeIds = surface.session.paragraphIds();
    for (let i = 0; i < 5; i += 1) {
      expect(editor.can({ type: 'insertRow', where: 'below' }).ok).toBe(true);
      planTableCommand({
        command: { type: 'insertRow', where: 'below' },
        part: surface.session.part(),
        layout: surface.layout(),
        storeRevision: surface.session.packageRevision(),
        selection: surface.state().selection,
        cellSelection: surface.state().cellSelection,
        themeColors: surface.session.documentThemeColors(),
        editable: true,
        viewing: false,
      });
    }
    expect(surface.session.revision()).toBe(beforeRevision);
    expect(surface.session.paragraphIds()).toEqual(beforeIds);
  });

  test('rectangle selection reports top-left in getSelectedTable and tableContext', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    expect(editor.getSelectedTable()?.cell).toEqual({ row: 0, column: 0 });
    expect(editor.query({ type: 'tableContext' })).toEqual({
      rows: 2,
      columns: 2,
      rowIndex: 0,
      columnIndex: 0,
    });
    expect(editor.snapshot().table).toEqual(editor.query({ type: 'tableContext' }));
  });

  test('deleteTable recovers caret in a surviving paragraph', () => {
    const body = p('before') + TABLE_2X2 + p('after');
    const editor = mount(body);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const after = paragraphByText('after', surface);
    expect(editor.can({ type: 'deleteTable' }).ok).toBe(true);
    expect(editor.exec({ type: 'deleteTable' }).ok).toBe(true);
    expect(surface.state().selection.head).toEqual({ paragraphId: after, offset: 0 });
    editor.exec({ type: 'undo' });
    expect(paragraphTextOf(surface.session.part(), paragraphByText('A1', surface))).toBe('A1');
  });

  test('explicit repeated-header row target from live layout refuses', () => {
    const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${p('HEAD')}</w:tc></w:tr>`;
    const body = Array.from(
      { length: 60 },
      (_, i) => `<w:tr><w:tc>${p(`row ${i}`)}</w:tc></w:tr>`
    ).join('');
    const editor = mount(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${header}${body}</w:tbl>`
    );
    const surface = editor.surface!;
    expect(surface.layout().pages.length).toBeGreaterThan(1);
    let repeatTarget: ReturnType<typeof tableRowOccurrenceTargetFrom> | null = null;
    visitTableOccurrences(surface.layout(), (ref) => {
      if (ref.row.isHeaderRepeat) {
        repeatTarget = tableRowOccurrenceTargetFrom(surface.layout().revision, ref);
      }
    });
    expect(repeatTarget?.isHeaderRepeat).toBe(true);
    const cmd = { type: 'insertRow' as const, where: 'below' as const, target: repeatTarget! };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    expect(can.reason).toBe('repeated header rows cannot be edited');
    expect(editor.exec(cmd)).toEqual(can);
  });

  test('a merged grid the table cannot fill refuses insertColumn at the editor seam', () => {
    const merged =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      `<w:tr><w:tc>${p('A1')}</w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p('span')}</w:tc></w:tr>` +
      `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(merged);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const cmd = { type: 'insertColumn' as const, where: 'right' as const };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    expect(can.reason).toBe(gridReason);
    expect(editor.exec(cmd)).toEqual(can);
  });

  test('hostile command shapes return invalidArgs without throwing', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const bad = {
      type: 'setCellFill',
      color: { kind: 'hex', value: 'ZZZZZZ', extra: true },
    } as never;
    const can = editor.can(bad);
    expect(can.ok).toBe(false);
    if (can.ok) return;
    expect(can.code).toBe('invalidArgs');
  });

  test('resize target from layout factory refuses when store revision moved', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const table = tableFragment(surface);
    const topo = readEditableTableTopology(surface.session.part().root, table.tableId);
    expect(topo.ok).toBe(true);
    if (!topo.ok) return;
    const layoutRevision = surface.layout().revision;
    const target = tableColumnDividerResizeTargetOf(
      surface.layout(),
      surface.layout().revision,
      table.tableId,
      table.rows[0]!.id,
      false,
      topo.topology.gridColumns[0]!.id,
      topo.topology.gridColumns[1]!.id
    );
    expect(target?.sourceRevision).toBe(layoutRevision);
    expect(layoutRevision).toBeGreaterThanOrEqual(0);
    surface.type('X');
    const cmd = {
      type: 'commitTableColumnDividerResize' as const,
      target: target!,
      leftWidthTwips: 2400,
      rightWidthTwips: 3600,
    };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    expect(can.reason).toBe('the table target is stale');
  });
});

describe('color lowering for table commands', () => {
  test('theme tint resolves to store colour with resolvedHex', () => {
    const result = lowerColorValueForBorder({ kind: 'theme', slot: 'accent1', tint: 0.5 }, [
      { slot: 'accent1', hex: '4472C4' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.color.kind).toBe('theme');
    if (result.color.kind === 'theme') {
      expect(result.color.resolvedHex).toBe(applyThemeTint('4472C4', 0.5));
    }
  });

  test('both tint and shade lower with tint precedence and preserve both modifiers', () => {
    const expected = ecmaTintHexIndependent(CUSTOM_ACCENT2, 0.8);
    const color = { kind: 'theme' as const, slot: 'accent2', tint: 0.8, shade: 0.5 };
    const resolved = resolveThemeColorHex(color, [{ slot: 'accent2', hex: CUSTOM_ACCENT2 }]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe(expected);
    const lowered = lowerColorValueForBorder(color, [{ slot: 'accent2', hex: CUSTOM_ACCENT2 }]);
    expect(lowered.ok).toBe(true);
    if (!lowered.ok) return;
    expect(lowered.color.kind).toBe('theme');
    if (lowered.color.kind !== 'theme') return;
    expect(lowered.color.tint).toBe(0.8);
    expect(lowered.color.shade).toBe(0.5);
    expect(lowered.color.resolvedHex).toBe(expected);
  });

  test('border command with both modifiers writes themeTint and themeShade and save/reopen readback', async () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    const cellId = cellAtTableIndex(surface.session.part(), 0, 0, 0).id;
    caret(surface, paragraphByText('A1', surface), 1);
    const color = { kind: 'theme' as const, slot: 'accent2', tint: 0.8, shade: 0.5 };
    const expectedHex = ecmaTintHexIndependent(CUSTOM_ACCENT2, 0.8);
    const exec = editor.exec({
      type: 'setTableBorders',
      scope: 'top',
      spec: { style: 'single', size: 8, color },
    });
    expect(exec.ok).toBe(true);
    const edited = surface.session.part();
    const attrs = borderSideAttrs(edited, cellId, 'top');
    expect(attrs.themeColor).toBe('accent2');
    expect(attrs.themeTint).toBe(themeModifierHex(0.8));
    expect(attrs.themeShade).toBe(themeModifierHex(0.5));
    expect(attrs.color?.toUpperCase()).toBe(expectedHex);

    const bytes = new Uint8Array(await editor.save());
    const reopened = readOoxmlPackage(bytes);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const reopenedPart = reopened.package.parts.get('/word/document.xml')!;
    expect(canonicalOoxmlFingerprint(reopenedPart)).toEqual(canonicalOoxmlFingerprint(edited));
    expect(diffSemanticDigests(semanticDigest([edited]), semanticDigest([reopenedPart]))).toEqual(
      []
    );
    const readAttrs = borderSideAttrs(reopenedPart, cellId, 'top');
    expect(readAttrs.themeColor).toBe('accent2');
    expect(readAttrs.themeTint).toBe(themeModifierHex(0.8));
    expect(readAttrs.themeShade).toBe(themeModifierHex(0.5));
    expect(readAttrs.color?.toUpperCase()).toBe(expectedHex);
  });

  test('invalid theme modifier refuses honestly', () => {
    const result = lowerColorValueForBorder({ kind: 'theme', slot: 'accent1', tint: 0 }, [
      { slot: 'accent1', hex: '4472C4' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('theme tint is out of range');
  });

  test('auto fill refuses honestly', () => {
    const result = lowerColorValueForFill({ kind: 'auto' }, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('automatic fill');
  });

  test('public none border scope lowers directly', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const plan = planTableCommand({
      command: { type: 'setTableBorders', scope: 'none', target: 'top' },
      part: surface.session.part(),
      layout: surface.layout(),
      storeRevision: surface.session.packageRevision(),
      selection: surface.state().selection,
      cellSelection: surface.state().cellSelection,
      themeColors: surface.session.documentThemeColors(),
      editable: true,
      viewing: false,
    });
    expect(plan.ok).toBe(true);
  });

  test('auto border lowers with render fallback and serializes as auto', () => {
    const lowered = lowerColorValueForBorder({ kind: 'auto' }, []);
    expect(lowered.ok).toBe(true);
    if (!lowered.ok) return;
    expect(lowered.color).toEqual({ kind: 'auto', resolvedHex: '000000' });
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    expect(
      editor.exec({
        type: 'setTableBorders',
        scope: 'top',
        spec: { style: 'single', size: 8, color: { kind: 'auto' } },
      }).ok
    ).toBe(true);
  });
});

describe('planner call count and command state', () => {
  test('can plans once; exec plans once total', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    resetTableCommandPlannerCallCount();
    editor.can({ type: 'insertRow', where: 'below' });
    expect(tableCommandPlannerCallCount()).toBe(1);
    resetTableCommandPlannerCallCount();
    editor.exec({ type: 'insertRow', where: 'below' });
    expect(tableCommandPlannerCallCount()).toBe(1);
  });

  test('tableCommandState matches can and carries plan', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const state = tableCommandState({ type: 'insertRow', where: 'below' }, surface);
    expect(state.can).toEqual(editor.can({ type: 'insertRow', where: 'below' }));
    expect(state.plan.ok).toBe(true);
  });
});

describe('occurrence targets and provenance', () => {
  test('layout cells expose canonical gridColumnId', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    const table = tableFragment(surface);
    const topo = readEditableTableTopology(surface.session.part().root, table.tableId);
    expect(topo.ok).toBe(true);
    if (!topo.ok) return;
    expect(table.rows[0]!.cells[1]!.gridColumnId).toBe(topo.topology.gridColumns[1]!.id);
  });

  test('column target deletes without moving selection to that column', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const table = tableFragment(surface);
    const topo = readEditableTableTopology(surface.session.part().root, table.tableId);
    expect(topo.ok).toBe(true);
    if (!topo.ok) return;
    const ref = { table, row: table.rows[0]!, rowIndex: 0 };
    const bCell = table.rows[0]!.cells.find((c) => c.gridColumn === 1)!;
    const target = tableColumnOccurrenceTargetFrom(surface.layout().revision, ref, bCell)!;
    expect(target.gridColumnId).toBe(topo.topology.gridColumns[1]!.id);
    const beforeB1 = paragraphByText('B1', surface);
    const cmd = { type: 'deleteColumn' as const, target };
    const can = editor.can(cmd);
    const exec = editor.exec(cmd);
    expect(exec.ok).toBe(can.ok);
    if (!can.ok && !exec.ok) {
      expect(exec.code).toBe(can.code);
      expect(exec.reason).toBe(can.reason);
    }
    expect(exec.ok).toBe(true);
    expect(surface.session.paragraphIds().includes(beforeB1)).toBe(false);
    expect(paragraphTextOf(surface.session.part(), paragraphByText('A1', surface))).toBe('A1');
  });

  test('wrong-table explicit column target refuses', () => {
    const body = TABLE_2X2 + TABLE_2X2;
    const editor = mount(body);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const firstTable = tableFragment(surface);
    let foreignGridColumnId = '';
    visitTableOccurrences(surface.layout(), (ref) => {
      if (ref.table.tableId !== firstTable.tableId) {
        foreignGridColumnId = ref.row.cells[0]!.gridColumnId ?? '';
      }
    });
    expect(foreignGridColumnId).toBeTruthy();
    const target = {
      sourceRevision: surface.layout().revision,
      tableId: firstTable.tableId,
      gridColumnId: foreignGridColumnId,
      isHeaderRepeat: false,
    };
    const cmd = { type: 'deleteColumn' as const, target };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    expect(can.reason).toBe('the table target is no longer valid');
    expect(editor.exec(cmd)).toEqual(can);
  });

  test('nested table occurrence factory targets inner table', () => {
    const nested =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      `<w:tr><w:tc>${p('inner')}</w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      `<w:tr><w:tc>${nested}</w:tc><w:tc>${p('outer')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(outer);
    const surface = editor.surface!;
    let innerTarget: ReturnType<typeof tableRowOccurrenceTargetFrom> | null = null;
    visitTableOccurrences(surface.layout(), (ref) => {
      if (
        ref.table.rows[0]?.cells[0]?.blocks.some(
          (b) =>
            b.kind === 'paragraph' && b.lines.some((l) => l.spans.some((s) => s.text === 'inner'))
        )
      ) {
        innerTarget = tableRowOccurrenceTargetFrom(surface.layout().revision, ref);
      }
    });
    expect(innerTarget).not.toBeNull();
    caret(surface, paragraphByText('outer', surface));
    const cmd = { type: 'insertRow' as const, where: 'below' as const, target: innerTarget! };
    expect(editor.can(cmd).ok).toBe(true);
  });

  test('stale row occurrence refuses after store revision advances', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    const table = tableFragment(surface);
    const ref = { table, row: table.rows[0]!, rowIndex: 0 };
    const target = tableRowOccurrenceTargetFrom(surface.layout().revision, ref);
    surface.type('X');
    const cmd = { type: 'insertRow' as const, where: 'below' as const, target };
    const can = editor.can(cmd);
    expect(can.ok).toBe(false);
    expect(can.reason).toBe('the table target is stale');
    expect(editor.exec(cmd)).toEqual(can);
  });
});

describe('merge and resource refusals at editor seam', () => {
  test('a span past the grid refuses column insertion and resizing', () => {
    const merged =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      `<w:tr><w:tc>${p('A1')}</w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p('span')}</w:tc></w:tr>` +
      `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(merged);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    const insertCan = editor.can({ type: 'insertColumn', where: 'right' });
    expect(insertCan.ok).toBe(false);
    expect(insertCan.reason).toBe(gridReason);
    const table = tableFragment(surface);
    const topo = readEditableTableTopology(surface.session.part().root, table.tableId);
    expect(topo.ok).toBe(true);
    if (!topo.ok) return;
    const target = tableColumnDividerResizeTargetOf(
      surface.layout(),
      surface.layout().revision,
      table.tableId,
      table.rows[0]!.id,
      false,
      topo.topology.gridColumns[0]!.id,
      topo.topology.gridColumns[1]!.id
    )!;
    const resizeCan = editor.can({
      type: 'commitTableColumnDividerResize',
      target,
      leftWidthTwips: 2400,
      rightWidthTwips: 3600,
    });
    expect(resizeCan).toMatchObject({ ok: false, reason: gridReason });
  });

  test('insert column right of a merged cell lands after its last column', () => {
    const editor = mount(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr>${p('Head')}</w:tc></w:tr>` +
        `<w:tr><w:tc>${p('A')}</w:tc><w:tc>${p('B')}</w:tc><w:tc>${p('C')}</w:tc></w:tr></w:tbl>`
    );
    const surface = editor.surface!;
    caret(surface, paragraphByText('Head', surface));
    expect(editor.exec({ type: 'insertColumn', where: 'right' }).ok).toBe(true);
    const part = surface.session.part();
    const topo = readEditableTableTopology(part.root, tableFragment(surface).tableId);
    if (!topo.ok) throw new Error('no table');
    // The header keeps its three columns and the body gains a cell after C.
    expect(topo.topology.rows.map(({ cells }) => cells.length)).toEqual([2, 4]);
    const body = topo.topology.rows[1]!.cells.map((cell) =>
      paragraphTextOf(part, cell.children.find((child) => child.kind === 'paragraph')!.id)
    );
    expect(body.slice(0, 3)).toEqual(['A', 'B', 'C']);
  });

  test('hMerge column ops refuse; vMerge column ops apply', () => {
    for (const [extra, reason] of [
      [
        `<w:tr><w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr>${p('h')}</w:tc><w:tc>${p('x')}</w:tc></w:tr>`,
        'this table uses a legacy horizontal merge the editor cannot change',
      ],
      [
        `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p('v')}</w:tc><w:tc>${p('x')}</w:tc></w:tr>` +
          `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>${p('v2')}</w:tc><w:tc>${p('y')}</w:tc></w:tr>`,
        undefined,
      ],
    ] as const) {
      const editor = mount(
        '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
          extra +
          '</w:tbl>'
      );
      const surface = editor.surface!;
      caret(surface, surface.session.paragraphIds()[0]!);
      const can = editor.can({ type: 'deleteColumn' });
      expect(can.ok).toBe(reason === undefined);
      expect(can.reason).toBe(reason);
    }
  });

  test('insertColumn at max columns refuses at editor seam', () => {
    const cols = Array.from({ length: MAX_TABLE_COLUMNS }, () => '<w:gridCol w:w="100"/>').join('');
    const cells = Array.from(
      { length: MAX_TABLE_COLUMNS },
      (_, i) => `<w:tc>${p(`c${i}`)}</w:tc>`
    ).join('');
    const editor = mount(`<w:tbl><w:tblGrid>${cols}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`);
    const surface = editor.surface!;
    caret(surface, paragraphByText('c0', surface));
    const can = editor.can({ type: 'insertColumn', where: 'right' });
    expect(can.ok).toBe(false);
    expect(can.reason).toBe('the table has reached the supported size limit');
    expect(editor.exec({ type: 'insertColumn', where: 'right' })).toEqual(can);
  });
});

describe('transaction and selection preservation', () => {
  function countApplyTreeOps(
    surface: NonNullable<DocxEditorInstance['surface']>,
    run: () => void
  ): number {
    let count = 0;
    const session = surface.session as typeof surface.session & {
      applyTreeOps: typeof surface.session.applyTreeOps;
    };
    const original = session.applyTreeOps.bind(session);
    session.applyTreeOps = (...args) => {
      count += 1;
      return original(...args);
    };
    run();
    return count;
  }

  function dividerResizeCommand(surface: NonNullable<DocxEditorInstance['surface']>) {
    const table = tableFragment(surface);
    const topo = readEditableTableTopology(surface.session.part().root, table.tableId);
    if (!topo.ok) throw new Error('topology failed');
    const target = tableColumnDividerResizeTargetOf(
      surface.layout(),
      surface.layout().revision,
      table.tableId,
      table.rows[0]!.id,
      false,
      topo.topology.gridColumns[0]!.id,
      topo.topology.gridColumns[1]!.id
    )!;
    return {
      type: 'commitTableColumnDividerResize' as const,
      target,
      leftWidthTwips: 2000,
      rightWidthTwips: 4000,
    };
  }

  function rightEdgeResizeCommand(surface: NonNullable<DocxEditorInstance['surface']>) {
    const table = tableFragment(surface);
    const topo = readEditableTableTopology(surface.session.part().root, table.tableId);
    if (!topo.ok) throw new Error('topology failed');
    const last = topo.topology.gridColumns[topo.topology.gridColumns.length - 1]!;
    const target = tableRightEdgeResizeTargetOf(
      surface.layout(),
      surface.layout().revision,
      table.tableId,
      table.rows[0]!.id,
      false,
      last.id
    )!;
    return {
      type: 'commitTableRightEdgeResize' as const,
      target,
      columnWidthTwips: 4000,
      tableWidthTwips: 6400,
    };
  }

  test('structural and resize commands commit exactly one transaction each', () => {
    const assertOneTx = (body: string, paragraphText: string, command: EditorCommand) => {
      const editor = mount(body);
      const surface = editor.surface!;
      caret(surface, paragraphByText(paragraphText, surface), 1);
      expect(countApplyTreeOps(surface, () => expect(editor.exec(command).ok).toBe(true))).toBe(1);
    };
    assertOneTx(TABLE_2X2, 'A1', { type: 'insertRow', where: 'below' });
    assertOneTx(TABLE_2X2, 'A1', { type: 'insertColumn', where: 'right' });
    assertOneTx(TABLE_2X2, 'B2', { type: 'deleteRow' });
    assertOneTx(TABLE_2X2, 'A1', { type: 'deleteColumn' });
    assertOneTx(p('lead') + TABLE_2X2, 'A1', { type: 'deleteTable' });
  });

  test('format commands commit exactly one transaction each', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface), 1);
    expect(
      countApplyTreeOps(surface, () =>
        expect(
          editor.exec({ type: 'setCellFill', color: { kind: 'hex', value: 'FF0000' } }).ok
        ).toBe(true)
      )
    ).toBe(1);
    caret(surface, paragraphByText('A1', surface), 1);
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    expect(
      countApplyTreeOps(surface, () =>
        expect(
          editor.exec({
            type: 'setTableBorders',
            scope: 'all',
            spec: { style: 'single', size: 4, color: { kind: 'hex', value: '112233' } },
          }).ok
        ).toBe(true)
      )
    ).toBe(1);
  });

  test('resize commands commit exactly one transaction each', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface), 1);
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    const divider = dividerResizeCommand(surface);
    expect(editor.can(divider).ok).toBe(true);
    expect(countApplyTreeOps(surface, () => expect(editor.exec(divider).ok).toBe(true))).toBe(1);

    const editor2 = mount(TABLE_2X2);
    const surface2 = editor2.surface!;
    caret(surface2, paragraphByText('A1', surface2), 1);
    selectCellRectangle(surface2, { row: 0, column: 0 }, { row: 1, column: 1 });
    const rightEdge = rightEdgeResizeCommand(surface2);
    expect(editor2.can(rightEdge).ok).toBe(true);
    expect(countApplyTreeOps(surface2, () => expect(editor2.exec(rightEdge).ok).toBe(true))).toBe(
      1
    );
  });

  test('insertRow and insertColumn land carets in new structural cells', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface), 1);
    editor.exec({ type: 'insertRow', where: 'below' });
    const rowHead = surface.state().selection.head.paragraphId;
    expect(paragraphTextOf(surface.session.part(), rowHead)).not.toBe('A1');
    expect(paragraphTextOf(surface.session.part(), rowHead)).not.toBe('A2');
    caret(surface, paragraphByText('A1', surface), 1);
    editor.exec({ type: 'insertColumn', where: 'right' });
    const colHead = surface.state().selection.head.paragraphId;
    expect(paragraphTextOf(surface.session.part(), colHead)).not.toBe('A1');
    expect(paragraphTextOf(surface.session.part(), colHead)).not.toBe('B1');
  });

  test('deleteRow preserves anchor column when a cell survives', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('B2', surface), 2);
    editor.exec({ type: 'deleteRow' });
    expect(
      paragraphTextOf(surface.session.part(), surface.state().selection.head.paragraphId)
    ).toBe('B1');
  });

  test('deleteColumn lands in nearest surviving cell of anchor column', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface), 1);
    editor.exec({ type: 'deleteColumn' });
    expect(
      paragraphTextOf(surface.session.part(), surface.state().selection.head.paragraphId)
    ).toBe('B1');
  });

  test('border fill and both resize commands preserve rectangular selection', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    const rectBefore = surface.state().cellSelection?.cellIds;
    editor.exec({ type: 'setCellFill', color: { kind: 'hex', value: 'FF0000' } });
    expect(surface.state().cellSelection?.cellIds).toEqual(rectBefore);
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    editor.exec({
      type: 'setTableBorders',
      scope: 'all',
      spec: { style: 'single', size: 4, color: { kind: 'hex', value: '112233' } },
    });
    expect(surface.state().cellSelection?.cellIds).toEqual(rectBefore);
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    const divider = dividerResizeCommand(surface);
    expect(editor.exec(divider).ok).toBe(true);
    expect(surface.state().cellSelection?.cellIds).toEqual(rectBefore);
    const editor2 = mount(TABLE_2X2);
    const surface2 = editor2.surface!;
    selectCellRectangle(surface2, { row: 0, column: 0 }, { row: 1, column: 1 });
    const rect2 = surface2.state().cellSelection?.cellIds;
    const rightEdge = rightEdgeResizeCommand(surface2);
    expect(editor2.exec(rightEdge).ok).toBe(true);
    expect(surface2.state().cellSelection?.cellIds).toEqual(rect2);
  });

  test('deleteTable from table middle restores exact caret on undo and survivor on redo', () => {
    const body = p('before') + TABLE_2X2 + p('after');
    const editor = mount(body);
    const surface = editor.surface!;
    const a1 = paragraphByText('A1', surface);
    const after = paragraphByText('after', surface);
    caret(surface, a1, 3);
    const selBefore = { ...surface.state().selection.head };
    editor.exec({ type: 'deleteTable' });
    const afterDelete = { ...surface.state().selection.head };
    expect(afterDelete).toEqual({ paragraphId: after, offset: 0 });
    editor.exec({ type: 'undo' });
    expect(surface.state().selection.head).toEqual({ paragraphId: a1, offset: selBefore.offset });
    editor.exec({ type: 'redo' });
    expect(surface.state().selection.head).toEqual(afterDelete);
  });

  test('deleteTable at document start removes table and restores history exactly', () => {
    const body = TABLE_2X2 + p('trail');
    const editor = mount(body);
    const surface = editor.surface!;
    const a1 = paragraphByText('A1', surface);
    const trail = paragraphByText('trail', surface);
    const outerTableId = collectByKind(surface.session.part().root, 'table')[0]!.id;
    const tablesBefore = tableCount(surface.session.part());
    caret(surface, a1, 2);
    const selBefore = { ...surface.state().selection.head };

    const tx = countApplyTreeOps(surface, () => {
      expect(editor.can({ type: 'deleteTable' }).ok).toBe(true);
      expect(editor.exec({ type: 'deleteTable' }).ok).toBe(true);
    });
    expect(tx).toBe(1);
    expect(tableCount(surface.session.part())).toBe(tablesBefore - 1);
    expect(
      collectByKind(surface.session.part().root, 'table').some((t) => t.id === outerTableId)
    ).toBe(false);
    const afterDelete = { ...surface.state().selection.head };
    expect(afterDelete.paragraphId).toBe(trail);

    editor.exec({ type: 'undo' });
    expect(tableCount(surface.session.part())).toBe(tablesBefore);
    expect(
      collectByKind(surface.session.part().root, 'table').some((t) => t.id === outerTableId)
    ).toBe(true);
    expect(surface.state().selection.head).toEqual(selBefore);
    expect(paragraphTextOf(surface.session.part(), a1)).toBe('A1');

    editor.exec({ type: 'redo' });
    expect(tableCount(surface.session.part())).toBe(tablesBefore - 1);
    expect(surface.state().selection.head).toEqual(afterDelete);
  });

  test('deleteTable at document end removes table and restores history exactly', () => {
    const body = p('lead') + TABLE_2X2;
    const editor = mount(body);
    const surface = editor.surface!;
    const a1 = paragraphByText('A1', surface);
    const lead = paragraphByText('lead', surface);
    const outerTableId = collectByKind(surface.session.part().root, 'table')[0]!.id;
    const tablesBefore = tableCount(surface.session.part());
    caret(surface, a1, 3);
    const selBefore = { ...surface.state().selection.head };

    const tx = countApplyTreeOps(surface, () => {
      expect(editor.can({ type: 'deleteTable' }).ok).toBe(true);
      expect(editor.exec({ type: 'deleteTable' }).ok).toBe(true);
    });
    expect(tx).toBe(1);
    expect(tableCount(surface.session.part())).toBe(tablesBefore - 1);
    expect(
      collectByKind(surface.session.part().root, 'table').some((t) => t.id === outerTableId)
    ).toBe(false);
    const afterDelete = { ...surface.state().selection.head };
    const storyEnd = surface.session.paragraphIds().at(-1)!;
    expect(storyEnd).not.toBe(lead);
    expect(afterDelete).toEqual({ paragraphId: storyEnd, offset: 0 });

    editor.exec({ type: 'undo' });
    expect(tableCount(surface.session.part())).toBe(tablesBefore);
    expect(surface.state().selection.head).toEqual(selBefore);
    expect(paragraphTextOf(surface.session.part(), a1)).toBe('A1');

    editor.exec({ type: 'redo' });
    expect(tableCount(surface.session.part())).toBe(tablesBefore - 1);
    expect(surface.state().selection.head).toEqual(afterDelete);
  });

  test('deleteTable on nested inner table preserves outer table and one-transaction history', () => {
    const nested =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      `<w:tr><w:tc>${p('inner')}</w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      `<w:tr><w:tc>${nested}</w:tc><w:tc>${p('outer')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(outer);
    const surface = editor.surface!;
    const inner = paragraphByText('inner', surface);
    const outerPara = paragraphByText('outer', surface);
    const partBefore = surface.session.part();
    const innerTableId = collectByKind(partBefore.root, 'table')[1]!.id;
    const outerTableId = collectByKind(partBefore.root, 'table')[0]!.id;
    const nestedCell = cellAtTableIndex(partBefore, 0, 0, 0);
    caret(surface, inner, 2);
    const selBefore = { ...surface.state().selection.head };

    expect(editor.can({ type: 'deleteTable' }).ok).toBe(true);
    const tx = countApplyTreeOps(surface, () => {
      expect(editor.exec({ type: 'deleteTable' }).ok).toBe(true);
    });
    expect(tx).toBe(1);

    const partAfter = surface.session.part();
    expect(tableCount(partAfter)).toBe(1);
    expect(collectByKind(partAfter.root, 'table').some((t) => t.id === innerTableId)).toBe(false);
    expect(collectByKind(partAfter.root, 'table').some((t) => t.id === outerTableId)).toBe(true);
    const vacated = cellAtTableIndex(partAfter, 0, 0, 0);
    expect(vacated.id).toBe(nestedCell.id);
    expect(vacated.children.some((c) => c.kind === 'table')).toBe(false);
    expect(vacated.children.some((c) => c.kind === 'paragraph')).toBe(true);
    expect(
      paragraphTextOf(partAfter, vacated.children.find((c) => c.kind === 'paragraph')!.id)
    ).toBe('');
    const afterDelete = { ...surface.state().selection.head };
    expect(afterDelete.paragraphId).toBe(outerPara);

    editor.exec({ type: 'undo' });
    expect(tableCount(surface.session.part())).toBe(2);
    expect(
      collectByKind(surface.session.part().root, 'table').some((t) => t.id === innerTableId)
    ).toBe(true);
    expect(surface.state().selection.head).toEqual(selBefore);
    expect(paragraphTextOf(surface.session.part(), inner)).toBe('inner');

    editor.exec({ type: 'redo' });
    const partRedo = surface.session.part();
    expect(tableCount(partRedo)).toBe(1);
    expect(collectByKind(partRedo.root, 'table').some((t) => t.id === innerTableId)).toBe(false);
    expect(collectByKind(partRedo.root, 'table').some((t) => t.id === outerTableId)).toBe(true);
    const vacatedRedo = cellAtTableIndex(partRedo, 0, 0, 0);
    expect(vacatedRedo.id).toBe(nestedCell.id);
    expect(vacatedRedo.children.some((c) => c.kind === 'table')).toBe(false);
    expect(vacatedRedo.children.some((c) => c.kind === 'paragraph')).toBe(true);
    expect(
      paragraphTextOf(partRedo, vacatedRedo.children.find((c) => c.kind === 'paragraph')!.id)
    ).toBe('');
    expect(surface.state().selection.head).toEqual(afterDelete);
  });
});

describe('tables on the paginated surface', () => {
  test('undo restores a removed row', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    const a2 = paragraphByText('A2', surface);
    caret(surface, a2);
    expect(paragraphTextOf(surface.session.part(), a2)).toBe('A2');
    editor.exec({ type: 'deleteRow' });
    expect(
      surface.session
        .paragraphIds()
        .every((id) => paragraphTextOf(surface.session.part(), id) !== 'A2')
    ).toBe(true);
    editor.exec({ type: 'undo' });
    expect(paragraphTextOf(surface.session.part(), a2)).toBe('A2');
  });
});

describe('visually RTL table edit targets', () => {
  const rtl = TABLE_2X2.replace('<w:tbl>', '<w:tbl><w:tblPr><w:bidiVisual/></w:tblPr>');
  test('divider resize writes widths to the physical neighbors in canonical order', () => {
    const editor = mount(rtl);
    const surface = editor.surface!;
    const table = tableFragment(surface);
    const [first, second] = table.rows[0]!.cells;
    const target = tableColumnDividerResizeTargetOf(
      surface.layout(),
      surface.layout().revision,
      table.tableId,
      table.rows[0]!.id,
      false,
      second!.gridColumnId!,
      first!.gridColumnId!
    )!;
    const command = {
      type: 'commitTableColumnDividerResize' as const,
      target,
      leftWidthTwips: 4000,
      rightWidthTwips: 2000,
    };
    expect(editor.can(command).ok).toBe(true);
    expect(editor.exec(command).ok).toBe(true);
    const cells = tableFragment(surface).rows[0]!.cells;
    expect(cells[0]!.box.width).toBe(100);
    expect(cells[1]!.box.width).toBe(200);
    editor.destroy();
  });
  test('insert right and delete column use the selected logical cell', () => {
    const editor = mount(rtl);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    expect(editor.exec({ type: 'insertColumn', where: 'right' }).ok).toBe(true);
    let table = tableFragment(surface);
    const original = table.rows[0]!.cells.find((c) =>
      c.blocks.some(
        (b) => b.kind === 'paragraph' && b.lines.some((l) => l.spans.some((s) => s.text === 'A1'))
      )
    )!;
    expect(table.rows[0]!.cells[0]!.box.x).toBeGreaterThan(original.box.x);
    caret(surface, paragraphByText('A1', surface));
    expect(editor.exec({ type: 'deleteColumn' }).ok).toBe(true);
    table = tableFragment(surface);
    expect(table.rows[0]!.cells).toHaveLength(2);
    expect(table.rows[0]!.cells.some((c) => c.id === original.id)).toBe(false);
    editor.destroy();
  });
  test('border commands set and clear the requested visual side', () => {
    const editor = mount(rtl);
    const surface = editor.surface!;
    caret(surface, paragraphByText('A1', surface));
    expect(
      editor.exec({
        type: 'setTableBorders',
        scope: 'right',
        spec: { style: 'single', size: 8, color: { kind: 'hex', value: 'AA0000' } },
      }).ok
    ).toBe(true);
    expect(tableFragment(surface).rows[0]!.cells[0]!.borders?.right?.color).toBe('AA0000');
    expect(editor.exec({ type: 'setTableBorders', scope: 'none', target: 'right' }).ok).toBe(true);
    expect(tableFragment(surface).rows[0]!.cells[0]!.borders?.right).toBeUndefined();
    editor.destroy();
  });
});
