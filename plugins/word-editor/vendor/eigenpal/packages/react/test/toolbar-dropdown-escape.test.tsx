import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { collaborationModule } from '../../pro/src/collaboration/collaboration-module';
import type { DocumentCollaborationHandle } from '../../pro/src/collaboration/document-session';
import { createPeerHarness } from '../../pro/src/collaboration/__tests__/document-peer-support';
import {
  DROPDOWN_SOURCE,
  DROPDOWN_SLOTS,
  MODES_SOURCE,
  POPUP_SELECTOR,
  pressEscape,
  trackDocumentKeydown,
} from '../../vue/test/helpers/dropdown-document';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
async function update(action: () => unknown = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

interface MountOptions {
  readonly room?: DocumentCollaborationHandle;
  readonly source?: Uint8Array;
}

function tree(
  options: MountOptions,
  onReady: (editor: DocxEditorInstance) => void,
  hidden = false
) {
  return (
    <DocxEditorRoot
      document={options.room?.document ?? options.source ?? DROPDOWN_SOURCE}
      modules={options.room ? [collaborationModule({ session: options.room.session })] : undefined}
      onReady={(value) => onReady(value as DocxEditorInstance)}
    >
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.Alignment hidden={hidden} />
        <DocxEditorToolbar.LineSpacing />
        <DocxEditorToolbar.TableBorderTarget hidden={hidden} />
        <DocxEditorToolbar.TableBorderStyle />
        <DocxEditorToolbar.TableBorderWidth />
      </DocxEditorToolbar>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

async function mount(options: MountOptions = {}) {
  let editor: DocxEditorInstance;
  const onReady = (value: DocxEditorInstance) => {
    editor = value;
  };
  const view = render(tree(options, onReady));
  let mounted = true;
  const unmount = () => {
    if (mounted) view.unmount();
    mounted = false;
  };
  cleanups.push(unmount);
  await update();
  // The first paragraph of the main text: a header paints before it, and selecting a header
  // paragraph opens the header.
  const paragraphId = [...view.container.querySelectorAll('[data-paragraph-id]')]
    .find((node) => !node.closest('[data-docx-hf]'))!
    .getAttribute('data-paragraph-id')!;
  const caret = { paragraphId, offset: 0 };
  await update(() => editor!.exec({ type: 'setSelection', range: { anchor: caret, head: caret } }));
  const slot = (name: string) => view.container.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  return {
    container: view.container,
    unmount,
    editor: () => editor!,
    pages: () => view.container.querySelector<HTMLElement>('.docx-pages')!,
    slot,
    trigger: (name: string) => slot(name)!.querySelector<HTMLButtonElement>('[aria-haspopup]')!,
    popup: (name: string) => slot(name)?.querySelector(POPUP_SELECTOR) ?? null,
    setHidden: (hidden: boolean) => view.rerender(tree(options, onReady, hidden)),
  };
}
type Mounted = Awaited<ReturnType<typeof mount>>;

const xml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

/** A mouse press and click on the trigger. Mousedown is guarded, so focus stays put. */
async function clickOpen(view: Mounted, name: string) {
  const trigger = view.trigger(name);
  await update(() => {
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    trigger.click();
  });
  expect(view.popup(name)).not.toBeNull();
}

test('dropdown dismissal stays local on two collaborating editor instances', async () => {
  const harness = createPeerHarness('react-dropdown-dismissal', { offlineEditing: true });
  try {
    const { alice, bob } = await harness.pair(DROPDOWN_SOURCE);
    alice.detach();
    bob.detach();
    const left = await mount({ room: alice.room });
    const right = await mount({ room: bob.room });
    const before = await xml(left.editor());
    await clickOpen(left, 'alignment');
    expect(right.trigger('alignment').getAttribute('aria-expanded')).toBe('false');
    await update(() => pressEscape(left.pages()));
    expect(left.trigger('alignment').getAttribute('aria-expanded')).toBe('false');
    expect(await xml(left.editor())).toBe(before);
    expect(await xml(right.editor())).toBe(before);
    await update(() => left.editor().exec({ type: 'insertText', text: 'Z' }));
    expect(await xml(right.editor())).toBe(await xml(left.editor()));
    expect((await xml(right.editor())).includes('ZFirst cell')).toBe(true);
    await update(() => left.editor().exec({ type: 'undo' }));
    expect(await xml(right.editor())).toBe(before);
    await update(() => left.editor().exec({ type: 'redo' }));
    expect(await xml(right.editor())).toBe(await xml(left.editor()));
  } finally {
    await update(() => {
      for (const cleanup of cleanups.splice(0)) cleanup();
    });
    harness.cleanup();
  }
});

for (const slot of DROPDOWN_SLOTS) {
  test(`${slot}: a canceled surface pointer press closes the popup before propagation stops`, async () => {
    const view = await mount();
    const before = await xml(view.editor());
    await clickOpen(view, slot);
    const inside = view.popup(slot)!.querySelector('button')!;
    await update(() => inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(view.popup(slot) !== null).toBe(true);
    const target = document.createElement('span');
    view.pages().append(target);
    target.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    await update(() => target.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(view.popup(slot) === null).toBe(true);
    expect(await xml(view.editor())).toBe(before);
  });

  test(`${slot}: Escape from the document closes the menu without moving focus or changing the document`, async () => {
    const view = await mount();
    expect(view.trigger(slot).disabled).toBe(false);
    const pages = view.pages();
    const before = await xml(view.editor());
    pages.focus();
    await clickOpen(view, slot);
    let event: KeyboardEvent | undefined;
    await update(() => {
      pages.focus();
      event = pressEscape(pages);
    });
    expect(view.popup(slot) === null).toBe(true);
    expect(event!.defaultPrevented).toBe(true);
    expect(document.activeElement === pages).toBe(true);
    expect(await xml(view.editor())).toBe(before);
    await clickOpen(view, slot);
    await update(() =>
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    );
    expect(view.popup(slot) === null).toBe(true);
  });

  test(`${slot}: Escape after a mouse open closes the menu from wherever focus is`, async () => {
    const view = await mount();
    const pages = view.pages();
    pages.focus();
    await clickOpen(view, slot);
    const focused = document.activeElement as HTMLElement;
    expect(focused === pages || view.slot(slot)!.contains(focused)).toBe(true);
    await update(() => pressEscape(focused));
    expect(view.popup(slot) === null).toBe(true);
    const after = document.activeElement;
    expect(after === pages || after === view.trigger(slot)).toBe(true);
  });

  test(`${slot}: popup Escape returns focus and composition keeps the menu open`, async () => {
    const view = await mount();
    await clickOpen(view, slot);
    const option = view.popup(slot)!.querySelector<HTMLButtonElement>('button')!;
    await update(() => {
      option.focus();
      pressEscape(option, { isComposing: true });
    });
    expect(view.popup(slot)).not.toBeNull();
    await update(() => pressEscape(option));
    expect(view.popup(slot) === null).toBe(true);
    expect(document.activeElement === view.trigger(slot)).toBe(true);
  });
}

test('composition in the document does not dismiss a dropdown', async () => {
  const view = await mount();
  await clickOpen(view, 'alignment');
  await update(() => pressEscape(view.pages(), { isComposing: true }));
  expect(view.popup('alignment')).not.toBeNull();
  await update(() => pressEscape(view.pages(), { keyCode: 229 }));
  expect(view.popup('alignment')).not.toBeNull();
  await update(() => pressEscape(view.pages()));
  expect(view.popup('alignment')).toBeNull();
});

test('host input and host dialog Escape close the dropdown and keep the host default', async () => {
  const view = await mount();
  const input = document.createElement('input');
  const dialog = document.createElement('dialog');
  const dialogButton = document.createElement('button');
  dialog.append(dialogButton);
  document.body.append(input, dialog);
  cleanups.push(() => {
    input.remove();
    dialog.remove();
  });
  const seen: string[] = [];
  input.addEventListener('keydown', () => seen.push('input'));
  dialog.addEventListener('keydown', () => seen.push('dialog'));
  for (const target of [input, dialogButton]) {
    await clickOpen(view, 'alignment');
    let event: KeyboardEvent | undefined;
    await update(() => {
      target.focus();
      event = pressEscape(target);
    });
    expect(view.popup('alignment')).toBeNull();
    expect(event!.defaultPrevented).toBe(false);
  }
  expect(seen).toEqual(['input', 'dialog']);
});

test('host controls beside the toolbar and viewport in the same container keep their Escape', async () => {
  // A bare composition: the toolbar, the viewport, and the host's own input and dialog are
  // siblings in one container, which therefore holds the pages layer too.
  const view = await mount();
  const input = document.createElement('input');
  const dialog = document.createElement('dialog');
  const dialogButton = document.createElement('button');
  dialog.append(dialogButton);
  view.container.append(input, dialog);
  expect(input.parentElement!.querySelector('.docx-pages')).not.toBeNull();
  for (const target of [input, dialogButton]) {
    await clickOpen(view, 'alignment');
    let event: KeyboardEvent | undefined;
    await update(() => {
      target.focus();
      event = pressEscape(target);
    });
    expect(view.popup('alignment')).toBeNull();
    expect(event!.defaultPrevented).toBe(false);
  }
});

test('Escape in a second editor closes the dropdown and still reaches that editor', async () => {
  const left = await mount({ source: MODES_SOURCE });
  const right = await mount({ source: MODES_SOURCE });
  await update(() => right.editor().exec({ type: 'editHeaderFooter', position: 'header' }));
  expect(right.editor().surface!.activeScope().kind).toBe('headerFooter');
  await clickOpen(left, 'alignment');
  await update(() => pressEscape(left.pages()));
  expect(left.popup('alignment')).toBeNull();
  expect(right.editor().surface!.activeScope().kind).toBe('headerFooter');
  await clickOpen(left, 'alignment');
  await update(() => pressEscape(right.pages()));
  expect(left.popup('alignment')).toBeNull();
  expect(right.editor().surface!.activeScope().kind).toBe('body');
});

const MODES: readonly {
  readonly name: string;
  readonly enter: (editor: DocxEditorInstance) => void;
  readonly active: (editor: DocxEditorInstance) => boolean;
}[] = [
  {
    name: 'header/footer',
    enter: (editor) => editor.exec({ type: 'editHeaderFooter', position: 'header' }),
    active: (editor) => editor.surface!.activeScope().kind === 'headerFooter',
  },
  {
    name: 'note',
    enter: (editor) => editor.setActiveScope({ kind: 'note', id: 'footnote:1' }),
    active: (editor) => editor.surface!.activeScope().kind === 'note',
  },
  {
    name: 'format painter',
    enter: (editor) => {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 4 },
      });
      editor.surface!.formatPainter.press();
    },
    active: (editor) => editor.surface!.formatPainter.state().mode !== 'off',
  },
];

for (const mode of MODES) {
  test(`${mode.name}: the first Escape closes the dropdown and the second leaves the mode`, async () => {
    const view = await mount({ source: MODES_SOURCE });
    await update(() => mode.enter(view.editor()));
    expect(mode.active(view.editor())).toBe(true);
    await clickOpen(view, 'alignment');
    await update(() => pressEscape(view.pages()));
    expect(view.popup('alignment')).toBeNull();
    expect(mode.active(view.editor())).toBe(true);
    await update(() => pressEscape(view.pages()));
    expect(mode.active(view.editor())).toBe(false);
  });
}

test('hiding a slot closes its open dropdown and removes its listeners', async () => {
  const view = await mount();
  const tracked = trackDocumentKeydown(document);
  try {
    await clickOpen(view, 'alignment');
    expect(tracked.listeners.size).toBe(1);
    await update(() => view.setHidden(true));
    expect(view.slot('alignment')).toBeNull();
    expect(tracked.listeners.size).toBe(0);
    await update(() => view.setHidden(false));
    expect(view.trigger('alignment').getAttribute('aria-expanded')).toBe('false');
    expect(view.popup('alignment')).toBeNull();
  } finally {
    tracked.restore();
  }
});

test('a table menu closes when the selection leaves the table', async () => {
  const view = await mount();
  const tracked = trackDocumentKeydown(document);
  try {
    await clickOpen(view, 'table.borderStyle');
    expect(tracked.listeners.size).toBe(1);
    const ids = [...view.container.querySelectorAll('[data-paragraph-id]')].map((node) =>
      node.getAttribute('data-paragraph-id')
    );
    const outside = { paragraphId: ids.at(-1)!, offset: 0 };
    const inside = { paragraphId: ids[0]!, offset: 0 };
    await update(() =>
      view.editor().exec({ type: 'setSelection', range: { anchor: outside, head: outside } })
    );
    expect(view.slot('table.borderStyle')).toBeNull();
    expect(tracked.listeners.size).toBe(0);
    await update(() =>
      view.editor().exec({ type: 'setSelection', range: { anchor: inside, head: inside } })
    );
    expect(view.trigger('table.borderStyle').getAttribute('aria-expanded')).toBe('false');
    expect(view.popup('table.borderStyle')).toBeNull();
  } finally {
    tracked.restore();
  }
});

test('close, reopen, and unmount remove all document Escape listeners', async () => {
  const view = await mount();
  const tracked = trackDocumentKeydown(document);
  try {
    await clickOpen(view, 'alignment');
    expect(tracked.listeners.size).toBe(1);
    await update(() => pressEscape(view.pages()));
    expect(tracked.listeners.size).toBe(0);
    await clickOpen(view, 'alignment');
    expect(tracked.listeners.size).toBe(1);
    await update(() => view.unmount());
    expect(tracked.listeners.size).toBe(0);
  } finally {
    tracked.restore();
  }
});
