// The prepare steps after a large open's parse: a font family scan in short steps over the
// body, then the reads the mount needs. Their font answer must equal a cold scan's, because
// the mount lays the document out with the fonts that answer fetched.

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { openTreeSession } from '../../binding/tree-session.ts';
import { openSteps } from '../docx-editor-prepared-open.ts';
import { resolverGlyphFontFamilies } from '../resolver-glyph-font-families.ts';
import { docx } from './paginated-surface-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const paragraph = (language: string, text: string) =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsiaTheme="minorEastAsia"/><w:lang w:eastAsia="${language}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const table =
  '<w:tbl><w:tblPr><w:tblStyle w:val="CJK"/><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>日本語</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

/** Many plain paragraphs, with East Asian text and a styled table late in the body. */
function bytes(): Uint8Array {
  const body: string[] = [];
  for (let index = 0; index < 400; index += 1) body.push(paragraph('en-US', `Text ${index}`));
  body.push(paragraph('zh-CN', '中文'), table);
  const files = unzipSync(docx(body.join('')));
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Default Extension="xml" ContentType="application/xml"/></Types>'
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="${R}/theme" Target="theme/theme1.xml"/><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/></Relationships>`
  );
  files['word/theme/theme1.xml'] = strToU8(
    `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="CJK"><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:font script="Hans" typeface="Chinese Body"/><a:font script="Jpan" typeface="Japanese Body"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
  );
  files['word/styles.xml'] = strToU8(
    `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="CJK"><w:tblStylePr w:type="firstRow"><w:rPr><w:rFonts w:eastAsiaTheme="minorEastAsia"/><w:lang w:eastAsia="ja-JP"/></w:rPr></w:tblStylePr></w:style></w:styles>`
  );
  return zipSync(files);
}

function session() {
  const opened = openTreeSession(bytes());
  if (!opened.ok) throw new Error(opened.reason);
  return opened.session;
}

test('the stepped scan finds the families a cold scan finds, then runs the reads', () => {
  const cold = resolverGlyphFontFamilies(session());
  expect(cold).toContain('Chinese Body');

  const warm = session();
  let families: readonly string[] | null = null;
  const fonts = Promise.resolve();
  const step = openSteps(
    warm,
    () => true,
    () => {
      families = resolverGlyphFontFamilies(warm);
      return fonts;
    }
  );
  let result: unknown = step;
  let steps = 0;
  while (typeof result === 'function') {
    steps += 1;
    result = (result as typeof step)();
  }
  expect(families).toEqual(cold);
  // The last step hands back the font work for the mount to wait on.
  expect(result).toBe(fonts);
  // At least: the scan, the node index, and the review items.
  expect(steps).toBeGreaterThanOrEqual(3);
});

test('a replaced open stops its steps without starting font work', () => {
  let started = false;
  const step = openSteps(
    session(),
    () => false,
    () => {
      started = true;
    }
  );
  expect(step()).toBeUndefined();
  expect(started).toBe(false);
});

test('an empty body still starts the font work', () => {
  const opened = openTreeSession(docx(''));
  if (!opened.ok) throw new Error(opened.reason);
  let started = false;
  let result: unknown = openSteps(
    opened.session,
    () => true,
    () => {
      started = true;
    }
  );
  while (typeof result === 'function') result = (result as () => unknown)();
  expect(started).toBe(true);
});

test('a long table scanned a few rows at a time finds what a cold scan finds', () => {
  const rows = Array.from(
    { length: 200 },
    (_, index) =>
      `<w:tr><w:tc><w:p><w:r><w:t>${index === 150 ? '日本語' : `row ${index}`}</w:t></w:r></w:p></w:tc></w:tr>`
  ).join('');
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="CJK"/><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
    rows +
    '</w:tbl>';
  const withTable = (bytesOf: () => Uint8Array) => {
    const opened = openTreeSession(bytesOf());
    if (!opened.ok) throw new Error(opened.reason);
    return opened.session;
  };
  const files = () => {
    const unzipped = unzipSync(bytes());
    const document = strFromU8(unzipped['word/document.xml']!);
    unzipped['word/document.xml'] = strToU8(document.replace('<w:body>', `<w:body>${table}`));
    return zipSync(unzipped);
  };
  const cold = resolverGlyphFontFamilies(withTable(files));
  const warm = withTable(files);
  let families: readonly string[] | null = null;
  let result: unknown = openSteps(
    warm,
    () => true,
    () => {
      families = resolverGlyphFontFamilies(warm);
    }
  );
  while (typeof result === 'function') result = (result as () => unknown)();
  expect(families).toEqual(cold);
});
