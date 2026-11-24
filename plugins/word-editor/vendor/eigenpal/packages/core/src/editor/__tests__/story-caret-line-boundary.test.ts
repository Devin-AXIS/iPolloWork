// Home, End and Shift-extend at a soft wrap behave the same in every story: the body, a
// header, a footer and a footnote.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORDS = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo';
const wrapping = `<w:p><w:r><w:t xml:space="preserve">${WORDS}</w:t></w:r></w:p>`;

const override = (part: string, kind: string) =>
  `<Override PartName="/word/${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`;

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        override('document.xml', 'document.main') +
        override('header1.xml', 'header') +
        override('footer1.xml', 'footer') +
        override('footnotes.xml', 'footnotes') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId11" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${wrapping}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${wrapping}</w:ftr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1">${wrapping}</w:footnote></w:footnotes>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${wrapping}` +
        '<w:p><w:r><w:t>note</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/>' +
        '<w:footerReference w:type="default" r:id="rId11"/>' +
        '<w:pgSz w:w="4000" w:h="12000"/>' +
        '<w:pgMar w:top="2400" w:bottom="2400" w:left="0" w:right="0" w:header="200" w:footer="200"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

const open: { editor: DocxEditorInstance; host: HTMLElement }[] = [];
afterEach(() => {
  for (const item of open.splice(0)) {
    item.editor.destroy();
    item.host.remove();
  }
  document.getSelection()?.removeAllRanges();
});

function enter(story: 'body' | 'header' | 'footer' | 'footnote') {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: docx() });
  open.push({ editor, host });
  editor.attach(host);
  const surface = editor.surface!;
  surface.focus();
  if (story === 'header') expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
  if (story === 'footer') expect(surface.enterHeaderFooter({ rId: 'rId11' })).toBe(true);
  if (story === 'footnote') expect(surface.enterNote('footnote:1')).toBe(true);
  const paragraphId = surface.state().selection.head.paragraphId;
  const at = (offset: number, extend = false) =>
    surface.setSelection({
      anchor: extend ? surface.state().selection.anchor : { paragraphId, offset },
      head: { paragraphId, offset },
    });
  const caretTop = () =>
    Number.parseFloat(host.querySelector<HTMLElement>('[data-docx-caret]')!.style.top);
  return { surface, at, caretTop, head: () => surface.state().selection.head.offset };
}

describe('a soft wrap in each story', () => {
  for (const story of ['body', 'header', 'footer', 'footnote'] as const) {
    test(story, () => {
      const { surface, at, caretTop, head } = enter(story);
      at(2);
      const firstLineTop = caretTop();

      // End: the wrap offset, painted at the end of the first line.
      surface.navigate('lineEnd');
      const b = head();
      expect(b).toBeGreaterThan(2);
      expect(b).toBeLessThan(WORDS.length);
      expect(caretTop()).toBe(firstLineTop);

      // Home after End is the first line's start.
      surface.navigate('lineStart');
      expect(head()).toBe(0);
      expect(caretTop()).toBe(firstLineTop);

      // The same offset placed directly shows at the next line's start, and Home keeps it.
      at(b + 2);
      const secondLineTop = caretTop();
      expect(secondLineTop).toBeGreaterThan(firstLineTop);
      surface.navigate('lineStart');
      expect(head()).toBe(b);
      expect(caretTop()).toBe(secondLineTop);

      // Shift+End then Shift+Home extend from the first line and come back to its start.
      at(2);
      surface.navigate('lineEnd', true);
      expect(head()).toBe(b);
      surface.navigate('lineStart', true);
      expect(head()).toBe(0);
    });
  }
});
