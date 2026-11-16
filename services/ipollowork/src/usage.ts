/** Calendar-day and calendar-week official-service budgets, including unsettled reservations. */
import type { Store } from "./database.js";
import { ServiceError } from "./errors.js";

const dayMs = 86400000;

/** Resolve midnight and Monday boundaries in the deployment's fixed UTC offset.
 * @param timestamp Current epoch milliseconds.
 * @param offsetMinutes Deployment calendar offset east of UTC.
 * @returns Current day/week starts and their next reset times.
 */
export function usagePeriods(timestamp: number, offsetMinutes: number) {
  const offset = offsetMinutes * 60000;
  const day = Math.floor((timestamp + offset) / dayMs) * dayMs - offset;
  const week = day - ((new Date(day + offset).getUTCDay() + 6) % 7) * dayMs;
  return { day, week, dayReset: day + dayMs, weekReset: week + 7 * dayMs };
}

async function limits(store: Store, userId: string, timestamp: number) {
  const row = await store.one(`SELECT MAX(p.daily_points) AS daily, MAX(p.weekly_points) AS weekly,
    COUNT(*) FILTER (WHERE p.daily_points IS NULL) AS unlimited_daily,
    COUNT(*) FILTER (WHERE p.weekly_points IS NULL) AS unlimited_weekly
    FROM entitlements e JOIN plans p ON p.id=e.plan_id
    WHERE e.user_id=? AND e.revoked_at IS NULL AND e.starts_at<=? AND e.expires_at>? AND p.kind='membership'`, userId, timestamp, timestamp);
  return {
    daily: row?.daily === null || Number(row?.unlimited_daily) > 0 ? null : Number(row?.daily),
    weekly: row?.weekly === null || Number(row?.unlimited_weekly) > 0 ? null : Number(row?.weekly),
  };
}

/** Read current service consumption without treating refunds or personal keys as usage.
 * @param store Account database.
 * @param userId Authenticated account.
 * @param offsetMinutes Deployment calendar offset east of UTC.
 * @param timestamp Epoch milliseconds used for this snapshot.
 * @returns Settled and reserved credits, plan limits and reset times.
 */
export async function accountUsage(store: Store, userId: string, offsetMinutes: number, timestamp = Date.now()) {
  const period = usagePeriods(timestamp, offsetMinutes);
  const cap = await limits(store, userId, timestamp);
  const row = await store.one(`SELECT
    COALESCE(SUM(points) FILTER (WHERE created_at>=?),0) AS daily,
    COALESCE(SUM(points),0) AS weekly,
    COALESCE(SUM(points) FILTER (WHERE created_at>=? AND (state<>'succeeded' OR (billing_snapshot IS NOT NULL AND NOT billing_settled))),0) AS daily_reserved,
    COALESCE(SUM(points) FILTER (WHERE state<>'succeeded' OR (billing_snapshot IS NOT NULL AND NOT billing_settled)),0) AS weekly_reserved
    FROM service_calls WHERE user_id=? AND created_at>=? AND state<>'failed'`, period.day, period.day, userId, period.week);
  const window = (used: number, reserved: number, limit: number | null, resetsAt: number) => ({
    used, reserved, limit, remaining: limit === null ? null : Math.max(0, limit - used), resetsAt,
  });
  return { utcOffsetMinutes: offsetMinutes,
    daily: window(Number(row?.daily ?? 0), Number(row?.daily_reserved ?? 0), cap.daily, period.dayReset),
    weekly: window(Number(row?.weekly ?? 0), Number(row?.weekly_reserved ?? 0), cap.weekly, period.weekReset),
  };
}

/** The caller holds the account wallet lock until the new call reservation commits.
 * @param store Account database in the caller's transaction.
 * @param userId Account charged for this official-service request.
 * @param points New reservation in credits.
 * @param offsetMinutes Deployment calendar offset east of UTC.
 * @returns Resolves when both active membership budgets permit the reservation.
 */
export async function requireUsageBudget(store: Store, userId: string, points: number, offsetMinutes: number) {
  const usage = await accountUsage(store, userId, offsetMinutes);
  if (usage.daily.remaining !== null && points > usage.daily.remaining)
    throw new ServiceError("DAILY_USAGE_LIMIT_REACHED", 429, "本次任务超出今日剩余额度，请在额度重置后重试");
  if (usage.weekly.remaining !== null && points > usage.weekly.remaining)
    throw new ServiceError("WEEKLY_USAGE_LIMIT_REACHED", 429, "本次任务超出本周剩余额度，请在额度重置后重试");
}

/** Return seven complete calendar buckets ending today for the account page. */
export async function recentUsage(store: Store, userId: string, offsetMinutes: number, timestamp = Date.now()) {
  const { day } = usagePeriods(timestamp, offsetMinutes);
  const start = day - 6 * dayMs;
  const rows = await store.all("SELECT FLOOR((created_at+?)/86400000) AS day,SUM(points) AS used FROM service_calls WHERE user_id=? AND created_at>=? AND state<>'failed' GROUP BY 1", offsetMinutes * 60000, userId, start);
  return Array.from({ length: 7 }, (_, index) => {
    const at = start + index * dayMs;
    return { date: new Date(at + offsetMinutes * 60000).toISOString().slice(0, 10), used: Number(rows.find(row => Number(row.day) === Math.floor((at + offsetMinutes * 60000) / dayMs))?.used ?? 0) };
  });
}
