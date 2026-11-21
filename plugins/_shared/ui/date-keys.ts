export function dateOf(instant: number | null): string | null {
  if (instant === null) return null;
  return localDateKey(new Date(instant));
}
function localDateKey(date: Date): string {
  return [String(date.getFullYear()).padStart(4,'0'), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}
export const dateKey = (date: Date) =>
  [String(date.getUTCFullYear()).padStart(4, '0'), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
export const dateValue = (key: string) => new Date(key + 'T00:00:00Z');
export function shiftDay(key: string, days: number): string {
  const date = dateValue(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}
export function shiftMonth(key: string, months: number): string {
  const date = dateValue(key);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  return dateKey(date);
}
export function todayKey(): string {
  return localDateKey(new Date());
}
export function calendarStart(anchor: string): string {
  const first = shiftMonth(anchor, 0);
  const offset = (dateValue(first).getUTCDay() + 6) % 7;
  return shiftDay(first, -offset);
}
