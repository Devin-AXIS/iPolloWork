// The caret moves freely through struck text; edits never land inside the deletion.
//
// Word's split of responsibilities, and now this surface's: navigation treats visible
// deleted characters as ordinary caret stops, while the INSERT lanes relocate a collapsed
// insertion point past the deletion it rests in — new content beside a `w:del`, never
// inside it, where it would serialize as `w:t` under a wrapper that requires `w:delText`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mount } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

/** `AB` + deleted `CDE` + `FG` — model offsets 0..7, with 2..5 deleted. */
const MIXED =
  '<w:p><w:r><w:t>AB</w:t></w:r>' +
  '<w:del w:id="1" w:author="Dev" w:date="2026-03-26T11:00:00Z">' +
  '<w:r><w:delText>CDE</w:delText></w:r></w:del>' +
  '<w:r><w:t>FG</w:t></w:r></w:p>';

describe('caret and edits around deleted content', () => {
  test('a collapsed caret rests inside struck text, and arrows move one character', () => {
    const { surface } = mount(MIXED);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 3 },
      head: { paragraphId, offset: 3 },
    });
    expect(surface.state().selection.head.offset).toBe(3);
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(4);
    surface.navigate('left');
    surface.navigate('left');
    expect(surface.state().selection.head.offset).toBe(2);
  });

  test('typing at an interior caret lands past the deletion, never inside it', () => {
    const { surface } = mount(MIXED);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 3 },
      head: { paragraphId, offset: 3 },
    });
    surface.type('X');
    expect(surface.session.bodyText()).toBe('ABCDEXFG');
    // The deletion's own content is untouched; the typed character sits outside the wrapper.
    const xml = serializeOoxmlPart(surface.session.part());
    expect(xml).toContain('<w:delText>CDE</w:delText>');
    expect(xml).not.toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*X/);
    // The caret follows the typed character.
    expect(surface.state().selection.head.offset).toBe(6);
  });

  test('repeated word jumps always advance across a deletion', () => {
    const body =
      '<w:p><w:r><w:t xml:space="preserve">AB </w:t></w:r>' +
      '<w:del w:id="1" w:author="Dev" w:date="2026-03-26T11:00:00Z">' +
      '<w:r><w:delText xml:space="preserve">CD EF </w:delText></w:r></w:del>' +
      '<w:r><w:t>GH</w:t></w:r></w:p>';
    const { surface } = mount(body);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    let previous = 0;
    for (let press = 0; press < 8 && previous < 11; press += 1) {
      surface.navigate('wordRight');
      const at = surface.state().selection.head.offset;
      expect(at).toBeGreaterThan(previous);
      previous = at;
    }
    expect(previous).toBe(11);
  });

  test('a range over deleted text passes through untouched', () => {
    const { surface } = mount(MIXED);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 4 },
    });
    expect(surface.state().selection.head.offset).toBe(4);
  });
});
