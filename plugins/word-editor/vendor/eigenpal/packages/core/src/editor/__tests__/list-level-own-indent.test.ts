// A list item whose paragraph states its own indent moves to its new level's indent when its
// level changes. The level change drops the paragraph's own left, first-line and hanging
// indent, in twips and in character units, and keeps its right indent. An item that the
// command skips keeps its indent.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  // A style that numbers its paragraphs itself, with no `w:numPr` on the paragraph.
  '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
  // A style that states only the level, for a paragraph whose own `w:numPr` names the list.
  '<w:style w:type="paragraph" w:styleId="ListBulletTwo"><w:name w:val="List Bullet 2"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>';

const GLYPHS = ['•', 'o', '▪'];
/** Level n puts its marker at 720n + 360 twips and its text at 720(n + 1). */
const NUMBERING =
  '<w:abstractNum w:abstractNumId="0">' +
  Array.from(
    { length: 9 },
    (_, ilvl) =>
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${GLYPHS[ilvl % 3]}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
  ).join('') +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/>` +
        `<Relationship Id="rId3" Type="${NUM}" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${STYLES}</w:styles>`),
    'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${W}">${NUMBERING}</w:numbering>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string, ilvl: number, ind = '') =>
  paragraph(
    text,
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>${ind}`
  );

/** The indent from the issue: the item's own, between level 0's and level 1's. */
const OWN = '<w:ind w:left="1080" w:hanging="360" w:firstLine="0"/>';

const open: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(body: string, author?: string): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    author,
  });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const ids = (editor: DocxEditorInstance) => editor.surface!.session.paragraphIds();
const idOf = (editor: DocxEditorInstance, text: string) =>
  ids(editor).find((id) => paragraphTextOf(editor.surface!.session.part(), id) === text)!;
const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
/** The saved `w:pPr` content of the paragraph whose text is `text`. */
function savedProperties(editor: DocxEditorInstance, text: string): string {
  const xml = documentXml(editor.surface!.save());
  for (const match of xml.matchAll(/<w:p\b[^>]*>(.*?)<\/w:p>/g)) {
    if (!match[1]!.includes(`>${text}<`)) continue;
    // Greedy: a revision record nests the earlier `w:pPr` inside this one.
    return /<w:pPr>(.*)<\/w:pPr>/.exec(match[1]!)?.[1] ?? '';
  }
  throw new Error(`no paragraph "${text}"`);
}
/** The attributes of the paragraph's own saved `w:ind`, outside any revision record. */
function savedIndent(editor: DocxEditorInstance, text: string): Record<string, string> | null {
  const own = savedProperties(editor, text).replace(/<w:pPrChange\b.*<\/w:pPrChange>/, '');
  const ind = /<w:ind ([^>]*)\/>/.exec(own);
  if (!ind) return null;
  return Object.fromEntries(
    [...ind[1]!.matchAll(/w:(\w+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!])
  );
}
const OWN_ATTRIBUTES = { left: '1080', hanging: '360', firstLine: '0' };

/** Where the marker and the text of the paragraph whose text is `text` are painted. */
function geometry(editor: DocxEditorInstance, text: string) {
  for (const page of editor.surface!.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      const spans = fragment.lines.flatMap((line) => line.spans);
      if (spans.map((span) => span.text).join('') !== text) continue;
      return {
        glyph: fragment.marker?.text,
        level: fragment.marker?.level,
        marker: fragment.marker?.box.x,
        text: spans[0]!.box.x,
      };
    }
  }
  throw new Error(`no fragment "${text}"`);
}

function caretAt(editor: DocxEditorInstance, text: string): void {
  const point = { paragraphId: idOf(editor, text), offset: 0 };
  editor.surface!.setSelection({ anchor: point, head: point });
}

describe('a level change on a list item with its own indent', () => {
  test('Tab moves the item to the new level, beside an item already there', () => {
    const editor = mount(item('First', 0) + item('Own', 1, OWN) + item('Peer', 2));
    const before = geometry(editor, 'Own');
    caretAt(editor, 'Own');
    // Tab in a list item, Mod+M and the Increase Indent button all run this command.
    expect(editor.surface!.adjustIndent('increase')).toBe(true);
    const after = geometry(editor, 'Own');
    expect(after).toEqual(geometry(editor, 'Peer'));
    expect(after.glyph).toBe('▪');
    expect(after.text).not.toBe(before.text);
    expect(savedIndent(editor, 'Own')).toBeNull();
  });

  test('Shift+Tab moves it out to the outer level', () => {
    const editor = mount(item('Peer', 0) + item('Own', 1, OWN));
    caretAt(editor, 'Own');
    expect(editor.surface!.adjustIndent('decrease')).toBe(true);
    expect(geometry(editor, 'Own')).toEqual(geometry(editor, 'Peer'));
    expect(savedIndent(editor, 'Own')).toBeNull();
  });

  test('the right indent stays, and character units go with their twips', () => {
    const editor = mount(
      item('First', 0) +
        item('Right', 1, '<w:ind w:left="1080" w:right="500" w:hanging="360"/>') +
        item(
          'Chars',
          1,
          '<w:ind w:leftChars="200" w:left="1080" w:hangingChars="100" w:hanging="360" ' +
            'w:rightChars="100" w:right="200"/>'
        ) +
        item(
          'Start',
          1,
          '<w:ind w:start="1080" w:end="400" w:firstLineChars="150" w:firstLine="200"/>'
        )
    );
    const surface = editor.surface!;
    surface.setSelection({
      anchor: { paragraphId: idOf(editor, 'Right'), offset: 0 },
      head: { paragraphId: idOf(editor, 'Start'), offset: 5 },
    });
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(savedIndent(editor, 'Right')).toEqual({ right: '500' });
    expect(savedIndent(editor, 'Chars')).toEqual({ rightChars: '100', right: '200' });
    expect(savedIndent(editor, 'Start')).toEqual({ end: '400' });
  });

  test('an item the command skips keeps its indent', () => {
    const editor = mount(item('Top', 0, OWN) + item('Next', 1, OWN));
    const surface = editor.surface!;
    surface.setSelection({
      anchor: { paragraphId: idOf(editor, 'Top'), offset: 0 },
      head: { paragraphId: idOf(editor, 'Next'), offset: 4 },
    });
    // Level 0 has no outer level, so only `Next` moves.
    expect(surface.adjustIndent('decrease')).toBe(true);
    expect(savedIndent(editor, 'Top')).toEqual(OWN_ATTRIBUTES);
    expect(savedIndent(editor, 'Next')).toBeNull();
  });

  test('Enter on an empty item with its own indent outdents it to the outer level', () => {
    const editor = mount(item('Peer', 0) + item('', 1, OWN));
    const point = { paragraphId: ids(editor)[1]!, offset: 0 };
    editor.surface!.setSelection({ anchor: point, head: point });
    expect(editor.surface!.exitListOnEmptyItem()).toBe(true);
    const xml = documentXml(editor.surface!.save());
    expect(xml).not.toContain('<w:ilvl w:val="1"/>');
    expect(xml).not.toContain('<w:ind');
  });

  test('an item numbered through its style loses its own indent too', () => {
    const editor = mount(
      paragraph('Styled', `<w:pStyle w:val="ListBullet"/>${OWN}`) + item('Peer', 1)
    );
    caretAt(editor, 'Styled');
    expect(editor.surface!.adjustIndent('increase')).toBe(true);
    expect(geometry(editor, 'Styled')).toEqual(geometry(editor, 'Peer'));
    expect(savedIndent(editor, 'Styled')).toBeNull();
  });

  test('an item whose level comes from its style moves when its own list names no level', () => {
    const editor = mount(
      item('Peer', 0) +
        paragraph(
          'Inherited',
          `<w:pStyle w:val="ListBulletTwo"/><w:numPr><w:numId w:val="1"/></w:numPr>${OWN}`
        )
    );
    expect(geometry(editor, 'Inherited').level).toBe(1);
    caretAt(editor, 'Inherited');
    expect(editor.surface!.adjustIndent('decrease')).toBe(true);
    expect(geometry(editor, 'Inherited')).toEqual(geometry(editor, 'Peer'));
    expect(savedIndent(editor, 'Inherited')).toBeNull();
  });

  test('undo puts the indent back with the level', () => {
    const editor = mount(item('First', 0) + item('Own', 1, OWN));
    const before = geometry(editor, 'Own');
    caretAt(editor, 'Own');
    expect(editor.surface!.adjustIndent('increase')).toBe(true);
    editor.surface!.undo();
    expect(geometry(editor, 'Own')).toEqual(before);
    expect(savedIndent(editor, 'Own')).toEqual(OWN_ATTRIBUTES);
  });

  test('a suggested level change records the indent, and rejecting it restores the item', () => {
    const editor = mount(item('First', 0) + item('Own', 1, OWN), 'Reviewer');
    const before = geometry(editor, 'Own');
    editor.surface!.setEditingMode('suggest');
    caretAt(editor, 'Own');
    expect(editor.surface!.adjustIndent('increase')).toBe(true);
    expect(geometry(editor, 'Own').level).toBe(2);
    expect(savedIndent(editor, 'Own')).toBeNull();
    expect(savedProperties(editor, 'Own')).toMatch(/<w:pPrChange\b.*<w:ind [^>]*w:left="1080"/);
    editor.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(geometry(editor, 'Own')).toEqual(before);
    expect(savedIndent(editor, 'Own')).toEqual(OWN_ATTRIBUTES);
  });

  test('a suggested level change on a style-numbered item is one revision that reject undoes', () => {
    const editor = mount(
      paragraph('Styled', `<w:pStyle w:val="ListBullet"/>${OWN}`) + item('Peer', 1),
      'Reviewer'
    );
    const before = geometry(editor, 'Styled');
    const original = savedProperties(editor, 'Styled');
    editor.surface!.setEditingMode('suggest');
    caretAt(editor, 'Styled');
    expect(editor.surface!.adjustIndent('increase')).toBe(true);
    expect(geometry(editor, 'Styled')).toEqual(geometry(editor, 'Peer'));
    const saved = savedProperties(editor, 'Styled');
    expect(saved.match(/<w:pPrChange\b/g)).toHaveLength(1);
    expect(saved).toMatch(/<w:pPrChange\b.*<w:ind [^>]*w:left="1080"/);
    editor.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(geometry(editor, 'Styled')).toEqual(before);
    expect(savedProperties(editor, 'Styled')).toBe(original);
  });
});
