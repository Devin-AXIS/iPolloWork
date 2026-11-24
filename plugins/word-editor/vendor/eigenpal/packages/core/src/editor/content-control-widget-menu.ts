// The engine's own value pop-ups for dropdown, combo-box and date controls: what a control
// gets when no host renderer took the widget session. Framework-free DOM over the shared
// calendar model, styled by the `docx-content-control-menu` / `-calendar` rules in the core
// stylesheet, which is also what the adapter defaults reuse so one theme covers both.

import type { TranslationKey } from '@docx-editor.dev/i18n';
import {
  calendarMonth,
  calendarDateForKey,
  calendarDateText,
  calendarDateFromText,
  calendarMonthNames,
  isoDateOf,
  parseIsoDate,
  shiftMonth,
  type CalendarDay,
} from './content-control-calendar.ts';
import {
  contentControlPopupKeyDown,
  observeContentControlPopup,
} from './content-control-popup-behavior.ts';
import { createContentControlListNavigation } from './content-control-list-navigation.ts';
import { textFormTranslate } from './text-form-field-translations.ts';
import { hostWindowOf } from './host-realm.ts';

let listSequence = 0;

/** Where a pop-up anchors, in pages-layer pixels. */
export interface ContentControlMenuAnchor {
  /** Left edge of the control's first fragment — the pop-up lines up under it, like Word. */
  readonly left: number;
  /** Bottom edge of that fragment. */
  readonly top: number;
  /** Horizontal extent of the page sheet the control sits on; the pop-up stays inside it. */
  readonly element?: HTMLElement;
  readonly sheetLeft: number;
  readonly sheetRight: number;
}

export interface ContentControlMenuHost {
  readonly document: Document;
  readonly locale: () => string;
  readonly translate: ((key: TranslationKey) => string) | undefined;
  /** Commit a value and close; the surface owns the write and the refusal path. */
  readonly setValue: (controlId: string, value: string) => boolean;
  /** Remove the menu and clear the widget's open state. */
  readonly close: (menu: HTMLElement) => void;
}

function menuShell(host: ContentControlMenuHost, controlId: string): HTMLElement {
  const menu = host.document.createElement('div');
  menu.className = 'docx-content-control-menu';
  menu.dataset.docxMarker = '';
  menu.dataset.docxPart = 'popup';
  menu.addEventListener('keydown', (event) =>
    contentControlPopupKeyDown(menu, event, () => host.close(menu))
  );
  menu.dataset.docxCcId = controlId;
  menu.setAttribute('contenteditable', 'false');
  menu.style.position = 'absolute';
  menu.style.zIndex = '20';
  menu.style.pointerEvents = 'auto';
  // A press inside the pop-up is the pop-up's: the pages layer must not treat it as a caret
  // press (which prevents the default and swallows the compatibility mouse events).
  menu.addEventListener('pointerdown', (event) => event.stopPropagation());
  // Inputs and buttons own their events: Enter must not split a paragraph, and typing
  // must not edit the document.
  for (const type of [
    'keydown',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'copy',
    'cut',
    'paste',
  ]) {
    menu.addEventListener(type, (event) => event.stopPropagation());
  }
  return menu;
}

/**
 * Place a pop-up under its control's left edge and keep it on the sheet.
 *
 * Right-aligning to the widget hung the calendar off the page's left margin for any control
 * near the start of a line. The pop-up is appended first so its width can be read back;
 * an environment that reports no width simply leaves it at the anchor.
 */
export function placeContentControlMenu(
  menu: HTMLElement,
  layer: HTMLElement,
  anchor: ContentControlMenuAnchor | null
): void {
  if (!anchor) {
    layer.append(menu);
    return;
  }
  menu.style.left = `${anchor.left}px`;
  menu.style.top = `${anchor.top}px`;
  const hostLayer = anchor.element
    ? (layer.closest<HTMLElement>('.docx-editor__scroll-container') ?? layer.parentElement ?? layer)
    : layer;
  hostLayer.append(menu);
  if (anchor.element) {
    const stop = observeContentControlPopup(menu, anchor.element);
    const observer = new (hostWindowOf(menu).MutationObserver)(() => {
      if (!menu.isConnected) {
        stop();
        observer.disconnect();
      }
    });
    observer.observe(hostLayer, { childList: true });
    return;
  }
  const width = menu.offsetWidth;
  if (width <= 0) return;
  const overflow = anchor.left + width - anchor.sheetRight;
  if (overflow > 0) {
    menu.style.left = `${Math.max(anchor.sheetLeft, anchor.left - overflow)}px`;
  }
}

/** Retain a refused draft and expose the failure instead of silently dismissing it. */
function commitMenuValue(
  host: ContentControlMenuHost,
  menu: HTMLElement,
  controlId: string,
  value: string
): boolean {
  if (host.setValue(controlId, value)) {
    host.close(menu);
    return true;
  }
  let error = menu.querySelector<HTMLElement>('[data-docx-part=error]');
  if (!error) {
    error = host.document.createElement('div');
    error.dataset.docxPart = 'error';
    error.className = 'docx-content-control-widget-error';
    error.setAttribute('role', 'alert');
    menu.append(error);
  }
  error.hidden = false;
  error.textContent = textFormTranslate(host.translate)('disabledReason.invalidValue');
  return false;
}

/** A dropdown / combo-box list; `items` come from the file's `w:listItem` entries. */
export function buildContentControlListMenu(
  host: ContentControlMenuHost,
  controlId: string,
  kind: 'dropdown' | 'comboBox' | 'buildingBlockGallery',
  items: readonly { readonly displayText: string; readonly value: string }[],
  alias: string | undefined,
  selectedValue?: string
): HTMLElement {
  const menu = menuShell(host, controlId);
  const t = textFormTranslate(host.translate);
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', alias || t(`contentControl.types.${kind}`));
  const list = host.document.createElement('div');
  list.className = 'docx-content-control-menu-list';
  list.dataset.docxPart = 'list';
  list.id = `docx-engine-cc-list-${++listSequence}`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', alias || t(`contentControl.types.${kind}`));
  const navigation = createContentControlListNavigation(host.locale());
  menu.addEventListener('keydown', (event) => navigation.keyDown(event, menu));
  const selectedIndex = items.findIndex((entry) => entry.value === selectedValue);
  for (const [index, item] of items.entries()) {
    const option = host.document.createElement('button');
    option.type = 'button';
    option.className = 'docx-content-control-menu-item';
    option.dataset.docxPart = 'item';
    option.dataset.value = item.value;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(item.value === selectedValue));
    option.tabIndex = index === Math.max(0, selectedIndex) ? 0 : -1;
    option.textContent = item.displayText;
    option.addEventListener('click', () => {
      commitMenuValue(host, menu, controlId, item.value);
    });
    list.append(option);
  }
  // A gallery with nothing to offer says so, as Word's empty gallery does, instead of
  // opening an empty list the reader cannot tell from a broken one.
  if (kind === 'buildingBlockGallery' && items.length === 0) {
    const empty = host.document.createElement('div');
    empty.className = 'docx-content-control-menu-empty';
    empty.dataset.docxPart = 'empty';
    empty.setAttribute('role', 'note');
    empty.tabIndex = 0;
    empty.textContent = t('contentControl.gallery.empty');
    list.append(empty);
  }
  if (kind === 'comboBox') {
    const free = host.document.createElement('input');
    free.type = 'text';
    free.className = 'docx-content-control-menu-input';
    free.dataset.docxPart = 'input';
    free.value = selectedValue ?? '';
    free.setAttribute('aria-label', alias || t('contentControl.types.comboBox'));
    free.setAttribute('aria-autocomplete', 'list');
    free.setAttribute('role', 'combobox');
    free.setAttribute('aria-expanded', 'true');
    free.setAttribute('aria-controls', list.id);
    free.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      commitMenuValue(host, menu, controlId, free.value);
    });
    menu.append(free);
    const footer = host.document.createElement('div');
    footer.className = 'docx-dialog__footer';
    footer.dataset.docxPart = 'footer';
    for (const action of ['cancel', 'apply'] as const) {
      const button = host.document.createElement('button');
      button.type = 'button';
      button.className = `docx-dialog__button${action === 'apply' ? ' docx-dialog__button--primary' : ''}`;
      button.dataset.docxPart = action;
      button.textContent = t(`common.${action}`);
      button.addEventListener('click', () => {
        if (action === 'apply') commitMenuValue(host, menu, controlId, free.value);
        else host.close(menu);
      });
      footer.append(button);
    }
    menu.append(list, footer);
  } else menu.append(list);
  return menu;
}

/**
 * Move keyboard focus into a calendar: the roamed-to day, else the selected day, else today,
 * else the first day of the month. Safe to call before the menu is attached (no-op then), so
 * the surface calls it again once the pop-up is placed.
 */
export function focusContentControlCalendar(menu: HTMLElement, focusIso?: string | null): void {
  const target =
    (focusIso ? menu.querySelector<HTMLElement>(`[data-iso="${focusIso}"]`) : null) ??
    menu.querySelector<HTMLElement>('[data-selected]') ??
    menu.querySelector<HTMLElement>('[data-today]:not([data-other-month])') ??
    menu.querySelector<HTMLElement>('.docx-content-control-calendar-day:not([data-other-month])');
  for (const day of menu.querySelectorAll<HTMLElement>('[data-iso]')) {
    day.tabIndex = day === target ? 0 : -1;
  }
  target?.focus({ preventScroll: true });
}

/**
 * The date picker: month header, weekday row in the locale's order, a six-week grid and a
 * Today button, matching Word's picker. Arrow keys roam the grid and cross month edges; a
 * day press commits an ISO date through the surface.
 */
export function buildContentControlCalendar(
  host: ContentControlMenuHost,
  controlId: string,
  authoredValue: string | undefined,
  alias: string | undefined
): HTMLElement {
  const t = textFormTranslate(host.translate);
  const menu = menuShell(host, controlId);
  menu.classList.add('docx-content-control-calendar');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', alias || t('contentControl.types.date'));
  const selected = authoredValue ? parseIsoDate(authoredValue) : null;
  const selectedIso = selected ? isoDateOf(selected) : null;
  const today = new Date();
  let view = { year: (selected ?? today).getFullYear(), month: (selected ?? today).getMonth() };
  let focusIso: string | null = null;
  let draft = calendarDateText(selectedIso ?? '', host.locale());

  const commit = (iso: string): void => {
    commitMenuValue(host, menu, controlId, iso);
  };
  const stopPress = (node: HTMLElement): void => {
    node.addEventListener('mousedown', (event) => event.stopPropagation());
  };
  // One persistent title: a live region only announces CHANGES to an element already in the
  // tree, so a title recreated on every render would never read out a month change.
  const title = host.document.createElement('div');
  title.className =
    'docx-content-control-calendar-title docx-content-control-calendar-announcement';
  title.dataset.docxPart = 'title';
  title.setAttribute('aria-live', 'polite');
  const render = (): void => {
    const focusedNav = (host.document.activeElement as HTMLElement | null)?.dataset.docxCalendarNav;
    const month = calendarMonth(view.year, view.month, {
      locale: host.locale(),
      selected: selectedIso,
      today,
    });
    const header = host.document.createElement('div');
    header.className = 'docx-content-control-calendar-header';
    header.dataset.docxPart = 'header';
    const previous = host.document.createElement('button');
    previous.type = 'button';
    previous.className = 'docx-content-control-calendar-nav';
    previous.dataset.docxPart = 'previousMonth';
    previous.dataset.docxCalendarNav = 'previous';
    previous.textContent = '‹';
    previous.setAttribute('aria-label', t('contentControl.calendar.previousMonth'));
    title.textContent = month.title;
    const next = host.document.createElement('button');
    next.type = 'button';
    next.className = 'docx-content-control-calendar-nav';
    next.dataset.docxPart = 'nextMonth';
    next.dataset.docxCalendarNav = 'next';
    next.textContent = '›';
    next.setAttribute('aria-label', t('contentControl.calendar.nextMonth'));
    stopPress(previous);
    stopPress(next);
    previous.addEventListener('click', () => {
      view = shiftMonth(view.year, view.month, -1);
      focusIso = null;
      render();
    });
    next.addEventListener('click', () => {
      view = shiftMonth(view.year, view.month, 1);
      focusIso = null;
      render();
    });
    const navigation = host.document.createElement('div');
    navigation.className = 'docx-content-control-calendar-navigation';
    navigation.dataset.docxPart = 'navigation';
    const monthSelect = host.document.createElement('select');
    monthSelect.className = 'docx-content-control-calendar-month';
    monthSelect.dataset.docxPart = 'month';
    monthSelect.dataset.docxCalendarNav = 'month';
    monthSelect.setAttribute('aria-label', t('contentControl.calendar.month'));
    for (const [index, name] of calendarMonthNames(host.locale()).entries()) {
      const option = host.document.createElement('option');
      option.value = String(index);
      option.textContent = name;
      monthSelect.append(option);
    }
    monthSelect.value = String(view.month);
    const year = host.document.createElement('input');
    year.type = 'number';
    year.min = '100';
    year.max = '9999';
    year.value = String(view.year);
    year.className = 'docx-content-control-calendar-year';
    year.dataset.docxPart = 'year';
    year.dataset.docxCalendarNav = 'year';
    year.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        year.blur();
      }
    });
    year.setAttribute('aria-label', t('contentControl.calendar.year'));
    monthSelect.addEventListener('change', () => {
      view.month = Number(monthSelect.value);
      focusIso = null;
      render();
    });
    year.addEventListener('change', () => {
      const value = Number(year.value);
      if (!Number.isInteger(value) || value < 100 || value > 9999) {
        year.value = String(view.year);
        return;
      }
      view.year = value;
      focusIso = null;
      render();
    });
    navigation.append(monthSelect, year);

    const weekdays = host.document.createElement('div');
    weekdays.className = 'docx-content-control-calendar-weekdays';
    weekdays.dataset.docxPart = 'weekdays';
    for (const label of month.weekdays) {
      const weekday = host.document.createElement('span');
      weekday.textContent = label;
      weekdays.append(weekday);
    }

    const grid = host.document.createElement('div');
    grid.className = 'docx-content-control-calendar-grid';
    grid.dataset.docxPart = 'grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', month.title);
    for (let index = 0; index < month.days.length; index += 7) {
      const row = host.document.createElement('div');
      row.className = 'docx-content-control-calendar-week';
      row.setAttribute('role', 'row');
      for (const day of month.days.slice(index, index + 7)) row.append(dayButton(day));
      grid.append(row);
    }

    const entry = host.document.createElement('div');
    entry.className = 'docx-content-control-calendar-entry';
    entry.dataset.docxPart = 'dateEntry';
    const todayButton = host.document.createElement('button');
    todayButton.type = 'button';
    todayButton.className = 'docx-content-control-calendar-today';
    todayButton.dataset.docxPart = 'today';
    todayButton.textContent = t('contentControl.calendar.today');
    stopPress(todayButton);
    todayButton.addEventListener('click', () => commit(isoDateOf(today)));

    const input = host.document.createElement('input');
    input.type = 'text';
    input.className = 'docx-content-control-menu-input';
    input.dataset.docxPart = 'input';
    input.setAttribute('aria-label', t('contentControl.types.date'));
    input.placeholder = calendarDateText('2006-11-22', host.locale());
    input.value = draft;
    input.addEventListener('input', () => {
      draft = input.value;
      input.removeAttribute('aria-invalid');
      error.hidden = true;
    });
    const error = host.document.createElement('div');
    error.className = 'docx-content-control-widget-error';
    error.dataset.docxPart = 'error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    error.textContent = t('disabledReason.invalidValue');
    const applyDraft = () => {
      const iso = calendarDateFromText(draft, host.locale());
      if (iso) commit(iso);
      else {
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        applyDraft();
      }
    });
    const actions = host.document.createElement('div');
    actions.className = 'docx-dialog__footer';
    actions.dataset.docxPart = 'footer';
    for (const action of ['cancel', 'apply'] as const) {
      const button = host.document.createElement('button');
      button.type = 'button';
      button.dataset.docxPart = action;
      button.className = `docx-dialog__button${action === 'apply' ? ' docx-dialog__button--primary' : ''}`;
      button.textContent = t(`common.${action}`);
      button.addEventListener('click', action === 'apply' ? applyDraft : () => host.close(menu));
      actions.append(button);
    }
    header.append(previous, navigation, next, title);
    entry.append(todayButton, input);
    menu.replaceChildren(header, weekdays, grid, entry, error, actions);
    focusContentControlCalendar(menu, focusIso);
    if (focusedNav === 'previous') previous.focus({ preventScroll: true });
    if (focusedNav === 'next') next.focus({ preventScroll: true });
    if (focusedNav === 'month') monthSelect.focus({ preventScroll: true });
    if (focusedNav === 'year') year.focus({ preventScroll: true });
  };
  const dayButton = (day: CalendarDay): HTMLElement => {
    const button = host.document.createElement('button');
    button.type = 'button';
    button.className = 'docx-content-control-calendar-day';
    button.dataset.docxPart = 'day';
    button.textContent = String(day.day);
    button.dataset.iso = day.iso;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', day.label);
    if (day.otherMonth) button.dataset.otherMonth = '';
    if (day.selected) {
      button.dataset.selected = '';
      button.setAttribute('aria-selected', 'true');
    }
    button.setAttribute('aria-selected', String(day.selected));
    if (day.today) {
      button.dataset.today = '';
      button.setAttribute('aria-current', 'date');
    }
    stopPress(button);
    button.addEventListener('click', () => commit(day.iso));
    button.addEventListener('keydown', (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const iso = calendarDateForKey(day.iso, event.key, host.locale(), event.shiftKey);
      if (!iso) return;
      event.preventDefault();
      const target = parseIsoDate(iso)!;
      focusIso = iso;
      if (target.getFullYear() !== view.year || target.getMonth() !== view.month) {
        view = { year: target.getFullYear(), month: target.getMonth() };
        render();
        return;
      }
      focusContentControlCalendar(menu, focusIso);
    });
    return button;
  };
  render();
  return menu;
}
