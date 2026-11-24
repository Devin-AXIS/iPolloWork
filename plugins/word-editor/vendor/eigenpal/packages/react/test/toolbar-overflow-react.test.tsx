// Responsive toolbar overflow: measured one-row collapse, More dialog, and opt-outs.
//
// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { LocaleProvider } from '../src/i18n/index.ts';
import { en, type Translations } from '@docx-editor.dev/i18n';
import { POPUP_ESCAPE_SOURCE } from '../../vue/test/helpers/popup-escape-document';

/** Every leaf key in the shipped catalogue, dotted. */
const catalogueKeys = new Set<string>(
  (function walk(node: Record<string, unknown>, path: string, out: string[]): string[] {
    for (const [key, value] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      if (value && typeof value === 'object') walk(value as Record<string, unknown>, next, out);
      else out.push(next);
    }
    return out;
  })(en as unknown as Record<string, unknown>, '', [])
);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

const SOURCE_WITH_TABLE = docx(
  '<w:p><w:r><w:t>outside table</w:t></w:r></w:p>' +
    '<w:tbl><w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>inside table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
);

/** Shared ResizeObserver harness for overflow measurement tests in this file only. */
class MockResizeObserver {
  static readonly instances: MockResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;
  readonly observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    const index = MockResizeObserver.instances.indexOf(this);
    if (index >= 0) MockResizeObserver.instances.splice(index, 1);
  }

  flush(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const RealResizeObserver = global.ResizeObserver;

/** Same selector as `focusFirstInteractive` in ToolbarOverflow.tsx. */
const OVERFLOW_FIRST_INTERACTIVE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function installResizeObserverMock(): void {
  MockResizeObserver.instances.length = 0;
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

function mockBarGeometry(
  toolbar: HTMLElement,
  options: { barWidth: number; groupWidth: number; fixedWidth?: number }
): void {
  toolbar.style.width = `${options.barWidth}px`;
  toolbar.style.boxSizing = 'border-box';
  Object.defineProperty(toolbar, 'clientWidth', {
    configurable: true,
    get: () => options.barWidth,
  });
  for (const group of toolbar.querySelectorAll('[data-toolbar-group]')) {
    const width = options.groupWidth;
    Object.defineProperty(group, 'offsetWidth', { configurable: true, get: () => width });
  }
  for (const fixed of toolbar.querySelectorAll('[data-toolbar-fixed]')) {
    const width = options.fixedWidth ?? options.groupWidth;
    Object.defineProperty(fixed, 'offsetWidth', { configurable: true, get: () => width });
  }
  const separator = toolbar.querySelector('.docx-toolbar__separator');
  if (separator) {
    Object.defineProperty(separator, 'offsetWidth', { configurable: true, get: () => 1 });
  }
}

async function collapseToolbar(
  view: ReturnType<typeof render>,
  options: { barWidth: number; groupWidth?: number; fixedWidth?: number } = {
    barWidth: 280,
    groupWidth: 90,
    fixedWidth: 140,
  }
): Promise<HTMLElement> {
  const toolbar = view.getByTestId('docx-toolbar');
  mockBarGeometry(toolbar, {
    barWidth: options.barWidth,
    groupWidth: options.groupWidth ?? 90,
    fixedWidth: options.fixedWidth ?? 140,
  });
  await act(async () => {
    for (const observer of MockResizeObserver.instances) observer.flush();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
  return toolbar;
}

function mountToolbar(
  toolbar: ReactNode,
  source: Uint8Array = SOURCE
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {toolbar}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

beforeEach(() => {
  MockResizeObserver.instances.length = 0;
});

afterEach(() => {
  cleanup();
  global.ResizeObserver = RealResizeObserver;
});

describe('toolbar overflow integration', () => {
  test('overflow={false} keeps wrapping and does not measure', () => {
    const { view } = mountToolbar(<DocxEditorToolbar overflow={false} />);
    const toolbar = view.getByTestId('docx-toolbar');
    expect(toolbar.hasAttribute('data-overflow')).toBe(false);
    expect(view.queryByLabelText('formattingBar.more')).toBeNull();
    expect(MockResizeObserver.instances.length).toBe(0);
  });

  test('preset={false} renders verbatim markup without group wrappers or measurement', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold />
        <DocxEditorToolbar.Undo />
      </DocxEditorToolbar>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    expect(toolbar.querySelector('.docx-toolbar__group')).toBeNull();
    expect(toolbar.hasAttribute('data-overflow')).toBe(false);
    expect(MockResizeObserver.instances.length).toBe(0);
  });

  test('collapses groups into More in collapse order and keeps review pinned', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    const toolbar = await collapseToolbar(view, { barWidth: 360 });

    expect(
      MockResizeObserver.instances.some((observer) =>
        observer.observed.some((element) => element.hasAttribute('data-toolbar-fixed'))
      )
    ).toBe(true);
    expect(toolbar.querySelector('[data-slot="zoom.level"]')).toBeNull();
    expect(toolbar.querySelector('[data-slot="review.comments"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-slot="review.editingMode"]')).not.toBeNull();

    const trigger = view.getByLabelText('More');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      trigger.click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.hasAttribute('aria-modal')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel.querySelector('[data-slot="zoom.level"]')).not.toBeNull();
    expect(
      panel.querySelector('[role="group"][aria-label="formattingBar.groups.zoom"]')
    ).not.toBeNull();
    expect(panel.querySelector('[role="menuitem"]')).toBeNull();
    expect(panel.querySelector('.docx-toolbar__more-command')).not.toBeNull();
  });

  test('collapses contextual table chrome before ordinary formatting groups', async () => {
    installResizeObserverMock();
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)}>
        <>
          <DocxEditorToolbar.TableBorderStyle hidden />
        </>
      </DocxEditorToolbar>,
      SOURCE_WITH_TABLE
    );
    await waitFor(() => {
      expect(editor().surface).not.toBeNull();
    });

    const toolbar = view.getByTestId('docx-toolbar');
    const contextual = toolbar.querySelector<HTMLElement>('.docx-toolbar__contextual');
    expect(contextual).not.toBeNull();
    expect(contextual!.getAttribute('data-toolbar-group')).toBe('contextual-table');
    expect(contextual!.hasAttribute('data-toolbar-fixed')).toBe(false);
    expect(contextual!.children.length).toBe(0);
    expect(
      MockResizeObserver.instances.some((observer) => observer.observed.includes(contextual!))
    ).toBe(true);

    toolbar.style.width = '600px';
    toolbar.style.boxSizing = 'border-box';
    Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => 600 });
    for (const group of toolbar.querySelectorAll<HTMLElement>('[data-toolbar-group]')) {
      Object.defineProperty(group, 'offsetWidth', {
        configurable: true,
        get: () => (group === contextual && group.children.length > 0 ? 220 : 40),
      });
    }
    for (const fixed of toolbar.querySelectorAll<HTMLElement>('[data-toolbar-fixed]')) {
      Object.defineProperty(fixed, 'offsetWidth', { configurable: true, get: () => 40 });
    }
    const separator = toolbar.querySelector<HTMLElement>('.docx-toolbar__separator');
    if (separator) {
      Object.defineProperty(separator, 'offsetWidth', { configurable: true, get: () => 1 });
    }

    await act(async () => {
      for (const observer of MockResizeObserver.instances) observer.flush();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(view.queryByLabelText('More')).toBeNull();

    const tableParagraphId = editor().surface!.session.paragraphIds()[1]!;
    await act(async () => {
      editor().surface!.setSelection({
        anchor: { paragraphId: tableParagraphId, offset: 1 },
        head: { paragraphId: tableParagraphId, offset: 1 },
      });
    });
    expect(contextual!.querySelector('[data-slot="table.borderTarget"]')).not.toBeNull();

    await act(async () => {
      // Force ordinary groups into More as well. Table must still be the first section so
      // opening its nested picker cannot strand it below a reset scroll position.
      Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => 320 });
      for (const observer of MockResizeObserver.instances) observer.flush();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const trigger = view.getByLabelText('More');
    expect(toolbar.querySelector('[data-slot="text.color"]')).not.toBeNull();
    expect(toolbar.querySelector('.docx-toolbar__contextual')).toBeNull();

    await act(async () => {
      trigger.click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const overflowSections = panel.querySelectorAll<HTMLElement>('.docx-toolbar__more-section');
    expect(overflowSections.length).toBeGreaterThan(1);
    expect(overflowSections[0]!.getAttribute('aria-label')).toBe('formattingBar.groups.table');
    const tableSection = overflowSections[0]!;
    expect(panel.querySelector('[data-slot="table.borderTarget"]')).not.toBeNull();
    expect(panel.querySelector('[data-slot="table.borderStyle"]')).toBeNull();
    // The four pickers and Split cells draw as controls; Merge cells is an ordinary row.
    expect(tableSection.querySelectorAll('.docx-toolbar__more-control').length).toBe(5);
    expect(tableSection.querySelector('[data-slot="table.mergeCells"]')).not.toBeNull();
    expect(panel.querySelector('[data-slot="text.color"]')).toBeNull();

    await act(async () => {
      panel.querySelector<HTMLButtonElement>('[data-slot="table.borderTarget"] button')!.click();
    });
    expect(panel.querySelector('.docx-table-chrome__panel')).not.toBeNull();
    expect(view.getByTestId('toolbar-overflow-panel')).toBe(panel);

    const outsideParagraphId = editor().surface!.session.paragraphIds()[0]!;
    await act(async () => {
      Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => 600 });
      editor().surface!.setSelection({
        anchor: { paragraphId: outsideParagraphId, offset: 1 },
        head: { paragraphId: outsideParagraphId, offset: 1 },
      });
    });
    await waitFor(() => {
      expect(view.queryByLabelText('More')).toBeNull();
    });
    const restored = toolbar.querySelector<HTMLElement>('.docx-toolbar__contextual');
    expect(restored).not.toBeNull();
    expect(restored!.children.length).toBe(0);
  });

  test('value rows in the panel label from the catalogue, and a provider localizes them', async () => {
    installResizeObserverMock();
    // No host `t`: the value rows (zoom, line spacing, pickers) resolved to raw keys while
    // every command row beside them read as English.
    const { view } = mountToolbar(<DocxEditorToolbar />);
    await collapseToolbar(view, { barWidth: 360 });

    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const labels = Array.from(panel.querySelectorAll('.docx-toolbar__more-control-label')).map(
      (node) => node.textContent
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain('Zoom');
    // No label IS a catalogue key. Asserted against the real catalogue rather than
    // "contains no dot", which would false-fail on the first label ending in a period.
    for (const text of labels) expect(catalogueKeys.has(text ?? '')).toBe(false);
    cleanup();

    const de = { _lang: 'de', formattingBar: { groups: { zoom: 'Zoomen' } } } as Translations;
    const localized = mountToolbar(
      <LocaleProvider i18n={de}>
        <DocxEditorToolbar />
      </LocaleProvider>
    ).view;
    await collapseToolbar(localized, { barWidth: 360 });
    await act(async () => {
      localized.getByLabelText('More').click();
    });
    const localizedLabels = Array.from(
      localized
        .getByTestId('toolbar-overflow-panel')
        .querySelectorAll('.docx-toolbar__more-control-label')
    ).map((node) => node.textContent);
    expect(localizedLabels).toContain('Zoomen');
    // A key the locale leaves out falls through to English, not to the raw key.
    expect(localizedLabels).toContain('Line spacing');
  });

  test('More dialog closes on Escape, outside click, and command selection', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await collapseToolbar(view, { barWidth: 280 });

    const trigger = view.getByLabelText('More') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(view.getByTestId('toolbar-overflow-panel'), { key: 'Escape' });
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      fireEvent.pointerDown(document.body, { bubbles: true });
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();

    // Escape from outside the editor closes the panel and leaves the key alone.
    await act(async () => {
      trigger.click();
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();
    const outside = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.body.dispatchEvent(outside);
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
    expect(outside.defaultPrevented).toBe(false);

    // An open nested popup inside the panel takes the Escape, and the panel stays open.
    await act(async () => {
      trigger.click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const nested = document.createElement('div');
    nested.setAttribute('role', 'menu');
    panel.append(nested);
    const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
    await act(async () => {
      pages.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();
    nested.remove();
  });

  test('a dropdown inside More takes the first Escape, and the panel the second', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await collapseToolbar(view, { barWidth: 280 });
    await act(async () => {
      (view.getByLabelText('More') as HTMLButtonElement).click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const dropdown = panel.querySelector<HTMLButtonElement>(
      '[data-slot="alignment"] [aria-haspopup]'
    );
    expect(dropdown).not.toBeNull();
    await act(async () => {
      dropdown!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      dropdown!.click();
    });
    expect(dropdown!.getAttribute('aria-expanded')).toBe('true');
    const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
    const escape = async () => {
      await act(async () => {
        pages.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
      });
    };
    await escape();
    expect(dropdown!.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();
    await escape();
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });

  test('More stays open behind the paragraph dialog it opened, and focus comes back', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await collapseToolbar(view, { barWidth: 280 });
    await act(async () => {
      (view.getByLabelText('More') as HTMLButtonElement).click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const trigger = panel.querySelector<HTMLButtonElement>(
      '[data-slot="list.lineSpacing"] [aria-haspopup]'
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.click();
    });
    const options = panel.querySelector<HTMLButtonElement>('[data-slot="paragraph.dialog"]');
    expect(options).not.toBeNull();
    await act(async () => {
      options!.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const dialog = document.querySelector<HTMLElement>('[data-docx-dialog="paragraph"]');
    expect(dialog).not.toBeNull();
    // Focus entering the modal dialog does not close More, so the opener stays mounted.
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();
    await act(async () => {
      dialog!.dispatchEvent(new Event('cancel', { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.querySelector('[data-docx-dialog="paragraph"]')).toBeNull();
    expect(trigger!.isConnected).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  test('More closes when focus moves to a control outside it', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await collapseToolbar(view, { barWidth: 280 });
    await act(async () => {
      (view.getByLabelText('More') as HTMLButtonElement).click();
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();
    const host = document.createElement('input');
    document.body.append(host);
    try {
      await act(async () => {
        host.focus();
      });
      expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
    } finally {
      host.remove();
    }
  });

  test('Escape closes the More dialog before the header scope or the format painter', async () => {
    installResizeObserverMock();
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />,
      POPUP_ESCAPE_SOURCE
    );
    await collapseToolbar(view, { barWidth: 280 });
    const trigger = view.getByLabelText('More') as HTMLButtonElement;
    const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
    const escape = async (): Promise<KeyboardEvent> => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        pages.dispatchEvent(event);
      });
      return event;
    };

    expect(editor().exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    await act(async () => {
      pages.focus();
      trigger.click();
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();
    expect((await escape()).defaultPrevented).toBe(true);
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
    expect(editor().surface!.activeScope().kind).toBe('headerFooter');
    // With nothing open, the next Escape reaches the surface and leaves the header.
    await escape();
    expect(editor().surface!.activeScope().kind).toBe('body');

    expect(editor().surface!.formatPainter.press()).toBe(true);
    expect(editor().surface!.formatPainter.state().mode).not.toBe('off');
    await act(async () => {
      trigger.click();
    });
    await escape();
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
    expect(editor().surface!.formatPainter.state().mode).not.toBe('off');
    await escape();
    expect(editor().surface!.formatPainter.state().mode).toBe('off');
  });

  test('a command in the overflow dialog executes through shared engine state', async () => {
    installResizeObserverMock();
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await waitFor(() => {
      expect(editor().surface).not.toBeNull();
    });
    await act(async () => {
      editor().surface!.selectAll();
    });

    const toolbar = await collapseToolbar(view, { barWidth: 240 });

    const trigger = view.getByLabelText('More');
    expect(toolbar.querySelector('[data-slot="text.bold"]')).toBeNull();
    await act(async () => {
      trigger.click();
    });

    const bold = view.container.querySelector(
      '[data-testid="toolbar-overflow-panel"] [data-slot="text.bold"]'
    ) as HTMLButtonElement;
    expect(bold.className).toContain('docx-toolbar__more-command');
    expect(bold.getAttribute('role')).toBeNull();
    expect(bold.disabled).toBe(false);

    await act(async () => {
      bold.click();
    });
    expect(editor().snapshot().formatting?.bold).toBe(true);
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });

  test('controls leave one at a time from the end of a group, and More holds exactly those', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    const toolbar = view.getByTestId('docx-toolbar');
    // Before any measurement the full bar renders: record each group's controls.
    const full = new Map<string, string[]>();
    for (const group of toolbar.querySelectorAll<HTMLElement>('[data-toolbar-group]')) {
      const items = [...group.querySelectorAll<HTMLElement>(':scope > [data-toolbar-item]')];
      full.set(
        group.getAttribute('data-toolbar-group')!,
        items.map((item) => item.getAttribute('data-toolbar-item')!)
      );
    }
    // 30 px per control, no gaps (no stylesheet here), a 1 px separator, 100 px fixed.
    for (const item of toolbar.querySelectorAll<HTMLElement>('[data-toolbar-item]')) {
      Object.defineProperty(item, 'offsetWidth', { configurable: true, get: () => 30 });
    }
    for (const group of toolbar.querySelectorAll<HTMLElement>('[data-toolbar-group]')) {
      // As wide as the controls it still draws, as in a browser.
      Object.defineProperty(group, 'offsetWidth', {
        configurable: true,
        get: () => group.querySelectorAll(':scope > [data-toolbar-item]').length * 30,
      });
    }
    for (const fixed of toolbar.querySelectorAll<HTMLElement>('[data-toolbar-fixed]')) {
      Object.defineProperty(fixed, 'offsetWidth', { configurable: true, get: () => 100 });
    }
    const separator = toolbar.querySelector<HTMLElement>('.docx-toolbar__separator')!;
    Object.defineProperty(separator, 'offsetWidth', { configurable: true, get: () => 1 });
    let total = 100;
    for (const items of full.values()) total += items.length * 30 + 1;
    // Zoom leaves first (31 px) and the 34 px trigger arrives: 10 px less than that needs
    // one more control from the next group, not the whole group.
    const barWidth = total - 31 + 34 - 10;
    Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => barWidth });
    await act(async () => {
      for (const observer of MockResizeObserver.instances) observer.flush();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    const hidden: string[] = [];
    const partial: string[] = [];
    for (const [id, items] of full) {
      const group = toolbar.querySelector<HTMLElement>(`[data-toolbar-group="${id}"]`);
      const shown = group
        ? [...group.querySelectorAll<HTMLElement>(':scope > [data-toolbar-item]')].map(
            (item) => item.getAttribute('data-toolbar-item')!
          )
        : [];
      // What stays is a prefix of the group, in bar order.
      expect(shown).toEqual(items.slice(0, shown.length));
      hidden.push(...items.slice(shown.length));
      if (shown.length > 0 && shown.length < items.length) partial.push(id);
    }
    expect(hidden[0]).toBe('zoom.level');
    expect(hidden.length).toBe(2);
    expect(partial.length).toBe(1);
    // A separator stands only between drawn groups.
    for (const rule of toolbar.querySelectorAll('.docx-toolbar__separator')) {
      expect(rule.previousElementSibling?.hasAttribute('data-toolbar-group') ||
        rule.previousElementSibling?.hasAttribute('data-toolbar-fixed')).toBe(true);
    }

    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const inPanel = [...panel.querySelectorAll<HTMLElement>('[data-slot]')].map((element) =>
      element.getAttribute('data-slot')
    );
    expect(inPanel).toEqual(hidden);
    const sections = [...panel.querySelectorAll('.docx-toolbar__more-section')].map((section) =>
      section.getAttribute('aria-label')
    );
    expect(sections).toEqual(['formattingBar.groups.zoom', `formattingBar.groups.${partial[0]}`]);
  });

  test('hidden override is absent when its group collapses into More', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)}>
        <DocxEditorToolbar.Strike hidden />
      </DocxEditorToolbar>
    );
    await collapseToolbar(view, { barWidth: 240 });

    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.querySelector('[data-slot="text.strike"]')).toBeNull();
    expect(panel.querySelector('[aria-label="formattingBar.strikethrough"]')).toBeNull();
  });

  test('ArrowDown on the trigger opens the dialog and focuses the first control', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await collapseToolbar(view, { barWidth: 280 });

    const trigger = view.getByLabelText('More') as HTMLButtonElement;
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    });

    const panel = view.getByTestId('toolbar-overflow-panel');
    const firstControl = panel.querySelector<HTMLElement>(OVERFLOW_FIRST_INTERACTIVE);
    expect(firstControl).not.toBeNull();
    await waitFor(() => {
      const active = document.activeElement;
      expect(active).not.toBeNull();
      expect(active).not.toBe(trigger);
      expect(panel.contains(active)).toBe(true);
      expect(active instanceof HTMLElement && active.matches(OVERFLOW_FIRST_INTERACTIVE)).toBe(
        true
      );
      expect(
        Array.from(panel.querySelectorAll<HTMLElement>(OVERFLOW_FIRST_INTERACTIVE)).indexOf(
          active as HTMLElement
        )
      ).toBe(0);
    });
  });

  test('ArrowDown inside a value control is not hijacked by the dialog', async () => {
    installResizeObserverMock();
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await waitFor(() => {
      expect(view.container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    });
    await act(async () => {
      editor().surface!.selectAll();
    });
    await collapseToolbar(view, { barWidth: 200, groupWidth: 100, fixedWidth: 160 });

    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const fontTrigger = panel.querySelector(
      '.docx-toolbar__font-family-trigger'
    ) as HTMLButtonElement;
    expect(fontTrigger).not.toBeNull();
    fontTrigger.focus();

    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault = () => {
        defaultPrevented = true;
      };
      fontTrigger.dispatchEvent(event);
    });
    expect(defaultPrevented).toBe(false);
  });

  test('the overflow panel uses viewport-bounded logical sizing', () => {
    const css = readFileSync(new URL('../../core/src/styles/editor.css', import.meta.url), 'utf8');
    const rule = css.match(/\.docx-toolbar__more-panel\s*\{[^}]+\}/)?.[0] ?? '';
    expect(rule).toContain('box-sizing: border-box');
    expect(rule).toContain('inline-size: min(340px, calc(100vw - 16px))');
    expect(rule).toContain('min-inline-size: min(260px, calc(100vw - 16px))');
    expect(rule).toContain('max-height: min(72vh, 560px)');
  });

  test('More keeps every nested picker visible on small screens', () => {
    const coreCss = readFileSync(
      new URL('../../core/src/styles/editor.css', import.meta.url),
      'utf8'
    );
    const zoomRule =
      coreCss.match(
        /\.docx-toolbar__more-panel:has\(\.docx-toolbar__zoom-menu\)\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(zoomRule).toContain('overflow-y: visible');

    const pickerHatch =
      coreCss.match(
        /\.docx-toolbar__more-panel:has\(\.docx-toolbar__font-family-content\),\s*\.docx-toolbar__more-panel:has\(\.docx-toolbar__style-content\)\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(pickerHatch).toContain('overflow-y: visible');

    const tablePickerContainment =
      coreCss.match(
        /\.docx-toolbar__more-panel:has\(\.docx-table-chrome__panel\)\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(tablePickerContainment).toContain('overflow-y: auto');
    expect(tablePickerContainment).not.toContain('overflow-y: visible');

    const fontSizeRule =
      coreCss.match(/\.docx-toolbar__more-panel \.docx-toolbar__font-size-menu\s*\{[^}]+\}/)?.[0] ??
      '';
    expect(fontSizeRule).toContain('inset-inline-end: 0');
    expect(fontSizeRule).toContain('inset-inline-start: auto');

    const pickerEdgeRule =
      coreCss.match(
        /\.docx-toolbar__more-panel \.docx-toolbar__font-family-content,\s*\.docx-toolbar__more-panel \.docx-toolbar__style-content\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(pickerEdgeRule).toContain('inset-inline-end: 0');
    expect(pickerEdgeRule).toContain('inset-inline-start: auto');

    const lowerMenuRule =
      coreCss.match(
        /\.docx-toolbar__more-panel \.docx-toolbar__alignment-popup,\s*\.docx-toolbar__more-panel \.docx-toolbar__line-spacing-menu\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(lowerMenuRule).toContain('top: auto');
    expect(lowerMenuRule).toContain('inset-inline-end: 0');
    expect(lowerMenuRule).toContain('bottom: 100%');
    expect(lowerMenuRule).toContain('inset-inline-start: auto');

    const tableMenuRule =
      coreCss.match(/\.docx-toolbar__more-panel \.docx-table-chrome__panel\s*\{[^}]+\}/)?.[0] ?? '';
    expect(tableMenuRule).toContain('inset-inline-end: 0');
    expect(tableMenuRule).toContain('inset-inline-start: auto');
    expect(tableMenuRule).not.toContain('top: auto');
    expect(tableMenuRule).not.toContain('bottom: 100%');

    const demoCss = readFileSync(
      new URL('../../../examples/vite/src/styles.css', import.meta.url),
      'utf8'
    );
    const mobileToolbarRule =
      demoCss.match(
        /@media \(max-width: 768px\)\s*\{[\s\S]*?\.docx-editor \[role='toolbar'\]\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(mobileToolbarRule).not.toContain('overflow');
  });
});

describe('toolbar parts outside the More panel', () => {
  test('Toolbar.Button takes slotId, and the deprecated slot still works with a warning', () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      const { view } = mountToolbar(
        <DocxEditorToolbar preset={false} overflow={false}>
          <DocxEditorToolbar.Button slotId="format.painter" />
          <DocxEditorToolbar.Button slot="history.undo" />
        </DocxEditorToolbar>
      );
      expect(view.container.querySelector('button[data-slot="format.painter"]')).not.toBeNull();
      expect(view.container.querySelector('button[data-slot="history.undo"]')).not.toBeNull();
      const messages = warn.mock.calls.map((call) => String((call as unknown[])[0]));
      expect(messages.some((text) => text.includes('slot="history.undo"'))).toBe(true);
      expect(messages.some((text) => text.includes('slot="format.painter"'))).toBe(false);
    } finally {
      console.warn = original;
    }
  });

  test('Escape from a host input closes the editing-mode menu and keeps its default', () => {
    const { view } = mountToolbar(<DocxEditorToolbar />);
    const host = document.createElement('input');
    document.body.append(host);
    try {
      const trigger = view.container.querySelector<HTMLButtonElement>(
        '[data-testid="editing-mode-trigger"]'
      )!;
      act(() => {
        trigger.click();
      });
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        host.dispatchEvent(escape);
      });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(escape.defaultPrevented).toBe(false);
    } finally {
      host.remove();
    }
  });
});
