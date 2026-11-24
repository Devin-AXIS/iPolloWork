// The stored-marks lane: formatting armed at a collapsed caret and applied to the next
// characters typed there — Word's behavior for Bold-then-type mid-paragraph, and for
// setting the face of an empty paragraph before writing into it.
//
// The rules pinned here:
//  - Arming writes NOTHING to the document; typing consumes it in the SAME transaction as
//    the insert, so one undo removes the characters and their formatting together.
//  - The typed range's base is the face the caret had AT ARM TIME, taken from what its run
//    itself AUTHORS — never the cascade (see run-formatting-authors-its-own).
//  - The armed format survives the caret-preserving edits Word keeps it across (Backspace,
//    Delete, Enter, Shift+Enter, Tab) and reaches every insertion lane (typing, plain
//    paste, IME composition).
//  - It is discarded when the caret moves elsewhere, and when the document is undone or
//    moved by someone else.
//  - THE KEYSTROKE IS NEVER THE FORMAT'S HOSTAGE: a property the store will not author is
//    refused at arm time, and one that fails later drops out of the transaction rather than
//    taking the typed characters with it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** `docDefaults` as Word writes them: two properties OUTSIDE the op vocabulary, so an op
 *  that echoed the cascade would be refused — proving the base is authored-only. */
const WORD_STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '<w:noProof/><w:lang w:val="en-US"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>';

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
    'word/styles.xml': strToU8(WORD_STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/**
 * The container is handed to the callback on purpose. A `document.querySelector` for the
 * painted layer finds whichever surface some OTHER test file left mounted, so the DOM lanes
 * below (composition, paste) have to reach through the container they just mounted into.
 */
function withSurface(
  body: string,
  run: (surface: PaginatedSurface, container: HTMLElement) => void
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body));
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface, container);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

const paragraph = (runs: string) => `<w:p>${runs}</w:p>`;
const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

function caretAt(surface: PaginatedSurface, offset: number): void {
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

function collectParagraphs(node: OoxmlNode, into: OoxmlNode[]): void {
  if (node.kind === 'paragraph') {
    into.push(node);
    return;
  }
  if (node.kind === 'textValue') return;
  for (const child of node.children) collectParagraphs(child, into);
}

/** The nth paragraph's runs as `[text, ...properties]`, properties as `name` or `name=val`. */
function runsOf(surface: PaginatedSurface, index = 0): string[][] {
  const paragraphs: OoxmlNode[] = [];
  collectParagraphs(surface.session.part().root, paragraphs);
  const target = paragraphs[index];
  if (!target || target.kind === 'textValue') return [];
  const result: string[][] = [];
  for (const child of target.children) {
    if (child.kind !== 'run') continue;
    let text = '';
    const properties: string[] = [];
    for (const grand of child.children) {
      if (grand.kind === 'runProperties') {
        for (const property of grand.children) {
          if (property.kind === 'textValue') continue;
          const val = property.attributes.find((entry) => entry.localName === 'val')?.value;
          properties.push(val === undefined ? property.localName : `${property.localName}=${val}`);
        }
        continue;
      }
      text += findAllText(grand);
    }
    result.push([text, ...properties]);
  }
  return result;
}

function findAllText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += findAllText(child);
  return text;
}

describe('pending caret formatting', () => {
  test('bold armed mid-run styles only the characters typed next', () => {
    withSurface(paragraph(textRun('hello world')), (surface) => {
      caretAt(surface, 5);
      surface.toggleRunProperty('b');
      // Arming is not a document edit.
      expect(runsOf(surface)).toEqual([['hello world']]);
      expect(surface.formatting().bold).toBe(true);

      surface.type('XY');
      // The run split at the caret; only the typed slice states bold. The base carries
      // nothing from the cascade — `w:lang`/`w:noProof` live in docDefaults, and echoing
      // them would have had the whole transaction refused.
      expect(runsOf(surface)).toEqual([['hello'], ['XY', 'b'], [' world']]);

      // Consumed: typing again continues bold by inheritance from the run at the caret,
      // NOT by a second pending write (the armed format is spent).
      expect(surface.formatting().bold).toBe(true);
    });
  });

  test('one undo removes the typed characters and their formatting together', () => {
    withSurface(paragraph(textRun('hello')), (surface) => {
      caretAt(surface, 5);
      surface.toggleRunProperty('b');
      surface.type('!');
      expect(runsOf(surface)).toEqual([['hello'], ['!', 'b']]);
      surface.undo();
      expect(runsOf(surface)).toEqual([['hello']]);
    });
  });

  test('the base is what the caret run itself authors, merged under the armed properties', () => {
    withSurface(
      paragraph(
        textRun('georgia', '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>')
      ),
      (surface) => {
        caretAt(surface, 7);
        surface.toggleRunProperty('b');
        surface.type('x');
        // The typed character keeps Georgia AND gains bold — the armed set merges over the
        // caret run's own `w:rPr`, not over nothing and not over the cascade.
        expect(runsOf(surface)).toEqual([
          ['georgia', 'rFonts'],
          ['x', 'rFonts', 'b'],
        ]);
      }
    );
  });

  test('an empty paragraph takes font, size and bold armed before typing', () => {
    withSurface(paragraph(''), (surface) => {
      caretAt(surface, 0);
      surface.setRunProperty('rFonts', { ascii: 'Georgia', hAnsi: 'Georgia' });
      surface.setRunProperty('sz', { val: '32' });
      surface.toggleRunProperty('b');
      // The toolbar reflects the armed face before a single character exists.
      expect(surface.formatting().fontFamily).toBe('Georgia');
      expect(surface.formatting().fontSizeHalfPoints).toBe(32);
      expect(surface.formatting().bold).toBe(true);

      surface.type('Hi');
      const runs = runsOf(surface);
      expect(runs).toHaveLength(1);
      expect(runs[0]![0]).toBe('Hi');
      expect(runs[0]!.slice(1).sort()).toEqual(['b', 'rFonts', 'sz=32']);
    });
  });

  test('a second press cancels, and an armed format survives re-adopting the same caret', () => {
    // At a word's edge: inside a word the press formats the whole word instead.
    withSurface(paragraph(textRun('he llo')), (surface) => {
      caretAt(surface, 2);
      surface.toggleRunProperty('b');
      expect(surface.formatting().bold).toBe(true);
      surface.toggleRunProperty('b');
      expect(surface.formatting().bold).toBe(false);
      // Cancelled all the way: typing writes nothing pending.
      surface.type('z');
      expect(runsOf(surface)).toEqual([['hez llo']]);
    });
  });

  test('moving the caret discards the armed format', () => {
    withSurface(paragraph(textRun('he llo')), (surface) => {
      caretAt(surface, 2);
      surface.toggleRunProperty('b');
      caretAt(surface, 4);
      surface.type('x');
      expect(runsOf(surface)).toEqual([['he lxlo']]);
    });
  });

  test('Backspace and Delete keep the armed format, re-anchored where the caret lands', () => {
    // Word's rule: the typing format survives character deletes — arm bold, backspace a
    // character, and the next character typed still comes out bold.
    withSurface(paragraph(textRun('he llo')), (surface) => {
      caretAt(surface, 2);
      surface.toggleRunProperty('i');
      surface.deleteBackward();
      expect(surface.formatting().italic).toBe(true);
      surface.type('y');
      expect(runsOf(surface)).toEqual([['h'], ['y', 'i'], [' llo']]);
    });
    withSurface(paragraph(textRun('he llo')), (surface) => {
      caretAt(surface, 2);
      surface.toggleRunProperty('i');
      surface.deleteForward();
      // Delete does not move the caret; the anchor stays put.
      surface.type('y');
      expect(runsOf(surface)).toEqual([['he'], ['y', 'i'], ['llo']]);
    });
  });

  test('Enter carries the armed format into the new paragraph', () => {
    withSurface(paragraph(textRun('hello')), (surface) => {
      caretAt(surface, 5);
      surface.toggleRunProperty('b');
      surface.splitParagraph();
      // Still armed, now at the start of the paragraph the split minted.
      expect(surface.formatting().bold).toBe(true);
      surface.type('x');
      expect(runsOf(surface, 1)).toEqual([['x', 'b']]);
      // The original paragraph was never touched by the armed format.
      expect(runsOf(surface, 0)).toEqual([['hello']]);
    });
  });

  test('an invalid armed size cannot prevent Enter or the next character', () => {
    withSurface(paragraph(textRun('hello')), (surface) => {
      caretAt(surface, 5);
      surface.setRunProperty('sz', { 'bad attribute': '72' });
      surface.splitParagraph();
      expect(surface.session.paragraphIds()).toHaveLength(2);
      expect(surface.state().lastRejection).toBeNull();
      surface.type('x');
      expect(runsOf(surface, 1)).toEqual([['x']]);
    });
  });

  for (const lineBreak of [false, true]) {
    test(`${lineBreak ? 'Shift+Enter' : 'Enter'} carries formatting applied to selected text`, () => {
      withSurface(paragraph(''), (surface) => {
        caretAt(surface, 0);
        surface.type('hello');
        const id = surface.session.paragraphIds()[0]!;
        surface.setSelection({
          anchor: { paragraphId: id, offset: 0 },
          head: { paragraphId: id, offset: 5 },
        });
        surface.setRunProperty('sz', { val: '32' });
        surface.setRunProperty('rFonts', { ascii: 'Georgia', hAnsi: 'Georgia' });
        surface.toggleRunProperty('b');
        caretAt(surface, 5);
        expect(surface.state().pendingFormat).toBeNull();
        if (lineBreak) surface.insertLineBreak();
        else surface.splitParagraph();
        expect(surface.formatting().fontSizeHalfPoints).toBe(32);
        expect(surface.formatting().fontFamily).toBe('Georgia');
        expect(surface.formatting().bold).toBe(true);
        surface.type('next');
        const run = runsOf(surface, lineBreak ? 0 : 1).at(-1)!;
        expect(run[0]).toContain('next');
        expect(run).toContain('sz=32');
        expect(run).toContain('rFonts');
        expect(run).toContain('b');
      });
    });
  }

  test('the base captured at arm time survives deleting the run beside the caret', () => {
    // Word keeps the FACE you armed, not whatever run the caret drifts against: arm
    // italic beside a bold character, backspace the bold character away, and the next
    // character is still bold italic.
    withSurface(paragraph(textRun('plain') + textRun('B', '<w:rPr><w:b/></w:rPr>')), (surface) => {
      caretAt(surface, 6);
      surface.toggleRunProperty('i');
      surface.deleteBackward();
      surface.type('x');
      expect(runsOf(surface)).toEqual([['plain'], ['x', 'b', 'i']]);
    });
  });

  test('composed (IME) text takes the armed format like typed text', () => {
    withSurface(paragraph(textRun('hello')), (surface, container) => {
      caretAt(surface, 5);
      surface.toggleRunProperty('b');

      // The composition lane: the browser writes into the painted DOM and the surface
      // reads it back on compositionend — the one insertion that bypasses `type()`.
      const pagesLayer = container.querySelector('.docx-pages') as HTMLElement;
      pagesLayer.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      const span = pagesLayer.querySelector('[data-paragraph-id][data-start]') as HTMLElement;
      span.textContent = 'hello漢';
      pagesLayer.dispatchEvent(new Event('compositionend', { bubbles: true }));
      // Queued like typed text, it lands at the next flush with the format still armed.
      surface.flushPendingInput();

      expect(runsOf(surface)).toEqual([['hello'], ['漢', 'b']]);
    });
  });

  test('Shift+Enter and Tab keep the armed format', () => {
    withSurface(paragraph(textRun('hello')), (surface) => {
      caretAt(surface, 5);
      surface.toggleRunProperty('b');
      surface.insertLineBreak();
      expect(surface.formatting().bold).toBe(true);
      surface.type('x');
      // The line break lives in the original run; the typed character carries the format.
      expect(runsOf(surface).at(-1)).toEqual(['x', 'b']);
    });
    withSurface(paragraph(textRun('hello')), (surface) => {
      caretAt(surface, 5);
      surface.toggleRunProperty('b');
      surface.insertTab();
      surface.type('x');
      expect(runsOf(surface).at(-1)).toEqual(['x', 'b']);
    });
  });

  test('plain paste at an armed caret takes the typing format', () => {
    withSurface(paragraph(textRun('hello')), (surface, container) => {
      caretAt(surface, 5);
      surface.toggleRunProperty('b');
      const layer = container.querySelector('.docx-pages') as HTMLElement;
      const data = new DataTransfer();
      data.setData('text/plain', ' world');
      layer.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      );
      expect(runsOf(surface)).toEqual([['hello'], [' world', 'b']]);
    });
  });

  test('undo clears the armed format before reverting earlier text', () => {
    withSurface(paragraph(textRun('hello')), (surface) => {
      caretAt(surface, 5);
      surface.type('a');
      caretAt(surface, 5);
      surface.toggleRunProperty('b');
      surface.undo();
      expect(runsOf(surface)).toEqual([['helloa']]);
      expect(surface.formatting().bold).toBe(false);
      surface.undo();
      expect(surface.formatting().bold).toBe(false);
      surface.type('z');
      expect(runsOf(surface)).toEqual([['helloz']]);
    });
  });

  test('a property the store cannot author is refused at arm time', () => {
    withSurface(paragraph(textRun('hello')), (surface) => {
      caretAt(surface, 5);
      // Outside the D8 run vocabulary. Armed, it would ride the next keystroke's
      // transaction and reject the insert with it — every keystroke dead until the caret
      // moved. Refused here instead, so typing is untouched.
      surface.setRunProperty('bogusProperty', { val: '1' });
      expect(surface.state().pendingFormat).toBeNull();
      surface.type('x');
      expect(runsOf(surface)).toEqual([['hellox']]);
      expect(surface.state().lastRejection).toBeNull();
    });
  });

  test('the armed format is reported as state, so a host can reflect it', () => {
    withSurface(paragraph(textRun('he llo')), (surface) => {
      caretAt(surface, 2);
      expect(surface.state().pendingFormat).toBeNull();
      surface.toggleRunProperty('b');
      expect(surface.state().pendingFormat).toEqual([{ localName: 'b' }]);
      // Reference-stable while unchanged: a host may compare states to decide to re-derive.
      expect(surface.state().pendingFormat).toBe(surface.state().pendingFormat);
      caretAt(surface, 4);
      expect(surface.state().pendingFormat).toBeNull();
    });
  });

  test('toggling against bold context arms the OFF state', () => {
    withSurface(paragraph(textRun('bold', '<w:rPr><w:b/></w:rPr>')), (surface) => {
      caretAt(surface, 4);
      // The caret reads the bold run to its left, so the toggle arms bold OFF.
      surface.toggleRunProperty('b');
      expect(surface.formatting().bold).toBe(false);
      surface.type('x');
      expect(runsOf(surface)).toEqual([
        ['bold', 'b'],
        ['x', 'b=0'],
      ]);
    });
  });
});
