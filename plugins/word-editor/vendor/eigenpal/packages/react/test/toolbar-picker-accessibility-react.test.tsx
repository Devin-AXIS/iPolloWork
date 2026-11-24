import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { PICKER_SOURCE } from '../../vue/test/helpers/picker-document';
import { POPUP_ESCAPE_SOURCE } from '../../vue/test/helpers/popup-escape-document';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function update(action: () => unknown = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function mount(source: Uint8Array = PICKER_SOURCE) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.FontFamily />
        <DocxEditorToolbar.StylePicker />
        <DocxEditorToolbar.Zoom />
        <DocxEditorToolbar.FontSize />
        <DocxEditorToolbar.FontColor />
        <DocxEditorToolbar.Highlight />
      </DocxEditorToolbar>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await update();
  return { ...view, editor: () => instance! };
}

afterEach(() => {
  unmount?.();
  unmount = undefined;
});
let unmount: (() => void) | undefined;

for (const slot of ['font.family', 'styles.style', 'zoom.level']) {
  test(`${slot}: named options support arrows, Escape, and focus return`, async () => {
    const view = await mount();
    unmount = view.unmount;
    const root = view.container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    expect(trigger.disabled).toBe(false);
    const visible = trigger.textContent!.replace('▾', '').trim();
    const name = trigger.getAttribute('aria-label') ?? trigger.textContent!;
    expect(name).toContain(visible);
    await update(() => {
      trigger.focus();
      trigger.click();
    });
    const list = root.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(list).not.toBeNull();
    expect(list.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.length).toBeGreaterThan(1);
    expect(options.every((option) => option.tabIndex === -1)).toBe(true);
    await update(() =>
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
    );
    expect(document.activeElement).toBe(options[0]);
    await update(() =>
      options[0]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
      )
    );
    expect(document.activeElement).toBe(options.at(-1)!);
    await update(() =>
      options
        .at(-1)!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        )
    );
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
}

test('font size links its open list and color pickers return focus on Escape', async () => {
  const view = await mount();
  unmount = view.unmount;
  const size = view.container.querySelector<HTMLInputElement>('[data-slot="font.size"] input')!;
  await update(() => size.focus());
  const list = view.container.querySelector('[data-slot="font.size"] [role="listbox"]')!;
  expect(size.getAttribute('aria-controls')).toBe(list.id);
  expect(list.id.length).toBeGreaterThan(0);
  for (const slot of ['text.color', 'text.highlight']) {
    const root = view.container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup]')!;
    await update(() => {
      trigger.focus();
      trigger.click();
    });
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    const option = dialog.querySelector<HTMLButtonElement>('button')!;
    await update(() => {
      option.focus();
      option.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await update(() => trigger.click());
    const swatch = root.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    await update(() => {
      swatch.focus();
      swatch.click();
    });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(view.container.querySelector('.docx-pages'));
  }
});

test('Escape closes a picker opened by a click while focus stays in the pages', async () => {
  const view = await mount();
  unmount = view.unmount;
  const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
  for (const slot of ['font.family', 'styles.style', 'zoom.level']) {
    const root = view.container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    // Toolbar mousedown is prevented, so the caret keeps focus in the pages.
    await update(() => {
      pages.focus();
      trigger.click();
    });
    expect(root.querySelector('[role="listbox"]')).not.toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await update(() => pages.dispatchEvent(escape));
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    // The key came from this editor, so the surface does not also act on it.
    expect(escape.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(pages);
  }
  // Escape in another field, such as a dialog or the find bar, still reaches that field.
  const field = document.createElement('input');
  view.container.append(field);
  let fieldSawEscape = false;
  field.addEventListener('keydown', () => {
    fieldSawEscape = true;
  });
  const root = view.container.querySelector<HTMLElement>('[data-slot="font.family"]')!;
  await update(() => root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click());
  expect(root.querySelector('[role="listbox"]')).not.toBeNull();
  const fieldEscape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  await update(() => {
    field.focus();
    field.dispatchEvent(fieldEscape);
  });
  expect(fieldSawEscape).toBe(true);
  // A key from outside the editor is left alone: the picker closes, the key goes on.
  expect(fieldEscape.defaultPrevented).toBe(false);
  expect(root.querySelector('[role="listbox"]')).toBeNull();
  field.remove();
});

test('Escape closes a picker before the header scope or the format painter', async () => {
  const view = await mount(POPUP_ESCAPE_SOURCE);
  unmount = view.unmount;
  const editor = view.editor;
  const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
  const root = view.container.querySelector<HTMLElement>('[data-slot="font.family"]')!;
  const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
  const escape = async (): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await update(() => pages.dispatchEvent(event));
    return event;
  };

  expect(editor().exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  await update(() => {
    pages.focus();
    trigger.click();
  });
  expect(root.querySelector('[role="listbox"]')).not.toBeNull();
  expect((await escape()).defaultPrevented).toBe(true);
  expect(root.querySelector('[role="listbox"]')).toBeNull();
  expect(editor().surface!.activeScope().kind).toBe('headerFooter');
  // With no picker open, the next Escape reaches the surface and leaves the header.
  await escape();
  expect(editor().surface!.activeScope().kind).toBe('body');

  expect(editor().surface!.formatPainter.press()).toBe(true);
  await update(() => trigger.click());
  expect(root.querySelector('[role="listbox"]')).not.toBeNull();
  await escape();
  expect(root.querySelector('[role="listbox"]')).toBeNull();
  expect(editor().surface!.formatPainter.state().mode).not.toBe('off');
  await escape();
  expect(editor().surface!.formatPainter.state().mode).toBe('off');
});

for (const slot of [
  'font.family',
  'styles.style',
  'zoom.level',
  'font.size',
  'text.color',
  'text.highlight',
]) {
  test(`${slot}: canceled surface presses dismiss the popup, and inside presses keep it open`, async () => {
    const view = await mount();
    unmount = view.unmount;
    const root = view.container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
    const trigger = root.querySelector<HTMLElement>('[aria-haspopup]')!;
    await update(() => {
      trigger.focus();
      if (slot !== 'font.size') trigger.click();
    });
    const popup = () => root.querySelector<HTMLElement>('[role="listbox"], [role="dialog"]');
    expect(popup() !== null).toBe(true);
    const item = popup()!.querySelector<HTMLElement>('button, [role="option"]')!;
    await update(() => item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(popup() !== null).toBe(true);
    const target = document.createElement('span');
    view.container.querySelector('.docx-pages')!.append(target);
    target.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    await update(() => target.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(popup() === null).toBe(true);
  });
}
