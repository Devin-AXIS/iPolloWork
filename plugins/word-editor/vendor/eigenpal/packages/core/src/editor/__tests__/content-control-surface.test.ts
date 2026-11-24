import type { ContentControlWidgetSession } from '../popup-sessions.ts';
// Content-control surface chrome: boundary furniture, show-all, form-fill navigation,
// lock/bound refusals, and remove — without layout reflow.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { paintSemanticLayout } from '@docx-editor.dev/core/output';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { CHROME_GROUPS, chromeSlotId, type ChromeSlotId } from '../chrome-controls.ts';
import { commandForSlot } from '../toolbar-commands.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sdt = (pr: string, content: string) =>
  `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function mount(
  body: string,
  onRequestContentControlWidget?: (request: ContentControlWidgetSession) => boolean
): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    ...(onRequestContentControlWidget ? { onRequestContentControlWidget } : {}),
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

function putCaret(surface: PaginatedSurface, offset: number, paragraphIndex = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function pageGeometry(surface: PaginatedSurface) {
  return surface.layout().pages.map((page) => ({
    w: page.box.width,
    h: page.box.height,
    cw: page.contentBox.width,
    ch: page.contentBox.height,
    fragments: page.fragments.length,
  }));
}

describe('content-control surface chrome', () => {
  test('chrome slots are registered without renaming existing slots', () => {
    const slots: ChromeSlotId[] = CHROME_GROUPS.flatMap((g) =>
      g.controls.map((c) => chromeSlotId(g, c))
    );
    expect(slots).toContain('contentControl.showAll');
    expect(slots).toContain('contentControl.formFill');
    expect(slots).toContain('contentControl.inspector');
    expect(slots).toContain('contentControl.remove');
    expect(slots).toContain('text.bold');
    expect(CHROME_GROUPS.find((group) => group.id === 'contentControl')?.contextual).toBe(true);
    expect(commandForSlot('contentControl.remove')).toEqual({ type: 'removeContentControl' });
    expect(commandForSlot('contentControl.showAll')).toBeNull();
  });

  test('show-all paints boundary furniture without reflow', () => {
    const { surface, container } = mount(
      sdt(`<w:alias w:val="Name"/><w:text/>`, p('Ada')) + p('after')
    );
    expect(surface.layout().contentControls?.length).toBeGreaterThan(0);
    // Park the caret outside every control so only show-all (not caret-entry) paints chrome.
    putCaret(surface, 0, 1);
    expect(surface.contentControls.atCaret()).toBeNull();
    expect(
      container
        .querySelector<HTMLElement>('[data-docx-content-control]')!
        .hasAttribute('data-boundary-visible')
    ).toBe(false);

    const before = pageGeometry(surface);

    surface.contentControls.setShowAll(true);
    expect(surface.state().contentControls.showAll).toBe(true);
    expect(pageGeometry(surface)).toEqual(before);

    const chrome = container.querySelector('[data-docx-content-control]');
    expect(chrome).toBeTruthy();
    expect(chrome!.getAttribute('contenteditable')).toBe('false');
    expect(chrome!.hasAttribute('data-docx-marker')).toBe(true);

    surface.contentControls.setShowAll(false);
    expect(
      container
        .querySelector<HTMLElement>('[data-docx-content-control]')!
        .hasAttribute('data-boundary-visible')
    ).toBe(false);
    expect(pageGeometry(surface)).toEqual(before);
  });

  test('caret entry shows chrome for the active control only', () => {
    const { surface, container } = mount(
      sdt(`<w:alias w:val="A"/><w:text/>`, p('one')) +
        sdt(`<w:alias w:val="B"/><w:text/>`, p('two'))
    );
    putCaret(surface, 1, 0);
    expect(surface.contentControls.atCaret()?.alias).toBe('A');
    const nodes = [...container.querySelectorAll('[data-docx-content-control]')];
    expect(nodes.length).toBe(2);
    const active = nodes.find((node) => (node as HTMLElement).hasAttribute('data-active'));
    expect((active as HTMLElement | undefined)?.dataset.alias).toBe('A');
  });

  test('widget mousedown is prevented so chrome does not steal the caret', () => {
    const body = `<w:p>${sdt(
      `<w:dropDownList><w:listItem w:displayText="One" w:value="1"/></w:dropDownList>`,
      `<w:r><w:t>One</w:t></w:r>`
    )}</w:p>`;
    const { surface, container } = mount(body);
    putCaret(surface, 0);
    surface.contentControls.setShowAll(true);
    const widget = container.querySelector('[data-docx-cc-widget]') as HTMLElement | null;
    expect(widget).toBeTruthy();
    const before = surface.state().selection;
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
    });
    widget!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.state().selection).toEqual(before);
  });

  test('widget menus open below controls in pages-layer coordinates', () => {
    const body =
      `<w:p>${sdt(
        `<w:dropDownList><w:listItem w:displayText="One" w:value="1"/>` +
          `<w:listItem w:displayText="Two" w:value="2"/></w:dropDownList>`,
        `<w:r><w:t>One</w:t></w:r>`
      )}</w:p>` +
      `<w:p>${sdt(
        `<w:date w:fullDate="2026-08-04T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>`,
        `<w:r><w:t>2026-08-04</w:t></w:r>`
      )}</w:p>`;
    const { surface, container } = mount(body);
    const records = surface.layout().contentControls!;
    const widgets = [...container.querySelectorAll<HTMLElement>('[data-docx-cc-widget]')].sort(
      (left) => (left.dataset.docxCcWidget === 'date' ? -1 : 1)
    );
    expect(widgets).toHaveLength(2);

    for (const [index, widget] of widgets.entries()) {
      widget.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: index + 1,
          pointerType: 'mouse',
        })
      );
      const menu = container.querySelector<HTMLElement>('.docx-content-control-menu');
      expect(menu).not.toBeNull();
      const controlId = widget.getAttribute('data-docx-cc-id');
      const fragment = records.find((record) => record.id === controlId)!.fragments[0]!;
      const page = surface.layout().pages[fragment.pageIndex]!;
      // Compared as numbers: CSS serializes to six decimals, so a coordinate that is a
      // repeating decimal never matches its own `${value}px` spelling. The pop-up lines up
      // under the control's LEFT edge, as Word's does; right-aligning it to the widget hung
      // it off the page for any control near the start of a line.
      expect(Number.parseFloat(menu!.style.left)).toBeCloseTo(
        page.box.x + (page.contentBox.x - page.box.x) + fragment.box.x,
        5
      );
      expect(Number.parseFloat(menu!.style.top)).toBeCloseTo(
        page.box.y + (page.contentBox.y - page.box.y) + fragment.box.y + fragment.box.height,
        5
      );
      expect(menu!.style.transform).toBe('');
      if (widget.dataset.docxCcWidget === 'date') {
        expect(menu!.classList.contains('docx-content-control-calendar')).toBe(true);
        expect(menu!.querySelectorAll('.docx-content-control-calendar-day')).toHaveLength(42);
        expect(
          menu!.querySelectorAll('.docx-content-control-calendar-weekdays > span')
        ).toHaveLength(7);
        // No native date input: the grid IS the picker, like Word's.
        expect(menu!.querySelector('input[type=date]')).toBeNull();
        expect(menu!.querySelector('.docx-content-control-calendar-today')?.textContent).toBe(
          'Today'
        );
        expect(menu!.querySelector('[data-selected]')?.getAttribute('data-iso')).toBe('2026-08-04');
      }
      const owner = [
        ...container.querySelectorAll<HTMLElement>('[data-docx-content-control]'),
      ].find((chrome) => chrome.getAttribute('data-docx-content-control') === controlId);
      expect(owner?.hasAttribute('data-open')).toBe(true);
      if (widget.dataset.docxCcWidget === 'dropdown') {
        const option = menu!.querySelectorAll<HTMLElement>('.docx-content-control-menu-item')[1]!;
        const pointerDown = new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 10,
          pointerType: 'mouse',
        });
        option.dispatchEvent(pointerDown);
        expect(pointerDown.defaultPrevented).toBe(false);
        option.click();
        expect(menu!.isConnected).toBe(false);
        expect(container.querySelector('.docx-page-content')?.textContent).toContain('Two');
      } else {
        const beforeTitle = menu!.querySelector(
          '.docx-content-control-calendar-title'
        )?.textContent;
        const next = menu!.querySelectorAll<HTMLElement>('.docx-content-control-calendar-nav')[1]!;
        next.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 11,
            pointerType: 'mouse',
          })
        );
        next.click();
        expect(menu!.querySelector('.docx-content-control-calendar-title')?.textContent).not.toBe(
          beforeTitle
        );
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(menu!.isConnected).toBe(false);
      }
    }
  });

  test('the calendar Today button and arrow keys commit and roam like a picker', () => {
    const body = `<w:p>${sdt(
      `<w:date w:fullDate="2026-08-04T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>`,
      `<w:r><w:t>2026-08-04</w:t></w:r>`
    )}</w:p>`;
    const { container } = mount(body);
    const press = (): void => {
      container.querySelector<HTMLElement>('[data-docx-cc-widget="date"]')!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 12,
          pointerType: 'mouse',
        })
      );
    };
    const menu = (): HTMLElement | null =>
      container.querySelector<HTMLElement>('.docx-content-control-menu');

    // ArrowLeft from the first of the month crosses into the previous month's grid.
    press();
    const first = menu()!.querySelector<HTMLElement>('[data-iso="2026-08-01"]')!;
    first.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' })
    );
    expect(menu()!.querySelector('.docx-content-control-calendar-title')?.textContent).toBe(
      'July 2026'
    );
    expect(menu()!.querySelector<HTMLElement>('[data-iso="2026-07-31"]')).not.toBeNull();

    // A day press commits that ISO date and closes the picker.
    menu()!.querySelector<HTMLElement>('[data-iso="2026-07-15"]')!.click();
    expect(menu()).toBeNull();
    expect(container.querySelector('.docx-page-content')?.textContent).toContain('2026-07-15');

    // Today commits the current local date.
    press();
    menu()!.querySelector<HTMLElement>('.docx-content-control-calendar-today')!.click();
    expect(menu()).toBeNull();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;
    expect(container.querySelector('.docx-page-content')?.textContent).toContain(iso);
  });

  test('engine menu input stays outside the document editing handlers', () => {
    const { surface, container } = mount(
      `<w:p>${sdt(
        '<w:comboBox><w:listItem w:displayText="One" w:value="1"/></w:comboBox>',
        '<w:r><w:t>One</w:t></w:r>'
      )}</w:p>`
    );
    container.querySelector<HTMLElement>('[data-docx-cc-widget]')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
    const input = container.querySelector<HTMLInputElement>('.docx-content-control-menu-input')!;
    const before = surface.session.part();
    const typing = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'draft',
    });
    input.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
    expect(surface.session.part()).toBe(before);
    const composing = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      isComposing: true,
    });
    input.dispatchEvent(composing);
    expect(surface.session.part()).toBe(before);
    const option = container.querySelector<HTMLElement>('[role="option"]')!;
    const enter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    option.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(surface.session.part()).toBe(before);
    // The browser's keyboard activation dispatches click after the unprevented Enter.
    option.click();
    expect(container.querySelector('.docx-content-control-menu')).toBeNull();
    expect(container.querySelector('.docx-page-content')?.textContent).toBe('One');
    surface.destroy();
  });

  test('arrowing into a prompt selects it whole, so typing replaces it and keeps going', () => {
    const body = `<w:p><w:r><w:t xml:space="preserve">Name: </w:t></w:r>${sdt(
      `<w:showingPlcHdr/><w:richText/>`,
      `<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Click here to enter text.</w:t></w:r>`
    )}</w:p>`;
    const { surface, container } = mount(body);
    // Caret before the prompt, then one step right: Word selects the prompt as a unit rather
    // than parking the caret inside text the first keystroke will replace.
    putCaret(surface, 6);
    surface.navigate('right');
    const selected = surface.state().selection;
    expect(Math.min(selected.anchor.offset, selected.head.offset)).toBe(6);
    expect(Math.max(selected.anchor.offset, selected.head.offset)).toBe(
      6 + 'Click here to enter text.'.length
    );
    surface.type('a');
    surface.type('b');
    surface.type('c');
    // Navigation flushes buffered typing; every keystroke after the replacement must land.
    surface.navigate('right');
    expect(surface.session.bodyText()).toBe('Name: abc');
    expect(container.querySelector('.docx-page-content')?.textContent).toContain('Name: abc');
    expect(surface.state().lastRejection ?? null).toBeNull();
    expect(surface.state().selection.head.offset).toBe(9);
  });

  test('a host renderer receives checkbox presses as a session before the engine toggles', () => {
    // Text on both sides: the toggle rewrites the display run as a `w:sym`, which has no
    // model width, and the control's fragment then comes from the line it sits on.
    const body = `<w:p><w:r><w:t>Done: </w:t></w:r>${sdt(
      `<w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
        `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`,
      `<w:r><w:t>☐</w:t></w:r>`
    )}<w:r><w:t> yes</w:t></w:r></w:p>`;
    const sessions: ContentControlWidgetSession[] = [];
    const { surface, container } = mount(body, (session) => {
      sessions.push(session);
      return true;
    });
    surface.contentControls.setShowAll(true);
    const press = (): void => {
      container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]')!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 21,
          pointerType: 'mouse',
        })
      );
    };
    press();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.kind).toBe('checkbox');
    expect(sessions[0]!.value).toBe('false');
    expect(sessions[0]!.items).toEqual([]);
    // The engine did NOT toggle on its own: the host owns the decision.
    const checked = (): string | null =>
      container
        .querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]')
        ?.getAttribute('data-checked') ?? null;
    expect(checked()).toBe('false');
    expect(sessions[0]!.apply('true')).toBe(true);
    expect(checked()).toBe('true');
    press();
    expect(sessions[1]!.value).toBe('true');
    sessions[1]!.cancel();
    expect(checked()).toBe('true');
  });

  test('widget menus dismiss on outside press, Escape, and widget re-press', () => {
    const body =
      `<w:p>${sdt(
        `<w:dropDownList><w:listItem w:displayText="One" w:value="1"/>` +
          `<w:listItem w:displayText="Two" w:value="2"/></w:dropDownList>`,
        `<w:r><w:t>One</w:t></w:r>`
      )}</w:p>` +
      `<w:p>${sdt(
        `<w:dropDownList><w:listItem w:displayText="A" w:value="a"/></w:dropDownList>`,
        `<w:r><w:t>A</w:t></w:r>`
      )}</w:p>`;
    const { container } = mount(body);
    const widgets = [...container.querySelectorAll<HTMLElement>('[data-docx-cc-widget]')];
    expect(widgets).toHaveLength(2);
    const press = (node: EventTarget): void => {
      node.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      );
    };
    const menu = (): HTMLElement | null =>
      container.querySelector<HTMLElement>('.docx-content-control-menu');

    // An outside press dismisses without picking a value. `pointerdown`, not `mousedown`:
    // the surface prevents the page press default, which suppresses the compatibility
    // mouse events a `mousedown` listener would wait for.
    press(widgets[0]!);
    expect(menu()).not.toBeNull();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu()).toBeNull();
    expect(container.querySelector('.docx-page-content')?.textContent).toContain('One');

    // Escape dismisses without picking a value.
    press(widgets[0]!);
    expect(menu()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(menu()).toBeNull();

    // Re-pressing the owning widget toggles the menu shut.
    press(widgets[0]!);
    expect(menu()).not.toBeNull();
    press(widgets[0]!);
    expect(menu()).toBeNull();

    // Pressing another widget switches menus.
    press(widgets[0]!);
    press(widgets[1]!);
    expect(menu()?.textContent).toContain('A');
  });

  test('boundary furniture is excluded from native selection mapping', () => {
    const part = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${sdt(`<w:alias w:val="X"/><w:text/>`, p('Hi'))}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!part.ok) throw new Error(part.reason);
    const layout = layoutSemanticDocument(part.part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const container = document.createElement('div');
    const controlId = layout.contentControls![0]!.id;
    paintSemanticLayout(container, layout, {
      scale: 1,
      ariaHidden: false,
      contentControlChrome: { showAll: true, activeIds: new Set([controlId]) },
    });
    const marker = container.querySelector('[data-docx-content-control]');
    expect(marker?.getAttribute('contenteditable')).toBe('false');
    expect(marker?.hasAttribute('data-docx-marker')).toBe(true);
    expect(
      container.querySelector('.docx-content-control-boundary')?.hasAttribute('data-docx-marker')
    ).toBe(true);
  });

  test('form-fill Tab navigates by tabIndex then document order, skipping locked', () => {
    const body =
      sdt(`<w:tag w:val="c"/><w:tabIndex w:val="2"/><w:text/>`, p('third')) +
      sdt(`<w:tag w:val="a"/><w:tabIndex w:val="1"/><w:text/>`, p('first')) +
      sdt(`<w:tag w:val="locked"/><w:lock w:val="contentLocked"/><w:text/>`, p('skip')) +
      sdt(`<w:tag w:val="b"/><w:text/>`, p('second'));
    const { surface } = mount(body);
    surface.contentControls.setFormFill(true);
    expect(surface.state().contentControls.formFill).toBe(true);

    const controls = surface.layout().contentControls ?? [];
    const byTag = Object.fromEntries(controls.map((c) => [c.tag, c]));
    expect(byTag.locked?.effectiveLock).toBe('contentLocked');

    // Start at tabIndex=1 ("a"), then walk next — locked must never appear.
    const aPara = surface.session.paragraphIds()[1]!;
    surface.setSelection({
      anchor: { paragraphId: aPara, offset: 0 },
      head: { paragraphId: aPara, offset: 0 },
    });
    expect(surface.contentControls.atCaret()?.tag).toBe('a');

    const visited: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const tag = surface.contentControls.atCaret()?.tag;
      if (tag) visited.push(tag);
      expect(surface.contentControls.navigate('next')).toBe(true);
    }
    expect(visited.includes('locked')).toBe(false);
    // tabIndex order: a (1) then c (2); b has no tabIndex and follows document order among
    // the remaining editable controls after indexed ones.
    expect(visited.filter((t, i) => visited.indexOf(t) === i)).toEqual(
      expect.arrayContaining(['a', 'c', 'b'])
    );
    const unique = visited.filter((t, i) => visited.indexOf(t) === i);
    expect(unique.indexOf('a')).toBeLessThan(unique.indexOf('c'));
  });

  test('ordinary Tab does not capture when form-fill is off', () => {
    const { surface } = mount(sdt(`<w:text/>`, p('hello')));
    putCaret(surface, 0);
    expect(surface.contentControls.formFill()).toBe(false);
    expect(surface.contentControls.navigate('next')).toBe(true); // API still works
    // Keymap path: without form-fill, insertTab would run — verify mode gate.
    surface.contentControls.setFormFill(false);
    expect(surface.state().contentControls.formFill).toBe(false);
  });

  test('setValue and remove honour lock and bound', () => {
    const locked = sdt(`<w:lock w:val="sdtContentLocked"/><w:text/>`, p('L'));
    const bound = sdt(
      `<w:dataBinding w:prefixMappings="" w:xpath="/x" w:storeItemID="{00000000-0000-0000-0000-000000000000}"/><w:text/>`,
      p('B')
    );
    const open = sdt(`<w:text/>`, p('O'));
    const { surface } = mount(locked + bound + open);
    const controls = surface.layout().contentControls ?? [];
    expect(controls.length).toBe(3);
    const lockedId = controls.find((c) => c.effectiveLock === 'sdtContentLocked')!.id;
    const boundId = controls.find((c) => c.bound)!.id;
    const openId = controls.find((c) => !c.bound && c.effectiveLock === 'unlocked')!.id;

    expect(surface.contentControls.disabledReason(lockedId, 'edit')).toBe('locked');
    expect(surface.contentControls.disabledReason(lockedId, 'remove')).toBe('locked');
    expect(surface.contentControls.disabledReason(boundId, 'edit')).toBe('bound');
    expect(surface.contentControls.setValue(lockedId, 'x')).toBe(false);
    expect(surface.contentControls.setValue(boundId, 'x')).toBe(false);
    expect(surface.contentControls.remove(lockedId)).toBe(false);

    expect(surface.contentControls.disabledReason(openId, 'remove')).toBeNull();
    expect(surface.contentControls.remove(openId)).toBe(true);
    expect(surface.layout().contentControls?.some((c) => c.id === openId)).toBe(false);
    expect(surface.session.bodyText()).toContain('O');
  });

  test('viewing mode refuses every control write and disables the painted widget', () => {
    // This lane called `session.applyTreeOps` directly rather than the gated session, so a
    // checkbox on a document open for viewing still toggled and still committed. The widget
    // is engine-painted, so the mode has to reach the DOM too — the pointer lane skips a
    // widget carrying `data-disabled-reason`, which is what stops the click.
    const body =
      `<w:p>${sdt(
        `<w14:checkbox><w14:checked w14:val="0"/>` +
          `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
          `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`,
        `<w:r><w:t>x</w:t></w:r>`
      )}</w:p>` + sdt(`<w:text/>`, p('O'));
    const { surface, container } = mount(body);
    const controls = surface.layout().contentControls ?? [];
    const checkboxId = controls.find((c) => c.controlType === 'checkbox')!.id;
    const openId = controls.find((c) => c.controlType !== 'checkbox')!.id;
    const revision = surface.session.packageRevision();

    surface.setEditingMode('view');

    expect(surface.contentControls.disabledReason(checkboxId, 'edit')).toBe(
      'the document is open for viewing'
    );
    expect(surface.contentControls.disabledReason(openId, 'remove')).toBe(
      'the document is open for viewing'
    );
    expect(surface.contentControls.setValue(checkboxId, '1')).toBe(false);
    expect(surface.contentControls.remove(openId)).toBe(false);
    expect(surface.session.packageRevision()).toBe(revision);

    const widget = container.querySelector<HTMLButtonElement>('[data-docx-cc-widget]');
    expect(widget).not.toBeNull();
    expect(widget!.disabled).toBe(true);
    expect(widget!.dataset.disabledReason).toBe('readOnly');
    expect(
      container.querySelector('.docx-content-control-chrome')?.hasAttribute('data-read-only')
    ).toBe(true);

    // Reversible: the reader chose viewing and can choose again.
    surface.setEditingMode('edit');
    expect(surface.contentControls.disabledReason(openId, 'remove')).toBeNull();
    const back = container.querySelector<HTMLButtonElement>('[data-docx-cc-widget]');
    expect(back!.disabled).toBe(false);
    expect(surface.contentControls.setValue(checkboxId, '1')).toBe(true);
  });

  test('viewing mode takes the pages layer out of contenteditable', () => {
    // `setEditable` and `setEditingMode` were two independent writes of one state, kept in
    // step only by the facade — so a host driving the surface itself kept a writable pages
    // layer, a caret and an IME on a document that refuses every write.
    const { surface, container } = mount(sdt(`<w:text/>`, p('O')));
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    expect(pages.contentEditable).toBe('true');

    surface.setEditingMode('view');
    expect(pages.contentEditable).toBe('false');
    expect(pages.getAttribute('aria-readonly')).toBe('true');

    surface.setEditingMode('edit');
    expect(pages.contentEditable).toBe('true');
    expect(pages.getAttribute('aria-readonly')).toBe('false');

    // The host's own wish still outranks a non-viewing mode.
    surface.setEditable(false);
    expect(pages.contentEditable).toBe('false');
    surface.setEditingMode('suggest');
    expect(pages.contentEditable).toBe('false');
  });

  test('foreign-namespace sdt is opaque to surface content-control ops', () => {
    const { surface } = mount(
      `<x:sdt xmlns:x="http://example.com/x"><x:sdtPr/><x:sdtContent>${p('foreign')}</x:sdtContent></x:sdt>` +
        sdt(`<w:alias w:val="Real"/><w:text/>`, p('real'))
    );
    const part = surface.session.part();
    const foreignIds: string[] = [];
    const walk = (node: {
      kind: string;
      id?: string;
      localName?: string;
      namespaceUri?: string;
      children?: readonly unknown[];
    }): void => {
      if (node.kind === 'generic' && node.localName === 'sdt' && node.namespaceUri !== W) {
        if (typeof node.id === 'string') foreignIds.push(node.id);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child as typeof node);
      }
    };
    walk(part.root as never);
    expect(foreignIds.length).toBeGreaterThan(0);
    for (const id of foreignIds) {
      expect(surface.contentControls.disabledReason(id, 'edit')).toBe('notFound');
      expect(surface.contentControls.remove(id)).toBe(false);
      expect(surface.contentControls.setValue(id, 'x')).toBe(false);
    }
    // Real WML control remains addressable.
    const real = surface.layout().contentControls?.find((c) => c.alias === 'Real');
    expect(real).toBeTruthy();
    expect(surface.contentControls.disabledReason(real!.id, 'edit')).toBeNull();
  });

  test('checkbox widget commit goes through setContentControlValue', () => {
    const body =
      `<w:p>${sdt(
        `<w14:checkbox><w14:checked w14:val="0"/>` +
          `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
          `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>` +
          `</w14:checkbox>`,
        `<w:r><w:sym w:font="MS Gothic" w:char="2610"/></w:r>`
      )}` + `<w:r><w:t> Task pending</w:t></w:r></w:p>`;
    const { surface, container } = mount(body);
    const control = surface.layout().contentControls?.[0];
    expect(control?.controlType).toBe('checkbox');
    surface.contentControls.setShowAll(true);
    const before = container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]');
    expect(before?.getAttribute('data-checked')).toBe('false');
    expect(before?.getAttribute('aria-checked')).toBe('false');

    before!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );

    const after = container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]');
    expect(after?.getAttribute('data-checked')).toBe('true');
    expect(after?.getAttribute('aria-checked')).toBe('true');
  });
});

test('custom content-control widget sessions retain core writes and invalidate stale callbacks', () => {
  const requests: ContentControlWidgetSession[] = [];
  const body = `<w:p>${sdt(
    '<w:dropDownList><w:listItem w:displayText="One" w:value="1"/><w:listItem w:displayText="Two" w:value="2"/></w:dropDownList>',
    '<w:r><w:t>One</w:t></w:r>'
  )}</w:p>`;
  const { surface, container } = mount(body, (request) => {
    requests.push(request);
    return true;
  });
  const open = () =>
    container.querySelector<HTMLElement>('[data-docx-cc-widget]')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
  try {
    open();
    const first = requests[0]!;
    expect(first.kind).toBe('dropdown');
    expect(first.value).toBe('1');
    expect(first.items.map((item) => item.value)).toEqual(['1', '2']);
    expect(first.anchor).not.toBeNull();
    expect(first.anchor?.className).toBe('docx-content-control-boundary');
    expect(container.querySelector('.docx-content-control-menu')).toBeNull();
    expect(first.apply('invalid')).toBe(false);
    expect(first.signal.aborted).toBe(false);
    expect(first.apply('2')).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(container.querySelector('.docx-page-content')?.textContent).toContain('Two');
    expect(first.apply('1')).toBe(false);
    open();
    const second = requests[1]!;
    open();
    expect(second.signal.aborted).toBe(true);
    const third = requests[2]!;
    second.cancel();
    expect(third.signal.aborted).toBe(false);
    surface.setEditingMode('view');
    expect(third.signal.aborted).toBe(true);
    expect(third.canApply()).toBe(false);
    surface.setEditingMode('edit');
    open();
    const last = requests[3]!;
    surface.destroy();
    expect(last.signal.aborted).toBe(true);
    expect(last.apply('1')).toBe(false);
  } finally {
    container.remove();
  }
});

describe('typing beside and clearing a prompt', () => {
  const PROMPT = 'Click here to enter text.';
  const body = `<w:p><w:r><w:t xml:space="preserve">Name: </w:t></w:r>${sdt(
    `<w:alias w:val="Name"/><w:showingPlcHdr/><w:text/>`,
    `<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${PROMPT}</w:t></w:r>`
  )}</w:p>`;

  test('a caret at the end of the prompt types over it and lands after the text', () => {
    const { surface } = mount(body);
    // The prompt spans 6..31; the caret sits at its far edge, outside the control's text.
    putCaret(surface, 6 + PROMPT.length);
    surface.type(' ');
    expect(surface.session.bodyText()).toBe('Name:  ');
    expect(surface.state().selection.head.offset).toBe(7);
    expect(surface.state().lastRejection ?? null).toBeNull();
    // Every later keystroke lands where the reader is looking, not past the paragraph's end.
    surface.type('x');
    expect(surface.session.bodyText()).toBe('Name:  x');
    expect(surface.state().selection.head.offset).toBe(8);
  });

  test('deleting everything typed brings the prompt back and keeps the control', () => {
    const { surface } = mount(body);
    putCaret(surface, 8);
    surface.type('ab');
    expect(surface.session.bodyText()).toBe('Name: ab');
    surface.deleteBackward();
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe(`Name: ${PROMPT}`);
    const control = surface.layout().contentControls?.find((entry) => entry.alias === 'Name');
    expect(control?.placeholder).toBe(true);
    expect(surface.state().lastRejection ?? null).toBeNull();
    // A third Backspace takes the character before the control, as in Word; the control stays.
    surface.deleteBackward();
    expect(surface.layout().contentControls?.some((entry) => entry.alias === 'Name')).toBe(true);
    expect(surface.session.bodyText()).toBe(`Name:${PROMPT}`);
  });
});

describe('a press on a list prompt', () => {
  const body = `<w:p><w:r><w:t xml:space="preserve">Size: </w:t></w:r>${sdt(
    `<w:alias w:val="Size"/><w:showingPlcHdr/><w:dropDownList><w:listItem w:displayText="Small" w:value="S"/>` +
      `<w:listItem w:displayText="Large" w:value="L"/></w:dropDownList>`,
    `<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Choose an item.</w:t></w:r>`
  )}</w:p>`;

  test('selects the prompt whole, keeps the control active, and opens its menu', () => {
    const { surface, container } = mount(body);
    // Pressed by LAYOUT geometry: the DOM has no boxes under happy-dom, and the pointer maps
    // client coordinates onto the pages layer, whose rect sits at the origin there.
    const control = surface.layout().contentControls![0]!;
    const fragment = control.fragments[0]!;
    const page = surface.layout().pages[fragment.pageIndex]!;
    const x =
      page.box.x + (page.contentBox.x - page.box.x) + fragment.box.x + fragment.box.width / 2;
    const y =
      page.box.y + (page.contentBox.y - page.box.y) + fragment.box.y + fragment.box.height / 2;
    container.querySelector<HTMLElement>('.docx-pages')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
      })
    );
    const selection = surface.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 21]);
    // A range over the prompt is still IN the control: its chrome stays active.
    expect(surface.contentControls.atCaret()?.alias).toBe('Size');
    const menu = container.querySelector<HTMLElement>('.docx-content-control-menu');
    expect(menu).not.toBeNull();
    expect(menu!.querySelectorAll('[role="option"]')).toHaveLength(2);
  });
  test('opens a host renderer against the connected active boundary after selecting the prompt', () => {
    const sessions: ContentControlWidgetSession[] = [];
    const { surface, container } = mount(body, (session) => {
      sessions.push(session);
      return true;
    });
    document.body.append(container);
    try {
      // Pressed by LAYOUT geometry: the DOM has no boxes under happy-dom, and the pointer maps
      // client coordinates onto the pages layer, whose rect sits at the origin there.
      const control = surface.layout().contentControls![0]!;
      const fragment = control.fragments[0]!;
      const page = surface.layout().pages[fragment.pageIndex]!;
      const x =
        page.box.x + (page.contentBox.x - page.box.x) + fragment.box.x + fragment.box.width / 2;
      const y =
        page.box.y + (page.contentBox.y - page.box.y) + fragment.box.y + fragment.box.height / 2;
      container.querySelector<HTMLElement>('.docx-pages')!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        })
      );
      const selection = surface.state().selection;
      expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 21]);
      // A range over the prompt is still IN the control: its chrome stays active.
      expect(surface.contentControls.atCaret()?.alias).toBe('Size');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.anchor.isConnected).toBe(true);
      expect(sessions[0]!.anchor).toBe(
        container.querySelector('[data-active] .docx-content-control-boundary')
      );
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

describe('typing stays inside the control', () => {
  const HL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
  const controlContent = (surface: PaginatedSurface) =>
    serializeOoxmlPart(surface.session.part())
      .replace(/[\s\S]*<w:sdtContent>/, '')
      .replace(/<\/w:sdtContent>[\s\S]*/, '');

  test('after the first keystroke replaces the prompt, the next ones join it inside', () => {
    const { surface } = mount(
      `<w:p><w:r><w:t xml:space="preserve">Name: </w:t></w:r>${sdt(
        `<w:alias w:val="Name"/><w:showingPlcHdr/><w:richText/>`,
        `<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Type here…</w:t></w:r>`
      )}<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>`
    );
    putCaret(surface, 8);
    surface.type('a');
    surface.type('bc');
    expect(surface.session.bodyText()).toBe('Name: abc tail');
    expect(controlContent(surface)).toBe('<w:r><w:t>abc</w:t></w:r>');
    expect(surface.contentControls.atCaret()?.alias).toBe('Name');
    // ArrowRight is what leaves the control, as in Word; the next keystroke lands beside it.
    surface.navigate('right');
    surface.type('Z');
    expect(surface.session.bodyText()).toBe('Name: abc Ztail');
    expect(controlContent(surface)).toBe('<w:r><w:t>abc</w:t></w:r>');
  });

  test('after a content-locked chip the text lands beside it, not inside', () => {
    const { surface } = mount(
      `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>${sdt(
        `<w:alias w:val="Chip"/><w:lock w:val="contentLocked"/><w:richText/>`,
        `<w:r><w:t>LABEL</w:t></w:r>`
      )}</w:p>`
    );
    putCaret(surface, 12);
    surface.type('x');
    expect(surface.session.bodyText()).toBe('before LABELx');
    expect(controlContent(surface)).toBe('<w:r><w:t>LABEL</w:t></w:r>');
  });

  test('at the end of a hyperlink inside a control the text leaves the link but not the control', () => {
    const container = document.createElement('div');
    const result = mountPaginatedSurface(
      container,
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rIdL" Type="${HL}" Target="https://example.com/" TargetMode="External"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` +
            `<w:p>${sdt(
              `<w:alias w:val="L"/><w:richText/>`,
              `<w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="rIdL"><w:r><w:t>site</w:t></w:r></w:hyperlink>`
            )}<w:r><w:t xml:space="preserve"> now</w:t></w:r></w:p></w:body></w:document>`
        ),
      }),
      { scale: 1 }
    );
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;
    putCaret(surface, 8);
    surface.type('!');
    expect(surface.session.bodyText()).toBe('See site! now');
    expect(controlContent(surface)).toBe(
      '<w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="rIdL"><w:r><w:t>site</w:t></w:r></w:hyperlink><w:r><w:t>!</w:t></w:r>'
    );
  });
});
