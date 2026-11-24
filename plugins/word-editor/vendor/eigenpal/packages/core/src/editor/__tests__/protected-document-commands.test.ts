import {
  observeCanonicalPrimitiveJournal,
  runObservedStoreTransaction,
  journalCaptureMark,
} from '../../store/package/canonical-primitive-capture.ts';
import type { EditorCommand } from '../../contracts/editor.ts';
// Protection must admit permitted work and explain every refused write.
import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { trackedDocx, selectCellRectangle } from './paginated-surface-fixtures.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { addComment, TreeDocumentStore, readOoxmlPackage } from '../../store/index.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const field =
  '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Input"/><w:textInput/></w:ffData></w:fldChar></w:r>' +
  '<w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run('FIELD') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function fixture(mode: string, inline?: string, enforced = true) {
  const files = unzipSync(
    trackedDocx(`<w:documentProtection w:edit="${mode}" w:enforcement="${enforced ? 1 : 0}"/>`)
  );
  if (inline)
    files['word/document.xml'] = strToU8(
      strFromU8(files['word/document.xml']!).replace('<w:r><w:t>tracked</w:t></w:r>', inline)
    );
  return zipSync(files);
}

function mount(bytes: Uint8Array) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: bytes,
    author: 'Reviewer',
    modules: [reviewModule()],
  });
  cleanups.push(() => {
    editor.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  });
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  return {
    editor,
    surface,
    container,
    select(start: number, end = start) {
      surface.setSelection({
        anchor: { paragraphId, offset: start },
        head: { paragraphId, offset: end },
      });
    },
  };
}

test('#845: outside-field typing refuses and saved content stays unchanged', async () => {
  const { editor, surface, select } = mount(fixture('forms'));
  select(0);
  expect(editor.can({ type: 'insertText', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  expect(toolbarCommandState(editor, 'text.bold')).toMatchObject({
    enabled: false,
    disabledReason: expect.any(String),
  });
  expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  expect(surface.session.bodyText()).toBe('tracked');
  editor.load(await editor.save());
  expect(editor.surface!.session.bodyText()).toBe('tracked');
});

test('#845: table insertion reports a protection refusal', () => {
  const { editor, select } = mount(fixture('forms'));
  select(0);
  expect(editor.exec({ type: 'insertTable', rows: 2, cols: 2 })).toEqual({
    ok: false,
    code: 'locked',
    reason: expect.any(String),
  });
});

test('#845: legacy fields permit filling and refuse formatting', () => {
  const { editor, surface, select } = mount(
    fixture('forms', run('BEFORE ') + field + run(' AFTER'))
  );
  select(8);
  expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
  expect(surface.session.bodyText()).toBe('BEFORE FXIELD AFTER');
  select(8, 10);
  expect(toolbarCommandState(editor, 'text.bold').enabled).toBe(false);
  expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
});

test('#845: unlocked modern content control remains fillable', () => {
  const control =
    '<w:sdt><w:sdtPr><w:alias w:val="Input"/></w:sdtPr><w:sdtContent>' +
    run('FIELD') +
    '</w:sdtContent></w:sdt>';
  const { editor, surface, select } = mount(
    fixture('forms', run('BEFORE ') + control + run(' AFTER'))
  );
  select(8);
  expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
  expect(surface.session.bodyText()).toBe('BEFORE FXIELD AFTER');
});

test('#844: comments-only permits commenting while read-only refuses it', async () => {
  for (const [mode, enforced, permitted] of [
    ['comments', false, true],
    ['comments', true, true],
    ['readOnly', true, false],
  ] as const) {
    const { editor, surface, select } = mount(fixture(mode, undefined, enforced));
    select(0, 3);
    const result = editor.addComment('Please review');
    expect(result.ok).toBe(permitted);
    if (!permitted) {
      expect(editor.snapshot().editingMode).toBe('viewing');
      // The surface's own refusal, as every viewing refusal answers, not a generic sentence.
      expect(result).toMatchObject({
        ok: false,
        code: 'locked',
        reason: 'the document is open for viewing',
      });
      expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(false);
    }
    expect(surface.session.bodyText()).toBe('tracked');
    const saved = unzipSync(new Uint8Array(await editor.save()));
    expect(Boolean(saved['word/comments.xml'])).toBe(permitted);
  }
});

test('#844: direct store comment writes preserve content and commit once', () => {
  const loaded = readOoxmlPackage(fixture('comments'));
  if (!loaded.ok) throw new Error(loaded.reason);
  const store = new TreeDocumentStore(loaded.package, loaded.package.mainDocumentPart);
  const body = store.part.root.children.find((node) => node.kind === 'body')!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children.find((node) => node.kind === 'paragraph')!;
  const before = store.package;
  expect(
    addComment(store, {
      anchor: { paragraphId: paragraph.id, start: 0, end: 3 },
      author: 'Reviewer',
      text: 'Please review',
    })
  ).toMatchObject({ ok: true });
  expect(store.package).not.toBe(before);
  expect(store.historyDepth).toBe(1);
});

test('forms keep Tab navigation and valid field filling', () => {
  const { editor, surface, container, select } = mount(
    fixture('forms', run('BEFORE ') + field + run(' AFTER'))
  );
  select(0);
  expect(surface.state().selection.head.offset).toBe(0);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  pages.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  );
  expect(surface.state().selection.head.offset).toBeGreaterThanOrEqual(7);
  expect(surface.state().selection.head.offset).toBeLessThanOrEqual(12);
  expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
  expect(surface.session.bodyText()).toContain('X');
});

test('comments-only supports the complete comment lifecycle, undo, redo and reopen', async () => {
  const { editor, select } = mount(fixture('comments'));
  select(0, 3);
  expect(editor.snapshot().editingMode).toBe('editing');
  expect(editor.setEditingMode('suggesting')).toMatchObject({ ok: false, code: 'locked' });
  expect(editor.addComment('Root')).toEqual({ ok: true, changed: true });
  let key = editor.getReviewItems()[0]!.key;
  expect(editor.replyToReviewItem(key, 'Reply')).toEqual({ ok: true, changed: true });
  expect(editor.setCommentText(key, 'Root, edited')).toEqual({ ok: true, changed: true });
  expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
  expect(editor.getReviewItems()[0]!.text).toBe('Root');
  expect(editor.exec({ type: 'redo' })).toEqual({ ok: true, changed: true });
  expect(editor.getReviewItems()[0]!.text).toBe('Root, edited');
  expect(editor.setCommentResolved(key, true)).toEqual({ ok: true, changed: true });
  expect(
    editor
      .getReviewItems()
      .filter((item) => item.kind === 'comment')
      .every((item) => item.resolved)
  ).toBe(true);
  expect(editor.setCommentResolved(key, false)).toEqual({ ok: true, changed: true });
  const saved = await editor.save();
  editor.load(saved);
  key = editor.getReviewItems().find((item) => item.kind === 'comment' && !item.parentId)!.key;
  expect(editor.deleteReviewItem(key)).toEqual({ ok: true, changed: true });
  expect(editor.getReviewItems()).toHaveLength(0);
  expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
  expect(editor.getReviewItems()).toHaveLength(2);
  expect(editor.exec({ type: 'redo' })).toEqual({ ok: true, changed: true });
  expect(editor.getReviewItems()).toHaveLength(0);
  expect(editor.surface!.session.bodyText()).toBe('tracked');
});

test('comments-only never grants a generic package callback permission', () => {
  const loaded = readOoxmlPackage(fixture('comments'));
  if (!loaded.ok) throw new Error(loaded.reason);
  const store = new TreeDocumentStore(loaded.package, loaded.package.mainDocumentPart);
  let called = false;
  expect(
    store.transact((ctx) => {
      ctx.applyPackage((pkg) => {
        called = true;
        return pkg;
      });
    })
  ).toMatchObject({ ok: false, reason: 'locked' });
  expect(called).toBe(false);
});

test('explicit viewing still refuses comment writes on a comments-only document', () => {
  const { editor, select } = mount(fixture('comments'));
  select(0, 3);
  editor.setEditingMode('viewing');
  expect(editor.addComment('Refused').ok).toBe(false);
  expect(editor.getReviewItems()).toHaveLength(0);
});

for (const [start, end] of [
  [0, 9],
  [9, 0],
  [8, 15],
  [15, 8],
]) {
  test(`forms refuse replacement across a field boundary ${start}-${end}`, () => {
    const { editor, surface, select } = mount(
      fixture('forms', run('BEFORE ') + field + run(' AFTER'))
    );
    select(start!, end!);
    const before = surface.session.bodyText();
    expect(editor.can({ type: 'insertText', text: 'X' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(surface.session.bodyText()).toBe(before);
  });
}

test('field capacity permits replacement and clipped paste but refuses insertion at the limit', () => {
  const limited = field.replace(
    '<w:textInput/>',
    '<w:textInput><w:maxLength w:val="5"/></w:textInput>'
  );
  const { editor, surface, select } = mount(
    fixture('forms', run('BEFORE ') + limited + run(' AFTER'))
  );
  select(8);
  expect(editor.can({ type: 'insertText', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  select(7, 12);
  expect(editor.exec({ type: 'insertText', text: 'OTHER' })).toEqual({ ok: true, changed: true });
  select(7, 12);
  expect(editor.exec({ type: 'pasteWithoutFormatting', text: '123456789' })).toEqual({
    ok: true,
    changed: true,
  });
  expect(surface.session.bodyText()).toBe('BEFORE 12345 AFTER');
});

test('unsupported field formats are refused at admission', () => {
  const unsupported = field.replace(
    '<w:textInput/>',
    '<w:textInput><w:format w:val="unknown-format"/></w:textInput>'
  );
  const { editor, select } = mount(fixture('forms', run('BEFORE ') + unsupported + run(' AFTER')));
  select(8);
  expect(editor.can({ type: 'insertText', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
});

test('admission never records speculative field edits in a collaboration journal', () => {
  const { editor, select } = mount(fixture('forms', field));
  select(0, 5);
  const owner = {};
  const stop = observeCanonicalPrimitiveJournal(owner, () => {});
  try {
    runObservedStoreTransaction(
      owner,
      () => {
        const before = journalCaptureMark();
        for (let i = 0; i < 3; i++)
          expect(editor.can({ type: 'insertText', text: 'OTHER' })).toEqual({ ok: true });
        expect(journalCaptureMark()).toBe(before);
      },
      () => false
    );
  } finally {
    stop();
  }
});

test('keyboard formatting cannot arm a pending style in a protected field', () => {
  const { editor, surface, select } = mount(fixture('forms', run('BEFORE ') + field));
  select(8);
  surface.toggleRunProperty('b');
  expect(surface.formatting().bold).toBe(false);
  expect(editor.snapshot().lastRejection).toContain('protected');
  expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
});

for (const mode of ['forms', 'comments'] as const) {
  test(`${mode}: content command admission agrees with execution`, () => {
    const { editor, surface, select } = mount(fixture(mode));
    const commands: EditorCommand[] = [
      { type: 'insertText', text: 'X' },
      { type: 'deleteText' },
      { type: 'paste', text: 'X' },
      { type: 'pasteWithoutFormatting', text: 'X' },
      { type: 'cut' },
      { type: 'toggleMark', mark: 'bold' },
      { type: 'clearFormatting' },
      { type: 'setAlignment', align: 'center' },
      { type: 'setParagraphDirection', direction: 'rtl' },
      { type: 'setLineSpacing', rule: 'multiple', value: 2 },
      { type: 'setParagraphSpacing', beforePt: 12 },
      { type: 'setIndent', left: 120 },
      { type: 'adjustIndent', direction: 'increase' },
      { type: 'toggleList', kind: 'bullet' },
      { type: 'insertBreak', kind: 'line' },
      { type: 'insertTable', rows: 2, cols: 2 },
      { type: 'insertToc' },
      { type: 'setPageSetup', orientation: 'landscape' },
      {
        type: 'insertImage',
        data: new Uint8Array([1]),
        mime: 'image/png',
        widthPoints: 20,
        heightPoints: 20,
      },
    ];
    for (const command of commands) {
      select(0, 3);
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
    }
    expect(surface.session.bodyText()).toBe('tracked');
  });
}

for (const mode of ['forms', 'comments'] as const) {
  test(`${mode}: addressed modern control writes use document protection`, () => {
    const control =
      '<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>' +
      run('FIELD') +
      '</w:sdtContent></w:sdt>';
    const { editor, select } = mount(fixture(mode, run('BEFORE ') + control));
    select(8);
    const command = { type: 'setContentControlValue', value: 'NEW' } as const;
    expect(editor.can(command).ok).toBe(mode === 'forms');
    expect(editor.exec(command).ok).toBe(mode === 'forms');
  });
}

test('an unprotected section remains editable in a forms-protected document', () => {
  const files = unzipSync(fixture('forms'));
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '</w:body>',
      '<w:sectPr><w:formProt w:val="0"/></w:sectPr></w:body>'
    )
  );
  const { editor, select } = mount(zipSync(files));
  select(0);
  expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
  select(0, 2);
  expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
});

for (const enclosingControl of [false, true]) {
  test(`table plans check their complete reach (table inside control: ${enclosingControl})`, () => {
    const files = unzipSync(fixture('forms'));
    const inline =
      '<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>' +
      run('FIELD') +
      '</w:sdtContent></w:sdt>';
    const cell =
      '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p>' + inline + '</w:p></w:tc>';
    const table =
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>' +
      cell +
      cell +
      '</w:tr></w:tbl>';
    const body = enclosingControl
      ? '<w:sdt><w:sdtPr/><w:sdtContent>' + table + '</w:sdtContent></w:sdt>'
      : table;
    files['word/document.xml'] = strToU8(
      strFromU8(files['word/document.xml']!).replace(
        '<w:p><w:r><w:t>tracked</w:t></w:r></w:p>',
        body
      )
    );
    const { editor, select } = mount(zipSync(files));
    select(2);
    const command = { type: 'insertRow', where: 'below' } as const;
    if (enclosingControl) {
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
    } else {
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
    }
  });
}

test('modern controls permit replacing the entire selected value', () => {
  const control =
    '<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>' + run('FIELD') + '</w:sdtContent></w:sdt>';
  const { editor, surface, select } = mount(
    fixture('forms', run('BEFORE ') + control + run(' AFTER'))
  );
  select(7, 12);
  expect(editor.can({ type: 'insertText', text: 'OTHER' })).toEqual({ ok: true });
  expect(editor.exec({ type: 'insertText', text: 'OTHER' })).toEqual({ ok: true, changed: true });
  expect(surface.session.bodyText()).toBe('BEFORE OTHER AFTER');
});

test('protected table formatting checks the selected cells without adjacent unselected cells', () => {
  const files = unzipSync(fixture('forms'));
  const fieldCell =
    '<w:tc><w:sdt><w:sdtPr/><w:sdtContent><w:p>' +
    run('FIELD') +
    '</w:p></w:sdtContent></w:sdt></w:tc>';
  const plainCell = '<w:tc><w:p>' + run('LABEL') + '</w:p></w:tc>';
  const row = '<w:tr>' + fieldCell + plainCell + '</w:tr>';
  const table =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
    row +
    row +
    '</w:tbl>';
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '<w:p><w:r><w:t>tracked</w:t></w:r></w:p>',
      table
    )
  );
  const { editor, surface } = mount(zipSync(files));
  selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 0 });
  const command = { type: 'setAlignment', align: 'center' } as const;
  expect(editor.can(command)).toEqual({ ok: true });
  expect(editor.exec(command)).toEqual({ ok: true, changed: true });
});
