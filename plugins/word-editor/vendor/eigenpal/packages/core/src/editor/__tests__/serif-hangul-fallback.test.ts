// The glyphs that a serif Korean face lacks fall back to a serif Hangul face, and measurement
// falls back to the same face as paint.
//
// The glyphs missing from a font table entry with `w:family` roman and `w:charset` 81 draw in
// Batang. The browser fell back to the sans-serif end of the Latin stack instead, which
// drew a Gothic glyph inside serif text.

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { fontTableSerifHangulFace } from '../../store/package/font-table-alternates.ts';
import {
  DEFAULT_CANVAS_FONT_STACK,
  fallbackStackForFamily,
  tryCreateCanvasMeasurer,
  type CanvasTextContext,
} from '../../layout/canvas-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../../layout/run-style.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { browserFallbackMeasurer } from '../resolved-font-measurement.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SERIF_HANGUL_STACK = 'Batang, AppleMyungjo, "Noto Serif CJK KR", serif';

const entry = (name: string, children: string) => `<w:font w:name="${name}">${children}</w:font>`;
const SERIF = entry('Hanbit Myeongjo', '<w:charset w:val="81"/><w:family w:val="roman"/>');
const GOTHIC = entry('Hanbit Gothic', '<w:charset w:val="81"/><w:family w:val="swiss"/>');

const run = (family: string, text: string) =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${family}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

/** A document with a font table, and Hangul runs set in its serif and Gothic faces. */
function documentBytes(fontTable: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="f" Type="${R}/fontTable" Target="fontTable.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${run('Hanbit Myeongjo', '리프팅')}${run('Hanbit Gothic', '뺨')}</w:body></w:document>`
    ),
    'word/fontTable.xml': strToU8(`<w:fonts xmlns:w="${W}">${fontTable}</w:fonts>`),
  });
}

function packageOf(fontTable: string) {
  const opened = openHeadlessDocument(documentBytes(fontTable));
  if (!opened.ok) throw new Error(opened.reason);
  return opened.view.currentPackage();
}

/** A 2d context that records each font shorthand it measures with. */
function recordingContext(fonts: string[]): CanvasTextContext {
  let current = '';
  return {
    get font() {
      return current;
    },
    set font(value: string) {
      current = value;
    },
    measureText(text: string) {
      fonts.push(current);
      return { width: text.length * 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
  };
}

const hangulStyle = (family: string) => ({ ...DEFAULT_RUN_STYLE, fontFamily: family });

const originalGetContext = HTMLCanvasElement.prototype.getContext;
let editor: DocxEditorInstance | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  document.body.replaceChildren();
});

test('the font table names the serif faces of the Korean character sets', () => {
  const table = [
    SERIF,
    GOTHIC,
    entry('Johab Myeongjo', '<w:charset w:val="82"/><w:family w:val="roman"/>'),
    entry('Latin Roman', '<w:charset w:val="00"/><w:family w:val="roman"/>'),
    entry(
      'Hanbit Fixed',
      '<w:charset w:val="81"/><w:family w:val="roman"/><w:pitch w:val="fixed"/>'
    ),
    entry('Hanbit Plain', '<w:charset w:val="81"/>'),
  ].join('');
  const serif = fontTableSerifHangulFace(packageOf(table));
  expect(serif('Hanbit Myeongjo')).toBe(true);
  expect(serif(' hanbit myeongjo ')).toBe(true);
  expect(serif('Johab Myeongjo')).toBe(true);
  for (const family of ['Hanbit Gothic', 'Latin Roman', 'Hanbit Fixed', 'Hanbit Plain', 'Other'])
    expect(serif(family)).toBe(false);
  // One lookup per font table, so paint can key its reuse on the lookup.
  const pkg = packageOf(table);
  expect(fontTableSerifHangulFace(pkg)).toBe(fontTableSerifHangulFace(pkg));
});

test('a serif Korean face falls back to serif Hangul faces, not to the sans-serif stack', () => {
  const serif = fontTableSerifHangulFace(packageOf(SERIF + GOTHIC));
  expect(fallbackStackForFamily('Hanbit Myeongjo', undefined, serif)).toBe(SERIF_HANGUL_STACK);
  expect(fallbackStackForFamily('Hanbit Gothic', undefined, serif)).toBe(DEFAULT_CANVAS_FONT_STACK);
  expect(fallbackStackForFamily('Hanbit Myeongjo')).toBe(DEFAULT_CANVAS_FONT_STACK);
});

test('the canvas measures a serif Korean face with the stack that paint uses', () => {
  const fonts: string[] = [];
  const serif = fontTableSerifHangulFace(packageOf(SERIF + GOTHIC));
  const measurer = tryCreateCanvasMeasurer({
    context: recordingContext(fonts),
    fontAlias: (family) => (family === 'Hanbit Myeongjo' ? 'docx-embedded-1' : undefined),
    serifHangulFace: serif,
  })!;
  measurer.measure('리프팅', hangulStyle('Hanbit Myeongjo'));
  measurer.measure('뺨', hangulStyle('Hanbit Gothic'));
  expect(fonts[0]).toEndWith(`"docx-embedded-1", "Hanbit Myeongjo", ${SERIF_HANGUL_STACK}`);
  expect(fonts[1]).toEndWith(`"Hanbit Gothic", ${DEFAULT_CANVAS_FONT_STACK}`);
});

test('the fallback measurer behind shaping reads the font table of the document', () => {
  const fonts: string[] = [];
  HTMLCanvasElement.prototype.getContext = (() =>
    recordingContext(fonts)) as unknown as typeof originalGetContext;
  const pkg = packageOf(SERIF);
  const { measurer } = browserFallbackMeasurer(document.createElement('div'), 1, {
    currentPackage: () => pkg,
  });
  measurer.measure('팅', hangulStyle('Hanbit Myeongjo'));
  expect(fonts[0]).toEndWith(`"Hanbit Myeongjo", ${SERIF_HANGUL_STACK}`);
});

test('the editor paints and measures a serif Korean face with serif Hangul fallbacks', async () => {
  const fonts: string[] = [];
  HTMLCanvasElement.prototype.getContext = (() =>
    recordingContext(fonts)) as unknown as typeof originalGetContext;
  const container = document.createElement('div');
  document.body.append(container);
  editor = createDocxEditor({ container, document: documentBytes(SERIF + GOTHIC) });
  for (let attempt = 0; attempt < 100 && !container.querySelector('.layout-run-text'); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const painted = (text: string) =>
    [...container.querySelectorAll<HTMLElement>('.layout-run-text')].find(
      (span) => span.textContent === text
    )!;
  expect(painted('리프팅').style.fontFamily).toEndWith(SERIF_HANGUL_STACK);
  expect(painted('뺨').style.fontFamily).toEndWith('sans-serif');
  expect(fonts.some((font) => font.endsWith(`"Hanbit Myeongjo", ${SERIF_HANGUL_STACK}`))).toBe(
    true
  );
});
