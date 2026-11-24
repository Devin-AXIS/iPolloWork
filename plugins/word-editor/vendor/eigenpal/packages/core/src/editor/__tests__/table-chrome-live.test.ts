// Task 9 fix round 1 — live execution and command-state evidence for table chrome.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  DEFAULT_TABLE_CHROME_DRAFT,
  applyTableChromePick,
  type TableChromeDraft,
} from '../table-chrome.ts';
import {
  runTableChromeCommand,
  tableChromeToolbarState,
  tableCommandToolbarState,
} from '../toolbar-commands.ts';
import { tableRowOccurrenceTargetFrom } from '../../layout/table-interaction-targets.ts';
import { visitTableOccurrences } from '../../layout/table-interaction-targets.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { MAX_TABLE_COLUMNS } from '../../store/store/table-constraints.ts';
import { CHROME_GROUPS, chromeSlotId } from '../chrome-controls.ts';
import { GENERATED_ICON_PATHS } from '../generated-icon-paths.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TABLE_2X2 =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

const liveEditors: DocxEditorInstance[] = [];

afterEach(() => {
  while (liveEditors.length > 0) {
    liveEditors.pop()?.destroy();
  }
  document.getSelection()?.removeAllRanges();
  for (const node of [...document.body.children]) {
    if (node instanceof HTMLElement && node.querySelector('.docx-pages')) {
      node.remove();
    }
  }
});

function mount(body: string): DocxEditorInstance {
  const doc = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: doc });
  if (!editor.surface) throw new Error('surface failed to mount');
  liveEditors.push(editor);
  return editor;
}

function paragraphByText(editor: DocxEditorInstance, text: string): string {
  for (const id of editor.surface!.session.paragraphIds()) {
    if (paragraphTextOf(editor.surface!.session.part(), id) === text) return id;
  }
  throw new Error(`paragraph ${text} not found`);
}

function caret(editor: DocxEditorInstance, paragraphId: string): void {
  editor.surface!.setSelection({
    head: { paragraphId, offset: 1 },
    anchor: { paragraphId, offset: 1 },
  });
}

function assertChromeParity(
  editor: DocxEditorInstance,
  slot: Parameters<typeof tableChromeToolbarState>[1],
  value: unknown,
  draft: TableChromeDraft
): void {
  const pick = applyTableChromePick(draft, slot, value);
  expect(pick).not.toBeNull();
  const can = editor.can(pick!.command);
  const state = tableChromeToolbarState(editor, slot, draft);
  expect(state.enabled).toBe(can.ok);
  expect(state.disabledReason).toBe(can.ok ? null : can.reason);
  const exec = runTableChromeCommand(editor, slot, value, draft).result;
  if (can.ok) {
    expect(exec.ok).toBe(true);
  } else {
    expect(exec).toEqual(can);
  }
}

describe('table chrome live execution (Task 9 fix round 1)', () => {
  test('target pick executes complete spec and advances draft', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const { result, nextDraft } = runTableChromeCommand(
      editor,
      'table.borderTarget',
      'inside',
      DEFAULT_TABLE_CHROME_DRAFT
    );
    expect(result.ok).toBe(true);
    expect(nextDraft?.activeTarget).toBe('inside');
    expect(
      applyTableChromePick(DEFAULT_TABLE_CHROME_DRAFT, 'table.borderTarget', 'inside')?.command
    ).toEqual({
      type: 'setTableBorders',
      scope: 'inside',
      spec: DEFAULT_TABLE_CHROME_DRAFT.spec,
    });
  });

  test('none pick clears borders on the active target', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const draft = { ...DEFAULT_TABLE_CHROME_DRAFT, activeTarget: 'top' as const };
    const pick = applyTableChromePick(draft, 'table.borderTarget', 'none');
    expect(pick?.command).toEqual({ type: 'setTableBorders', scope: 'none', target: 'top' });
    expect(runTableChromeCommand(editor, 'table.borderTarget', 'none', draft).result.ok).toBe(true);
  });

  test('color style and width picks execute against active target', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const draft = { ...DEFAULT_TABLE_CHROME_DRAFT, activeTarget: 'outside' as const };
    for (const [slot, value] of [
      ['table.borderColor', { kind: 'hex', value: '336699' }],
      ['table.borderStyle', 'dotted'],
      ['table.borderWidth', 12],
    ] as const) {
      expect(runTableChromeCommand(editor, slot, value, draft).result.ok).toBe(true);
    }
  });

  test('clear fill executes setCellFill null', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    editor.exec({ type: 'setCellFill', color: { kind: 'hex', value: 'FF0000' } });
    expect(
      runTableChromeCommand(editor, 'table.cellFill', null, DEFAULT_TABLE_CHROME_DRAFT).result.ok
    ).toBe(true);
  });
});

describe('table chrome command-state parity (Task 9 fix round 1)', () => {
  test('enabled cell selection matches can and exec for every slot', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const draft = DEFAULT_TABLE_CHROME_DRAFT;
    assertChromeParity(editor, 'table.borderTarget', 'all', draft);
    assertChromeParity(editor, 'table.borderColor', { kind: 'hex', value: '112233' }, draft);
    assertChromeParity(editor, 'table.borderStyle', 'dashed', draft);
    assertChromeParity(editor, 'table.borderWidth', 8, draft);
    assertChromeParity(editor, 'table.cellFill', { kind: 'hex', value: 'FFFF00' }, draft);
  });

  test('viewing mode refusal matches can and exec verbatim', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    assertChromeParity(editor, 'table.borderTarget', 'all', DEFAULT_TABLE_CHROME_DRAFT);
  });

  test('legacy merged table keeps border chrome enabled while insertColumn refuses', () => {
    const merged =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr>${p('A1')}</w:tc>` +
      `<w:tc><w:tcPr><w:hMerge/></w:tcPr>${p('span')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(merged);
    caret(editor, paragraphByText(editor, 'A1'));
    expect(tableChromeToolbarState(editor, 'table.borderTarget').enabled).toBe(true);
    const structural = { type: 'insertColumn' as const, where: 'right' as const };
    const can = editor.can(structural);
    expect(tableCommandToolbarState(editor.surface, structural).disabledReason).toBe(can.reason);
    expect(can.reason).toBe('this table uses a legacy horizontal merge the editor cannot change');
  });

  test('repeated header row keeps border chrome enabled while explicit insertRow refuses', () => {
    const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${p('HEAD')}</w:tc></w:tr>`;
    const body = Array.from(
      { length: 60 },
      (_, i) => `<w:tr><w:tc>${p(`row ${i}`)}</w:tc></w:tr>`
    ).join('');
    const editor = mount(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${header}${body}</w:tbl>`
    );
    const surface = editor.surface!;
    caret(editor, paragraphByText(editor, 'HEAD'));
    expect(tableChromeToolbarState(editor, 'table.borderStyle').enabled).toBe(true);
    let repeatTarget: ReturnType<typeof tableRowOccurrenceTargetFrom> | null = null;
    visitTableOccurrences(surface.layout(), (ref) => {
      if (ref.row.isHeaderRepeat) {
        repeatTarget = tableRowOccurrenceTargetFrom(surface.session.revision(), ref);
      }
    });
    const cmd = { type: 'insertRow' as const, where: 'below' as const, target: repeatTarget! };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(surface, cmd)).toEqual({
      enabled: false,
      disabledReason: 'repeated header rows cannot be edited',
    });
    expect(can.reason).toBe('repeated header rows cannot be edited');
    expect(
      runTableChromeCommand(editor, 'table.borderWidth', 8, DEFAULT_TABLE_CHROME_DRAFT).result.ok
    ).toBe(true);
  });

  test('resource limit refusal on structural command does not disable border chrome', () => {
    const cols = Array.from({ length: MAX_TABLE_COLUMNS }, () => '<w:gridCol w:w="100"/>').join('');
    const cells = Array.from(
      { length: MAX_TABLE_COLUMNS },
      (_, i) => `<w:tc>${p(`c${i}`)}</w:tc>`
    ).join('');
    const editor = mount(`<w:tbl><w:tblGrid>${cols}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`);
    caret(editor, paragraphByText(editor, 'c0'));
    const cmd = { type: 'insertColumn' as const, where: 'right' as const };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(editor.surface, cmd).disabledReason).toBe(
      'the table has reached the supported size limit'
    );
    expect(can.reason).toBe('the table has reached the supported size limit');
    expect(tableChromeToolbarState(editor, 'table.cellFill').enabled).toBe(true);
  });

  test('stale explicit structural target refusal matches can and exec', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    const table = surface.layout().pages[0]!.fragments.find((b) => b.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('no table');
    const target = tableRowOccurrenceTargetFrom(surface.session.revision(), {
      table,
      row: table.rows[0]!,
      rowIndex: 0,
    });
    surface.type('X');
    const cmd = { type: 'insertRow' as const, where: 'below' as const, target };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(surface, cmd).disabledReason).toBe('the table target is stale');
    expect(
      runTableChromeCommand(
        editor,
        'table.borderColor',
        { kind: 'hex', value: '000000' },
        DEFAULT_TABLE_CHROME_DRAFT
      ).result.ok
    ).toBe(true);
    expect(can.ok).toBe(false);
  });
});

describe('table chrome catalog (Task 9 fix round 1)', () => {
  test('registry icon paths resolve to generated Material Symbol paths', () => {
    const table = CHROME_GROUPS.find((g) => g.id === 'table');
    expect(table).toBeDefined();
    for (const control of table!.controls) {
      if (!control.paths) continue;
      for (const path of control.paths) {
        expect(path.length).toBeGreaterThan(20);
        expect(path).toMatch(/^[Mm]/);
      }
      const iconName = Object.entries(GENERATED_ICON_PATHS).find(([, paths]) =>
        paths.every((path, index) => path === control.paths![index])
      );
      expect(iconName, `${chromeSlotId(table!, control)} maps to a generated icon`).toBeDefined();
    }
  });
});
