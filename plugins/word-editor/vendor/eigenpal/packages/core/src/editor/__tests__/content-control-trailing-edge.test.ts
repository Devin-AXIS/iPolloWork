// Typing at the trailing edge of an inline text control, beside an automatic
// inter-script gap.
//
// An automatic gap separates Latin letters or digits from East Asian text
// (`w:autoSpaceDE`, `w:autoSpaceDN`). The caret at the control's end sits after
// that gap, so the end of the control is not one hair to the caret's left.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { caretAt, createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { withAuthoredCjkGapMetric } from '../../layout/cjk-auto-spacing-metric-port.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(paragraph: string, protect = true): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">${protect ? '<w:documentProtection w:edit="forms" w:enforcement="1"/>' : ''}</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p>${paragraph}</w:p></w:body></w:document>`
    ),
  });
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const control = (text: string) =>
  '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:text/></w:sdtPr>' +
  `<w:sdtContent>${run(text)}</w:sdtContent></w:sdt>`;

/** A fixed-width measurer that prices the inter-script gap at a quarter of the font size. */
const measurer = withAuthoredCjkGapMetric(
  createFixedMeasurer(6, 14),
  (style) => style.fontSizePt / 4
);

const mounted: HTMLElement[] = [];
afterEach(() => mounted.splice(0).forEach((container) => container.remove()));

function mount(paragraph: string): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  const result = mountPaginatedSurface(container, docx(paragraph), { scale: 1, measurer });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.surface;
}

function caretAtControlEnd(surface: PaginatedSurface): void {
  const range = surface.layout().contentControls![0]!.range!;
  const position = { paragraphId: range.paragraphId, offset: range.end };
  surface.setSelection({ anchor: position, head: position });
}

test('a gap after the control puts the caret past the control box', () => {
  const surface = mount(run('번호 ') + control('26202') + run('의 값'));
  caretAtControlEnd(surface);
  const fragment = surface.layout().contentControls![0]!.fragments[0]!;
  const caret = caretAt(surface.layout(), surface.state().selection.head, measurer)!;
  // The precondition the regression needs: the caret is outside the control's own box.
  expect(caret.x).toBeGreaterThan(fragment.box.x + fragment.box.width + 0.25);
});

test('typing at the trailing edge continues the control across an inter-script gap', () => {
  const surface = mount(run('번호 ') + control('26202') + run('의 값'));
  caretAtControlEnd(surface);
  surface.type('X');
  expect(surface.session.bodyText()).toBe('번호 26202X의 값');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 3, end: 9 });
});

test('a Latin control followed by East Asian text keeps typing inside', () => {
  const surface = mount(control('Alpha') + run('값'));
  caretAtControlEnd(surface);
  surface.type('Z');
  expect(surface.session.bodyText()).toBe('AlphaZ값');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 0, end: 6 });
});

function mountEditor(paragraph: string) {
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  const editor = createDocxEditor({ container, document: docx(paragraph) });
  const surface = editor.surface!;
  caretAtControlEnd(surface);
  return { editor, surface };
}

test('commands at the trailing edge are admitted and land inside the control', () => {
  for (const command of [
    { type: 'insertText', text: 'X' },
    { type: 'pasteWithoutFormatting', text: 'X' },
  ] as const) {
    const { editor, surface } = mountEditor(run('A ') + control('value') + run(' B'));
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toEqual({ ok: true, changed: true });
    expect(surface.session.bodyText()).toBe('A valueX B');
    expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 2, end: 8 });
    editor.destroy();
  }
});

test('a caret past the trailing edge stays outside the form field', () => {
  const { editor, surface } = mountEditor(run('A ') + control('value') + run(' B'));
  const range = surface.layout().contentControls![0]!.range!;
  const past = { paragraphId: range.paragraphId, offset: range.end + 1 };
  surface.setSelection({ anchor: past, head: past });
  expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  expect(editor.exec({ type: 'pasteWithoutFormatting', text: 'X' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  // A form feed is a paragraph break in a paste, so admission refuses it the same way.
  const feed = { type: 'pasteWithoutFormatting', text: 'abc\fdef' } as const;
  expect(editor.can(feed)).toMatchObject({ ok: false, code: 'locked' });
  expect(surface.layout().contentControls).toHaveLength(1);
  expect(surface.session.bodyText()).toBe('A value B');
  editor.destroy();
});

test('a multi-line paste at the trailing edge never splits the control', () => {
  const { editor, surface } = mountEditor(run('A ') + control('value') + run(' B'));
  // Beside the control, a multi-line paste is outside the form field, so protection refuses it.
  const command = { type: 'pasteWithoutFormatting', text: 'abc\ndef' } as const;
  expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
  expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
  expect(surface.session.bodyText()).toBe('A value B');
  expect(surface.layout().contentControls).toHaveLength(1);
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 2, end: 7 });
  editor.destroy();
});

test('a suggested paste at the trailing edge is a tracked insertion inside the control', async () => {
  for (const [text, inside] of [
    ['X', true],
    ['one\ntwo', false],
  ] as const) {
    const container = document.createElement('div');
    document.body.append(container);
    mounted.push(container);
    const editor = createDocxEditor({
      container,
      document: docx(run('A ') + control('value') + run(' B'), false),
    });
    const surface = editor.surface!;
    surface.setAuthor('Reviewer');
    surface.setEditingMode('suggest');
    caretAtControlEnd(surface);
    expect(editor.exec({ type: 'pasteWithoutFormatting', text }).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const sdt = xml.slice(xml.indexOf('<w:sdt>'), xml.indexOf('</w:sdt>'));
    // One line joins the control as a proposal; more lines stay beside it, in one control.
    expect(sdt.includes('<w:ins ')).toBe(inside);
    expect(xml.split('<w:sdt>')).toHaveLength(2);
    editor.destroy();
  }
});

function mountWithPages(paragraph: string, protect = true) {
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  const result = mountPaginatedSurface(container, docx(paragraph, protect), { scale: 1, measurer });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

/**
 * What the browser does while an IME composes at the caret: it writes the composed text into
 * the painted span itself, and the surface reads the paragraph back at `compositionend`.
 * `writeAt` stands for a page that took the text somewhere other than the model's caret.
 */
function compose(
  surface: PaginatedSurface,
  container: HTMLElement,
  text: string,
  writeAt?: number
): void {
  const { paragraphId, offset: caret } = surface.state().selection.head;
  const offset = writeAt ?? caret;
  const pages = container.querySelector('.docx-pages')!;
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  const span = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id][data-start]')]
    .filter((each) => each.dataset.paragraphId === paragraphId)
    .find((each) => {
      const start = Number(each.dataset.start);
      return start < offset && offset <= start + (each.textContent ?? '').length;
    });
  if (!span) throw new Error(`no painted span ends at ${offset}`);
  const at = offset - Number(span.dataset.start);
  const painted = span.textContent ?? '';
  span.textContent = painted.slice(0, at) + text + painted.slice(at);
  pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
}

test('text composed at the trailing edge lands inside the control', () => {
  for (const [paragraph, after, range] of [
    [run('A ') + control('value') + run(' B'), 'A value한 B', { start: 2, end: 8 }],
    [run('회사: ') + control('자연인') + run('에서'), '회사: 자연인한에서', { start: 4, end: 8 }],
    [run('번호 ') + control('26202') + run('의 값'), '번호 26202한의 값', { start: 3, end: 9 }],
    [run('Value: ') + control('Bravo'), 'Value: Bravo한', { start: 7, end: 13 }],
  ] as const) {
    const { surface, container } = mountWithPages(paragraph);
    caretAtControlEnd(surface);
    compose(surface, container, '한');
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.bodyText()).toBe(after);
    expect(surface.layout().contentControls![0]!.range).toMatchObject(range);
    container.remove();
  }
});

test('consecutive compositions at the trailing edge stay in the control', () => {
  const { surface, container } = mountWithPages(run('회사: ') + control('자연인') + run('에서'));
  caretAtControlEnd(surface);
  // A Korean IME commits 하 and starts 나 when the next vowel takes the final consonant.
  compose(surface, container, '하');
  compose(surface, container, '나');
  expect(surface.session.bodyText()).toBe('회사: 자연인하나에서');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 4, end: 9 });
});

test('text composed past the trailing edge stays outside the form field', () => {
  const { surface, container } = mountWithPages(run('A ') + control('value') + run(' B'));
  const range = surface.layout().contentControls![0]!.range!;
  const past = { paragraphId: range.paragraphId, offset: range.end + 1 };
  surface.setSelection({ anchor: past, head: past });
  compose(surface, container, '한');
  expect(surface.session.bodyText()).toBe('A value B');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 2, end: 7 });
});

test('composed text that repeats the text after the control lands inside the control', () => {
  // The readback diff takes the longest common prefix, so `에` composed before `에서` resolves
  // to an offset past the control's end. The composition began at the trailing edge, and
  // inserting there gives the same paragraph, so the text joins the control and the caret
  // stays after it.
  for (const [paragraph, text, after, range] of [
    [
      run('회사: ') + control('자연인') + run('에서'),
      '에',
      '회사: 자연인에에서',
      { start: 4, end: 8 },
    ],
    [
      run('번호 ') + control('26202') + run('의 값'),
      '의',
      '번호 26202의의 값',
      { start: 3, end: 9 },
    ],
    [run('A ') + control('value') + run('e B'), 'e', 'A valueee B', { start: 2, end: 8 }],
    [run('A ') + control('value') + run('ab C'), 'ab', 'A valueabab C', { start: 2, end: 9 }],
  ] as const) {
    const { surface, container } = mountWithPages(paragraph);
    caretAtControlEnd(surface);
    compose(surface, container, text);
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.bodyText()).toBe(after);
    expect(surface.layout().contentControls![0]!.range).toMatchObject(range);
    expect(surface.state().selection.head.offset).toBe(range.end);
    container.remove();
  }
});

test('composed text the page took away from the caret keeps the offset rule', () => {
  // The composition began at the trailing edge, but the text arrived after ` B`. Placing it at
  // the caret would change other characters, so the insert keeps the diff's offset, outside the
  // control, where forms protection refuses it.
  const { surface, container } = mountWithPages(run('A ') + control('value') + run(' B'));
  caretAtControlEnd(surface);
  compose(surface, container, '한', 9);
  expect(surface.session.bodyText()).toBe('A value B');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 2, end: 7 });
});

test('a format armed at the trailing edge styles composed text that repeats the next text', () => {
  const { surface, container } = mountWithPages(run('A ') + control('value') + run('e B'), false);
  caretAtControlEnd(surface);
  surface.toggleRunProperty('b');
  compose(surface, container, 'e');
  expect(surface.state().lastRejection).toBeNull();
  const xml = serializeOoxmlPart(surface.session.part());
  const content = xml.slice(xml.indexOf('<w:sdtContent>'), xml.indexOf('</w:sdtContent>'));
  expect(content).toMatch(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>e<\/w:t><\/w:r>/);
});

test('text composed at a prompt trailing edge replaces the prompt and keeps the caret after it', () => {
  // The prompt is replaced whole, so the text lands where the prompt began. A caret counted
  // from the pressed offset sat past the paragraph's end, and every later keystroke was refused.
  const prompt =
    '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:showingPlcHdr/><w:text/></w:sdtPr>' +
    `<w:sdtContent>${run('Click')}</w:sdtContent></w:sdt>`;
  const { surface, container } = mountWithPages(run('A ') + prompt + run(' B'));
  caretAtControlEnd(surface);
  compose(surface, container, '한');
  expect(surface.session.bodyText()).toBe('A 한 B');
  expect(surface.state().selection.head.offset).toBe(3);
  surface.type('X');
  compose(surface, container, '글');
  expect(surface.state().lastRejection).toBeNull();
  expect(surface.session.bodyText()).toBe('A 한X글 B');
  expect(surface.layout().contentControls![0]!.range).toMatchObject({ start: 2, end: 5 });
});

test('a suggested insertion at a prompt trailing edge keeps the caret after the text', () => {
  // A tracked insertion keeps the prompt, so the text lands at the caret, not where the
  // prompt began, and the caret follows it.
  const prompt =
    '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:showingPlcHdr/><w:text/></w:sdtPr>' +
    `<w:sdtContent>${run('Click')}</w:sdtContent></w:sdt>`;
  for (const input of ['type', 'compose'] as const) {
    const { surface, container } = mountWithPages(run('A ') + prompt + run(' B'), false);
    surface.setAuthor('Reviewer');
    surface.setEditingMode('suggest');
    caretAtControlEnd(surface);
    if (input === 'type') surface.type('한');
    else compose(surface, container, '한');
    expect(surface.session.bodyText()).toBe('A Click한 B');
    expect(surface.state().selection.head.offset).toBe(8);
    container.remove();
  }
});
