// Header/footer scope chrome against the real engine: overlay state, options, inserts,
// mousedown caret contract, ARIA, and selector stability.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorHeaderFooterChrome } from '../src/editor/DocxEditorHeaderFooter.tsx';
import { useHeaderFooterState } from '../src/editor/useHeaderFooterState.ts';
import { useScopedChromeAnchor } from '../src/editor/useScopedChromeAnchor.ts';
import { pressCancelledPages } from './cancelled-press.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

const findActiveProbe = (viewport: HTMLElement): HTMLElement | null =>
  viewport.querySelector<HTMLElement>('[data-docx-hf-active]');

function setStoryRect(node: HTMLDivElement | null, left: number, top: number, width: number): void {
  if (!node) return;
  node.getBoundingClientRect = () => {
    const viewport = node.closest<HTMLElement>('.docx-editor__scroll-container');
    return rect(left - (viewport?.scrollLeft ?? 0), top - (viewport?.scrollTop ?? 0), width, 30);
  };
}

function AnchorProbe({
  active,
  clientLeft = 0,
  clientTop = 0,
  renders,
}: {
  active: 'first' | 'second';
  clientLeft?: number;
  clientTop?: number;
  renders?: { count: number };
}): ReactNode {
  if (renders) renders.count += 1;
  const anchor = useScopedChromeAnchor(findActiveProbe, 'story-label');
  return (
    <div
      className="docx-editor__scroll-container"
      ref={(node) => {
        if (!node) return;
        node.getBoundingClientRect = () => rect(0, 0, 800, 600);
        Object.defineProperty(node, 'clientWidth', { value: 800, configurable: true });
        Object.defineProperty(node, 'clientLeft', { value: clientLeft, configurable: true });
        Object.defineProperty(node, 'clientTop', { value: clientTop, configurable: true });
      }}
    >
      <div className="docx-paginated-surface">
        {active === 'first' ? (
          <div
            key="first"
            data-docx-hf-active=""
            ref={(node) => setStoryRect(node, 120, 80, 500)}
          />
        ) : (
          <div
            key="second"
            data-docx-hf-active=""
            ref={(node) => setStoryRect(node, 420, 280, 320)}
          />
        )}
      </div>
      <div ref={anchor.ref} data-testid="anchor-probe" style={anchor.style} />
    </div>
  );
}

function docxWithHeader(headerText = 'Hdr'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        '<Relationship Id="rId10" Type="' +
        R +
        '/header" Target="header1.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        p('body') +
        `<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p(headerText)}</w:hdr>`),
  });
}

/** Two sections: section 2 inherits section 1's default header. */
function docxInheritedHeader(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        '<Relationship Id="rId10" Type="' +
        R +
        '/header" Target="header1.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        p('sec1') +
        `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr></w:pPr></w:p>` +
        p('sec2') +
        '<w:sectPr/>' +
        '</w:body></w:document>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('Shared')}</w:hdr>`),
  });
}

function mountChrome(
  source: Uint8Array,
  extra?: ReactNode
): { editor: () => DocxEditorInstance; view: ReturnType<typeof render> } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {extra}
      <DocxEditorViewport>
        <DocxEditorHeaderFooterChrome />
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function SelectorProbe(): null {
  const state = useHeaderFooterState();
  (globalThis as unknown as { __hfProbe?: unknown }).__hfProbe = state;
  return null;
}

afterEach(() => {
  cleanup();
  delete (globalThis as unknown as { __hfProbe?: unknown }).__hfProbe;
});

describe('DocxEditor.HeaderFooterChrome', () => {
  test('hidden until a furniture scope opens', () => {
    const { view } = mountChrome(docxWithHeader());
    expect(view.queryByTestId('docx-hf-chrome')).toBeNull();
  });

  test('story bar follows the focused furniture occurrence', async () => {
    const view = render(<AnchorProbe active="first" />);
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(view.getByTestId('anchor-probe').style.left).toBe('120px');
    expect(view.getByTestId('anchor-probe').style.top).toBe('46px');

    await act(async () => {
      view.rerender(<AnchorProbe active="second" />);
    });
    await act(async () => {
      fireEvent.scroll(view.container.querySelector('.docx-editor__scroll-container')!);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(view.getByTestId('anchor-probe').style.left).toBe('420px');
  });

  test('story bar subtracts the scroller padding-edge gutter (scrollbar-gutter both-edges)', async () => {
    // Chromium reports clientLeft ≈ 15 when `scrollbar-gutter: stable both-edges` reserves
    // a left gutter. Absolute `left` is relative to that padding edge, not the border box
    // from getBoundingClientRect — without subtracting clientLeft the rail sits 15px right
    // of the painted story. Header/footer and footnote/endnote chrome share this hook.
    const view = render(<AnchorProbe active="first" clientLeft={15} clientTop={0} />);
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(view.getByTestId('anchor-probe').style.left).toBe('105px');
    expect(view.getByTestId('anchor-probe').style.top).toBe('46px');
  });

  test('story bar renders nothing for a frame that does not move it', async () => {
    const renders = { count: 0 };
    const view = render(<AnchorProbe active="first" renders={renders} />);
    const viewport = view.container.querySelector('.docx-editor__scroll-container') as HTMLElement;
    const frame = () =>
      act(async () => {
        fireEvent.scroll(viewport);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    // Two frames to settle: placement, then the one render React may spend before it skips
    // an unchanged state.
    await frame();
    await frame();
    const settled = renders.count;
    for (let i = 0; i < 3; i += 1) await frame();
    expect(renders.count).toBe(settled);
  });

  test('story bar scrolls away with its focused occurrence', async () => {
    const view = render(<AnchorProbe active="first" />);
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const bar = view.getByTestId('anchor-probe');
    const initialLeft = bar.style.left;
    const initialTop = bar.style.top;
    const viewport = view.container.querySelector('.docx-editor__scroll-container') as HTMLElement;

    viewport.scrollLeft = 50;
    viewport.scrollTop = 200;
    await act(async () => {
      fireEvent.scroll(viewport);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(bar.style.left).toBe(initialLeft);
    expect(bar.style.top).toBe(initialTop);
  });

  test('shows the active region after editHeaderFooter', async () => {
    const { view, editor } = mountChrome(docxWithHeader());
    await act(async () => {
      const opened = editor().exec({ type: 'editHeaderFooter', position: 'header' });
      expect(opened.ok).toBe(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const chrome = view.getByTestId('docx-hf-chrome');
    expect(chrome).toBeTruthy();
    expect(chrome.style.visibility).toBe('visible');
    expect(chrome.style.position).toBe('absolute');
    expect(chrome.textContent).toContain('Header');
    expect(chrome.textContent).not.toContain('Section 1');
    expect(chrome.getAttribute('aria-label')).toBe('Header and footer editing');
  });

  test('shows inherited warning for inherited header', async () => {
    const { view, editor } = mountChrome(docxInheritedHeader());
    await act(async () => {
      editor().exec({ type: 'editHeaderFooter', position: 'header', sectionIndex: 1 });
    });
    expect(view.getByTestId('docx-hf-inherited')).toBeTruthy();
    expect(view.getByTestId('docx-hf-inherited').textContent).toContain('Same as previous');
  });

  test('options exposes page fields enabled in furniture scope', async () => {
    const { view, editor } = mountChrome(docxWithHeader());
    const pageNumber = () => view.queryByRole('button', { name: 'Insert current page number' });
    expect(pageNumber()).toBeNull();

    await act(async () => {
      editor().exec({ type: 'editHeaderFooter', position: 'header' });
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const trigger = view.getByRole('button', { name: 'Options', hidden: true });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    const menuItem = view.getByRole('menuitem', {
      name: 'Insert current page number',
      hidden: true,
    }) as HTMLButtonElement;
    expect(menuItem.disabled).toBe(false);
    const disabled = editor().can({ type: 'insertPageField', field: 'PAGE' });
    expect(disabled.ok).toBe(true);
  });

  test('options menu exposes link on declared section and unlink when inherited', async () => {
    const declared = mountChrome(docxWithHeader());
    await act(async () => {
      declared.editor().exec({ type: 'editHeaderFooter', position: 'header' });
    });
    fireEvent.click(declared.view.getByText('Options'));
    expect(declared.view.getByText('Link to previous')).toBeTruthy();
    cleanup();

    const inherited = mountChrome(docxInheritedHeader());
    await act(async () => {
      inherited.editor().exec({ type: 'editHeaderFooter', position: 'header', sectionIndex: 1 });
    });
    fireEvent.click(inherited.view.getByText('Options'));
    expect(inherited.view.getByText('Unlink from previous')).toBeTruthy();
  });

  test('a press on the pages closes the options menu, although the pages cancel it', async () => {
    const { view, editor } = mountChrome(docxWithHeader());
    await act(async () => {
      editor().exec({ type: 'editHeaderFooter', position: 'header' });
    });
    fireEvent.click(view.getByText('Options'));
    const menu = () => view.container.querySelector('.docx-hf-chrome__options-menu');
    expect(menu()).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(menu()!);
    });
    expect(menu()).not.toBeNull();
    let event: PointerEvent | undefined;
    act(() => {
      event = pressCancelledPages(view.container);
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
  });

  test('close dispatches exitHeaderFooter', async () => {
    const { view, editor } = mountChrome(docxWithHeader());
    await act(async () => {
      editor().exec({ type: 'editHeaderFooter', position: 'header' });
    });
    fireEvent.click(view.getByText('Options'));
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-hf-close'));
    });
    expect(editor().getHeaderFooterState()).toBeNull();
    expect(view.queryByTestId('docx-hf-chrome')).toBeNull();
  });

  test('chrome mousedown preventDefault on buttons', async () => {
    const { view, editor } = mountChrome(docxWithHeader());
    await act(async () => {
      editor().exec({ type: 'editHeaderFooter', position: 'header' });
    });
    fireEvent.click(view.getByText('Options'));
    const close = view.getByTestId('docx-hf-close');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    let prevented = false;
    event.preventDefault = () => {
      prevented = true;
    };
    close.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  test('useHeaderFooterState keeps reference when unrelated state moves', async () => {
    const { editor } = mountChrome(docxWithHeader(), <SelectorProbe />);
    await act(async () => {
      const opened = editor().exec({ type: 'editHeaderFooter', position: 'header' });
      expect(opened.ok).toBe(true);
    });
    const first = (globalThis as unknown as { __hfProbe?: unknown }).__hfProbe;
    expect(first).not.toBeNull();
    await act(async () => {
      editor().setZoom(1.1);
    });
    const second = (globalThis as unknown as { __hfProbe?: unknown }).__hfProbe;
    expect(first).toBe(second);
  });
});
