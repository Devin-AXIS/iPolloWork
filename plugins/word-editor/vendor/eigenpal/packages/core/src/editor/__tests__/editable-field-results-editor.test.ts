// `fieldResults` on `createDocxEditor`: the option, its refusal in a collaboration session, and
// host reads that address the document in the editor's mode.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { currentFieldResultsMode } from '../../store/package/field-result-mode.ts';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { runToolbarCommand } from '../toolbar-commands.ts';
import type { DocxEditorConfig } from '../docx-editor-types.ts';
import { COLLABORATION_FIELD_RESULTS_REFUSAL } from '../field-results-scope.ts';
import { stubCollaborationModule, stubCollaborationSession } from './collaboration-test-module.ts';
import { docx } from './paginated-surface-fixtures.ts';

const run = (text: string, rPr = '') =>
  `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const MERGE =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> MERGEFIELD Name </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run('Name') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
/** `ab ` + field + bold ` cd`: in the editable mode the bold run spans offsets 7 to 10. */
const BODY = `<w:p>${run('ab ')}${MERGE}${run(' cd', '<w:b/>')}</w:p>`;

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(config: Partial<DocxEditorConfig> = {}): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(BODY), ...config });
  editors.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function caret(editor: DocxEditorInstance, offset: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const point = { paragraphId, offset };
  editor.surface!.setSelection({ anchor: point, head: point });
}

describe('fieldResults on createDocxEditor', () => {
  test('host reads after a saved result use the editable offsets', () => {
    const editor = mount({ fieldResults: 'editable' });
    caret(editor, 9);
    expect(editor.snapshot().formatting?.bold).toBe(true);
    caret(editor, 5);
    expect(editor.snapshot().formatting?.bold).toBe(false);
    // Nothing outside the editor's own calls sees the editable mode.
    expect(currentFieldResultsMode()).toBe('atomic');
  });

  test('typing through the surface lands inside the result', () => {
    const editor = mount({ fieldResults: 'editable' });
    caret(editor, 5);
    editor.surface!.type('X');
    expect(editor.surface!.session.bodyText()).toContain('NaXme');
    editor.surface!.undo();
    expect(editor.surface!.session.bodyText()).not.toContain('NaXme');
  });

  test('bold applied inside the result formats the result runs', () => {
    const editor = mount({ fieldResults: 'editable' });
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 6 },
    });
    expect(runToolbarCommand(editor, 'text.bold').ok).toBe(true);
    const xml = serializeOoxmlPart(editor.surface!.session.part());
    const separate = xml.indexOf('w:fldCharType="separate"');
    const bold = xml.indexOf('<w:b/>', separate);
    expect(bold).toBeGreaterThan(separate);
    expect(bold).toBeLessThan(xml.indexOf('w:fldCharType="end"'));
    expect(xml).toContain('MERGEFIELD');
  });

  test('the default keeps the field one unit', () => {
    const editor = mount();
    caret(editor, 4);
    editor.surface!.type('X');
    expect(editor.surface!.session.bodyText()).not.toContain('NaXme');
  });

  test('an editable request with a collaboration module is refused', () => {
    expect(() =>
      mount({
        fieldResults: 'editable',
        modules: [stubCollaborationModule(stubCollaborationSession())],
      })
    ).toThrow(COLLABORATION_FIELD_RESULTS_REFUSAL);
  });

  test('a collaboration module with the default mode opens', () => {
    const editor = mount({ modules: [stubCollaborationModule(stubCollaborationSession())] });
    expect(editor.surface).not.toBeNull();
  });

  test('an unknown mode is refused', () => {
    expect(() =>
      mount({ fieldResults: 'live' as unknown as DocxEditorConfig['fieldResults'] })
    ).toThrow(TypeError);
  });

  for (const [label, link] of [
    [
      'complex',
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.com" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        run('the ') +
        run('site') +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ],
    [
      'simple',
      `<w:fldSimple w:instr=' HYPERLINK "https://example.com" '>${run('the ')}${run('site')}</w:fldSimple>`,
    ],
  ] as const) {
    test(`a click on an editable ${label} link result opens the link popover`, () => {
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createDocxEditor({
        container,
        document: docx(`<w:p>${run('See ')}${link}${run('.')}</w:p>`),
        fieldResults: 'editable',
      });
      editors.push(editor);
      const seen: (string | null)[] = [];
      editor.setHyperlinkChrome({ onPopover: (activation) => seen.push(activation.link.href) });
      caret(editor, 6);
      const anchors = [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')];
      expect(anchors.map((anchor) => anchor.textContent)).toEqual(['the site']);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      anchors[0]!.querySelector('[data-start]')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(seen).toEqual(['https://example.com']);
      // The display text stays editable in place.
      caret(editor, 8);
      editor.surface!.type('X');
      expect(container.querySelector('a.docx-hyperlink')!.textContent).toBe('the Xsite');
    });
  }
});
