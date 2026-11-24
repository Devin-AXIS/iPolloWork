// The font box answers the face the selected text paints in, and a pick reaches the text the
// picked font can draw.
//
// A run names a face per script: `w:ascii`/`w:hAnsi` for Latin, `w:eastAsia` for Chinese,
// Japanese and Korean, `w:cs` for a complex-script run. The box reads the face each span paints
// in. A pick of an East Asian font also sets `w:eastAsia`; a Latin font does not, because it
// has no ideographs and would draw them in a fallback face.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  AUTHORABLE_RUN_PROPERTIES,
  authoredProperties,
  findNode,
  propertyContainer,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const MIXED =
  '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/>' +
  '<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr><w:t>中文DOCX</w:t></w:r></w:p>';
const RTL =
  '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/>' +
  '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Times New Roman"/></w:rPr><w:t>שלום</w:t></w:r></w:p>';

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function select(editor: DocxEditorInstance, from: number, to: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

const boxFamily = (editor: DocxEditorInstance) => editor.snapshot().formatting?.fontFamily ?? null;

const pick = (editor: DocxEditorInstance, value: string) =>
  editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value });

/** Every run's own `w:rFonts` in the first paragraph. */
function runFonts(editor: DocxEditorInstance) {
  const part = editor.surface!.session.part();
  const paragraph = findNode(part, editor.surface!.session.paragraphIds()[0]!);
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('no paragraph');
  return paragraph.children
    .filter((child) => child.kind === 'run')
    .map(
      (run) =>
        authoredProperties(
          propertyContainer(run, 'runProperties', 'rPr'),
          AUTHORABLE_RUN_PROPERTIES
        ).find((property) => property.localName === 'rFonts')?.attributes
    );
}

describe('the font box reads the face the text paints in', () => {
  test('Chinese text in a Calibri+SimSun run reads SimSun', () => {
    const editor = mount(MIXED);
    select(editor, 0, 2);
    expect(boxFamily(editor)).toBe('SimSun');
    editor.destroy();
  });

  test('the Latin letters of the same run read Calibri', () => {
    const editor = mount(MIXED);
    select(editor, 2, 6);
    expect(boxFamily(editor)).toBe('Calibri');
    editor.destroy();
  });

  test('Chinese and Latin letters in different faces read blank', () => {
    const editor = mount(MIXED);
    select(editor, 0, 6);
    expect(boxFamily(editor)).toBeNull();
    editor.destroy();
  });

  test('a Korean date with ASCII digits reads the Korean face', () => {
    // The digits paint through the Latin slot; like spaces, they do not decide the box.
    const editor = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic"/>' +
        '</w:rPr><w:t xml:space="preserve">2024년 3월</w:t></w:r></w:p>'
    );
    select(editor, 0, 8);
    expect(boxFamily(editor)).toBe('Malgun Gothic');
    editor.destroy();
  });

  test('digits in another font still blank a Latin selection', () => {
    // Outside East Asian text every span votes, so a hidden font is never reported as another.
    const editor = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr><w:t xml:space="preserve">Total: </w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t>1234</w:t></w:r></w:p>'
    );
    select(editor, 0, 11);
    expect(boxFamily(editor)).toBeNull();
    editor.destroy();
  });

  test('only the selected part of a span counts', () => {
    // The selection starts on the space after "Total", so the Calibri word is not selected.
    const editor = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic"/>' +
        '</w:rPr><w:t xml:space="preserve">Total 문서는</w:t></w:r></w:p>'
    );
    select(editor, 5, 9);
    expect(boxFamily(editor)).toBe('Malgun Gothic');
    editor.destroy();
  });

  test('a full-width comma does not take over a Latin selection', () => {
    const editor = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="DengXian"/>' +
        '</w:rPr><w:t>Hello，world</w:t></w:r></w:p>'
    );
    select(editor, 0, 11);
    expect(boxFamily(editor)).toBe('Calibri');
    editor.destroy();
  });

  test('Korean words with spaces and punctuation between them read the Korean face', () => {
    // The spaces and the period paint through the Latin slot; they must not blank the box.
    const editor = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic"/>' +
        '<w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr><w:t xml:space="preserve">문서는 한국어 예제입니다. 텍스트</w:t></w:r></w:p>'
    );
    select(editor, 0, 19);
    expect(boxFamily(editor)).toBe('Malgun Gothic');
    editor.destroy();
  });

  test('East Asian text in two different faces reads blank', () => {
    const editor = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:eastAsia="SimSun"/></w:rPr><w:t>中文</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:eastAsia="SimHei"/></w:rPr><w:t>中文</w:t></w:r></w:p>'
    );
    select(editor, 0, 4);
    expect(boxFamily(editor)).toBeNull();
    editor.destroy();
  });

  test('a caret inside Chinese text reads SimSun', () => {
    const editor = mount(MIXED);
    select(editor, 1, 1);
    expect(boxFamily(editor)).toBe('SimSun');
    editor.destroy();
  });

  test('a right-to-left run reads its complex-script face', () => {
    const editor = mount(RTL);
    select(editor, 0, 4);
    expect(boxFamily(editor)).toBe('Times New Roman');
    editor.destroy();
  });
});

describe('a font pick reaches the text that font can draw', () => {
  test('an East Asian font picked for Chinese text sets its East Asian face', () => {
    const editor = mount(MIXED);
    select(editor, 0, 2);
    expect(pick(editor, 'Microsoft YaHei').ok).toBe(true);
    const fonts = runFonts(editor);
    expect(fonts[0]).toMatchObject({
      ascii: 'Microsoft YaHei',
      hAnsi: 'Microsoft YaHei',
      eastAsia: 'Microsoft YaHei',
    });
    // The Latin letters outside the selection keep their run's faces.
    expect(fonts.at(-1)).toMatchObject({ ascii: 'Calibri', eastAsia: 'SimSun' });
    select(editor, 0, 2);
    expect(boxFamily(editor)).toBe('Microsoft YaHei');
    editor.destroy();
  });

  test('a localized East Asian name counts too', () => {
    const editor = mount(MIXED);
    select(editor, 0, 2);
    pick(editor, '游ゴシック');
    expect(runFonts(editor)[0]).toMatchObject({ eastAsia: '游ゴシック' });
    editor.destroy();
  });

  test('a Latin font picked for Chinese text leaves the East Asian face alone', () => {
    const editor = mount(MIXED);
    select(editor, 0, 2);
    pick(editor, 'Georgia');
    expect(runFonts(editor)[0]).toMatchObject({
      ascii: 'Georgia',
      hAnsi: 'Georgia',
      eastAsia: 'SimSun',
    });
    select(editor, 0, 2);
    expect(boxFamily(editor)).toBe('SimSun');
    editor.destroy();
  });

  test('a Latin font picked for Latin letters changes them', () => {
    const editor = mount(MIXED);
    select(editor, 2, 6);
    pick(editor, 'Georgia');
    select(editor, 2, 6);
    expect(boxFamily(editor)).toBe('Georgia');
    editor.destroy();
  });

  test('a font picked for a right-to-left run sets its complex-script face', () => {
    const editor = mount(RTL);
    select(editor, 0, 4);
    pick(editor, 'Georgia');
    expect(runFonts(editor)[0]).toMatchObject({ cs: 'Georgia', ascii: 'Georgia' });
    expect(boxFamily(editor)).toBe('Georgia');
    editor.destroy();
  });

  test('a Latin font picked in an empty paragraph writes no East Asian face', () => {
    const editor = mount('<w:p/>');
    select(editor, 0, 0);
    pick(editor, 'Georgia');
    editor.exec({ type: 'insertText', text: '中文' });
    const fonts = runFonts(editor).find((entry) => entry?.ascii === 'Georgia');
    expect(fonts).toBeDefined();
    expect(fonts!.eastAsia).toBeUndefined();
    editor.destroy();
  });

  test('a regional Noto CJK family counts as an East Asian font', () => {
    const editor = mount(MIXED);
    select(editor, 0, 2);
    pick(editor, 'Noto Sans SC');
    expect(runFonts(editor)[0]).toMatchObject({ eastAsia: 'Noto Sans SC' });
    select(editor, 0, 2);
    expect(boxFamily(editor)).toBe('Noto Sans SC');
    editor.destroy();
  });

  test('an East Asian font picked at a caret applies to the Chinese typed next', () => {
    const editor = mount(MIXED);
    // After the Latin letters: the pick depends on the font, not on the text before the caret.
    select(editor, 6, 6);
    pick(editor, 'SimHei');
    editor.exec({ type: 'insertText', text: '字' });
    expect(runFonts(editor).some((fonts) => fonts?.eastAsia === 'SimHei')).toBe(true);
    editor.destroy();
  });
});
