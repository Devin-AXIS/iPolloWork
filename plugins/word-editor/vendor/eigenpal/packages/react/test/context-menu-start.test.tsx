// `ContextMenu.Start`: host rows that render above the packaged rows, against the real engine.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';
import { differentialDocx } from './cross-adapter-shared.ts';

const t = (key: string): string => key;

afterEach(cleanup);

function openMenu(menu: ReactNode): HTMLElement {
  const view = render(
    <DocxEditorRoot document={differentialDocx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>')}>
      <DocxEditorViewport>
        <DocxEditorContent />
        {menu}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface');
  if (!surface) throw new Error('no painted surface');
  act(() => {
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  return view.container;
}

function rowsOf(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll(
      '.docx-contextmenu [role="menuitem"], .docx-contextmenu [role="separator"]'
    ),
  ].map((row) => (row.getAttribute('role') === 'separator' ? '---' : (row.textContent ?? '')));
}

test('rows inside Start render above the default set', () => {
  const rows = rowsOf(
    openMenu(
      <ContextMenu t={t}>
        <ContextMenu.Item label="Freeze paragraph" onSelect={() => {}} />
        <ContextMenu.Start>
          <ContextMenu.Item label="receive" onSelect={() => {}} />
          <ContextMenu.Item label="relieve" onSelect={() => {}} />
        </ContextMenu.Start>
      </ContextMenu>
    )
  );
  expect(rows.slice(0, 2)).toEqual(['receive', 'relieve']);
  expect(rows.at(-1)).toContain('Freeze paragraph');
});

test('Start ends with a separator before the default set', () => {
  const rows = rowsOf(
    openMenu(
      <ContextMenu t={t}>
        <ContextMenu.Start>
          <ContextMenu.Item label="receive" onSelect={() => {}} />
        </ContextMenu.Start>
      </ContextMenu>
    )
  );
  expect(rows.slice(0, 2)).toEqual(['receive', '---']);
});

test('Start inside a Fragment still renders above the default set', () => {
  const rows = rowsOf(
    openMenu(
      <ContextMenu t={t}>
        <>
          <ContextMenu.Start>
            <ContextMenu.Item label="receive" onSelect={() => {}} />
          </ContextMenu.Start>
        </>
      </ContextMenu>
    )
  );
  expect(rows[0]).toBe('receive');
});

test('preset={false} keeps Start where it is written', () => {
  const rows = rowsOf(
    openMenu(
      <ContextMenu t={t} preset={false}>
        <ContextMenu.Item label="first" onSelect={() => {}} />
        <ContextMenu.Start>
          <ContextMenu.Item label="second" onSelect={() => {}} />
        </ContextMenu.Start>
      </ContextMenu>
    )
  );
  expect(rows.filter((row) => row !== '---')).toEqual(['first', 'second']);
});

test('every Start in a Fragment moves up, and the Fragment rows beside it stay below', () => {
  const original = console.error;
  const errors: string[] = [];
  console.error = (message: unknown) => {
    errors.push(String(message));
  };
  let rows: string[] = [];
  try {
    rows = rowsOf(
      openMenu(
        <ContextMenu t={t}>
          <>
            <ContextMenu.Start>
              <ContextMenu.Item label="first" onSelect={() => {}} />
            </ContextMenu.Start>
            <ContextMenu.Item label="tail" onSelect={() => {}} />
            <>
              <ContextMenu.Start>
                <ContextMenu.Item label="second" onSelect={() => {}} />
              </ContextMenu.Start>
            </>
          </>
        </ContextMenu>
      )
    );
  } finally {
    console.error = original;
  }
  expect(rows.slice(0, 4)).toEqual(['first', '---', 'second', '---']);
  expect(rows.at(-1)).toBe('tail');
  // Rows taken out of two Fragment levels keep distinct React keys.
  expect(errors.some((text) => text.includes('same key'))).toBe(false);
});

test('the Start separator is a direct child of the panel, where the edge rule hides it', () => {
  const container = openMenu(
    <ContextMenu t={t}>
      <ContextMenu.Start>{null}</ContextMenu.Start>
    </ContextMenu>
  );
  const first = container.querySelector('.docx-contextmenu')?.firstElementChild;
  expect(first?.classList.contains('docx-toolbar__menu-separator')).toBe(true);
});

function warningsDuring(run: () => void): string[] {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (message: unknown) => {
    messages.push(String(message));
  };
  try {
    run();
  } finally {
    console.warn = original;
  }
  return messages;
}

function Suggestions() {
  return (
    <ContextMenu.Start>
      <ContextMenu.Item label="suggestion" onSelect={() => {}} />
    </ContextMenu.Start>
  );
}

test('a Start that a component returns warns, and a Start the menu hoists does not', () => {
  const notDirect = (text: string) => text.includes('not a direct child of ContextMenu');
  const quiet = warningsDuring(() => {
    openMenu(
      <ContextMenu t={t}>
        <ContextMenu.Start>
          <Suggestions />
        </ContextMenu.Start>
      </ContextMenu>
    );
    cleanup();
    openMenu(
      <ContextMenu t={t} preset={false}>
        <Suggestions />
      </ContextMenu>
    );
    cleanup();
  });
  expect(quiet.some(notDirect)).toBe(false);
  let rows: string[] = [];
  const loud = warningsDuring(() => {
    rows = rowsOf(
      openMenu(
        <ContextMenu t={t}>
          <Suggestions />
        </ContextMenu>
      )
    );
  });
  expect(loud.some(notDirect)).toBe(true);
  expect(rows.at(-2)).toBe('suggestion');
});

test('a packaged row inside Start warns that it renders twice', () => {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (message: unknown) => {
    messages.push(String(message));
  };
  try {
    openMenu(
      <ContextMenu t={t}>
        <ContextMenu.Start>
          <ContextMenu.Copy />
        </ContextMenu.Start>
      </ContextMenu>
    );
  } finally {
    console.warn = original;
  }
  expect(
    messages.some((text) => text.includes('"edit.copy"') && text.includes('ContextMenu.Start'))
  ).toBe(true);
});

test('a separator at either edge of the panel, or after another, is hidden', () => {
  const css = readFileSync(new URL('../../core/src/styles/editor.css', import.meta.url), 'utf8');
  const separator = '.docx-contextmenu > .docx-toolbar__menu-separator';
  const rule =
    css.match(
      /\.docx-contextmenu > \.docx-toolbar__menu-separator:first-child[^{]*\{[^}]+\}/
    )?.[0] ?? '';
  expect(rule).toContain(`${separator}:last-child`);
  expect(rule).toContain(`${separator} + .docx-toolbar__menu-separator`);
  expect(rule).toContain('display: none');
});
