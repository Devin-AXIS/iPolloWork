import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const AUTO =
  '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>';
const LIST = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const paragraph = (text: string, props = '') =>
  `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string, props = AUTO) => paragraph(text, LIST + props);
const NORMAL =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const NUMBERING = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

function docx(
  body: string,
  styles = FORMAT_DOC_DEFAULTS + NORMAL,
  numbering = NUMBERING
): Uint8Array {
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
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/numbering.xml': strToU8(numbering),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const open: DocxEditorInstance[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const fragments = (editor: DocxEditorInstance) =>
  editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph');
const spacing = (editor: DocxEditorInstance) =>
  fragments(editor).map((fragment) => fragment.spacing);
const geometry = (editor: DocxEditorInstance) =>
  fragments(editor).map((fragment) => ({
    box: fragment.box,
    spacing: fragment.spacing,
    lines: fragment.lines.map((line) => line.box),
  }));
function enter(editor: DocxEditorInstance, index: number, offset: number): void {
  const surface = editor.surface!;
  const point = { paragraphId: surface.session.paragraphIds()[index]!, offset };
  surface.setSelection({ anchor: point, head: point });
  surface.splitParagraph();
}

describe('automatic list spacing matches Word', () => {
  test('keeps outer margins and closes only the interior sides', () => {
    const editor = mount(
      docx(paragraph('Before') + item('One') + item('Two') + paragraph('After'))
    );
    expect(spacing(editor)).toEqual([
      { before: 0, after: 0 },
      { before: 14, after: 0 },
      { before: 0, after: 14 },
      { before: 0, after: 0 },
    ]);
  });

  test('different list instances retain a margin between them', () => {
    const numbering = NUMBERING.replace(
      '</w:numbering>',
      '<w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num></w:numbering>'
    );
    const second = item('Two').replace('w:numId w:val="1"', 'w:numId w:val="2"');
    const editor = mount(docx(item('One') + second, FORMAT_DOC_DEFAULTS + NORMAL, numbering));
    // The second before-margin collapses against the first after-margin.
    expect(spacing(editor)).toEqual([
      { before: 0, after: 14 },
      { before: 0, after: 14 },
    ]);
  });

  test('nested levels of the same list keep their interior tight', () => {
    const numbering = NUMBERING.replace(
      '</w:abstractNum>',
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum>'
    );
    const nested = item('Nested').replace('w:ilvl w:val="0"', 'w:ilvl w:val="1"');
    const editor = mount(
      docx(item('One') + nested + item('Two'), FORMAT_DOC_DEFAULTS + NORMAL, numbering)
    );
    expect(spacing(editor)).toEqual([
      { before: 0, after: 0 },
      { before: 0, after: 0 },
      { before: 0, after: 14 },
    ]);
  });

  test('bullets use the same spacing rules as numbered items', () => {
    const numbering = NUMBERING.replace(
      'w:numFmt w:val="decimal"',
      'w:numFmt w:val="bullet"'
    ).replace('w:lvlText w:val="%1."', 'w:lvlText w:val="•"');
    const editor = mount(
      docx(paragraph('Before') + item('One') + item('Two'), FORMAT_DOC_DEFAULTS + NORMAL, numbering)
    );
    expect(spacing(editor).slice(1)).toEqual([
      { before: 14, after: 0 },
      { before: 0, after: 14 },
    ]);
  });

  test('an isolated list item keeps both automatic margins', () => {
    const editor = mount(docx(paragraph('Before') + item('One') + paragraph('After')));
    expect(spacing(editor)[1]).toEqual({ before: 14, after: 14 });
  });

  test('Enter moves the trailing margin to the new item, including save and undo', async () => {
    const editor = mount(docx(paragraph('Before') + item('One') + paragraph('After')));
    const original = geometry(editor);
    enter(editor, 1, 3);
    expect(spacing(editor).slice(1, 3)).toEqual([
      { before: 14, after: 0 },
      { before: 0, after: 14 },
    ]);
    expect(geometry(mount(new Uint8Array(await editor.save())))).toEqual(geometry(editor));
    editor.surface!.undo();
    expect(geometry(editor)).toEqual(original);
    editor.surface!.redo();
    expect(spacing(editor).slice(1, 3)).toEqual([
      { before: 14, after: 0 },
      { before: 0, after: 14 },
    ]);
    editor.surface!.type('New');
    expect(geometry(mount(new Uint8Array(await editor.save())))).toEqual(geometry(editor));
  });

  test('Enter at the start and middle keeps only the outer margins', () => {
    for (const offset of [0, 1]) {
      const editor = mount(docx(paragraph('Before') + item('One') + paragraph('After')));
      enter(editor, 1, offset);
      expect(spacing(editor).slice(1, 3)).toEqual([
        { before: 14, after: 0 },
        { before: 0, after: 14 },
      ]);
    }
  });

  test('joining list items restores the trailing margin on the survivor', async () => {
    const editor = mount(
      docx(paragraph('Before') + item('One') + item('Two') + paragraph('After'))
    );
    const surface = editor.surface!;
    const point = { paragraphId: surface.session.paragraphIds()[2]!, offset: 0 };
    surface.setSelection({ anchor: point, head: point });
    surface.deleteBackward();
    expect(spacing(editor)[1]).toEqual({ before: 14, after: 14 });
    expect(geometry(mount(new Uint8Array(await editor.save())))).toEqual(geometry(editor));
  });

  test('style and document defaults supply automatic spacing without direct spacing', () => {
    for (const styles of [
      `<w:docDefaults><w:pPrDefault><w:pPr>${AUTO}</w:pPr></w:pPrDefault></w:docDefaults>${NORMAL}`,
      NORMAL +
        `<w:style w:type="paragraph" w:styleId="List"><w:basedOn w:val="Normal"/><w:pPr>${AUTO}</w:pPr></w:style>`,
    ]) {
      const editor = mount(
        docx(
          item('One', '<w:pStyle w:val="List"/>') + item('Two', '<w:pStyle w:val="List"/>'),
          styles
        )
      );
      expect(spacing(editor)).toEqual([
        { before: 0, after: 0 },
        { before: 0, after: 14 },
      ]);
    }
  });

  test('contextual spacing still suppresses outer margins against the same style', () => {
    const styles =
      FORMAT_DOC_DEFAULTS +
      NORMAL +
      `<w:style w:type="paragraph" w:styleId="Tight"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>`;
    const style = '<w:pStyle w:val="Tight"/>';
    const editor = mount(
      docx(
        paragraph('Before', style) + item('One', style + AUTO) + paragraph('After', style),
        styles
      )
    );
    expect(spacing(editor)).toEqual(Array.from({ length: 3 }, () => ({ before: 0, after: 0 })));
  });

  test('contextual spacing also controls keep-with-next pagination at a list boundary', () => {
    const styles =
      NORMAL +
      '<w:style w:type="paragraph" w:styleId="Tight"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/><w:spacing w:line="240" w:lineRule="exact"/></w:pPr></w:style>';
    const style = '<w:pStyle w:val="Tight"/>';
    const body =
      Array.from({ length: 5 }, () => paragraph('Lead', style)).join('') +
      item('One', style + AUTO + '<w:keepNext/>') +
      paragraph('After', style) +
      '<w:sectPr><w:pgSz w:w="10000" w:h="2000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr>';
    const editor = mount(docx(body, styles));
    expect(editor.surface!.layout().pages).toHaveLength(1);
  });

  test('explicit contextual margins do not inflate keep-next groups without a named style', async () => {
    const props =
      '<w:contextualSpacing/><w:spacing w:afterLines="200" w:line="240" w:lineRule="exact"/>';
    const body =
      Array.from({ length: 5 }, () => paragraph('Lead', props)).join('') +
      paragraph('One', props + '<w:keepNext/>') +
      paragraph('After', props) +
      '<w:sectPr><w:pgSz w:w="10000" w:h="2100"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr>';
    const editor = mount(docx(body, ''));
    expect(editor.surface!.layout().pages).toHaveLength(1);
    enter(editor, 5, 3);
    expect(geometry(mount(new Uint8Array(await editor.save())))).toEqual(geometry(editor));
    editor.surface!.undo();
    expect(editor.surface!.layout().pages).toHaveLength(1);
  });

  test('explicit spacing survives Enter and automatic neighbors do not erase it', () => {
    const editor = mount(
      docx(item('One') + item('Two', '<w:spacing w:after="240"/>') + item('Three'))
    );
    enter(editor, 1, 3);
    expect(spacing(editor).map((value) => value.after)).toEqual([0, 12, 12, 14]);
  });

  test('tables break a body list while their own paragraphs keep cell spacing', () => {
    const table = `<w:tbl><w:tr><w:tc>${item('Cell one')}${item('Cell two')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(docx(item('One') + table + item('Two')));
    expect(spacing(editor)).toEqual([
      { before: 0, after: 14 },
      { before: 14, after: 14 },
    ]);
    const fragment = editor
      .surface!.layout()
      .pages[0]!.fragments.find((value) => value.kind === 'table');
    if (fragment?.kind !== 'table') throw new Error('missing table');
    expect(
      fragment.rows[0]!.cells[0]!.blocks.filter((value) => value.kind === 'paragraph').map(
        (value) => value.spacing
      )
    ).toEqual([
      // One list run in the cell: nothing between its items, nothing before it at the cell
      // top, and the run's automatic margin after it at the cell end.
      { before: 0, after: 0 },
      { before: 0, after: 14 },
    ]);
  });
});
