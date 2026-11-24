import {
  createFixedMeasurer,
  layoutSemanticDocument,
  createLayoutSession,
  createParagraphLayoutCache,
  buildStyleCascadeTable,
  paragraphFragmentsOf,
} from '../../layout/index.ts';
import { expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { serializeOoxmlPart, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '../docx-editor.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>' +
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0000FF"/><w:u w:val="single"/></w:rPr></w:style>' +
  '</w:styles>';

function docx(body: string, tocColor = ''): Uint8Array {
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
    'word/styles.xml': strToU8(
      tocColor
        ? STYLES.replace(
            '<w:name w:val="toc 1"/>',
            `<w:name w:val="toc 1"/><w:rPr><w:color w:val="${tocColor}"/></w:rPr>`
          )
        : STYLES
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const run = (text: string, direct = '') =>
  `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/>${direct}</w:rPr><w:t>${text}</w:t></w:r>`;
const link = (text: string, direct = '') =>
  `<w:hyperlink w:anchor="target">${run(text, direct)}</w:hyperlink>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
for (const [separateParagraphs, tocColor] of [
  [false, ''],
  [true, ''],
  [true, '226644'],
] as const) {
  test(`TOC links retain document formatting and targets: multi-paragraph=${separateParagraphs}, color=${tocColor}`, async () => {
    const middle =
      link('Entry') +
      (separateParagraphs
        ? link('Authored', '<w:color w:val="A02030"/><w:u w:val="double"/>')
        : '');
    const body =
      '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' +
      link('Before') +
      begin +
      (separateParagraphs ? '</w:p><w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' : '') +
      middle +
      (separateParagraphs ? '</w:p><w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' : '') +
      end +
      link('After') +
      '</w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' +
      link('Ordinary') +
      '</w:p>';
    const bytes = docx(body, tocColor);
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: bytes });
    const originalXml = serializeOoxmlPart(editor.surface!.session.part());
    try {
      const styled = (text: string) =>
        [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')]
          .find((a) => a.textContent === text)!
          .querySelector<HTMLElement>('[data-start]')!;
      expect(styled('Entry').style.color).toBe(tocColor ? `#${tocColor}` : '');
      expect(styled('Entry').style.textDecorationLine).not.toContain('underline');
      for (const text of ['Before', 'After', 'Ordinary']) {
        expect(styled(text).style.color).toBe('#0000FF');
        expect(styled(text).style.textDecorationLine).toContain('underline');
      }
      if (separateParagraphs) {
        expect(styled('Authored').style.color).toBe('#A02030');
        expect(styled('Authored').style.textDecorationLine).toContain('underline');
      }
      expect(container.querySelectorAll('a[href="#target"]')).toHaveLength(
        separateParagraphs ? 5 : 4
      );
      const saved = new Uint8Array(await editor.save());
      expect(serializeOoxmlPart(editor.surface!.session.part())).toBe(originalXml);
      const originalPackage = readOoxmlPackage(bytes);
      const savedPackage = readOoxmlPackage(saved);
      if (!originalPackage.ok || !savedPackage.ok) throw new Error('Cannot reopen fixture');
      expect(serializeOoxmlPart(savedPackage.package.parts.get('/word/styles.xml')!)).toBe(
        serializeOoxmlPart(originalPackage.package.parts.get('/word/styles.xml')!)
      );
      expect(
        strFromU8(unzipSync(saved)['word/document.xml']!).match(/w:val="Hyperlink"/g)
      ).toHaveLength(separateParagraphs ? 5 : 4);
    } finally {
      editor.destroy();
    }
  });
}

for (const startsAsToc of [false, true]) {
  test(`cached rows follow changed TOC membership: startsAsToc=${startsAsToc}`, () => {
    const field = docx(`<w:p>${begin}</w:p><w:p>${link('Entry')}</w:p><w:p>${end}</w:p>`);
    const inert = docx(
      `<w:p>${begin.replace('TOC', 'QUOTE')}</w:p><w:p>${link('Entry')}</w:p><w:p>${end}</w:p>`
    );
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    const project = (bytes: Uint8Array, warm: boolean) => {
      const loaded = readOoxmlPackage(bytes);
      if (!loaded.ok) throw new Error('Invalid fixture');
      const pkg = loaded.package;
      const layout = layoutSemanticDocument(pkg.parts.get(pkg.mainDocumentPart)!, 1, {
        measurer: createFixedMeasurer(6, 14),
        styleCascade: buildStyleCascadeTable(pkg.parts.get('/word/styles.xml')!.root),
        tocFieldChromeParagraphIds: new Set(),
        ...(warm ? { session, cache } : {}),
      });
      return layout.pages
        .flatMap((p) => paragraphFragmentsOf(p))
        .flatMap((p) => p.lines)
        .flatMap((l) => l.spans)
        .find((s) => s.text === 'Entry')!.style.color;
    };
    project(startsAsToc ? field : inert, true);
    const next = startsAsToc ? inert : field;
    expect(project(next, true)).toBe(project(next, false));
    expect(project(next, false)).toBe(startsAsToc ? '0000FF' : null);
  });
}
