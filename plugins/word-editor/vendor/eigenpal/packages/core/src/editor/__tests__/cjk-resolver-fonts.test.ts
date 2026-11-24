import { resolverGlyphFontFamilies } from '../resolver-glyph-font-families.ts';
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { openDocumentForExport } from '../../export/export-session.ts';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { openTreeSession } from '../../binding/tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const paragraph = (language: string, text = '中文') =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsiaTheme="minorEastAsia"/><w:lang w:eastAsia="${language}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
function fixture(body: string, settings?: string, furniture = false) {
  const files = unzipSync(docx(body));
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Default Extension="xml" ContentType="application/xml"/></Types>'
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="${R}/theme" Target="theme/theme1.xml"/><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/>${settings ? `<Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/>` : ''}${furniture ? `<Relationship Id="header" Type="${R}/header" Target="header1.xml"/>` : ''}</Relationships>`
  );
  files['word/theme/theme1.xml'] = strToU8(
    `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="CJK"><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:font script="Hans" typeface="Chinese Body"/><a:font script="Jpan" typeface="Japanese Body"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
  );
  files['word/styles.xml'] = strToU8(
    `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="CJK"><w:tblStylePr w:type="firstRow"><w:rPr><w:rFonts w:eastAsiaTheme="minorEastAsia"/><w:lang w:eastAsia="ja-JP"/></w:rPr></w:tblStylePr></w:style></w:styles>`
  );
  if (settings)
    files['word/settings.xml'] = strToU8(
      `<w:settings xmlns:w="${W}"><w:themeFontLang w:eastAsia="${settings}"/></w:settings>`
    );
  if (furniture)
    files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${paragraph('ko-KR')}</w:hdr>`);
  return zipSync(files);
}
async function requested(bytes: Uint8Array) {
  let families: readonly string[] | undefined;
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    fonts: (request) => {
      families = request.families;
      return undefined;
    },
  });
  try {
    for (let index = 0; index < 100 && !families; index++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(families).toBeDefined();
    return families!;
  } finally {
    editor.destroy();
  }
}

test('live resolver requests the built-in theme face without a theme part', async () => {
  // Probes x01, x02 and z07 in local/evidence/hansi-font-slots.
  expect(await requested(docx(paragraph('zh-CN')))).toContain('DengXian');
});

test('live resolver requests the theme face for run, conditional table, and header text', async () => {
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="CJK"/><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>日本語</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const families = await requested(
    fixture(
      paragraph('zh-CN') +
        table +
        `<w:sectPr xmlns:r="${R}"><w:headerReference w:type="default" r:id="header"/></w:sectPr>`,
      undefined,
      true
    )
  );
  // Without a theme language every East Asian token takes the Simplified Chinese face, whatever
  // language the run, the table style or the header declares (probes z01-z03).
  expect(families).toContain('Chinese Body');
  expect(families).not.toContain('Japanese Body');
  expect(families).not.toContain('Batang');
});

test('document theme language overrides conflicting proofing language in live requests', async () => {
  const bytes = fixture(paragraph('zh-CN'), 'ja-JP');
  const families = await requested(bytes);
  expect(families).toContain('Japanese Body');
  expect(families).not.toContain('Chinese Body');
  const opened = openTreeSession(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  expect(opened.session.documentThemeFonts().minorEastAsia).toBe('Japanese Body');
});

test('body edits retain theme language resolution identity', () => {
  const opened = openTreeSession(fixture(paragraph('zh-CN'), 'ja-JP'));
  if (!opened.ok) throw new Error(opened.reason);
  const session = opened.session;
  const fonts = session.documentThemeFonts();
  const result = session.applyTreeOps([
    { op: 'insertText', paragraphId: session.paragraphIds()[0]!, offset: 0, text: '文' },
  ]);
  expect(result.committed).toBe(true);
  expect(session.documentThemeFonts()).toBe(fonts);
});

test('headless layout honors theme language with conflicting or absent run language', async () => {
  for (const language of ['zh-CN', '']) {
    const body = paragraph(language).replace(' w:eastAsia=""', '');
    const opened = openDocumentForExport(fixture(body, 'ja-JP'));
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const faces: Array<string | null> = [];
      forEachSemanticSpan(await opened.session.layout(), ({ span }) =>
        faces.push(span.style.fontFamilyEastAsia)
      );
      expect(faces).toEqual(['Japanese Body']);
    } finally {
      opened.session.dispose();
    }
  }
});

test('incremental discovery sees CJK introduced into an existing Latin run', () => {
  const opened = openTreeSession(fixture(paragraph('zh-CN', 'plain')));
  if (!opened.ok) throw new Error(opened.reason);
  const session = opened.session;
  expect(resolverGlyphFontFamilies(session)).not.toContain('Chinese Body');
  expect(
    session.applyTreeOps([
      { op: 'insertText', paragraphId: session.paragraphIds()[0]!, offset: 5, text: '中文' },
    ]).committed
  ).toBe(true);
  expect(resolverGlyphFontFamilies(session)).toContain('Chinese Body');
});

test('incremental discovery retains conditional table fonts after a text edit', () => {
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="CJK"/><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>日本語</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const opened = openTreeSession(fixture(table));
  if (!opened.ok) throw new Error(opened.reason);
  const session = opened.session;
  // The table style's Japanese language selects no theme face (probe z02).
  expect(resolverGlyphFontFamilies(session)).toContain('Chinese Body');
  expect(
    session.applyTreeOps([
      { op: 'insertText', paragraphId: session.paragraphIds()[0]!, offset: 0, text: '文' },
    ]).committed
  ).toBe(true);
  expect(resolverGlyphFontFamilies(session)).toContain('Chinese Body');
});
