// Automatic paragraph spacing (17.3.1.33 `w:spacing` `@w:beforeAutospacing`/`@w:afterAutospacing`)
// on numbered paragraphs (17.9.18 `w:numPr`) inside a table cell. Items of one list keep no
// automatic space between them, and the list run keeps its automatic margin before its first
// item and after its last. At a cell's top edge the margin before is dropped, as it is for
// every automatically spaced paragraph; at the cell's end a numbered paragraph keeps the
// margin after, also when the next row continues the same list.

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

const plain = (text: string) => paragraph(text);
const auto = (text: string) => paragraph(text, AUTO);
const listed = (text: string) => item(text, AUTO + '<w:contextualSpacing w:val="0"/>');
const table = (rows: readonly (readonly string[])[]) =>
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar>' +
  '</w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
  rows.map((cell) => `<w:tr><w:tc>${cell.join('')}</w:tc></w:tr>`).join('') +
  '</w:tbl>';

/**
 * For each row of the document's only table: the gap above each paragraph's first line
 * (from the row top, or from the end of the previous paragraph's last line), then the space
 * left below the last line.
 */
function gaps(rows: readonly (readonly string[])[]): number[][] {
  const editor = mount(docx(plain('lead') + table(rows) + plain('tail')));
  const fragment = editor.surface!.layout().pages[0]!.fragments.find((f) => f.kind === 'table');
  if (fragment?.kind !== 'table') throw new Error('no table');
  const round = (value: number) => Math.round(value * 10) / 10;
  return fragment.rows.map((row) => {
    let y = row.box.y;
    const out: number[] = [];
    for (const block of row.cells[0]!.blocks) {
      if (block.kind !== 'paragraph') continue;
      const first = block.lines[0]!;
      const last = block.lines.at(-1)!;
      out.push(round(first.box.y - y));
      y = last.box.y + last.box.height;
    }
    out.push(round(row.box.y + row.box.height - y));
    return out;
  });
}

describe('automatic spacing of a numbered list inside a table cell', () => {
  test('the list run keeps its outer margins and no space between its items', () => {
    expect(gaps([[plain('Before'), listed('A'), listed('B'), plain('After')]])).toEqual([
      [0, 14, 0, 14, 0],
    ]);
  });

  test('a list at the top of a cell drops the margin before and keeps the margin after', () => {
    expect(gaps([[listed('A'), listed('B')], [plain('x')]])).toEqual([
      [0, 0, 14],
      [0, 0],
    ]);
  });

  test('the margin after stays at the end of a cell when the next row continues the list', () => {
    expect(
      gaps([
        [plain('Before'), listed('A')],
        [listed('B'), plain('After')],
      ])
    ).toEqual([
      [0, 14, 14],
      [0, 14, 0],
    ]);
  });

  test('an automatically spaced paragraph that is not numbered drops it at the cell end', () => {
    expect(gaps([[auto('P'), auto('Q')], [plain('x')]])).toEqual([
      [0, 14, 0],
      [0, 0],
    ]);
  });
});
