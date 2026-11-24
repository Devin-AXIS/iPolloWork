import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

// Synthetic reduction of #937. No attachment content or embedded fonts are needed:
// themeFontLang without eastAsia exposes undefined supplemental maps to the cache key.
function sparseThemeDocument(withStyles: boolean): Uint8Array {
  const parts = [
    ['document.xml', `${WORD_TYPE}.document.main+xml`],
    ['settings.xml', `${WORD_TYPE}.settings+xml`],
    ['theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['header1.xml', `${WORD_TYPE}.header+xml`],
    ['footer1.xml', `${WORD_TYPE}.footer+xml`],
    ...(withStyles ? [['styles.xml', `${WORD_TYPE}.styles+xml`]] : []),
  ];
  const relationships = [
    ['settings', 'settings.xml'],
    ['theme', 'theme/theme1.xml'],
    ['header', 'header1.xml'],
    ['footer', 'footer1.xml'],
    ...(withStyles ? [['styles', 'styles.xml']] : []),
  ];
  const paragraph = (text: string) =>
    '<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>' +
    `</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        parts
          .map(([name, type]) => `<Override PartName="/word/${name}" ContentType="${type}"/>`)
          .join('') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        relationships
          .map(
            ([type, target]) =>
              `<Relationship Id="${type}" Type="${R}/${type}" Target="${target}"/>`
          )
          .join('') +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/><w:sectPr>` +
        '<w:headerReference w:type="default" r:id="header"/>' +
        '<w:footerReference w:type="default" r:id="footer"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}"><w:themeFontLang w:val="en-US"/></w:settings>`
    ),
    'word/theme/theme1.xml': strToU8(
      `<a:theme xmlns:a="${A}" name="Fixture"><a:themeElements><a:fontScheme name="Fixture">` +
        '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
        '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
        '</a:fontScheme></a:themeElements></a:theme>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${paragraph('Fixture header')}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${paragraph('Fixture footer')}</w:ftr>`),
    ...(withStyles
      ? {
          'word/styles.xml': strToU8(
            `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
              '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>' +
              '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
          ),
        }
      : {}),
  });
}

describe('opening documents with absent supplemental theme fonts', () => {
  test.each([true, false])(
    'paints and reopens an empty body with furniture (styles: %s)',
    async (withStyles) => {
      const container = document.createElement('div');
      document.body.append(container);
      let editor: DocxEditorInstance | undefined;
      try {
        editor = createDocxEditor({ container, document: sparseThemeDocument(withStyles) });
        const check = () => {
          expect(editor!.snapshot()).toMatchObject({
            isOpening: false,
            isLoading: false,
            parseError: null,
            page: { total: 1 },
          });
          const surface = editor!.surface!;
          expect(surface).not.toBeNull();
          expect(surface.session.bodyText()).toBe('');
          // Guard the actual package projection that used to reach the strict comparator.
          const theme = surface.session.documentThemeFonts();
          expect(Object.hasOwn(theme, 'majorSupplemental')).toBe(true);
          expect(Object.hasOwn(theme, 'minorSupplemental')).toBe(true);
          expect(theme.majorSupplemental).toBeUndefined();
          expect(theme.minorSupplemental).toBeUndefined();
          expect(container.querySelectorAll('.docx-page')).toHaveLength(1);
          expect(container.querySelector('[data-docx-hf="header"]')?.textContent).toContain(
            'Fixture header'
          );
          expect(container.querySelector('[data-docx-hf="footer"]')?.textContent).toContain(
            'Fixture footer'
          );
        };
        check();
        editor.load(new Uint8Array(await editor.save()));
        check();
      } finally {
        editor?.destroy();
        container.remove();
      }
    }
  );
});
