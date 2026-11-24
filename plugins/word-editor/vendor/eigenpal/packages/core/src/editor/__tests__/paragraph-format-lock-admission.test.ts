// `can`, the toolbar and `exec` agree on paragraph formatting over a content lock or a data
// binding: alignment, indents, spacing, and the keep settings pass a lock; styles, lists,
// direction, and tab stops are refused before the write. A data binding mirrors text, so it
// lets every paragraph format through, tracked or not, and keeps the bound text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createT, en, localizeDisabledReason } from '@docx-editor.dev/i18n';
import { diagnosticCodeOfRefusal } from '../diagnostic-codes.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import type { EditorCommand } from '../../contracts/editor.ts';
import { directParagraphProperties } from '../../store/store/direct-properties.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { LOCKED_FORMAT_REASON } from '../content-lock-format-refusal.ts';
import { LOCKED_PARAGRAPH_FORMAT_REASON } from '../paragraph-format-lock-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMBERING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const block = (sdtPr: string, pPr: string) =>
  `<w:sdt><w:sdtPr><w:tag w:val="block"/>${sdtPr}</w:sdtPr><w:sdtContent>` +
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>locked text</w:t></w:r></w:p></w:sdtContent></w:sdt>`;
const FREE = '<w:p><w:r><w:t>free text</w:t></w:r></w:p>';
const LOCK = '<w:lock w:val="contentLocked"/>';
const INDENT = '<w:ind w:left="240"/>';

/** One decimal list with two levels. */
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>' +
  '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function mount(
  body: string,
  extra: { readonly author?: string; readonly numbering?: boolean } = {}
): { editor: DocxEditorInstance; id: (index: number) => string } {
  const { numbering, ...options } = extra;
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (numbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...(numbering
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rIdN" Type="${NUMBERING_REL}" Target="numbering.xml"/></Relationships>`
          ),
          'word/numbering.xml': strToU8(NUMBERING),
        }
      : {}),
  });
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    ...options,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, id: (index) => editor.surface!.session.paragraphIds()[index]! };
}

function select(editor: DocxEditorInstance, from: string, to = from, end = 4): void {
  editor.surface!.setSelection({
    anchor: { paragraphId: from, offset: 2 },
    head: { paragraphId: to, offset: end },
  });
}

const properties = (editor: DocxEditorInstance, paragraphId: string) =>
  JSON.stringify(directParagraphProperties(editor.surface!.session.part(), paragraphId));

/** The element names the paragraph's direct properties hold. */
const names = (editor: DocxEditorInstance, paragraphId: string) =>
  directParagraphProperties(editor.surface!.session.part(), paragraphId).map(
    (property) => property.localName
  );

/** Paragraph formats a content lock keeps: list, direction, contextual spacing, tab stops. */
const LOCKED: readonly EditorCommand[] = [
  { type: 'toggleList', kind: 'bullet' },
  { type: 'setParagraphDirection', direction: 'rtl' },
  { type: 'setParagraphFormat', direction: 'ltr' },
  { type: 'setParagraphFormat', contextualSpacing: true },
  { type: 'setParagraphFormat', spaceAfterPt: 6, tabStops: [] },
];

/** Paragraph formats that place the paragraph around the locked text. */
const PLACEMENT: readonly EditorCommand[] = [
  { type: 'adjustIndent', direction: 'increase' },
  { type: 'setLineSpacing', rule: 'multiple', value: 2 },
  { type: 'setParagraphSpacing', beforePt: 12 },
  { type: 'setIndent', left: 720 },
  { type: 'setParagraphFormat', spaceAfterPt: 6, alignment: 'center' },
  {
    type: 'setParagraphFormat',
    keepNext: true,
    keepLines: true,
    widowControl: false,
    pageBreakBefore: true,
  },
];

const ALIGNMENT: readonly EditorCommand[] = [
  { type: 'setAlignment', align: 'center' },
  { type: 'setParagraphFormat', alignment: 'right' },
];

test('a content lock refuses lists, direction, and tab stops before the write', () => {
  const { editor, id } = mount(block(LOCK, INDENT) + FREE);
  select(editor, id(0));
  const before = properties(editor, id(0));
  for (const command of LOCKED) {
    const refusal = { ok: false, code: 'locked', reason: LOCKED_PARAGRAPH_FORMAT_REASON };
    expect(editor.can(command)).toEqual(refusal);
    expect(editor.exec(command)).toEqual(refusal);
    expect(properties(editor, id(0))).toBe(before);
  }
  editor.destroy();
});

test('a content lock lets alignment, indents, spacing, and the keep settings through', () => {
  const { editor, id } = mount(block(LOCK, INDENT) + FREE);
  select(editor, id(0));
  for (const command of [...PLACEMENT, ...ALIGNMENT]) {
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
  }
  expect(names(editor, id(0)).sort()).toEqual(
    ['ind', 'jc', 'keepLines', 'keepNext', 'pageBreakBefore', 'spacing', 'widowControl'].sort()
  );
  editor.destroy();
});

test('Increase Indent refuses a locked list item, whose indent fields stay available', () => {
  const numbered =
    '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="720"/>';
  const { editor, id } = mount(block(LOCK, numbered) + FREE, { numbering: true });
  select(editor, id(0));
  const before = properties(editor, id(0));
  const command: EditorCommand = { type: 'adjustIndent', direction: 'increase' };
  const refusal = { ok: false, code: 'locked', reason: LOCKED_PARAGRAPH_FORMAT_REASON };
  expect(editor.can(command)).toEqual(refusal);
  expect(editor.exec(command)).toEqual(refusal);
  expect(properties(editor, id(0))).toBe(before);
  expect(editor.exec({ type: 'setIndent', left: 1080 })).toMatchObject({ ok: true });
  expect(properties(editor, id(0))).toContain('1080');
  editor.destroy();
});

test('the toolbar keeps lock-free paragraph buttons available and disables the rest', () => {
  const { editor, id } = mount(block(LOCK, INDENT) + FREE);
  select(editor, id(0));
  for (const slot of ['list.bullet', 'list.numbered', 'direction.rtl', 'direction.ltr'] as const) {
    expect(toolbarCommandState(editor, slot)).toMatchObject({
      enabled: false,
      disabledReason: LOCKED_PARAGRAPH_FORMAT_REASON,
    });
  }
  for (const slot of [
    'list.indent',
    'list.outdent',
    'list.lineSpacing',
    'alignment.left',
    'alignment.center',
    'paragraph.dialog',
  ] as const) {
    expect(toolbarCommandState(editor, slot).enabled).toBe(true);
  }
  // Outside the lock, the same buttons stay available.
  select(editor, id(1));
  for (const slot of ['list.indent', 'list.bullet', 'list.lineSpacing', 'direction.rtl'] as const) {
    expect(toolbarCommandState(editor, slot).enabled).toBe(true);
  }
  editor.destroy();
});

test('a selection into a locked paragraph: a list refuses for all, spacing writes all', () => {
  const { editor, id } = mount(FREE + block(LOCK, INDENT));
  select(editor, id(0), id(1), 0);
  const free = properties(editor, id(0));
  const list: EditorCommand = { type: 'toggleList', kind: 'bullet' };
  expect(editor.can(list)).toMatchObject({ ok: false, code: 'locked' });
  expect(editor.exec(list)).toMatchObject({ ok: false, code: 'locked' });
  expect(properties(editor, id(0))).toBe(free);
  const spacing: EditorCommand = { type: 'setLineSpacing', rule: 'multiple', value: 2 };
  expect(editor.can(spacing)).toEqual({ ok: true });
  expect(editor.exec(spacing)).toMatchObject({ ok: true, changed: true });
  expect(names(editor, id(0))).toContain('spacing');
  expect(names(editor, id(1))).toContain('spacing');
  editor.destroy();
});

test('a locked inline control leaves the formatting of its paragraph available', () => {
  const pill =
    '<w:p><w:r><w:t>ab</w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="pill"/>' +
    `${LOCK}</w:sdtPr><w:sdtContent><w:r><w:t>PIL</w:t></w:r></w:sdtContent></w:sdt>` +
    '<w:r><w:t>cd</w:t></w:r></w:p>';
  const { editor, id } = mount(pill);
  select(editor, id(0), id(0), 3);
  for (const command of [...LOCKED, ...PLACEMENT, ...ALIGNMENT]) {
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
  }
  editor.destroy();
});

const BINDING = '<w:dataBinding w:storeItemID="{1}" w:xpath="/root/value"/><w:text/>';

/** The bound control's text and whether it still declares its binding. */
const boundControl = (editor: DocxEditorInstance) => {
  const xml = serializeOoxmlPart(editor.surface!.session.part());
  return {
    text: /<w:t>([^<]*)<\/w:t>/.exec(xml)?.[1],
    binding: xml.includes('w:dataBinding'),
  };
};

const pendingChanges = (editor: DocxEditorInstance) =>
  serializeOoxmlPart(editor.surface!.session.part()).split('<w:pPrChange').length - 1;

test('a data binding lets every paragraph format through and keeps the bound text', () => {
  const { editor, id } = mount(block(BINDING, INDENT) + FREE, { numbering: true });
  select(editor, id(0));
  for (const slot of ['list.bullet', 'direction.rtl', 'alignment.center', 'list.indent'] as const) {
    expect(toolbarCommandState(editor, slot).enabled).toBe(true);
  }
  for (const command of [...LOCKED, ...PLACEMENT, ...ALIGNMENT]) {
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
  }
  expect(names(editor, id(0))).toEqual(
    expect.arrayContaining(['numPr', 'tabs', 'contextualSpacing', 'ind', 'jc', 'spacing'])
  );
  expect(boundControl(editor)).toEqual({ text: 'locked text', binding: true });
  editor.destroy();
});

test('a data binding with a content lock follows the lock', () => {
  const { editor, id } = mount(block(BINDING + LOCK, INDENT) + FREE);
  select(editor, id(0));
  const refusal = { ok: false, code: 'locked', reason: LOCKED_PARAGRAPH_FORMAT_REASON };
  for (const command of LOCKED) {
    expect(editor.can(command)).toEqual(refusal);
    expect(editor.exec(command)).toEqual(refusal);
  }
  for (const command of [...PLACEMENT, ...ALIGNMENT]) {
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
  }
  expect(boundControl(editor)).toEqual({ text: 'locked text', binding: true });
  editor.destroy();
});

test('a suggested paragraph format in a data binding can be rejected and accepted', () => {
  const { editor, id } = mount(block(BINDING, INDENT) + FREE, { author: 'Reviewer' });
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(editor, id(0));
  const before = properties(editor, id(0));
  expect(editor.exec({ type: 'setIndent', left: 720 })).toMatchObject({ ok: true, changed: true });
  expect(pendingChanges(editor)).toBe(1);
  expect(surface.applyAutomationOps(() => [{ op: 'rejectAllRevisions' as const }]).rejected).toBe(
    false
  );
  expect(properties(editor, id(0))).toBe(before);
  expect(pendingChanges(editor)).toBe(0);
  expect(editor.exec({ type: 'setParagraphSpacing', beforePt: 12 })).toMatchObject({ ok: true });
  expect(pendingChanges(editor)).toBe(1);
  expect(surface.applyAutomationOps(() => [{ op: 'acceptAllRevisions' as const }]).rejected).toBe(
    false
  );
  expect(pendingChanges(editor)).toBe(0);
  expect(names(editor, id(0))).toEqual(['spacing', 'ind']);
  expect(boundControl(editor)).toEqual({ text: 'locked text', binding: true });
  editor.destroy();
});

test('the paragraph format refusal reaches the user in their own language', () => {
  const t = createT(en);
  expect(localizeDisabledReason(LOCKED_PARAGRAPH_FORMAT_REASON, t)).not.toBe(
    LOCKED_PARAGRAPH_FORMAT_REASON
  );
  expect(diagnosticCodeOfRefusal(LOCKED_PARAGRAPH_FORMAT_REASON)).toBe('edit.protected-content');
});

test('suggested placement is refused where its revision could not be rejected in the lock', () => {
  // The pending change records a contextual spacing change, which the lock keeps.
  const pending =
    '<w:contextualSpacing/><w:pPrChange w:id="7" w:author="Ada"><w:pPr/></w:pPrChange>';
  const { editor, id } = mount(block(LOCK, pending) + FREE, { author: 'Reviewer' });
  editor.surface!.setEditingMode('suggest');
  select(editor, id(0));
  const refusal = { ok: false, code: 'locked', reason: LOCKED_FORMAT_REASON };
  for (const command of [
    { type: 'setAlignment', align: 'center' },
    { type: 'setIndent', left: 720 },
  ] as const) {
    expect(editor.can(command)).toEqual(refusal);
    expect(editor.exec(command)).toEqual(refusal);
  }
  expect(toolbarCommandState(editor, 'alignment.center')).toMatchObject({
    enabled: false,
    disabledReason: LOCKED_FORMAT_REASON,
  });
  expect(toolbarCommandState(editor, 'list.indent')).toMatchObject({
    enabled: false,
    disabledReason: LOCKED_FORMAT_REASON,
  });
  editor.destroy();
});

test('suggested placement in a lock merges into a pending change of lock-free properties', () => {
  const pending =
    '<w:ind w:left="480"/><w:pPrChange w:id="7" w:author="Ada">' +
    '<w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange>';
  const { editor, id } = mount(block(LOCK, pending) + FREE, { author: 'Reviewer' });
  editor.surface!.setEditingMode('suggest');
  select(editor, id(0));
  expect(editor.exec({ type: 'setParagraphSpacing', beforePt: 12 })).toMatchObject({ ok: true });
  expect(editor.exec({ type: 'setAlignment', align: 'center' })).toMatchObject({ ok: true });
  const xml = properties(editor, id(0));
  expect(xml).toContain('"spacing"');
  expect(xml).toContain('"jc"');
  editor.destroy();
});
