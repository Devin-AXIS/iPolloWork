// A continuous section with a taller footer and `w:titlePg` in the editable surface: it stays on
// the sheet the previous section ended on, that sheet keeps its own footer, and the shared sheet
// holds through a caret, an edit, undo, and a save and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { caretAt } from '../../layout/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const FTR = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';

const MARGINS =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const BODY =
  p('Intro one') +
  `<w:p><w:pPr><w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/>${MARGINS}</w:sectPr></w:pPr>` +
  '<w:r><w:t>Intro two</w:t></w:r></w:p>' +
  p('After intro') +
  '<w:sectPr><w:footerReference w:type="default" r:id="rIdF2"/><w:type w:val="continuous"/>' +
  `${MARGINS}<w:titlePg/></w:sectPr>`;

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/footer1.xml" ContentType="${FTR}"/>` +
        `<Override PartName="/word/footer2.xml" ContentType="${FTR}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdF1" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rIdF2" Type="${R}/footer" Target="footer2.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${p('Foot one')}</w:ftr>`),
    'word/footer2.xml': strToU8(
      `<w:ftr xmlns:w="${W}">${p('Foot two')}${p('Foot two again')}${p('Foot two third')}</w:ftr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
}

function mount(bytes: Uint8Array): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({ container, document: bytes, mode: 'edit' });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

const footerText = (container: HTMLElement): string =>
  [...container.querySelectorAll('[data-docx-hf]')].map((node) => node.textContent ?? '').join('|');

describe('a continuous section with different furniture in the editor', () => {
  test('paints one sheet with the host footer and places the caret on it', () => {
    const { editor, container } = mount(docx());
    try {
      const layout = editor.surface!.layout();
      expect(layout.pages).toHaveLength(1);
      expect(container.querySelectorAll('[data-page-index]')).toHaveLength(1);
      expect(footerText(container)).toContain('Foot one');
      expect(footerText(container)).not.toContain('Foot two');

      const ids = editor.surface!.session.paragraphIds();
      expect(ids).toHaveLength(3);
      const host = caretAt(layout, { paragraphId: ids[1]!, offset: 0 })!;
      const continued = caretAt(layout, { paragraphId: ids[2]!, offset: 5 })!;
      expect(continued.pageIndex).toBe(0);
      expect(continued.y).toBeGreaterThan(host.y);
      const painted = container.querySelector(
        `[data-page-index="0"] [data-paragraph-id="${ids[2]}"]`
      );
      expect(painted?.textContent).toContain('After intro');
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('an edit in the continued section keeps the sheet, and undo restores the text', () => {
    const { editor, container } = mount(docx());
    try {
      const id = editor.surface!.session.paragraphIds()[2]!;
      editor.surface!.setSelection({
        anchor: { paragraphId: id, offset: 5 },
        head: { paragraphId: id, offset: 5 },
      });
      expect(editor.exec({ type: 'insertText', text: 'XY' })).toMatchObject({ ok: true });
      expect(editor.surface!.layout().pages).toHaveLength(1);
      expect(container.textContent).toContain('AfterXY intro');
      editor.surface!.undo();
      expect(editor.surface!.layout().pages).toHaveLength(1);
      expect(container.textContent).toContain('After intro');
      expect(container.textContent).not.toContain('XY');
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('save keeps both sections and their footers, and reopening keeps one sheet', () => {
    const { editor, container } = mount(docx());
    let saved: Uint8Array;
    try {
      saved = editor.surface!.save();
    } finally {
      editor.destroy();
      container.remove();
    }
    const xml = new TextDecoder().decode(unzipSync(saved)['word/document.xml']!);
    expect(xml.match(/<w:p[ >]/g)?.length).toBe(3);
    expect(xml.match(/<w:footerReference /g)?.length).toBe(2);
    expect(xml).toContain('w:titlePg');
    const reopened = mount(saved);
    try {
      expect(reopened.editor.surface!.layout().pages).toHaveLength(1);
      expect(footerText(reopened.container)).toContain('Foot one');
    } finally {
      reopened.editor.destroy();
      reopened.container.remove();
    }
  });
});
