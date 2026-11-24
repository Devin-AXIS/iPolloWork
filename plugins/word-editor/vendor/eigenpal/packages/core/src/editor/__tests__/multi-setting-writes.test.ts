// A write that means to change ONE setting must not replace the element carrying it.
//
// Most OOXML formatting elements hold a single setting and replace cleanly. A handful hold
// several independent ones, and for those a replacing write is silent data loss:
//
//   * `w:rFonts` holds a font per script, so a Latin font pick deleted the run's East Asian
//     and complex-script faces — invisible here, and visible the moment Word reopens it;
//   * `w:numPr` holds the level AND the definition, so converting a bullet to a number reset
//     `w:ilvl` to 0 and the item jumped out to the left margin;
//   * `w:u` holds the underline style AND its colour, so toggling twice repainted a red
//     underline black.
//
// The mirror-image mistake is merging where a SUPERSEDING twin survives: `w:beforeLines` and
// `w:leftChars` measure the same setting in other units and outrank the twips beside them, so
// a value written next to one is a number the file then ignores.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  AUTHORABLE_RUN_PROPERTIES,
  authoredProperties,
  findNode,
  propertyContainer,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string, extra?: Record<string, Uint8Array>): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (extra
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    ...(extra
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rId8" Type="${OD.replace('officeDocument', 'numbering')}" Target="numbering.xml"/></Relationships>`
          ),
        }
      : {}),
    ...extra,
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(body: string, extra?: Record<string, Uint8Array>): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body, extra) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const xmlOf = (editor: DocxEditorInstance) => serializeOoxmlPart(editor.surface!.session.part());

/** Put the caret across the whole of the first paragraph. */
function selectAll(editor: DocxEditorInstance): void {
  editor.surface!.selectAll();
}

/**
 * The first RUN's own `w:rPr`, as attributes by element name.
 *
 * Asserted on rather than the serialized document, which cannot tell a run's properties from
 * the paragraph MARK's copy of the same element beside it — an assertion that only matched
 * the mark passed while the run had lost the value.
 */
function firstRunProperties(editor: DocxEditorInstance): Record<string, Record<string, string>> {
  const part = editor.surface!.session.part();
  const paragraph = findNode(part, editor.surface!.session.paragraphIds()[0]!);
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('no paragraph');
  const run = paragraph.children.find((child) => child.kind === 'run');
  if (!run) throw new Error('no run');
  const byName: Record<string, Record<string, string>> = {};
  for (const property of authoredProperties(
    propertyContainer(run, 'runProperties', 'rPr'),
    AUTHORABLE_RUN_PROPERTIES
  )) {
    byName[property.localName] = { ...(property.attributes ?? {}) };
  }
  return byName;
}

/** Every run's own `w:rFonts` attributes, keyed by run index. */
function runFontProperties(
  editor: DocxEditorInstance
): Record<number, Record<string, string> | undefined> {
  const part = editor.surface!.session.part();
  const paragraph = findNode(part, editor.surface!.session.paragraphIds()[0]!);
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('no paragraph');
  const byIndex: Record<number, Record<string, string> | undefined> = {};
  let index = 0;
  for (const child of paragraph.children) {
    if (child.kind !== 'run') continue;
    const found = authoredProperties(
      propertyContainer(child, 'runProperties', 'rPr'),
      AUTHORABLE_RUN_PROPERTIES
    ).find((property) => property.localName === 'rFonts');
    byIndex[index] = found?.attributes ? { ...found.attributes } : undefined;
    index += 1;
  }
  return byIndex;
}

describe('w:rFonts keeps the font slots a pick does not name', () => {
  const RUN =
    '<w:p><w:r><w:rPr>' +
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun" w:cs="Arial Unicode MS" w:hint="eastAsia"/>' +
    '</w:rPr><w:t>text</w:t></w:r></w:p>';

  test('a Latin font pick leaves eastAsia, cs and hint alone', () => {
    const editor = mount(RUN);
    selectAll(editor);
    expect(editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', value: 'Georgia' }).ok).toBe(
      true
    );
    // The three the pick never named are kept, and Word's font box does not touch them either.
    expect(firstRunProperties(editor).rFonts).toEqual({
      ascii: 'Georgia',
      hAnsi: 'Georgia',
      eastAsia: 'SimSun',
      cs: 'Arial Unicode MS',
      hint: 'eastAsia',
    });
  });

  test('a pick clears the THEME reference for the slot it sets', () => {
    // A theme attribute names the slot indirectly and outranks the explicit name beside it,
    // so a merge that kept it would leave the pick resolving back to the theme font — the
    // same shape as the autospacing flag swallowing a spacing write.
    const editor = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsia="SimSun"/></w:rPr><w:t>text</w:t></w:r></w:p>'
    );
    selectAll(editor);
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', value: 'Georgia' });
    expect(firstRunProperties(editor).rFonts).toEqual({
      ascii: 'Georgia',
      hAnsi: 'Georgia',
      eastAsia: 'SimSun',
    });
  });
});

describe('a font armed at the caret merges like one applied to a selection', () => {
  test("typing after a caret font pick keeps the run's other slots", () => {
    // The armed path folds its properties separately from the selection path, so it kept
    // its own copy of the replace-the-element bug: the two halves of one feature disagreed.
    const editor = mount(
      '<w:p><w:r><w:rPr>' +
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun" w:cs="Arial"/>' +
        '</w:rPr><w:t>text</w:t></w:r></w:p>'
    );
    const id = editor.surface!.session.paragraphIds()[0]!;
    // A COLLAPSED caret inside the run arms the pick rather than writing it.
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 2 },
      head: { paragraphId: id, offset: 2 },
    });
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', value: 'Verdana' });
    editor.exec({ type: 'insertText', text: 'XY' });

    const fonts = Object.values(runFontProperties(editor)).filter(Boolean);
    const typed = fonts.find((attributes) => attributes.ascii === 'Verdana');
    expect(typed).toBeDefined();
    expect(typed!.eastAsia).toBe('SimSun');
    expect(typed!.cs).toBe('Arial');
  });
});

describe('w:u keeps its colour across a toggle', () => {
  test('underline off and on again leaves the authored colour', () => {
    const editor = mount(
      '<w:p><w:r><w:rPr><w:u w:val="single" w:color="FF0000"/></w:rPr><w:t>text</w:t></w:r></w:p>'
    );
    selectAll(editor);
    editor.exec({ type: 'toggleMark', mark: 'underline' });
    editor.exec({ type: 'toggleMark', mark: 'underline' });
    // Dropped, the underline came back black on the page — `run-style.ts` reads this colour
    // and `semantic-paint.ts` paints it.
    expect(firstRunProperties(editor).u).toEqual({ val: 'single', color: 'FF0000' });
  });
});

describe('a superseding twin is cleared with the value it supersedes', () => {
  test('setParagraphSpacing clears w:beforeLines beside the twips it writes', () => {
    const editor = mount(
      '<w:p><w:pPr><w:spacing w:before="480" w:beforeLines="200"/></w:pPr>' +
        '<w:r><w:t>text</w:t></w:r></w:p>'
    );
    selectAll(editor);
    editor.exec({ type: 'setParagraphSpacing', beforePt: 0 });
    const xml = xmlOf(editor);
    expect(xml).toContain('w:before="0"');
    // Left in place, the line-unit value outranks the twips (§17.3.1.33) and "space before
    // 0" did not close the gap in Word.
    expect(xml).not.toContain('beforeLines');
  });

  test('setIndent clears w:leftChars beside the twips it writes', () => {
    const editor = mount(
      '<w:p><w:pPr><w:ind w:left="1440" w:leftChars="400"/></w:pPr>' +
        '<w:r><w:t>text</w:t></w:r></w:p>'
    );
    selectAll(editor);
    expect(editor.surface!.setIndent({ left: 0 })).toBe(true);
    const xml = xmlOf(editor);
    expect(xml).not.toContain('leftChars');
  });
});

describe('w:numPr keeps the level when the list kind changes', () => {
  const NUMBERING = strToU8(
    `<w:numbering xmlns:w="${W}">` +
      '<w:abstractNum w:abstractNumId="0">' +
      '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
      '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/>' +
      '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
      '<w:lvl w:ilvl="2"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#9642;"/>' +
      '<w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>' +
      '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '</w:numbering>'
  );

  test('a level-2 bullet becomes a level-2 number, not a level-0 one', () => {
    const editor = mount(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>item</w:t></w:r></w:p>',
      { 'word/numbering.xml': NUMBERING }
    );
    selectAll(editor);
    expect(editor.surface!.toggleList('ordered')).toBe(true);
    // `w:numPr` carries the level and the definition together, and the op mints a fresh
    // one: naming no level reset `w:ilvl` to 0 and the item jumped two levels out.
    expect(xmlOf(editor)).toContain('w:ilvl w:val="2"');
  });
});
