import './dom-setup.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { strToU8, zipSync } from 'fflate';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

const source = zipSync({
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
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Public synthetic text</w:t></w:r></w:p></w:body></w:document>'
  ),
});

const platformDescriptor = Object.getOwnPropertyDescriptor(navigator, 'platform');
const agentDataDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
let hydrated: Root | undefined;
let hydrationContainer: HTMLElement | undefined;

function platform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
  Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
}

function tree(t?: (key: string) => string) {
  return (
    <DocxEditorRoot document={source}>
      <DocxEditorToolbar preset={false} overflow={false} t={t}>
        <DocxEditorToolbar.Bold />
        <DocxEditorToolbar.Link />
      </DocxEditorToolbar>
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorHyperLink />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

function link(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-slot="text.link"]');
  if (!button) throw new Error('The named link control is missing');
  return button;
}

afterEach(() => {
  if (hydrated) act(() => hydrated!.unmount());
  hydrated = undefined;
  hydrationContainer?.remove();
  hydrationContainer = undefined;
  cleanup();
  if (platformDescriptor) Object.defineProperty(navigator, 'platform', platformDescriptor);
  else Reflect.deleteProperty(navigator, 'platform');
  if (agentDataDescriptor) Object.defineProperty(navigator, 'userAgentData', agentDataDescriptor);
  else Reflect.deleteProperty(navigator, 'userAgentData');
});

test('the named link control uses the same Mac modifier as ordinary buttons', () => {
  platform('MacIntel');
  const { container } = render(tree());
  expect(container.querySelector('[data-slot="text.bold"]')!.getAttribute('title')).toBe(
    'Bold (⌘+B)'
  );
  expect(link(container).getAttribute('title')).toBe('Insert link (⌘+K)');
  expect(link(container).getAttribute('aria-label')).toBe('Insert link (⌘+K)');
});

test('the named link control keeps Ctrl on Windows', () => {
  platform('Win32');
  const { container } = render(tree());
  expect(link(container).getAttribute('title')).toBe('Insert link (Ctrl+K)');
  expect(link(container).getAttribute('aria-label')).toBe('Insert link (Ctrl+K)');
});

test('the named link control normalizes the host translation', () => {
  platform('MacIntel');
  const { container } = render(
    tree((key) => (key === 'formattingBar.insertLinkShortcut' ? 'Lien (Ctrl+K)' : key))
  );
  expect(link(container).getAttribute('title')).toBe('Lien (⌘+K)');
  expect(link(container).getAttribute('aria-label')).toBe('Lien (⌘+K)');
});

test('server markup without navigator hydrates on a Mac without mismatches', async () => {
  platform('MacIntel');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let markup: string;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
    markup = renderToString(tree());
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
  expect(markup!).toContain('aria-label="Insert link (Ctrl+K)"');
  const errors: unknown[] = [];
  hydrationContainer = document.createElement('div');
  hydrationContainer.innerHTML = markup!;
  document.body.append(hydrationContainer);
  await act(async () => {
    hydrated = hydrateRoot(hydrationContainer!, tree(), {
      onRecoverableError: (error) => errors.push(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(errors).toEqual([]);
  expect(link(hydrationContainer).getAttribute('title')).toBe('Insert link (⌘+K)');
  expect(link(hydrationContainer).getAttribute('aria-label')).toBe('Insert link (⌘+K)');
});
