// Live edits inside a vertical merge in the header rows.
//
// Column 1 merges both `w:tblHeader` rows. An edit that makes the merged head taller re-plans
// the header group from the tree, on the page the table starts on and on every repeated copy,
// so the incremental layout, undo and a cold reopen of the saved file all give the same rows.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import type { TableFragmentRecord } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';
const HEADER = '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>';
const BODY_ROWS = 80;

const HEADER_MERGE_TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${HEADER}<w:tc>${p('S0')}</w:tc><w:tc>${RESTART}${p('A0')}${p('A1')}</w:tc></w:tr>` +
  `<w:tr>${HEADER}<w:tc>${p('S1')}</w:tc><w:tc>${CONTINUE}<w:p/></w:tc></w:tr>` +
  Array.from(
    { length: BODY_ROWS },
    (_, index) => `<w:tr><w:tc>${p(`R${index}`)}</w:tc><w:tc>${p(`V${index}`)}</w:tc></w:tr>`
  ).join('') +
  `</w:tbl>${p('After')}`;

const liveEditors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  while (liveEditors.length > 0) liveEditors.pop()?.destroy();
  while (containers.length > 0) containers.pop()?.remove();
  document.getSelection()?.removeAllRanges();
});

function packageOf(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  liveEditors.push(editor);
  return editor;
}

function paragraphByText(editor: DocxEditorInstance, text: string): string {
  for (const id of editor.surface!.session.paragraphIds()) {
    if (paragraphTextOf(editor.surface!.session.part(), id) === text) return id;
  }
  throw new Error(`paragraph ${text} not found`);
}

/** The header rows of the table fragment on each page, as row heights. */
function headerHeightsByPage(editor: DocxEditorInstance): number[][] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments
        .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
        .map((table) =>
          table.rows.filter((row) => row.isHeaderRow === true).map((row) => row.box.height)
        )
    );
}

function expectPlannedHeader(heights: readonly number[][]): void {
  expect(heights.length).toBeGreaterThan(1);
  for (const header of heights) {
    expect(header).toEqual(heights[0]!);
    expect(header).toHaveLength(2);
  }
}

describe('a merge in the header rows, edited live', () => {
  test('an edit re-plans every header copy, and undo and reopen agree with it', () => {
    const editor = mount(packageOf(HEADER_MERGE_TABLE));
    const initial = headerHeightsByPage(editor);
    expectPlannedHeader(initial);
    // Two merged lines over two one-line rows: each header row keeps one line.
    expect(initial[0]![0]).toBeCloseTo(initial[0]![1]!, 3);

    // Grow the merged head by two lines: the last header row takes the surplus.
    let last = paragraphByText(editor, 'A1');
    for (const text of ['A2', 'A3']) {
      editor.surface!.setSelection({
        head: { paragraphId: last, offset: 2 },
        anchor: { paragraphId: last, offset: 2 },
      });
      editor.surface!.splitParagraph();
      expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
      last = paragraphByText(editor, text);
    }
    const grown = headerHeightsByPage(editor);
    expectPlannedHeader(grown);
    expect(grown[0]![0]).toBeCloseTo(initial[0]![0]!, 3);
    expect(grown[0]![1]!).toBeGreaterThan(initial[0]![1]! + 0.001);

    // An edit in a body row on a later page retains the planned header copies.
    const bodyParagraph = paragraphByText(editor, `R${BODY_ROWS - 1}`);
    editor.surface!.setSelection({
      head: { paragraphId: bodyParagraph, offset: 1 },
      anchor: { paragraphId: bodyParagraph, offset: 1 },
    });
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(headerHeightsByPage(editor)).toEqual(grown);

    // A cold open of the saved file plans the same header rows as the incremental pass did.
    const reopened = mount(editor.surface!.session.save());
    expect(headerHeightsByPage(reopened)).toEqual(grown);

    for (let step = 0; step < 20 && editor.can({ type: 'undo' }).ok; step += 1) {
      editor.exec({ type: 'undo' });
    }
    expect(headerHeightsByPage(editor)).toEqual(initial);
  });
});
