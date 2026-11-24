import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

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

const begin = (code: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>${code}</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>`;
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const text = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const p = (s: string) => `<w:p>${s}</w:p>`;
const heading = (s: string) => p(`<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${text(s)}`);
async function refresh(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container });
  editor.load(docx(body));
  const result = editor.exec({ type: 'refreshToc', mode: 'entire' });
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  editor.destroy();
  container.remove();
  return { result, xml };
}
test('TC-based full refresh retains entries from TC fields', async () => {
  const body =
    p(begin('TOC \\f \\u')) +
    p(text('Index entry Alpha')) +
    p(end) +
    p(
      text('Body text') +
        '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TC &quot;Index entry Alpha&quot; \\l 1</w:instrText><w:fldChar w:fldCharType="end"/></w:r>'
    );
  const { result, xml } = await refresh(body);
  expect(result).toEqual({ ok: true, changed: true });
  expect(xml).toContain('<w:t>Index entry Alpha</w:t>');
});

const toc = (code = 'TOC \\f') => p(begin(code)) + p(text('Old cache')) + p(end);
const tc = (instruction: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>' +
  instruction +
  '</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';

test('mixed outline and TC sources retain document order and entry levels', async () => {
  const body =
    toc('TOC \\f \\u') +
    p(text('Body A') + tc('TC &quot;Entry A&quot; \\l 2')) +
    heading('Heading B') +
    p(text('Body C') + tc('TC &quot;Entry C&quot;'));
  const { xml } = await refresh(body);
  const cached = xml.slice(0, xml.indexOf('Body A'));
  expect(cached.indexOf('Entry A')).toBeLessThan(cached.indexOf('Heading B'));
  expect(cached.indexOf('Heading B')).toBeLessThan(cached.indexOf('Entry C'));
  expect(cached).toContain('w:pStyle w:val="TOC2"');
});

test('TC identifiers, level ranges, and page-number omission are respected', async () => {
  const body =
    toc('TOC \\f a \\l &quot;2-3&quot;') +
    p(text('Source A') + tc('TC &quot;Included&quot; \\f a \\l 2 \\n')) +
    p(text('Source B') + tc('TC &quot;Wrong identifier&quot; \\f b \\l 2')) +
    p(text('Source C') + tc('TC &quot;Wrong level&quot; \\f a \\l 1'));
  const { xml } = await refresh(body);
  const cached = xml.slice(0, xml.indexOf('Source A'));
  expect(cached).toContain('<w:t>Included</w:t>');
  expect(cached).not.toContain('Wrong identifier');
  expect(cached).not.toContain('Wrong level');
  expect(cached).not.toContain('w:ptab');
});

test('split TC instructions consume nested REF cached results and retain tabs', async () => {
  const source =
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TC &quot;</w:instrText></w:r>' +
    begin('REF EntryNumber') +
    text('4') +
    end +
    '<w:r><w:tab/><w:instrText>Example entry&quot; \\l 1</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';
  const { xml } = await refresh(toc() + p(text('Source') + source));
  const cached = xml.slice(0, xml.indexOf('Source'));
  expect(cached).toContain('<w:t>4</w:t><w:tab/><w:t>Example entry</w:t>');
  expect(cached).not.toContain('REF');
});

test('unsupported source switches and malformed TC entries refuse without changing the cache', async () => {
  for (const body of [
    toc('TOC \\t &quot;Custom,1&quot;') + heading('A'),
    toc() + p(tc('TC &quot;Entry&quot; \\l 99')),
  ]) {
    const { result, xml } = await refresh(body);
    expect(result.ok).toBe(false);
    expect(xml).toContain('<w:t>Old cache</w:t>');
  }
});

test('page-number-only refresh resolves numbered PAGEREF rows to non-heading TC targets', async () => {
  const row =
    text('1') +
    '<w:r><w:tab/></w:r>' +
    text('Entry') +
    '<w:r><w:tab/></w:r>' +
    begin('PAGEREF EntryTarget') +
    text('8') +
    end;
  const body =
    p(begin('TOC \\f') + row) +
    p(end) +
    p(
      '<w:bookmarkStart w:id="1" w:name="EntryTarget"/>' +
        text('Source') +
        tc('TC &quot;1 Entry&quot;') +
        '<w:bookmarkEnd w:id="1"/>'
    );
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container });
  try {
    editor.load(docx(body));
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' }).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).not.toContain('<w:t>8</w:t>');
    expect(xml).toContain('PAGEREF EntryTarget');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(
      strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!)
    ).toContain('<w:t>8</w:t>');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('nested REF cached instruction text contributes to the TC label', async () => {
  const source =
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TC &quot;</w:instrText></w:r>' +
    begin('REF EntryNumber') +
    '<w:r><w:instrText>4</w:instrText></w:r>' +
    end +
    '<w:r><w:tab/><w:instrText>Example entry&quot;</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';
  const { xml } = await refresh(toc() + p(text('Source') + source));
  expect(xml.slice(0, xml.indexOf('Source'))).toContain(
    '<w:t>4</w:t><w:tab/><w:t>Example entry</w:t>'
  );
});

test('simple nested REF cache contributes to the TC label', async () => {
  const source =
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TC &quot;</w:instrText></w:r>' +
    '<w:fldSimple w:instr="REF EntryNumber">' +
    text('5') +
    '</w:fldSimple>' +
    '<w:r><w:instrText> Example entry&quot;</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';
  const { xml } = await refresh(toc() + p(text('Source') + source));
  expect(xml.slice(0, xml.indexOf('Source'))).toContain('<w:t>5 Example entry</w:t>');
});

test('TC refresh survives save/reopen and repeated refresh, with undo restoring the cache', async () => {
  const editor = createDocxEditor({ container: document.createElement('div') });
  const body = toc() + p(text('Body') + tc('TC &quot;Entry Alpha&quot;'));
  editor.load(docx(body));
  expect(editor.exec({ type: 'refreshToc', mode: 'entire' }).ok).toBe(true);
  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  let xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  expect(xml).toContain('Old cache');
  expect(editor.exec({ type: 'redo' }).ok).toBe(true);
  const bytes = new Uint8Array(await editor.save());
  editor.load(bytes);
  expect(editor.exec({ type: 'refreshToc', mode: 'entire' }).ok).toBe(true);
  xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  expect(xml.match(/<w:t>Entry Alpha<\/w:t>/g)).toHaveLength(1);
  expect(xml).not.toContain('Old cache');
  editor.destroy();
});

test('deeply nested fields refuse TC refresh without losing the old result', async () => {
  const source =
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TC &quot;</w:instrText></w:r>' +
    begin('REF Number').repeat(12) +
    text('4') +
    end.repeat(12) +
    '<w:r><w:instrText> Label&quot;</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';
  const { result, xml } = await refresh(toc() + p(source));
  expect(result.ok).toBe(false);
  expect(xml).toContain('Old cache');
});

test('Word uses a paragraph TC entry instead of duplicating its outline title', async () => {
  const body =
    toc('TOC \\f \\u') +
    p(
      '<w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr>' +
        text('Source heading') +
        tc('TC &quot;Alternate title&quot;')
    );
  const { xml } = await refresh(body);
  const cached = xml.slice(0, xml.indexOf('<w:t>Source heading'));
  expect(cached).toContain('<w:t>Alternate title</w:t>');
  expect(xml.match(/<w:t>Source heading<\/w:t>/g)).toHaveLength(1);
  expect(xml.match(/<w:t>Alternate title<\/w:t>/g)).toHaveLength(1);
});

test('page-number omission never lets a title tab become a page-number update target', async () => {
  const source =
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TC &quot;1</w:instrText>' +
    '<w:tab/><w:instrText>Alpha&quot; \\n</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';
  const { result, xml } = await refresh(toc() + p(text('Source') + source));
  expect(result.ok).toBe(true);
  expect(xml.slice(0, xml.indexOf('Source'))).toContain('<w:t>1</w:t><w:tab/><w:t>Alpha</w:t>');
});

test('page-only refresh preserves a stale tabbed title when its TC source omits page numbers', async () => {
  const row =
    '<w:hyperlink w:anchor="EntryTarget">' +
    text('1') +
    '<w:r><w:tab/></w:r>' +
    text('Old label') +
    '</w:hyperlink>';
  const body =
    p(begin('TOC \\f \\h') + row + end) +
    p(
      '<w:bookmarkStart w:id="1" w:name="EntryTarget"/>' +
        tc('TC &quot;New label&quot; \\n') +
        '<w:bookmarkEnd w:id="1"/>'
    );
  const editor = createDocxEditor({ container: document.createElement('div') });
  try {
    editor.load(docx(body));
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' }).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).toContain('<w:t>Old label</w:t>');
  } finally {
    editor.destroy();
  }
});

test('one TC paragraph can omit one row number and still update another row', async () => {
  const linked = (content: string) =>
    '<w:hyperlink w:anchor="EntryTarget">' + content + '</w:hyperlink>';
  const body =
    p(begin('TOC \\f \\h') + linked(text('1') + '<w:r><w:tab/></w:r>' + text('Alpha'))) +
    p(linked(text('Beta') + '<w:r><w:tab/></w:r>' + text('8')) + end) +
    p(
      '<w:bookmarkStart w:id="1" w:name="EntryTarget"/>' +
        tc('TC &quot;1 Alpha&quot; \\n') +
        tc('TC &quot;Beta&quot;') +
        '<w:bookmarkEnd w:id="1"/>'
    );
  const editor = createDocxEditor({ container: document.createElement('div') });
  try {
    editor.load(docx(body));
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' }).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).toContain('<w:t>Alpha</w:t>');
    expect(xml).toContain('<w:t>Beta</w:t>');
    expect(xml).not.toContain('<w:t>8</w:t>');
  } finally {
    editor.destroy();
  }
});

test('Word defaults both TOC and TC identifiers to C', async () => {
  for (const code of ['TOC \\f', 'TOC \\f c']) {
    const { xml } = await refresh(
      toc(code) +
        p(
          text('Sources') +
            tc('TC &quot;No type&quot;') +
            tc('TC &quot;Type C&quot; \\f c') +
            tc('TC &quot;Type A&quot; \\f a')
        )
    );
    const cached = xml.slice(0, xml.indexOf('Sources'));
    expect(cached).toContain('<w:t>No type</w:t>');
    expect(cached).toContain('<w:t>Type C</w:t>');
    expect(cached).not.toContain('<w:t>Type A</w:t>');
  }
});
