import { afterEach, describe, expect, test } from 'bun:test';
import type { DocAnchor } from '../../contracts/types.ts';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { anchorDocx, mountAnchorEditor, paragraph, TARGET_ID } from './scroll-to-anchor-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(...args: Parameters<typeof mountAnchorEditor>) {
  const mounted = mountAnchorEditor(...args);
  cleanups.push(mounted.destroy);
  return mounted;
}

function expectVisible(mounted: ReturnType<typeof mount>, offset = 0) {
  const { editor, scroller } = mounted;
  const surface = editor.surface!;
  const paragraphId = surface.session.nodeIdOf(TARGET_ID)!;
  const layout = surface.layout();
  const caret = caretAt(layout, { paragraphId, offset })!;
  expect(caret).not.toBeNull();
  const page = layout.pages.find((page) => page.index === caret.pageIndex)!;
  const top = (page.contentBox.y + caret.y) * ((editor.getZoom() * 96) / 72);
  expect(top).toBeGreaterThanOrEqual(scroller.scrollTop);
  expect(top + caret.height * ((editor.getZoom() * 96) / 72)).toBeLessThanOrEqual(
    scroller.scrollTop + scroller.clientHeight
  );
  expect(mounted.host.querySelector(`[data-paragraph-id="${paragraphId}"]`)).not.toBeNull();
}

describe('scrollToAnchor', () => {
  test('reveals a distant externally supplied paraId and materializes its page', () => {
    const mounted = mount();
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID.toLowerCase() })).toBe(true);
    expect(mounted.scroller.scrollTop).toBeGreaterThan(0);
    expectVisible(mounted);
    const calls = mounted.scrollCalls();
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expect(mounted.scrollCalls()).toBe(calls);
  });

  test('preserves selection, external focus, content, and undo history', () => {
    const mounted = mount();
    const { editor, host } = mounted;
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 4 },
    });
    const input = document.createElement('input');
    host.parentElement!.append(input);
    input.focus();
    const selection = surface.state().selection;
    const before = editor.snapshot();
    const part = surface.session.part();
    let changes = 0;
    editor.on('change', () => changes++);
    editor.on('selectionChange', () => changes++);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expect(surface.state().selection).toEqual(selection);
    expect(document.activeElement).toBe(input);
    expect(surface.session.part()).toBe(part);
    expect(editor.snapshot().canUndo).toBe(before.canUndo);
    expect(editor.snapshot().canRedo).toBe(before.canRedo);
    expect(changes).toBe(0);
  });

  test('preserves editor focus and a collapsed caret', () => {
    const { editor } = mount();
    editor.focus();
    const focused = document.activeElement;
    const selection = editor.surface!.state().selection;
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expect(document.activeElement).toBe(focused);
    expect(editor.surface!.state().selection).toEqual(selection);
  });

  test('reveals the matched line and handles explicit occurrences', () => {
    const runs =
      '<w:r><w:t>needle</w:t>' +
      '<w:br/><w:t>line</w:t>'.repeat(80) +
      '<w:br/><w:t>needle unique</w:t></w:r>';
    const mounted = mount(anchorDocx(paragraph(TARGET_ID, runs)));
    const { editor, scroller } = mounted;
    expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'needle' })).toBe(false);
    expect(scroller.scrollTop).toBe(0);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'needle', occurrence: 1 })).toBe(
      true
    );
    const first = scroller.scrollTop;
    expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'needle', occurrence: 2 })).toBe(
      true
    );
    expect(scroller.scrollTop).toBeGreaterThan(first);
    expectVisible(mounted, 'needle'.length + '\nline'.repeat(80).length + 1);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'unique' })).toBe(true);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'Needle' })).toBe(false);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'needle', occurrence: 3 })).toBe(
      false
    );
  });

  test.each([0.5, 1, 2])('respects zoom at %s', (zoom) => {
    const mounted = mount();
    mounted.editor.setZoom(zoom);
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expectVisible(mounted);
  });

  test.each(['empty', 'table', 'content control'])('reveals an %s paragraph', (kind) => {
    const target = paragraph(TARGET_ID, kind === 'empty' ? '' : '<w:r><w:t>Target</w:t></w:r>');
    const wrapped =
      kind === 'table'
        ? '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
          `<w:tr><w:tc><w:tcPr/>${target}</w:tc></w:tr></w:tbl>`
        : kind === 'content control'
          ? `<w:sdt><w:sdtPr><w:tag w:val="external"/></w:sdtPr><w:sdtContent>${target}</w:sdtContent></w:sdt>`
          : target;
    const mounted = mount(anchorDocx(wrapped));
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expectVisible(mounted);
  });

  test('works in viewing mode', () => {
    const mounted = mount(anchorDocx(), { mode: 'view' });
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expectVisible(mounted);
  });

  test.each([
    null,
    undefined,
    {},
    { paraId: 123 },
    { paraId: '' },
    { paraId: '00000000' },
    { paraId: TARGET_ID, search: '' },
    { paraId: TARGET_ID, search: 2 },
    { paraId: TARGET_ID, occurrence: 0 },
    { paraId: TARGET_ID, occurrence: -1 },
    { paraId: TARGET_ID, occurrence: 1.5 },
    { paraId: TARGET_ID, occurrence: NaN },
    { paraId: TARGET_ID, search: 'missing' },
  ])('refuses invalid or missing targets: %j', (anchor) => {
    const { editor, scroller, scrollCalls } = mount();
    const selection = editor.surface!.state().selection;
    expect(editor.scrollToAnchor(anchor as DocAnchor)).toBe(false);
    expect(scrollCalls()).toBe(0);
    expect(scroller.scrollTop).toBe(0);
    expect(editor.surface!.state().selection).toEqual(selection);
  });

  test('refuses a missing or unmeasurable viewport', () => {
    const { editor, host } = mount(anchorDocx(), {}, 0);
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(false);
    document.body.append(host);
    cleanups.push(() => host.remove());
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(false);
  });

  test('refuses before attach, after detach, and after destroy', () => {
    const editor = createDocxEditor({ document: anchorDocx() });
    cleanups.push(() => editor.destroy());
    expect(editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(false);
    const mounted = mount();
    mounted.editor.detach();
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(false);
    mounted.editor.attach(mounted.host);
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    mounted.editor.destroy();
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(false);
  });

  test('resolves after an edit and after save and reopen', async () => {
    const mounted = mount();
    expect(mounted.editor.exec({ type: 'insertText', text: 'Updated ' }).ok).toBe(true);
    expect(mounted.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    const saved = await mounted.editor.save();
    const reopened = mount(saved);
    expect(reopened.editor.scrollToAnchor({ paraId: TARGET_ID })).toBe(true);
    expectVisible(reopened);
  });

  test('resolves search text after queued typing commits', () => {
    const mounted = mount(anchorDocx(paragraph(TARGET_ID, '')));
    const { editor } = mounted;
    const surface = editor.surface!;
    const paragraphId = surface.session.nodeIdOf(TARGET_ID)!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    surface.enqueueType('queued needle');
    expect(editor.scrollToAnchor({ paraId: TARGET_ID, search: 'needle' })).toBe(true);
    expect(surface.state().selection).toEqual({
      anchor: { paragraphId, offset: 13 },
      head: { paragraphId, offset: 13 },
    });
    expectVisible(mounted, 7);
  });
});
