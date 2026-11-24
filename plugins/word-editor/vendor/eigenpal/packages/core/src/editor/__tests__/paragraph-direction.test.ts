// Word's Left-to-Right / Right-to-Left Text Direction (issue #864), the alignment it pairs
// with, and the complex-script formatting a right-to-left run takes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { createDirectionChordHandler } from '../surface-direction-chord.ts';
import {
  alignmentAfterDirectionChange,
  changedFields,
  mixedFieldsOf,
  seedFields,
} from '../paragraph-dialog-fields.ts';
import type { ParagraphFormatRead } from '../paragraph-dialog-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Rtl"><w:name w:val="Rtl"/><w:pPr><w:bidi/></w:pPr></w:style>' +
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

function mount(source: string | Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: typeof source === 'string' ? docx(source) : source,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const p = (text: string, pPr = '', rPr = '') =>
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function parsed(body: string): OoxmlNode {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}

const xmlOf = (editor: DocxEditorInstance) => serializeOoxmlPart(editor.surface!.session.part());

function caretIn(editor: DocxEditorInstance, index: number, offset = 1): void {
  const id = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

function selectText(editor: DocxEditorInstance, from: number, to: number, end: number): void {
  const ids = editor.surface!.session.paragraphIds();
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[from]!, offset: 0 },
    head: { paragraphId: ids[to]!, offset: end },
  });
}

const RTL = { type: 'setParagraphDirection', direction: 'rtl' } as const;
const LTR = { type: 'setParagraphDirection', direction: 'ltr' } as const;

describe('paragraph direction', () => {
  test('switches a paragraph to right-to-left and back, and reports it', () => {
    const editor = mount(p('Hello 123') + p('second'));
    caretIn(editor, 0);
    expect(editor.snapshot().formatting?.direction).toBe('ltr');
    expect(editor.isActive(LTR)).toBe(true);

    expect(editor.exec(RTL)).toEqual({ ok: true, changed: true });
    expect(xmlOf(editor)).toContain('<w:bidi/>');
    expect(editor.snapshot().formatting?.direction).toBe('rtl');
    expect(editor.isActive(RTL)).toBe(true);
    // The logical text is untouched, and the other paragraph keeps its direction.
    expect(xmlOf(editor)).toContain('Hello 123');
    caretIn(editor, 1);
    expect(editor.snapshot().formatting?.direction).toBe('ltr');

    caretIn(editor, 0);
    expect(editor.exec(LTR)).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.direction).toBe('ltr');
  });

  test('a paragraph already in the requested direction is not an edit', () => {
    const editor = mount(p('Hello'));
    caretIn(editor, 0);
    expect(editor.exec(LTR)).toEqual({ ok: true, changed: false });
    expect(xmlOf(editor)).not.toContain('bidi');
    // The dialog's direction field agrees: `can` and `exec` both accept a no-op.
    const dialog = { type: 'setParagraphFormat', direction: 'ltr' } as const;
    expect(editor.can(dialog)).toEqual({ ok: true });
    expect(editor.exec(dialog)).toEqual({ ok: true, changed: false });
    expect(xmlOf(editor)).not.toContain('bidi');
  });

  test('explicit left-to-right overrides a right-to-left style and survives save', async () => {
    const editor = mount(p('שלום', '<w:pStyle w:val="Rtl"/>', '<w:rtl/>'));
    caretIn(editor, 0);
    expect(editor.snapshot().formatting?.direction).toBe('rtl');
    expect(editor.exec(LTR).ok).toBe(true);
    expect(xmlOf(editor)).toContain('<w:bidi w:val="0"/>');
    expect(editor.snapshot().formatting?.direction).toBe('ltr');

    const reopened = mount(new Uint8Array(await editor.save()));
    caretIn(reopened, 0);
    expect(reopened.snapshot().formatting?.direction).toBe('ltr');
    // Run direction is a separate property and is left alone.
    expect(xmlOf(reopened)).toContain('<w:rtl/>');
  });

  test('a mixed selection reads as mixed, and one press is one undo step', () => {
    const editor = mount(p('one', '<w:bidi/>') + p('two'));
    selectText(editor, 0, 1, 3);
    const formatting = editor.snapshot().formatting;
    expect(formatting?.direction).toBeUndefined();
    expect(formatting?.disagrees?.direction).toBe(true);
    expect(editor.isActive(RTL)).toBe(false);
    expect(editor.isActive(LTR)).toBe(false);

    expect(editor.exec(RTL)).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.direction).toBe('rtl');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.snapshot().formatting?.disagrees?.direction).toBe(true);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(editor.snapshot().formatting?.direction).toBe('rtl');
  });

  test('an empty paragraph takes a direction', () => {
    const editor = mount('<w:p/>');
    caretIn(editor, 0, 0);
    expect(editor.exec(RTL)).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.direction).toBe('rtl');
  });

  test('a paragraph inside a table cell takes a direction', () => {
    const editor = mount(
      '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
        p('cell') +
        '</w:tc></w:tr></w:tbl>' +
        p('after')
    );
    caretIn(editor, 0);
    expect(editor.exec(RTL).ok).toBe(true);
    const xml = xmlOf(editor);
    expect(xml.indexOf('<w:bidi/>')).toBeGreaterThan(xml.indexOf('<w:tc>'));
    expect(xml.indexOf('<w:bidi/>')).toBeLessThan(xml.indexOf('</w:tc>'));
  });

  test('invalid directions are refused with a typed reason', () => {
    const editor = mount(p('x'));
    const bad = { type: 'setParagraphDirection', direction: 'up' } as unknown as typeof RTL;
    expect(editor.can(bad).ok).toBe(false);
    expect(editor.exec(bad)).toMatchObject({ ok: false, code: 'invalidArgs' });
  });

  test('the Paragraph dialog sets direction and alignment together', () => {
    const editor = mount(p('text'));
    caretIn(editor, 0);
    const result = editor.exec({ type: 'setParagraphFormat', direction: 'rtl', alignment: 'left' });
    expect(result.ok).toBe(true);
    // Left in a right-to-left paragraph is its TRAILING edge, which Word spells `right`.
    expect(xmlOf(editor)).toContain('<w:jc w:val="right"/>');
    expect(editor.snapshot().formatting).toMatchObject({ direction: 'rtl', alignment: 'left' });
  });
});

describe('alignment is a physical edge in a right-to-left paragraph', () => {
  test('Align Right writes the leading edge and reads back as right', () => {
    const editor = mount(p('שלום', '<w:bidi/>', '<w:rtl/>'));
    caretIn(editor, 0);
    // No `w:jc`: a right-to-left paragraph starts at its right margin.
    expect(editor.snapshot().formatting?.alignment).toBe('right');
    expect(editor.exec({ type: 'setAlignment', align: 'left' }).ok).toBe(true);
    expect(xmlOf(editor)).toContain('<w:jc w:val="right"/>');
    expect(editor.snapshot().formatting?.alignment).toBe('left');
    expect(editor.exec({ type: 'setAlignment', align: 'right' }).ok).toBe(true);
    expect(xmlOf(editor)).toContain('<w:jc w:val="left"/>');
    expect(editor.isActive({ type: 'setAlignment', align: 'right' })).toBe(true);
  });
});

describe('formatting a right-to-left run writes the complex-script half', () => {
  test('Bold and a size pick reach w:bCs and w:szCs, and read back', () => {
    const editor = mount(p('مرحبا', '<w:bidi/>', '<w:rtl/>') + p('Latin'));
    selectText(editor, 0, 0, 5);
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(editor.snapshot().formatting?.bold).toBe(true);
    expect(editor.exec({ type: 'setMarkAttr', mark: 'fontSize', value: 28 }).ok).toBe(true);
    expect(editor.snapshot().formatting?.fontSizePt).toBe(14);
    const xml = xmlOf(editor);
    expect(xml).toContain('<w:bCs/>');
    expect(xml).toContain('<w:szCs w:val="28"/>');

    // A left-to-right run gets exactly what was asked for.
    selectText(editor, 1, 1, 5);
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(xmlOf(editor).match(/<w:bCs\/>/g)?.length).toBe(1);
  });
});

describe('Word direction chords', () => {
  const key = (type: string, init: KeyboardEventInit) => new KeyboardEvent(type, init);
  const rtlStory = parsed('<w:p><w:pPr><w:bidi/></w:pPr></w:p>');
  const ltrStory = parsed('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
  const chordWith = (root: OoxmlNode) => {
    const writes: unknown[] = [];
    const chord = createDirectionChordHandler(
      { setParagraphProperties: (entries) => writes.push(entries[0]?.paragraphDirection) },
      () => root
    );
    return { chord, writes };
  };

  test('Ctrl+Right Shift sets right-to-left, Ctrl+Left Shift left-to-right', () => {
    const { chord, writes } = chordWith(rtlStory);
    chord.keydown(key('keydown', { key: 'Control', ctrlKey: true }));
    chord.keydown(key('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true, location: 2 }));
    chord.keyup(key('keyup', { key: 'Shift', ctrlKey: true, location: 2 }));
    chord.keydown(key('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true, location: 1 }));
    chord.keyup(key('keyup', { key: 'Control', shiftKey: true }));
    expect(writes).toEqual(['rtl', 'ltr']);
  });

  test('a shortcut that only starts with the chord does not change direction', () => {
    const { chord, writes } = chordWith(rtlStory);
    chord.keydown(key('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true, location: 2 }));
    chord.keydown(key('keydown', { key: 'Z', ctrlKey: true, shiftKey: true }));
    chord.keyup(key('keyup', { key: 'Shift', ctrlKey: true, location: 2 }));
    // Cmd is not Word's chord on any platform.
    chord.keydown(key('keydown', { key: 'Shift', metaKey: true, ctrlKey: true, location: 2 }));
    chord.keyup(key('keyup', { key: 'Shift', location: 2 }));
    expect(writes).toEqual([]);
  });

  test('a pointer press or focus loss disarms, and a claimed release is left alone', () => {
    const { chord, writes } = chordWith(rtlStory);
    chord.keydown(key('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true, location: 2 }));
    chord.disarm();
    chord.keyup(key('keyup', { key: 'Shift', ctrlKey: true, location: 2 }));
    chord.keydown(key('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true, location: 2 }));
    const claimed = key('keyup', { key: 'Shift', ctrlKey: true, location: 2, cancelable: true });
    claimed.preventDefault();
    chord.keyup(claimed);
    expect(writes).toEqual([]);
  });

  test('a document with no right-to-left markup ignores the chord (the layout switch)', () => {
    const { chord, writes } = chordWith(ltrStory);
    chord.keydown(key('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true, location: 2 }));
    chord.keyup(key('keyup', { key: 'Shift', ctrlKey: true, location: 2 }));
    expect(writes).toEqual([]);
  });
});

describe('what the direction write leaves behind', () => {
  test('left-to-right removes a direct w:bidi rather than stating an off value', () => {
    const editor = mount(p('text', '<w:bidi/>'));
    caretIn(editor, 0);
    expect(editor.exec(LTR)).toEqual({ ok: true, changed: true });
    expect(xmlOf(editor)).not.toContain('bidi');
  });

  test('right-to-left drops a direct off value when the style is right-to-left', () => {
    const editor = mount(p('שלום', '<w:pStyle w:val="Rtl"/><w:bidi w:val="0"/>'));
    caretIn(editor, 0);
    expect(editor.exec(RTL)).toEqual({ ok: true, changed: true });
    expect(xmlOf(editor)).not.toContain('bidi');
    expect(editor.snapshot().formatting?.direction).toBe('rtl');
  });

  test('Clear Formatting keeps the paragraph direction', () => {
    const editor = mount(p('مرحبا', '<w:bidi/><w:jc w:val="center"/>', '<w:rtl/><w:b/>'));
    selectText(editor, 0, 0, 5);
    expect(editor.exec({ type: 'clearFormatting' }).ok).toBe(true);
    const xml = xmlOf(editor);
    expect(xml).toContain('<w:bidi/>');
    expect(xml).not.toContain('<w:jc');
  });

  test('the format painter copies each lane into its own properties', () => {
    const editor = mount(
      p(
        'مرحبا',
        '<w:bidi/>',
        '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Arial"/>' +
          '<w:sz w:val="20"/><w:szCs w:val="40"/><w:bCs/><w:rtl/>'
      ) + p('abc 漢字', '', '<w:rFonts w:eastAsia="MS Mincho"/><w:sz w:val="28"/>')
    );
    selectText(editor, 0, 0, 5);
    expect(editor.exec({ type: 'copyFormatting' }).ok).toBe(true);
    selectText(editor, 1, 1, 6);
    expect(editor.exec({ type: 'pasteFormatting' }).ok).toBe(true);
    const target = xmlOf(editor).split('</w:p>')[1]!;
    // The Latin lane from the source's Latin properties, the complex lane from its own.
    expect(target).toContain('<w:sz w:val="20"/>');
    expect(target).toContain('<w:szCs w:val="40"/>');
    expect(target).toContain('<w:b w:val="0"/>');
    expect(target).toContain('<w:bCs w:val="1"/>');
    expect(target).toContain('w:ascii="Courier New"');
    expect(target).toContain('w:cs="Arial"');
    // Never the complex face in the East Asian slot.
    expect(target).not.toContain('w:eastAsia="Arial"');
  });
});

describe('Paragraph dialog fields', () => {
  const read = (overrides: Partial<ParagraphFormatRead> = {}): ParagraphFormatRead => ({
    alignment: 'left',
    direction: 'ltr',
    spaceBeforePt: 0,
    spaceAfterPt: 0,
    lineSpacing: null,
    indentLeftTwips: 0,
    indentRightTwips: 0,
    indentFirstLineTwips: 0,
    contextualSpacing: false,
    keepNext: false,
    keepLines: false,
    widowControl: true,
    pageBreakBefore: false,
    tabStops: [],
    indentUnknown: false,
    disagrees: {
      alignment: false,
      direction: false,
      spaceBeforePt: false,
      spaceAfterPt: false,
      lineSpacing: false,
      tabStops: false,
      indentLeft: false,
      indentRight: false,
      indentFirstLine: false,
    },
    ...overrides,
  });

  test('a new direction writes only the direction, and the field shows the traded edge', () => {
    const seed = seedFields(read());
    expect(changedFields(seed, { ...seed, direction: 'rtl' })).toEqual({ direction: 'rtl' });
    // The field followed the swap: still only the direction.
    expect(changedFields(seed, { ...seed, direction: 'rtl', alignment: 'right' })).toEqual({
      direction: 'rtl',
    });
    // A deliberate pick after the swap is a change.
    expect(changedFields(seed, { ...seed, direction: 'rtl', alignment: 'center' })).toEqual({
      direction: 'rtl',
      alignment: 'center',
    });
    // The dialog's Alignment field follows, the way the paragraph itself moves.
    expect(alignmentAfterDirectionChange('left')).toBe('right');
    expect(alignmentAfterDirectionChange('right')).toBe('left');
    expect(alignmentAfterDirectionChange('center')).toBe('center');
    expect(alignmentAfterDirectionChange('justify')).toBe('justify');
  });

  test('a mixed direction opens as mixed and resolves when set', () => {
    const format = read({
      direction: null,
      disagrees: { ...read().disagrees, direction: true },
    });
    const seed = seedFields(format);
    const mixed = mixedFieldsOf(format);
    expect(mixed.direction).toBe(true);
    expect(changedFields(seed, seed, mixed, mixed)).toBeNull();
    expect(changedFields(seed, seed, mixed, { ...mixed, direction: false })).toMatchObject({
      direction: 'ltr',
    });
  });
});
