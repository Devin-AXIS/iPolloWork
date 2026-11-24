// `colorMode` on `DocxEditor.Root`: the composed parts carry `.dark` beside `.docx-editor`.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { DocxEditorWindow } from '../src/editor/DocxEditorWindow.tsx';
import { useEditorColorMode, useScopeClassName } from '../src/index.ts';

type Listener = (event: { matches: boolean }) => void;

/** A controllable `(prefers-color-scheme: dark)` query. */
const media = {
  matches: false,
  listeners: new Set<Listener>(),
  set(matches: boolean) {
    media.matches = matches;
    for (const listener of media.listeners) listener({ matches });
  },
};

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  media.matches = false;
  media.listeners.clear();
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    get matches() {
      return media.matches;
    },
    addEventListener: (_type: string, listener: Listener) => media.listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => media.listeners.delete(listener),
  });
});

afterEach(() => {
  cleanup();
  (window as unknown as { matchMedia: unknown }).matchMedia = realMatchMedia;
});

function tree(colorMode?: 'light' | 'dark' | 'system') {
  return (
    <DocxEditorRoot {...(colorMode ? { colorMode } : {})}>
      <DocxEditorMenu />
      <DocxEditorToolbar />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

function parts(container: HTMLElement): HTMLElement[] {
  return [
    container.querySelector<HTMLElement>('.docx-menubar')!,
    container.querySelector<HTMLElement>('[data-testid="docx-toolbar"]')!,
    container.querySelector<HTMLElement>('[data-testid="docx-editor-scroll"]')!,
  ];
}

describe('DocxEditor.Root colorMode', () => {
  test("'dark' puts .dark on every self-scoped part", () => {
    const { container } = render(tree('dark'));
    for (const element of parts(container)) {
      expect(element.classList.contains('docx-editor')).toBe(true);
      expect(element.classList.contains('dark')).toBe(true);
    }
  });

  test("omitted and 'light' keep the light chrome", () => {
    const { container, rerender } = render(tree());
    for (const element of parts(container)) expect(element.classList.contains('dark')).toBe(false);
    rerender(tree('light'));
    for (const element of parts(container)) expect(element.classList.contains('dark')).toBe(false);
  });

  test('a changed colorMode applies without a remount', () => {
    const { container, rerender } = render(tree('light'));
    const toolbar = parts(container)[1]!;
    rerender(tree('dark'));
    expect(parts(container)[1]).toBe(toolbar);
    expect(toolbar.classList.contains('dark')).toBe(true);
  });

  test("'system' follows the OS setting as it changes", () => {
    media.matches = true;
    const { container } = render(tree('system'));
    for (const element of parts(container)) expect(element.classList.contains('dark')).toBe(true);
    act(() => media.set(false));
    for (const element of parts(container)) expect(element.classList.contains('dark')).toBe(false);
    act(() => media.set(true));
    for (const element of parts(container)) expect(element.classList.contains('dark')).toBe(true);
  });

  test("leaving 'system' stops following the OS setting", () => {
    media.matches = true;
    const { rerender } = render(tree('system'));
    expect(media.listeners.size).toBeGreaterThan(0);
    rerender(tree('light'));
    expect(media.listeners.size).toBe(0);
  });

  test("a pop-out window's editor root follows Root's colorMode", async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const view = frame.contentWindow as Window & typeof globalThis;
    const original = window.open;
    window.open = (() => view) as typeof window.open;
    try {
      render(
        <DocxEditorRoot colorMode="dark">
          <DocxEditorWindow open>
            <p data-testid="panel">panel</p>
          </DocxEditorWindow>
        </DocxEditorRoot>
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      const panel = view.document.querySelector('[data-testid="panel"]');
      expect(panel?.closest('.docx-editor')?.classList.contains('dark')).toBe(true);
    } finally {
      // Unmount while the window still exists; the portal lives in its document.
      cleanup();
      window.open = original;
      frame.remove();
    }
  });

  test('useEditorColorMode reports the resolved theme to host parts', () => {
    function Probe() {
      return <output data-testid="theme">{useEditorColorMode().colorMode}</output>;
    }
    const theme = (container: HTMLElement) =>
      container.querySelector('[data-testid="theme"]')?.textContent;
    // Outside a Root there is no theme to follow: light.
    const outside = render(<Probe />);
    expect(theme(outside.container)).toBe('light');
    cleanup();

    const probe = (mode?: 'light' | 'dark' | 'system') => (
      <DocxEditorRoot {...(mode ? { colorMode: mode } : {})}>
        <Probe />
      </DocxEditorRoot>
    );
    const { container, rerender } = render(probe());
    expect(theme(container)).toBe('light');
    rerender(probe('dark'));
    expect(theme(container)).toBe('dark');
    rerender(probe('system'));
    expect(theme(container)).toBe('light');
    act(() => media.set(true));
    expect(theme(container)).toBe('dark');
  });

  test('useScopeClassName adds dark under a dark Root', () => {
    function Part() {
      return <div data-testid="part" className={`${useScopeClassName()}my-part`} />;
    }
    const part = (container: HTMLElement) =>
      container.querySelector('[data-testid="part"]')!.className;
    const { container, rerender } = render(
      <DocxEditorRoot>
        <Part />
      </DocxEditorRoot>
    );
    expect(part(container)).toBe('docx-editor my-part');
    rerender(
      <DocxEditorRoot colorMode="dark">
        <Part />
      </DocxEditorRoot>
    );
    expect(part(container)).toBe('docx-editor dark my-part');
  });
});
