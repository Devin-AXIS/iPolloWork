// Host groups, slot replacement, hidden groups, the clamped "⋯" panel, the table-size grid
// and Add Comment in the preset toolbar.
//
// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { useContext, useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ReviewRailContext } from '../src/editor/context.ts';
import { DocxEditorToolbar as T } from '../src/editor/toolbar/index.ts';
import { en } from '@docx-editor.dev/i18n';
import { testReviewModule } from './review-test-module.ts';

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

class MockResizeObserver {
  static readonly instances: MockResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  observe(): void {}
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

beforeEach(() => {
  MockResizeObserver.instances.length = 0;
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  global.ResizeObserver = RealResizeObserver;
});

function mount(
  toolbar: ReactNode,
  options: {
    modules?: boolean;
    extra?: ReactNode;
    onReady?: (editor: DocxEditorInstance) => void;
  } = {}
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      {...(options.modules ? { modules: [testReviewModule()] } : {})}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
        options.onReady?.(instance);
      }}
    >
      {toolbar}
      {options.extra}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

/** Measure every group at `groupWidth` and the bar at `barWidth`, then flush the observer. */
async function measure(toolbar: HTMLElement, barWidth: number, groupWidth = 90): Promise<void> {
  Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => barWidth });
  for (const element of toolbar.querySelectorAll('[data-toolbar-group], [data-toolbar-fixed]')) {
    Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => groupWidth });
  }
  await act(async () => {
    for (const observer of [...MockResizeObserver.instances]) observer.flush();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** Group ids and separators of the bar, in order. */
function barShape(toolbar: HTMLElement): string[] {
  return [...toolbar.children].map((child) =>
    child.getAttribute('role') === 'separator'
      ? '|'
      : (child.getAttribute('data-toolbar-group') ??
        (child.hasAttribute('data-toolbar-fixed') ? 'fixed' : child.className))
  );
}

const t = (key: string) => (key === 'formattingBar.more' ? 'More' : key);

describe('Toolbar.Group', () => {
  test('a host group is measured, collapses, and shows its actions as labeled panel rows', async () => {
    const onSelect = mock(() => {});
    const { view } = mount(
      <T t={t}>
        <T.Group id="review-nav" label="Review navigation">
          <T.Action label="Next change" onSelect={onSelect} />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const group = toolbar.querySelector<HTMLElement>('[data-toolbar-group="review-nav"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('role')).toBe('group');
    expect(group!.getAttribute('aria-label')).toBe('Review navigation');
    // After the review group, which is the last built-in group, and before contextual chrome.
    const shape = barShape(toolbar);
    expect(shape.indexOf('review-nav')).toBe(shape.lastIndexOf('|') + 1);
    // No fixed block of loose children: only the pinned review group is fixed.
    expect(shape.filter((entry) => entry === 'fixed').length).toBe(1);

    await measure(toolbar, 420);
    // No priority: it collapses before every built-in group.
    expect(toolbar.querySelector('[data-toolbar-group="review-nav"]')).toBeNull();
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const section = panel.querySelector('[role="group"][aria-label="Review navigation"]');
    expect(section).not.toBeNull();
    const row = section!.querySelector<HTMLButtonElement>('.docx-toolbar__more-command');
    expect(row?.textContent).toContain('Next change');
    await act(async () => {
      fireEvent.click(row!);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    // The row closes the panel.
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });

  test('a priority keeps a host group in the bar longer than a built-in group', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Group id="nav" label="Nav" priority={95}>
          <T.Action label="Go" />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 300);
    expect(toolbar.querySelector('[data-toolbar-group="nav"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-toolbar-group="history"]')).toBeNull();
  });

  test('after places a host group behind the group it names', () => {
    const { view } = mount(
      <T>
        <T.Group id="mine" label="Mine" after="history">
          <T.Action label="Go" />
        </T.Group>
      </T>
    );
    const shape = barShape(view.getByTestId('docx-toolbar'));
    expect(shape.slice(0, 3)).toEqual(['history', '|', 'mine']);
  });

  test('an unknown anchor or slot id warns in development', () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      mount(
        <T>
          <T.Group id="mine" label="Mine" after="no-such-group">
            <T.Action label="Go" />
          </T.Group>
          <T.Slot slotId={'no.such' as never}>
            <span />
          </T.Slot>
        </T>
      );
    } finally {
      console.warn = original;
    }
    const messages = warn.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(messages.some((text) => text.includes('no-such-group'))).toBe(true);
    expect(messages.some((text) => text.includes('no.such'))).toBe(true);
  });

  test('a built-in id adds controls to that group, and they collapse with it', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Group id="zoom">
          <T.Action label="Fit page" />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const zoom = toolbar.querySelector('[data-toolbar-group="zoom"]')!;
    expect(zoom.querySelector('[aria-label="Fit page"]')).not.toBeNull();
    expect(zoom.querySelector('[data-slot="zoom.level"]')).not.toBeNull();
    await measure(toolbar, 760);
    expect(toolbar.querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const section = view
      .getByTestId('toolbar-overflow-panel')
      .querySelector('[aria-label="formattingBar.groups.zoom"]')!;
    expect(section.querySelector('[data-slot="zoom.level"]')).not.toBeNull();
    expect(section.textContent).toContain('Fit page');
  });

  test('hidden removes a built-in group and its separator', () => {
    const { view } = mount(
      <T>
        <T.Group id="zoom" hidden />
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    expect(toolbar.querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    expect(toolbar.querySelector('[data-slot="zoom.level"]')).toBeNull();
    expect(barShape(toolbar).join(' ')).not.toContain('| |');
  });

  test('a group whose slots are all hidden leaves no empty group or separator', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Zoom hidden />
        <T.EditingMode hidden />
        <T.Comments hidden />
        <T.Button slot="review.revisionMarkup" hidden />
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const groups = [...toolbar.querySelectorAll('.docx-toolbar__group')];
    expect(groups.every((group) => group.children.length > 0)).toBe(true);
    expect(toolbar.querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    const shape = barShape(toolbar);
    expect(shape[shape.length - 1]).not.toBe('|');
    expect(shape.join(' ')).not.toContain('| |');
    const separators = shape.filter((entry) => entry === '|').length;
    expect(separators).toBe(groups.length - 1);

    await measure(toolbar, 420);
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.querySelector('[aria-label="formattingBar.groups.zoom"]')).toBeNull();
    for (const section of panel.querySelectorAll('.docx-toolbar__more-section')) {
      expect(section.children.length).toBeGreaterThan(1);
    }
  });
});

describe('Toolbar.Slot', () => {
  test('replaces a built-in slot in place and collapses with its group', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Slot slotId="zoom.level" overflowContent={() => <span data-testid="panel-zoom" />}>
          <button type="button" data-testid="my-zoom">
            Z
          </button>
        </T.Slot>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const zoom = toolbar.querySelector('[data-toolbar-group="zoom"]')!;
    expect(zoom.querySelector('[data-testid="my-zoom"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-slot="zoom.level"]')).toBeNull();
    // Not appended: only the pinned review group is fixed.
    expect(barShape(toolbar).filter((entry) => entry === 'fixed').length).toBe(1);

    await measure(toolbar, 760);
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.querySelector('[data-testid="panel-zoom"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="my-zoom"]')).toBeNull();
  });
});

describe('shrink-wrapped toolbar', () => {
  test('groups come back when the window widens again', async () => {
    const { view } = mount(<T t={t} />);
    const toolbar = view.getByTestId('docx-toolbar');
    const parent = toolbar.parentElement!;
    parent.style.display = 'flex';
    parent.style.justifyContent = 'center';
    toolbar.style.width = 'max-content';
    toolbar.style.maxWidth = '100%';
    toolbar.style.boxSizing = 'border-box';
    (toolbar as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
      get: (property: string) => (property === 'width' ? { value: 'max-content' } : undefined),
    });
    let room = 2000;
    Object.defineProperty(parent, 'clientWidth', { configurable: true, get: () => room });
    // The bar is exactly as wide as what it shows.
    const contentWidth = () =>
      toolbar.querySelectorAll('[data-toolbar-group]').length * 90 +
      toolbar.querySelectorAll('[data-toolbar-fixed]').length * 90 +
      (toolbar.querySelector('[data-toolbar-more]') ? 34 : 0);
    Object.defineProperty(toolbar, 'clientWidth', {
      configurable: true,
      get: () => Math.min(contentWidth(), room),
    });
    Object.defineProperty(toolbar, 'offsetWidth', {
      configurable: true,
      get: () => Math.min(contentWidth(), room),
    });
    const flushGroups = async () => {
      for (const element of toolbar.querySelectorAll(
        '[data-toolbar-group], [data-toolbar-fixed]'
      )) {
        Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => 90 });
      }
      await act(async () => {
        for (const observer of [...MockResizeObserver.instances]) observer.flush();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    };
    await flushGroups();
    const all = toolbar.querySelectorAll('[data-toolbar-group]').length;
    expect(view.queryByLabelText('More')).toBeNull();

    room = 400;
    await flushGroups();
    expect(toolbar.querySelectorAll('[data-toolbar-group]').length).toBeLessThan(all);
    expect(view.getByLabelText('More')).not.toBeNull();

    room = 2000;
    await flushGroups();
    expect(toolbar.querySelectorAll('[data-toolbar-group]').length).toBe(all);
    expect(view.queryByLabelText('More')).toBeNull();
  });
});

describe('overflow panel placement', () => {
  test('stays inside a narrow viewport', async () => {
    const { view } = mount(<T t={t} />);
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 300);
    const trigger = view.getByLabelText('More');
    const root = trigger.parentElement!;
    trigger.getBoundingClientRect = () =>
      ({ left: 178, right: 212, top: 0, bottom: 34, width: 34, height: 34 }) as DOMRect;
    root.getBoundingClientRect = () =>
      ({ left: 178, right: 212, top: 0, bottom: 34, width: 34, height: 34 }) as DOMRect;
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('docx-toolbar__more-panel') ? 340 : 0;
      },
    });
    try {
      await act(async () => {
        trigger.click();
      });
      const panel = view.getByTestId('toolbar-overflow-panel');
      expect(panel.getAttribute('data-anchor')).toBe('clamped');
      // 8px from the viewport's left edge, in the trigger root's coordinates.
      expect(panel.style.left).toBe('-170px');
      expect(panel.style.maxInlineSize).toBe('374px');
    } finally {
      if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    }
  });
});

describe('review fixes', () => {
  test('a right-to-left panel keeps its clamp', async () => {
    const { view } = mount(<T t={t} />);
    const toolbar = view.getByTestId('docx-toolbar');
    toolbar.setAttribute('dir', 'rtl');
    await measure(toolbar, 300);
    const trigger = view.getByLabelText('More');
    const rect = { left: 178, right: 212, top: 0, bottom: 34, width: 34, height: 34 } as DOMRect;
    trigger.getBoundingClientRect = () => rect;
    trigger.parentElement!.getBoundingClientRect = () => rect;
    await act(async () => {
      trigger.click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    // `inset-inline-end` maps to `left` in right-to-left text and would cancel the clamp.
    expect(panel.style.getPropertyValue('inset-inline-end')).toBe('');
    expect(panel.style.left).not.toBe('');
    expect(panel.style.right).toBe('auto');
  });

  test('label renders as written, labelKey is translated, and the id is the fallback', () => {
    const { view } = mount(
      <T>
        <T.Group id="a" label="formattingBar.groups.font">
          <T.Action label="A" />
        </T.Group>
        <T.Group id="b" labelKey="formattingBar.groups.font">
          <T.Action label="B" />
        </T.Group>
        <T.Group id="c" label="Mine" labelKey="formattingBar.groups.font">
          <T.Action label="C" />
        </T.Group>
        <T.Group id="d">
          <T.Action label="D" />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const name = (id: string) =>
      toolbar.querySelector(`[data-toolbar-group="${id}"]`)!.getAttribute('aria-label');
    // A literal label is never looked up, even when it reads like a key.
    expect(name('a')).toBe('formattingBar.groups.font');
    expect(name('b')).toBe(en.formattingBar.groups.font);
    expect(name('c')).toBe('Mine');
    expect(name('d')).toBe('d');
  });

  test('a host group whose children all render nothing is dropped', () => {
    const { view } = mount(
      <T>
        <T.Group id="empty" label="Empty">
          {false}
          {null}
        </T.Group>
      </T>
    );
    expect(
      view.getByTestId('docx-toolbar').querySelector('[data-toolbar-group="empty"]')
    ).toBeNull();
  });

  test('overflowContent on a built-in group renders without children', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Group id="zoom" overflowContent={() => <span data-testid="zoom-extra" />} />
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 760);
    await act(async () => {
      view.getByLabelText('More').click();
    });
    expect(
      view.getByTestId('toolbar-overflow-panel').querySelector('[data-testid="zoom-extra"]')
    ).not.toBeNull();
  });

  test('the table grid closes the panel after an insert, and Escape closes it after a click', async () => {
    const { view, editor } = mount(
      <T t={t}>
        <T.Group id="ins" label="Insert">
          <T.TableInsert />
        </T.Group>
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 420);
    const openPanel = async () => {
      await act(async () => {
        view.getByLabelText('More').click();
      });
      return view.getByTestId('toolbar-overflow-panel');
    };
    let panel = await openPanel();
    let trigger = panel.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    await act(async () => {
      trigger.click();
    });
    // A pointer open moves focus into the grid, so its own handler sees Escape.
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell');
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(panel.querySelector('[role="grid"]')).toBeNull();

    panel = view.queryByTestId('toolbar-overflow-panel') ?? (await openPanel());
    trigger = panel.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      fireEvent.click(panel.querySelector('[data-cell="2x2"]')!);
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });
});

describe('ignored settings', () => {
  test('a built-in group warns about label, labelKey, and after, and a reserved id warns', () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      const { view } = mount(
        <T>
          <T.Group id="font" label="Fonts" labelKey="x.y" after="history" priority={95}>
            <T.Action label="F" />
          </T.Group>
          <T.Group id="contextual-table" label="Mine">
            <T.Action label="G" />
          </T.Group>
        </T>
      );
      // The group with the reserved id is dropped with its content.
      expect(view.container.querySelector('[aria-label="G"]')).toBeNull();
      expect(view.container.querySelector('[aria-label="F"]')).not.toBeNull();
    } finally {
      console.warn = original;
    }
    const messages = warn.mock.calls.map((call) => String((call as unknown[])[0]));
    for (const setting of ['label', 'labelKey', 'after']) {
      expect(
        messages.some((text) => text.includes(`"font"`) && text.includes(` ${setting} `))
      ).toBe(true);
    }
    // A priority on a built-in group is honored, so it does not warn.
    expect(messages.some((text) => text.includes('priority'))).toBe(false);
    expect(messages.some((text) => text.includes('"contextual-table"'))).toBe(true);
  });
});

describe('TableInsert', () => {
  test('focus that leaves the grid closes it', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.TableInsert />
      </T>,
      { extra: <button type="button" data-testid="elsewhere" /> }
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    await act(async () => {
      trigger.click();
    });
    const cell = view.container.querySelector<HTMLElement>('[role="gridcell"]')!;
    // Moving inside the grid keeps it open.
    await act(async () => {
      fireEvent.blur(cell, { relatedTarget: trigger });
    });
    expect(view.container.querySelector('[role="grid"]')).not.toBeNull();
    await act(async () => {
      fireEvent.blur(cell, { relatedTarget: view.getByTestId('elsewhere') });
    });
    expect(view.container.querySelector('[role="grid"]')).toBeNull();
  });

  test('the grid moves left to stay inside the viewport', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.TableInsert />
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    const root = trigger.parentElement!;
    root.getBoundingClientRect = () =>
      ({ left: window.innerWidth - 40, right: window.innerWidth - 6, width: 34 }) as DOMRect;
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('docx-toolbar__table-insert-menu') ? 200 : 0;
      },
    });
    try {
      await act(async () => {
        trigger.click();
      });
    } finally {
      if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
    }
    const popup = view.container.querySelector<HTMLElement>('.docx-toolbar__table-insert-menu')!;
    // Its right edge sits 8 px inside the viewport: 200 wide, anchored 40 px from the edge.
    expect(popup.style.left).toBe('-168px');
  });

  test('a second click on the trigger closes the grid and focuses the document', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.TableInsert />
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    const focus = mock(() => {});
    editor().focus = focus as never;
    await act(async () => {
      trigger.click();
    });
    expect(view.container.querySelector('[role="grid"]')).not.toBeNull();
    await act(async () => {
      trigger.click();
    });
    expect(view.container.querySelector('[role="grid"]')).toBeNull();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test('opens a size grid and inserts the picked size', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.TableInsert />
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    expect(trigger.getAttribute('aria-haspopup')).toBe('grid');
    await act(async () => {
      trigger.click();
    });
    const grid = view.container.querySelector('[role="grid"]')!;
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(36);
    const exec = editor().exec.bind(editor());
    const calls: unknown[] = [];
    editor().exec = ((command: unknown) => {
      calls.push(command);
      return exec(command as never);
    }) as typeof exec;
    await act(async () => {
      fireEvent.click(grid.querySelector('[data-cell="2x3"]')!);
    });
    expect(calls).toContainEqual({ type: 'insertTable', rows: 2, cols: 3 });
    expect(view.container.querySelector('[role="grid"]')).toBeNull();
  });
});

function FakeRail({ onDraft }: { onDraft: () => void }) {
  const rail = useContext(ReviewRailContext);
  useEffect(() => rail?.register(), [rail?.register]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => rail?.registerCommentDraft(onDraft), [rail, onDraft]);
  return null;
}

describe('AddComment', () => {
  const button = (view: ReturnType<typeof render>) =>
    view.container.querySelector<HTMLButtonElement>('[data-slot="review.addComment"]');

  test('with no review rail to open the draft it renders nothing', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.AddComment />
      </T>,
      {
        modules: true,
        onReady: (instance) => {
          (instance as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement =
            () => ({ anchorY: 10 });
        },
      }
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const paragraph = editor().surface!.session.paragraphIds()[0]!;
    await act(async () => {
      editor().surface!.setSelection({
        anchor: { paragraphId: paragraph, offset: 0 },
        head: { paragraphId: paragraph, offset: 5 },
      });
    });
    expect(button(view)).toBeNull();
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    expect(button(view)).toBeNull();
  });

  test('is disabled with the localized engine reason when no review module is registered', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.AddComment />
      </T>,
      { extra: <FakeRail onDraft={() => {}} /> }
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    await waitFor(() => expect(button(view)).not.toBeNull());
    expect(button(view)!.disabled).toBe(true);
    expect(button(view)!.title).not.toBe(en.formattingBar.addComment);
    expect(button(view)!.getAttribute('aria-label')).toBe(en.formattingBar.addComment);
  });

  test('requests a comment draft from the review rail, and viewing mode disables it', async () => {
    const onDraft = mock(() => {});
    const { view, editor } = mount(
      <T preset={false}>
        <T.AddComment />
      </T>,
      {
        modules: true,
        extra: <FakeRail onDraft={onDraft} />,
        // happy-dom lays nothing out, so the selection has no place on the page by itself.
        onReady: (instance) => {
          (instance as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement =
            () => ({ anchorY: 10 });
        },
      }
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const paragraph = editor().surface!.session.paragraphIds()[0]!;
    await act(async () => {
      editor().surface!.setSelection({
        anchor: { paragraphId: paragraph, offset: 0 },
        head: { paragraphId: paragraph, offset: 5 },
      });
    });
    await waitFor(() => expect(button(view)!.disabled).toBe(false));
    await act(async () => {
      button(view)!.click();
    });
    expect(onDraft).toHaveBeenCalledTimes(1);
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    await waitFor(() => expect(button(view)!.disabled).toBe(true));
    expect(button(view)!.title).toBe(en.editingMode.viewingHint);
  });
});
