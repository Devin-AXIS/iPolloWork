// Selection edits the document vocabulary documents: `replaceText`, `applyFormatting`,
// `splitParagraph`, `mergeParagraphs`, and `removeTabMark`.
//
// Each was refused as "not supported by the tree editor" in every mode. Each now runs through
// the lane of the gesture it names, as one undo step, tracked in suggesting mode, and refused
// with a reason where the gesture would be.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import { bodyXml, docx, everyStoryDocx, mount } from './replace-all-matches-fixture.ts';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function select(editor: DocxEditorInstance, index: number, from: number, to = from) {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
  return paragraphId;
}

const text = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();

describe('replaceText', () => {
  test('replaces the selection in one undo step', () => {
    const { editor, dispose } = mount(paragraph('one two three'));
    try {
      select(editor, 0, 4, 7);
      const command = { type: 'replaceText' as const, text: 'seven' };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      expect(text(editor)).toContain('one seven three');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(text(editor)).toContain('one two three');
    } finally {
      dispose();
    }
  });

  test('is a tracked replacement in suggesting mode', () => {
    const { editor, dispose } = mount(paragraph('one two three'));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      select(editor, 0, 4, 7);
      expect(editor.exec({ type: 'replaceText', text: 'seven' }).ok).toBe(true);
      const xml = bodyXml(editor);
      expect(xml).toMatch(/<w:del w:author="Grace Hopper"[^>]*><w:r><w:delText>two</);
      expect(xml).toMatch(/<w:ins w:author="Grace Hopper"[^>]*><w:r><w:t>seven</);
    } finally {
      dispose();
    }
  });

  test('empty text deletes the selection; a target is refused', () => {
    const { editor, dispose } = mount(paragraph('one two three'));
    try {
      select(editor, 0, 3, 7);
      expect(editor.exec({ type: 'replaceText', text: '' }).ok).toBe(true);
      expect(text(editor)).toContain('one three');
      const targeted = { type: 'replaceText' as const, text: 'x', target: { search: 'one' } };
      expect(editor.can(targeted as never)).toMatchObject({ ok: false, code: 'unsupported' });
    } finally {
      dispose();
    }
  });

  test('viewing mode refuses it', () => {
    const { editor, dispose } = mount(paragraph('one two'));
    try {
      expect(editor.setEditingMode('viewing').ok).toBe(true);
      select(editor, 0, 0, 3);
      expect(editor.exec({ type: 'replaceText', text: 'x' })).toMatchObject({
        ok: false,
        code: 'locked',
      });
    } finally {
      dispose();
    }
  });
});

describe('applyFormatting', () => {
  test('sets every mark over the selection in one undo step', () => {
    const { editor, dispose } = mount(paragraph('plain words'));
    try {
      const before = bodyXml(editor);
      select(editor, 0, 0, 5);
      const command = {
        type: 'applyFormatting' as const,
        marks: {
          bold: true,
          italic: true,
          fontSizePt: 14,
          color: { kind: 'hex', value: 'FF0000' },
        },
      };
      expect(editor.can(command as never)).toEqual({ ok: true });
      expect(editor.exec(command as never)).toEqual({ ok: true, changed: true });
      const xml = bodyXml(editor);
      for (const piece of ['<w:b/>', '<w:i/>', '<w:sz w:val="28"/>', '<w:color w:val="FF0000"/>'])
        expect(xml).toContain(piece);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(bodyXml(editor)).toBe(before);
    } finally {
      dispose();
    }
  });

  test('a refused mark refuses them all: no change and no undo step', () => {
    const { editor, dispose } = mount(paragraph('plain words'));
    try {
      const before = bodyXml(editor);
      select(editor, 0, 0, 5);
      // The store refuses any batch that writes italic, as a lock on one property would.
      const session = editor.surface!.session;
      const apply = session.applyTreeOps.bind(session);
      const batches: string[][] = [];
      session.applyTreeOps = ((ops, ...rest) => {
        const names = ops.flatMap((op) =>
          'properties' in op && Array.isArray(op.properties)
            ? op.properties.map((property: { localName: string }) => property.localName)
            : []
        );
        batches.push(names);
        if (names.includes('i')) {
          return { committed: false, rejected: true, opCount: 0, reason: 'locked' };
        }
        return apply(ops, ...rest);
      }) as typeof session.applyTreeOps;
      const result = editor.exec({
        type: 'applyFormatting',
        marks: { bold: true, italic: true },
      } as never);
      expect(result).toMatchObject({ ok: false, code: 'locked' });
      // Bold and italic reached the store as one batch, so nothing landed.
      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual(expect.arrayContaining(['b', 'i']));
      expect(bodyXml(editor)).toBe(before);
      expect(editor.can({ type: 'undo' }).ok).toBe(false);
    } finally {
      dispose();
    }
  });

  test('false states the switch off rather than toggling it', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>');
    try {
      select(editor, 0, 0, 4);
      expect(editor.exec({ type: 'applyFormatting', marks: { bold: false } }).ok).toBe(true);
      expect(editor.getSelectionFormatting()?.bold ?? false).toBe(false);
      // Applying it again leaves the text off: a set, not a toggle.
      const once = bodyXml(editor);
      expect(once).toContain('<w:b w:val="0"/>');
      expect(editor.exec({ type: 'applyFormatting', marks: { bold: false } }).ok).toBe(true);
      expect(bodyXml(editor)).toBe(once);
    } finally {
      dispose();
    }
  });

  test('refuses paragraph fields, conflicting scripts, and theme colors', () => {
    const { editor, dispose } = mount(paragraph('words'));
    try {
      select(editor, 0, 0, 5);
      for (const marks of [
        { alignment: 'center' },
        { superscript: true, subscript: true },
        { color: { kind: 'theme', slot: 'accent1' } },
        { bold: 'yes' },
        {},
      ]) {
        expect(editor.can({ type: 'applyFormatting', marks } as never)).toMatchObject({
          ok: false,
          code: 'invalidArgs',
        });
      }
    } finally {
      dispose();
    }
  });

  test('records a formatting change in suggesting mode', () => {
    const { editor, dispose } = mount(paragraph('words'));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      select(editor, 0, 0, 5);
      expect(editor.exec({ type: 'applyFormatting', marks: { bold: true } }).ok).toBe(true);
      expect(bodyXml(editor)).toMatch(/<w:rPrChange w:author="Grace Hopper"/);
    } finally {
      dispose();
    }
  });

  test('form protection refuses it', () => {
    const { editor, dispose } = mount(
      docx(paragraph('words'), '<w:documentProtection w:edit="forms" w:enforcement="1"/>')
    );
    try {
      select(editor, 0, 0, 5);
      expect(editor.exec({ type: 'applyFormatting', marks: { bold: true } })).toMatchObject({
        ok: false,
        code: 'locked',
      });
    } finally {
      dispose();
    }
  });
});

describe('splitParagraph', () => {
  test('splits at the caret in one undo step', () => {
    const { editor, dispose } = mount(paragraph('headtail'));
    try {
      select(editor, 0, 4);
      expect(editor.can({ type: 'splitParagraph' })).toEqual({ ok: true });
      expect(editor.exec({ type: 'splitParagraph' })).toEqual({ ok: true, changed: true });
      expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
      expect(text(editor)).toContain('head\ntail');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  test('proposes the new paragraph mark in suggesting mode', () => {
    const { editor, dispose } = mount(paragraph('headtail'));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      select(editor, 0, 4);
      expect(editor.exec({ type: 'splitParagraph' }).ok).toBe(true);
      expect(bodyXml(editor)).toMatch(/<w:rPr><w:ins w:author="Grace Hopper"/);
    } finally {
      dispose();
    }
  });
});

describe('mergeParagraphs', () => {
  test("joins the caret's paragraph with the next, caret at the join", () => {
    const { editor, dispose } = mount(paragraph('first ') + paragraph('second') + paragraph('x'));
    try {
      const first = select(editor, 0, 2);
      expect(editor.can({ type: 'mergeParagraphs' })).toEqual({ ok: true });
      expect(editor.exec({ type: 'mergeParagraphs' })).toEqual({ ok: true, changed: true });
      expect(text(editor)).toContain('first second\nx');
      expect(editor.surface!.state().selection.head).toEqual({ paragraphId: first, offset: 2 });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(text(editor)).toContain('first \nsecond\nx');
    } finally {
      dispose();
    }
  });

  test('joins paragraphs inside an open header', () => {
    const { editor, dispose } = mount(everyStoryDocx());
    try {
      expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
      const surface = editor.surface!;
      const order = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' });
      const first = order[1]!;
      surface.setSelection({
        anchor: { paragraphId: first, offset: 1 },
        head: { paragraphId: first, offset: 1 },
      });
      const before = order.length;
      expect(editor.exec({ type: 'mergeParagraphs' })).toEqual({ ok: true, changed: true });
      expect(surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })).toHaveLength(
        before - 1
      );
      expect(surface.state().selection.head).toEqual({ paragraphId: first, offset: 1 });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })).toHaveLength(
        before
      );
    } finally {
      dispose();
    }
  });

  test('joins every paragraph the selection spans', () => {
    const { editor, dispose } = mount(paragraph('a') + paragraph('b') + paragraph('c'));
    try {
      const ids = editor.surface!.session.paragraphIds();
      editor.surface!.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[2]!, offset: 1 },
      });
      expect(editor.exec({ type: 'mergeParagraphs' }).ok).toBe(true);
      expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
      expect(text(editor)).toContain('abc');
    } finally {
      dispose();
    }
  });

  test('refuses at the last paragraph and across table cells', () => {
    const cells =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      paragraph('end');
    const { editor, dispose } = mount(cells);
    try {
      const ids = editor.surface!.session.paragraphIds();
      editor.surface!.setSelection({
        anchor: { paragraphId: ids.at(-1)!, offset: 0 },
        head: { paragraphId: ids.at(-1)!, offset: 0 },
      });
      expect(editor.exec({ type: 'mergeParagraphs' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      const before = bodyXml(editor);
      select(editor, 0, 0);
      expect(editor.exec({ type: 'mergeParagraphs' }).ok).toBe(false);
      expect(bodyXml(editor)).toBe(before);
    } finally {
      dispose();
    }
  });

  test('proposes removing the mark in suggesting mode', () => {
    const { editor, dispose } = mount(paragraph('first') + paragraph('second'));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      select(editor, 0, 0);
      expect(editor.exec({ type: 'mergeParagraphs' }).ok).toBe(true);
      // Both paragraphs stay; the first one's mark is proposed away.
      expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
      expect(bodyXml(editor)).toMatch(/<w:rPr><w:del w:author="Grace Hopper"/);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(bodyXml(editor)).not.toContain('<w:del ');
    } finally {
      dispose();
    }
  });
});

describe('removeTabMark', () => {
  const tabbed =
    '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:pos="1440"/>' +
    '</w:tabs></w:pPr><w:r><w:t>tabs</w:t></w:r></w:p>';

  test('removes one stop and keeps the others, in one undo step', () => {
    const { editor, dispose } = mount(tabbed);
    try {
      select(editor, 0, 1);
      const command = { type: 'removeTabMark' as const, positionTwips: 720 };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      expect(editor.surface!.formatting().tabStops?.map((stop) => stop.positionTwips)).toEqual([
        1440,
      ]);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.surface!.formatting().tabStops).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  test('refuses a position with no stop and a malformed one', () => {
    const { editor, dispose } = mount(tabbed);
    try {
      select(editor, 0, 1);
      expect(editor.exec({ type: 'removeTabMark', positionTwips: 999 })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      expect(editor.can({ type: 'removeTabMark', positionTwips: -1 })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
    } finally {
      dispose();
    }
  });
});

describe('document variables', () => {
  test('setVariable and applyVariables stay refused as unsupported', () => {
    const { editor, dispose } = mount(paragraph('words'));
    try {
      for (const command of [
        { type: 'setVariable' as const, name: 'Client', value: 'Example' },
        { type: 'applyVariables' as const, values: { Client: 'Example' } },
      ]) {
        expect(editor.can(command)).toMatchObject({ ok: false, code: 'unsupported' });
        expect(editor.exec(command)).toMatchObject({ ok: false, code: 'unsupported' });
      }
    } finally {
      dispose();
    }
  });
});

describe('history groups', () => {
  test('replaceText and splitParagraph share one undo step in a group', () => {
    const { editor, dispose } = mount(paragraph('one two'));
    try {
      const group = editor.beginHistoryGroup();
      select(editor, 0, 4, 7);
      expect(editor.exec({ type: 'replaceText', text: 'six' }, { historyGroup: group }).ok).toBe(
        true
      );
      select(editor, 0, 3);
      expect(editor.exec({ type: 'splitParagraph' }, { historyGroup: group }).ok).toBe(true);
      group.end();
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(text(editor)).toContain('one two');
      expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
    } finally {
      dispose();
    }
  });
});
