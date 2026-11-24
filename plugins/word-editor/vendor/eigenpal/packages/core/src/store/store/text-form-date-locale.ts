/** Regional input conventions are separate from document formatting and UI catalogues. */
const DEFAULT_LOCALE = 'en-US';
const localeCache = new Map<string, string>();

/** Invalid operation arguments are refused; well-formed unsupported tags use the default. */
export function validLocale(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/** Never depend on the browser or server's ambient locale. */
export function resolveLocale(value: string | undefined): string {
  if (typeof value !== 'string') return DEFAULT_LOCALE;
  const cached = localeCache.get(value);
  if (cached) return cached;
  let locale = DEFAULT_LOCALE;
  if (validLocale(value)) {
    const canonical = Intl.getCanonicalLocales(value)[0]!;
    if (Intl.DateTimeFormat.supportedLocalesOf(canonical).length) locale = canonical;
  }
  if (localeCache.size >= 32) localeCache.clear();
  localeCache.set(value, locale);
  return locale;
}

type DateComponent = 'year' | 'month' | 'day';
interface DateConvention {
  readonly order: readonly DateComponent[];
  readonly pattern: RegExp;
  readonly digits: ReadonlyMap<string, string>;
}
const conventions = new Map<string, DateConvention>();
const stripDirectionMarks = (value: string): string => value.replace(/[\u061c\u200e\u200f]/g, '');
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function textFormDateConvention(locale: string): DateConvention {
  const resolved = resolveLocale(locale);
  const cached = conventions.get(resolved);
  if (cached) return cached;
  // FORMTEXT dates use the Gregorian calendar. Locale selects numeric order, punctuation,
  // and accepted digits; a user's calendar preference must not reinterpret a DOCX year.
  const parts = new Intl.DateTimeFormat(resolved, {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(Date.UTC(2006, 10, 22)));
  const order: DateComponent[] = [];
  const pattern = parts
    .map((part) => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
        order.push(part.type);
        return part.type === 'year' ? '(\\d{2}|\\d{4})' : '(\\d{1,2})';
      }
      return escapePattern(stripDirectionMarks(part.value)).replace(/\s+/gu, '\\s*');
    })
    .join('');
  const digits = new Map<string, string>();
  const numbers = new Intl.NumberFormat(resolved, { useGrouping: false });
  for (let digit = 0; digit <= 9; digit++) {
    digits.set(stripDirectionMarks(numbers.format(digit)), String(digit));
  }
  const convention = { order, pattern: new RegExp(`^${pattern}$`, 'u'), digits };
  if (conventions.size >= 32) conventions.clear();
  conventions.set(resolved, convention);
  return convention;
}

export function normalizeDateDigits(text: string, convention: DateConvention): string {
  return [...stripDirectionMarks(text)]
    .map((digit) => convention.digits.get(digit) ?? digit)
    .join('');
}
