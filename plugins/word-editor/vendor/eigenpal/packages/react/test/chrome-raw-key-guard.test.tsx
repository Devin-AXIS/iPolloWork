// No raw i18n key reaches the screen, on ANY chrome surface.
//
// The per-surface suites each assert this for the markup they happen to render, which is
// how a key leaked: the toolbar's OVERFLOW panel labels its value rows from the root, above
// `ToolbarContext`, and no suite scanned the panel with the catalogue fallback in play.
// This one opens every popover it can find and scans everything on screen — text nodes and
// the attributes a screen reader speaks — against the real catalogue.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { en, type Translations } from '@docx-editor.dev/i18n';
import { chromeSlotId, defaultChromeGroups } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { DocxEditorNavigation } from '../src/editor/navigation/index.ts';

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

/** Every leaf key in the shipped catalogue, dotted. */
function catalogueKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  const walk = (node: Record<string, unknown>, path: string): void => {
    for (const [key, value] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      if (value && typeof value === 'object') walk(value as Record<string, unknown>, next);
      else keys.add(next);
    }
  };
  walk(en as unknown as Record<string, unknown>, '');
  return keys;
}

/**
 * What must never be shown to a person: a catalogue key, and the OTHER identifier the
 * chrome resolves labels from. Every `label(control?.labelKey ?? slot)` site falls back
 * to a `ChromeSlotId`, which is not a catalogue key at all — so a registry entry that
 * loses its `labelKey` renders `text.bold` on the button, and a key-only scan would call
 * that clean.
 */
const KEYS = new Set<string>([
  ...catalogueKeys(),
  ...defaultChromeGroups().flatMap((group) =>
    group.controls.map((control) => chromeSlotId(group, control) as string)
  ),
]);
const SPOKEN = ['aria-label', 'title', 'placeholder', 'aria-placeholder'] as const;

/** Anything on screen that is verbatim an identifier rather than a label. */
function rawKeys(root: HTMLElement): string[] {
  const found: string[] = [];
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of SPOKEN) {
      const value = element.getAttribute(attribute)?.trim();
      if (value && KEYS.has(value)) found.push(`[${attribute}] ${value}`);
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== 3) continue;
      const text = child.textContent?.trim();
      if (text && KEYS.has(text)) found.push(`[text] ${text}`);
    }
  }
  return [...new Set(found)];
}

/** Force the bar to collapse so the "⋯" panel is part of what gets scanned. */
class CollapsingResizeObserver {
  static readonly instances: CollapsingResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    CollapsingResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  flush(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const RealResizeObserver = global.ResizeObserver;

function narrowToolbar(toolbar: HTMLElement): void {
  Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => 320 });
  for (const group of Array.from(toolbar.querySelectorAll<HTMLElement>('[data-toolbar-group]'))) {
    Object.defineProperty(group, 'offsetWidth', { configurable: true, get: () => 220 });
  }
  for (const fixed of Array.from(toolbar.querySelectorAll<HTMLElement>('[data-toolbar-fixed]'))) {
    Object.defineProperty(fixed, 'offsetWidth', { configurable: true, get: () => 60 });
  }
}

afterEach(() => {
  cleanup();
  global.ResizeObserver = RealResizeObserver;
  CollapsingResizeObserver.instances.length = 0;
});

/**
 * Open every popover on screen and scan after each. Panels are left OPEN: one of them is
 * the overflow "⋯", whose pickers only exist while it is, and a raw key on a stacked panel
 * is still a raw key on screen. Requeried per round because opening adds triggers.
 */
async function sweepPopovers(container: HTMLElement): Promise<number> {
  const opened = new Set<Element>();
  for (let round = 0; round < 4; round += 1) {
    const triggers = Array.from(
      container.querySelectorAll<HTMLElement>('[aria-haspopup]:not([disabled])')
    ).filter((trigger) => !opened.has(trigger));
    if (triggers.length === 0) break;
    for (const trigger of triggers) {
      opened.add(trigger);
      await act(async () => {
        trigger.click();
      });
      const where = trigger.getAttribute('data-slot') ?? (trigger.className || trigger.tagName);
      expect({ where, leaked: rawKeys(container) }).toEqual({ where, leaked: [] });
    }
  }
  return opened.size;
}

describe('chrome renders no raw i18n keys', () => {
  test('the full bar and its popovers, with no host `t`', async () => {
    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorMenu />
        <DocxEditorToolbar overflow={false} />
        <DocxEditorNavigation />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const container = view.container as HTMLElement;
    await act(async () => {
      await Promise.resolve();
    });

    expect(rawKeys(container)).toEqual([]);
    // Menu bar, style/font/size/line-spacing pickers, colour splits, alignment. A floor,
    // not a count: the sweep is only worth anything if it actually opened the chrome.
    expect(await sweepPopovers(container)).toBeGreaterThanOrEqual(10);
  });

  test('the collapsed bar and its overflow panel, with no host `t`', async () => {
    CollapsingResizeObserver.instances.length = 0;
    global.ResizeObserver = CollapsingResizeObserver as unknown as typeof ResizeObserver;

    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorToolbar />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const container = view.container as HTMLElement;
    await act(async () => {
      await Promise.resolve();
    });
    narrowToolbar(view.getByTestId('docx-toolbar'));
    await act(async () => {
      for (const observer of CollapsingResizeObserver.instances) observer.flush();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    // The regression this file exists for: the panel's value rows (zoom, line spacing,
    // the pickers) took their label from the raw host `t`, so with none they read as keys.
    const more = container.querySelector<HTMLElement>('.docx-toolbar__more-trigger');
    expect(more).not.toBeNull();
    await act(async () => {
      more!.click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.querySelectorAll('.docx-toolbar__more-control-label').length).toBeGreaterThan(0);
    expect(rawKeys(container)).toEqual([]);
    await sweepPopovers(container);
  });

  test('the packaged frame, including the context menu and a non-English catalogue', async () => {
    // A locale that translates almost nothing: every label it omits must fall through to
    // English, and none may fall through to the key.
    const de = { _lang: 'de', formattingBar: { boldShortcut: 'Fett (Strg+B)' } } as Translations;
    const view = render(<DocxEditor document={SOURCE} title="doc.docx" i18n={de} />);
    const container = view.container as HTMLElement;
    await act(async () => {
      await Promise.resolve();
    });

    expect(rawKeys(container)).toEqual([]);
    expect(await sweepPopovers(container)).toBeGreaterThanOrEqual(10);

    const pages = container.querySelector<HTMLElement>('[data-testid="docx-editor-scroll"]');
    expect(pages).not.toBeNull();
    await act(async () => {
      fireEvent.contextMenu(pages!, { clientX: 40, clientY: 40 });
    });
    // Vacuous otherwise: the scan proves nothing about a menu that never opened.
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(rawKeys(container)).toEqual([]);
  });
});
