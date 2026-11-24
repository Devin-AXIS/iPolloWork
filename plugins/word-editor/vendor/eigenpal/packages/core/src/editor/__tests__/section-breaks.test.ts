// Section breaks through the Editor facade: Word's Layout > Breaks, end to end.
//
// What these pin down: `insertBreak` splits the `w:sectPr` chain at the caret, `w:type`
// lands on the section that STARTS at the mark rather than on the minted clone, and each
// break kind paginates the way Word does — a next-page break starts a sheet, a continuous
// one does not. Against the REAL surface: painted pages, committed ops, one undo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { stubReviewModule } from './review-test-module.ts';
import { selectCellRectangle } from './paginated-surface-fixtures.ts';
import { MAX_GATED_BREAK_SPAN } from '../surface-section-breaks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(body: string, mode: 'edit' | 'suggesting' = 'edit'): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    mode,
    author: 'Ada Lovelace',
    // Required, not decoration: `resolveOpeningEditingMode` refuses `'suggesting'` when no
    // review module is registered and opens the editor in editing mode instead. Without it
    // every assertion below would pass while the editor was never suggesting at all.
    ...(mode === 'suggesting' ? { modules: [stubReviewModule()] } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  if (mode === 'suggesting' && editor.getEditingMode() !== 'suggesting') {
    throw new Error(`expected suggesting, got ${editor.getEditingMode()}`);
  }
  return editor;
}

/** Every `w:sectPr/w:type` value in the live part, in document order. */
function sectionTypes(editor: DocxEditorInstance): string[] {
  const found: string[] = [];
  const walk = (node: {
    kind: string;
    localName?: string;
    attributes?: readonly { localName: string; value: string }[];
    children?: readonly unknown[];
  }): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'type') {
      found.push(node.attributes?.find((a) => a.localName === 'val')?.value ?? '');
    }
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(editor.surface!.session.part().root as never);
  return found;
}

/** Caret between "before" and " after". */
function caretMidParagraph(editor: DocxEditorInstance): void {
  const id = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: 6 },
    head: { paragraphId: id, offset: 6 },
  });
}

describe('insertBreak section kinds', () => {
  test('section splits at the caret and starts a new section', () => {
    const editor = mount(p('before after'));
    caretMidParagraph(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    // The document now has two sections; one undo removes the break entirely.
    expect(editor.surface!.layout().pages.length).toBeGreaterThanOrEqual(2);
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
  });

  test('sectionContinuous splits the section without splitting the page', () => {
    const editor = mount(p('before after'));
    caretMidParagraph(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    // The section boundary is real, but both halves stay on the sheet they started on —
    // that is the whole difference from the next-page break above.
    expect(editor.surface!.layout().pages).toHaveLength(1);
    expect(sectionTypes(editor)).toEqual(['continuous']);
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
    expect(sectionTypes(editor)).toEqual([]);
  });

  test('a next-page break inside a continuous section really starts a page', () => {
    // The minted mark CLONES the governing section, `w:type` and all. Left alone, a
    // next-page break cut from a continuous section came out continuous and both halves
    // stayed on one sheet — the gesture committing and changing nothing on screen.
    const editor = mount(
      p('before after') +
        '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    caretMidParagraph(editor);
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    // The clone keeps `continuous` (it says where the FIRST half starts, which has not
    // moved); the section starting at the break is retyped to nextPage by removal.
    expect(sectionTypes(editor)).toEqual(['continuous']);
    expect(editor.surface!.layout().pages).toHaveLength(2);
  });

  test('the caret section drives the layout: a landscape section paginates landscape', () => {
    const editor = mount(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>landscape page</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>portrait page</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const pages = editor.surface!.layout().pages;
    expect(pages).toHaveLength(2);
    // Twips to points: 15840/20 = 792 wide landscape sheet, then the portrait one.
    expect([pages[0]!.box.width, pages[0]!.box.height]).toEqual([792, 612]);
    expect([pages[1]!.box.width, pages[1]!.box.height]).toEqual([612, 792]);
  });
});

describe('suggesting mode publishes the one break it cannot propose', () => {
  // The reason has to reach `can`, not just `exec`: a gate the toolbar cannot see is a
  // button that lies. The row greys out and carries the engine's own words.
  const SUGGESTED_REASON =
    'a section break that changes where the next section starts cannot be suggested; ' +
    'turn off suggesting to insert it';

  function caretIn(editor: DocxEditorInstance): void {
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 6 },
      head: { paragraphId: id, offset: 6 },
    });
  }

  test('a continuous break reports the refusal through can, and changes nothing', () => {
    const editor = mount(p('before after'), 'suggesting');
    caretIn(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: false,
      code: 'unsupported',
      reason: SUGGESTED_REASON,
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toMatchObject({
      ok: false,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
    expect(sectionTypes(editor)).toEqual([]);
  });

  test('a next-page break that would REMOVE an authored type is refused with it', () => {
    const editor = mount(
      p('before after') +
        '<w:sectPr><w:type w:val="oddPage"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
      'suggesting'
    );
    caretIn(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toMatchObject({
      ok: false,
      reason: SUGGESTED_REASON,
    });
    expect(sectionTypes(editor)).toEqual(['oddPage']);
  });

  test('the ordinary next-page break is untouched: it retypes nothing', () => {
    const editor = mount(p('before after'), 'suggesting');
    caretIn(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
  });
});

describe('the gate and the write read ONE authority', () => {
  const SUGGESTED_REASON =
    'a section break that changes where the next section starts cannot be suggested; ' +
    'turn off suggesting to insert it';

  test('the LIVE mode decides, not the one the editor was constructed with', () => {
    // The most common way into suggesting is a file that declares `w:trackRevisions` —
    // nobody passes a mode at all. Reading the constructed one left the gate silent there:
    // the row stayed enabled and the press did nothing.
    const editor = mount(p('before after'), 'edit');
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 6 },
      head: { paragraphId: id, offset: 6 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
    });

    editor.surface!.setEditingMode('suggest');
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: false,
      code: 'unsupported',
      reason: SUGGESTED_REASON,
    });
    expect(editor.surface!.insertSectionBreak('continuous')).toBe(false);

    // And back: a mode that moved must not leave a permanently dead control behind.
    editor.surface!.setEditingMode('edit');
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
    });
    expect(editor.surface!.insertSectionBreak('continuous')).toBe(true);
  });

  test('a REVERSED selection over a section boundary gets one answer, not two', () => {
    // `can` used to read `selection.head` while the write landed past the struck words. Drag
    // backwards across a boundary and the two resolved different governing sections, so the
    // control said yes and the write silently refused — or the reverse.
    const editor = mount(
      p('one') +
        '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>two</w:t></w:r></w:p>' +
        p('three') +
        '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
      'suggesting'
    );
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[2]!, offset: 2 },
      head: { paragraphId: ids[0]!, offset: 2 },
    });
    const can = editor.can({ type: 'insertBreak', kind: 'section' } as never);
    const committed = editor.surface!.insertSectionBreak('nextPage');
    expect(committed).toBe(can.ok);
  });
});

describe('the break gate stays cheap enough to run on every toolbar derivation', () => {
  // `can` runs once per section-break row on every snapshot change while the Insert menu is
  // open. Asking for the landing eagerly costs a range-deletion plan that scales with the
  // SELECTION, so a select-all in a long document stopped the main thread for seconds — on
  // the next-page row, which had no gate at all before this feature, as well as the new one.
  const LONG = Array.from({ length: 400 }, (_, i) => p(`paragraph ${i}`)).join('');

  test('editing mode answers without planning a deletion, whatever is selected', () => {
    const editor = mount(LONG);
    editor.surface!.selectAll();
    let changes = 0;
    // The observable proof that no plan ran: planning a deletion FLUSHES the pending type
    // buffer, so a `can` that plans one commits the queued keystrokes. It must not.
    editor.surface!.enqueueType('ZZZ');
    const before = editor.surface!.session.bodyText();
    editor.on('change', () => {
      changes += 1;
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
    });
    expect(editor.surface!.session.bodyText()).toBe(before);
    expect(changes).toBe(0);
  });

  test('a suggesting range inside ONE section is answered without a plan either', () => {
    const editor = mount(LONG, 'suggesting');
    editor.surface!.selectAll();
    // Both ends resolve to the same governing section, so the landing cannot be anywhere
    // else and the exact answer needs no deletion plan.
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toMatchObject({
      ok: false,
    });
  });

  test('the shortcut agrees with the plan on a range that STRADDLES a boundary', () => {
    // The one case that still plans. Whatever it answers, the write must agree.
    const editor = mount(
      p('one') +
        '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>two</w:t></w:r></w:p>' +
        p('three') +
        '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
      'suggesting'
    );
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 1 },
      head: { paragraphId: ids[2]!, offset: 1 },
    });
    const can = editor.can({ type: 'insertBreak', kind: 'section' } as never);
    expect(editor.surface!.insertSectionBreak('nextPage')).toBe(can.ok);
  });
});

describe('the gate agrees with the write on every selection shape', () => {
  // The short-circuits exist for speed, so they have to answer what the plan would answer.
  // A previous version compared the resolved TYPE at the two ends, and two different
  // sections share a type routinely — so an intermediate landing could carry a third and
  // the row said yes while the write refused, or the reverse. `replacementTarget` walks the
  // landing BACK from the range end through the author's OWN pending paragraph marks, which
  // is exactly the shape Word writes when a break is inserted with track changes on.
  const AUTHOR = 'Ada Lovelace';
  const insMark = `<w:pPr><w:rPr><w:ins w:id="90" w:author="${AUTHOR}" w:date="2024-01-01T00:00:00Z"/></w:rPr>`;
  const sect = (type: string | null) =>
    `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;

  /** One body paragraph: text, an optional pending mark, an optional section mark. */
  const para = (text: string, ins: boolean, type: string | null | undefined) => {
    const properties =
      ins || type !== undefined
        ? (ins ? insMark : '<w:pPr>') + (type !== undefined ? sect(type) : '') + '</w:pPr>'
        : '';
    return `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  };

  const SHAPES: readonly (readonly [string, string])[] = [
    [
      'pending mark hides a continuous section between two nextPage ends',
      para('one', false, undefined) +
        para('two', false, 'nextPage') +
        para('three', true, 'continuous') +
        para('four', false, undefined) +
        sect('nextPage'),
    ],
    [
      'pending mark hides a nextPage section between two continuous ends',
      para('one', false, undefined) +
        para('two', false, 'continuous') +
        para('three', true, null) +
        para('four', false, undefined) +
        sect('continuous'),
    ],
    [
      'every section agrees, so no plan is needed at all',
      para('one', false, undefined) +
        para('two', true, 'continuous') +
        para('three', false, undefined) +
        sect('continuous'),
    ],
  ];

  for (const [label, body] of SHAPES) {
    for (const kind of ['section', 'sectionContinuous'] as const) {
      for (const reversed of [false, true]) {
        test(`${label} — ${kind}${reversed ? ', reversed' : ''}`, () => {
          const editor = mount(body, 'suggesting');
          const ids = editor.surface!.session.paragraphIds();
          const first = { paragraphId: ids[0]!, offset: 1 };
          const last = { paragraphId: ids[ids.length - 1]!, offset: 1 };
          editor.surface!.setSelection(
            reversed ? { anchor: last, head: first } : { anchor: first, head: last }
          );
          const can = editor.can({ type: 'insertBreak', kind } as never);
          const committed = editor.surface!.insertSectionBreak(
            kind === 'section' ? 'nextPage' : 'continuous'
          );
          expect(committed).toBe(can.ok);
        });
      }
    }
  }
});

describe('a caret in a table cell says so instead of failing on press', () => {
  // The store refuses a section mark in a cell, and used to report its own rejection enum —
  // `invalid-property-value`, which names no cause and no locale can translate.
  const CELL = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
  const TABLE =
    '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    `<w:tr>${CELL('CellA')}${CELL('CellB')}</w:tr></w:tbl>`;

  test('both break kinds report the cell, through can and through exec', () => {
    const editor = mount(p('before') + TABLE + p('after'));
    const inCell = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: inCell, offset: 2 },
      head: { paragraphId: inCell, offset: 2 },
    });
    for (const kind of ['section', 'sectionContinuous'] as const) {
      expect(editor.can({ type: 'insertBreak', kind } as never)).toEqual({
        ok: false,
        code: 'unsupported',
        reason: 'a section break cannot be inserted inside a table cell',
      });
      expect(editor.exec({ type: 'insertBreak', kind } as never)).toMatchObject({
        ok: false,
        reason: 'a section break cannot be inserted inside a table cell',
      });
    }
    expect(editor.surface!.session.paragraphIds()).toHaveLength(4);
  });

  test('a caret OUTSIDE the table is unaffected', () => {
    const editor = mount(p('before') + TABLE + p('after'));
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 3 },
      head: { paragraphId: id, offset: 3 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
  });
});

describe('the gate bounds how far it will plan', () => {
  // Planning a deletion is superlinear in the range, and the gate runs on every toolbar
  // derivation, so past a few hundred paragraphs it stops asking and lets the press report
  // the refusal instead. `exec` is exact either way — it has already paid for a write.
  const LONG_MIXED =
    Array.from({ length: 600 }, (_, i) => p(`a ${i}`)).join('') +
    '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/>' +
    '</w:sectPr></w:pPr><w:r><w:t>mid</w:t></w:r></w:p>' +
    Array.from({ length: 600 }, (_, i) => p(`b ${i}`)).join('') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  test('a span past the bound stays enabled, and exec still refuses exactly', () => {
    const editor = mount(LONG_MIXED, 'suggesting');
    editor.surface!.selectAll();
    // Sections disagree and the span reaches both, so the cheap answers do not settle it.
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toMatchObject({
      ok: false,
      reason:
        'a section break that changes where the next section starts cannot be suggested; ' +
        'turn off suggesting to insert it',
    });
  });

  test('the same document answers exactly for a caret', () => {
    const editor = mount(LONG_MIXED, 'suggesting');
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 1 },
      head: { paragraphId: id, offset: 1 },
    });
    // The caret's section is the mid-body continuous one, so a continuous break retypes
    // nothing and a next-page break retypes it.
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toMatchObject({
      ok: false,
    });
  });
});

describe('a cell rectangle is the table gesture, so it refuses like one', () => {
  // A rectangle installs a NON-collapsed text selection over the cell text, so the caret
  // check never saw it and both rows stayed enabled and always failing — not the narrow
  // "range that starts in a table" gap, but the one selection shape that is always a table.
  const tc = (c: string) => `<w:tc>${c}</w:tc>`;
  const tr = (c: string) => `<w:tr>${c}</w:tr>`;
  const TABLE_2X2 =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>`;

  test('every rectangle reports the cell through can, and never lies', () => {
    for (const corner of [
      [
        { row: 0, column: 0 },
        { row: 0, column: 0 },
      ],
      [
        { row: 0, column: 0 },
        { row: 1, column: 0 },
      ],
      [
        { row: 0, column: 0 },
        { row: 1, column: 1 },
      ],
    ] as const) {
      const editor = mount(p('before') + TABLE_2X2 + p('after'));
      selectCellRectangle(editor.surface!, corner[0], corner[1]);
      for (const kind of ['section', 'sectionContinuous'] as const) {
        expect(editor.can({ type: 'insertBreak', kind } as never)).toEqual({
          ok: false,
          code: 'unsupported',
          reason: 'a section break cannot be inserted inside a table cell',
        });
      }
    }
  });

  test('a refused press invalidates the snapshot, it does not wait for the next tick', () => {
    const editor = mount(p('before') + TABLE_2X2 + p('after'));
    selectCellRectangle(editor.surface!, { row: 0, column: 0 }, { row: 1, column: 1 });
    // WARM the snapshot cache first. `snapshot()` is version-cached, so reading it on a cold
    // cache derives fresh whatever the refusal did — which is how this passed with the
    // publishing removed. Only a warm cache can tell "invalidated" from "never cached".
    expect(editor.snapshot().lastRejection).toBeNull();
    expect(editor.surface!.insertSectionBreak('nextPage')).toBe(false);
    expect(editor.snapshot().lastRejection).toBe(
      'a section break cannot be inserted inside a table cell'
    );
  });
});

describe('a section a locked control holds is reported, not discovered on press', () => {
  // The retype lands on a paragraph the caret is nowhere near, so the store's guard can
  // refuse a break the caret's own paragraph would have allowed. Left ungated, the row was
  // live and the press failed with the store's `locked` — a word that names no cause, and
  // read as a sentence would claim the SELECTION is locked, which it is not.
  const sdt = (properties: string, inner: string) =>
    `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
  const held = (properties: string) =>
    p('Alpha') +
    sdt(
      properties,
      '<w:p><w:pPr><w:sectPr><w:type w:val="oddPage"/><w:pgSz w:w="12240" w:h="15840"/>' +
        '</w:sectPr></w:pPr><w:r><w:t>Inside</w:t></w:r></w:p>'
    ) +
    p('Beta') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  const REASON =
    'a section break cannot change a section that a locked or linked content control holds';

  test.each([
    ['locked', '<w:lock w:val="contentLocked"/>'],
    ['data-bound', '<w:dataBinding w:xpath="/root/a" w:storeItemID="{1}"/>'],
  ])('%s: can reports it and the document is untouched', (_label, properties) => {
    const editor = mount(held(properties));
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 3 },
      head: { paragraphId: id, offset: 3 },
    });
    for (const kind of ['section', 'sectionContinuous'] as const) {
      expect(editor.can({ type: 'insertBreak', kind } as never)).toEqual({
        ok: false,
        code: 'unsupported',
        reason: REASON,
      });
      expect(editor.exec({ type: 'insertBreak', kind } as never)).toMatchObject({
        ok: false,
        reason: REASON,
      });
    }
    expect(editor.surface!.session.paragraphIds()).toHaveLength(3);
  });

  test('a break that retypes NOTHING is still allowed through the same control', () => {
    // Precise, not blanket. The guard exists for the write the store refuses; a break with
    // no type to write never reaches the control at all.
    const editor = mount(
      p('Alpha') +
        sdt(
          '<w:lock w:val="contentLocked"/>',
          '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
            '<w:r><w:t>Inside</w:t></w:r></w:p>'
        ) +
        p('Beta') +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 3 },
      head: { paragraphId: id, offset: 3 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: true,
      changed: true,
    });
  });
});

describe('the gate mirrors BOTH of the store lock guards', () => {
  // `setSectionMark` guards two paragraphs: the one it marks, and the one the section it
  // retypes hangs on. Mirroring only the second left a caret INSIDE a locked control with two
  // live rows and a press that failed with the store's `locked`.
  const sdt = (properties: string, inner: string) =>
    `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
  const LOCK = '<w:lock w:val="contentLocked"/>';
  const BIND = '<w:dataBinding w:xpath="/root/a" w:storeItemID="{1}"/>';
  const MARK_HELD = (properties: string) =>
    p('Alpha') +
    sdt(properties, p('Inside')) +
    p('Beta') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  const CONTENT_REASON = 'a section break cannot be inserted in locked or linked content';
  const SECTION_REASON =
    'a section break cannot change a section that a locked or linked content control holds';

  test.each([
    ['locked', LOCK],
    ['data-bound', BIND],
  ])('%s content refuses the mark itself, through can and exec', (_label, properties) => {
    const editor = mount(MARK_HELD(properties));
    const inside = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: inside, offset: 3 },
      head: { paragraphId: inside, offset: 3 },
    });
    for (const kind of ['section', 'sectionContinuous'] as const) {
      expect(editor.can({ type: 'insertBreak', kind } as never)).toEqual({
        ok: false,
        code: 'unsupported',
        reason: CONTENT_REASON,
      });
      expect(editor.exec({ type: 'insertBreak', kind } as never)).toMatchObject({
        ok: false,
        reason: CONTENT_REASON,
      });
    }
    expect(editor.surface!.session.paragraphIds()).toHaveLength(3);
  });

  test('a RANGE reaches the lock questions too, not only a caret', () => {
    // Edit mode used to return before the lock check for anything non-collapsed, so the same
    // document answered one way for a caret and another for a two-character drag.
    const editor = mount(
      p('Alpha') +
        sdt(
          LOCK,
          '<w:p><w:pPr><w:sectPr><w:type w:val="oddPage"/><w:pgSz w:w="12240" w:h="15840"/>' +
            '</w:sectPr></w:pPr><w:r><w:t>Inside</w:t></w:r></w:p>'
        ) +
        p('Beta') +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const first = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 3 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: false,
      code: 'unsupported',
      reason: SECTION_REASON,
    });
    expect(editor.surface!.insertSectionBreak('nextPage')).toBe(false);
  });

  test('a locked control the break never touches costs a range nothing and refuses nothing', () => {
    const editor = mount(p('Alpha') + sdt(LOCK, p('Inside')) + p('Beta'));
    const first = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 3 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
  });
});

describe('a caret answers without writing anything', () => {
  test('neither mode flushes the pending type buffer for a caret', () => {
    // `orderedRange()` flushes, which commits queued keystrokes — a write from a read, and
    // `useEditorCommand` runs this inside a React render. A caret needs no ordering at all.
    for (const mode of ['edit', 'suggesting'] as const) {
      const editor = mount(p('before after'), mode);
      const id = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId: id, offset: 6 },
        head: { paragraphId: id, offset: 6 },
      });
      editor.surface!.enqueueType('ZZZ');
      const before = editor.surface!.session.bodyText();
      editor.can({ type: 'insertBreak', kind: 'section' } as never);
      editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never);
      expect(editor.surface!.session.bodyText()).toBe(before);
    }
  });
});

describe('the lock pre-check reads WML locks, not every element named lock', () => {
  // It matched on the local name alone, so VML's `o:lock` — which Word writes inside
  // `v:shapetype` for every legacy picture — turned it true. One stray shape then cost the
  // gate its cheap exact answers: past the span bound it answered "allowed" for a break it
  // already knew would refuse, and ordering the selection flushed pending input on the way.
  // Long enough to be past the span bound, and UNIFORM, so the cheap short-circuits settle
  // it: every section starts nextPage, a continuous break retypes, suggesting refuses.
  const LONG = (extra: string) =>
    Array.from({ length: 200 }, (_, i) => p(`a ${i}`)).join('') +
    extra +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
  const VML_SHAPE =
    '<w:p><w:r><w:pict><v:shapetype xmlns:v="urn:schemas-microsoft-com:vml" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" id="_x0000_t75">' +
    '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype></w:pict></w:r></w:p>';
  const SDT_LOCKED_SHELL =
    '<w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr>' +
    `<w:sdtContent>${p('shell')}</w:sdtContent></w:sdt>`;

  test.each([
    ['a VML o:lock', VML_SHAPE],
    ['an sdtLocked shell, which leaves content editable', SDT_LOCKED_SHELL],
    ['nothing', ''],
  ])('%s does not cost the exact answer', (_label, extra) => {
    const editor = mount(LONG(extra), 'suggesting');
    editor.surface!.selectAll();
    // Past the span bound, so only the cheap short-circuits can answer — and they must run.
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toMatchObject({
      ok: false,
    });
    expect(editor.surface!.insertSectionBreak('continuous')).toBe(false);
  });

  test('and it still answers for a control that really does hold content', () => {
    const editor = mount(
      p('Alpha') +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        p('Inside') +
        '</w:sdtContent></w:sdt>' +
        p('Beta') +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const inside = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: inside, offset: 0 },
      head: { paragraphId: inside, offset: 3 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toMatchObject({
      ok: false,
      reason: 'a section break cannot be inserted in locked or linked content',
    });
  });
});

describe('locks are reported before suggesting', () => {
  // "Turn off suggesting to insert it" is only worth saying when doing so would let the break
  // through. With a locked section owner it would not, so the lock is the honest answer.
  test('a locked owner in suggesting mode names the lock, not the mode', () => {
    const body =
      p('Alpha') +
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:pPr><w:sectPr><w:type w:val="oddPage"/><w:pgSz w:w="12240" w:h="15840"/>' +
      '</w:sectPr></w:pPr><w:r><w:t>Inside</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>' +
      p('Beta') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
    const editor = mount(body, 'suggesting');
    const first = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: first, offset: 3 },
      head: { paragraphId: first, offset: 3 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toMatchObject({
      ok: false,
      reason:
        'a section break cannot change a section that a locked or linked content control holds',
    });
  });
});

describe('a deletion that crosses held content reports the lane, not the store enum', () => {
  test('a range spanning a locked control refuses in words a locale can carry', () => {
    // The landing alone never sees this: it is the DELETION the break replaces the selection
    // with that crosses the control. Only the store knows, and its answer is `locked`.
    const editor = mount(
      p('Alpha') +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        p('Inside') +
        '</w:sdtContent></w:sdt>' +
        p('Omega') +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 1 },
      head: { paragraphId: ids[2]!, offset: 1 },
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toMatchObject({
      ok: false,
      reason: 'a section break cannot be inserted in locked or linked content',
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(3);
  });
});

describe('a plain range inside a table cell is reported, not discovered on press', () => {
  // The rectangle and the caret were covered; a plain drag inside one cell was not, in either
  // mode, and not even on the plan path — the gate worked out the landing and then never
  // asked it the one question the write asks.
  const CELL_DOC =
    p('Alpha') +
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
    `<w:tr><w:tc>${p('Cell text here')}</w:tc></w:tr></w:tbl>` +
    p('Omega') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
  const REASON = 'a section break cannot be inserted inside a table cell';

  test.each([
    ['edit', 'section'],
    ['edit', 'sectionContinuous'],
    ['suggesting', 'section'],
    ['suggesting', 'sectionContinuous'],
  ] as const)('%s / %s', (mode, kind) => {
    const editor = mount(CELL_DOC, mode);
    const cell = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: cell, offset: 1 },
      head: { paragraphId: cell, offset: 5 },
    });
    expect(editor.can({ type: 'insertBreak', kind } as never)).toMatchObject({
      ok: false,
      reason: REASON,
    });
    expect(editor.surface!.insertSectionBreak(kind === 'section' ? 'nextPage' : 'continuous')).toBe(
      false
    );
  });

  test('and the same document still allows a break outside the table', () => {
    const editor = mount(CELL_DOC);
    const first = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 3 },
    });
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
  });
});

describe('the cheap answers survive a document that declares a real lock', () => {
  // The two section short-circuits were gated behind "no lock declared", which threw them away
  // for any document holding a content control: past the span bound the gate then answered
  // "allowed" for a break it already knew would refuse.
  const LOCKED_SOMEWHERE =
    Array.from({ length: 200 }, (_, i) => p(`a ${i}`)).join('') +
    '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
    p('held') +
    '</w:sdtContent></w:sdt>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  test('a select-all past the bound still refuses a continuous break', () => {
    const editor = mount(LOCKED_SOMEWHERE, 'suggesting');
    editor.surface!.selectAll();
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toMatchObject({
      ok: false,
    });
    expect(editor.surface!.insertSectionBreak('continuous')).toBe(false);
  });
});

describe('the span bound is what decides when the gate stops planning', () => {
  // Nothing pinned the bound, so it could be raised back to a number that costs tens of
  // milliseconds per row per toolbar derivation without a test noticing.
  const MIXED = (count: number) =>
    Array.from({ length: count }, (_, i) => p(`a ${i}`)).join('') +
    '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/>' +
    '</w:sectPr></w:pPr><w:r><w:t>mid</w:t></w:r></w:p>' +
    Array.from({ length: count }, (_, i) => p(`b ${i}`)).join('') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  test('MAX_GATED_BREAK_SPAN is the measured value, not a round number', () => {
    // Pinned exactly. `toBeLessThanOrEqual` passed at the value the measurement rejected, so
    // the bound could drift back to tens of milliseconds per row without a test noticing.
    expect(MAX_GATED_BREAK_SPAN).toBe(32);
  });

  test('a span inside the bound is answered exactly; past it the press answers', () => {
    // Sections disagree, so neither short-circuit settles it and only the plan can.
    // Wide enough that both spans address real paragraphs whatever the bound is, so a pass
    // can never come from an out-of-range index.
    const half = MAX_GATED_BREAK_SPAN + 40;
    const editor = mount(MIXED(half), 'suggesting');
    const ids = editor.surface!.session.paragraphIds();
    const spanning = (count: number) => {
      editor.surface!.setSelection({
        anchor: { paragraphId: ids[half - Math.floor(count / 2)]!, offset: 0 },
        head: { paragraphId: ids[half + Math.ceil(count / 2)]!, offset: 1 },
      });
      return editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never);
    };
    expect(spanning(MAX_GATED_BREAK_SPAN - 2).ok).toBe(false);
    expect(spanning(MAX_GATED_BREAK_SPAN + 2)).toEqual({ ok: true });
  });
});
