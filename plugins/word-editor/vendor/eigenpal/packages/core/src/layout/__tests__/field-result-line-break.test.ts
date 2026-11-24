import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

// A break inside a field's cached result. An atomic field paints its result over one model
// unit, and the result keeps each `w:br` / `w:cr` as a break. The break must end the line
// (and a page break the page) while the field stays one unit for the caret and offsets.

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  FIELD_ATOM_CHAR,
  PAGE_BREAK_CHAR,
  paragraphTextOf,
  readOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';
import { createFixedMeasurer } from '../index.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { MAX_FIELD_RESULT_BREAKS } from '../field-result-breaks.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { caretAt, caretStops, moveCaret } from '../semantic-interaction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const measurer = createFixedMeasurer(6, 14);

const t = (value: string) => `<w:t xml:space="preserve">${value}</w:t>`;
const run = (...content: string[]) => `<w:r>${content.join('')}</w:r>`;
const BR = '<w:br/>';
const RESULT = run(t('aaa '), BR, t('bbb '), BR, t('ccc'));

function complexField(instruction: string, result: string): string {
  return (
    run('<w:fldChar w:fldCharType="begin"/>') +
    run(`<w:instrText xml:space="preserve"> ${instruction} </w:instrText>`) +
    run('<w:fldChar w:fldCharType="separate"/>') +
    result +
    run('<w:fldChar w:fldCharType="end"/>')
  );
}
const simpleField = (instruction: string, result: string) =>
  `<w:fldSimple w:instr=" ${instruction} ">${result}</w:fldSimple>`;

function paragraphOf(body: string) {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const paragraph = parsed.part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
  return { part: parsed.part, paragraph };
}

function linesOf(body: string) {
  const { paragraph } = paragraphOf(body);
  return breakParagraph(paragraph, paragraph.id, 0, 400, measurer, undefined, null);
}
const lineTexts = (lines: ReturnType<typeof linesOf>) =>
  lines.map((line) => line.spans.map((span) => span.text).join(''));

describe('breaks inside a field result end the line', () => {
  for (const [label, field] of [
    ['complex MERGEFIELD', complexField('MERGEFIELD Name', RESULT)],
    ['complex DOCPROPERTY', complexField('DOCPROPERTY Title', RESULT)],
    ['simple QUOTE', simpleField('QUOTE x', RESULT)],
  ] as const) {
    test(label, () => {
      const body = `<w:p>${run(t('head '))}${field}${run(t(' tail'))}</w:p>`;
      const { part, paragraph } = paragraphOf(body);
      // The field stays ONE model unit.
      expect(paragraphTextOf(part, paragraph.id)).toBe(`head ${FIELD_ATOM_CHAR} tail`);
      const lines = linesOf(body);
      expect(lineTexts(lines)).toEqual(['head aaa \n', 'bbb \n', 'ccc tail']);
      expect(lines.map((line) => line.manualBreakAfter === true)).toEqual([true, true, false]);
      // Every part of the result, the breaks too, publishes the field's one-unit range.
      for (const span of lines.flatMap((line) => line.spans)) {
        if (span.text === 'head ' || span.text === ' ' || span.text === 'tail') continue;
        expect(span.range).toMatchObject({ start: 5, end: 6 });
      }
    });
  }

  test('a carriage return breaks the line and a tab does not', () => {
    const field = complexField('QUOTE y', run(t('ccr '), '<w:cr/>', t('ddr'), '<w:tab/>', t('ee')));
    const lines = linesOf(`<w:p>${field}${run(t(' tail'))}</w:p>`);
    expect(lineTexts(lines)).toEqual(['ccr \n', 'ddr\tee tail']);
    expect(lines[0]!.manualBreakAfter).toBe(true);
  });

  test('a break first in the result ends the line before it', () => {
    const field = complexField('MERGEFIELD First', run(BR, t('first')));
    const lines = linesOf(`<w:p>${run(t('head '))}${field}${run(t(' tail'))}</w:p>`);
    expect(lineTexts(lines)).toEqual(['head \n', 'first tail']);
  });

  test('a break last in the result moves the text after the field to the next line', () => {
    const field = complexField('MERGEFIELD Last', run(t('last'), BR));
    const lines = linesOf(`<w:p>${run(t('head '))}${field}${run(t(' tail'))}</w:p>`);
    expect(lineTexts(lines)).toEqual(['head last\n', ' tail']);
  });

  test('a page break in the result ends the page', () => {
    const field = simpleField('QUOTE pg', run(t('sss '), '<w:br w:type="page"/>', t('uuu')));
    const lines = linesOf(`<w:p>${run(t('head '))}${field}${run(t(' tail'))}</w:p>`);
    expect(lineTexts(lines)).toEqual([`head sss ${PAGE_BREAK_CHAR}`, 'uuu tail']);
    expect(lines[0]!.pageBreakAfter).toBe(true);
  });

  test('the cuts one result can add are bounded', () => {
    const many = Array.from({ length: MAX_FIELD_RESULT_BREAKS + 50 }, () => `${t('x')}${BR}`);
    const field = complexField('QUOTE many', run(...many));
    const { paragraph } = paragraphOf(`<w:p>${field}</w:p>`);
    const pieces = piecesOfParagraph(paragraph);
    expect(pieces.filter((piece) => piece.breakKind).length).toBe(MAX_FIELD_RESULT_BREAKS);
    expect(pieces.length).toBe(MAX_FIELD_RESULT_BREAKS * 2 + 1);
    // Nothing is lost: the uncut tail keeps the remaining text.
    expect(pieces.map((piece) => piece.text).join('')).toBe('x\n'.repeat(many.length));
  });
});

// --- Editor ------------------------------------------------------------------------------

function docx(paragraphs: readonly string[]): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}</w:body></w:document>`
    ),
  });
}

const open: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const editor = createDocxEditor({ container: document.createElement('div'), document: bytes });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const paragraphLines = (editor: DocxEditorInstance) =>
  editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []));

describe('the caret around a field whose result holds breaks', () => {
  // "head " (5) + the field atom (1) + " tail" (5).
  const FIELD_PARAGRAPH = `<w:p>${run(t('head '))}${complexField('MERGEFIELD Name', RESULT)}${run(t(' tail'))}</w:p>`;

  test('before the field sits on the first line, after it on the last', () => {
    const editor = mount(docx([FIELD_PARAGRAPH]));
    const layout = editor.surface!.layout();
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    const lines = paragraphLines(editor);
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      'head aaa \n',
      'bbb \n',
      'ccc tail',
    ]);
    const before = caretAt(layout, { paragraphId, offset: 5 });
    const after = caretAt(layout, { paragraphId, offset: 6 });
    expect(before?.lineId).toBe(lines[0]!.id);
    expect(after?.lineId).toBe(lines[2]!.id);
    // After the field means after its last glyph, not the start of the last line.
    expect(after!.x).toBeGreaterThan(lines[2]!.spans[0]!.box.x);

    // Keyboard stops agree with the drawn caret, and no stop falls inside the field.
    const stops = caretStops(layout).filter((stop) => stop.position.paragraphId === paragraphId);
    expect(stops.find((stop) => stop.position.offset === 6)?.lineId).toBe(lines[2]!.id);
    expect(stops.filter((stop) => stop.lineId === lines[1]!.id)).toEqual([]);
    expect(moveCaret(layout, { paragraphId, offset: 5 }, 'right')?.position.offset).toBe(6);
    expect(moveCaret(layout, { paragraphId, offset: 6 }, 'left')?.position.offset).toBe(5);
  });

  test('typing after the field lands after the result and survives save and reopen', async () => {
    const editor = mount(docx([FIELD_PARAGRAPH]));
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    const point = { paragraphId, offset: 6 };
    editor.surface!.setSelection({ anchor: point, head: point });
    editor.surface!.type('!');
    const texts = () =>
      paragraphLines(editor).map((line) => line.spans.map((span) => span.text).join(''));
    expect(texts()).toEqual(['head aaa \n', 'bbb \n', 'ccc! tail']);
    const reopened = mount(new Uint8Array(await editor.save()));
    expect(
      paragraphLines(reopened).map((line) => line.spans.map((span) => span.text).join(''))
    ).toEqual(texts());
  });

  test('a REF to a bookmark with a line break shows the break', () => {
    const editor = mount(
      docx([
        `<w:p><w:bookmarkStart w:id="1" w:name="bm"/>${run(t('bm1 '), BR, t('bm2'))}<w:bookmarkEnd w:id="1"/></w:p>`,
        `<w:p>${run(t('see '))}${complexField('REF bm \\h', run(t('bm1 '), BR, t('bm2')))}</w:p>`,
      ])
    );
    expect(
      paragraphLines(editor).map((line) => line.spans.map((span) => span.text).join(''))
    ).toEqual(['bm1 \n', 'bm2', 'see bm1 \n', 'bm2']);
  });

  test('a line break typed into a bookmark saves into the REF result and reopens', async () => {
    const editor = mount(
      docx([
        `<w:p><w:bookmarkStart w:id="1" w:name="bm"/>${run(t('alpha beta'))}<w:bookmarkEnd w:id="1"/></w:p>`,
        `<w:p>${run(t('see '))}${complexField('REF bm \\h', run(t('alpha beta')))}</w:p>`,
      ])
    );
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 6 },
    });
    surface.insertLineBreak();
    surface.setSelection({
      anchor: { paragraphId, offset: 6 },
      head: { paragraphId, offset: 10 },
    });
    // Typing over the bookmark's last word puts the new text after the bookmark's end, the way
    // typing at a bookmark's end does, so the bookmark now ends at the break.
    surface.type('gamma');
    const texts = (target: DocxEditorInstance) =>
      paragraphLines(target).map((line) => line.spans.map((span) => span.text).join(''));
    const painted = ['alpha\n', 'gamma', 'see alpha\n', ''];
    expect(texts(editor)).toEqual(painted);

    const saved = new Uint8Array(await editor.save());
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    const result = xml.slice(xml.indexOf('fldCharType="separate"'));
    expect(result).toMatch(/<w:t>alpha<\/w:t><w:br\/>/);
    expect(result.slice(0, result.indexOf('fldCharType="end"'))).not.toContain('gamma');
    expect(texts(mount(saved))).toEqual(painted);
  });

  test('a justified line ending at a break in a result stretches like a plain break', () => {
    const words = 'lorem ipsum dolor sit amet '.repeat(4);
    const JC = '<w:pPr><w:jc w:val="both"/></w:pPr>';
    const editor = mount(
      docx([
        `<w:p>${JC}${run(t(words))}${complexField('MERGEFIELD Jc', run(t('jjj '), BR, t('kkk')))}${run(t(' tail'))}</w:p>`,
        `<w:p>${JC}${run(t(words), t('jjj '), BR, t('kkk'))}${run(t(' tail'))}</w:p>`,
      ])
    );
    const lines = paragraphLines(editor);
    const brokenAt = (fieldParagraph: boolean) =>
      lines.find(
        (line) =>
          (line.range.paragraphId === editor.surface!.session.paragraphIds()[0]) ===
            fieldParagraph && line.spans.at(-1)?.text === '\n'
      )!;
    const rightEdge = (line: (typeof lines)[number]) => {
      const glyphs = line.spans.filter((span) => span.text.trim().length > 0);
      const last = glyphs.at(-1)!;
      return last.box.x + last.box.width;
    };
    const field = brokenAt(true);
    const plain = brokenAt(false);
    expect(field.spans.map((span) => span.text).join('')).toBe(
      plain.spans.map((span) => span.text).join('')
    );
    expect(rightEdge(field)).toBeCloseTo(rightEdge(plain), 3);
  });
});
