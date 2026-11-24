import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(body: string, formsProtected = false): Uint8Array {
  const SETTINGS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/settings.xml" ContentType="${SETTINGS}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">` +
        (formsProtected ? '<w:documentProtection w:edit="forms" w:enforcement="1"/>' : '') +
        '</w:settings>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const PROMPT = 'Click here to enter text.';
const INLINE = `<w:p>${run('A ')}<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent>${run(PROMPT)}</w:sdtContent></w:sdt>${run(' B')}</w:p>`;
const mounted: (() => void)[] = [];

afterEach(() => mounted.splice(0).forEach((cleanup) => cleanup()));

function mount(body: string, author?: string, formsProtected = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(body, formsProtected),
    ...(author === undefined ? {} : { author }),
  });

  mounted.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

function select(surface: PaginatedSurface, start: number, end = start, paragraph = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

const controls = (surface: PaginatedSurface) => surface.layout().contentControls ?? [];

async function savedXml(editor: ReturnType<typeof mount>): Promise<string> {
  const part = unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!;
  return new TextDecoder().decode(part);
}
for (const prefix of ['', 'Z']) {
  test(`rich paste preserves the ending prompt after ${prefix || 'range selection'}`, async () => {
    const editor = mount(INLINE);
    const surface = editor.surface!;
    select(surface, 0, 10);
    if (prefix) surface.type(prefix);
    expect(surface.pasteRich('bold', '<p><strong>bold</strong></p>')).toBe(true);
    expect(surface.session.bodyText()).toBe(`${prefix}bold${PROMPT} B`);
    expect(controls(surface).some((control) => control.placeholder)).toBe(true);
    surface.type('!');
    expect(surface.session.bodyText()).toBe(`${prefix}bold!${PROMPT} B`);
    expect(await savedXml(editor)).toContain('<w:b');
  });
}
test('multi-paragraph rich paste keeps the caret before the ending prompt', () => {
  const editor = mount(INLINE);
  const surface = editor.surface!;
  select(surface, 0, 10);
  expect(surface.pasteRich('one\ntwo', '<p><strong>one</strong></p><p>two</p>')).toBe(true);
  expect(surface.session.bodyText()).toBe(`one\ntwo${PROMPT} B`);
  surface.type('!');
  expect(surface.session.bodyText()).toBe(`one\ntwo!${PROMPT} B`);
});

for (const html of ['<p><strong>bold</strong></p>', '<p>one</p><p><strong>two</strong></p>']) {
  test(`rich paste restores the prompt boundary through undo and redo: ${html}`, () => {
    const surface = mount(INLINE).surface!;
    select(surface, 0, 10);
    expect(surface.pasteRich('plain', html)).toBe(true);
    const pasted = surface.session.bodyText();
    surface.undo();
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
    surface.redo();
    expect(surface.session.bodyText()).toBe(pasted);
    surface.type('!');
    expect(surface.session.bodyText()).toBe(pasted.replace(PROMPT, `!${PROMPT}`));
  });
}
test('suggested rich paste preserves the prompt and marks the replacement', async () => {
  const editor = mount(INLINE, 'Reviewer');
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(surface, 0, 10);
  expect(surface.pasteRich('bold', '<p><strong>bold</strong></p>')).toBe(true);
  surface.type('!');
  expect(controls(surface)[0]!.placeholder).toBe(true);
  const xml = await savedXml(editor);
  expect(xml).toContain('<w:ins');
  expect(xml).toContain('<w:del');
  expect(xml).toContain('<w:showingPlcHdr/>');
});

test('rich paste preserves hyperlink relationships and formatting after save and reopen', async () => {
  const editor = mount(INLINE);
  const surface = editor.surface!;
  select(surface, 0, 10);
  expect(
    surface.pasteRich(
      'linked',
      '<p><a href="https://example.com/test"><strong>linked</strong></a></p>'
    )
  ).toBe(true);
  const bytes = new Uint8Array(await editor.save());
  const parts = unzipSync(bytes);
  const xml = new TextDecoder().decode(parts['word/document.xml']);
  const rels = new TextDecoder().decode(parts['word/_rels/document.xml.rels']);
  expect(xml).toContain('<w:hyperlink');
  expect(xml).toContain('<w:b');
  expect(xml).toContain('<w:showingPlcHdr/>');
  expect(rels).toContain('https://example.com/test');
  const container = document.createElement('div');
  document.body.append(container);
  const reopened = createDocxEditor({ container, document: bytes });
  mounted.push(() => {
    reopened.destroy();
    container.remove();
  });
  expect(reopened.surface!.session.bodyText()).toBe(`linked${PROMPT} B`);
  expect(controls(reopened.surface!)[0]!.placeholder).toBe(true);
});

test('public paste command reports and preserves a formatted prompt replacement', async () => {
  const editor = mount(INLINE);
  const surface = editor.surface!;
  select(surface, 10, 0);
  const result = editor.exec({ type: 'paste', text: 'bold', html: '<p><strong>bold</strong></p>' });
  expect(result).toEqual({ ok: true, changed: true });
  expect(surface.session.bodyText()).toBe(`bold${PROMPT} B`);
  expect(await savedXml(editor)).toContain('<w:b');
});

test('rich paste across paragraphs retains the ending prompt', () => {
  const surface = mount(`<w:p>${run('before')}</w:p>${INLINE}`).surface!;
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 2 },
    head: { paragraphId: ids[1]!, offset: 10 },
  });
  expect(surface.pasteRich('bold', '<p><strong>bold</strong></p>')).toBe(true);
  expect(surface.session.bodyText()).toBe(`bebold${PROMPT} B`);
  surface.type('!');
  expect(surface.session.bodyText()).toBe(`bebold!${PROMPT} B`);
});

test('copied chart stays outside the partially selected ending prompt', async () => {
  const source = mount('<w:p/>');
  expect(source.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
  const flavours = source.surface!.copyFlavours();
  expect(flavours.html).toContain('data-docx-editor-chart=');
  const target = mount(INLINE);
  select(target.surface!, 0, 10);
  expect(target.surface!.pasteRich(flavours.text, flavours.html)).toBe(true);
  const xml = await savedXml(target);
  const promptXml = xml.match(/<w:sdt[ >][\s\S]*?<\/w:sdt>/)?.[0];
  expect(promptXml).toContain('<w:showingPlcHdr/>');
  expect(promptXml).not.toContain('drawing');
  expect(xml).toContain('drawing');
  target.surface!.undo();
  expect(target.surface!.session.bodyText()).toBe(`A ${PROMPT} B`);
  target.surface!.redo();
  expect(controls(target.surface!)[0]!.placeholder).toBe(true);
});
