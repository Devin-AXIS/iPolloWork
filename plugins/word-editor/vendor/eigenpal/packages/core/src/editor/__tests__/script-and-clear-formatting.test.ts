// Superscript, subscript and Clear Formatting: the last three run-formatting slots that
// rendered disabled with "not wired to an editor command".
//
// Superscript and subscript are ONE run property (`w:vertAlign`, 17.3.2.42) with three
// values, not two independent booleans — so they are mutually exclusive, their off value is
// `baseline` rather than the `0` the boolean toggles write, and a toggle has to compare the
// VALUE in force, not merely whether the element is present.
//
// Clear Formatting is Word's eraser: direct character formatting off the selected text, and
// the paragraph reset to the default style with its direct paragraph properties dropped.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
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

const p = (runs: string, pPr = '') => `<w:p>${pPr}${runs}</w:p>`;
const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

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

/** Each paragraph's own `w:pPr`, minus the mark. */
function authoredParagraphProperties(editor: DocxEditorInstance): string[][] {
  return paragraphNodes(editor).map((paragraph) => {
    if (paragraph.kind === 'textValue') return [];
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    if (!pPr || pPr.kind === 'textValue') return [];
    return describeProperties(pPr).filter((entry) => entry !== 'rPr');
  });
}

function select(editor: DocxEditorInstance, from: [number, number], to: [number, number]): void {
  const ids = editor.surface!.session.paragraphIds();
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
}

describe('superscript and subscript', () => {
  test('the slots are live and pressing one writes w:vertAlign', () => {
    withEditor(p(textRun('x2')), (editor) => {
      select(editor, [0, 1], [0, 2]);
      expect(toolbarCommandState(editor, 'script.super').enabled).toBe(true);
      expect(toolbarCommandState(editor, 'script.sub').enabled).toBe(true);

      expect(editor.exec({ type: 'toggleMark', mark: 'superscript' })).toMatchObject({ ok: true });
      expect(authoredRunProperties(editor)).toEqual([[[], ['vertAlign=superscript']]]);
      expect(editor.snapshot().formatting?.superscript).toBe(true);
      expect(toolbarCommandState(editor, 'script.super').active).toBe(true);
      expect(toolbarCommandState(editor, 'script.sub').active).toBe(false);
    });
  });

  test('a second press returns the run to the baseline instead of re-applying', () => {
    // The off value is `baseline`, not the `0` the boolean toggles write: `w:vertAlign` is
    // a closed enumeration (ST_VerticalAlignRun), and `val="0"` is one Word rejects.
    withEditor(p(textRun('x2')), (editor) => {
      select(editor, [0, 1], [0, 2]);
      editor.exec({ type: 'toggleMark', mark: 'superscript' });
      editor.exec({ type: 'toggleMark', mark: 'superscript' });
      expect(authoredRunProperties(editor)).toEqual([[[], ['vertAlign=baseline']]]);
      expect(editor.snapshot().formatting?.superscript).toBe(false);
    });
  });

  test('the two are mutually exclusive — one property, three values', () => {
    withEditor(p(textRun('x2')), (editor) => {
      select(editor, [0, 1], [0, 2]);
      editor.exec({ type: 'toggleMark', mark: 'superscript' });
      // Subscript over superscripted text REPLACES it rather than reading as "already on".
      editor.exec({ type: 'toggleMark', mark: 'subscript' });
      expect(authoredRunProperties(editor)).toEqual([[[], ['vertAlign=subscript']]]);
      expect(editor.snapshot().formatting?.subscript).toBe(true);
      expect(editor.snapshot().formatting?.superscript).toBe(false);
    });
  });

  test('a subscript already in the file reads as pressed and toggles off', () => {
    withEditor(
      p(textRun('H') + textRun('2', '<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>')),
      (editor) => {
        select(editor, [0, 1], [0, 2]);
        expect(editor.snapshot().formatting?.subscript).toBe(true);
        expect(toolbarCommandState(editor, 'script.sub').active).toBe(true);
        editor.exec({ type: 'toggleMark', mark: 'subscript' });
        expect(authoredRunProperties(editor)).toEqual([[[], ['vertAlign=baseline']]]);
        expect(editor.snapshot().formatting?.subscript).toBe(false);
      }
    );
  });

  test('at a caret it arms the typing format, and a second press disarms it', () => {
    withEditor(p(textRun('x')), (editor) => {
      select(editor, [0, 1], [0, 1]);
      editor.exec({ type: 'toggleMark', mark: 'superscript' });
      expect(editor.snapshot().formatting?.superscript).toBe(true);
      editor.exec({ type: 'toggleMark', mark: 'superscript' });
      expect(editor.snapshot().formatting?.superscript).toBe(false);
      // Armed again, then typed: the new characters carry it, the old one does not.
      editor.exec({ type: 'toggleMark', mark: 'superscript' });
      editor.surface!.type('2');
      expect(authoredRunProperties(editor)).toEqual([[[], ['vertAlign=superscript']]]);
    });
  });

  test('Word’s Ctrl+= / Ctrl+Shift+= reach the same toggle the buttons do', () => {
    // Both controls' tooltips name these shortcuts, so an unbound key would make the label
    // a lie. Shift alone decides which one: `event.key` is the PRODUCED character, so a US
    // layout reports `+` for Ctrl+Shift+=, and choosing by the character sent Ctrl+`+` to
    // superscript on the layouts where `+` is unshifted.
    const press = (init: Partial<KeyboardEvent> & { key: string }) =>
      ({
        preventDefault: () => {},
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...init,
      }) as KeyboardEvent;

    withEditor(p(textRun('x2')), (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 1], [0, 2]);
      onKeyDown(press({ key: '=', ctrlKey: true }));
      expect(editor.snapshot().formatting?.subscript).toBe(true);

      onKeyDown(press({ key: '=', ctrlKey: true, shiftKey: true }));
      expect(editor.snapshot().formatting?.superscript).toBe(true);
      expect(editor.snapshot().formatting?.subscript).toBe(false);

      onKeyDown(press({ key: '+', ctrlKey: true, shiftKey: true }));
      expect(editor.snapshot().formatting?.superscript).toBe(false);

      // A layout where `+` is UNSHIFTED (German) must reach subscript, not superscript.
      onKeyDown(press({ key: '+', ctrlKey: true }));
      expect(editor.snapshot().formatting?.subscript).toBe(true);
    });
  });

  test('a chord a host already claimed is left alone rather than scripted as well', () => {
    // Hosts bind Ctrl/Cmd+`=` too — React's live zoom claims it in the CAPTURE phase, so it
    // reaches this keymap already default-prevented. Without failing soft the one keystroke
    // both zoomed and rewrote the selection's `w:vertAlign`.
    const claimed = (init: Partial<KeyboardEvent> & { key: string }) =>
      ({
        preventDefault: () => {},
        defaultPrevented: true,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...init,
      }) as KeyboardEvent;

    withEditor(p(textRun('x2')), (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 1], [0, 2]);
      const revisionBefore = editor.surface!.state().revision;

      onKeyDown(claimed({ key: '=', ctrlKey: true }));
      onKeyDown(claimed({ key: '+', ctrlKey: true, shiftKey: true }));

      expect(editor.snapshot().formatting?.subscript).toBe(false);
      expect(editor.snapshot().formatting?.superscript).toBe(false);
      expect(editor.surface!.state().revision).toBe(revisionBefore);
      expect(editor.surface!.state().canUndo).toBe(false);
    });
  });

  test('it applies across a multi-paragraph selection like the other marks', () => {
    withEditor(p(textRun('alpha')) + p(textRun('beta')), (editor) => {
      select(editor, [0, 0], [1, 4]);
      editor.exec({ type: 'toggleMark', mark: 'superscript' });
      expect(authoredRunProperties(editor)).toEqual([
        [['vertAlign=superscript']],
        [['vertAlign=superscript']],
      ]);
    });
  });
});

describe('the paragraphs a range touches', () => {
  test('a range ending at the next paragraph’s start leaves that paragraph alone', () => {
    withEditor(
      p(textRun('first'), '<w:pPr><w:jc w:val="center"/></w:pPr>') +
        p(textRun('second'), '<w:pPr><w:jc w:val="right"/></w:pPr>'),
      (editor) => {
        // Dragging from the middle of one paragraph to the very START of the next selects no
        // character of the next, and Word treats it that way. The eraser used to clear it.
        select(editor, [0, 2], [1, 0]);
        expect(editor.exec({ type: 'clearFormatting' })).toMatchObject({ ok: true });
        expect(authoredParagraphProperties(editor)).toEqual([[], ['jc=right']]);
      }
    );
  });
});

describe('clear formatting', () => {
  test('the slot is live and the press strips direct run properties from the selection', () => {
    withEditor(
      p(textRun('bold', '<w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr>') + textRun(' plain')),
      (editor) => {
        select(editor, [0, 0], [0, 10]);
        const state = toolbarCommandState(editor, 'format.clear');
        expect(state.enabled).toBe(true);
        expect(state.disabledReason).toBe(null);

        expect(editor.exec({ type: 'clearFormatting' })).toMatchObject({ ok: true });
        expect(authoredRunProperties(editor)).toEqual([[[], []]]);
        expect(editor.snapshot().formatting?.bold).toBe(false);
        expect(editor.snapshot().formatting?.color).toBeUndefined();
      }
    );
  });

  test('the paragraph goes back to the default style and drops its direct properties', () => {
    withEditor(
      p(
        textRun('heading'),
        '<w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/><w:ind w:left="720"/></w:pPr>'
      ),
      (editor) => {
        select(editor, [0, 0], [0, 7]);
        expect(editor.snapshot().formatting?.styleId).toBe('Heading1');
        editor.exec({ type: 'clearFormatting' });
        expect(authoredParagraphProperties(editor)).toEqual([[]]);
        // No `w:pStyle` means the document's default paragraph style, which is what the
        // style box shows — a blank box would be a statement about the file, not the text.
        expect(editor.snapshot().formatting?.styleId).toBe('Normal');
        expect(editor.snapshot().formatting?.alignment).toBe('left');
      }
    );
  });

  test('only the SELECTED text loses its run formatting; the paragraph still resets', () => {
    // Word's split: character formatting is a range, paragraph formatting is not.
    withEditor(
      p(
        textRun('keep', '<w:rPr><w:b/></w:rPr>') + textRun('clear', '<w:rPr><w:b/></w:rPr>'),
        '<w:pPr><w:jc w:val="center"/></w:pPr>'
      ),
      (editor) => {
        select(editor, [0, 4], [0, 9]);
        editor.exec({ type: 'clearFormatting' });
        expect(authoredRunProperties(editor)).toEqual([[['b'], []]]);
        expect(authoredParagraphProperties(editor)).toEqual([[]]);
      }
    );
  });

  test('every paragraph the selection touches is reset', () => {
    withEditor(
      p(textRun('one', '<w:rPr><w:b/></w:rPr>'), '<w:pPr><w:jc w:val="center"/></w:pPr>') +
        p(textRun('two', '<w:rPr><w:i/></w:rPr>'), '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'),
      (editor) => {
        select(editor, [0, 0], [1, 3]);
        editor.exec({ type: 'clearFormatting' });
        expect(authoredRunProperties(editor)).toEqual([[[]], [[]]]);
        expect(authoredParagraphProperties(editor)).toEqual([[], []]);
      }
    );
  });

  test('a caret resets the paragraph and disarms the typing format', () => {
    withEditor(p(textRun('text'), '<w:pPr><w:jc w:val="center"/></w:pPr>'), (editor) => {
      // At the word's end, so the press arms a typing format rather than formatting the word.
      select(editor, [0, 4], [0, 4]);
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(editor.snapshot().formatting?.bold).toBe(true);
      editor.exec({ type: 'clearFormatting' });
      expect(editor.snapshot().formatting?.bold).toBe(false);
      expect(authoredParagraphProperties(editor)).toEqual([[]]);
      // Nothing was selected, so the existing text keeps what it had.
      expect(authoredRunProperties(editor)).toEqual([[[]]]);
    });
  });

  test('it is one undo step', () => {
    withEditor(
      p(textRun('one', '<w:rPr><w:b/></w:rPr>'), '<w:pPr><w:jc w:val="center"/></w:pPr>') +
        p(textRun('two', '<w:rPr><w:i/></w:rPr>')),
      (editor) => {
        select(editor, [0, 0], [1, 3]);
        editor.exec({ type: 'clearFormatting' });
        expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
        expect(authoredRunProperties(editor)).toEqual([[['b']], [['i']]]);
        expect(authoredParagraphProperties(editor)).toEqual([['jc=center'], []]);
      }
    );
  });

  test('on already-clean text it does nothing, and costs no undo step', () => {
    // An op that names nothing still counts as APPLIED, so emitting three per paragraph
    // unconditionally published a revision and pushed an undo entry for a press that left
    // the tree identical — `changed: true` over a document that did not move, and an undo
    // press that undid nothing.
    withEditor(p(textRun('plain')), (editor) => {
      select(editor, [0, 0], [0, 5]);
      const revision = editor.surface!.session.revision();
      expect(editor.exec({ type: 'clearFormatting' })).toMatchObject({ changed: false });
      expect(editor.surface!.session.revision()).toBe(revision);
      expect(editor.surface!.session.canUndo()).toBe(false);
    });
  });

  test('a cleared paragraph is left as one that never had properties', () => {
    // The mark op must run BEFORE the paragraph op: `setParagraphProperties` cannot name
    // `w:rPr`, so it preserves the mark, and the applier drops a `w:pPr` only once it has no
    // children left. The other order left an empty `<w:pPr/>` behind.
    withEditor(
      p(textRun('text', '<w:rPr><w:b/></w:rPr>'), '<w:pPr><w:jc w:val="center"/></w:pPr>'),
      (editor) => {
        select(editor, [0, 0], [0, 4]);
        editor.exec({ type: 'clearFormatting' });
        const paragraph = paragraphNodes(editor)[0]!;
        if (paragraph.kind === 'textValue') throw new Error('unexpected');
        expect(paragraph.children.some((child) => child.kind === 'paragraphProperties')).toBe(
          false
        );
      }
    );
  });

  test('a mark name off Object.prototype is refused rather than half-accepted', () => {
    // The marks table is keyed by CALLER input. An object literal answers `constructor` and
    // `toString` off the prototype chain, so those passed the support gate, reached the
    // store, and were refused there — `can` said yes and the press did nothing.
    withEditor(p(textRun('plain')), (editor) => {
      select(editor, [0, 0], [0, 5]);
      for (const mark of ['toString', 'constructor', '__proto__']) {
        const answer = editor.can({ type: 'toggleMark', mark });
        expect([mark, answer.ok]).toEqual([mark, false]);
      }
    });
  });

  test('a character style survives — an op cannot name w:rStyle', () => {
    // Honest limit, pinned so it cannot regress silently: `w:rStyle` is preserved rather
    // than accepted by the property vocabulary (admitting it would make every Bold press
    // delete the character style), so the eraser cannot remove it here.
    withEditor(
      p(textRun('linked', '<w:rPr><w:rStyle w:val="Hyperlink"/><w:b/></w:rPr>')),
      (editor) => {
        select(editor, [0, 0], [0, 6]);
        editor.exec({ type: 'clearFormatting' });
        expect(authoredRunProperties(editor)).toEqual([[['rStyle=Hyperlink']]]);
      }
    );
  });
});
