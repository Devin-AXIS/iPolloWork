import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { storyContentBox } from '../surface-story-geometry.ts';
import { HEADER_R_ID, FOOTNOTE_SCOPE_ID, storyParityDocx } from './story-parity-fixture.ts';
import {
  anchorDocx,
  FILLER,
  mountAnchorEditor,
  replacePart,
  TARGET_ID,
  W14,
} from './scroll-to-anchor-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(...args: Parameters<typeof mountAnchorEditor>) {
  const mounted = mountAnchorEditor(...args);
  cleanups.push(mounted.destroy);
  return mounted;
}

function withTarget(bytes: Uint8Array, part: string) {
  return replacePart(bytes, part, (xml) =>
    xml.replace(
      '<w:p><w:r><w:t>Beta',
      `<w:p xmlns:w14="${W14}" w14:paraId="${TARGET_ID}"><w:r><w:t>Beta`
    )
  );
}

function storyDocument(part: string) {
  return withTarget(
    replacePart(storyParityDocx(), 'word/document.xml', (xml) =>
      xml.replace('<w:body>', `<w:body>${FILLER}`)
    ),
    part
  );
}

describe('scrollToAnchor across document regions', () => {
  for (const part of ['header1.xml', 'footer1.xml', 'footnotes.xml', 'endnotes.xml']) {
    test(`reveals unopened ${part} without changing editing scope`, () => {
      const { editor, scroller } = mount(storyDocument(`word/${part}`));
      const surface = editor.surface!;
      const selection = surface.state().selection;
      const snapshot = editor.snapshot();
      const paragraphId = surface.session.nodeIdOf(TARGET_ID)!;
      expect(paragraphId).toBeTruthy();
      scroller.scrollTop = 50_000;
      expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'Beta' })).toBe(true);
      expect(scroller.scrollTop).toBeLessThan(50_000);
      const layout = surface.layout();
      const caret = caretAt(layout, { paragraphId, offset: 0 })!;
      expect(caret).not.toBeNull();
      const page = layout.pages.find((page) => page.index === caret.pageIndex)!;
      // A header, footer or note caret is measured from that story's box, not the body's.
      const storyTop = storyContentBox(page, paragraphId).y;
      const top = ((storyTop + caret.y) * editor.getZoom() * 96) / 72;
      expect(top).toBeGreaterThanOrEqual(scroller.scrollTop);
      expect(top + (caret.height * editor.getZoom() * 96) / 72).toBeLessThanOrEqual(
        scroller.scrollTop + scroller.clientHeight
      );
      expect(surface.activeScope()).toEqual({ kind: 'body' });
      expect(surface.state().selection).toEqual(selection);
      expect(editor.snapshot().canUndo).toBe(snapshot.canUndo);
      if (part === 'header1.xml' || part === 'footer1.xml') expect(caret.pageIndex).toBe(0);
      // The footer sits below the body text: measured from the body box it would not.
      if (part === 'footer1.xml') {
        expect(storyTop + caret.y).toBeGreaterThan(page.contentBox.y + page.contentBox.height);
      }
    });
  }

  for (const scope of ['header', 'note'] as const) {
    test(`reveals body content while preserving an open ${scope}`, () => {
      const { editor } = mount(storyDocument('word/document.xml'));
      const surface = editor.surface!;
      const entered =
        scope === 'header'
          ? surface.enterHeaderFooter({ rId: HEADER_R_ID })
          : surface.enterNote(FOOTNOTE_SCOPE_ID);
      expect(entered).toBe(true);
      const before = surface.state().selection;
      const activeScope = surface.activeScope();
      expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
      expect(surface.activeScope()).toEqual(activeScope);
      expect(surface.state().selection).toEqual(before);
    });
  }

  test('refuses an ambiguous paraId without choosing another region', () => {
    const bytes = withTarget(storyDocument('word/header1.xml'), 'word/footer1.xml');
    const { editor, scroller, scrollCalls } = mount(bytes);
    const surface = editor.surface!;
    expect(surface.session.paragraphAnchors().ambiguousParaIds.has(TARGET_ID)).toBe(true);
    scroller.scrollTop = 500;
    const selection = surface.state().selection;
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(false);
    expect(scrollCalls()).toBe(0);
    expect(scroller.scrollTop).toBe(500);
    expect(surface.state().selection).toEqual(selection);
  });

  test('refuses a header that has no laid-out occurrence', () => {
    const bytes = replacePart(storyDocument('word/header1.xml'), 'word/document.xml', (xml) =>
      xml.replace(/<w:headerReference[^>]*\/>/, '')
    );
    const { editor, scrollCalls } = mount(bytes);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(false);
    expect(scrollCalls()).toBe(0);
  });

  test('resolves against a pending replacement document', () => {
    const { editor, scroller } = mount(storyParityDocx());
    const parts = unzipSync(anchorDocx());
    // Force deferred opening without creating a large layout.
    parts['word/filler.bin'] = strToU8(
      Array.from(
        { length: 30_000 },
        (_, i) => `Filler line ${i} carrying ordinary sentence text.\n`
      ).join('')
    );
    parts['[Content_Types].xml'] = strToU8(
      new TextDecoder()
        .decode(parts['[Content_Types].xml'])
        .replace(
          '</Types>',
          '<Default Extension="bin" ContentType="application/octet-stream"/></Types>'
        )
    );
    editor.load(zipSync(parts));
    expect(editor.snapshot().isOpening).toBe(true);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expect(editor.snapshot().isOpening).toBe(false);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });
});
