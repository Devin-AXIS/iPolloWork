import { afterEach, describe, expect, test } from 'bun:test';
import { docx } from './paginated-surface-fixtures.ts';
import {
  anchorDocx,
  FILLER,
  mountAnchorEditor,
  paragraph,
  replacePart,
  TARGET_ID,
  W14,
} from './scroll-to-anchor-fixture.ts';
import { storyParityDocx } from './story-parity-fixture.ts';

const OTHER_ID = '2C5D88B3';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function leadingTargets() {
  return docx(
    paragraph(TARGET_ID, '<w:r><w:t>Acme GmbH signs. Acme GmbH pays.</w:t></w:r>') +
      paragraph(OTHER_ID, '<w:r><w:t>Other paragraph</w:t></w:r>') +
      FILLER
  );
}

function mount(bytes = leadingTargets()) {
  const mounted = mountAnchorEditor(bytes);
  cleanups.push(mounted.destroy);
  const bands = () => [
    ...mounted.host.querySelectorAll<HTMLElement>('[data-docx-anchor-highlight]'),
  ];
  const nodeOf = (paraId: string) => mounted.editor.surface!.session.nodeIdOf(paraId)!;
  return { ...mounted, bands, nodeOf };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => wait(0);

describe('highlightAnchor', () => {
  test('marks the resolved paragraph without scrolling or changing editor state', () => {
    const { editor, scroller, bands, host } = mount();
    const surface = editor.surface!;
    const selection = surface.state().selection;
    const part = surface.session.part();
    const before = editor.snapshot();
    let events = 0;
    editor.on('change', () => events++);
    editor.on('selectionChange', () => events++);

    expect(editor.highlightAnchor({ paraId: TARGET_ID.toLowerCase() })).toBe(true);

    expect(bands()).toHaveLength(1);
    const band = bands()[0]!;
    expect(band.parentElement?.classList.contains('docx-page-content')).toBe(true);
    expect(band.getAttribute('aria-hidden')).toBe('true');
    expect(band.getAttribute('contenteditable')).toBe('false');
    expect(band.hasAttribute('data-docx-refresh-highlight')).toBe(false);
    expect(host.querySelector('[data-docx-refresh-highlight]')).toBeNull();
    expect(scroller.scrollTop).toBe(0);
    expect(surface.state().selection).toEqual(selection);
    expect(surface.session.part()).toBe(part);
    expect(editor.snapshot().canUndo).toBe(before.canUndo);
    expect(events).toBe(0);
  });

  test('applies the same presentation options as refresh highlights', () => {
    const { editor, bands } = mount();
    expect(
      editor.highlightAnchor(
        { paraId: TARGET_ID },
        {
          color: 'rgb(255, 0, 0)',
          opacity: 0.5,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: 'rgb(0, 0, 255)',
          borderRadius: 3,
          className: 'finding',
          animation: false,
        }
      )
    ).toBe(true);
    const band = bands()[0]!;
    expect(band.className).toBe('finding');
    // happy-dom drops color-mix() fills, so check the border that carries its own color.
    expect(band.style.border).toContain('dashed');
    expect(band.style.border).toContain('rgb(0, 0, 255)');
    expect(band.style.opacity).toBe('1');
  });

  test('validates options before resolving the anchor', () => {
    const { editor, bands } = mount();
    expect(() => editor.highlightAnchor({ paraId: TARGET_ID }, { opacity: 2 })).toThrow(RangeError);
    expect(() =>
      editor.highlightAnchor({ paraId: 'FFFFFFFF' }, { borderStyle: 'double' as 'solid' })
    ).toThrow(TypeError);
    expect(() =>
      editor.highlightAnchor({ paraId: TARGET_ID }, { animation: 'slow' as unknown as boolean })
    ).toThrow(TypeError);
    expect(bands()).toHaveLength(0);
  });

  test('replaces the previous anchor highlight', () => {
    const { editor, bands, nodeOf } = mount();
    expect(editor.highlightAnchor({ paraId: TARGET_ID }, { animation: false })).toBe(true);
    const first = bands()[0]!;
    expect(editor.highlightAnchor({ paraId: OTHER_ID }, { animation: false })).toBe(true);
    expect(first.isConnected).toBe(false);
    expect(bands()).toHaveLength(1);
    expect(bands()[0]!.style.top).not.toBe(first.style.top);
    expect(nodeOf(OTHER_ID)).toBeTruthy();
  });

  test('repeating a call keeps the band and does not replay the entrance', () => {
    const { editor, bands } = mount();
    expect(editor.highlightAnchor({ paraId: TARGET_ID })).toBe(true);
    const band = bands()[0]!;
    expect(editor.highlightAnchor({ paraId: TARGET_ID })).toBe(true);
    expect(bands()).toEqual([band]);
  });

  test('refuses invalid, missing, and ambiguous anchors without changing the highlight', () => {
    const { editor, bands } = mount();
    expect(editor.highlightAnchor({ paraId: TARGET_ID }, { animation: false })).toBe(true);
    const band = bands()[0]!;
    expect(editor.highlightAnchor({ paraId: '' })).toBe(false);
    expect(editor.highlightAnchor(null as never)).toBe(false);
    expect(editor.highlightAnchor({ paraId: 'FFFFFFFF' })).toBe(false);
    expect(editor.highlightAnchor({ paraId: TARGET_ID, search: 'Acme GmbH' })).toBe(false);
    expect(editor.highlightAnchor({ paraId: TARGET_ID, search: 'missing' })).toBe(false);
    expect(bands()).toEqual([band]);
    expect(editor.highlightAnchor({ paraId: TARGET_ID, search: 'Acme GmbH', occurrence: 2 })).toBe(
      true
    );
  });

  test('refuses header paragraphs, which have no body overlay', () => {
    const bytes = replacePart(storyParityDocx(), 'word/header1.xml', (xml) =>
      xml.replace(
        '<w:p><w:r><w:t>Beta',
        `<w:p xmlns:w14="${W14}" w14:paraId="${TARGET_ID}"><w:r><w:t>Beta`
      )
    );
    const { editor, bands } = mount(bytes);
    expect(editor.surface!.session.nodeIdOf(TARGET_ID)).toBeTruthy();
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expect(editor.highlightAnchor({ paraId: TARGET_ID })).toBe(false);
    expect(bands()).toHaveLength(0);
  });

  test('paints an offscreen target once its page mounts', async () => {
    const { editor, bands } = mount(anchorDocx());
    expect(editor.highlightAnchor({ paraId: TARGET_ID }, { animation: false })).toBe(true);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    await tick();
    expect(bands()).toHaveLength(1);
  });

  test('clears explicitly, after its timeout, and when the document loads', async () => {
    const { editor, bands } = mount();
    expect(editor.highlightAnchor({ paraId: TARGET_ID }, { animation: false })).toBe(true);
    editor.clearAnchorHighlight({ animation: false });
    expect(bands()).toHaveLength(0);

    expect(editor.highlightAnchor({ paraId: TARGET_ID }, { animation: false, timeoutMs: 0 })).toBe(
      true
    );
    expect(bands()).toHaveLength(1);
    await tick();
    expect(bands()).toHaveLength(0);

    expect(
      editor.highlightAnchor({ paraId: TARGET_ID }, { animation: false, timeoutMs: null })
    ).toBe(true);
    editor.load(leadingTargets());
    expect(bands()).toHaveLength(0);
  });

  test('keeps following the paragraph through local edits', async () => {
    const { editor, bands, nodeOf } = mount();
    expect(
      editor.highlightAnchor({ paraId: TARGET_ID }, { animation: false, timeoutMs: null })
    ).toBe(true);
    const paragraphId = nodeOf(OTHER_ID);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    expect(editor.exec({ type: 'insertText', text: 'Edited ' }).ok).toBe(true);
    await tick();
    expect(bands()).toHaveLength(1);
  });

  test('repeating a call restarts the timeout', async () => {
    const { editor, bands } = mount();
    const options = { animation: false, timeoutMs: 80 } as const;
    expect(editor.highlightAnchor({ paraId: TARGET_ID }, options)).toBe(true);
    await wait(50);
    expect(editor.highlightAnchor({ paraId: TARGET_ID }, options)).toBe(true);
    await wait(50);
    expect(bands()).toHaveLength(1);
    await wait(60);
    expect(bands()).toHaveLength(0);
  });

  test('clearAnchorHighlight validates options even with nothing highlighted', () => {
    const { editor } = mount();
    expect(() => editor.clearAnchorHighlight({ animation: { durationMs: -1 } })).toThrow(
      RangeError
    );
    expect(() => editor.clearAnchorHighlight({ animation: 'fast' as unknown as boolean })).toThrow(
      TypeError
    );
  });

  test('returns false without a mounted document', () => {
    const { editor } = mount();
    editor.detach();
    expect(editor.highlightAnchor({ paraId: TARGET_ID })).toBe(false);
    editor.clearAnchorHighlight();
  });
});

describe('scrollToAnchor options', () => {
  test('block controls alignment, like navigateToChange', () => {
    const centered = mount(anchorDocx());
    expect(centered.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    const atStart = mount(anchorDocx());
    expect(atStart.editor.scrollToAnchor({ paraId: TARGET_ID }, { block: 'start' })).toBe(true);
    expect(atStart.scroller.scrollTop).toBeGreaterThan(centered.scroller.scrollTop);
  });

  test('offsetPx changes start placement', () => {
    const near = mount(anchorDocx());
    near.editor.scrollToAnchor({ paraId: TARGET_ID }, { block: 'start', offsetPx: 0 });
    const padded = mount(anchorDocx());
    padded.editor.scrollToAnchor({ paraId: TARGET_ID }, { block: 'start', offsetPx: 100 });
    expect(near.scroller.scrollTop - padded.scroller.scrollTop).toBeCloseTo(100, 0);
  });

  test('refuses invalid options before resolving the anchor', () => {
    const { editor, scroller } = mount(anchorDocx());
    expect(() => editor.scrollToAnchor({ paraId: TARGET_ID }, { block: 'top' as 'start' })).toThrow(
      TypeError
    );
    expect(() =>
      editor.scrollToAnchor({ paraId: 'FFFFFFFF' }, { behavior: 'auto' as 'instant' })
    ).toThrow(TypeError);
    expect(() => editor.scrollToAnchor({ paraId: TARGET_ID }, { offsetPx: -1 })).toThrow(
      RangeError
    );
    expect(scroller.scrollTop).toBe(0);
  });
});
