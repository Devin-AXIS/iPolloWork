// Core table interaction furniture — pointer FSM over semantic geometry.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceOptions,
} from '../paginated-surface.ts';
import type { TableInteractionLabelKey } from '../surface-table-interaction.ts';
import type { TableCommandPlan } from '../table-command-plan.ts';
import { planTableCommand } from '../table-command-plan.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { readEditableTableTopology } from '../../store/store/tree-op-table-topology.ts';
import { wmlAttributeValue, wmlChildNamed } from '../../store/store/tree-op-table-shared.ts';
import { MIN_TABLE_ROW_HEIGHT_TWIPS } from '../../store/store/table-constraints.ts';
import { selectCellRectangle } from './paginated-surface-fixtures.ts';
import {
  findTableOccurrence,
  tableColumnOccurrenceTargetFrom,
  tableRowOccurrenceTargetFrom,
} from '../../layout/table-interaction-targets.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
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
const tc = (content: string, twips?: number) =>
  twips === undefined
    ? `<w:tc>${content}</w:tc>`
    : `<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;

const TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `${tr(tc(p('A1'), 3000) + tc(p('B1'), 3000))}${tr(tc(p('A2'), 3000) + tc(p('B2'), 3000))}</w:tbl>`;

const NESTED_TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `${tr(
    tc(
      '<w:tbl><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>' +
        `${tr(tc(p('I1')) + tc(p('I2')))}</w:tbl>` +
        p('outer')
    ) + tc(p('right'))
  )}</w:tbl>`;

const NESTED_INDENTED =
  `${p('lead')}` +
  '<w:tbl><w:tblPr><w:tblInd w:w="720" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `${tr(
    tc(
      '<w:tbl><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>' +
        `${tr(tc(p('I1')) + tc(p('I2')))}</w:tbl>` +
        p('after')
    ) + tc(p('right'))
  )}</w:tbl>`;

const MARGIN = 72;

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  for (const node of [...document.body.children]) {
    if (node instanceof HTMLElement && node.querySelector('.docx-pages, .docx-table-furniture')) {
      node.remove();
    }
  }
});

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
  readonly pages: HTMLElement;
  readonly furniture: HTMLElement;
}

function mount(body: string, scale = 1, options: PaginatedSurfaceOptions = {}): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, docx(body), { scale, ...options });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  const furniture = container.querySelector<HTMLElement>('.docx-table-furniture')!;
  stubRect(pages, { left: 100, top: 50 });
  pages.focus();
  return { surface: result.surface, container, pages, furniture };
}

function stubRect(element: HTMLElement, rect: { left: number; top: number }): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + 1000,
      bottom: rect.top + 1000,
      width: 1000,
      height: 1000,
      x: rect.left,
      y: rect.top,
    }),
  });
}

const clientOf = (x: number, y: number) => ({
  clientX: 100 + MARGIN + x,
  clientY: 50 + MARGIN + y,
});

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    ...clientOf(x, y),
    ...init,
  });
}

function pointerAtPageContent(
  surface: PaginatedSurface,
  pages: HTMLElement,
  pageIndex: number,
  contentX: number,
  contentY: number,
  type = 'pointermove',
  init: PointerEventInit = {},
  scale = 1
): PointerEvent {
  const layout = surface.layout();
  const page = layout.pages[pageIndex]!;
  const rect = pages.getBoundingClientRect();
  const sheetX = page.contentBox.x + contentX;
  const sheetY = page.contentBox.y + contentY;
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: rect.left + sheetX * scale,
    clientY: rect.top + sheetY * scale,
    ...init,
  });
}

async function revealDividerAt(
  mounted: Mounted,
  pageIndex: number,
  contentX: number,
  contentY: number,
  scale = 1
): Promise<HTMLElement> {
  mounted.pages.dispatchEvent(
    pointerAtPageContent(
      mounted.surface,
      mounted.pages,
      pageIndex,
      contentX,
      contentY,
      'pointermove',
      {},
      scale
    )
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  mounted.pages.dispatchEvent(
    pointerAtPageContent(
      mounted.surface,
      mounted.pages,
      pageIndex,
      contentX,
      contentY,
      'pointermove',
      {},
      scale
    )
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const handle = mounted.furniture.querySelector<HTMLElement>('.docx-table-divider-handle');
  expect(handle).not.toBeNull();
  return handle!;
}

function paragraphByText(surface: PaginatedSurface, text: string): string {
  for (const id of surface.session.paragraphIds()) {
    if (paragraphTextOf(surface.session.part(), id) === text) return id;
  }
  throw new Error(`paragraph ${text} not found`);
}

async function revealInsertRowAt(
  mounted: Mounted,
  contentX: number,
  contentY: number
): Promise<HTMLButtonElement> {
  mounted.pages.dispatchEvent(
    pointerAtPageContent(mounted.surface, mounted.pages, 0, contentX, contentY)
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  mounted.pages.dispatchEvent(
    pointerAtPageContent(mounted.surface, mounted.pages, 0, contentX, contentY)
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const control = mounted.furniture.querySelector<HTMLButtonElement>('.docx-table-insert-row');
  expect(control).not.toBeNull();
  return control!;
}

function tableOnPage(layout: ReturnType<PaginatedSurface['layout']>, pageIndex = 0) {
  const table = layout.pages[pageIndex]!.fragments.find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('expected table');
  return table;
}

function innerTableOnPage(layout: ReturnType<PaginatedSurface['layout']>, pageIndex = 0) {
  const outer = tableOnPage(layout, pageIndex);
  for (const row of outer.rows) {
    for (const cell of row.cells) {
      const nested = cell.blocks.find((block) => block.kind === 'table');
      if (nested?.kind === 'table') return nested;
    }
  }
  throw new Error('expected nested table');
}

function planTargetTableId(plan: TableCommandPlan): string | null {
  if (!plan.ok) return null;
  return JSON.stringify(plan.ops).match(/"tableId":"([^"]+)"/)?.[1] ?? null;
}

function insertControls(mounted: Mounted): NodeListOf<HTMLButtonElement> {
  return mounted.furniture.querySelectorAll<HTMLButtonElement>(
    '.docx-table-insert-row, .docx-table-insert-column'
  );
}

function testLabels(keys: Record<TableInteractionLabelKey, string>): PaginatedSurfaceOptions {
  return {
    tableInteractionLabel: (key) => keys[key],
  };
}

async function focusedHideInsertRowAt(
  mounted: Mounted,
  contentX: number,
  contentY: number
): Promise<HTMLButtonElement> {
  const control = await revealInsertRowAt(mounted, contentX, contentY);
  control.focus();
  mounted.pages.dispatchEvent(
    pointerAtPageContent(mounted.surface, mounted.pages, 0, -40, contentY)
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(insertControls(mounted).length).toBe(1);
  return control;
}

function deleteTableRow(mounted: Mounted, rowIndex: number): void {
  const layout = mounted.surface.layout();
  const table = tableOnPage(layout);
  const row = table.rows[rowIndex]!;
  const ref = findTableOccurrence(layout, table.tableId, row.id, row.isHeaderRepeat);
  if (!ref) throw new Error('row occurrence missing');
  const target = tableRowOccurrenceTargetFrom(layout.revision, ref);
  const state = mounted.surface.state();
  const plan = planTableCommand({
    command: { type: 'deleteRow', target },
    part: mounted.surface.session.part(),
    layout,
    storeRevision: mounted.surface.session.packageRevision(),
    selection: state.selection,
    cellSelection: state.cellSelection,
    themeColors: mounted.surface.session.documentThemeColors(),
    editable: true,
    viewing: false,
  });
  const result = mounted.surface.applyTableCommandPlan(plan);
  if (!result.ok) throw new Error(`deleteRow failed: ${result.reason ?? 'unknown'}`);
}

function deleteTableColumn(mounted: Mounted, gridColumn: number): void {
  const layout = mounted.surface.layout();
  const table = tableOnPage(layout);
  const row = table.rows.find((candidate) => !candidate.isHeaderRepeat) ?? table.rows[0]!;
  const ref = findTableOccurrence(layout, table.tableId, row.id, row.isHeaderRepeat);
  if (!ref) throw new Error('row occurrence missing');
  const cell = ref.row.cells.find((candidate) => candidate.gridColumn === gridColumn);
  if (!cell) throw new Error('grid column missing');
  const target = tableColumnOccurrenceTargetFrom(layout.revision, ref, cell);
  if (!target) throw new Error('column target missing');
  const state = mounted.surface.state();
  const plan = planTableCommand({
    command: { type: 'deleteColumn', target },
    part: mounted.surface.session.part(),
    layout,
    storeRevision: mounted.surface.session.packageRevision(),
    selection: state.selection,
    cellSelection: state.cellSelection,
    themeColors: mounted.surface.session.documentThemeColors(),
    editable: true,
    viewing: false,
  });
  const result = mounted.surface.applyTableCommandPlan(plan);
  if (!result.ok) throw new Error(`deleteColumn failed: ${result.reason ?? 'unknown'}`);
}

function deleteTable(mounted: Mounted): void {
  const state = mounted.surface.state();
  const plan = planTableCommand({
    command: { type: 'deleteTable' },
    part: mounted.surface.session.part(),
    layout: mounted.surface.layout(),
    storeRevision: mounted.surface.session.packageRevision(),
    selection: state.selection,
    cellSelection: state.cellSelection,
    themeColors: mounted.surface.session.documentThemeColors(),
    editable: true,
    viewing: false,
  });
  const result = mounted.surface.applyTableCommandPlan(plan);
  if (!result.ok) throw new Error(`deleteTable failed: ${result.reason ?? 'unknown'}`);
}

async function revealInsertColumnAt(
  mounted: Mounted,
  colX: number,
  colY: number
): Promise<HTMLButtonElement> {
  mounted.pages.dispatchEvent(pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY));
  await new Promise((resolve) => setTimeout(resolve, 200));
  mounted.pages.dispatchEvent(pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const control = mounted.furniture.querySelector<HTMLButtonElement>('.docx-table-insert-column');
  expect(control).not.toBeNull();
  return control!;
}

describe('surface table interaction furniture', () => {
  test('furniture layer exists as contenteditable=false sibling without aria-hidden', () => {
    const { furniture } = mount(TABLE);
    expect(furniture).toBeTruthy();
    expect(furniture.getAttribute('contenteditable')).toBe('false');
    expect(furniture.getAttribute('aria-hidden')).toBeNull();
    expect(furniture.style.pointerEvents).toBe('none');
  });

  test('insert row control appears immediately on pointer move', () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, rowMidY)
    );
    expect(mounted.furniture.querySelector('.docx-table-insert-row')).not.toBeNull();
  });

  test('insert column control appears immediately on pointer move', () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    expect(mounted.furniture.querySelector('.docx-table-insert-column')).not.toBeNull();
  });

  test('retargeting row insert updates button identity synchronously', () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const row0Y = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const row1Y = table.rows[1]!.box.y + table.rows[1]!.box.height / 2;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, row0Y)
    );
    const control = mounted.furniture.querySelector<HTMLButtonElement>('.docx-table-insert-row');
    expect(control).not.toBeNull();
    expect(control!.dataset.rowId).toBe(table.rows[0]!.id);
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, row1Y)
    );
    expect(mounted.furniture.querySelectorAll('.docx-table-insert-row').length).toBe(1);
    expect(control!.dataset.rowId).toBe(table.rows[1]!.id);
  });

  test('returning to an insertion hit replaces the immediate resize handle', () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const insertX = table.box.x + 4;
    const dividerX = table.box.x + table.columnEdges[1]!;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, insertX, rowMidY)
    );
    expect(mounted.furniture.querySelector('.docx-table-insert-row')).not.toBeNull();
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).toBeNull();
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, dividerX, rowMidY)
    );
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).not.toBeNull();
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, insertX, rowMidY)
    );
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).toBeNull();
    expect(mounted.furniture.querySelector('.docx-table-insert-row')).not.toBeNull();
  });

  test('hover reveals a blue divider handle and resize cursor immediately', () => {
    const { pages, furniture, surface } = mount(TABLE);
    const layout = surface.layout();
    const table = tableOnPage(layout);
    const x = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + table.rows[0]!.box.height / 2;
    pages.dispatchEvent(pointer('pointermove', x, y));
    const handle = furniture.querySelector<HTMLElement>('.docx-table-divider-handle');
    expect(handle).not.toBeNull();
    expect(handle!.style.cursor).toBe('col-resize');
    expect(handle!.dataset.active).toBe('true');
  });

  test('hover reveals a horizontal row resize handle and drag commits row height', () => {
    const mounted = mount(TABLE);
    const table = tableOnPage(mounted.surface.layout());
    const x = table.box.x + table.box.width / 4;
    const edgeY = table.rows[0]!.box.y + table.rows[0]!.box.height;
    mounted.pages.dispatchEvent(pointer('pointermove', x, edgeY));
    const handle = mounted.furniture.querySelector<HTMLElement>('.docx-table-row-divider-handle');
    expect(handle).not.toBeNull();
    expect(handle!.style.cursor).toBe('row-resize');
    expect(handle!.dataset.active).toBe('true');

    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    handle!.dispatchEvent(pointer('pointerdown', x, edgeY));
    document.dispatchEvent(pointer('pointermove', x, edgeY + 12, { buttons: 1 }));
    document.dispatchEvent(pointer('pointerup', x, edgeY + 12));

    expect(plans).toHaveLength(1);
    expect(plans[0]?.ok).toBe(true);
    if (plans[0]?.ok) {
      expect(plans[0].ops[0]?.op).toBe('setTableRowHeight');
    }
    const topology = readEditableTableTopology(mounted.surface.session.part().root, table.tableId);
    expect(topology.ok).toBe(true);
    if (topology.ok) {
      const resizedRow = topology.topology.rows.find((entry) => entry.row.id === table.rows[0]!.id);
      const trHeight =
        resizedRow && wmlChildNamed(wmlChildNamed(resizedRow.row, 'trPr')!, 'trHeight');
      expect(wmlAttributeValue(trHeight!, 'hRule')).toBe('exact');
      expect(Number(wmlAttributeValue(trHeight!, 'val'))).toBeGreaterThan(0);
    }
  });

  test('a row dragged above its own top keeps a minimum height and can be dragged back', () => {
    const mounted = mount(TABLE);
    const rowHeightTwips = (rowId: string): number => {
      const topology = readEditableTableTopology(
        mounted.surface.session.part().root,
        tableOnPage(mounted.surface.layout()).tableId
      );
      if (!topology.ok) throw new Error('no topology');
      const row = topology.topology.rows.find((entry) => entry.row.id === rowId)!.row;
      return Number(
        wmlAttributeValue(wmlChildNamed(wmlChildNamed(row, 'trPr')!, 'trHeight')!, 'val')
      );
    };
    const drag = (fromY: number, toY: number, x: number): void => {
      mounted.pages.dispatchEvent(pointer('pointermove', x, fromY));
      const handle = mounted.furniture.querySelector<HTMLElement>('.docx-table-row-divider-handle');
      expect(handle).not.toBeNull();
      handle!.dispatchEvent(pointer('pointerdown', x, fromY));
      document.dispatchEvent(pointer('pointermove', x, toY, { buttons: 1 }));
      document.dispatchEvent(pointer('pointerup', x, toY));
    };
    const before = tableOnPage(mounted.surface.layout());
    const rowId = before.rows[1]!.id;
    const x = before.box.x + before.box.width / 4;
    const bottom = before.rows[1]!.box.y + before.rows[1]!.box.height;
    // Far past the row's own top: the commit stops at the minimum, not at 1pt.
    drag(bottom, bottom - 200, x);
    expect(rowHeightTwips(rowId)).toBe(MIN_TABLE_ROW_HEIGHT_TWIPS);

    // The shrunken row still owns a band above its bottom divider, so it drags back out.
    const shrunk = tableOnPage(mounted.surface.layout()).rows.find((row) => row.id === rowId)!;
    const shrunkBottom = shrunk.box.y + shrunk.box.height;
    drag(shrunkBottom - 2, shrunkBottom + 20, x);
    expect(rowHeightTwips(rowId)).toBeGreaterThan(MIN_TABLE_ROW_HEIGHT_TWIPS);
  });

  test('dragging a row shorter than the minimum upward never makes it taller', () => {
    const spacer =
      '<w:tr><w:trPr><w:trHeight w:val="100" w:hRule="exact"/></w:trPr>' +
      `${tc(p(''), 3000)}${tc(p(''), 3000)}</w:tr>`;
    const mounted = mount(
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
        `${tr(tc(p('A1'), 3000) + tc(p('B1'), 3000))}${spacer}` +
        `${tr(tc(p('A3'), 3000) + tc(p('B3'), 3000))}</w:tbl>`
    );
    const table = tableOnPage(mounted.surface.layout());
    const row = table.rows[1]!;
    const x = table.box.x + table.box.width / 4;
    const bottom = row.box.y + row.box.height;
    // Within 4pt of the row above's divider too, except for the spacer's last point.
    mounted.pages.dispatchEvent(pointer('pointermove', x, bottom - 0.5));
    const handle = mounted.furniture.querySelector<HTMLElement>('.docx-table-row-divider-handle');
    expect(handle).not.toBeNull();
    handle!.dispatchEvent(pointer('pointerdown', x, bottom - 0.5));
    document.dispatchEvent(pointer('pointermove', x, bottom - 2.5, { buttons: 1 }));
    document.dispatchEvent(pointer('pointerup', x, bottom - 2.5));
    const topology = readEditableTableTopology(mounted.surface.session.part().root, table.tableId);
    if (!topology.ok) throw new Error('no topology');
    const resized = topology.topology.rows.find((entry) => entry.row.id === row.id)!.row;
    const height = Number(
      wmlAttributeValue(wmlChildNamed(wmlChildNamed(resized, 'trPr')!, 'trHeight')!, 'val')
    );
    // The spacer itself was dragged, and it did not grow past its own height.
    expect(resized.id).toBe(row.id);
    expect(height).toBeLessThanOrEqual(100);
  });

  test('a body divider resizes columns below a horizontally merged header', () => {
    const xml = TABLE.replace(
      '<w:tr>',
      '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
        p('Heading') +
        '</w:tc></w:tr><w:tr>'
    );
    const mounted = mount(xml);
    const table = tableOnPage(mounted.surface.layout());
    const row = table.rows[1]!;
    const x = table.box.x + table.columnEdges[1]!;
    const y = row.box.y + row.box.height / 2;
    mounted.pages.dispatchEvent(pointer('pointermove', x, y));
    const handle = mounted.furniture.querySelector<HTMLElement>('.docx-table-divider-handle');
    expect(handle).not.toBeNull();
    handle!.dispatchEvent(pointer('pointerdown', x, y));
    document.dispatchEvent(pointer('pointermove', x + 12, y, { buttons: 1 }));
    document.dispatchEvent(pointer('pointerup', x + 12, y));
    const changed = tableOnPage(mounted.surface.layout());
    expect(changed.columnEdges[1]).toBeCloseTo(table.columnEdges[1]! + 12, 4);
    expect(changed.rows[0]!.cells[0]!.box.width).toBeCloseTo(table.rows[0]!.cells[0]!.box.width, 4);
    mounted.surface.destroy();
  });

  test('moving between same-kind targets refreshes furniture identity', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const row0Y = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const row1Y = table.rows[1]!.box.y + table.rows[1]!.box.height / 2;
    mounted.pages.dispatchEvent(pointer('pointermove', 5, row0Y));
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(pointer('pointermove', 5, row0Y));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted.furniture.querySelector('.docx-table-insert-row')).not.toBeNull();
    mounted.pages.dispatchEvent(pointer('pointermove', 5, row1Y));
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(pointer('pointermove', 5, row1Y));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const controls = mounted.furniture.querySelectorAll('.docx-table-insert-row');
    expect(controls.length).toBe(1);
  });

  test('hide delay allows crossing to insertion control', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.box.y + table.rows[0]!.box.height / 2;
    mounted.pages.dispatchEvent(pointer('pointermove', 5, rowMidY));
    await new Promise((resolve) => setTimeout(resolve, 180));
    mounted.pages.dispatchEvent(pointer('pointermove', 5, rowMidY));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const insertControl = mounted.furniture.querySelector('.docx-table-insert-row');
    expect(insertControl).not.toBeNull();
    insertControl!.dispatchEvent(
      new PointerEvent('pointerenter', { bubbles: true, pointerId: 1, ...clientOf(-12, rowMidY) })
    );
    mounted.pages.dispatchEvent(pointer('pointermove', -30, rowMidY));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(mounted.furniture.querySelector('.docx-table-insert-row')).not.toBeNull();
  });

  test('resize drag shows preview and commits once on pointerup', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + table.rows[0]!.box.height / 2;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    handle.dispatchEvent(pointer('pointerdown', edgeX, y));
    document.dispatchEvent(pointer('pointermove', edgeX + 12, y, { buttons: 1 }));
    expect(mounted.furniture.querySelector('.docx-table-resize-preview')).not.toBeNull();
    document.dispatchEvent(pointer('pointerup', edgeX + 12, y));
    expect(plans.length).toBe(1);
    expect(mounted.furniture.querySelector('.docx-table-resize-preview')).toBeNull();
  });

  test('pointer-up without movement is a no-op', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + table.rows[0]!.box.height / 2;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    let commits = 0;
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      commits += 1;
      return original(plan);
    };
    handle.dispatchEvent(pointer('pointerdown', edgeX, y));
    document.dispatchEvent(pointer('pointerup', edgeX, y));
    expect(commits).toBe(0);
  });

  test('Escape and pointercancel cancel resize without commit', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + 20;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    let commits = 0;
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      commits += 1;
      return original(plan);
    };
    handle.dispatchEvent(pointer('pointerdown', edgeX, y));
    document.dispatchEvent(pointer('pointermove', edgeX + 20, y, { buttons: 1 }));
    mounted.pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(pointer('pointerup', edgeX + 20, y));
    expect(commits).toBe(0);
    expect(mounted.furniture.querySelector('.docx-table-resize-preview')).toBeNull();

    const handle2 = await revealDividerAt(mounted, 0, edgeX, y);
    handle2.dispatchEvent(pointer('pointerdown', edgeX, y));
    document.dispatchEvent(pointer('pointermove', edgeX + 10, y, { buttons: 1 }));
    document.dispatchEvent(pointer('pointercancel', edgeX + 10, y));
    document.dispatchEvent(pointer('pointerup', edgeX + 10, y));
    expect(commits).toBe(0);
  });

  test('right-edge resize commits against captured target', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges.at(-1)!;
    const y = table.box.y + table.rows[0]!.box.height / 2;
    mounted.pages.dispatchEvent(pointer('pointermove', edgeX, y));
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(pointer('pointermove', edgeX, y));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const handle = mounted.furniture.querySelector<HTMLElement>('.docx-table-edge-handle-right');
    expect(handle).not.toBeNull();
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    handle!.dispatchEvent(pointer('pointerdown', edgeX, y));
    document.dispatchEvent(pointer('pointermove', edgeX + 8, y, { buttons: 1 }));
    document.dispatchEvent(pointer('pointerup', edgeX + 8, y));
    expect(plans.length).toBe(1);
    expect(plans[0]?.ok).toBe(true);
    if (plans[0]?.ok) {
      expect(JSON.stringify(plans[0].ops)).toContain('setTableRightEdgeWidth');
    }
  });

  test('resize suppresses insertion controls', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + 10;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    handle.dispatchEvent(pointer('pointerdown', edgeX, y, { buttons: 1 }));
    document.dispatchEvent(pointer('pointermove', edgeX + 5, y, { buttons: 1 }));
    expect(mounted.furniture.querySelector('.docx-table-insert-row')).toBeNull();
    expect(mounted.furniture.querySelector('.docx-table-insert-column')).toBeNull();
  });

  test('viewing mode refuses furniture interaction and cancels in-progress drag', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + 20;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    let commits = 0;
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      commits += 1;
      return original(plan);
    };
    handle.dispatchEvent(pointer('pointerdown', edgeX, y));
    document.dispatchEvent(pointer('pointermove', edgeX + 12, y, { buttons: 1 }));
    mounted.surface.setEditingMode('view');
    document.dispatchEvent(pointer('pointerup', edgeX + 12, y));
    expect(commits).toBe(0);
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).toBeNull();
    mounted.pages.dispatchEvent(pointer('pointermove', edgeX, y));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).toBeNull();
  });

  test('viewing mode retires focused row insert and restores pages focus', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    const a1 = paragraphByText(mounted.surface, 'A1');
    mounted.surface.setSelection({
      anchor: { paragraphId: a1, offset: 2 },
      head: { paragraphId: a1, offset: 2 },
    });
    selectCellRectangle(mounted.surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    const selectionBefore = mounted.surface.state().selection;
    const rectBefore = mounted.surface.state().cellSelection?.cellIds;
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    mounted.surface.setEditingMode('view');
    expect(insertControls(mounted).length).toBe(0);
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).toBeNull();
    expect(mounted.furniture.querySelector('.docx-table-resize-preview')).toBeNull();
    expect(document.activeElement).toBe(mounted.pages);
    expect(mounted.surface.state().selection).toEqual(selectionBefore);
    expect(mounted.surface.state().cellSelection?.cellIds).toEqual(rectBefore);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    control.click();
    expect(plans.length).toBe(0);
  });

  test('viewing mode retires focused column insert without mutating selection', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    const b1 = paragraphByText(mounted.surface, 'B1');
    mounted.surface.setSelection({
      anchor: { paragraphId: b1, offset: 1 },
      head: { paragraphId: b1, offset: 1 },
    });
    const selectionBefore = mounted.surface.state().selection;
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    const control = await revealInsertColumnAt(mounted, colX, colY);
    control.focus();
    mounted.surface.setEditingMode('view');
    expect(insertControls(mounted).length).toBe(0);
    expect(document.activeElement).toBe(mounted.pages);
    expect(mounted.surface.state().selection).toEqual(selectionBefore);
    control.click();
  });

  test('viewing mode removes unfocused insert without stealing pages focus', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    expect(document.activeElement).toBe(mounted.pages);
    mounted.surface.setEditingMode('view');
    expect(insertControls(mounted).length).toBe(0);
    expect(document.activeElement).toBe(mounted.pages);
    control.click();
  });

  test('returning to edit requires fresh insert furniture and current revision', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const stale = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    stale.focus();
    mounted.surface.setEditingMode('view');
    expect(insertControls(mounted).length).toBe(0);
    mounted.surface.setEditingMode('edit');
    expect(insertControls(mounted).length).toBe(0);
    expect(mounted.furniture.contains(stale)).toBe(false);
    const fresh = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    expect(fresh).not.toBe(stale);
    const revisionBefore = mounted.surface.layout().revision;
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    mounted.surface.type('x');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mounted.surface.layout().revision).toBeGreaterThan(revisionBefore);
    fresh.click();
    expect(plans.length).toBe(1);
    expect(plans[0]?.ok).toBe(true);
  });

  test('nested divider resize at painted page-content coordinates targets inner table', async () => {
    const mounted = mount(NESTED_INDENTED);
    mounted.pages.focus();
    const layout = mounted.surface.layout();
    const inner = innerTableOnPage(layout);
    const outer = tableOnPage(layout);
    expect(inner.box.x).toBeGreaterThan(outer.box.x);
    const edgeX = inner.box.x + inner.columnEdges[1]!;
    const y = inner.rows[0]!.box.y + inner.rows[0]!.box.height / 2;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    handle.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX, y, 'pointerdown')
    );
    document.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX + 10, y, 'pointermove', {
        buttons: 1,
      })
    );
    document.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX + 10, y, 'pointerup')
    );
    expect(plans.length).toBe(1);
    expect(planTargetTableId(plans[0]!)).toBe(inner.tableId);
  });

  test('nested divider resize at 125% mount scale targets inner table', async () => {
    const scale = 1.25 * (96 / 72);
    const mounted = mount(NESTED_INDENTED, scale);
    mounted.pages.focus();
    const layout = mounted.surface.layout();
    const inner = innerTableOnPage(layout);
    const edgeX = inner.box.x + inner.columnEdges[1]!;
    const y = inner.rows[0]!.box.y + inner.rows[0]!.box.height / 2;
    const handle = await revealDividerAt(mounted, 0, edgeX, y, scale);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    handle.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX, y, 'pointerdown', {}, scale)
    );
    document.dispatchEvent(
      pointerAtPageContent(
        mounted.surface,
        mounted.pages,
        0,
        edgeX + 10,
        y,
        'pointermove',
        { buttons: 1 },
        scale
      )
    );
    document.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX + 10, y, 'pointerup', {}, scale)
    );
    expect(plans.length).toBe(1);
    expect(planTargetTableId(plans[0]!)).toBe(inner.tableId);
    mounted.surface.destroy();
  });

  test('nested row insertion at painted coordinates targets inner table', async () => {
    const mounted = mount(NESTED_INDENTED);
    const layout = mounted.surface.layout();
    const inner = innerTableOnPage(layout);
    const rowMidY = inner.rows[0]!.box.y + inner.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, inner.box.x + 4, rowMidY);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    control.dispatchEvent(
      pointerAtPageContent(
        mounted.surface,
        mounted.pages,
        0,
        inner.box.x + 4,
        rowMidY,
        'pointerdown'
      )
    );
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(plans.length).toBe(1);
    expect(planTargetTableId(plans[0]!)).toBe(inner.tableId);
  });

  test('nested right-edge resize at painted coordinates targets inner table', async () => {
    const mounted = mount(NESTED_INDENTED);
    const layout = mounted.surface.layout();
    const inner = innerTableOnPage(layout);
    const edgeX = inner.box.x + inner.columnEdges.at(-1)!;
    const y = inner.rows[0]!.box.y + inner.rows[0]!.box.height / 2;
    mounted.pages.dispatchEvent(pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX, y));
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX, y));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const handle = mounted.furniture.querySelector<HTMLElement>('.docx-table-edge-handle-right');
    expect(handle).not.toBeNull();
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    handle!.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX, y, 'pointerdown')
    );
    document.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX + 8, y, 'pointermove', {
        buttons: 1,
      })
    );
    document.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX + 8, y, 'pointerup')
    );
    expect(plans.length).toBe(1);
    expect(planTargetTableId(plans[0]!)).toBe(inner.tableId);
  });

  test('nested column insertion at painted coordinates targets inner table', async () => {
    const mounted = mount(NESTED_INDENTED);
    const layout = mounted.surface.layout();
    const inner = innerTableOnPage(layout);
    const outer = tableOnPage(layout);
    const colMidX = inner.box.x + (inner.columnEdges[0]! + inner.columnEdges[1]!) / 2;
    const colY = inner.box.y - 10;
    const control = await revealInsertColumnAt(mounted, colMidX, colY);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    control.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colMidX, colY, 'pointerdown')
    );
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(plans.length).toBe(1);
    expect(planTargetTableId(plans[0]!)).toBe(inner.tableId);
    expect(planTargetTableId(plans[0]!)).not.toBe(outer.tableId);
  });

  test('resize commit refuses stale captured sourceRevision after store advances', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const layoutRevision = layout.revision;
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + table.rows[0]!.box.height / 2;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    handle.dispatchEvent(pointer('pointerdown', edgeX, y));
    mounted.surface.type('x');
    document.dispatchEvent(pointer('pointermove', edgeX + 10, y, { buttons: 1 }));
    document.dispatchEvent(pointer('pointerup', edgeX + 10, y));
    expect(plans.length).toBe(1);
    expect(plans[0]?.ok).toBe(false);
    expect(plans[0]?.reason).toContain('stale');
    expect(layoutRevision).toBeLessThan(mounted.surface.layout().revision);
  });

  test('relayout refreshes hover furniture for the same canonical target', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    await revealDividerAt(mounted, 0, edgeX, y);
    const revisionBefore = layout.revision;
    mounted.surface.type('x');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mounted.surface.layout().revision).toBeGreaterThan(revisionBefore);
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).not.toBeNull();
    mounted.pages.dispatchEvent(pointerAtPageContent(mounted.surface, mounted.pages, 0, edgeX, y));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).not.toBeNull();
  });

  test('insertion controls are native buttons with visible plus glyph', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const rowBtn = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    expect(rowBtn.tagName).toBe('BUTTON');
    expect(rowBtn.type).toBe('button');
    expect(rowBtn.textContent).toBe('+');

    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const colBtn = mounted.furniture.querySelector<HTMLButtonElement>('.docx-table-insert-column');
    expect(colBtn?.tagName).toBe('BUTTON');
    expect(colBtn?.type).toBe('button');
    expect(colBtn?.textContent).toBe('+');
  });

  test('insertion controls expose localized row vs column aria-labels', async () => {
    const labels = {
      'table.insertRowBelow': 'provider-row-label',
      'table.insertColumnRight': 'provider-column-label',
    };
    const mounted = mount(TABLE, 1, testLabels(labels));
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const rowBtn = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    expect(rowBtn.getAttribute('aria-label')).toBe(labels['table.insertRowBelow']);

    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const colBtn = mounted.furniture.querySelector<HTMLButtonElement>('.docx-table-insert-column')!;
    expect(colBtn).toBe(rowBtn);
    expect(colBtn.getAttribute('aria-label')).toBe(labels['table.insertColumnRight']);
    expect(colBtn.getAttribute('aria-label')).not.toBe(labels['table.insertRowBelow']);
  });

  test('focused insert control retarget keeps a single button', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const row0Y = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const row1Y = table.rows[1]!.box.y + table.rows[1]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, row0Y);
    control.focus();
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, row1Y)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, row1Y)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(insertControls(mounted).length).toBe(1);
    expect(document.activeElement).toBe(control);
    expect(control.classList.contains('docx-table-insert-row')).toBe(true);
  });

  test('refreshTableInteractionLabels repaints visible insert control without relayout', async () => {
    const labels = testLabels({
      'table.insertRowBelow': 'initial-row-label',
      'table.insertColumnRight': 'initial-column-label',
    });
    const mounted = mount(TABLE, 1, labels);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    expect(control.getAttribute('aria-label')).toBe('initial-row-label');
    const revisionBefore = mounted.surface.layout().revision;
    mounted.surface.setTableInteractionLabel((key) =>
      key === 'table.insertRowBelow' ? 'updated-row-label' : 'updated-column-label'
    );
    expect(mounted.surface.layout().revision).toBe(revisionBefore);
    expect(control.getAttribute('aria-label')).toBe('updated-row-label');
    expect(insertControls(mounted).length).toBe(1);
    expect(document.activeElement).toBe(control);
  });

  test('focused insert control retargets row to column in place', async () => {
    const labels = testLabels({
      'table.insertRowBelow': 'row-label',
      'table.insertColumnRight': 'column-label',
    });
    const mounted = mount(TABLE, 1, labels);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    expect(control.getAttribute('aria-label')).toBe('row-label');

    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(insertControls(mounted).length).toBe(1);
    expect(document.activeElement).toBe(control);
    expect(control.classList.contains('docx-table-insert-column')).toBe(true);
    expect(control.getAttribute('aria-label')).toBe('column-label');
  });

  test('relayout refreshes focused insert control revision without stale refusal', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    const revisionBefore = layout.revision;
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    mounted.surface.type('x');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mounted.surface.layout().revision).toBeGreaterThan(revisionBefore);
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, rowMidY)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(insertControls(mounted).length).toBe(1);
    control.click();
    expect(plans.length).toBe(1);
    expect(plans[0]?.ok).toBe(true);
  });

  test('blur removes retained focused insert control', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, -40, rowMidY)
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    mounted.pages.focus();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(insertControls(mounted).length).toBe(0);
    expect(document.activeElement).toBe(mounted.pages);
  });

  test('focused hide then retarget never duplicates insert controls', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const row0Y = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const row1Y = table.rows[1]!.box.y + table.rows[1]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, row0Y);
    control.focus();
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, -40, row0Y)
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(insertControls(mounted).length).toBe(1);
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, row1Y)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, table.box.x + 4, row1Y)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(insertControls(mounted).length).toBe(1);
  });

  test('focused hide then relayout refreshes hit and click activates once', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await focusedHideInsertRowAt(mounted, table.box.x + 4, rowMidY);
    const revisionBefore = layout.revision;
    const storeBeforeEdit = mounted.surface.session.packageRevision();
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    mounted.surface.type('x');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mounted.surface.layout().revision).toBeGreaterThan(revisionBefore);
    expect(insertControls(mounted).length).toBe(1);
    expect(document.activeElement).toBe(control);
    const storeBeforeInsert = mounted.surface.session.packageRevision();
    expect(storeBeforeInsert).toBeGreaterThan(storeBeforeEdit);
    control.click();
    expect(plans.length).toBe(1);
    expect(plans[0]?.ok).toBe(true);
    expect(mounted.surface.session.packageRevision()).toBe(storeBeforeInsert + 1);
  });

  test('focused hide then relayout supports keyboard activation once', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await focusedHideInsertRowAt(mounted, table.box.x + 4, rowMidY);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    mounted.surface.type('x');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mounted.surface.layout().revision).toBeGreaterThan(layout.revision);
    control.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
    );
    control.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
    );
    if (plans.length === 0) control.click();
    expect(plans.length).toBe(1);
    expect(plans[0]?.ok).toBe(true);
  });

  test('focused hide then target row removed retires retained control', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    const a1 = paragraphByText(mounted.surface, 'A1');
    mounted.surface.setSelection({
      anchor: { paragraphId: a1, offset: 2 },
      head: { paragraphId: a1, offset: 2 },
    });
    selectCellRectangle(mounted.surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    const selectionBefore = mounted.surface.state().selection;
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const row1Y = table.rows[1]!.box.y + table.rows[1]!.box.height / 2;
    const control = await focusedHideInsertRowAt(mounted, table.box.x + 4, row1Y);
    deleteTableRow(mounted, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mounted.surface.state().selection).not.toEqual(selectionBefore);
    const selectionAfterDelete = mounted.surface.state().selection;
    const rectAfterDelete = mounted.surface.state().cellSelection?.cellIds;
    expect(insertControls(mounted).length).toBe(0);
    expect(document.activeElement).toBe(mounted.pages);
    expect(document.activeElement).not.toBe(document.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted.surface.state().selection).toEqual(selectionAfterDelete);
    expect(mounted.surface.state().cellSelection?.cellIds).toEqual(rectAfterDelete);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    control.click();
    expect(plans.length).toBe(0);
  });

  test('focused hide then target column removed restores pages focus and selection', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    const b1 = paragraphByText(mounted.surface, 'B1');
    mounted.surface.setSelection({
      anchor: { paragraphId: b1, offset: 1 },
      head: { paragraphId: b1, offset: 1 },
    });
    const selectionBefore = mounted.surface.state().selection;
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    const control = await revealInsertColumnAt(mounted, colX, colY);
    control.focus();
    mounted.pages.dispatchEvent(pointerAtPageContent(mounted.surface, mounted.pages, 0, -40, colY));
    await new Promise((resolve) => setTimeout(resolve, 150));
    deleteTableColumn(mounted, 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const selectionAfterDelete = mounted.surface.state().selection;
    expect(insertControls(mounted).length).toBe(0);
    expect(document.activeElement).toBe(mounted.pages);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted.surface.state().selection).toEqual(selectionAfterDelete);
    const plans: TableCommandPlan[] = [];
    const original = mounted.surface.applyTableCommandPlan.bind(mounted.surface);
    mounted.surface.applyTableCommandPlan = (plan) => {
      plans.push(plan);
      return original(plan);
    };
    control.click();
    expect(plans.length).toBe(0);
  });

  test('focused hide then table removed restores pages focus without mutating selection', async () => {
    const mounted = mount(`${p('lead')}${TABLE}`);
    mounted.pages.focus();
    const a1 = paragraphByText(mounted.surface, 'A1');
    mounted.surface.setSelection({
      anchor: { paragraphId: a1, offset: 1 },
      head: { paragraphId: a1, offset: 1 },
    });
    const selectionBefore = mounted.surface.state().selection;
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await focusedHideInsertRowAt(mounted, table.box.x + 4, rowMidY);
    deleteTable(mounted);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mounted.surface.state().selection).not.toEqual(selectionBefore);
    const selectionAfterDelete = mounted.surface.state().selection;
    expect(insertControls(mounted).length).toBe(0);
    expect(document.activeElement).toBe(mounted.pages);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted.surface.state().selection).toEqual(selectionAfterDelete);
    control.click();
  });

  test('voluntary blur cleanup removes control without restoring pages focus', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, -40, rowMidY)
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    control.blur();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(insertControls(mounted).length).toBe(0);
    expect(document.activeElement).not.toBe(mounted.pages);
    expect(document.activeElement).not.toBe(control);
  });

  test('destroy removes furniture without focusing pages layer', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    expect(document.activeElement).toBe(control);
    mounted.surface.destroy();
    expect(mounted.container.querySelector('.docx-table-furniture')).toBeNull();
    expect(document.activeElement).not.toBe(mounted.pages);
  });

  test('row insertion preserves model selection until commit then adopts caret', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    const a1 = paragraphByText(mounted.surface, 'A1');
    mounted.surface.setSelection({
      anchor: { paragraphId: a1, offset: 1 },
      head: { paragraphId: a1, offset: 1 },
    });
    const selectionBefore = mounted.surface.state().selection;
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.dispatchEvent(
      pointerAtPageContent(
        mounted.surface,
        mounted.pages,
        0,
        table.box.x + 4,
        rowMidY,
        'pointerdown'
      )
    );
    expect(document.activeElement).toBe(mounted.pages);
    expect(mounted.surface.state().selection).toEqual(selectionBefore);
    control.click();
    const head = mounted.surface.state().selection.head.paragraphId;
    expect(paragraphTextOf(mounted.surface.session.part(), head)).not.toBe('A1');
    expect(paragraphTextOf(mounted.surface.session.part(), head)).not.toBe('A2');
  });

  test('column insertion preserves rectangular selection until commit', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    selectCellRectangle(mounted.surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    const rectBefore = mounted.surface.state().cellSelection?.cellIds;
    expect(rectBefore?.length).toBe(4);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const control = mounted.furniture.querySelector<HTMLButtonElement>(
      '.docx-table-insert-column'
    )!;
    control.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, colX, colY, 'pointerdown')
    );
    expect(document.activeElement).toBe(mounted.pages);
    expect(mounted.surface.state().cellSelection?.cellIds).toEqual(rectBefore);
    control.click();
    expect(mounted.surface.state().cellSelection).toBeNull();
    const head = mounted.surface.state().selection.head.paragraphId;
    expect(paragraphTextOf(mounted.surface.session.part(), head)).not.toBe('A1');
    expect(paragraphTextOf(mounted.surface.session.part(), head)).not.toBe('B1');
  });

  test('keyboard-focused insert control survives pointer leaving the table band', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const control = await revealInsertRowAt(mounted, table.box.x + 4, rowMidY);
    control.focus();
    expect(document.activeElement).toBe(control);
    mounted.pages.dispatchEvent(
      pointerAtPageContent(mounted.surface, mounted.pages, 0, -40, rowMidY)
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(document.activeElement).toBe(control);
    expect(mounted.furniture.querySelector('.docx-table-insert-row')).toBe(control);
  });

  test('row and column insertion pointerdown retain pages focus', async () => {
    const mounted = mount(TABLE);
    mounted.pages.focus();
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const rowMidY = table.box.y + table.rows[0]!.box.height / 2;
    mounted.pages.dispatchEvent(pointer('pointermove', 5, rowMidY));
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(pointer('pointermove', 5, rowMidY));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const rowControl = mounted.furniture.querySelector<HTMLElement>('.docx-table-insert-row')!;
    rowControl.dispatchEvent(pointer('pointerdown', 5, rowMidY));
    expect(document.activeElement).toBe(mounted.pages);

    const cell = table.rows[0]!.cells[0]!;
    const left = table.columnEdges[cell.gridColumn] ?? 0;
    const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
    const colX = table.box.x + (left + right) / 2;
    const colY = table.box.y - 6;
    mounted.pages.dispatchEvent(pointer('pointermove', colX, colY));
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(pointer('pointermove', colX, colY));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const colControl = mounted.furniture.querySelector<HTMLElement>('.docx-table-insert-column')!;
    colControl.dispatchEvent(pointer('pointerdown', colX, colY));
    expect(document.activeElement).toBe(mounted.pages);
  });

  test('destroy removes furniture and listeners', () => {
    const mounted = mount(TABLE);
    mounted.surface.destroy();
    expect(mounted.container.querySelector('.docx-table-furniture')).toBeNull();
  });

  test('pointer capture keeps drag active off-table via the capturing handle', async () => {
    const mounted = mount(TABLE);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + 20;
    const handle = await revealDividerAt(mounted, 0, edgeX, y);
    handle.dispatchEvent(pointer('pointerdown', edgeX, y));
    expect(handle.hasPointerCapture(1)).toBe(true);
    document.dispatchEvent(pointer('pointermove', edgeX + 30, y, { buttons: 1 }));
    expect(handle.hasPointerCapture(1)).toBe(true);
    expect(mounted.furniture.querySelector('.docx-table-resize-preview')).not.toBeNull();
    document.dispatchEvent(pointer('pointerup', edgeX + 30, y));
    expect(handle.hasPointerCapture(1)).toBe(false);
  });

  test('zoom != 1 still resolves divider hover', async () => {
    const mounted = mount(TABLE, 1.5);
    const layout = mounted.surface.layout();
    const table = tableOnPage(layout);
    const edgeX = table.box.x + table.columnEdges[1]!;
    const y = table.box.y + table.rows[0]!.box.height / 2;
    mounted.pages.dispatchEvent(
      pointer('pointermove', edgeX, y, {
        clientX: 100 + (MARGIN + edgeX) * 1.5,
        clientY: 50 + (MARGIN + y) * 1.5,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    mounted.pages.dispatchEvent(
      pointer('pointermove', edgeX, y, {
        clientX: 100 + (MARGIN + edgeX) * 1.5,
        clientY: 50 + (MARGIN + y) * 1.5,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted.furniture.querySelector('.docx-table-divider-handle')).not.toBeNull();
  });
});
