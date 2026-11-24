// Content-control command dispatch — `setContentControlValue` and `removeContentControl`
// through the Editor facade into store tree ops.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  contentControlPropertiesOf,
  contentControlTextOf,
  findNode,
} from '@docx-editor.dev/core/store';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pMixed = (content: string) => `<w:p>${content}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const sdt = (sdtPr: string, content: string) =>
  `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const inlineSdt = (sdtPr: string, content: string) => sdt(sdtPr, content);

function mount(body: string) {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function caretAt(
  surface: NonNullable<ReturnType<typeof createDocxEditor>['surface']>,
  offset: number,
  paragraphIndex = 0
) {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

describe('setContentControlValue command', () => {
  test('replaces plain-text control content at the caret', () => {
    const body = sdt(`<w:text/>`, p('Enter name'));
    const editor = mount(body);
    caretAt(editor.surface!, 3);

    const result = editor.exec({ type: 'setContentControlValue', value: 'Ada Lovelace' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Ada Lovelace');
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
  });

  test('targets an inline control through caret resolution', () => {
    const body = pMixed(
      run('ab') + inlineSdt(`<w:alias w:val="Mid"/><w:text/>`, run('OLD')) + run('cd')
    );
    const editor = mount(body);
    caretAt(editor.surface!, 4);

    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ alias: 'Mid' });

    const result = editor.exec({ type: 'setContentControlValue', value: 'NEW' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('abNEWcd');
  });

  test('refuses a locked control with code locked, and can() agrees', () => {
    const body = sdt(`<w:lock w:val="contentLocked"/><w:text/>`, p('locked'));
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    const command = { type: 'setContentControlValue' as const, value: 'nope' };
    const can = editor.can(command);
    const result = editor.exec(command);
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(result).toEqual(can);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('locked');
  });

  test('refuses a bound control with code bound, and can() agrees', () => {
    const body = pMixed(
      sdt(`<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/><w:text/>`, run('bound'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    const command = { type: 'setContentControlValue' as const, value: 'free' };
    const can = editor.can(command);
    const result = editor.exec(command);
    expect(can).toEqual({
      ok: false,
      code: 'bound',
      reason: 'the content control is bound to external data',
    });
    expect(result).toEqual(can);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('bound');
  });

  test('can() refuses an unlisted dropdown value the same way exec() does', () => {
    const body = sdt(
      `<w:dropDownList w:lastValue="1">` +
        `<w:listItem w:displayText="Draft" w:value="1"/>` +
        `<w:listItem w:displayText="Final" w:value="2"/></w:dropDownList>`,
      p('Draft')
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    const invalid = { type: 'setContentControlValue' as const, value: '3' };
    const canInvalid = editor.can(invalid);
    expect(canInvalid).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: 'the value is not valid for this control',
    });
    expect(editor.exec(invalid)).toEqual(canInvalid);

    const valid = { type: 'setContentControlValue' as const, value: '2' };
    expect(editor.can(valid)).toEqual({ ok: true });
    expect(editor.exec(valid)).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Final');
  });

  test('can() refuses a non-boolean checkbox value with typeMismatch', () => {
    const body = sdt(`<w14:checkbox><w14:checked w14:val="0"/></w14:checkbox>`, p('☐'));
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    const command = { type: 'setContentControlValue' as const, value: 'maybe' };
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'typeMismatch',
      reason: 'the value does not match the control type',
    });
    expect(editor.exec(command)).toMatchObject(can);
  });

  test('can() refuses setValue under an inherited content lock', () => {
    const body = sdt(
      `<w:lock w:val="contentLocked"/><w:alias w:val="outer"/>`,
      sdt(`<w:alias w:val="inner"/><w:text/>`, p('nested'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({
      alias: 'inner',
      locked: true,
    });

    const command = { type: 'setContentControlValue' as const, value: 'nope' };
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(editor.exec(command)).toEqual(can);
  });

  test('switching to viewing refuses setValue through can() and exec()', () => {
    // The gate read `config.mode`, which is fixed for the life of the editor — so this
    // branch, which sits ABOVE the viewing gate, answered the question the host asked at
    // open time rather than the one the reader is asking now.
    const editor = mount(sdt(`<w:alias w:val="field"/><w:text/>`, p('before')));
    caretAt(editor.surface!, 0);
    const command = { type: 'setContentControlValue' as const, value: 'after' };
    expect(editor.can(command)).toEqual({ ok: true });

    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    const revision = editor.surface!.session.packageRevision();
    const refusal = editor.can(command);
    expect(refusal.ok).toBe(false);
    expect(editor.exec(command)).toEqual(refusal);
    expect(editor.surface!.session.packageRevision()).toBe(revision);

    // Reversible, like every other viewing refusal.
    editor.exec({ type: 'setEditingMode', mode: 'editing' });
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command).ok).toBe(true);
  });
});

describe('removeContentControl command', () => {
  test('unwraps a block control while preserving text', () => {
    const body = sdt(`<w:alias w:val="Title"/>`, p('Hello'));
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
    expect(editor.can({ type: 'removeContentControl' })).toEqual({ ok: true });

    const result = editor.exec({ type: 'removeContentControl' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Hello');
  });

  test('unwraps an inline control targeted at the caret', () => {
    const body = pMixed(run('x') + inlineSdt(`<w:alias w:val="Inner"/>`, run('y')) + run('z'));
    const editor = mount(body);
    caretAt(editor.surface!, 1);

    const result = editor.exec({ type: 'removeContentControl' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('xyz');
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();
  });

  test('refuses removal when the wrapper is locked, and can() agrees', () => {
    const body = pMixed(sdt(`<w:lock w:val="sdtContentLocked"/>`, run('keep')));
    const editor = mount(body);
    caretAt(editor.surface!, 2);

    const can = editor.can({ type: 'removeContentControl' });
    const result = editor.exec({ type: 'removeContentControl' });
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(result).toEqual(can);
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
  });

  test('can() refuses removal under an inherited sdtLocked ancestor', () => {
    const body = sdt(
      `<w:lock w:val="sdtLocked"/><w:alias w:val="outer"/>`,
      sdt(`<w:alias w:val="inner"/>`, p('nested'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    // Content edit remains allowed; only wrapper removal is refused by the union.
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({
      alias: 'inner',
    });
    expect(editor.query({ type: 'contentControlAt' })?.locked).toBeUndefined();
    expect(editor.can({ type: 'setContentControlValue', value: 'ok' })).toEqual({ ok: true });

    const can = editor.can({ type: 'removeContentControl' });
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(editor.exec({ type: 'removeContentControl' })).toEqual(can);
  });
});

// ── insertContentControl ─────────────────────────────────────────────────────
//
// The verb that was missing: a mounted editor could set and remove a control but not create
// one, so a host authoring template fields had to save, insert through a headless automation
// host, and load the bytes back — which throws the undo stack away with them.

describe('insertContentControl command', () => {
  function selectRange(
    surface: NonNullable<ReturnType<typeof createDocxEditor>['surface']>,
    from: number,
    to: number,
    paragraphIndex = 0
  ) {
    const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
    surface.setSelection({
      anchor: { paragraphId, offset: from },
      head: { paragraphId, offset: to },
    });
  }

  test('wraps the selection in a new control carrying its tag and title', () => {
    const editor = mount(p('Between ACME CORP and BUYER LTD'));
    selectRange(editor.surface!, 8, 17);

    const result = editor.exec({
      type: 'insertContentControl',
      subtype: 'plainText',
      tag: 'party_name',
      title: 'Party Name',
    });

    expect(result).toEqual({ ok: true, changed: true });
    // Read back through the query, which walks the tree from scratch: a wrapper that only
    // existed in the op would not be here.
    expect(editor.query({ type: 'contentControls' })).toMatchObject([
      { tag: 'party_name', alias: 'Party Name', controlType: 'plainText' },
    ]);
    // Wrapping moves run boundaries. It does not rewrite text.
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Between ACME CORP and BUYER LTD');
  });

  // The reason the command exists. `save()` → headless insert → `load()` reaches the same
  // document and discards the history with it, so an insertion nobody can undo is the bug.
  test('is one undo step, and undo puts the document back', () => {
    const editor = mount(p('Between ACME CORP and BUYER LTD'));
    selectRange(editor.surface!, 8, 17);

    editor.exec({ type: 'insertContentControl', subtype: 'plainText', tag: 'party_name' });
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);

    expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Between ACME CORP and BUYER LTD');
  });

  // Word's own gesture, and the one the reported use case needs: a host inserts a field where
  // the user is looking, with nothing selected.
  test('a caret inserts an empty control showing its prompt', () => {
    const editor = mount(p('Between  and BUYER LTD'));
    caretAt(editor.surface!, 8);

    expect(
      editor.exec({ type: 'insertContentControl', subtype: 'plainText', tag: 'party' })
    ).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'contentControls' })).toMatchObject([{ tag: 'party' }]);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe(
      'Between Click here to enter text. and BUYER LTD'
    );
  });

  test('a caret insertion is one undo step too', () => {
    const editor = mount(p('Between  and BUYER LTD'));
    caretAt(editor.surface!, 8);

    editor.exec({ type: 'insertContentControl', subtype: 'date', tag: 'effective' });
    expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Between  and BUYER LTD');
  });

  // The caret is left where the prompt is, so the next keystroke replaces the whole prompt
  // rather than appending to it.
  test('typing after a caret insertion replaces the prompt', () => {
    const editor = mount(p('Between  and BUYER LTD'));
    caretAt(editor.surface!, 8);
    editor.exec({ type: 'insertContentControl', subtype: 'plainText', tag: 'party' });

    editor.exec({ type: 'insertText', text: 'ACME' });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Between ACME and BUYER LTD');
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
  });

  test('refuses a selection that crosses paragraphs', () => {
    const editor = mount(p('first') + p('second'));
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 1 },
      head: { paragraphId: ids[1]!, offset: 3 },
    });

    const command = { type: 'insertContentControl' as const, subtype: 'richText' as const };
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'wrapping several paragraphs in one content control is not supported',
    });
    expect(editor.exec(command)).toEqual(can);
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
  });

  // `picture` and `repeatingSection` are real `ContentControlType` values a reader returns, so
  // an untyped caller can hand one straight back to this command.
  test('refuses a control type an insertion cannot author, and can() agrees', () => {
    const editor = mount(p('Between ACME CORP'));
    selectRange(editor.surface!, 8, 17);

    const command = { type: 'insertContentControl', subtype: 'picture' } as unknown as Parameters<
      typeof editor.exec
    >[0];
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: 'that control type cannot be inserted (picture)',
    });
    expect(editor.exec(command)).toEqual(can);
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
  });

  // The read vocabulary spells the list control `dropdown` and OOXML spells it `dropDownList`.
  // Reading a control's type and authoring another like it is the commonest reason to call
  // this, so both spellings mean the same kind.
  test('takes either spelling of the dropdown kind', () => {
    for (const subtype of ['dropdown', 'dropDownList'] as const) {
      const editor = mount(p('choose one here'));
      selectRange(editor.surface!, 0, 6);
      expect(editor.exec({ type: 'insertContentControl', subtype, tag: 'pick' })).toEqual({
        ok: true,
        changed: true,
      });
      // What a READ answers is the same for both, which is what makes them one kind.
      expect(editor.query({ type: 'contentControls' })).toMatchObject([
        { tag: 'pick', controlType: 'dropdown' },
      ]);
    }
  });

  test('wraps a phrase named by a paraId anchor, wherever the caret is', () => {
    const editor = mount(p('Between ACME CORP and BUYER LTD'));
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const paraId = surface.session.paragraphAnchors().paraIdByNode.get(paragraphId)!;
    expect(paraId).toBeDefined();
    caretAt(surface, 0);

    const result = editor.exec({
      type: 'insertContentControl',
      target: { paraId, search: 'BUYER LTD' },
      subtype: 'plainText',
      tag: 'buyer',
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'contentControls' })).toMatchObject([{ tag: 'buyer' }]);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('Between ACME CORP and BUYER LTD');
  });

  test('says so when the target addresses a paragraph that is not there', () => {
    const editor = mount(p('Between ACME CORP'));
    const can = editor.can({
      type: 'insertContentControl',
      target: { paraId: '0000DEAD' },
      subtype: 'plainText',
    });
    expect(can).toEqual({
      ok: false,
      code: 'notFound',
      reason: "no paragraph with paraId '0000DEAD'",
    });
  });

  test('refuses inside a content-locked control, and can() agrees', () => {
    const editor = mount(pMixed(sdt(`<w:lock w:val="sdtContentLocked"/>`, run('fixed text'))));
    caretAt(editor.surface!, 3);

    const command = { type: 'insertContentControl' as const, subtype: 'plainText' as const };
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the content control is locked',
    });
    expect(editor.exec(command)).toEqual(can);
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
  });

  test('refuses while the document is open for viewing', () => {
    const editor = mount(p('Between ACME CORP'));
    selectRange(editor.surface!, 8, 17);
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });

    const command = { type: 'insertContentControl' as const, subtype: 'plainText' as const };
    expect(editor.can(command)).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the document is read-only',
    });
    expect(editor.exec(command)).toEqual(editor.can(command));
  });
});

// `can` is what chrome disables a button by, so every refusal `exec` can make has to be one
// `can` already made. These are the shapes where the two used to disagree: the wrappability
// rules lived in the applier, which `can` never reaches.
describe('insertContentControl can() agrees with exec()', () => {
  function selectRange(
    surface: NonNullable<ReturnType<typeof createDocxEditor>['surface']>,
    from: number,
    to: number
  ) {
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: from },
      head: { paragraphId, offset: to },
    });
  }

  const command = { type: 'insertContentControl' as const, subtype: 'plainText' as const };

  test('a selection crossing an existing control edge refuses in both', () => {
    const editor = mount(pMixed(run('ab') + inlineSdt(`<w:text/>`, run('OLD')) + run('cd')));
    selectRange(editor.surface!, 1, 4);

    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'unsupported',
      reason:
        'a content control cannot start or end inside a hyperlink, a field, or another inline control',
    });
    expect(editor.exec(command)).toEqual(can);
    expect(editor.query({ type: 'contentControls' })).toHaveLength(1);
  });

  test('a caret inside a hyperlink refuses in both, rather than landing beside the link', () => {
    const editor = mount(
      pMixed(run('ab') + `<w:hyperlink r:id="rId9">${run('LINK')}</w:hyperlink>` + run('cd'))
    );
    caretAt(editor.surface!, 4);

    const can = editor.can(command);
    expect(can.ok).toBe(false);
    expect(editor.exec(command)).toEqual(can);
    // The document is untouched: no control, and the text as authored.
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('abLINKcd');
  });

  test('a selection that would split a surrogate pair refuses in both', () => {
    const editor = mount(p('a\u{1F600}b'));
    selectRange(editor.surface!, 1, 2);

    const can = editor.can(command);
    expect(can.ok).toBe(false);
    expect(editor.exec(command)).toEqual(can);
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
  });

  test('the gate reads the same document the write does, with typing still queued', () => {
    const editor = mount(p('hello world'));
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const paraId = surface.session.paragraphAnchors().paraIdByNode.get(paragraphId)!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    // A burst the surface has not committed yet. The gate used to resolve against the paragraph
    // as it was, while the write resolved against the paragraph as it became — so `exec` could
    // refuse for a reason its own gate had just approved, and vice versa.
    surface.enqueueType('bye');

    const result = editor.exec({
      type: 'insertContentControl',
      target: { paraId, search: 'bye' },
      subtype: 'plainText',
      tag: 'typed',
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe('bye world');
    expect(editor.query({ type: 'contentControls' })).toMatchObject([{ tag: 'typed' }]);
  });
});

// Targeting: everything a caller can put in `target`, and what each one wraps.
describe('insertContentControl target addressing', () => {
  const SENTENCE = 'Between ACME CORP and BUYER LTD';

  function anchored() {
    const editor = mount(p(SENTENCE));
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const paraId = surface.session.paragraphAnchors().paraIdByNode.get(paragraphId)!;
    return { editor, paraId };
  }

  /** The characters the one control ended up holding, read back off the tree. */
  function wrappedText(editor: ReturnType<typeof mount>): string {
    const control = editor.query({ type: 'contentControls' })[0];
    if (!control) throw new Error('no control was inserted');
    const part = editor.surface!.session.part();
    const node = findNode(part, control.id);
    if (!node) throw new Error('the control is not in the tree');
    return contentControlTextOf(node);
  }

  test('a range covers both endpoints, whichever order they are named in', () => {
    for (const [from, to] of [
      ['ACME', 'BUYER'],
      ['BUYER', 'ACME'],
    ] as const) {
      const { editor, paraId } = anchored();
      const result = editor.exec({
        type: 'insertContentControl',
        target: { from: { paraId, search: from }, to: { paraId, search: to } },
        subtype: 'plainText',
        tag: 'span',
      });
      expect(result).toEqual({ ok: true, changed: true });
      // Both phrases are inside it. Pairing one endpoint's start with the other's end would
      // wrap the gap between them and neither of the phrases the caller named.
      expect(wrappedText(editor)).toBe('ACME CORP and BUYER');
      expect(editor.query({ type: 'paragraphs' })[0]?.text).toBe(SENTENCE);
    }
  });

  test('a range whose endpoints are in different paragraphs is refused', () => {
    const editor = mount(p('first here') + p('second here'));
    const surface = editor.surface!;
    const anchors = surface.session.paragraphAnchors();
    const [one, two] = surface.session.paragraphIds();
    const command = {
      type: 'insertContentControl' as const,
      target: {
        from: { paraId: anchors.paraIdByNode.get(one!)!, search: 'first' },
        to: { paraId: anchors.paraIdByNode.get(two!)!, search: 'second' },
      },
      subtype: 'plainText' as const,
    };
    const can = editor.can(command);
    expect(can).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'wrapping several paragraphs in one content control is not supported',
    });
    expect(editor.exec(command).ok).toBe(false);
  });

  test('a DocLocation endpoint is refused, and says what to use instead', () => {
    const { editor, paraId } = anchored();
    for (const target of [
      { container: { part: 'body' as const }, path: [0] },
      { from: { container: { part: 'body' as const }, path: [0] }, to: { paraId } },
    ]) {
      const can = editor.can({ type: 'insertContentControl', target, subtype: 'plainText' });
      expect(can.ok).toBe(false);
      expect(can.ok === false && can.reason).toContain('paraId');
    }
    expect(editor.query({ type: 'contentControls' })).toHaveLength(0);
  });

  test('an anchor with no search phrase wraps the whole paragraph', () => {
    const { editor, paraId } = anchored();
    expect(
      editor.exec({ type: 'insertContentControl', target: { paraId }, subtype: 'richText' })
    ).toEqual({ ok: true, changed: true });
    expect(wrappedText(editor)).toBe(SENTENCE);
  });

  test('an ambiguous search phrase is refused rather than resolved to the first match', () => {
    const editor = mount(p('one and one'));
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const paraId = surface.session.paragraphAnchors().paraIdByNode.get(paragraphId)!;
    const command = {
      type: 'insertContentControl' as const,
      target: { paraId, search: 'one' },
      subtype: 'plainText' as const,
    };
    const can = editor.can(command);
    expect(can.ok).toBe(false);
    expect(can.ok === false && can.code).toBe('ambiguous');
    expect(editor.exec(command).ok).toBe(false);
  });

  test('the new control takes a file id above every id already in the document', () => {
    const editor = mount(pMixed(inlineSdt(`<w:id w:val="41"/><w:text/>`, run('OLD'))) + p('tail'));
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[1]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 4 },
    });
    editor.exec({ type: 'insertContentControl', subtype: 'plainText', tag: 'fresh' });

    const part = surface.session.part();
    const summary = editor.query({ type: 'contentControls' }).find((c) => c.tag === 'fresh')!;
    const node = findNode(part, summary.id)!;
    expect(contentControlPropertiesOf(node).id).toBe(42);
  });
});
