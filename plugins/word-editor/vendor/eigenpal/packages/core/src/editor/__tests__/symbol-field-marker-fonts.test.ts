import { numberingFontInputs } from '../numbering-font-inputs.ts';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import type { FontResolutionRequest } from '../font-composition.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { openTreeSession } from '../../binding/tree-session.ts';
import { resolverGlyphFontFamilies } from '../resolver-glyph-font-families.ts';
import {
  symbolFieldFontFamilies,
  usedNumberingFontFamilies,
} from '../../layout/synthesized-font-families.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { sha256FontBytes } from '../../layout/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function root(xml: string) {
  const parsed = readOoxmlPart(xml, { name: '/word/test.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error('Invalid test XML');
  return parsed.part.root;
}

const symbolField = (font: string) =>
  `<w:p><w:fldSimple w:instr='SYMBOL 0xF0FC \\f "${font}"'/></w:p>`;

function withNumbering(body: string): Uint8Array {
  const files = unzipSync(docx(body));
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdNum" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`
  );
  files['word/numbering.xml'] = strToU8(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0FC;"/><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
  );
  return zipSync(files);
}

async function requested(bytes: Uint8Array) {
  const seen: FontResolutionRequest[] = [];
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    fonts: (request) => {
      seen.push(request);
      return undefined;
    },
  });
  try {
    for (let i = 0; i < 100 && seen.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toHaveLength(1);
    return {
      families: seen[0]!.families,
      declared: editor.getDocumentFonts(),
      notice: editor.snapshot().fontSubstitutions,
    };
  } finally {
    editor.destroy();
  }
}

test('requests the font of a simple SYMBOL field without adding it to the declaration catalog', async () => {
  const result = await requested(
    docx(
      '<w:p><w:fldSimple w:instr="SYMBOL 0xF0FC \\f &quot;Wingdings&quot;"><w:r><w:t/></w:r></w:fldSimple></w:p>'
    )
  );
  expect(result.families).toContain('Wingdings');
  expect(result.declared).not.toContain('Wingdings');
  expect(result.notice).not.toContain('Wingdings');
});

test('requests a complex SYMBOL font when its instruction is split across runs', async () => {
  const result = await requested(
    docx(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>SYMBOL 0xF0FC </w:instrText></w:r><w:r><w:instrText>\\f "Wingdings"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )
  );
  expect(result.families).toContain('Wingdings');
});

test('requests the font of a used numbering bullet', async () => {
  const result = await requested(
    withNumbering(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Report item</w:t></w:r></w:p>'
    )
  );
  expect(result.families).toContain('Wingdings');
  expect(result.declared).not.toContain('Wingdings');
  expect(result.notice).not.toContain('Wingdings');
});

test('a private-use bullet asks for its face without naming it in the picker or the notice', async () => {
  // Word's default bullet: `w:lvlText` U+F0B7 with `w:rFonts w:ascii="Symbol"`. The face is
  // what a resolver must be asked for AND what sizes the marker's line, but the document
  // never declares Symbol for text, so neither the picker's document half nor the
  // substitution notice may gain it.
  const files = unzipSync(
    withNumbering(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>Report item</w:t></w:r></w:p>'
    )
  );
  files['word/numbering.xml'] = strToU8(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
      `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0B7;"/>` +
      `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>` +
      `</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
  );
  const result = await requested(zipSync(files));
  expect(result.families).toContain('Symbol');
  expect(result.declared).not.toContain('Symbol');
  expect(result.notice).not.toContain('Symbol');
});

test('does not request an unused numbering font', async () => {
  const result = await requested(withNumbering('<w:p><w:r><w:t>No list</w:t></w:r></w:p>'));
  expect(result.families).not.toContain('Wingdings');
});

test.each(['field', 'marker'] as const)(
  'installs resolver-supplied bytes for a %s face',
  async (kind) => {
    // A redistributable fixture verifies font plumbing, not Wingdings glyph coverage.
    const bytes = new Uint8Array(
      readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
    );
    const seen: FontResolutionRequest[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document:
        kind === 'field'
          ? docx(symbolField('Wingdings'))
          : withNumbering(
              '<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>'
            ),
      fonts: (request) => {
        seen.push(request);
        return request.families.includes('Wingdings')
          ? {
              sources: [
                {
                  request: { family: 'Wingdings', weight: 400, style: 'normal' },
                  id: `synthesized-${kind}`,
                  bytes,
                  hash: sha256FontBytes(bytes),
                  faceIndex: 0,
                },
              ],
            }
          : undefined;
      },
    });
    try {
      for (let i = 0; i < 100 && editor.fontMeasurement().measurer !== 'shaped'; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(seen).toHaveLength(1);
      expect(seen[0]!.families).toContain('Wingdings');
      expect(editor.fontMeasurement()).toMatchObject({ measurer: 'shaped', resolving: false });
      expect(editor.getDocumentFonts()).not.toContain('Wingdings');
    } finally {
      editor.destroy();
    }
  }
);

test('includes fields in headers, footers, notes, and nested text boxes', () => {
  const roots = [
    root(`<w:hdr xmlns:w="${W}">${symbolField('Header Face')}</w:hdr>`),
    root(`<w:ftr xmlns:w="${W}">${symbolField('Footer Face')}</w:ftr>`),
    root(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${symbolField('Note Face')}</w:footnote></w:footnotes>`
    ),
    root(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:drawing><w:txbxContent>${symbolField('Textbox Face')}</w:txbxContent></w:drawing></w:r></w:p></w:body></w:document>`
    ),
  ];
  expect(symbolFieldFontFamilies(roots)).toEqual([
    'Header Face',
    'Footer Face',
    'Note Face',
    'Textbox Face',
  ]);
});

test('does not interpret arbitrary instruction text and rejects unsafe or overlong names', async () => {
  const result = await requested(
    docx(
      symbolField('Bad&apos;;Face') +
        symbolField('X'.repeat(129)) +
        `<w:p><w:r><w:instrText>SYMBOL 65 \\f "Not A Field"</w:instrText></w:r></w:p>` +
        `<w:p><w:fldSimple w:instr='SYMBOL ${' '.repeat(257)}65 \\f "Overflow Face"'/></w:p>` +
        `<w:p><w:fldSimple w:instr='DDE "External Face"'/></w:p>`
    )
  );
  expect(result.families).toEqual([]);
});

test('requests a quoted SYMBOL font as one complete name', async () => {
  const family = 'Georgia;Verdana';
  const result = await requested(docx(symbolField(family)));
  expect(result.families).toEqual([family]);
  expect(result.families).not.toContain('Georgia');
  expect(result.families).not.toContain('Verdana');
  expect(result.declared).not.toContain(family);
});

test('a SYMBOL font written as a list requests its first face only, as a run font does', async () => {
  const result = await requested(docx(symbolField('Georgia,Verdana')));
  expect(result.families).toEqual(['Georgia']);
  expect(result.declared).not.toContain('Georgia,Verdana');
});

test('keeps field and bullet faces in the reserved share of a crowded request', async () => {
  const declarations = Array.from(
    { length: 80 },
    (_, i) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Font ${i}"/></w:rPr><w:t>x</w:t></w:r></w:p>`
  ).join('');
  const result = await requested(
    withNumbering(
      declarations +
        symbolField('Webdings') +
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>'
    )
  );
  expect(result.families).toHaveLength(64);
  expect(result.families).toContain('Webdings');
  expect(result.families).toContain('Wingdings');
});

test('deduplicates field, symbol, and marker faces without mutating the session', async () => {
  const bytes = withNumbering(
    symbolField('Wingdings') + '<w:p><w:r><w:sym w:font="wingdings" w:char="F0FC"/></w:r></w:p>'
  );
  const opened = openTreeSession(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const before = opened.session.currentPackage();
  expect(resolverGlyphFontFamilies(opened.session).map((family) => family.toLowerCase())).toContain(
    'wingdings'
  );
  expect(opened.session.currentPackage()).toBe(before);
  const result = await requested(bytes);
  expect(result.families.filter((family) => family.toLowerCase() === 'wingdings')).toHaveLength(1);
});

test('resolves a used marker through paragraph style and numbering-level override', () => {
  const story = root(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="ListStyle"/></w:pPr><w:r><w:t>item</w:t></w:r></w:p></w:body></w:document>`
  );
  const styles = root(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="ListStyle"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>`
  );
  const numbering = root(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="x"/><w:rPr><w:rFonts w:ascii="Unused Base"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="x"/><w:rPr><w:rFonts w:ascii="Marker Face"/></w:rPr></w:lvl></w:lvlOverride></w:num></w:numbering>`
  );
  expect(
    usedNumberingFontFamilies([story], numbering, styles, {
      major: null,
      minor: null,
      majorEastAsia: null,
      minorEastAsia: null,
    })
  ).toEqual(['Marker Face']);
});

test('text edits reuse marker inputs and paragraph formatting refreshes marker faces', () => {
  const opened = openTreeSession(withNumbering('<w:p><w:r><w:t>item</w:t></w:r></w:p>'));
  if (!opened.ok) throw new Error(opened.reason);
  const session = opened.session;
  const paragraphId = session.paragraphIds()[0]!;
  const inputs = () => numberingFontInputs(session.storyParts().map((part) => part.root));
  const before = inputs();
  expect(resolverGlyphFontFamilies(session)).not.toContain('Wingdings');
  expect(
    session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'new ' }]).committed
  ).toBe(true);
  expect(inputs()).toEqual(before);
  expect(resolverGlyphFontFamilies(session)).not.toContain('Wingdings');
  expect(
    session.applyTreeOps([{ op: 'setListNumbering', paragraphId, numId: '1', level: 0 }]).committed
  ).toBe(true);
  expect(inputs()).not.toEqual(before);
  expect(resolverGlyphFontFamilies(session)).toContain('Wingdings');
});

test('a new paragraph without properties can introduce default-style marker fonts', () => {
  const original = root(
    `<w:body xmlns:w="${W}"><w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr></w:p></w:body>`
  );
  const bare = root(`<w:body xmlns:w="${W}"><w:p/></w:body>`).children[0]!;
  const edited = { ...original, children: [...original.children, bare] };
  expect(numberingFontInputs([edited])).not.toEqual(numberingFontInputs([original]));
});
