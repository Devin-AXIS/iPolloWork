// Delete and Backspace treat a control's prompt as one unit. The first press that reaches it
// selects it, and the next press removes the control. A range takes only the text around a prompt
// it takes part of, and removes a control it covers whole. A locked control keeps its prompt.
// Suggesting mode proposes the control's deletion in one press. Copy and cut take the whole
// prompt. A scripted deletion is not a keystroke: the store applies it as asked.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createBrowserAutomationHost } from '../automation-host.ts';
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
const lockOf = (lock?: string) => (lock ? `<w:lock w:val="${lock}"/>` : '');
/** "A " + prompt (offsets 2–27) + " B". */
const inline = (lock?: string, type = '<w:text/>') =>
  '<w:p>' +
  run('A ') +
  `<w:sdt><w:sdtPr>${lockOf(lock)}<w:tag w:val="value"/><w:showingPlcHdr/>${type}</w:sdtPr>` +
  `<w:sdtContent>${run(PROMPT)}</w:sdtContent></w:sdt>` +
  run(' B') +
  '</w:p>';
const INLINE = inline();
/** "before", then a block control whose prompt fills the second paragraph, then "after". */
const BLOCK =
  `<w:p>${run('before')}</w:p>` +
  '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:richText/></w:sdtPr>' +
  `<w:sdtContent><w:p>${run(PROMPT)}</w:p></w:sdtContent></w:sdt>` +
  `<w:p>${run('after')}</w:p>`;
const CELL =
  '<w:tbl><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc>' +
  `<w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${INLINE}</w:tc></w:tr></w:tbl><w:p/>`;

const mounted: (() => void)[] = [];
const mountedContainers = new WeakMap<object, HTMLElement>();
afterEach(() => mounted.splice(0).forEach((cleanup) => cleanup()));

function mount(body: string, author?: string, formsProtected = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    imageDecodePort: {
      async decode() {
        return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
      },
    },
    document: docx(body, formsProtected),
    ...(author === undefined ? {} : { author }),
  });
  mountedContainers.set(editor, container);
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

/** The selection as `[paragraph index, from, to]`, whichever way it points. */
function selected(surface: PaginatedSurface): [number, number, number] {
  const { anchor, head } = surface.state().selection;
  const paragraph = surface.session.paragraphIds().indexOf(head.paragraphId);
  return [paragraph, Math.min(anchor.offset, head.offset), Math.max(anchor.offset, head.offset)];
}

const controls = (surface: PaginatedSurface) => surface.layout().contentControls ?? [];

async function savedXml(editor: ReturnType<typeof mount>): Promise<string> {
  const part = unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!;
  return new TextDecoder().decode(part);
}
const struck = (xml: string) => xml.match(/<w:delText[^>]*>[^<]*<\/w:delText>/g) ?? [];

/** Removes markup tags, repeating until none remain so a removal cannot form a new tag. */
function stripTags(xml: string): string {
  let previous: string;
  let current = xml;
  do {
    previous = current;
    current = current.replace(/<[^>]+>/g, '');
  } while (current !== previous);
  return current;
}

const presses: readonly [string, number, (surface: PaginatedSurface) => void][] = [
  ['Delete at the start of the prompt', 2, (surface) => surface.deleteForward()],
  ['Backspace at the end of the prompt', 27, (surface) => surface.deleteBackward()],
  ['Backspace inside the prompt', 8, (surface) => surface.deleteBackward()],
  ['Delete inside the prompt', 8, (surface) => surface.deleteForward()],
  ['Ctrl+Backspace at the end of the prompt', 27, (surface) => surface.deleteWordBackward()],
  ['Ctrl+Delete at the start of the prompt', 2, (surface) => surface.deleteWordForward()],
];

for (const [name, offset, press] of presses) {
  test(`${name} selects the whole prompt and changes nothing`, () => {
    const surface = mount(INLINE).surface!;
    select(surface, offset);
    press(surface);
    expect(selected(surface)).toEqual([0, 2, 27]);
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
    expect(controls(surface)[0]!.placeholder).toBe(true);
    expect(surface.state().revision).toBe(0);
  });
}

for (const [name, offset, press] of [
  ['Backspace', 27, (surface: PaginatedSurface) => surface.deleteBackward()],
  ['Delete', 2, (surface: PaginatedSurface) => surface.deleteForward()],
] as const) {
  test(`${name} with the prompt selected removes the control, and undo brings it back`, () => {
    const surface = mount(INLINE).surface!;
    select(surface, offset);
    press(surface);
    press(surface);
    expect(surface.session.bodyText()).toBe('A  B');
    expect(controls(surface)).toHaveLength(0);
    expect(selected(surface)).toEqual([0, 2, 2]);
    surface.undo();
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
    expect(controls(surface)[0]!.placeholder).toBe(true);
    surface.redo();
    expect(controls(surface)).toHaveLength(0);
  });
}

test('a rich text control goes the same way', () => {
  const surface = mount(inline(undefined, '<w:richText/>')).surface!;
  select(surface, 27);
  surface.deleteBackward();
  expect(selected(surface)).toEqual([0, 2, 27]);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe('A  B');
  expect(controls(surface)).toHaveLength(0);
});

test('a word deletion with the prompt selected leaves it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 2, 27);
  surface.deleteWordBackward();
  surface.deleteWordForward();
  expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
  expect(selected(surface)).toEqual([0, 2, 27]);
  expect(surface.state().revision).toBe(0);
});

for (const lock of ['sdtLocked', 'contentLocked', 'sdtContentLocked']) {
  test(`a ${lock} control keeps its prompt under every press`, () => {
    const surface = mount(inline(lock)).surface!;
    select(surface, 27);
    surface.deleteBackward();
    expect(selected(surface)).toEqual([0, 2, 27]);
    surface.deleteBackward();
    surface.deleteForward();
    select(surface, 0, 10);
    surface.deleteForward();
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
    expect(controls(surface)[0]!.placeholder).toBe(true);
    expect(surface.state().revision).toBe(0);
  });
}

test('under forms protection a press selects the field prompt and never removes the field', () => {
  const surface = mount(INLINE, undefined, true).surface!;
  select(surface, 27);
  surface.deleteBackward();
  surface.deleteBackward();
  expect(selected(surface)).toEqual([0, 2, 27]);
  expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
  expect(surface.state().lastRejection).toBeNull();
});

test('a range from before the prompt into it takes only the text before it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.deleteForward();
  expect(surface.session.bodyText()).toBe(`${PROMPT} B`);
  expect(controls(surface)[0]!.placeholder).toBe(true);
  surface.undo();
  expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
});

test('a range from inside the prompt past it takes only the text after it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 10, 29);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`A ${PROMPT}`);
  expect(selected(surface)).toEqual([0, 27, 27]);
});

test('a range over the whole control removes it with the text around it', () => {
  for (const [body, after] of [
    [INLINE, ''],
    [inline('contentLocked'), ''],
    [inline('sdtLocked'), `A ${PROMPT} B`],
    [inline('sdtContentLocked'), `A ${PROMPT} B`],
  ] as const) {
    const surface = mount(body).surface!;
    select(surface, 0, 29);
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe(after);
    expect(controls(surface)).toHaveLength(after === '' ? 0 : 1);
  }
  const surface = mount(INLINE).surface!;
  select(surface, 1, 28);
  surface.deleteForward();
  expect(surface.session.bodyText()).toBe('AB');
  surface.undo();
  expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
  expect(controls(surface)[0]!.placeholder).toBe(true);
});

test('a range across paragraphs keeps the prompt it ends in whole', () => {
  const surface = mount(`<w:p>${run('X')}</w:p>${INLINE}`).surface!;
  const [first, second] = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: first!, offset: 0 },
    head: { paragraphId: second!, offset: 10 },
  });
  surface.deleteForward();
  expect(surface.session.bodyText()).toBe(`${PROMPT} B`);
  expect(controls(surface)[0]!.placeholder).toBe(true);
});

test('a block prompt is selected by the first press and removed by the second', () => {
  const surface = mount(BLOCK).surface!;
  select(surface, PROMPT.length, PROMPT.length, 1);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`before\n${PROMPT}\nafter`);
  expect(selected(surface)).toEqual([1, 0, PROMPT.length]);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe('before\n\nafter');
  expect(controls(surface)).toHaveLength(0);
  surface.undo();
  expect(surface.session.bodyText()).toBe(`before\n${PROMPT}\nafter`);
  expect(controls(surface)[0]!.placeholder).toBe(true);
});

test('a prompt in a table cell is selected, then removed', () => {
  const surface = mount(CELL).surface!;
  select(surface, 27);
  surface.deleteBackward();
  expect(selected(surface)).toEqual([0, 2, 27]);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe('A  B\n');
  expect(controls(surface)).toHaveLength(0);
});

test('in suggesting mode the first press proposes the control and the next steps over it', async () => {
  const editor = mount(INLINE, 'Ada');
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(surface, 27);
  surface.deleteBackward();
  const xml = await savedXml(editor);
  expect(struck(xml)).toEqual([`<w:delText>${PROMPT}</w:delText>`]);
  expect(xml).toMatch(/<w:del [^>]*><w:sdt>/);
  expect(selected(surface)).toEqual([0, 2, 2]);
  const revision = surface.state().revision;
  surface.deleteForward();
  expect(surface.state().revision).toBe(revision);
  surface.undo();
  expect(struck(await savedXml(editor))).toEqual([]);
});

test('in suggesting mode a range strikes the text around a prompt it takes part of', async () => {
  const editor = mount(INLINE, 'Ada');
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(surface, 0, 10);
  surface.deleteForward();
  const xml = await savedXml(editor);
  expect(struck(xml)).toEqual(['<w:delText xml:space="preserve">A </w:delText>']);
  expect(xml).toContain('<w:showingPlcHdr/>');
});

test('in suggesting mode a range over the whole control proposes it with the rest', async () => {
  const editor = mount(INLINE, 'Ada');
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(surface, 0, 29);
  surface.deleteForward();
  expect(struck(await savedXml(editor)).join('')).toContain(PROMPT);
});

test('copy and cut over part of a prompt take the whole prompt', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  expect(surface.copyFlavours().text).toBe(`A ${PROMPT}`);
  expect(selected(surface)).toEqual([0, 0, 27]);
  // A cut deletes what it copied: the control goes with the text before it.
  surface.deleteSelection();
  expect(surface.session.bodyText()).toBe(' B');
  expect(controls(surface)).toHaveLength(0);

  const inside = mount(INLINE).surface!;
  select(inside, 12, 5);
  expect(inside.copyFlavours().text).toBe(PROMPT);
  expect(inside.state().selection.anchor.offset).toBe(27);
});

test('in suggesting mode a cut over part of a prompt proposes the control with the text', async () => {
  const editor = mount(INLINE, 'Ada');
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(surface, 0, 10);
  expect(surface.copyFlavours().text).toBe(`A ${PROMPT}`);
  surface.deleteSelection();
  const xml = await savedXml(editor);
  expect(xml).toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*<w:sdt>/);
  expect(struck(xml).map(stripTags)).toEqual(['A ', PROMPT]);
});

test('a scripted deletion inside a prompt is applied, not dropped', () => {
  const editor = mount(INLINE);
  const host = createBrowserAutomationHost(editor);
  const [document] = host.execute({ operations: [{ op: 'getDocument' }] }).results;
  if (document?.status !== 'ok' || document.value.kind !== 'handle') throw new Error('document');
  const [body] = host.execute({
    operations: [{ op: 'getBody', document: document.value.handle }],
  }).results;
  if (body?.status !== 'ok' || body.value.kind !== 'handle') throw new Error('body');
  const [found] = host.execute({
    operations: [{ op: 'search', scope: { body: body.value.handle }, text: 'here ' }],
  }).results;
  if (found?.status !== 'ok' || found.value.kind !== 'spans') throw new Error('search');
  const response = host.execute({
    operations: [{ op: 'replaceSpan', span: found.value.spans[0]!, text: '' }],
  });
  expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
  expect(editor.surface!.session.bodyText()).toBe('A Click to enter text. B');
});

test('Backspace before the prompt still deletes the text before it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 2);
  surface.deleteBackward();
  expect(surface.session.bodyText()).toBe(`A${PROMPT} B`);
});

test('the first keystroke after a kept prompt still replaces it whole', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 8);
  surface.deleteBackward();
  surface.type('Z');
  expect(surface.session.bodyText()).toBe('A Z B');
});

for (const backwards of [false, true]) {
  test(`typing over a range ending inside a prompt keeps the prompt (backwards=${backwards})`, async () => {
    const editor = mount(INLINE);
    const surface = editor.surface!;
    select(surface, backwards ? 10 : 0, backwards ? 0 : 10);
    surface.type('Z');
    expect(surface.session.bodyText()).toBe(`Z${PROMPT} B`);
    expect(controls(surface)[0]!.placeholder).toBe(true);
    expect(selected(surface)).toEqual([0, 1, 1]);
    const xml = await savedXml(editor);
    expect(xml).toContain('showingPlcHdr');
    surface.undo();
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
    surface.redo();
    expect(surface.session.bodyText()).toBe(`Z${PROMPT} B`);
  });
}

test('typing continues before a prompt kept by a range replacement', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.type('Z');
  surface.type('Y');
  expect(surface.session.bodyText()).toBe(`ZY${PROMPT} B`);
});

test('buffered typing and one-line paste continue before a preserved prompt', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.enqueueType('XY');
  surface.flushPendingInput();
  surface.insertPlainText('Z');
  surface.type('!');
  expect(surface.session.bodyText()).toBe(`XYZ!${PROMPT} B`);
  expect(selected(surface)).toEqual([0, 4, 4]);
});

test('moving away and back clears the retained prompt boundary', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.type('Z');
  select(surface, 0);
  select(surface, 1);
  surface.type('Y');
  expect(surface.session.bodyText()).toBe('ZY B');
  expect(controls(surface)[0]!.placeholder).toBe(false);
});

test('a tracked range replacement preserves its prompt through continuation', async () => {
  const editor = mount(INLINE, 'Alice');
  const surface = editor.surface!;
  surface.setEditingMode('suggest');
  select(surface, 0, 10);
  surface.type('Z');
  surface.type('Y');
  expect(surface.session.bodyText()).toBe(`A ZY${PROMPT} B`);
  expect(controls(surface)[0]!.placeholder).toBe(true);
  const xml = await savedXml(editor);
  expect(xml).toContain('<w:delText xml:space="preserve">A </w:delText>');
  expect(xml).not.toContain(`<w:delText>${PROMPT}</w:delText>`);
});

test('cross-paragraph replacement preserves an ending inline prompt', () => {
  const surface = mount(`<w:p>${run('before')}</w:p>${INLINE}`).surface!;
  const [first, second] = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: first!, offset: 2 },
    head: { paragraphId: second!, offset: 10 },
  });
  surface.type('XYZ');
  surface.type('!');
  expect(surface.session.bodyText()).toBe(`beXYZ!${PROMPT} B`);
});

test('multiline plain paste keeps the ending prompt and later typing outside it', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.insertPlainText('one\ntwo');
  surface.type('!');
  expect(surface.session.bodyText()).toBe(`one\ntwo!${PROMPT} B`);
  expect(controls(surface)[0]!.placeholder).toBe(true);
});

test('composition replaces only the text before a partial prompt and continues outside it', () => {
  const editor = mount(INLINE);
  const surface = editor.surface!;
  const pages = mountedContainers.get(editor)!.querySelector('.docx-pages')!;
  select(surface, 0, 10);
  for (const text of ['韓', '語']) {
    pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const end = new CompositionEvent('compositionend', { bubbles: true });
    Object.defineProperty(end, 'data', { value: text });
    pages.dispatchEvent(end);
  }
  surface.type('!');
  expect(surface.session.bodyText()).toBe(`韓語!${PROMPT} B`);
  expect(selected(surface)).toEqual([0, 3, 3]);
});

for (const lock of ['contentLocked', 'sdtContentLocked']) {
  test(`typing over a partial ${lock} prompt refuses the whole replacement`, () => {
    const surface = mount(inline(lock)).surface!;
    select(surface, 0, 10);
    surface.type('Z');
    expect(surface.session.bodyText()).toBe(`A ${PROMPT} B`);
  });
}

test('redo restores the outside prompt boundary for the next keystroke', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.type('Z');
  surface.type('Y');
  surface.undo();
  surface.type('X');
  expect(surface.session.bodyText()).toBe(`ZX${PROMPT} B`);
  surface.undo();
  surface.redo();
  surface.type('!');
  expect(surface.session.bodyText()).toBe(`ZX!${PROMPT} B`);
});

test('an explicit same-position selection enters the prompt again', () => {
  const surface = mount(INLINE).surface!;
  select(surface, 0, 10);
  surface.type('Z');
  select(surface, 1);
  surface.type('Y');
  expect(surface.session.bodyText()).toBe('ZY B');
});

test('font changes preserve the outside prompt caret', async () => {
  const editor = mount(INLINE);
  const surface = editor.surface!;
  select(surface, 0, 10);
  surface.type('Z');
  await editor.setFonts(undefined);
  expect(editor.surface).toBe(surface);
  surface.type('Y');
  expect(surface.session.bodyText()).toBe(`ZY${PROMPT} B`);
});

test('a DOM selection echo preserves the outside prompt caret', async () => {
  const editor = mount(INLINE);
  const surface = editor.surface!;
  select(surface, 0, 10);
  surface.type('Z');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const container = mountedContainers.get(editor)!;
  const span = container.querySelector<HTMLElement>('[data-start="0"]')!;
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode()!;
  document.getSelection()!.setBaseAndExtent(text, 1, text, 1);
  document.dispatchEvent(new Event('selectionchange'));
  surface.type('Y');
  expect(surface.session.bodyText()).toBe(`ZY${PROMPT} B`);
});

for (const mode of ['edit', 'suggest'] as const) {
  for (const action of ['insertTab', 'insertLineBreak', 'insertPageBreak'] as const) {
    for (const continued of [false, true]) {
      test(`${action} preserves a partial prompt in ${mode} mode (${continued ? 'continued' : 'direct'})`, async () => {
        const editor = mount(INLINE, 'Alice');
        const surface = editor.surface!;
        surface.setEditingMode(mode);
        select(surface, 0, 10);
        if (continued) surface.type('Z');
        surface[action]();
        surface.type('X');
        expect(controls(surface)).toHaveLength(1);
        expect(controls(surface)[0]!.placeholder).toBe(true);
        expect(surface.session.bodyText()).toContain(`X${PROMPT} B`);
        expect(surface.state().lastRejection).toBeNull();
        const xml = await savedXml(editor);
        expect(xml).toContain('showingPlcHdr');
        if (mode === 'suggest') expect(xml).toContain('<w:ins');
        surface.undo();
        surface.undo();
        surface.redo();
        surface.type('Y');
        expect(surface.session.bodyText()).toContain(`Y${PROMPT} B`);
        expect(controls(surface)[0]!.placeholder).toBe(true);
      });
    }
  }
}

for (const mode of ['edit', 'suggest'] as const) {
  test(`image insertion stays outside a retained prompt in ${mode} mode`, async () => {
    const editor = mount(INLINE, 'Alice');
    const surface = editor.surface!;
    surface.setEditingMode(mode);
    select(surface, 0, 10);
    surface.type('Z');
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        ),
        (c) => c.charCodeAt(0)
      ),
      mime: 'image/png',
      widthPoints: 10,
      heightPoints: 10,
    });
    expect(result.ok).toBe(true);
    const xml = await savedXml(editor);
    expect(xml).toContain('<w:drawing');
    expect(xml.match(/<w:sdtContent>([\s\S]*?)<\/w:sdtContent>/)?.[1]).not.toContain('<w:drawing');
    expect(controls(surface)[0]?.placeholder).toBe(true);
    surface.undo();
    expect(await savedXml(editor)).not.toContain('<w:drawing');
    surface.redo();
    expect(
      (await savedXml(editor)).match(/<w:sdtContent>([\s\S]*?)<\/w:sdtContent>/)?.[1]
    ).not.toContain('<w:drawing');
  });
}

test('chart insertion stays outside a retained prompt', async () => {
  const editor = mount(INLINE);
  const surface = editor.surface!;
  select(surface, 0, 10);
  surface.type('Z');
  expect(editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
  const xml = await savedXml(editor);
  expect(xml).toContain('<w:drawing');
  expect(xml.match(/<w:sdtContent>([\s\S]*?)<\/w:sdtContent>/)?.[1]).not.toContain('<w:drawing');
  expect(controls(surface)[0]?.placeholder).toBe(true);
});
