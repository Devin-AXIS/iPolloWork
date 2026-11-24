// Deleting a simple field in suggesting mode proposes its removal.
//
// A `w:fldSimple` with no saved result still shows a value (PAGE, NUMPAGES, TITLE and the
// rest compute one), and striking result runs inside it struck nothing: Backspace looked
// like it worked, the review pane showed no change, and the field stayed.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { revisionItemsOf, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, putCaret } from './paginated-surface-fixtures.ts';

const FIELDS: Record<string, string> = {
  'an empty PAGE field': '<w:fldSimple w:instr="PAGE"/>',
  'an empty TITLE field': '<w:fldSimple w:instr="TITLE"/>',
  'a field with a saved result':
    '<w:fldSimple w:instr=" AUTHOR "><w:r><w:t>Someone</w:t></w:r></w:fldSimple>',
};

function mountField(field: string): { surface: PaginatedSurface } {
  const opened = mountPaginatedSurface(
    document.createElement('div'),
    docx(
      `<w:p><w:r><w:t xml:space="preserve">PAGE: </w:t></w:r>${field}<w:r><w:t>!</w:t></w:r></w:p>`
    ),
    { author: 'Ada Lovelace' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  opened.surface.setEditingMode('suggest');
  return { surface: opened.surface };
}

const xmlOf = (surface: PaginatedSurface) => serializeOoxmlPart(surface.session.part());

describe('deleting a simple field in suggesting mode', () => {
  for (const [name, field] of Object.entries(FIELDS)) {
    for (const key of ['Backspace', 'Delete'] as const) {
      test(`${key} over ${name} proposes its deletion`, () => {
        const { surface } = mountField(field);
        putCaret(surface, key === 'Backspace' ? 7 : 6);
        if (key === 'Backspace') surface.deleteBackward();
        else surface.deleteForward();
        const xml = xmlOf(surface);
        expect(xml).not.toContain('fldSimple');
        expect(xml).toMatch(/<w:del [^>]*><w:r><w:fldChar w:fldCharType="begin"\/><\/w:r>/);
        expect(xml).toContain('<w:delInstrText');
        const items = revisionItemsOf(surface.session.part());
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ revisionKind: 'delete' });
        expect(items[0]!.text).toBe(
          name === 'a field with a saved result'
            ? 'Someone'
            : name.includes('PAGE')
              ? '{PAGE}'
              : '{TITLE}'
        );
        // The words around the field are untouched.
        expect(xml).toContain('<w:t xml:space="preserve">PAGE: </w:t>');
        expect(xml).toContain('<w:t>!</w:t>');
      });
    }
  }

  test('a selection over text and the field proposes one deletion', () => {
    const { surface } = mountField(FIELDS['an empty PAGE field']!);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset: 4 }, head: { paragraphId, offset: 7 } });
    expect(surface.deleteSelection()).toBe(true);
    const items = revisionItemsOf(surface.session.part());
    expect(items).toHaveLength(1);
    expect(xmlOf(surface)).toMatch(
      /<w:del [^>]*><w:r><w:delText xml:space="preserve">: <\/w:delText><\/w:r><w:r><w:fldChar w:fldCharType="begin"\/>/
    );
  });

  test('undo restores the simple field', () => {
    const { surface } = mountField(FIELDS['an empty PAGE field']!);
    const before = xmlOf(surface);
    putCaret(surface, 7);
    surface.deleteBackward();
    expect(xmlOf(surface)).not.toBe(before);
    surface.undo();
    expect(xmlOf(surface)).toBe(before);
  });
});
