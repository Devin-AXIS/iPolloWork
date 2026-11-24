// The editing-mode pill when suggesting cannot be entered (#692).
//
// Suggesting needs an author. The pill is how a reader reaches Viewing too, so a refused
// suggesting disables the one menu item, with the engine's reason localized, rather than
// the whole control — and keyboard travel through the menu skips the refused item.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { en } from '@docx-editor.dev/i18n';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { testReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>`
  ),
});

afterEach(() => {
  cleanup();
});

function SuggestingCommandProbe() {
  const state = useEditorCommand({ type: 'setEditingMode', mode: 'suggesting' });
  return <button data-testid="suggesting-command" disabled={!state.isEnabled} />;
}

function mountToolbar(author?: string): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      modules={[testReviewModule()]}
      {...(author === undefined ? {} : { author })}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar />
      <SuggestingCommandProbe />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return {
    view,
    editor: () => {
      if (!instance) throw new Error('editor not ready');
      return instance;
    },
  };
}

function item(view: ReturnType<typeof render>, mode: string): HTMLButtonElement {
  return view.container.querySelector<HTMLButtonElement>(`[data-testid="editing-mode-${mode}"]`)!;
}

describe('the editing-mode pill without an author', () => {
  test('stays live, refuses only the Suggesting item, and still reaches Viewing', async () => {
    const { view, editor } = mountToolbar();
    const trigger = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="editing-mode-trigger"]'
    )!;
    expect(trigger.disabled).toBe(false);
    await act(async () => {
      trigger.click();
    });
    expect(item(view, 'suggesting').disabled).toBe(true);
    expect(item(view, 'suggesting').title).toBe(en.disabledReason.suggestingNeedsAuthor);
    expect(item(view, 'viewing').disabled).toBe(false);
    expect(item(view, 'viewing').title).toBe('');
    await act(async () => {
      item(view, 'viewing').click();
    });
    expect(editor().getEditingMode()).toBe('viewing');
  });

  test('keyboard travel skips the refused item', async () => {
    const { view } = mountToolbar();
    await act(async () => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="editing-mode-trigger"]')!
        .click();
    });
    const menu = view.container.querySelector<HTMLElement>('[data-testid="editing-mode-menu"]')!;
    expect(document.activeElement).toBe(item(view, 'editing'));
    await act(async () => {
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(item(view, 'viewing'));
  });

  test('focus lands on an enabled item when the current mode is the refused one', async () => {
    const { view, editor } = mountToolbar('Grace Hopper');
    await act(async () => {
      editor().setEditingMode('suggesting');
    });
    await act(async () => {
      editor().setAuthor(undefined);
    });
    await act(async () => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="editing-mode-trigger"]')!
        .click();
    });
    expect(item(view, 'suggesting').disabled).toBe(true);
    expect(document.activeElement).toBe(item(view, 'editing'));
  });

  test('an author arriving while the menu is open enables the Suggesting item', async () => {
    const { view, editor } = mountToolbar();
    await act(async () => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="editing-mode-trigger"]')!
        .click();
    });
    expect(item(view, 'suggesting').disabled).toBe(true);
    // The store notification is deferred, like every other slice's.
    await act(async () => {
      editor().setAuthor('Grace Hopper');
    });
    expect(item(view, 'suggesting').disabled).toBe(false);
    expect(item(view, 'suggesting').title).toBe('');
  });

  test('shared command hooks update when only the author changes', async () => {
    const { view, editor } = mountToolbar();
    const probe = () =>
      view.container.querySelector<HTMLButtonElement>('[data-testid="suggesting-command"]')!;
    expect(probe().disabled).toBe(true);
    await act(async () => {
      editor().setAuthor('Ada');
    });
    expect(probe().disabled).toBe(false);
    await act(async () => {
      editor().setAuthor(undefined);
    });
    expect(probe().disabled).toBe(true);
  });

  test('an author arriving enables the Suggesting item', async () => {
    const { view, editor } = mountToolbar();
    await act(async () => {
      editor().setAuthor('Grace Hopper');
    });
    await act(async () => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="editing-mode-trigger"]')!
        .click();
    });
    expect(item(view, 'suggesting').disabled).toBe(false);
    await act(async () => {
      item(view, 'suggesting').click();
    });
    expect(editor().getEditingMode()).toBe('suggesting');
  });
});
