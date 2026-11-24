// The Go to tab of `DocxEditor.Navigation`: Ctrl+G and the `openGoTo` command open it, the
// name box filters the document's bookmarks and moves through them with the arrow keys, Enter
// jumps and hands focus to the document, an unknown name says so in the pane, and the list
// follows the document as bookmarks come and go. Read-only documents jump too.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorNavigation } from '../src/editor/navigation/DocxEditorNavigation.tsx';
import { isGoToShortcut, returnFocus } from '../src/editor/navigation/navigation-keys.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const mark = (id: number, name: string, text: string) =>
  `<w:bookmarkStart w:id="${id}" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="${id}"/>`;

const docx = (body: string) =>
  zipSync({
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

const SOURCE = docx(
  `<w:p>${mark(1, 'Intro', 'Opening')}</w:p>` +
    `<w:p>${mark(2, 'Section10', 'Tenth')}</w:p>` +
    `<w:p>${mark(3, 'Section2', 'Second')}</w:p>` +
    `<w:p>${mark(4, '_Toc1', 'Contents')}</w:p>`
);
const NO_BOOKMARKS = docx('<w:p><w:r><w:t>Plain</w:t></w:r></w:p>');

afterEach(cleanup);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function mount(
  options: {
    mode?: 'view';
    navigation?: Parameters<typeof DocxEditorNavigation>[0];
    document?: Uint8Array;
  } = {}
) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={options.document ?? SOURCE}
      {...(options.mode ? { mode: options.mode } : {})}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorNavigation {...options.navigation} />
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { container: view.container, editor: () => instance! };
}

const q = (root: ParentNode, selector: string) => root.querySelector(selector) as HTMLElement;
const nameBox = (root: ParentNode) =>
  q(root, '#docx-nav-panel-goto input[role="combobox"]') as HTMLInputElement;
const rowNames = (root: ParentNode) =>
  [...root.querySelectorAll('#docx-nav-panel-goto [role="option"] .docx-nav__result-text')].map(
    (node) => node.textContent
  );
const message = (root: ParentNode) => q(root, '#docx-nav-panel-goto [role="status"]').textContent;

function ctrlG(target: Element) {
  const event = new KeyboardEvent('keydown', {
    key: 'g',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

async function key(input: HTMLInputElement, name: string) {
  await act(async () => {
    fireEvent.keyDown(input, { key: name });
  });
}

const selectedText = (editor: DocxEditorInstance) => {
  const { anchor, head } = editor.surface!.state().selection;
  const paragraphs = editor.surface!.session.paragraphIds();
  return `${paragraphs.indexOf(anchor.paragraphId)}:${anchor.offset}-${head.offset}`;
};

describe('Go to bookmark in the navigation pane', () => {
  test('Ctrl+G opens the pane on Go to with the name box focused', async () => {
    const { container } = mount();
    await settle();
    // From the document itself: the engine keymap sends openGoTo to the pane.
    const pages = q(container, '.docx-pages');
    pages.focus();
    expect(ctrlG(pages).defaultPrevented).toBe(true);
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('true');
    expect(q(container, '#docx-nav-tab-goto').getAttribute('aria-selected')).toBe('true');
    expect(q(container, '#docx-nav-tab-goto').getAttribute('title')).toBe(
      'Go to a bookmark (Ctrl+G)'
    );
    expect(q(container, '#docx-nav-tab-goto').getAttribute('aria-keyshortcuts')).toBe('Control+G');
    expect(document.activeElement).toBe(nameBox(container));
  });

  test('the chord is Ctrl+G elsewhere and Cmd+Option+G on macOS', () => {
    const event = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { key: 'g', ...init });
    expect(isGoToShortcut(event({ ctrlKey: true }), false)).toBe(true);
    expect(isGoToShortcut(event({ metaKey: true }), false)).toBe(false);
    expect(isGoToShortcut(event({ metaKey: true, altKey: true }), true)).toBe(true);
    // Cmd+G alone is the browser's find-next on macOS.
    expect(isGoToShortcut(event({ metaKey: true }), true)).toBe(false);
    expect(isGoToShortcut(event({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
  });

  test('closing hands focus to the document when the opener went away (a menu row)', () => {
    const disc = document.createElement('button');
    document.body.append(disc);
    let toEditor = 0;
    // A menu row that opened the pane is gone once its menu closed.
    returnFocus(document.createElement('div'), disc, () => (toEditor += 1));
    expect(toEditor).toBe(1);
    // Opened from the disc, focus goes back to the disc.
    returnFocus(null, disc, () => (toEditor += 1));
    expect(toEditor).toBe(1);
    expect(document.activeElement).toBe(disc);
    disc.remove();
  });

  test('the openGoTo command opens the tab, and a pane without the shortcut leaves Ctrl+G', async () => {
    const { container, editor } = mount({ navigation: { goToShortcut: false } });
    await settle();
    // Neither the pages (the engine keymap) nor the rest of the editor take the chord.
    expect(ctrlG(q(container, '.docx-pages')).defaultPrevented).toBe(false);
    expect(ctrlG(q(container, '.docx-editor__scroll-container')).defaultPrevented).toBe(false);
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(q(container, '#docx-nav-tab-goto').getAttribute('title')).toBeNull();
    // Opened closed, the tab reads the bookmarks once it is on screen.
    await act(async () => {
      expect(editor().exec({ type: 'openGoTo' })).toEqual({ ok: true, changed: false });
    });
    await settle();
    expect(q(container, '#docx-nav-tab-goto').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(nameBox(container));
    expect(rowNames(container)).toEqual(['Intro', 'Section2', 'Section10']);
  });

  test('lists visible bookmarks by name, numbers in order; hidden ones on request', async () => {
    const { container, editor } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    expect(rowNames(container)).toEqual(['Intro', 'Section2', 'Section10']);
    await act(async () => {
      fireEvent.click(q(container, '#docx-nav-panel-goto input[type="checkbox"]'));
    });
    expect(rowNames(container)).toEqual(['_Toc1', 'Intro', 'Section2', 'Section10']);
    expect(editor().query({ type: 'bookmarks' })).toHaveLength(4);
  });

  test('typing filters, the arrow keys move, and Enter jumps and hands focus back', async () => {
    const { container, editor } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    const input = nameBox(container);
    input.focus();
    await type(input, 'sec');
    expect(rowNames(container)).toEqual(['Section2', 'Section10']);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await key(input, 'ArrowDown');
    await key(input, 'ArrowDown');
    const active = input.getAttribute('aria-activedescendant')!;
    expect(container.querySelector(`[id="${active}"] .docx-nav__result-text`)?.textContent).toBe(
      'Section10'
    );
    await key(input, 'Enter');
    expect(selectedText(editor())).toBe('1:0-5');
    expect(input.contains(document.activeElement)).toBe(false);
    expect(document.activeElement?.closest('.docx-pages')).not.toBeNull();
  });

  test('an unknown name says so in the pane and moves nothing', async () => {
    const { container, editor } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    const before = selectedText(editor());
    const input = nameBox(container);
    await type(input, 'Nowhere');
    expect(message(container)).toBe('No bookmarks match.');
    await key(input, 'Enter');
    expect(message(container)).toBe('No bookmark is named “Nowhere”.');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(selectedText(editor())).toBe(before);
  });

  test('follows the document: a new bookmark appears, a deleted one goes', async () => {
    const { container, editor } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    await act(async () => {
      const surface = editor().surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 4 },
      });
      editor().exec({ type: 'insertBookmark', name: 'Added' });
      editor().exec({ type: 'deleteBookmark', name: 'Intro' });
    });
    await settle();
    expect(rowNames(container)).toEqual(['Added', 'Section2', 'Section10']);
  });

  test('jumps in a read-only document', async () => {
    const { container, editor } = mount({
      mode: 'view',
      navigation: { defaultOpen: true, defaultTab: 'goto' },
    });
    await settle();
    const input = nameBox(container);
    await type(input, 'section2');
    await key(input, 'Enter');
    expect(selectedText(editor())).toBe('2:0-6');
  });

  test('the highlight follows its bookmark when the rows move, and Home and End jump', async () => {
    const { container, editor } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    const input = nameBox(container);
    await key(input, 'ArrowDown');
    await key(input, 'ArrowDown');
    const highlighted = () =>
      container.querySelector(
        `[id="${input.getAttribute('aria-activedescendant')}"] .docx-nav__result-text`
      )?.textContent;
    expect(highlighted()).toBe('Section2');
    // A bookmark appears above the highlighted row; the highlight stays on Section2.
    await act(async () => {
      const surface = editor().surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 2 },
      });
      editor().exec({ type: 'insertBookmark', name: 'Above' });
    });
    await settle();
    expect(rowNames(container)).toEqual(['Above', 'Intro', 'Section2', 'Section10']);
    expect(highlighted()).toBe('Section2');
    await key(input, 'End');
    expect(highlighted()).toBe('Section10');
    await key(input, 'Home');
    expect(highlighted()).toBe('Above');
  });

  test('Enter with nothing typed asks for a name; a closed pane reads no bookmarks', async () => {
    const { container, editor } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    const input = nameBox(container);
    await key(input, 'Enter');
    expect(message(container)).toBe('Type a bookmark name, or pick one from the list.');
    expect(input.getAttribute('aria-controls')).not.toBeNull();
    await type(input, 'zzz');
    expect(input.getAttribute('aria-controls')).toBeNull();
    // Closed, the pane stops reading: a bookmark added now is listed only once it reopens.
    await act(async () => {
      fireEvent.click(q(container, '.docx-nav__close'));
    });
    let queries = 0;
    const query = editor().query.bind(editor());
    editor().query = ((command: Parameters<typeof query>[0]) => {
      if (command.type === 'bookmarks') queries += 1;
      return query(command);
    }) as typeof query;
    await act(async () => {
      editor().exec({ type: 'insertText', text: 'x' });
    });
    await settle();
    expect(queries).toBe(0);
  });

  test('Escape clears the search first, then closes the pane', async () => {
    const { container } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    const input = nameBox(container);
    input.focus();
    await type(input, 'sec');
    await key(input, 'Escape');
    expect(input.value).toBe('');
    expect(rowNames(container)).toEqual(['Intro', 'Section2', 'Section10']);
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('true');
    await key(input, 'Escape');
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
  });

  test('labels the list with its count, marks the match, and groups by place', async () => {
    const { container } = mount({ navigation: { defaultOpen: true, defaultTab: 'goto' } });
    await settle();
    expect(q(container, '.docx-nav__goto-heading').textContent).toBe('Bookmarks3');
    const input = nameBox(container);
    await type(input, 'sec');
    expect(q(container, '.docx-nav__goto-heading').textContent).toBe('Bookmarks2 of 3');
    const matches = [...container.querySelectorAll('.docx-nav__goto-match')];
    expect(matches.map((node) => node.textContent)).toEqual(['Sec', 'Sec']);
    expect(container.querySelector('.docx-nav__goto-enter')).toBeNull();
    await key(input, 'ArrowDown');
    expect(container.querySelector('.docx-nav__goto-enter')).not.toBeNull();
    await act(async () => {
      fireEvent.click(container.querySelectorAll('.docx-nav__segment-input')[1]!);
    });
    const groups = [...container.querySelectorAll('[role="listbox"] [role="group"]')];
    expect(
      groups.map((group) => group.querySelector('.docx-nav__goto-group-label')?.textContent)
    ).toEqual(['Main text']);
  });

  test('a host Go To UI with its shortcut off keeps Ctrl+G from the pane and chrome too', async () => {
    const { container, editor } = mount({ navigation: { defaultOpen: true, defaultTab: 'find' } });
    await settle();
    let opened = 0;
    await act(async () => {
      editor().setGoToChrome({ onRequest: () => (opened += 1), shortcut: false });
    });
    expect(ctrlG(q(container, '.docx-nav')).defaultPrevented).toBe(false);
    expect(ctrlG(q(container, '.docx-editor__scroll-container')).defaultPrevented).toBe(false);
    expect(opened).toBe(0);
    expect(q(container, '#docx-nav-tab-goto').getAttribute('aria-selected')).toBe('false');
  });

  test('a document without bookmarks explains how to add one', async () => {
    const { container } = mount({
      document: NO_BOOKMARKS,
      navigation: { defaultOpen: true, defaultTab: 'goto' },
    });
    await settle();
    expect(q(container, '.docx-nav__goto-empty-title').textContent).toBe(
      'This document has no bookmarks.'
    );
    expect(q(container, '.docx-nav__goto-add').textContent).toBe('Add a bookmark…');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
