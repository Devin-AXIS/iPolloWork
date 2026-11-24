import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { afterEach, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const complex = (instruction: string, text: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run(text) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
function mount(body: string | Uint8Array, mode: 'edit' | 'view' = 'edit') {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: typeof body === 'string' ? docx(body) : body,
    mode,
  });
  editors.push(editor);
  const key = (mods: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: 'F9',
      altKey: true,
      bubbles: true,
      cancelable: true,
      ...mods,
    });
    container.querySelector('.docx-pages')!.dispatchEvent(event);
    return event;
  };
  return { container, editor, key };
}
for (const instruction of [
  ' REF target \\h ',
  ' PAGEREF target \\h ',
  ' NOTEREF target ',
  ' FORMTEXT ',
  ' PAGE ',
  ' DDE inert inert ',
]) {
  for (const simple of [false, true]) {
    test(`Alt+F9 toggles ${simple ? 'simple' : 'complex'} ${instruction}`, () => {
      const field = simple
        ? `<w:fldSimple w:instr="${instruction}">${run('Cached')}</w:fldSimple>`
        : complex(instruction, 'Cached');
      const { container, editor, key } = mount(
        `<w:p>${run('Before ')}${field}${run(' after')}</w:p>`
      );
      const before = serializeOoxmlPart(editor.surface!.session.part());
      const visible = container.textContent;
      expect(key().defaultPrevented).toBe(true);
      expect(container.textContent).toContain(`{${instruction}}`);
      expect(container.textContent).not.toContain('Cached');
      expect(serializeOoxmlPart(editor.surface!.session.part())).toBe(before);
      key();
      expect(container.textContent).toBe(visible);
      expect(serializeOoxmlPart(editor.surface!.session.part())).toBe(before);
    });
  }
}
test('unrelated modifiers and composition do not toggle field codes', () => {
  const { container, key } = mount(`<w:p>${complex(' REF target ', 'Cached')}</w:p>`);
  for (const mods of [
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: false },
    { isComposing: true },
  ]) {
    expect(key(mods).defaultPrevented).toBe(false);
    expect(container.textContent).toContain('Cached');
  }
});
test('TOC codes replace generated paragraphs and preserve text beside closing markers', () => {
  const { container, editor, key } = mount(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
      `<w:p>${run('Generated entry')}</w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r>${run('Ordinary heading')}</w:p>`
  );
  const before = serializeOoxmlPart(editor.surface!.session.part());
  expect(container.textContent).toContain('Generated entry');
  key();
  expect(container.textContent).toContain('{ TOC \\o "1-3" \\h }');
  expect(container.textContent).not.toContain('Generated entry');
  expect(container.textContent).toContain('Ordinary heading');
  key();
  expect(container.textContent).toContain('Generated entry');
  expect(serializeOoxmlPart(editor.surface!.session.part())).toBe(before);
});
test('empty-cache and nested fields show their instructions', () => {
  const { container, key } = mount(
    `<w:p>${complex(' REF missing ', '')}</w:p><w:p>` +
      '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> IF </w:instrText><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>1</w:t><w:fldChar w:fldCharType="end"/><w:instrText> = 1 "First" "Later" </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>First</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
  key();
  expect(container.textContent).toContain('{ REF missing }');
  expect(container.textContent).toContain('{ IF { PAGE } = 1 "First" "Later" }');
});

test('field codes are local to one editor and work in viewing mode', () => {
  const body = `<w:p>${complex(' REF target ', 'Cached')}</w:p>`;
  const first = mount(body, 'view');
  const second = mount(body);
  first.key();
  expect(first.container.textContent).toContain('{ REF target }');
  expect(second.container.textContent).toContain('Cached');
  expect(first.editor.snapshot().canUndo).toBe(false);
});

test('field-code inspection refuses invisible form-value edits and allows surrounding text edits', () => {
  const { editor, key } = mount(`<w:p>${complex(' FORMTEXT ', 'Value')}${run(' tail')}</w:p>`);
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 2 }, head: { paragraphId, offset: 2 } });
  const before = serializeOoxmlPart(surface.session.part());
  key();
  expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(false);
  expect(serializeOoxmlPart(surface.session.part())).toBe(before);
  surface.setSelection({ anchor: { paragraphId, offset: 10 }, head: { paragraphId, offset: 10 } });
  expect(editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  key();
  expect(serializeOoxmlPart(surface.session.part())).toContain('!');
});

test('fields in tables, notes, headers, and footers toggle without changing saved XML', async () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const table = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p>${complex(' MERGEFIELD cell ', 'Cached cell')}</w:p></w:tc></w:tr></w:tbl>`;
  const parts = unzipSync(
    docx(
      table +
        '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/></w:sectPr>'
    )
  );
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']!).replace('<w:document ', `<w:document xmlns:r="${R}" `)
  );
  let types = strFromU8(parts['[Content_Types].xml']!);
  for (const [name, root, kind] of [
    ['header1', 'hdr', 'header'],
    ['footer1', 'ftr', 'footer'],
    ['footnotes', 'footnotes', 'footnotes'],
  ]) {
    const field = complex(` MERGEFIELD ${kind} `, `Cached ${kind}`);
    const content = `<w:p>${field}</w:p>`;
    parts[`word/${name}.xml`] = strToU8(
      `<w:${root} xmlns:w="${W}">${kind === 'footnotes' ? `<w:footnote w:id="1">${content}</w:footnote>` : content}</w:${root}>`
    );
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`
    );
  }
  parts['[Content_Types].xml'] = strToU8(types);
  parts['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="${R}/header" Target="header1.xml"/><Relationship Id="footer" Type="${R}/footer" Target="footer1.xml"/><Relationship Id="notes" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
  );
  const { container, editor, key } = mount(zipSync(parts));
  const before = new Uint8Array(await editor.save());
  for (const name of ['cell', 'header', 'footer', 'footnotes'])
    expect(container.textContent).toContain(`Cached ${name}`);
  key();
  for (const name of ['cell', 'header', 'footer', 'footnotes'])
    expect(container.textContent).toContain(`{ MERGEFIELD ${name} }`);
  expect(new Uint8Array(await editor.save())).toEqual(before);
  key();
  for (const name of ['cell', 'header', 'footer', 'footnotes'])
    expect(container.textContent).toContain(`Cached ${name}`);
});

test('hidden field formatting stays hidden in code view', () => {
  const hidden =
    '<w:fldSimple w:instr=" REF private "><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden result</w:t></w:r></w:fldSimple>';
  const { container, key } = mount(`<w:p>${run('Visible')}${hidden}</w:p>`);
  key();
  expect(container.textContent).toContain('Visible');
  expect(container.textContent).not.toContain('private');
  expect(container.textContent).not.toContain('Hidden result');
});

test('original and proposed views preserve field revision visibility', () => {
  const inserted = `<w:ins w:id="1" w:author="Reviewer">${complex(' REF inserted ', 'Inserted')}</w:ins>`;
  const deleted = `<w:del w:id="2" w:author="Reviewer">${complex(' REF deleted ', 'Deleted').replaceAll('w:t', 'w:delText')}</w:del>`;
  const { container, editor, key } = mount(`<w:p>${inserted}${deleted}</w:p>`);
  key();
  editor.surface!.setRevisionDisplayMode('original');
  expect(container.textContent).not.toContain('inserted');
  expect(container.textContent).toContain('deleted');
  editor.surface!.setRevisionDisplayMode('proposed');
  expect(container.textContent).toContain('inserted');
  expect(container.textContent).not.toContain('deleted');
});
