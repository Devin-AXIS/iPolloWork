// Date values of a date-picker content control: reading an ISO date, and formatting one with
// the control's own `w:dateFormat`. Split from `tree-op-content-controls.ts`.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]{1,15}Z?)?$/;

/** ISO input, validated as a real calendar date rather than a well-shaped string. */
export function parseIsoDate(raw: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return { year, month, day };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Format a date the way the control's own `w:dateFormat` asks.
 *
 * A BOUNDED token substitution over the patterns Word writes, not a locale engine: the format
 * comes out of an untrusted file, so it is walked once, left to right, with no backtracking and
 * no repetition driven by a file-supplied count.
 */
export function formatContentControlDate(
  date: { year: number; month: number; day: number },
  pattern: string | undefined
): string {
  const iso = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  if (!pattern || pattern.length === 0 || pattern.length > 64) return iso;
  let out = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index]!;
    if (char !== 'y' && char !== 'M' && char !== 'd') {
      out += char;
      index += 1;
      continue;
    }
    let run = 0;
    while (index + run < pattern.length && pattern[index + run] === char) run += 1;
    if (char === 'y')
      out += run <= 2 ? String(date.year % 100).padStart(2, '0') : String(date.year);
    else if (char === 'M') {
      out +=
        run >= 4
          ? MONTH_NAMES[date.month - 1]!
          : run === 3
            ? MONTH_NAMES[date.month - 1]!.slice(0, 3)
            : String(date.month).padStart(Math.min(run, 2), '0');
    } else {
      out += String(date.day).padStart(Math.min(run, 2), '0');
    }
    index += run;
  }
  return out;
}
