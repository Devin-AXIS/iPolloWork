// Typing in SUGGESTING mode, through the surface rather than the store.
//
// The store's own markup rules live in `store/__tests__/tracked-edits.test.ts`. What is
// pinned here is the keystroke sequence a reviewer actually performs: Enter opens a
// paragraph, and the next character has to land in it. Enter leaves a paragraph carrying
// `w:pPr` and nothing else — the shape a tracked insertion has to be able to write into —
// so a rule that only held for a paragraph with runs in it looked like a dead keyboard.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { selectCellRectangle } from './paginated-surface-fixtures.ts';
import { diagnosticCodeOfRefusal } from '../diagnostic-codes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const listItem = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const styledParagraph = (text: string) =>
  `<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const plainParagraph = (text: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function withSurface(body: string, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), { author: 'Ada Lovelace' });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    opened.surface.setEditingMode('suggest');
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

/** Every paragraph's text, in document order. */
function paragraphTexts(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  const collect = (node: OoxmlNode, into: string[]): void => {
    if (node.kind === 'textValue') {
      into.push(node.value);
      return;
    }
    for (const child of node.children) collect(child, into);
  };
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const parts: string[] = [];
      collect(node, parts);
      out.push(parts.join(''));
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(surface.session.part().root);
  return out;
}

function caretTo(surface: PaginatedSurface, index: number, offset: number): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function selectIn(surface: PaginatedSurface, index: number, start: number, end: number): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function selectAcross(
  surface: PaginatedSurface,
  fromIndex: number,
  fromOffset: number,
  toIndex: number,
  toOffset: number
): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[fromIndex]!, offset: fromOffset },
    head: { paragraphId: ids[toIndex]!, offset: toOffset },
  });
}

/** Type `text` one character at a time, the way a keyboard delivers it. */
function typeEach(surface: PaginatedSurface, text: string): void {
  for (const character of text) surface.type(character);
}

describe('Enter then type, in suggesting mode', () => {
  test('the character lands in the list item Enter just opened', () => {
    withSurface(listItem('Introduction') + listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      surface.insertPlainText('Findings');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Introduction', 'Findings', 'Analysis']);
    });
  });

  test('and in a plain paragraph that only carries an indent', () => {
    withSurface(styledParagraph('first'), (surface) => {
      caretTo(surface, 0, 'first'.length);
      surface.splitParagraph();
      surface.insertPlainText('second');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['first', 'second']);
    });
  });

  test('the typed run is a proposal, and the properties stay ahead of it', () => {
    withSurface(listItem('Introduction'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      surface.insertPlainText('Findings');
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:ins[^>]*w:author="Ada Lovelace"[^>]*>/);
      // `w:pPr` first (§17.3.1.26). The insertion landing ahead of it is markup the
      // paragraph invariant refuses, which is how the keystroke came to be dropped.
      expect(xml).toMatch(/<\/w:pPr><w:ins[^>]*><w:r><w:t[^>]*>Findings<\/w:t><\/w:r><\/w:ins>/);
    });
  });
});

// TYPING OVER YOUR OWN SUGGESTION.
//
// A tracked deletion does one of two things, and the replacement offset differs for each.
// Somebody else's words are STRUCK: they stay, and the replacement goes after them. Your own
// pending insertion is RETRACTED: the characters leave the paragraph, and aiming past them
// aims past the end of it — which the store refuses, taking the whole transaction with it.
// So every keystroke over your own suggestion did nothing, and the selection stayed.
describe('typing over a pending suggestion', () => {
  test('replaces your own insertion instead of being refused', () => {
    withSurface(listItem('Introduction') + listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      typeEach(surface, 'sda');
      selectIn(surface, 1, 0, 3);
      typeEach(surface, 'Hello');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Introduction', 'Hello', 'Analysis']);
      // The caret follows the typing, so the NEXT character lands after it rather than in
      // front of what was already typed.
      expect(surface.state().selection.head.offset).toBe('Hello'.length);
    });
  });

  test('keeps the struck half of a mixed range and lands after it', () => {
    withSurface(listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 0);
      typeEach(surface, 'New ');
      // "New " is this author's own insertion; "Ana" is the file's own text.
      selectIn(surface, 0, 0, 'New Ana'.length);
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      // The retracted half is gone, the struck half stays, and the replacement sits after it.
      expect(paragraphTexts(surface)).toEqual(['AnaXlysis']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:del[^>]*><w:r><w:delText[^>]*>Ana<\/w:delText><\/w:r><\/w:del>/);
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:t[^>]*>X<\/w:t><\/w:r><\/w:ins>/);
      expect(xml).not.toMatch(/New/);
    });
  });
});

// TAKING A BREAK BACK IS NOT A SECOND PROPOSAL.
//
// A join is addressed by the SECOND paragraph, because the mark between two paragraphs
// belongs to the first — so Backspace at the start of a paragraph reaches the mark through
// `proposeParagraphMerge`, which never asked whether the mark was this author's own. Enter
// then Backspace therefore wrote a `w:del` on top of the `w:ins` from a second earlier: two
// cards in the rail for a decision nobody made, an empty paragraph left standing, and a mark
// whose Reject makes permanent the very break the user had just taken back. Word retracts it.
describe('Enter then Backspace, in suggesting mode', () => {
  test('the paragraph break goes away instead of stacking a deletion on it', () => {
    withSurface(listItem('Introduction') + listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      expect(surface.session.paragraphIds()).toHaveLength(3);

      // The new item is a list item, so the first Backspace removes its number. It is empty,
      // so the next joins at once, with no indent step.
      surface.deleteBackward();
      expect(surface.session.paragraphIds()).toHaveLength(3);
      expect(surface.isListParagraph()).toBe(false);

      surface.deleteBackward();
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.paragraphIds()).toHaveLength(2);
      expect(paragraphTexts(surface)).toEqual(['Introduction', 'Analysis']);

      // Nothing is left to review: the proposal and its retraction cancel out.
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/<w:ins/);
      expect(xml).not.toMatch(/<w:del/);
    });
  });

  test('somebody ELSE’s proposed break is still proposed away, not joined', () => {
    // The rule is about YOUR OWN proposal. A break another reviewer proposed is theirs to
    // keep until someone decides on it, so Backspace over it stays a proposal.
    withSurface(
      '<w:p><w:pPr><w:rPr><w:ins w:id="7" w:author="Grace Hopper" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        '<w:r><w:t>Introduction</w:t></w:r></w:p>' +
        listItem('Analysis'),
      (surface) => {
        caretTo(surface, 1, 0);
        // The first Backspace removes the list number, the second the indent the list gave
        // the text; the third reaches the break.
        surface.deleteBackward();
        expect(surface.isListParagraph()).toBe(false);
        surface.deleteBackward();
        expect(serializeOoxmlPart(surface.session.part())).not.toMatch(/<w:del\b/);
        surface.deleteBackward();
        expect(surface.state().lastRejection).toBeNull();
        expect(surface.session.paragraphIds()).toHaveLength(2);
        const xml = serializeOoxmlPart(surface.session.part());
        expect(xml).toMatch(/<w:ins[^>]*w:author="Grace Hopper"/);
        expect(xml).toMatch(/<w:del[^>]*w:author="Ada Lovelace"/);
      }
    );
  });
});

// REPLACING A SELECTION THAT SPANS PARAGRAPH MARKS.
//
// A suggesting-mode deletion keeps the characters it strikes, and the marks between the
// paragraphs become merge proposals — every paragraph survives. So the replacement belongs
// after the struck head of the LAST paragraph. Landing it at the range start instead put it
// on the front edge of the fresh `w:del`, where the store relocates it past the deletion;
// the caret math never heard about the relocation, so the caret came to rest INSIDE the
// struck words, and each next keystroke relocated to the same spot — BEFORE the one already
// typed. A typed replacement came out reversed, parked after the first struck paragraph.
describe('replacing a selection that spans paragraphs, in suggesting mode', () => {
  test('the replacement lands after the LAST struck paragraph, in typing order', () => {
    withSurface(
      plainParagraph('Alpha one') + plainParagraph('Beta two') + plainParagraph('Gamma three'),
      (surface) => {
        selectAcross(surface, 0, 0, 2, 'Gamma three'.length);
        typeEach(surface, 'New');
        expect(surface.state().lastRejection).toBeNull();
        expect(paragraphTexts(surface)).toEqual(['Alpha one', 'Beta two', 'Gamma threeNew']);
        const xml = serializeOoxmlPart(surface.session.part());
        // The struck original stays, and the replacement is ONE ordered insertion after it.
        expect(xml).toMatch(
          /<w:delText[^>]*>Gamma three<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t[^>]*>New<\/w:t>/
        );
        // The caret follows the typing, so the NEXT character extends the replacement
        // rather than landing in front of it.
        expect(surface.state().selection.head).toEqual({
          paragraphId: surface.session.paragraphIds()[2]!,
          offset: 'Gamma threeNew'.length,
        });
      }
    );
  });

  test('a paste over the selection lands in the same place', () => {
    withSurface(plainParagraph('Alpha one') + plainParagraph('Beta two'), (surface) => {
      selectAcross(surface, 0, 0, 1, 'Beta two'.length);
      surface.insertPlainText('Replacement');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha one', 'Beta twoReplacement']);
      expect(surface.state().selection.head).toEqual({
        paragraphId: surface.session.paragraphIds()[1]!,
        offset: 'Beta twoReplacement'.length,
      });
    });
  });

  test('this author’s own insertion at the head of the last paragraph retracts', () => {
    withSurface(plainParagraph('Alpha') + plainParagraph('Beta'), (surface) => {
      caretTo(surface, 1, 0);
      typeEach(surface, 'XY');
      // The range covers "pha", the pending "XY" and the struck-to-be "Be": the struck
      // halves stay, the author's own insertion leaves, and the replacement sits after
      // what remains of the last paragraph's struck head.
      selectAcross(surface, 0, 2, 1, 4);
      surface.type('Z');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha', 'BeZta']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/XY/);
    });
  });

  test('typing with the caret resting INSIDE struck words lands past the deletion', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 0, 'Alpha'.length);
      surface.deleteBackward();
      caretTo(surface, 0, 2);
      typeEach(surface, 'ab');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alphaab one']);
      expect(surface.state().selection.head.offset).toBe('Alphaab'.length);
    });
  });

  test('a MULTI-LINE paste splits inside the tracked insertion, not after it', () => {
    // `splitParagraphMany` is the op paste emits, and `distributeInline` used to send a
    // whole `w:ins` wrapper to the first piece — the lines stayed in one paragraph and the
    // minted tails came out empty.
    withSurface(plainParagraph('Alpha one') + plainParagraph('Beta two'), (surface) => {
      selectAcross(surface, 0, 0, 1, 'Beta two'.length);
      surface.insertPlainText('one\ntwo');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha one', 'Beta twoone', 'two']);
      const xml = serializeOoxmlPart(surface.session.part());
      // Each piece keeps the same tracked-insertion attribution.
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:t[^>]*>one<\/w:t><\/w:r><\/w:ins>/);
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:t[^>]*>two<\/w:t><\/w:r><\/w:ins>/);
      expect(surface.state().selection.head.offset).toBe('two'.length);
    });
  });

  test('typing over your OWN pending Enter split merges and lands after the strike', () => {
    // The join that retracts this author's own paragraph mark REALLY joins, so the last
    // paragraph of the range leaves the tree — an insert naming it vetoed the whole
    // transaction and every keystroke did nothing.
    withSurface(plainParagraph('Alpha Beta'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      surface.splitParagraph();
      selectAcross(surface, 0, 2, 1, 3);
      typeEach(surface, 'X');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha BeXta']);
      expect(surface.state().selection.head.offset).toBe('Alpha BeX'.length);
    });
  });

  test('a range that ENDS inside a pre-existing deletion lands past it, in order', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 0, 'Alpha'.length);
      surface.deleteBackward();
      selectIn(surface, 0, 1, 3);
      typeEach(surface, 'ab');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alphaab one']);
      expect(surface.state().selection.head.offset).toBe('Alphaab'.length);
    });
  });

  test('Enter over a selection breaks AFTER the struck words', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      surface.splitParagraph();
      expect(surface.state().lastRejection).toBeNull();
      // The struck word stays with the paragraph it came from; the tail carries the rest.
      expect(paragraphTexts(surface)).toEqual(['Alpha Beta', ' Gamma']);
      expect(surface.state().selection.head.offset).toBe(0);
    });
  });

  test('a section break over a selection splits AFTER the struck words', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 0, 'Alpha'.length);
      surface.insertSectionBreak();
      expect(surface.state().lastRejection).toBeNull();
      // The struck head stays with the section mark; splitting at the range START cut the
      // paragraph in FRONT of the struck words instead.
      expect(paragraphTexts(surface)).toEqual(['Alpha', ' one']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:delText[^>]*>Alpha<\/w:delText>/);
    });
  });

  test('a section break over a selection ending in a table cell still commits', () => {
    const cellXml = (text: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${plainParagraph(text)}</w:tc>`;
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
      `<w:tr>${cellXml('CellA')}${cellXml('CellB')}</w:tr></w:tbl>`;
    withSurface(plainParagraph('Alpha one') + table + plainParagraph('after'), (surface) => {
      // A section mark cannot live in a cell, so the landing falls back to the surviving
      // range start rather than letting one refused op veto the strike with it.
      selectAcross(surface, 0, 0, 1, 2);
      expect(surface.insertSectionBreak()).toBe(true);
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:delText[^>]*>Alpha one<\/w:delText>/);
    });
  });

  test('a Tab over a selection lands after the struck words, as a proposal', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      surface.insertTab();
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // The strike then the tab, adjacent — and the tab is itself a tracked insertion, so
      // Accept/Reject can act on it rather than the file recording an unattributed edit.
      expect(xml).toMatch(
        /<w:delText[^>]*>Beta<\/w:delText><\/w:r><\/w:del><w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r><w:tab\/>/
      );
      expect(surface.state().selection.head.offset).toBe('Alpha Beta'.length + 1);
    });
  });

  test('a line break and a page break are proposals too', () => {
    withSurface(plainParagraph('Alpha one') + plainParagraph('Beta two'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      surface.insertLineBreak();
      caretTo(surface, 1, 'Beta'.length);
      surface.insertPageBreak();
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r><w:br\/><\/w:r><\/w:ins>/);
      expect(xml).toMatch(
        /<w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r><w:br w:type="page"\/><\/w:r><\/w:ins>/
      );
    });
  });

  test('rejecting the proposal removes the tab', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      surface.insertTab();
      expect(surface.state().lastRejection).toBeNull();
      expect(serializeOoxmlPart(surface.session.part())).toMatch(/<w:tab\/>/);
      const result = surface.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
      expect(result.committed).toBe(true);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/<w:tab\/>/);
      expect(xml).not.toMatch(/<w:ins/);
    });
  });

  test('a Tab inside your own pending insertion extends it instead of nesting', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      caretTo(surface, 0, 0);
      typeEach(surface, 'ab');
      caretTo(surface, 0, 1);
      surface.insertTab();
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // ONE insertion: the tab joins the run the author is already proposing.
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:t[^>]*>a<\/w:t><w:tab\/><w:t[^>]*>b<\/w:t>/);
      expect(xml.match(/<w:ins /g)).toHaveLength(1);
    });
  });

  test('a format armed at a caret INSIDE struck words survives the relocation', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 0, 'Alpha'.length);
      surface.deleteBackward();
      caretTo(surface, 0, 2);
      surface.toggleRunProperty('b');
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['AlphaX one']);
      const xml = serializeOoxmlPart(surface.session.part());
      // The insert relocated past the deletion, and the armed bold rode along with it.
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>X<\/w:t>/);
    });
  });

  test('a range ENDING at the end of a table it encloses lands after the struck cell text', () => {
    const cell = (text: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${plainParagraph(text)}</w:tc>`;
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
      `<w:tr>${cell('CellA')}${cell('CellB')}</w:tr></w:tbl>`;
    withSurface(plainParagraph('Alpha one') + table + plainParagraph('Beta two'), (surface) => {
      // The table is fully covered, but removing it has no tracked form, so its cell text is
      // struck and the table stays. The replacement follows the last struck paragraph.
      selectAcross(surface, 0, 0, 2, 'CellB'.length);
      typeEach(surface, 'New');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha one', 'CellA', 'CellBNew', 'Beta two']);
      expect(surface.state().selection.head).toEqual({
        paragraphId: surface.session.paragraphIds()[2]!,
        offset: 'CellBNew'.length,
      });
    });
  });

  test('a range that encloses a table still lands after the last struck paragraph', () => {
    const cell = (text: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${plainParagraph(text)}</w:tc>`;
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
      `<w:tr>${cell('CellA')}${cell('CellB')}</w:tr></w:tbl>`;
    withSurface(plainParagraph('Alpha one') + table + plainParagraph('Beta two'), (surface) => {
      const last = surface.session.paragraphIds().length - 1;
      selectAcross(surface, 0, 0, last, 'Beta two'.length);
      typeEach(surface, 'New');
      expect(surface.state().lastRejection).toBeNull();
      // The enclosed table stays with its text struck; the last paragraph hosts the replacement.
      expect(paragraphTexts(surface)).toEqual(['Alpha one', 'CellA', 'CellB', 'Beta twoNew']);
      expect(surface.state().selection.head.offset).toBe('Beta twoNew'.length);
    });
  });
});

describe('typing over a cell rectangle, in suggesting mode', () => {
  const cell = (content: string) => `<w:tc>${content}</w:tc>`;
  const GRID2 =
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';
  const TABLE_2X2 =
    `<w:tbl>${GRID2}` +
    `<w:tr>${cell(plainParagraph('Aa'))}${cell(plainParagraph('Bb'))}</w:tr>` +
    `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
    '</w:tbl>';

  test('the replacement lands in the FIRST cell, after its struck content', () => {
    withSurface(TABLE_2X2 + plainParagraph('after'), (surface) => {
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      typeEach(surface, 'XY');
      expect(surface.state().lastRejection).toBeNull();
      // Every covered cell keeps its struck text; only the first one hosts the replacement.
      expect(paragraphTexts(surface)).toEqual(['AaXY', 'Bb', 'Cc', 'Dd', 'after']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(
        /<w:delText[^>]*>Aa<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t[^>]*>XY<\/w:t>/
      );
      for (const struck of ['Bb', 'Cc', 'Dd']) {
        expect(xml).toMatch(new RegExp(`<w:delText[^>]*>${struck}</w:delText>`));
      }
      // The caret follows the typing — that is what made the SECOND character land after
      // the first instead of relocating back in front of it.
      expect(surface.state().selection.head).toEqual({
        paragraphId: surface.session.paragraphIds()[0]!,
        offset: 'AaXY'.length,
      });
    });
  });

  test('a first cell holding two paragraphs lands after the LAST one', () => {
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('One') + plainParagraph('Two'))}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['One', 'TwoX', 'Bb', 'Cc', 'Dd', 'after']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(
        /<w:delText[^>]*>Two<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t[^>]*>X<\/w:t>/
      );
    });
  });

  test('a trailing EMPTY paragraph in the first cell does not strand the landing', () => {
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('One') + '<w:p/>')}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      // Adjacent to the struck words — landing in the empty paragraph below separated the
      // replacement from the strike it belongs to.
      expect(paragraphTexts(surface)).toEqual(['OneX', '', 'Bb', 'Cc', 'Dd', 'after']);
    });
  });

  test('a whitespace-only spacer paragraph does not strand the landing either', () => {
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('One') + plainParagraph('   '))}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['OneX', '   ', 'Bb', 'Cc', 'Dd', 'after']);
    });
  });

  test('a pending insertion beside a surviving space does not win the landing', () => {
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('Hello') + plainParagraph(' '))}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      // The trailing paragraph holds a pre-existing space plus this author's own pending
      // 'xyz'. The insertion retracts with the strike, leaving whitespace only — so the
      // worded 'Hello' hosts the landing, not the paragraph that LOOKS worded before the
      // plan runs.
      caretTo(surface, 1, 1);
      typeEach(surface, 'xyz');
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['HelloX', ' ', 'Bb', 'Cc', 'Dd', 'after']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/xyz/);
    });
  });

  test('a pending insertion CONTAINING whitespace still leaves its paragraph worded', () => {
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('A') + plainParagraph(' '))}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      // Pending 'b c' retracts whitespace and words alike; the surviving 'A' still makes
      // the first paragraph the worded landing — length arithmetic could not tell.
      caretTo(surface, 0, 1);
      typeEach(surface, 'b c');
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['AX', ' ', 'Bb', 'Cc', 'Dd', 'after']);
    });
  });

  test('a cell with ONLY whitespace text still hosts the landing beside it', () => {
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('   ') + '<w:p/>')}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      // With no worded paragraph to prefer, whitespace still beats an empty paragraph as
      // a neighbour — the trailing empty one would strand X a line below the strike.
      expect(paragraphTexts(surface)).toEqual(['   X', '', 'Bb', 'Cc', 'Dd', 'after']);
    });
  });

  test('a nested table in the first cell does not steal the landing', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid>' +
      `<w:tr><w:tc>${plainParagraph('Inner')}</w:tc></w:tr></w:tbl>`;
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('One') + nested + '<w:p/>')}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      // The landing is the cell's OWN last paragraph with text, never the nested table's.
      expect(paragraphTexts(surface)).toEqual(['OneX', 'Inner', '', 'Bb', 'Cc', 'Dd', 'after']);
    });
  });

  test('a trailing paragraph holding only your OWN pending insertion retracts, not hosts', () => {
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('One') + '<w:p/>')}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    withSurface(table + plainParagraph('after'), (surface) => {
      caretTo(surface, 1, 0);
      typeEach(surface, 'Mine');
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      // 'Mine' retracts with the strike, so hosting the landing there would strand X in an
      // emptied paragraph a line below the struck 'One'.
      expect(paragraphTexts(surface)).toEqual(['OneX', '', 'Bb', 'Cc', 'Dd', 'after']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/Mine/);
    });
  });

  test('a paste over the rectangle lands in the same place as typing', () => {
    withSurface(TABLE_2X2 + plainParagraph('after'), (surface) => {
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      surface.insertPlainText('Zz');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['AaZz', 'Bb', 'Cc', 'Dd', 'after']);
      expect(surface.state().selection.head).toEqual({
        paragraphId: surface.session.paragraphIds()[0]!,
        offset: 'AaZz'.length,
      });
    });
  });

  test('a drawing-only paragraph is a worded landing: X follows the struck image', () => {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
    const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
    const PNG_1X1 = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      ),
      (c) => c.charCodeAt(0)
    );
    const drawingParagraph =
      '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="228600" cy="114300"/><wp:docPr id="1" name="pic1"/>' +
      `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
      '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:ext cx="228600" cy="114300"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    const table =
      `<w:tbl>${GRID2}` +
      `<w:tr>${cell(plainParagraph('One') + drawingParagraph)}${cell(plainParagraph('Bb'))}</w:tr>` +
      `<w:tr>${cell(plainParagraph('Cc'))}${cell(plainParagraph('Dd'))}</w:tr>` +
      '</w:tbl>';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Default Extension="png" ContentType="image/png"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" Type="${IMG}" Target="media/image1.png"/></Relationships>`
      ),
      'word/media/image1.png': PNG_1X1,
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
          `<w:body>${table + plainParagraph('after')}</w:body></w:document>`
      ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, bytes, { author: 'Ada Lovelace' });
    if (!opened.ok) throw new Error(opened.reason);
    try {
      opened.surface.setEditingMode('suggest');
      selectCellRectangle(opened.surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      opened.surface.type('X');
      expect(opened.surface.state().lastRejection).toBeNull();
      // The image occupies one model character, so its paragraph is the last WORDED one:
      // X belongs after the struck image, never stranded in the paragraph above it.
      expect(paragraphTexts(opened.surface)).toEqual(['One', 'X', 'Bb', 'Cc', 'Dd', 'after']);
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });

  test('this author’s own pending insertion in the first cell retracts', () => {
    withSurface(TABLE_2X2 + plainParagraph('after'), (surface) => {
      caretTo(surface, 0, 1);
      typeEach(surface, 'ZZ');
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      typeEach(surface, 'QR');
      expect(surface.state().lastRejection).toBeNull();
      // The struck halves stay, the author's own insertion leaves, and the replacement
      // sits after what remains of the first cell's struck content — in typing order.
      expect(paragraphTexts(surface)).toEqual(['AaQR', 'Bb', 'Cc', 'Dd', 'after']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/ZZ/);
    });
  });
});

describe('a section break that retypes the following section cannot be suggested', () => {
  // `w:type` lands on the section that STARTS at the mark, which hangs on a paragraph the
  // break does not touch. Word records that as `w:sectPrChange`; this engine refuses
  // `sectPrChange` in accept and reject, so writing it here would leave a layout change no
  // reviewer could undo — the split would come back out and the retype would stay.
  const WITH_ODD_PAGE =
    '<w:p><w:r><w:t xml:space="preserve">Alpha one</w:t></w:r></w:p>' +
    '<w:sectPr><w:type w:val="oddPage"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  test('a continuous break is refused, and writes nothing', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 5, 5);
      const before = serializeOoxmlPart(surface.session.part());
      expect(surface.insertSectionBreak('continuous')).toBe(false);
      expect(serializeOoxmlPart(surface.session.part())).toBe(before);
    });
  });

  test('a next-page break that would REMOVE an authored type is refused too', () => {
    withSurface(WITH_ODD_PAGE, (surface) => {
      selectIn(surface, 0, 5, 5);
      expect(surface.insertSectionBreak('nextPage')).toBe(false);
      expect(serializeOoxmlPart(surface.session.part())).toContain('<w:type w:val="oddPage"/>');
    });
  });

  test('the ordinary next-page break still works: it retypes nothing', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 5, 5);
      expect(surface.insertSectionBreak()).toBe(true);
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha', ' one']);
    });
  });
});

describe("typing inside another author's insertion, in suggesting mode", () => {
  test('splits their insertion, and the keystrokes after the first extend one insertion', () => {
    const theirs =
      '<w:p><w:ins w:id="1" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:t>abcd</w:t></w:r></w:ins></w:p>';
    withSurface(theirs, (surface) => {
      caretTo(surface, 0, 2);
      typeEach(surface, 'XY');
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // Nested, the typed words would go with their proposal on reject.
      expect(xml).toMatch(
        /<w:ins [^>]*w:author="Alan Turing"[^>]*><w:r><w:t>ab<\/w:t><\/w:r><\/w:ins><w:ins [^>]*w:author="Ada Lovelace"[^>]*><w:r><w:t>XY<\/w:t><\/w:r><\/w:ins><w:ins [^>]*w:author="Alan Turing"[^>]*><w:r><w:t>cd<\/w:t><\/w:r><\/w:ins>/
      );
      expect(paragraphTexts(surface)).toEqual(['abXYcd']);
    });
  });
});

test("typing inside a link within another author's insertion is refused, not nested", () => {
  const linked =
    '<w:p><w:ins w:id="1" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
    '<w:hyperlink w:anchor="target"><w:r><w:t>abcd</w:t></w:r></w:hyperlink></w:ins></w:p>';
  withSurface(linked, (surface) => {
    const before = serializeOoxmlPart(surface.session.part());
    caretTo(surface, 0, 2);
    surface.type('X');
    // The link cannot split, and nested words would go with their proposal on reject.
    expect(surface.state().lastRejection).not.toBeNull();
    // The page names the same rule the editing API reports for this edit.
    expect(diagnosticCodeOfRefusal(surface.state().lastRejection!)).toBe(
      'edit.tracked-foreign-revision-unsupported'
    );
    expect(serializeOoxmlPart(surface.session.part())).toBe(before);
  });
});
