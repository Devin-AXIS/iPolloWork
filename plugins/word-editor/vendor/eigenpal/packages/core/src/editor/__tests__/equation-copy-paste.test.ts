// Equations through editor copy and paste: the embedded fragment, the plain-text flavour,
// partial selections, undo, and display equations landing beside text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FRACTION =
  '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
  '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
const BODY =
  `<w:p xmlns:m="${M}"><w:r><w:t xml:space="preserve">Inline </w:t></w:r>${FRACTION}` +
  '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>' +
  `<w:p xmlns:m="${M}"><m:oMathPara><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>` +
  '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></w:p>';

type Surface = ReturnType<typeof mount>['surface'];

function count(surface: Surface, tag: 'oMath' | 'oMathPara'): number {
  const xml = serializeOoxmlPart(surface.session.part());
  return (xml.match(new RegExp(`<m:${tag}(?:\\s|>)`, 'g')) ?? []).length;
}

function select(surface: Surface, anchor: [number, number], head: [number, number]): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[anchor[0]]!, offset: anchor[1] },
    head: { paragraphId: ids[head[0]]!, offset: head[1] },
  });
}

describe('equations through editor copy and paste', () => {
  test('select all lands inline and display equations, and undo removes them', () => {
    const source = mount(BODY);
    source.surface.selectAll();
    const flavours = source.surface.copyFlavours();
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.pasteRich(flavours.text, flavours.html);
    expect(count(target.surface, 'oMath')).toBe(2);
    expect(count(target.surface, 'oMathPara')).toBe(1);
    putCaret(target.surface, 7);
    expect(target.surface.equations.equationAtCaret()?.linear).toBe('{a}/{b}');
    target.surface.undo();
    expect(count(target.surface, 'oMath')).toBe(0);
  });

  test('plain text spells each equation in its linear form', () => {
    const source = mount(BODY);
    source.surface.selectAll();
    expect(source.surface.copyFlavours().text).toBe('Inline {a}/{b} after\nx^{2}');
    select(source.surface, [0, 4], [0, 11]);
    expect(source.surface.copyFlavours().text).toBe('ne {a}/{b} af');
  });

  test('a partial selection pastes its equation into the middle of text', () => {
    const source = mount(BODY);
    select(source.surface, [0, 4], [0, 11]);
    const flavours = source.surface.copyFlavours();
    const target = mount(paragraph('XY'));
    putCaret(target.surface, 1);
    target.surface.pasteRich(flavours.text, flavours.html);
    expect(target.surface.session.bodyText()).toBe('Xne ￼ afY');
    expect(count(target.surface, 'oMath')).toBe(1);
  });

  test('a display pasted beside text becomes inline, and into an empty line stays a display', () => {
    const source = mount(BODY);
    select(source.surface, [1, 0], [1, 1]);
    const flavours = source.surface.copyFlavours();

    const beside = mount(paragraph('XY'));
    putCaret(beside.surface, 1);
    beside.surface.pasteRich(flavours.text, flavours.html);
    // Selecting the complete display paragraph also copies its paragraph mark.
    expect(beside.surface.session.bodyText()).toBe('X￼\nY');
    expect(count(beside.surface, 'oMath')).toBe(1);
    expect(count(beside.surface, 'oMathPara')).toBe(0);

    const alone = mount(paragraph(''));
    putCaret(alone.surface, 0);
    alone.surface.pasteRich(flavours.text, flavours.html);
    expect(count(alone.surface, 'oMathPara')).toBe(1);
  });
});
