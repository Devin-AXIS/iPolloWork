import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  detectBodyTocs,
  readOoxmlPackage,
  readOoxmlPart,
  canonicalOoxmlFingerprint,
} from '../../store/package/index.ts';
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
const text = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
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
test('full refresh replaces cached entries sharing field boundary paragraphs', async () => {
  const body =
    p(begin('TOC \\o &quot;1-1&quot;') + text('Stale Alpha')) +
    p(text('Stale Beta') + end) +
    heading('Fresh Alpha') +
    heading('Fresh Beta');
  const { result, xml } = await refresh(body);
  expect(result).toEqual({ ok: true, changed: true });
  expect(xml).not.toContain('Stale Alpha');
  expect(xml).not.toContain('Stale Beta');
});
test('single-row TOC is detected when begin and end share a paragraph', () => {
  const bytes = docx(p(begin('TOC \\o &quot;1-1&quot;') + text('Alpha') + end) + heading('Alpha'));
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  expect(detectBodyTocs(parsed.part)).toHaveLength(1);
});

test('single-paragraph refresh retains outside text and does not duplicate identities', async () => {
  const body =
    p(
      text('Before field ') +
        begin('TOC \\o &quot;1-1&quot;') +
        text('Stale') +
        end +
        text(' After field 99')
    ) + heading('Fresh');
  const { result, xml } = await refresh(body);
  expect(result.ok).toBe(true);
  expect(xml).toContain('Before field ');
  expect(xml).toContain(' After field 99');
  expect(xml).not.toContain('Stale');
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const ids = new Set<string>();
  const walk = (node: import('../../store/package/index.ts').OoxmlNode) => {
    expect(ids.has(node.id)).toBe(false);
    ids.add(node.id);
    if (node.kind !== 'textValue') node.children.forEach(walk);
  };
  walk(parsed.part.root);
  expect(detectBodyTocs(parsed.part)).toHaveLength(1);
});

test('page-number-only updates touch the cached result, not the suffix', async () => {
  const row =
    begin('TOC \\o &quot;1-1&quot;') + text('Alpha') + '<w:r><w:tab/></w:r>' + text('8') + end;
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container });
  try {
    editor.load(docx(p(row + text(' Outside 99')) + heading('Alpha')));
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' }).ok).toBe(true);
    const saved = new Uint8Array(await editor.save());
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    expect(xml).toContain('<w:t>1</w:t>');
    expect(xml).not.toContain('<w:t>8</w:t>');
    expect(xml).toContain(' Outside 99');
    const first = readOoxmlPackage(saved);
    editor.load(saved);
    const second = readOoxmlPackage(new Uint8Array(await editor.save()));
    if (!first.ok || !second.ok) throw new Error('reopen failed');
    expect(canonicalOoxmlFingerprint(first.package.parts.get('/word/document.xml')!)).toBe(
      canonicalOoxmlFingerprint(second.package.parts.get('/word/document.xml')!)
    );
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('splitting a one-paragraph TOC keeps a section mark and paragraph identity only once', async () => {
  const body =
    '<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:sectPr/></w:pPr>' +
    begin('TOC \\o &quot;1-1&quot;') +
    text('Stale') +
    end +
    '</w:p>' +
    heading('Fresh');
  const { xml } = await refresh(body);
  expect(xml.match(/<w:sectPr/g)).toHaveLength(1);
  const ids = [...xml.matchAll(/w14:paraId="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
});

test('refresh refuses structural content inside a cached result without deleting it', async () => {
  for (const interior of [
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Keep table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    p('<w:pPr><w:sectPr/></w:pPr>' + text('Keep section')),
  ]) {
    const { result, xml } = await refresh(
      p(begin('TOC \\o &quot;1-1&quot;')) + interior + p(end) + heading('Fresh')
    );
    expect(result.ok).toBe(false);
    expect(xml).toContain(interior.includes('Keep table') ? 'Keep table' : 'Keep section');
  }
});

test('refresh refuses an inline content control inside the cached result', async () => {
  const control =
    '<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>' +
    text('Keep control') +
    '</w:sdtContent></w:sdt>';
  const { result, xml } = await refresh(
    p(begin('TOC \\o &quot;1-1&quot;') + control + end) + heading('Fresh')
  );
  expect(result.ok).toBe(false);
  expect(xml).toContain('Keep control');
});

test('page-only refresh refuses locked inline cached page numbers', async () => {
  const editor = createDocxEditor({ container: document.createElement('div') });
  try {
    const control =
      '<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>' +
      text('8') +
      '</w:sdtContent></w:sdt>';
    editor.load(
      docx(
        p(
          begin('TOC \\o &quot;1-1&quot;') + text('Alpha') + '<w:r><w:tab/></w:r>' + control + end
        ) + heading('Alpha')
      )
    );
    const before = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' }).ok).toBe(false);
    expect(strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!)).toBe(
      before
    );
  } finally {
    editor.destroy();
  }
});

test('refresh places the first entry beside the opening field marker, as Word does', async () => {
  // Desktop Word retains one result paragraph and one closing-marker paragraph.
  const { result, xml } = await refresh(
    p(begin('TOC \\o &quot;1-1&quot;') + text('Stale') + end) + heading('Fresh')
  );
  expect(result.ok).toBe(true);
  expect(xml.match(/<w:p[ >]/g)).toHaveLength(3);
  expect(xml.split('</w:p>')[0]).toContain('<w:t>Fresh</w:t>');
});

test('repeated refresh does not grow the TOC or move its first entry', async () => {
  const editor = createDocxEditor({ container: document.createElement('div') });
  try {
    editor.load(
      docx(
        p(begin('TOC \\o &quot;1-1&quot;') + text('Stale')) +
          p(end) +
          heading('Alpha') +
          heading('Beta')
      )
    );
    for (let i = 0; i < 3; i++) {
      expect(editor.exec({ type: 'refreshToc', mode: 'entire' }).ok).toBe(true);
      const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
      expect(xml.match(/<w:p[ >]/g)).toHaveLength(5);
      expect(xml.split('</w:p>')[0]).toContain('<w:t>Alpha</w:t>');
    }
  } finally {
    editor.destroy();
  }
});
