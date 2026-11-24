// The compound menu bar (registry-derived default + in-place overrides + the rows whose
// dispatch is not a command).
//
// Against the REAL engine, like toolbar-composition.test.tsx: a mounted document, painted
// pages, committed ops. What these pin down: the bar IS `CHROME_MENUS` in registry order
// (derived here too, so a registry change updates the expectation); one panel open at a
// time; that a menu child REPLACES its menu in place and `hidden` removes it;
// `preset={false}` verbatim rendering; that a WIRED row commits through the engine and
// closes the bar; that an UNWIRED row renders present-and-disabled carrying the ENGINE's
// reason rather than an adapter paraphrase; that open/save fall back to packaged
// behaviour and honour a host override; and the caret-preserving mousedown contract.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { MenuParagraphDialog } from '../src/editor/menu/parts';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import {
  CHROME_MENUS,
  runToolbarCommand,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { createT, en, type TranslationKey, type Translations } from '@docx-editor.dev/i18n';
import { LocaleProvider } from '../src/i18n/index.ts';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { pressCancelledPages } from './cancelled-press.ts';

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

/** The bar's menus, DERIVED from the registry exactly as the component derives them. */
const EXPECTED_MENUS: readonly string[] = CHROME_MENUS.map((menu) => menu.id);

function mountMenu(
  menu: ReactNode,
  source: Uint8Array = SOURCE,
  mode: 'edit' | 'view' = 'edit'
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      mode={mode}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {menu}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function bar(view: ReturnType<typeof render>): HTMLElement {
  return view.getByTestId('docx-menubar');
}

/** The bar's menu identities, in order. */
function menuIds(element: HTMLElement): string[] {
  return [...element.children].map(
    (child) => child.getAttribute('data-menu') ?? child.getAttribute('data-testid') ?? 'other'
  );
}

/** Bare parts resolve labels through the locale catalogue; tests address them by key. */
const label = createT(en);

/** Open one menu by its i18n key — matched against the catalogue label it renders. */
function openMenu(view: ReturnType<typeof render>, labelKey: string): void {
  const text = label(labelKey as TranslationKey);
  const match = [...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger')] //
    .find((button) => button.textContent === text);
  if (!match) throw new Error(`no trigger labelled ${text}`);
  act(() => {
    fireEvent.click(match);
  });
}

/** Reveal a submenu's panel — the parent opens on hover, as it does for a pointer. */
function openSubmenu(view: ReturnType<typeof render>, labelKey: string): void {
  const text = label(labelKey as TranslationKey);
  const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')] //
    .find((element) => element.textContent?.includes(text));
  if (!parent) throw new Error(`no submenu labelled ${text}`);
  act(() => {
    fireEvent.mouseEnter(parent);
  });
}

function row(view: ReturnType<typeof render>, slot: string): HTMLButtonElement {
  const element = view.container.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`);
  if (!element) throw new Error(`no row for ${slot}`);
  return element;
}

afterEach(() => {
  cleanup();
});

describe('a row whose state is more than pressed-or-not', () => {
  test('the format painter reports its mode as data-value, and reads as pressed', () => {
    const { view, editor } = mountMenu(<DocxEditorMenu />);
    act(() => {
      editor().exec({ type: 'selectAll' });
      runToolbarCommand(editor(), 'format.painter');
      runToolbarCommand(editor(), 'format.painter');
    });
    openMenu(view, 'toolbar.format');
    const painter = row(view, 'format.painter');
    // `aria-checked` because the row TOGGLES, which no single command describes — the rule
    // is the engine's (`chromeSlotIsToggle`). `data-value` because armed and locked are both
    // pressed and only one of them ends by itself; the stylesheet keys the locked treatment
    // on it, and `MenuRow` renders only the props it declares, so an undeclared attribute
    // reaches the DOM in neither adapter.
    expect(painter.getAttribute('aria-checked')).toBe('true');
    expect(painter.getAttribute('data-value')).toBe('locked');
  });
});

describe('the default bar', () => {
  test('renders every registry menu, in registry order', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    expect(menuIds(bar(view))).toEqual([...EXPECTED_MENUS]);
    // Closed: a panel exists only while its menu is open.
    expect(view.container.querySelectorAll('.docx-menubar__menu').length).toBe(0);
  });

  test('one panel at a time — opening a second menu closes the first', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);
    expect(row(view, 'file.open')).toBeDefined();

    openMenu(view, 'toolbar.insert');
    expect(view.container.querySelector('[data-slot="file.open"]')).toBeNull();
    expect(row(view, 'insert.footnote')).toBeDefined();

    // A second click on the open menu's trigger closes it.
    openMenu(view, 'toolbar.insert');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  test('the File menu is Open · Save · Print · Page setup', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    const slots = [...view.container.querySelectorAll('[role="menu"] [data-slot]')].map((element) =>
      element.getAttribute('data-slot')
    );
    expect(slots).toEqual(['file.open', 'file.save', 'file.print', 'file.pageSetup']);
    expect(view.container.textContent).toContain(label('toolbar.print' as TranslationKey));
  });

  test('a menu child overrides its menu IN PLACE; `hidden` removes it', () => {
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Help hidden />
        <DocxEditorMenu.File className="custom-file" />
      </DocxEditorMenu>
    );
    // Same order, File still in first position, Help gone.
    expect(menuIds(bar(view))).toEqual(['file', 'format', 'insert', 'review']);
    expect(view.container.querySelector('.custom-file')).not.toBeNull();
  });

  test('`preset={false}` renders children verbatim', () => {
    const { view } = mountMenu(
      <DocxEditorMenu preset={false}>
        <DocxEditorMenu.Insert />
      </DocxEditorMenu>
    );
    expect(menuIds(bar(view))).toEqual(['insert']);
  });
});

describe('rows carry the engine, not a paraphrase', () => {
  test('a WIRED row commits through the engine and closes the bar', async () => {
    const { view, editor } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    const before = editor().snapshot().page.total;

    openMenu(view, 'toolbar.insert');
    // Page break lives in the Break submenu, which opens under the pointer.
    openSubmenu(view, 'toolbar.break');
    const pageBreak = row(view, 'insert.pageBreak');
    expect(pageBreak.getAttribute('aria-disabled')).toBeNull();
    act(() => {
      fireEvent.click(pageBreak);
    });

    // A hard page break really paginates: the document grew a page, and the edit is on
    // the undo stack. Asserting the OUTCOME, not that a handler ran.
    expect(editor().snapshot().page.total).toBe(before + 1);
    expect(editor().snapshot().canUndo).toBe(true);
    // Selecting a row closes the bar.
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  test('the table of contents row is enabled and inserts through the engine', async () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.insert');

    const toc = row(view, 'insert.toc');
    expect(toc.disabled).toBe(false);
    expect(toc.getAttribute('aria-disabled')).toBeNull();
    expect(toc.textContent).toContain(label('toolbar.tableOfContents' as TranslationKey));
    act(() => {
      fireEvent.click(toc);
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);

    // Same inside the submenu: Word's three break choices are three live rows.
    openMenu(view, 'toolbar.insert');
    openSubmenu(view, 'toolbar.break');
    expect(row(view, 'insert.sectionBreakContinuous').getAttribute('aria-disabled')).toBeNull();
    expect(row(view, 'insert.sectionBreakNextPage').getAttribute('aria-disabled')).toBeNull();
  });

  test('a probeable row follows the ENGINE, not a chrome guess', async () => {
    // `table.insert` has a real command shape, so the engine judges it — and now that the
    // engine authors tables the probe answers yes, which is what turns the row into a live
    // size grid with no registry edit. The row a probe still refuses keeps quoting the
    // engine's own words.
    const { view } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.insert');
    // Enabled, so the row discloses a grid rather than rendering as a flat refused row.
    expect(view.container.querySelector('[data-slot="table.insert"]')).toBeNull();
    openSubmenu(view, 'toolbar.table');
    expect(view.container.querySelector('.docx-menubar__grid')).not.toBeNull();

    // And the same probe REFUSED renders the row flat and disabled, carrying the engine's
    // own words rather than a chrome paraphrase. View mode is the refusal here.
    cleanup();
    const viewing = mountMenu(<DocxEditorMenu />, SOURCE, 'view').view;
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(viewing, 'toolbar.insert');
    // No grid this time: a refused probe collapses the picker back to a flat row.
    expect(viewing.container.querySelector('.docx-menubar__grid')).toBeNull();
    const refusedTable = row(viewing, 'table.insert');
    expect(refusedTable.getAttribute('aria-disabled')).toBe('true');
    expect(refusedTable.getAttribute('title')).toBeTruthy();
  });

  test('Open and Save work with no configuration at all', async () => {
    // The packaged defaults: a picker into `Editor.load`, and `Editor.save()` into a
    // download. Both need only an editor, so neither row waits on a host prop.
    const { view } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.file');
    expect(row(view, 'file.open').getAttribute('aria-disabled')).toBeNull();
    expect(row(view, 'file.save').getAttribute('aria-disabled')).toBeNull();
    expect(row(view, 'file.pageSetup').getAttribute('aria-disabled')).toBeNull();
    // The shortcut column is filled from the registry's keys.
    expect(row(view, 'file.save').textContent).toContain(
      label('toolbar.saveShortcut' as TranslationKey)
    );
  });

  test('a host `onSave` replaces the packaged download', async () => {
    let saved = 0;
    const { view } = mountMenu(<DocxEditorMenu onSave={() => (saved += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.file');
    act(() => {
      fireEvent.click(row(view, 'file.save'));
    });
    expect(saved).toBe(1);
  });

  test('a host `onOpen` replaces the packaged file picker', async () => {
    let opened = 0;
    const { view } = mountMenu(<DocxEditorMenu onOpen={() => (opened += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.file');
    act(() => {
      fireEvent.click(row(view, 'file.open'));
    });
    expect(opened).toBe(1);
  });

  test('the packaged Open loads the file and reports its name through `onOpenFile`', async () => {
    const seen: string[] = [];
    const { view, editor } = mountMenu(
      <DocxEditorMenu onOpenFile={(file) => seen.push(file.name)} />
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Scoped by `accept`: the menu also mounts the image-insert picker, and picking whichever
    // file input came first fed a .docx to the image signature check once that landed.
    const input = view.container.querySelector('input[type="file"][accept*=".docx"]');
    expect(input).not.toBeNull();
    const file = new File([docx('<w:p><w:r><w:t>reopened</w:t></w:r></w:p>')], 'contract-v2.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      // `file.arrayBuffer()` resolves on a later microtask; give the load a turn to land.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(seen).toEqual(['contract-v2.docx']);
    expect(editor().surface!.session.bodyText()).toBe('reopened');
  });
});

describe('chrome contracts', () => {
  test('mousedown on the bar is prevented, so the caret does not move', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    bar(view).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('LocaleProvider localizes a bare composed menu', () => {
    // The bug the catalogue fallback fixed: composed chrome ignored `LocaleProvider`
    // entirely, so the documented i18n path silently did nothing for it.
    const de = { _lang: 'de', toolbar: { file: 'Datei' } } as Translations;
    const { view } = mountMenu(
      <LocaleProvider i18n={de}>
        <DocxEditorMenu />
      </LocaleProvider>
    );
    expect(view.container.textContent).toContain('Datei');
    expect(view.container.textContent).not.toContain('toolbar.file');
    // A key the locale leaves out falls through to English, not to the raw key.
    expect(view.container.textContent).toContain('Insert');
  });

  test('the bar self-emits the docx-editor styling scope', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    expect(bar(view).classList.contains('docx-editor')).toBe(true);
  });

  test('labels resolve through `t`, and fall back to the CATALOGUE, never to the key', () => {
    const { view } = mountMenu(<DocxEditorMenu t={(key) => `[${key}]`} />);
    expect(view.container.textContent).toContain('[toolbar.file]');
    expect(view.container.textContent).toContain('[toolbar.insert]');

    // A bare part matches `<DocxEditor>`'s own default — legible with zero configuration.
    // A RAW KEY on screen is the bug this pins against, in both directions.
    cleanup();
    const bare = mountMenu(<DocxEditorMenu />);
    expect(bare.view.container.textContent).toContain(label('toolbar.file' as TranslationKey));
    expect(bare.view.container.textContent).not.toContain('toolbar.file');
  });

  test('`<DocxEditor>` mounts the bar by default, and `menu={false}` removes it', () => {
    const withMenu = render(<DocxEditor document={SOURCE} />);
    expect(withMenu.queryByTestId('docx-menubar')).not.toBeNull();
    // Packaged chrome resolves labels through the bundled catalogue, not the raw key.
    expect(withMenu.container.textContent).toContain('Insert');
    cleanup();

    const without = render(<DocxEditor document={SOURCE} menu={false} />);
    expect(without.queryByTestId('docx-menubar')).toBeNull();
    // The toolbar is untouched by the menu toggle.
    expect(without.queryByTestId('docx-toolbar')).not.toBeNull();
  });

  test('a press on the pages closes the open menu, although the pages cancel it', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);
    let event: PointerEvent | undefined;
    act(() => {
      event = pressCancelledPages(view.container);
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  test('hovering to a different trigger then clicking it KEEPS that menu open', () => {
    // The bar tracks the pointer once something is open, so by the time the click lands
    // the state already says "open" — a plain toggle closed the menu the user had just
    // clicked on, which reads as the bar closing on them.
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    const insert = [...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger')] //
      .find((button) => button.textContent === label('toolbar.insert' as TranslationKey))!;
    act(() => {
      fireEvent.mouseEnter(insert);
    });
    expect(insert.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      fireEvent.click(insert);
    });
    expect(insert.getAttribute('aria-expanded')).toBe('true');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);

    // A click on the menu that is ALREADY open still closes it.
    act(() => {
      fireEvent.click(insert);
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  test('clicking a submenu parent the pointer already opened keeps it open', () => {
    // Same class of bug one level down: `onMouseEnter` opened the panel, so a toggling
    // click closed it — and no further mouseEnter fires while the pointer sits still.
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.insert');
    openSubmenu(view, 'toolbar.break');
    expect(row(view, 'insert.pageBreak')).toBeDefined();
    const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')] //
      .find((element) => element.textContent?.includes(label('toolbar.break' as TranslationKey)))!;
    act(() => {
      fireEvent.click(parent.querySelector('button')!);
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).not.toBeNull();
  });

  test('a submenu opened by keyboard focus closes when focus leaves it', () => {
    // `onMouseLeave` cannot fire for a pointer that never arrived, so a tab-opened panel
    // used to float over the rows below it until the whole bar closed.
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.insert');
    const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')] //
      .find((element) => element.textContent?.includes(label('toolbar.break' as TranslationKey)))!;
    act(() => {
      fireEvent.focus(parent.querySelector('button')!);
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).not.toBeNull();
    act(() => {
      fireEvent.blur(parent.querySelector('button')!, { relatedTarget: document.body });
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).toBeNull();
  });

  test('Ctrl/Cmd+S is scoped to this editor, not to the whole document', async () => {
    let saved = 0;
    const { view } = mountMenu(<DocxEditorMenu onSave={() => (saved += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });

    // A field elsewhere on the host page: outside the editor root entirely.
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    act(() => {
      fireEvent.keyDown(outside, { key: 's', ctrlKey: true });
    });
    expect(saved).toBe(0);

    // Inside the editor, the shortcut works.
    act(() => {
      fireEvent.keyDown(bar(view), { key: 's', ctrlKey: true });
    });
    expect(saved).toBe(1);
    outside.remove();
  });

  test('Ctrl/Cmd+S fires with focus in the DOCUMENT, not only on the bar', async () => {
    // The regression this pins: the menubar self-emits `.docx-editor` (styling scope), so a
    // naive closest('.docx-editor') resolves to the bar itself and a keypress from the
    // painted pages — the normal case — falls outside the containment test, handing
    // Cmd+S back to the browser. The scope must be the instance container.
    let saved = 0;
    const view = render(<DocxEditor document={SOURCE} onSave={() => (saved += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });
    const pages = view.container.querySelector('.docx-pages')!;
    expect(pages).not.toBeNull();
    act(() => {
      fireEvent.keyDown(pages, { key: 's', ctrlKey: true });
    });
    expect(saved).toBe(1);
  });

  test('Help › Report issue is addressable: `reportIssue={false}` drops it and Help', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    expect(menuIds(bar(view))).toContain('help');
    cleanup();

    // The one packaged row that reaches OUTSIDE the host's product, so a host must be able
    // to remove it without giving up the bar.
    const dropped = mountMenu(<DocxEditorMenu reportIssue={false} />);
    expect(menuIds(bar(dropped.view))).not.toContain('help');
  });

  test('`onReportIssue` redirects the row at the host, without replacing the menu', () => {
    let reported = 0;
    const { view } = mountMenu(<DocxEditorMenu onReportIssue={() => (reported += 1)} />);
    openMenu(view, 'toolbar.help');
    act(() => {
      fireEvent.click(
        view.container.querySelector<HTMLButtonElement>('[data-slot="help.reportIssue"]')!
      );
    });
    expect(reported).toBe(1);
  });

  test('`<DocxEditor menu={{...}}>` forwards menu props instead of forcing menu={false}', () => {
    const view = render(<DocxEditor document={SOURCE} menu={{ reportIssue: false }} />);
    expect(view.queryByTestId('docx-menubar')).not.toBeNull();
    expect(view.container.querySelector('[data-menu="help"]')).toBeNull();
    // The rest of the bar is untouched.
    expect(view.container.querySelector('[data-menu="insert"]')).not.toBeNull();
  });

  test('the generic Menu and fragment-wrapped parts override instead of duplicating', () => {
    // An unrecognized child is APPENDED, so a missed match renders the menu twice and both
    // copies open together — silent, and exactly what the namespace's documented
    // "addressed by registry id" shape used to do.
    const generic = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Menu id="file" className="via-generic" />
      </DocxEditorMenu>
    );
    expect(menuIds(bar(generic.view))).toEqual([...EXPECTED_MENUS]);
    expect(generic.view.container.querySelectorAll('[data-menu="file"]').length).toBe(1);
    openMenu(generic.view, 'toolbar.file');
    expect(generic.view.container.querySelectorAll('[role="menu"]').length).toBe(1);
    cleanup();

    // `Children.toArray` does not flatten Fragment ELEMENTS, so `child.type` is a symbol.
    const wrapped = mountMenu(
      <DocxEditorMenu>
        <>
          <DocxEditorMenu.Insert className="via-fragment" />
        </>
      </DocxEditorMenu>
    );
    expect(menuIds(bar(wrapped.view))).toEqual([...EXPECTED_MENUS]);
    expect(wrapped.view.container.querySelectorAll('[data-menu="insert"]').length).toBe(1);
  });

  test('the bar is ONE tab stop, and arrows move along it', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    const triggers = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__trigger')];
    // Roving tabindex: four triggers, one reachable by Tab.
    expect(triggers.filter((t) => t.tabIndex === 0).length).toBe(1);
    expect(triggers[0]!.tabIndex).toBe(0);

    act(() => {
      triggers[0]!.focus();
      fireEvent.keyDown(triggers[0]!, { key: 'ArrowRight' });
    });
    expect(document.activeElement).toBe(triggers[1]!);
    expect(triggers[1]!.tabIndex).toBe(0);

    // Wraps at the end, which is what makes a four-item bar usable.
    act(() => {
      fireEvent.keyDown(triggers[1]!, { key: 'ArrowLeft' });
      fireEvent.keyDown(triggers[0]!, { key: 'ArrowLeft' });
    });
    expect(document.activeElement).toBe(triggers[triggers.length - 1]!);
  });

  test('RTL bar arrows follow the visual order and react to direction changes', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    const menuBar = bar(view);
    const triggers = [...menuBar.querySelectorAll<HTMLElement>('.docx-menubar__trigger')];
    menuBar.style.direction = 'rtl';
    act(() => {
      triggers[0]!.focus();
      fireEvent.keyDown(triggers[0]!, { key: 'ArrowLeft' });
    });
    expect(document.activeElement === triggers[1]!).toBe(true);
    expect(triggers[1]!.tabIndex).toBe(0);
    act(() => {
      fireEvent.keyDown(triggers[1]!, { key: 'ArrowRight' });
      fireEvent.keyDown(triggers[0]!, { key: 'ArrowRight' });
    });
    expect(document.activeElement === triggers.at(-1)!).toBe(true);
    menuBar.style.direction = 'ltr';
    act(() => fireEvent.keyDown(triggers.at(-1)!, { key: 'ArrowRight' }));
    expect(document.activeElement === triggers[0]!).toBe(true);
  });

  test('ArrowDown opens a menu and lands focus on its first row; Escape returns it', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    const file = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__trigger')][0]!;
    act(() => {
      file.focus();
      fireEvent.keyDown(file, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(row(view, 'file.open'));

    // Arrow down the rows.
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(row(view, 'file.save'));

    // Escape closes AND restores focus — every close path unmounts the panel, so without
    // the restore the user is dropped on <body> at the top of the page.
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
    expect(document.activeElement).toBe(file);
  });

  test('a disabled row is still focusable, so its reason is reachable', () => {
    // View mode refuses every editing row, so the break submenu holds one.
    const { view } = mountMenu(<DocxEditorMenu />, SOURCE, 'view');
    openMenu(view, 'toolbar.insert');
    openSubmenu(view, 'toolbar.break');
    const refused = row(view, 'insert.sectionBreakContinuous');
    expect(refused.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      refused.focus();
    });
    // Native `disabled` would have removed it from the tab order and from arrow
    // navigation entirely — the reason would reach nobody.
    expect(document.activeElement).toBe(refused);
    // And it still refuses to act: acting would have closed the bar.
    act(() => {
      fireEvent.click(refused);
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBeGreaterThan(0);
  });

  test('the alignment rows are one-of-four, not four independent toggles', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.format');
    for (const slot of ['alignment.left', 'alignment.center', 'alignment.right']) {
      expect(row(view, slot).getAttribute('role')).toBe('menuitemradio');
    }
    // A mark is a genuine independent toggle.
    expect(row(view, 'text.bold').getAttribute('role')).toBe('menuitemcheckbox');
    // And a plain action claims no state at all.
    openMenu(view, 'toolbar.insert');
    expect(row(view, 'insert.toc').getAttribute('role')).toBe('menuitem');
  });

  test('the table grid is a grid with one tab stop, not 36 menu items', async () => {
    // Rendered only when the engine can insert, so this drives the part directly rather
    // than waiting on an engine that does not wire `insertTable` yet.
    const { view } = mountMenu(
      <DocxEditorMenu preset={false}>
        <DocxEditorMenu.Menu id="insert">
          <DocxEditorMenu.TableGrid />
        </DocxEditorMenu.Menu>
      </DocxEditorMenu>
    );
    openMenu(view, 'toolbar.insert');
    const grid = view.container.querySelector<HTMLElement>('[role="grid"]')!;
    expect(grid).not.toBeNull();
    expect(grid.querySelectorAll('[role="row"]').length).toBe(6);
    const cells = [...grid.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    expect(cells.length).toBe(36);
    expect(cells.filter((cell) => cell.tabIndex === 0).length).toBe(1);
    // No `menuitem` on a two-dimensional picker.
    expect(grid.querySelectorAll('[role="menuitem"]').length).toBe(0);

    // Two presses in ONE batch: the cursor composes through a functional update, so the
    // second press does not read a stale captured value and land one cell short.
    act(() => {
      fireEvent.keyDown(grid, { key: 'ArrowRight' });
      fireEvent.keyDown(grid, { key: 'ArrowDown' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute('data-cell')).toBe('2x2');
  });

  test('ARIA containment: the menubar owns its items through role="none" wrappers', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    const menubar = bar(view);
    expect(menubar.getAttribute('aria-label')).toBe(
      label('titleBar.menuBarAriaLabel' as TranslationKey)
    );
    // `menubar` -> unrole'd div -> menuitem breaks the required-owned-elements
    // relationship AT derives item counts and "x of y" announcements from.
    for (const child of menubar.children) {
      expect(child.getAttribute('role')).toBe('none');
    }
    openMenu(view, 'toolbar.insert');
    const panel = view.container.querySelector<HTMLElement>('[role="menu"]')!;
    for (const child of panel.children) {
      const role = child.getAttribute('role');
      expect(['menuitem', 'menuitemcheckbox', 'menuitemradio', 'separator', 'none']).toContain(
        role
      );
    }
  });

  test('a row child replaces its registry row IN PLACE; others append', () => {
    // Without this, changing ONE row of Insert meant re-listing every row — inheriting
    // the break submenu, the table picker and the TOC row forever, and silently ceasing
    // to track the registry the day a row was added.
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Insert>
          <DocxEditorMenu.Item slot="insert.toc" className="my-toc" />
          <DocxEditorMenu.Row onSelect={() => {}}>Clause library</DocxEditorMenu.Row>
        </DocxEditorMenu.Insert>
      </DocxEditorMenu>
    );
    openMenu(view, 'toolbar.insert');
    const slots = [...view.container.querySelectorAll('[role="menu"] > [data-slot]')].map((e) =>
      e.getAttribute('data-slot')
    );
    // The whole registry arrangement is still there, TOC still in its own position.
    // Table is absent from this list because it is a live size grid, which is a submenu and
    // carries no row slot of its own — the arrangement around it is what this pins down.
    expect(slots).toEqual([
      'image.insert',
      'insert.textBox',
      'insert.footnote',
      'insert.endnote',
      'insert.toc',
      'insert.bookmark',
      'insert.goToBookmark',
      'insert.watermark',
    ]);
    expect(row(view, 'insert.toc').className).toContain('my-toc');
    // The host's own row appends.
    expect(view.container.textContent).toContain('Clause library');
  });

  test('`hidden` on a row child removes just that row, keeping the rest', () => {
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Insert>
          <DocxEditorMenu.Item slot="insert.toc" hidden />
        </DocxEditorMenu.Insert>
      </DocxEditorMenu>
    );
    openMenu(view, 'toolbar.insert');
    expect(view.container.querySelector('[data-slot="insert.toc"]')).toBeNull();
    expect(row(view, 'insert.footnote')).toBeDefined();
  });

  test('`preset={false}` on a menu states the order itself', () => {
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.File preset={false}>
          <DocxEditorMenu.Row onSelect={() => {}}>Only this</DocxEditorMenu.Row>
        </DocxEditorMenu.File>
      </DocxEditorMenu>
    );
    openMenu(view, 'toolbar.file');
    expect(view.container.querySelector('[data-slot="file.open"]')).toBeNull();
    expect(view.container.textContent).toContain('Only this');
  });

  test('Help: the packaged row is a ROW, removable without losing the menu', () => {
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Help>
          <DocxEditorMenu.ReportIssue hidden />
          <DocxEditorMenu.Row onSelect={() => {}}>Documentation</DocxEditorMenu.Row>
        </DocxEditorMenu.Help>
      </DocxEditorMenu>
    );
    openMenu(view, 'toolbar.help');
    // Removed, not duplicated: two children naming the same row collapse to the last.
    expect(view.container.querySelector('[data-slot="help.reportIssue"]')).toBeNull();
    expect(view.container.textContent).toContain('Documentation');
    expect(menuIds(bar(view))).toContain('help');
  });

  test('a host can add a menu of its own, with its own id and label', () => {
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Menu id="clauses" label="Clauses">
          <DocxEditorMenu.Row onSelect={() => {}}>Send for approval</DocxEditorMenu.Row>
        </DocxEditorMenu.Menu>
      </DocxEditorMenu>
    );
    // Appended after the default bar, and it is a real menu: it opens, and opening it
    // closes whichever was open.
    expect(menuIds(bar(view))).toEqual([...EXPECTED_MENUS, 'clauses']);
    openMenu(view, 'toolbar.file');
    const clauses = [
      ...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger'),
    ] //
      .find((button) => button.textContent === 'Clauses')!;
    act(() => {
      fireEvent.click(clauses);
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);
    expect(view.container.textContent).toContain('Send for approval');
    // And it joins the roving tabindex rather than becoming a stray tab stop.
    expect(
      [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__trigger')].filter(
        (t) => t.tabIndex === 0
      ).length
    ).toBe(1);
  });

  test('Escape closes the open menu', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });
});

test('File > Export reports missing converters after the menu closes', async () => {
  const { view } = mountMenu(<DocxEditorMenu />);
  for (const [slot, packageName] of [
    ['file.exportMarkdown', 'docx-to-markdown'],
    ['file.exportPdf', 'docx-to-pdf'],
  ]) {
    openMenu(view, 'toolbar.file');
    openSubmenu(view, 'toolbar.export');
    await act(async () => {
      fireEvent.click(row(view, slot!));
    });
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(packageName!);
    expect(view.container.querySelector('[data-menu="file"] [role="menu"]')).toBeNull();
    act(() => fireEvent.click(view.container.querySelector('[data-docx-dialog="export"] button')!));
  }
});

test('File row overrides reach export submenu slots without duplicate rows', () => {
  const { view } = mountMenu(
    <DocxEditorMenu>
      <DocxEditorMenu.File>
        <DocxEditorMenu.ExportPdf hidden />
        <DocxEditorMenu.ExportMarkdown className="custom-export" />
      </DocxEditorMenu.File>
    </DocxEditorMenu>
  );
  openMenu(view, 'toolbar.file');
  openSubmenu(view, 'toolbar.export');
  expect(view.container.querySelectorAll('[data-slot="file.exportPdf"]')).toHaveLength(0);
  const rows = view.container.querySelectorAll('[data-slot="file.exportMarkdown"]');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.classList.contains('custom-export')).toBe(true);
  expect(rows[0]?.closest('.docx-menubar__submenu')).not.toBeNull();
});

test('Markdown export shows a dismissible dialog and reports a later failure', async () => {
  let fail!: (reason: Error) => void;
  const conversion = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const { view } = mountMenu(<DocxEditorMenu exporters={{ markdown: () => conversion }} />);
  openMenu(view, 'toolbar.file');
  openSubmenu(view, 'toolbar.export');
  await act(async () => {
    fireEvent.click(row(view, 'file.exportMarkdown'));
  });
  expect(view.getByRole('dialog').getAttribute('aria-label')).toBe('Exporting Markdown…');
  act(() => {
    fireEvent.click(view.getByRole('button', { name: 'Continue editing' }));
  });
  expect(view.queryByRole('dialog')).toBeNull();
  await act(async () => {
    fail(new Error('Conversion unavailable'));
  });
  expect(view.getByRole('alertdialog').getAttribute('aria-label')).toBe('Markdown export failed');
  expect(view.getByRole('alert').textContent).toContain('Conversion unavailable');
  act(() => {
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
  });
  expect(view.queryByRole('alertdialog')).toBeNull();
});

describe('direct menu actions', () => {
  test('remain tabbable and update command state without reopening a menu', async () => {
    const { view, editor } = mountMenu(
      <DocxEditorMenu preset={false}>
        <DocxEditorMenu.PageSetup />
        <MenuParagraphDialog />
        <DocxEditorMenu.File />
      </DocxEditorMenu>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const page = row(view, 'file.pageSetup');
    const paragraph = row(view, 'paragraph.dialog');
    for (const action of [page, paragraph]) {
      expect(action.tabIndex).toBe(0);
      expect(action.getAttribute('aria-disabled')).not.toBe('true');
    }
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    for (const action of [page, paragraph])
      expect(action.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'editing' });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    for (const action of [page, paragraph])
      expect(action.getAttribute('aria-disabled')).not.toBe('true');
    openMenu(view, 'toolbar.file');
    const popup = view.container.querySelector('[role="menu"]')!;
    expect(popup.querySelector<HTMLButtonElement>('[data-slot="file.pageSetup"]')!.tabIndex).toBe(
      -1
    );
  });
});
