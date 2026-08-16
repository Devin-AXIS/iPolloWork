// Standard 5-field cron matcher + next-run calculator. Kept dependency-free
// so both the renderer (live preview) and the Electron scheduler can rely on
// the same field semantics. Mirrors the model used by opencode-scheduler and
// opencode-tasks:
//
//   ┌───────────── minute (0-59)
//   │ ┌───────────── hour (0-23)
//   │ │ ┌───────────── day of month (1-31)
//   │ │ │ ┌───────────── month (1-12)
//   │ │ │ │ ┌───────────── day of week (0-6, Sunday=0; 7 = Sunday)
//   │ │ │ │ │
//   * * * * *

const MAX_SCAN_MINUTES = 366 * 24 * 60 * 5; // ~5 years, safety bound

export const CRON_FIELDS = ["minute", "hour", "day", "month", "weekday"] as const;
export type CronFieldName = (typeof CRON_FIELDS)[number];

export type CronField = {
  name: CronFieldName;
  min: number;
  max: number;
  values: Set<number>;
};

type CronParse = {
  fields: CronField[];
  raw: Record<CronFieldName, string>;
};

function parseFieldPart(part: string, min: number, max: number, allowSeven: boolean): Set<number> | null {
  const values = new Set<number>();
  const add = (n: number) => {
    if (n < min || n > max) return false;
    if (!allowSeven && n === 7) return false;
    values.add(n);
    return true;
  };

  for (const raw of part.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    const stepMatch = /^(\*|\d+-\d+|\d+)\/(\d+)$/.exec(trimmed);
    if (stepMatch) {
      const base = stepMatch[1];
      const step = Number.parseInt(stepMatch[2], 10);
      if (!Number.isInteger(step) || step <= 0) return null;

      let rangeStart = min;
      let rangeEnd = max;
      if (base !== "*") {
        if (base.includes("-")) {
          const [a, b] = base.split("-").map((n) => Number.parseInt(n, 10));
          if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
          rangeStart = a;
          rangeEnd = b;
        } else {
          const single = Number.parseInt(base, 10);
          if (!Number.isInteger(single)) return null;
          rangeStart = single;
          rangeEnd = max;
        }
      }
      for (let i = rangeStart; i <= rangeEnd; i += step) {
        if (!add(i)) return null;
      }
      continue;
    }

    if (trimmed.includes("-")) {
      const [a, b] = trimmed.split("-").map((n) => Number.parseInt(n, 10));
      if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) return null;
      for (let i = a; i <= b; i++) {
        if (!add(i)) return null;
      }
      continue;
    }

    const single = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(single)) return null;
    if (!add(single)) return null;
  }

  return values;
}

function buildField(name: CronFieldName, raw: string): CronField | null {
  const min = name === "month" || name === "day" ? 1 : 0;
  const max = name === "month" ? 12 : name === "day" ? 31 : name === "weekday" ? 7 : name === "hour" ? 23 : 59;
  const allowSeven = name === "weekday";
  const values = parseFieldPart(raw, min, max, allowSeven);
  if (!values || values.size === 0) return null;
  return { name, min, max, values };
}

export function parseCron(expression: string): CronParse | null {
  const trimmed = expression.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return null;

  const fields: CronField[] = [];
  const raw = {} as Record<CronFieldName, string>;
  for (let i = 0; i < CRON_FIELDS.length; i++) {
    const name = CRON_FIELDS[i];
    const field = buildField(name, parts[i]);
    if (!field) return null;
    fields.push(field);
    raw[name] = parts[i];
  }
  return { fields, raw };
}

function fieldByName(fields: CronField[], name: CronFieldName): CronField {
  return fields.find((f) => f.name === name)!;
}

function normalizeWeekday(weekday: number): number {
  return weekday === 7 ? 0 : weekday;
}

function weekdayMatches(field: CronField, date: Date): boolean {
  const dow = date.getDay();
  if (field.values.has(normalizeWeekday(dow))) return true;
  return field.values.has(7) && dow === 0;
}

export function cronMatches(expression: string, date: Date): boolean {
  const parsed = parseCron(expression);
  if (!parsed) return false;
  const { fields } = parsed;

  const minute = fieldByName(fields, "minute").values.has(date.getMinutes());
  const hour = fieldByName(fields, "hour").values.has(date.getHours());
  const month = fieldByName(fields, "month").values.has(date.getMonth() + 1);
  const day = fieldByName(fields, "day").values.has(date.getDate());
  const dow = weekdayMatches(fieldByName(fields, "weekday"), date);

  const dayRestricted = !parsed.raw.day.includes("*");
  const dowRestricted = !parsed.raw.weekday.includes("*");

  const dayMatch = dayRestricted && dowRestricted ? day || dow : day && dow;
  return minute && hour && month && dayMatch;
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}

/** Next run strictly after `after` (inclusive minute boundary handled by caller). */
export function nextRunAfter(expression: string, after: Date): Date | null {
  const parsed = parseCron(expression);
  if (!parsed) return null;

  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    if (cronMatches(expression, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
