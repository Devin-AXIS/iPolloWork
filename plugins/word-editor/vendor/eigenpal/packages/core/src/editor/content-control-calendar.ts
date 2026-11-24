// The date-picker model shared by every date-control pop-up: the engine's own calendar, the
// React and Vue default pop-ups, and any host that composes its own picker over the session.
//
// Framework-neutral on purpose. A pop-up is only a view over this month grid, so three views
// cannot disagree about which weekday a month starts on, how a day is named, or what "today"
// means. Locale comes from the editor's `locale` option, never from the browser, matching the
// legacy text-form date conventions in `store/store/text-form-date-locale.ts`.

import {
  normalizeDateDigits,
  textFormDateConvention,
  resolveLocale,
} from '../store/store/text-form-date-locale.ts';

/** One cell of a month grid. @public */
export interface CalendarDay {
  /** Local calendar date as `YYYY-MM-DD`. */
  readonly iso: string;
  /** Day of the month, 1-based. */
  readonly day: number;
  /** Accessible name, spelled out in the calendar locale. */
  readonly label: string;
  /** The cell pads the grid from the previous or next month. */
  readonly otherMonth: boolean;
  /** The cell is the control's current value. */
  readonly selected: boolean;
  /** The cell is the current local date. */
  readonly today: boolean;
}

/** A six-week month grid plus its labels. @public */
export interface CalendarMonth {
  readonly year: number;
  /** Zero-based, like `Date#getMonth`. */
  readonly month: number;
  /** Month and year, formatted in the calendar locale. */
  readonly title: string;
  /** Seven weekday labels, starting on the locale's first day of the week. */
  readonly weekdays: readonly string[];
  /** Exactly 42 cells, so the pop-up keeps one height across months. */
  readonly days: readonly CalendarDay[];
}

/** Inputs for {@link calendarMonth}. @public */
export interface CalendarMonthOptions {
  /** BCP 47 tag; an unsupported tag falls back to `en-US`. */
  readonly locale?: string;
  /** The control's current value as `YYYY-MM-DD`, or empty. */
  readonly selected?: string | null;
  /** The reference "today"; defaults to the current local date. */
  readonly today?: Date;
}

const CELLS = 42;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Locales whose week starts on Sunday when the runtime cannot say. */
const SUNDAY_FIRST_REGIONS = new Set([
  'AG',
  'AS',
  'BD',
  'BR',
  'BS',
  'BT',
  'BW',
  'BZ',
  'CA',
  'CO',
  'DM',
  'DO',
  'ET',
  'GT',
  'GU',
  'HK',
  'HN',
  'ID',
  'IL',
  'IN',
  'JM',
  'JP',
  'KE',
  'KH',
  'KR',
  'LA',
  'MH',
  'MM',
  'MO',
  'MT',
  'MX',
  'MZ',
  'NI',
  'NP',
  'PA',
  'PE',
  'PH',
  'PK',
  'PR',
  'PT',
  'PY',
  'SA',
  'SG',
  'SV',
  'TH',
  'TT',
  'TW',
  'UM',
  'US',
  'VE',
  'VI',
  'WS',
  'YE',
  'ZA',
  'ZW',
]);
const SATURDAY_FIRST_REGIONS = new Set([
  'AE',
  'AF',
  'BH',
  'DJ',
  'DZ',
  'EG',
  'IQ',
  'IR',
  'JO',
  'KW',
  'LY',
  'OM',
  'QA',
  'SD',
  'SY',
]);

/** Format a local date as `YYYY-MM-DD`. @public */
export function isoDateOf(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Parse the leading `YYYY-MM-DD` of an ISO value as a LOCAL date, or null.
 *
 * A control's `w:fullDate` is `YYYY-MM-DDT00:00:00Z`; only its calendar date matters here,
 * and reading it through `Date` in a western time zone would show the previous day.
 * @public
 */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * First day of the week for a locale, as `Date#getDay` counts it (0 = Sunday).
 *
 * Asks the runtime's week data when it has any, and otherwise falls back to a region table
 * so a server without ICU week info still starts a US calendar on Sunday.
 * @public
 */
export function firstDayOfWeek(locale?: string): number {
  const resolved = resolveLocale(locale);
  try {
    const tag = new Intl.Locale(resolved);
    const info = tag as {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (typeof firstDay === 'number' && firstDay >= 1 && firstDay <= 7) return firstDay % 7;
    const region = tag.maximize().region;
    if (region && SUNDAY_FIRST_REGIONS.has(region)) return 0;
    if (region && SATURDAY_FIRST_REGIONS.has(region)) return 6;
  } catch {
    // Fall through to Monday, the ISO 8601 default.
  }
  return 1;
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** Month-and-year title for a grid, formatted in the calendar locale. @public */
export function calendarMonthTitle(year: number, month: number, locale?: string): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    calendar: 'gregory',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month, 1));
}

/** Seven weekday labels starting on the locale's first weekday. @public */
export function calendarWeekdays(locale?: string): readonly string[] {
  const resolved = resolveLocale(locale);
  const formatter = new Intl.DateTimeFormat(resolved, { calendar: 'gregory', weekday: 'narrow' });
  const first = firstDayOfWeek(resolved);
  // 2024-01-07 is a Sunday: index 0 of the week that starts there.
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(2024, 0, 7 + ((first + index) % 7)))
  );
}

/**
 * Build the six-week grid for one month.
 *
 * Bounded by construction: 42 cells whatever the month, and every value is derived from the
 * year and month numbers, never from document text.
 * @public
 */
export function calendarMonth(
  year: number,
  month: number,
  options: CalendarMonthOptions = {}
): CalendarMonth {
  const locale = resolveLocale(options.locale);
  const selected = options.selected ? parseIsoDate(options.selected) : null;
  const today = options.today ?? new Date();
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    calendar: 'gregory',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const first = firstDayOfWeek(locale);
  const lead = (new Date(year, month, 1).getDay() - first + 7) % 7;
  const days: CalendarDay[] = [];
  for (let index = 0; index < CELLS; index += 1) {
    const date = new Date(year, month, index - lead + 1);
    days.push({
      iso: isoDateOf(date),
      day: date.getDate(),
      label: dayFormatter.format(date),
      otherMonth: date.getMonth() !== month,
      selected: selected !== null && sameDay(date, selected),
      today: sameDay(date, today),
    });
  }
  return {
    year,
    month,
    title: calendarMonthTitle(year, month, locale),
    weekdays: calendarWeekdays(locale),
    days,
  };
}

/** The month after or before `(year, month)`, wrapping the year. @public */
export function shiftMonth(
  year: number,
  month: number,
  delta: 1 | -1
): { readonly year: number; readonly month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** Calendar keyboard destination. Shift+PageUp/PageDown moves one year. @public */
export function calendarDateForKey(
  iso: string,
  key: string,
  locale?: string,
  shift = false
): string | null {
  const date = parseIsoDate(iso);
  if (!date) return null;
  const steps: Readonly<Record<string, number>> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };
  const weekday = (date.getDay() - firstDayOfWeek(locale) + 7) % 7;
  if (key === 'PageUp' || key === 'PageDown') {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + (key === 'PageUp' ? -1 : 1) * (shift ? 12 : 1));
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, last));
  } else {
    const step = key === 'Home' ? -weekday : key === 'End' ? 6 - weekday : steps[key];
    if (step === undefined) return null;
    date.setDate(date.getDate() + step);
  }
  return date.getFullYear() >= 100 && date.getFullYear() <= 9999 ? isoDateOf(date) : null;
}

/** Format an ISO date for numeric entry in the editor locale. @public */
export function calendarDateText(iso: string, locale?: string): string {
  const date = parseIsoDate(iso);
  if (!date) return '';
  const resolved = resolveLocale(locale);
  const zero = new Intl.NumberFormat(resolved, { useGrouping: false }).format(0);
  return new Intl.DateTimeFormat(resolved, {
    calendar: 'gregory',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
    .formatToParts(date)
    .map((part) => (part.type === 'year' ? part.value.padStart(4, zero) : part.value))
    .join('');
}

/** Parse a complete ISO or regional numeric date; ambiguous two-digit years are refused. @public */
export function calendarDateFromText(text: string, locale?: string): string | null {
  if (text.length > 100) return null;
  const trimmed = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = parseIsoDate(trimmed);
    return date ? isoDateOf(date) : null;
  }
  const convention = textFormDateConvention(resolveLocale(locale));
  const match = convention.pattern.exec(normalizeDateDigits(trimmed, convention));
  if (!match) return null;
  const parts = { year: '', month: '', day: '' };
  convention.order.forEach((key, index) => {
    parts[key] = match[index + 1]!;
  });
  if (parts.year.length !== 4) return null;
  const iso = `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`;
  return parseIsoDate(iso) ? iso : null;
}

/** The twelve Gregorian month names for a month selector. @public */
export function calendarMonthNames(locale?: string): readonly string[] {
  const formatter = new Intl.DateTimeFormat(resolveLocale(locale), {
    calendar: 'gregory',
    month: 'long',
  });
  return Array.from({ length: 12 }, (_, month) => formatter.format(new Date(2000, month, 1)));
}
