// Typing into an empty paragraph whose mark names a character style.
//
// The toolbar reports the mark's face at the caret of an empty paragraph, character style
// included. The first character typed there must come out in that face, or the empty line,
// the toolbar and the text disagree the moment the user types. Anonymous probes: the typed
// text is 24pt bold under a 24pt bold mark style, 16pt bold when the mark also states a 16pt
// size directly, regular when the style's bold toggles off a bold paragraph style, and the
// neighbouring run's face when the paragraph already has text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/>' +
  '<w:rPr><w:sz w:val="24"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Big"><w:name w:val="Big"/>' +
  '<w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="BoldPara"><w:name w:val="Bold Para"/>' +
  '<w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const mark = (rPr: string, pPr = '') => `<w:pPr>${pPr}<w:rPr>${rPr}</w:rPr></w:pPr>`;
const BIG = '<w:rStyle w:val="Big"/>';
const AFTER = '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

describe('formatting at the caret of an empty paragraph formats its mark', () => {
  for (const rPr of ['<w:b/>', BIG]) {
    test(`bold turns off on a mark with ${rPr}, and one undo restores it`, () =>
      withEditor(`<w:p>${mark(rPr)}</w:p>${AFTER}`, (editor) => {
        caretAt(editor, 0, 0);
        expect(editor.getSelectionFormatting()?.bold).toBe(true);
        expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
        expect(editor.getSelectionFormatting()?.bold).toBe(false);
        expect(firstParagraphMark(editor)).toContain('b=0');
        expect(editor.exec({ type: 'undo' }).ok).toBe(true);
        expect(editor.getSelectionFormatting()?.bold).toBe(true);
        expect(firstParagraphMark(editor)).not.toContain('b=0');
        expect(editor.exec({ type: 'redo' }).ok).toBe(true);
        caretAt(editor, 0, 0);
        editor.surface!.type('x');
        expect(editor.getSelectionFormatting()?.bold).toBe(false);
        expect(firstParagraphRuns(editor).flat()).toContain('b=0');
      }));
  }

  test('a second bold press turns bold back on for the mark and the typed text', () =>
    withEditor(`<w:p>${mark(BIG)}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(editor.getSelectionFormatting()?.bold).toBe(false);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(editor.getSelectionFormatting()?.bold).toBe(true);
      expect(firstParagraphMark(editor)).toEqual(['rStyle=Big', 'b']);
      editor.surface!.type('x');
      expect(face(editor)).toEqual([24, true]);
    }));

  test('a font size sets the mark, so the empty line takes the size before typing', () =>
    withEditor(`<w:p/>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(
        editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: 40 }).ok
      ).toBe(true);
      expect(firstParagraphMark(editor)).toEqual(['sz=40']);
      expect(face(editor)).toEqual([20, false]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([['sz=40']]);
    }));

  test('a size the mark already has is not an undo step', () =>
    withEditor(`<w:p>${mark('<w:sz w:val="40"/>')}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      const before = editor.surface!.session.packageRevision();
      editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: 40 });
      expect(editor.surface!.session.packageRevision()).toBe(before);
      expect(editor.surface!.state().canUndo).toBe(false);
    }));

  test('a caret at a word edge still arms the format and leaves the document unchanged', () =>
    withEditor('<w:p><w:r><w:t xml:space="preserve">abcd efgh</w:t></w:r></w:p>', (editor) => {
      caretAt(editor, 0, 4);
      const before = JSON.stringify(editor.surface!.session.part().root);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(editor.getSelectionFormatting()?.bold).toBe(true);
      expect(JSON.stringify(editor.surface!.session.part().root)).toBe(before);
    }));
});

function withEditor(
  source: string | Uint8Array,
  run: (editor: DocxEditorInstance) => void | Promise<void>
): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: typeof source === 'string' ? docx(source) : source,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return Promise.resolve(run(editor)).finally(() => {
    editor.destroy();
    container.remove();
  });
}

function caretAt(editor: DocxEditorInstance, paragraph: number, offset: number): void {
  const id = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

/** The toolbar's size and bold at the current caret. */
function face(editor: DocxEditorInstance): [number | undefined, boolean | undefined] {
  const formatting = editor.getSelectionFormatting();
  const halfPoints = formatting?.fontSizeHalfPoints;
  return [halfPoints == null ? undefined : halfPoints / 2, formatting?.bold ?? undefined];
}

/** The first paragraph's runs, as the `w:rPr` children each run authors. */
function firstParagraphRuns(editor: DocxEditorInstance): string[][] {
  const root = editor.surface!.session.part().root;
  const body = root.children[0];
  const paragraph = body && body.kind !== 'textValue' ? body.children[0] : null;
  if (!paragraph || paragraph.kind === 'textValue') return [];
  return paragraph.children
    .filter((child) => child.kind === 'run')
    .map((run) => {
      if (run.kind === 'textValue') return [];
      const rPr = run.children.find((child) => child.kind === 'runProperties');
      if (!rPr || rPr.kind === 'textValue') return [];
      return rPr.children.flatMap((child: OoxmlNode) => {
        if (child.kind === 'textValue') return [];
        const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
        return [val === undefined ? child.localName : `${child.localName}=${val}`];
      });
    });
}

/** The first paragraph's mark, as the `w:pPr/w:rPr` children it authors. */
function firstParagraphMark(editor: DocxEditorInstance): string[] {
  const root = editor.surface!.session.part().root;
  const body = root.children[0];
  const paragraph = body && body.kind !== 'textValue' ? body.children[0] : null;
  if (!paragraph || paragraph.kind === 'textValue') return [];
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  if (!pPr || pPr.kind === 'textValue') return [];
  const rPr = pPr.children.find((child) => child.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') return [];
  return rPr.children.flatMap((child: OoxmlNode) => {
    if (child.kind === 'textValue') return [];
    const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
    return [val === undefined ? child.localName : `${child.localName}=${val}`];
  });
}

/** The attribute values of one `w:rPr` child in the first paragraph's last run. */
function lastRunPropertyValues(editor: DocxEditorInstance, localName: string): string[] {
  const root = editor.surface!.session.part().root;
  const body = root.children[0];
  const paragraph = body && body.kind !== 'textValue' ? body.children[0] : null;
  if (!paragraph || paragraph.kind === 'textValue') return [];
  const run = paragraph.children.filter((child) => child.kind === 'run').at(-1);
  if (!run || run.kind === 'textValue') return [];
  const rPr = run.children.find((child) => child.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') return [];
  const property = rPr.children.find(
    (child) => child.kind !== 'textValue' && child.localName === localName
  );
  if (!property || property.kind === 'textValue') return [];
  return property.attributes.map((entry) => `${entry.localName}=${entry.value}`).sort();
}

describe('typing into an empty paragraph whose mark names a character style', () => {
  test('the typed text takes the face the toolbar showed; undo and redo keep it', () =>
    withEditor(`<w:p>${mark(BIG)}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, true]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big']]);
      expect(face(editor)).toEqual([24, true]);
      expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
      expect(firstParagraphRuns(editor)).toEqual([]);
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, true]);
      expect(editor.exec({ type: 'redo' })).toEqual({ ok: true, changed: true });
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big']]);
    }));

  test('the style survives save and reopen', () =>
    withEditor(`<w:p>${mark(BIG)}</w:p>${AFTER}`, async (editor) => {
      caretAt(editor, 0, 0);
      editor.surface!.type('x');
      const saved = new Uint8Array(await editor.save());
      await withEditor(saved, (reopened) => {
        expect(firstParagraphRuns(reopened)).toEqual([['rStyle=Big']]);
        caretAt(reopened, 0, 1);
        expect(face(reopened)).toEqual([24, true]);
      });
    }));

  test('a direct size on the mark still overrides the style', () =>
    withEditor(`<w:p>${mark(`${BIG}<w:sz w:val="32"/>`)}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([16, true]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big', 'sz=32']]);
      expect(face(editor)).toEqual([16, true]);
    }));

  test('the style bold toggles off a bold paragraph style, before and after typing', () =>
    withEditor(`<w:p>${mark(BIG, '<w:pStyle w:val="BoldPara"/>')}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, false]);
      editor.surface!.type('x');
      expect(face(editor)).toEqual([24, false]);
    }));

  test('an empty run does not lend the typed text its own formatting', () =>
    withEditor(`<w:p>${mark(BIG)}<w:r><w:rPr><w:i/></w:rPr></w:r></w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, true]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([['i'], ['rStyle=Big']]);
      expect(face(editor)).toEqual([24, true]);
      expect(editor.getSelectionFormatting()?.italic).toBe(false);
    }));

  test('an empty run that states the mark’s style plus more lends none of the extra', () =>
    withEditor(
      `<w:p>${mark(BIG)}<w:r><w:rPr>${BIG}<w:i/></w:rPr></w:r></w:p>${AFTER}`,
      (editor) => {
        caretAt(editor, 0, 0);
        expect(editor.getSelectionFormatting()?.italic).toBe(false);
        editor.surface!.type('x');
        // The typed text shows the face the toolbar reported before typing.
        expect(firstParagraphRuns(editor).at(-1)).toEqual(['rStyle=Big']);
        expect(editor.getSelectionFormatting()?.italic).toBe(false);
        expect(face(editor)).toEqual([24, true]);
      }
    ));

  test('an empty run that states exactly the mark’s face is the face typed text joins', () =>
    withEditor(
      `<w:p>${mark(`${BIG}<w:sz w:val="32"/>`)}<w:r><w:rPr>${BIG}<w:sz w:val="32"/><w:vanish/></w:rPr></w:r></w:p>${AFTER}`,
      (editor) => {
        caretAt(editor, 0, 0);
        expect(face(editor)).toEqual([16, true]);
        editor.surface!.type('x');
        const runs = firstParagraphRuns(editor);
        expect(runs.at(-1)).toEqual(['rStyle=Big', 'sz=32']);
        expect(face(editor)).toEqual([16, true]);
      }
    ));

  test('the insertText command takes the style too', () =>
    withEditor(`<w:p>${mark(BIG)}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(editor.exec({ type: 'insertText', text: 'x' })).toEqual({ ok: true, changed: true });
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big']]);
    }));

  test('beside existing text, typing takes that text face and not the mark', () =>
    withEditor(`<w:p>${mark(BIG)}<w:r><w:t>Text</w:t></w:r></w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 4);
      expect(face(editor)).toEqual([12, false]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([[]]);
      expect(face(editor)).toEqual([12, false]);
    }));

  test('an empty run whose East Asian language differs lends no language', () =>
    withEditor(
      `<w:p>${mark(`${BIG}<w:lang w:val="en-US" w:eastAsia="ja-JP"/>`)}` +
        `<w:r><w:rPr>${BIG}<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:r></w:p>${AFTER}`,
      (editor) => {
        caretAt(editor, 0, 0);
        editor.surface!.type('x');
        expect(lastRunPropertyValues(editor, 'lang')).not.toContain('eastAsia=zh-CN');
      }
    ));

  test('an empty run whose shading fill differs lends no shading', () =>
    withEditor(
      `<w:p>${mark(`${BIG}<w:shd w:val="clear" w:color="auto" w:fill="FF0000"/>`)}` +
        `<w:r><w:rPr>${BIG}<w:shd w:val="clear" w:color="auto" w:fill="00FF00"/></w:rPr></w:r></w:p>${AFTER}`,
      (editor) => {
        caretAt(editor, 0, 0);
        editor.surface!.type('x');
        expect(lastRunPropertyValues(editor, 'shd')).not.toContain('fill=00FF00');
      }
    ));
});
