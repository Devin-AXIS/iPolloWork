// Run formatting over a selection that spans several paragraphs.
//
// Word applies Bold, a font, a size or a colour to every paragraph a selection touches. This
// engine wrote run properties inside ONE paragraph only, so a cross-paragraph drag left the
// whole run-formatting half of the toolbar disabled — bold, italic, underline, strike, the
// font pickers and the colour pickers all greyed out the moment the selection crossed a
// pilcrow, with the caret-formatting reads (which were already range-wide) reporting state no
// control could change.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** Nothing outside the D8 run vocabulary, so an op reaches the tree rather than being refused. */
const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
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

const p = (runs: string) => `<w:p>${runs}</w:p>`;
const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

/**
 * Mount, run, tear down. A leaked editor keeps its document-level selection listeners, and
 * the next test file's DOM events reach a surface nobody is looking at.
 */
function withEditor(body: string, run: (editor: DocxEditorInstance) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
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

describe('run formatting across a multi-paragraph selection', () => {
  test('the run-formatting controls stay live when the selection crosses a paragraph', () => {
    withEditor(p(textRun('alpha')) + p(textRun('beta')), (editor) => {
      select(editor, [0, 0], [1, 4]);
      for (const slot of [
        'text.bold',
        'text.italic',
        'text.underline',
        'text.strike',
        'font.family',
        'font.size',
        'text.color',
        'text.highlight',
      ] as const) {
        expect([slot, toolbarCommandState(editor, slot).enabled]).toEqual([slot, true]);
      }
    });
  });

  test('bold reaches every paragraph the selection touches', () => {
    withEditor(p(textRun('alpha')) + p(textRun('beta')) + p(textRun('gamma')), (editor) => {
      select(editor, [0, 0], [2, 5]);
      expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({ ok: true });
      expect(authoredRunProperties(editor)).toEqual([[['b']], [['b']], [['b']]]);
      expect(editor.snapshot().formatting?.bold).toBe(true);
    });
  });

  test('a partly covered first and last paragraph formats only the covered text', () => {
    withEditor(p(textRun('alpha')) + p(textRun('beta')) + p(textRun('gamma')), (editor) => {
      // From the middle of "alpha" to the middle of "gamma".
      select(editor, [0, 2], [2, 3]);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(authoredRunProperties(editor)).toEqual([[[], ['b']], [['b']], [['b'], []]]);
    });
  });

  test('the paragraph mark follows every pilcrow the selection contains', () => {
    // The pilcrow is a character in the stream: a selection reaching paragraph three has
    // passed through the marks of one and two, whatever offset it started at. Only the
    // LAST paragraph's mark is outside the range, and it keeps the whole-text rule a
    // single-paragraph edit uses. The mark is what a list marker inherits its face from,
    // so getting this wrong left the first bullet of a drag at the old size.
    withEditor(p(textRun('alpha')) + p(textRun('beta')) + p(textRun('gamma')), (editor) => {
      select(editor, [0, 2], [2, 3]);
      editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: 52 });
      expect(authoredMarkProperties(editor)).toEqual([['sz=52'], ['sz=52'], []]);
    });
  });

  test('a selection ending at the end of the last paragraph takes its mark too', () => {
    withEditor(p(textRun('alpha')) + p(textRun('beta')), (editor) => {
      select(editor, [0, 2], [1, 4]);
      editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: 52 });
      expect(authoredMarkProperties(editor)).toEqual([['sz=52'], ['sz=52']]);
    });
  });

  test('each run keeps its own properties rather than the first run of the range', () => {
    withEditor(
      p(textRun('alpha', '<w:rPr><w:i/></w:rPr>')) +
        p(textRun('beta', '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>')),
      (editor) => {
        select(editor, [0, 0], [1, 4]);
        editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'FF0000' });
        expect(authoredRunProperties(editor)).toEqual([
          [['i', 'color=FF0000']],
          [['rFonts', 'color=FF0000']],
        ]);
      }
    );
  });

  test('a backwards drag formats the same range', () => {
    withEditor(p(textRun('alpha')) + p(textRun('beta')), (editor) => {
      select(editor, [1, 4], [0, 0]);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(authoredRunProperties(editor)).toEqual([[['b']], [['b']]]);
    });
  });

  test('a second press across the same range toggles it back off', () => {
    withEditor(p(textRun('alpha')) + p(textRun('beta')), (editor) => {
      select(editor, [0, 0], [1, 4]);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(editor.snapshot().formatting?.bold).toBe(true);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(editor.snapshot().formatting?.bold).toBe(false);
      expect(authoredRunProperties(editor)).toEqual([[['b=0']], [['b=0']]]);
    });
  });

  test('an empty FIRST paragraph gets the mark, like an empty one in the middle', () => {
    // Its pilcrow is inside the range whatever the range started at, and it has no run to
    // carry the change, so the mark is the only place the format can live.
    withEditor(p('') + p(textRun('beta')), (editor) => {
      select(editor, [0, 0], [1, 4]);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(authoredMarkProperties(editor)).toEqual([['b'], ['b']]);
    });
  });

  test('a drag across nothing but a paragraph break still formats that pilcrow', () => {
    // From the end of one paragraph to the start of the next: no TEXT is selected, but the
    // mark between them is. `can` said yes for this press, so `exec` reporting success over
    // an unmoved document would be the exact lie the toolbar contract forbids.
    withEditor(p(textRun('alpha')) + p(textRun('beta')), (editor) => {
      select(editor, [0, 5], [1, 0]);
      expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
      expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(authoredMarkProperties(editor)).toEqual([['b'], []]);
      // No text was selected, so no run moved.
      expect(authoredRunProperties(editor)).toEqual([[[]], [[]]]);
    });
  });

  test('an empty paragraph inside the range gets the mark so typing there continues bold', () => {
    withEditor(p(textRun('alpha')) + p('') + p(textRun('gamma')), (editor) => {
      select(editor, [0, 0], [2, 5]);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(authoredMarkProperties(editor)).toEqual([['b'], ['b'], ['b']]);
    });
  });
});
