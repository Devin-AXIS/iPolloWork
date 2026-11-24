import { useLayoutEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import {
  calendarMonthNames,
  calendarDateForKey,
  calendarDateText,
  type CalendarDay,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { Slot } from '../toolbar/Slot';
import { useFormControlTranslate } from '../form-control-translate';
import { useContentControlWidget, type ContentControlWidgetEntry } from './context';

/**
 * Presentation overrides for a value pop-up part. @public
 *
 * Anything beyond these members reaches the rendered element, so a part takes an `id`, an
 * `aria-*` label or a `data-*` test hook. The part's own wiring wins every collision. Pass
 * `asChild` to own the element outright and keep its behavior.
 */
export interface DocxEditorContentControlWidgetPartProps {
  className?: string;
  style?: CSSProperties;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
  id?: string;
  title?: string;
  'aria-label'?: string;
  [attribute: `data-${string}`]: unknown;
  [attribute: `aria-${string}`]: unknown;
}

type Wiring = Record<string, unknown> & {
  className: string;
  style?: CSSProperties;
  key?: string | number;
};

/**
 * Render a part as its packaged element or, with `asChild`, through the host's element.
 *
 * `wiring` (handlers, roles, packaged classes) is spread first and the host's presentation
 * last, except that the packaged class is dropped under `asChild` so a design-system
 * element is not outranked by it.
 */
function part(
  tag: 'div' | 'button' | 'input' | 'select',
  props: DocxEditorContentControlWidgetPartProps,
  wiring: Wiring,
  defaultChildren: ReactNode
): ReactNode {
  if (props.hidden) return null;
  const {
    children,
    asChild,
    className,
    style,
    hidden: _hidden,
    id,
    title,
    'aria-label': ariaLabel,
    ...rest
  } = props;
  const content = children === undefined ? defaultChildren : children;
  const { key, ...elementWiring } = wiring;
  // Presentation attributes the props type advertises win over the packaged defaults;
  // handlers, roles and state stay the part's own.
  const presentation = {
    ...(id !== undefined ? { id } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
  };
  if (asChild) {
    const { className: _packaged, style: packagedStyle, ...handlers } = elementWiring;
    return (
      <Slot
        key={key}
        {...rest}
        {...handlers}
        {...presentation}
        {...(className ? { className } : {})}
        style={{ ...packagedStyle, ...style }}
      >
        {content}
      </Slot>
    );
  }
  const Tag = tag as 'div';
  return (
    <Tag
      key={key}
      {...rest}
      {...elementWiring}
      {...presentation}
      className={[wiring.className, className].filter(Boolean).join(' ')}
      style={{ ...wiring.style, ...style }}
    >
      {content}
    </Tag>
  );
}

const stopPress = (event: { stopPropagation(): void }) => event.stopPropagation();

/** Month navigation row with month and year controls. @public */
export function ContentControlWidgetHeader(props: DocxEditorContentControlWidgetPartProps) {
  return part(
    'div',
    props,
    { className: 'docx-content-control-calendar-header', 'data-docx-part': 'header' },
    <>
      <ContentControlWidgetPreviousMonth />
      <ContentControlWidgetNavigation />
      <ContentControlWidgetNextMonth />
      <ContentControlWidgetTitle className="docx-content-control-calendar-announcement" />
    </>
  );
}

/** Steps the calendar back one month. @public */
export function ContentControlWidgetPreviousMonth(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-nav',
      'data-docx-part': 'previousMonth',
      'aria-label': t('contentControl.calendar.previousMonth'),
      onMouseDown: stopPress,
      onClick: widget.previousMonth,
    },
    '‹'
  );
}

/** Steps the calendar forward one month. @public */
export function ContentControlWidgetNextMonth(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-nav',
      'data-docx-part': 'nextMonth',
      'aria-label': t('contentControl.calendar.nextMonth'),
      onMouseDown: stopPress,
      onClick: widget.nextMonth,
    },
    '›'
  );
}

/** The month and year in view. @public */
export function ContentControlWidgetTitle(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  return part(
    'div',
    props,
    {
      className: 'docx-content-control-calendar-title',
      'data-docx-part': 'title',
      'aria-live': 'polite',
    },
    widget.calendar.title
  );
}

/** Seven weekday labels in the locale's order. @public */
export function ContentControlWidgetWeekdays(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  return part(
    'div',
    props,
    { className: 'docx-content-control-calendar-weekdays', 'data-docx-part': 'weekdays' },
    widget.calendar.weekdays.map((label, index) => <span key={index}>{label}</span>)
  );
}

/** Props for one calendar cell. @public */
export interface ContentControlWidgetDayProps extends DocxEditorContentControlWidgetPartProps {
  day: CalendarDay;
}

/** One calendar cell; a press commits that date, arrow keys roam the grid. @public */
export function ContentControlWidgetDay({ day, ...props }: ContentControlWidgetDayProps) {
  const widget = useContentControlWidget();
  const focused =
    widget.calendar.days.find((cell) => cell.iso === widget.focusIso) ??
    widget.calendar.days.find((cell) => cell.selected) ??
    widget.calendar.days.find((cell) => cell.today && !cell.otherMonth) ??
    widget.calendar.days.find((cell) => !cell.otherMonth);
  const roam = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = calendarDateForKey(day.iso, event.key, widget.session.locale, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    widget.focusDay(next);
  };
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-day',
      'data-docx-part': 'day',
      'data-iso': day.iso,
      role: 'gridcell',
      tabIndex: day.iso === focused?.iso ? 0 : -1,
      'aria-label': day.label,
      ...(day.selected ? { 'data-selected': '', 'aria-selected': true } : {}),
      'aria-current': day.today ? 'date' : undefined,
      'aria-selected': day.selected,
      ...(day.today ? { 'data-today': '' } : {}),
      ...(day.otherMonth ? { 'data-other-month': '' } : {}),
      disabled: !widget.isEnabled,
      onMouseDown: stopPress,
      onClick: () => widget.selectDay(day.iso),
      onKeyDown: roam,
    },
    String(day.day)
  );
}

/** The six-week grid of `Day` cells. @public */
export function ContentControlWidgetGrid(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Roving focus: after the grid renders (possibly a new month), land on the roamed-to day,
  // else the selected day, else today, else the first day of the month.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // Month navigation keeps focus on its button, so repeated Enter presses keep paging.
    const active = grid.ownerDocument.activeElement;
    if (
      active?.closest(
        '[data-docx-part=previousMonth],[data-docx-part=nextMonth],[data-docx-part=month],[data-docx-part=year]'
      )
    )
      return;
    const target =
      (widget.focusIso
        ? grid.querySelector<HTMLElement>(`[data-iso="${widget.focusIso}"]`)
        : null) ??
      grid.querySelector<HTMLElement>('[data-selected]') ??
      grid.querySelector<HTMLElement>('[data-today]:not([data-other-month])') ??
      grid.querySelector<HTMLElement>('[data-docx-part="day"]:not([data-other-month])');
    target?.focus({ preventScroll: true });
  }, [widget.focusIso, widget.calendar]);
  return part(
    'div',
    props,
    {
      ref: gridRef,
      className: 'docx-content-control-calendar-grid',
      'data-docx-part': 'grid',
      role: 'grid',
      'aria-label': widget.calendar.title,
    },
    Array.from({ length: 6 }, (_, index) => (
      <div key={index} role="row" className="docx-content-control-calendar-week">
        {widget.calendar.days.slice(index * 7, index * 7 + 7).map((day) => (
          <ContentControlWidgetDay key={day.iso} day={day} />
        ))}
      </div>
    ))
  );
}

/** Commits the current local date. @public */
export function ContentControlWidgetToday(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-today',
      'data-docx-part': 'today',
      disabled: !widget.isEnabled,
      onMouseDown: stopPress,
      onClick: widget.selectToday,
    },
    t('contentControl.calendar.today')
  );
}

/** The whole date picker, including regional date entry and actions. @public */
export function ContentControlWidgetCalendar(props: DocxEditorContentControlWidgetPartProps) {
  return part(
    'div',
    props,
    { className: 'docx-content-control-calendar', 'data-docx-part': 'calendar' },
    <>
      <ContentControlWidgetHeader />
      <ContentControlWidgetWeekdays />
      <ContentControlWidgetGrid />
      <div className="docx-content-control-calendar-entry" data-docx-part="dateEntry">
        <ContentControlWidgetToday />
        <ContentControlWidgetInput />
      </div>
      <ContentControlWidgetError />
      <ContentControlWidgetFooter />
    </>
  );
}

/** Props for one list entry. @public */
export interface ContentControlWidgetItemProps extends DocxEditorContentControlWidgetPartProps {
  item: ContentControlWidgetEntry;
}

/** One dropdown or combo-box entry; a press commits its value. @public */
export function ContentControlWidgetItem({ item, ...props }: ContentControlWidgetItemProps) {
  const widget = useContentControlWidget();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-menu-item',
      'data-docx-part': 'item',
      'data-value': item.value,
      role: 'option',
      tabIndex:
        widget.items.findIndex((entry) => entry.value === widget.value) < 0
          ? widget.items[0] === item
            ? 0
            : -1
          : widget.value === item.value
            ? 0
            : -1,
      'aria-selected': widget.value === item.value,
      disabled: !widget.isEnabled,
      onMouseDown: stopPress,
      onClick: () => widget.apply(item.value),
    },
    item.displayText
  );
}

/** The list of `Item` entries the control declares. @public */
export function ContentControlWidgetList(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'div',
    props,
    {
      className: 'docx-content-control-menu-list',
      'data-docx-part': 'list',
      role: 'listbox',
      id: widget.listId,
      'aria-label': t(`contentControl.types.${widget.kind}`),
    },
    widget.kind === 'buildingBlockGallery' && widget.items.length === 0 ? (
      <div
        className="docx-content-control-menu-empty"
        data-docx-part="empty"
        role="note"
        tabIndex={0}
      >
        {t('contentControl.gallery.empty')}
      </div>
    ) : (
      widget.items.map((item, index) => <ContentControlWidgetItem key={index} item={item} />)
    )
  );
}

/** Free-text entry for a combo box; Enter commits. @public */
export function ContentControlWidgetInput(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'input',
    props,
    {
      type: 'text',
      className: 'docx-content-control-menu-input',
      'data-docx-part': 'input',
      'aria-label': t(`contentControl.types.${widget.kind}`),
      value: widget.kind === 'date' ? widget.dateText : widget.value,
      placeholder:
        widget.kind === 'date' ? calendarDateText('2006-11-22', widget.session.locale) : undefined,
      'aria-invalid': widget.refused || undefined,
      role: widget.kind === 'comboBox' ? 'combobox' : undefined,
      'aria-expanded': widget.kind === 'comboBox' ? true : undefined,
      'aria-controls': widget.kind === 'comboBox' ? widget.listId : undefined,
      'aria-autocomplete': widget.kind === 'comboBox' ? 'list' : undefined,
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (widget.kind === 'date') widget.applyDateText();
        else widget.apply();
      },
      onMouseDown: stopPress,
      onChange: (event: { target: { value: string } }) =>
        (widget.kind === 'date' ? widget.setDateText : widget.setValue)(event.target.value),
    },
    undefined
  );
}

/** The engine refused the last value. @public */
export function ContentControlWidgetError(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  if (!widget.refused) return null;
  return part(
    'div',
    props,
    { className: 'docx-content-control-widget-error', 'data-docx-part': 'error', role: 'alert' },
    t('disabledReason.invalidValue')
  );
}

/** Commits the draft value. @public */
export function ContentControlWidgetApply(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-dialog__button docx-dialog__button--primary',
      'data-docx-part': 'apply',
      disabled: !widget.isEnabled,
      onClick: () => (widget.kind === 'date' ? widget.applyDateText() : widget.apply()),
    },
    t('common.apply')
  );
}

/** Closes without a write. @public */
export function ContentControlWidgetCancel(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-dialog__button',
      'data-docx-part': 'cancel',
      onClick: widget.cancel,
    },
    t('common.cancel')
  );
}

/** Cancel and Apply row. @public */
export function ContentControlWidgetFooter(props: DocxEditorContentControlWidgetPartProps) {
  return part(
    'div',
    props,
    { className: 'docx-dialog__footer', 'data-docx-part': 'footer' },
    <>
      <ContentControlWidgetCancel />
      <ContentControlWidgetApply />
    </>
  );
}

/** Month selector and numeric year entry. @public */
export function ContentControlWidgetNavigation(props: DocxEditorContentControlWidgetPartProps) {
  return part(
    'div',
    props,
    { className: 'docx-content-control-calendar-navigation', 'data-docx-part': 'navigation' },
    <>
      <ContentControlWidgetMonth />
      <ContentControlWidgetYear />
    </>
  );
}
/** Jump directly to a month. @public */
export function ContentControlWidgetMonth(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'select',
    props,
    {
      className: 'docx-content-control-calendar-month',
      'data-docx-part': 'month',
      'aria-label': t('contentControl.calendar.month'),
      value: widget.calendar.month,
      onChange: (event: { target: { value: string } }) =>
        widget.showMonth(widget.calendar.year, Number(event.target.value)),
    },
    calendarMonthNames(widget.session.locale).map((label, index) => (
      <option key={index} value={index}>
        {label}
      </option>
    ))
  );
}
/** Jump directly to a four-digit year. @public */
export function ContentControlWidgetYear(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'input',
    props,
    {
      type: 'number',
      min: 100,
      max: 9999,
      className: 'docx-content-control-calendar-year',
      'data-docx-part': 'year',
      'aria-label': t('contentControl.calendar.year'),
      key: widget.calendar.year,
      defaultValue: widget.calendar.year,
      onBlur: (event: { target: { value: string } }) => {
        const year = Number(event.target.value);
        // A refused year snaps the field back to the month in view, as the engine menu does,
        // so the box never shows a year the grid is not on.
        if (!Number.isInteger(year) || year < 100 || year > 9999) {
          event.target.value = String(widget.calendar.year);
          return;
        }
        widget.showMonth(year, widget.calendar.month);
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      },
    },
    undefined
  );
}

/** Props for the picture file input. @public */
export interface ContentControlWidgetPictureProps extends DocxEditorContentControlWidgetPartProps {
  /** Open the browser's file dialog as soon as the part mounts. Defaults to true. */
  autoOpen?: boolean;
}

/**
 * The file input of a picture session. A chosen file replaces the control's image through
 * the session; closing the dialog without a file cancels the session. @public
 */
export function ContentControlWidgetPicture({
  autoOpen,
  ...props
}: ContentControlWidgetPictureProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (autoOpen !== false && !opened.current) {
      opened.current = true;
      inputRef.current?.click();
    }
  }, [autoOpen]);
  return part(
    'input',
    props,
    {
      ref: inputRef,
      type: 'file',
      accept: widget.accept,
      className: 'docx-content-control-picture-input',
      'data-docx-part': 'picture',
      'aria-label': t('contentControl.types.picture'),
      'aria-invalid': widget.refused || undefined,
      onMouseDown: stopPress,
      onCancel: widget.cancel,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void widget.replaceImage(file);
      },
    },
    undefined
  );
}
