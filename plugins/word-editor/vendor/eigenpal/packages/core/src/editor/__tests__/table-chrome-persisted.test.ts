// Task 9 fix round 2 — OOXML readback for table chrome live picks (independent of ExecResult shape).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { wmlChildNamed } from '../../store/store/tree-op-table-shared.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  DEFAULT_TABLE_CHROME_DRAFT,
  applyTableChromePick,
  type TableChromeDraft,
} from '../table-chrome.ts';
import { runTableChromeCommand, tableChromeToolbarState } from '../toolbar-commands.ts';

const W = WML_NAMESPACE_URI;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TABLE_2X2 =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

const TABLE_WITH_LEFT_BORDER =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:tcBorders><w:left w:val="single" w:sz="8" w:color="00AA00"/></w:tcBorders></w:tcPr>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

const TABLE_WITH_SHD_PAYLOAD =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:shd w:val="pct10" w:color="222222"/></w:tcPr>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

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
  if (!sideEl) throw new Error(`border side missing: ${side}`);
  const out: Record<string, string> = {};
  for (const attr of sideEl.attributes) {
    if (attr.localName) out[attr.localName] = String(attr.value);
  }
  return out;
}

function borderSidePresent(
  part: OoxmlPart,
  cellId: string,
  side: 'top' | 'left' | 'bottom' | 'right'
): boolean {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return false;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcBorders = tcPr && wmlChildNamed(tcPr, 'tcBorders');
  return Boolean(tcBorders && wmlChildNamed(tcBorders, side));
}

function shdFill(part: OoxmlPart, cellId: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const shd = tcPr && wmlChildNamed(tcPr, 'shd');
  return shd?.attributes.find((a) => a.localName === 'fill')?.value;
}

function shdAttr(part: OoxmlPart, cellId: string, localName: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const shd = tcPr && wmlChildNamed(tcPr, 'shd');
  return shd?.attributes.find((a) => a.localName === localName)?.value;
}

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

function selectedCellId(editor: DocxEditorInstance): string {
  const part = editor.surface!.session.part();
  return cellAtTableIndex(part, 0, 0, 0).id;
}

function expectDefaultBorderSpec(attrs: Record<string, string>): void {
  expect(attrs.val).toBe(DEFAULT_TABLE_CHROME_DRAFT.spec.style);
  expect(attrs.sz).toBe(String(DEFAULT_TABLE_CHROME_DRAFT.spec.size));
  expect(attrs.color?.toUpperCase()).toBe(
    DEFAULT_TABLE_CHROME_DRAFT.spec.color.kind === 'hex'
      ? DEFAULT_TABLE_CHROME_DRAFT.spec.color.value
      : undefined
  );
}

function assertEnabledPickPersists(
  editor: DocxEditorInstance,
  slot: Parameters<typeof runTableChromeCommand>[1],
  value: unknown,
  draft: TableChromeDraft,
  beforeRevision: number
): TableChromeDraft {
  const pick = applyTableChromePick(draft, slot, value);
  expect(pick).not.toBeNull();
  const state = tableChromeToolbarState(editor, slot, draft);
  const can = editor.can(pick!.command);
  expect(state.enabled).toBe(can.ok);
  expect(state.disabledReason).toBe(can.ok ? null : can.reason);
  const { result, nextDraft } = runTableChromeCommand(editor, slot, value, draft);
  expect(result.ok).toBe(can.ok);
  if (!can.ok) {
    expect(result).toEqual(can);
    return draft;
  }
  expect(editor.surface!.session.revision()).toBeGreaterThan(beforeRevision);
  expect(nextDraft).not.toBeNull();
  return nextDraft!;
}

describe('table chrome persisted OOXML (Task 9 fix round 2)', () => {
  test('target pick authors default complete border spec on all edges', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const cellId = selectedCellId(editor);
    const revision = editor.surface!.session.revision();
    const nextDraft = assertEnabledPickPersists(
      editor,
      'table.borderTarget',
      'all',
      DEFAULT_TABLE_CHROME_DRAFT,
      revision
    );
    expect(nextDraft.activeTarget).toBe('all');
    const part = editor.surface!.session.part();
    for (const side of ['top', 'left', 'bottom', 'right'] as const) {
      expectDefaultBorderSpec(borderSideAttrs(part, cellId, side));
    }
  });

  test('sequential color style and width picks persist on active target', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const cellId = selectedCellId(editor);
    let draft = DEFAULT_TABLE_CHROME_DRAFT;
    let revision = editor.surface!.session.revision();
    draft = assertEnabledPickPersists(editor, 'table.borderTarget', 'top', draft, revision);
    revision = editor.surface!.session.revision();

    draft = assertEnabledPickPersists(
      editor,
      'table.borderColor',
      { kind: 'hex', value: '336699' },
      draft,
      revision
    );
    expect(draft.activeTarget).toBe('top');
    expect(
      borderSideAttrs(editor.surface!.session.part(), cellId, 'top').color?.toUpperCase()
    ).toBe('336699');
    revision = editor.surface!.session.revision();

    draft = assertEnabledPickPersists(editor, 'table.borderStyle', 'dotted', draft, revision);
    expect(draft.activeTarget).toBe('top');
    expect(borderSideAttrs(editor.surface!.session.part(), cellId, 'top').val).toBe('dotted');
    revision = editor.surface!.session.revision();

    draft = assertEnabledPickPersists(editor, 'table.borderWidth', 12, draft, revision);
    expect(draft.activeTarget).toBe('top');
    const top = borderSideAttrs(editor.surface!.session.part(), cellId, 'top');
    expect(top.val).toBe('dotted');
    expect(top.sz).toBe('12');
    expect(top.color?.toUpperCase()).toBe('336699');
  });

  test('none clears targeted border attrs while unrelated edges remain', () => {
    const editor = mount(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const cellId = selectedCellId(editor);
    let draft = DEFAULT_TABLE_CHROME_DRAFT;
    let revision = editor.surface!.session.revision();
    draft = assertEnabledPickPersists(editor, 'table.borderTarget', 'top', draft, revision);
    revision = editor.surface!.session.revision();
    draft = assertEnabledPickPersists(editor, 'table.borderTarget', 'left', draft, revision);
    revision = editor.surface!.session.revision();
    expect(borderSidePresent(editor.surface!.session.part(), cellId, 'top')).toBe(true);
    expect(borderSidePresent(editor.surface!.session.part(), cellId, 'left')).toBe(true);

    draft = { ...draft, activeTarget: 'top' };
    const next = assertEnabledPickPersists(editor, 'table.borderTarget', 'none', draft, revision);
    expect(next.activeTarget).toBe('top');
    const part = editor.surface!.session.part();
    expect(borderSideAttrs(part, cellId, 'top').val).toBe('none');
    expectDefaultBorderSpec(borderSideAttrs(part, cellId, 'left'));
  });

  test('none on pre-existing border clears only the active target', () => {
    const editor = mount(TABLE_WITH_LEFT_BORDER);
    caret(editor, paragraphByText(editor, 'A1'));
    const cellId = selectedCellId(editor);
    let draft = DEFAULT_TABLE_CHROME_DRAFT;
    let revision = editor.surface!.session.revision();
    draft = assertEnabledPickPersists(editor, 'table.borderTarget', 'top', draft, revision);
    revision = editor.surface!.session.revision();
    expect(
      borderSideAttrs(editor.surface!.session.part(), cellId, 'left').color?.toUpperCase()
    ).toBe('00AA00');

    draft = { ...draft, activeTarget: 'top' };
    assertEnabledPickPersists(editor, 'table.borderTarget', 'none', draft, revision);
    const part = editor.surface!.session.part();
    expect(borderSideAttrs(part, cellId, 'top').val).toBe('none');
    expect(borderSideAttrs(part, cellId, 'left').color?.toUpperCase()).toBe('00AA00');
    expect(borderSideAttrs(part, cellId, 'left').val).toBe('single');
  });

  test('clear fill removes direct fill attrs and preserves unrelated shd payload', () => {
    const editor = mount(TABLE_WITH_SHD_PAYLOAD);
    caret(editor, paragraphByText(editor, 'A1'));
    const cellId = selectedCellId(editor);
    let draft = DEFAULT_TABLE_CHROME_DRAFT;
    let revision = editor.surface!.session.revision();
    draft = assertEnabledPickPersists(
      editor,
      'table.cellFill',
      { kind: 'hex', value: 'FFEECC' },
      draft,
      revision
    );
    expect(shdFill(editor.surface!.session.part(), cellId)).toBe('FFEECC');
    revision = editor.surface!.session.revision();

    assertEnabledPickPersists(editor, 'table.cellFill', null, draft, revision);
    const part = editor.surface!.session.part();
    expect(shdFill(part, cellId)).toBeUndefined();
    expect(shdAttr(part, cellId, 'val')).toBe('pct10');
    expect(shdAttr(part, cellId, 'color')).toBe('222222');
  });
});
