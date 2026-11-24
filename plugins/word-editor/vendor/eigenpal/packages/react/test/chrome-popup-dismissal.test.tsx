// Every toolbar and menu popup follows one dismissal rule: Escape from this editor closes it
// and stops there, Escape from a host input closes it and keeps its default, and focus that
// moves to another control closes it.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { testReviewModule } from './review-test-module.ts';
import { strToU8, zipSync } from 'fflate';
import { POPUP_ESCAPE_SOURCE } from '../../vue/test/helpers/popup-escape-document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** One paragraph with a tracked insertion, so the reviewers menu has an author to list. */
const TRACKED_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">Body </w:t></w:r>` +
      '<w:ins w:id="1" w:author="Ada" w:date="2026-01-02T03:04:05Z"><w:r><w:t>text</w:t></w:r></w:ins>' +
      '</w:p></w:body></w:document>'
  ),
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  cleanup();
  for (const host of hosts.splice(0)) host.remove();
});

function mount(chrome: ReactNode, source: Uint8Array = POPUP_ESCAPE_SOURCE) {
  const view = render(
    <DocxEditorRoot document={source} modules={[testReviewModule()]}>
      {chrome}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const host = document.createElement('input');
  document.body.append(host);
  hosts.push(host);
  return { view, host, pages: () => view.container.querySelector<HTMLElement>('.docx-pages')! };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function escape(target: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function press(trigger: HTMLElement) {
  act(() => {
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    trigger.click();
  });
}

describe('the menu bar', () => {
  const menuOpen = (container: HTMLElement) =>
    container.querySelector('.docx-menubar__trigger[aria-expanded="true"]') !== null;

  test('Escape from the pages closes it and stops there', async () => {
    const { view, pages } = mount(<DocxEditorMenu />);
    await settle();
    press(view.container.querySelector<HTMLElement>('.docx-menubar__trigger')!);
    expect(menuOpen(view.container)).toBe(true);
    expect(escape(pages()).defaultPrevented).toBe(true);
    expect(menuOpen(view.container)).toBe(false);
  });

  test('Escape from a host input closes it and keeps its default', async () => {
    const { view, host } = mount(<DocxEditorMenu />);
    await settle();
    press(view.container.querySelector<HTMLElement>('.docx-menubar__trigger')!);
    expect(escape(host).defaultPrevented).toBe(false);
    expect(menuOpen(view.container)).toBe(false);
  });

  test('focus that moves to another control closes it', async () => {
    const { view, host } = mount(<DocxEditorMenu />);
    await settle();
    press(view.container.querySelector<HTMLElement>('.docx-menubar__trigger')!);
    act(() => {
      host.focus();
    });
    expect(menuOpen(view.container)).toBe(false);
  });
});

describe('the reviewers menu', () => {
  const trigger = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-slot="review.authors"] [aria-haspopup]')!;

  test('Escape from the pages closes it and stops there', async () => {
    const { view, pages } = mount(
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.Reviewers />
      </DocxEditorToolbar>,
      TRACKED_SOURCE
    );
    await settle();
    press(trigger(view.container));
    expect(trigger(view.container).getAttribute('aria-expanded')).toBe('true');
    expect(escape(pages()).defaultPrevented).toBe(true);
    expect(trigger(view.container).getAttribute('aria-expanded')).toBe('false');
  });

  test('Escape from a host input closes it and keeps its default', async () => {
    const { view, host } = mount(
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.Reviewers />
      </DocxEditorToolbar>,
      TRACKED_SOURCE
    );
    await settle();
    press(trigger(view.container));
    expect(escape(host).defaultPrevented).toBe(false);
    expect(trigger(view.container).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a picker', () => {
  test('focus that moves to another control closes it, then Escape reaches that control', async () => {
    const { view, host } = mount(
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.FontFamily />
      </DocxEditorToolbar>
    );
    await settle();
    const trigger = view.container.querySelector<HTMLElement>(
      '[data-slot="font.family"] [aria-haspopup]'
    )!;
    press(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      host.focus();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(escape(host).defaultPrevented).toBe(false);
  });
});

describe('a picker behind a host modal', () => {
  test("focus that moves into a host's modal dialog closes the picker", async () => {
    const { view } = mount(
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.FontFamily />
      </DocxEditorToolbar>
    );
    await settle();
    const trigger = view.container.querySelector<HTMLElement>(
      '[data-slot="font.family"] [aria-haspopup]'
    )!;
    press(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    hosts.push(dialog);
    act(() => {
      field.focus();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
