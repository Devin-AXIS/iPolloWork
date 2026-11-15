/** Credential-free, manager-only analytics returned by the account service. */
import { z } from "zod";
const count = z.number().int().nonnegative().safe();
const metrics = z.object({
  tasks: count, succeeded: count, failed: count, measured: count,
  inputTokens: count, outputTokens: count, points: count,
});
/** Validate bounded analytics responses received from the account service. */
export const enterpriseAnalyticsSchema = z.object({
  from: count, to: count, groupBy: z.enum(["member", "department", "sku"]),
  page: count, pageSize: count, totalRows: count, projects: count,
  totals: metrics, rows: z.array(metrics.extend({ id: z.string(), name: z.string() })),
  skills: count, plugins: count, skillInvocations: count, pluginInvocations: count,
  activityPage: count, activityTotalRows: count,
  activityRows: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["skill", "tool"]), calls: count, succeeded: count })),
});
/** Display records contain only counts and public resource labels. */
export type EnterpriseAnalytics = z.infer<typeof enterpriseAnalyticsSchema>;
