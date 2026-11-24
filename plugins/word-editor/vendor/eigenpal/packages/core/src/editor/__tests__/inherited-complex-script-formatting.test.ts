import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

function docx(body: string, styles: string): Uint8Array {
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
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (runs: string) => `<w:p>${runs}</w:p>`;
const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

/**
 * Mount, run, tear down. A leaked editor keeps its document-level selection listeners, and
 * the next test file's DOM events reach a surface nobody is looking at.
 */
function withEditor(body: string, styles: string, run: (editor: DocxEditorInstance) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body, styles) });
  if (!editor.surface) throw new Error('surface failed to mount');
  try {
    run(editor);
  } finally {
    editor.destroy();
    container.remove();
  }
}

function paragraphNodes(editor: DocxEditorInstance): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') found.push(node);
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child);
  };
  walk(editor.surface!.session.part().root);
  return found;
}

function describeProperties(container: OoxmlNode): string[] {
  if (container.kind === 'textValue') return [];
  return container.children.flatMap((child) => {
    if (child.kind === 'textValue') return [];
    const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
    return [val === undefined ? child.localName : `${child.localName}=${val}`];
  });
}

/** Each paragraph's runs, as the `w:rPr` children each run itself authors. */
function authoredRunProperties(editor: DocxEditorInstance): string[][][] {
  return paragraphNodes(editor).map((paragraph) => {
    if (paragraph.kind === 'textValue') return [];
    return paragraph.children
      .filter((child) => child.kind === 'run')
      .map((run) => {
        if (run.kind === 'textValue') return [];
        const rPr = run.children.find((child) => child.kind === 'runProperties');
        return rPr ? describeProperties(rPr) : [];
      });
  });
}

/** Each paragraph's mark properties (`w:pPr/w:rPr`), in the same shape. */
function authoredMarkProperties(editor: DocxEditorInstance): string[][] {
  return paragraphNodes(editor).map((paragraph) => {
    if (paragraph.kind === 'textValue') return [];
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    if (!pPr || pPr.kind === 'textValue') return [];
    const rPr = pPr.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'rPr'
    );
    return rPr ? describeProperties(rPr) : [];
  });
}

function select(editor: DocxEditorInstance, from: [number, number], to: [number, number]): void {
  const ids = editor.surface!.session.paragraphIds();
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
}

const lane = '<w:rtl/><w:noProof/><w:color w:val="123456"/>';
const character = `<w:style w:type="character" w:styleId="Complex"><w:rPr>${lane}</w:rPr></w:style>`;
const cases = [
  {
    name: 'forced complex character style',
    styles: character.replace('<w:rtl/>', '<w:cs/>'),
    pPr: '',
    rPr: '<w:rStyle w:val="Complex"/>',
  },
  {
    name: 'default paragraph style',
    styles: character.replace('w:type="character"', 'w:type="paragraph" w:default="1"'),
    pPr: '',
    rPr: '',
  },

  { name: 'character style', styles: character, pPr: '', rPr: '<w:rStyle w:val="Complex"/>' },
  {
    name: 'paragraph style',
    styles: `<w:style w:type="paragraph" w:styleId="Complex"><w:rPr>${lane}</w:rPr></w:style>`,
    pPr: '<w:pStyle w:val="Complex"/>',
    rPr: '',
  },
  {
    name: 'document defaults',
    styles: `<w:docDefaults><w:rPrDefault><w:rPr>${lane}</w:rPr></w:rPrDefault></w:docDefaults>`,
    pPr: '',
    rPr: '',
  },
  {
    name: 'character basedOn',
    styles:
      character +
      '<w:style w:type="character" w:styleId="Child"><w:basedOn w:val="Complex"/></w:style>',
    pPr: '',
    rPr: '<w:rStyle w:val="Child"/>',
  },
];
for (const item of cases) {
  for (const caret of [false, true]) {
    test(`${item.name}: ${caret ? 'caret' : 'selection'} writes effective companions only`, () => {
      const body = `<w:p><w:pPr>${item.pPr}</w:pPr><w:r><w:rPr>${item.rPr}</w:rPr><w:t>abc</w:t></w:r></w:p>`;
      withEditor(body, item.styles, (editor) => {
        select(editor, [0, caret ? 3 : 0], [0, 3]);
        const surface = editor.surface!;
        surface.setRunProperty('b');
        surface.setRunProperty('i');
        surface.setRunProperty('sz', { val: '40' });
        surface.setRunProperty('rFonts', { ascii: 'Arial', hAnsi: 'Arial' });
        if (caret) surface.type('x');
        const runs = authoredRunProperties(editor)[0]!;
        const changed = runs[runs.length - 1]!;
        expect(changed).toContain('bCs');
        expect(changed).toContain('iCs');
        expect(changed).toContain('szCs=40');
        expect(changed).not.toContain('noProof');
        expect(changed).not.toContain('color=123456');
        expect(surface.formatting()).toMatchObject({
          bold: true,
          italic: true,
          fontSizeHalfPoints: 40,
          fontFamily: 'Arial',
        });
      });
    });
  }
}
test('direct false selects Latin formatting despite inherited direction', () => {
  withEditor(
    p(textRun('abc', '<w:rPr><w:rStyle w:val="Complex"/><w:rtl w:val="0"/></w:rPr>')),
    character,
    (editor) => {
      select(editor, [0, 0], [0, 3]);
      editor.surface!.setRunProperty('b');
      expect(authoredRunProperties(editor)[0]![0]).toContain('b');
      expect(authoredRunProperties(editor)[0]![0]).not.toContain('bCs');
      expect(editor.surface!.formatting()?.bold).toBe(true);
    }
  );
});
test('an empty styled paragraph mark gives armed typing the complex lane', () => {
  withEditor(
    '<w:p><w:pPr><w:rPr><w:rStyle w:val="Complex"/></w:rPr></w:pPr></w:p>',
    character,
    (editor) => {
      select(editor, [0, 0], [0, 0]);
      editor.surface!.setRunProperty('b');
      editor.surface!.type('x');
      expect(authoredRunProperties(editor)[0]![0]).toContain('bCs');
      expect(editor.surface!.formatting()?.bold).toBe(true);
    }
  );
});
test('paragraph marks inherit the paragraph complex lane on selection writes', () => {
  const item = cases.find((entry) => entry.name === 'paragraph style')!;
  withEditor(
    `<w:p><w:pPr>${item.pPr}</w:pPr><w:r><w:t>abc</w:t></w:r></w:p>`,
    item.styles,
    (editor) => {
      select(editor, [0, 0], [0, 3]);
      editor.surface!.setRunProperty('b');
      expect(authoredMarkProperties(editor)[0]).toContain('bCs');
    }
  );
});

test('one selection keeps direct false and inherited complex runs separate', () => {
  withEditor(
    p(
      textRun('abc', '<w:rPr><w:rStyle w:val="Complex"/></w:rPr>') +
        textRun('def', '<w:rPr><w:rStyle w:val="Complex"/><w:rtl w:val="0"/></w:rPr>')
    ),
    character,
    (editor) => {
      select(editor, [0, 0], [0, 6]);
      editor.surface!.setRunProperty('b');
      expect(authoredRunProperties(editor)[0]![0]).toContain('bCs');
      expect(authoredRunProperties(editor)[0]![1]).not.toContain('bCs');
      expect(editor.surface!.formatting()?.bold).toBe(true);
    }
  );
});
test('forced complex style remains active when rtl is directly disabled', () => {
  withEditor(
    p(textRun('abc', '<w:rPr><w:rStyle w:val="Complex"/><w:rtl w:val="0"/></w:rPr>')),
    character.replace('<w:rtl/>', '<w:cs/>'),
    (editor) => {
      select(editor, [0, 0], [0, 3]);
      editor.surface!.setRunProperty('b');
      expect(authoredRunProperties(editor)[0]![0]).toContain('bCs');
      expect(editor.surface!.formatting()?.bold).toBe(true);
    }
  );
});

for (const flag of ['rtl', 'cs']) {
  test(`caret respects a direct false ${flag} override`, () => {
    withEditor(
      p(textRun('abc', `<w:rPr><w:rStyle w:val="Complex"/><w:${flag} w:val="0"/></w:rPr>`)),
      character.replace('<w:rtl/>', `<w:${flag}/>`),
      (editor) => {
        select(editor, [0, 3], [0, 3]);
        editor.surface!.setRunProperty('b');
        editor.surface!.type('x');
        const changed = authoredRunProperties(editor)[0]!.at(-1)!;
        expect(changed).toContain('b');
        expect(changed).not.toContain('bCs');
        expect(editor.surface!.formatting()?.bold).toBe(true);
      }
    );
  });
}

const table = (first: string, second: string) =>
  '<w:tbl><w:tblPr><w:tblStyle w:val="TableStyle"/>' +
  '<w:tblLook w:firstRow="1" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
  `<w:tr><w:tc>${first}</w:tc></w:tr><w:tr><w:tc>${second}</w:tc></w:tr></w:tbl>`;
for (const conditional of [false, true]) {
  for (const caret of [false, true]) {
    test(`table style conditional=${conditional}, caret=${caret} keeps cell conditions`, () => {
      const run = '<w:rPr><w:rtl/></w:rPr>';
      const styles =
        '<w:style w:type="table" w:styleId="TableStyle">' +
        (conditional ? `<w:tblStylePr w:type="firstRow">${run}</w:tblStylePr>` : run) +
        '</w:style>';
      withEditor(table(p(textRun('abc')), p(textRun('def'))), styles, (editor) => {
        // The two cell paragraphs; the empty paragraph after the table holds no text.
        for (const [index, paragraph] of paragraphNodes(editor).slice(0, 2).entries()) {
          const surface = editor.surface!;
          surface.setSelection({
            anchor: { paragraphId: paragraph.id, offset: caret ? 3 : 0 },
            head: { paragraphId: paragraph.id, offset: 3 },
          });
          surface.setRunProperty('b');
          if (caret) surface.type('x');
          expect(authoredRunProperties(editor)[index]!.at(-1)!.includes('bCs')).toBe(
            !conditional || index === 0
          );
          expect(surface.formatting()?.bold).toBe(true);
          if (!caret)
            expect(authoredMarkProperties(editor)[index]!.includes('bCs')).toBe(
              !conditional || index === 0
            );
        }
      });
    });
  }
}

test('table inheritance respects a direct false override', () => {
  const styles = '<w:style w:type="table" w:styleId="TableStyle"><w:rPr><w:rtl/></w:rPr></w:style>';
  withEditor(
    table(p(textRun('abc', '<w:rPr><w:rtl w:val="0"/></w:rPr>')), p(textRun('def'))),
    styles,
    (editor) => {
      const id = paragraphNodes(editor)[0]!.id;
      editor.surface!.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 3 },
      });
      editor.surface!.setRunProperty('b');
      expect(authoredRunProperties(editor)[0]![0]).not.toContain('bCs');
      expect(editor.surface!.formatting()?.bold).toBe(true);
    }
  );
});

for (const caret of [false, true]) {
  test(`default character style: ${caret ? 'caret' : 'selection'} writes no companions`, () => {
    const styles = character.replace('w:type="character"', 'w:type="character" w:default="1"');
    withEditor('<w:p><w:r><w:t>abc</w:t></w:r></w:p>', styles, (editor) => {
      select(editor, [0, caret ? 3 : 0], [0, 3]);
      editor.surface!.setRunProperty('b');
      if (caret) editor.surface!.type('x');
      const runs = authoredRunProperties(editor)[0]!;
      expect(runs[runs.length - 1]).toEqual(['b']);
      expect(editor.surface!.formatting()?.bold).toBe(true);
    });
  });
}

test('empty paragraph typing ignores the default character style while mark writes stay separate', () => {
  const styles = character.replace('w:type="character"', 'w:type="character" w:default="1"');
  withEditor('<w:p/>', styles, (editor) => {
    select(editor, [0, 0], [0, 0]);
    editor.surface!.setRunProperty('b');
    editor.surface!.type('x');
    expect(authoredRunProperties(editor)[0]![0]).not.toContain('bCs');
    expect(authoredMarkProperties(editor)[0]).not.toContain('bCs');
    expect(editor.surface!.formatting()?.bold).toBe(true);
  });
});

for (const flag of ['rtl', 'cs']) {
  for (const on of [false, true]) {
    test(`empty mark ${flag}=${on} controls the inserted run against a default character style`, () => {
      const styles = `<w:style w:type="character" w:default="1" w:styleId="Default"><w:rPr><w:${flag} w:val="${on ? 0 : 1}"/></w:rPr></w:style>`;
      const body = `<w:p><w:pPr><w:rPr><w:${flag} w:val="${on ? 1 : 0}"/></w:rPr></w:pPr></w:p>`;
      withEditor(body, styles, (editor) => {
        select(editor, [0, 0], [0, 0]);
        editor.surface!.setRunProperty('b');
        editor.surface!.type('x');
        const changed = authoredRunProperties(editor)[0]![0]!;
        expect(changed).toContain(`${flag}=${on ? 1 : 0}`);
        expect(changed.includes('bCs')).toBe(on);
        expect(editor.surface!.formatting()?.bold).toBe(true);
      });
    });
  }
}

test('caret typing ignores a hidden deletion before a visible complex run', () => {
  const body =
    '<w:p><w:del w:id="1" w:author="Author"><w:r><w:delText>old</w:delText></w:r></w:del>' +
    '<w:r><w:rPr><w:rStyle w:val="Complex"/></w:rPr><w:t>abc</w:t></w:r></w:p>';
  withEditor(body, character, (editor) => {
    select(editor, [0, 3], [0, 3]);
    editor.surface!.setRunProperty('b');
    editor.surface!.type('x');
    expect(authoredRunProperties(editor)[0]![0]).toContain('bCs');
    expect(editor.surface!.formatting()?.bold).toBe(true);
  });
});
