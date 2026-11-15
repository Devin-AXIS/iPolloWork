/** Manager-only aggregates of enterprise-owned service calls, without prompts or response bodies. */
import { z } from "zod";
import type { Store } from "./database.js";
import type { App } from "./http.js";
import { createHash } from "node:crypto";
import { enterpriseAccess, projectAccess } from "./domain.js";
import { usageResponse } from "./pricing.js";

const count = z.number().int().nonnegative().safe();

/** Extract provider-reported tokens; absent or malformed usage stays unknown and cannot fail a service call.
 * @param bytes Complete response bytes.
 * @param contentType Provider response content type.
 * @returns Token counts or null when neither count is reported.
 */
export function tokenUsage(bytes: Buffer, contentType: string): { input: number; output: number } | null {
  try {
    const body = z.object({ usage: z.object({
      prompt_tokens: count.optional(), input_tokens: count.optional(),
      completion_tokens: count.optional(), output_tokens: count.optional(), total_tokens: count.optional(),
    }) }).parse(usageResponse(bytes, contentType));
    const input = body.usage.prompt_tokens ?? body.usage.input_tokens;
    const output = body.usage.completion_tokens ?? body.usage.output_tokens;
    if (input === undefined && output === undefined) return null;
    // Do not invent an input/output split from total_tokens alone.
    if (input === undefined || output === undefined) return null;
    return { input, output };
  } catch (error) {
    return null; // Optional analytics must not change provider delivery or billing behavior.
  }
}

const querySchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
  groupBy: z.enum(["member", "department", "sku"]).default("department"),
  page: z.number().int().min(1).max(10000).default(1),
  activityPage: z.number().int().min(1).max(10000).default(1),
}).strict();
const pageSize = 25;

/** Register bounded analytics. Service and department attribution is immutable at dispatch; project counts use current ownership.
 * @param app Authenticated account router.
 * @param store Account database.
 */
export function mountEnterpriseAnalytics(app: App, store: Store): void {
  app.post("/api/v1/projects/:id/activity", async c => {
    const actor = c.get("actor");
    const input = z.object({
      sessionId: z.string().min(1).max(200), callId: z.string().min(1).max(200),
      kind: z.enum(["skill", "tool"]), name: z.string().min(1).max(200), succeeded: z.boolean(),
    }).strict().parse(await c.req.json());
    const project = await projectAccess(store, actor, c.req.param("id"));
    if (!project.enterprise_id) return c.json({ recorded: false });
    await enterpriseAccess(store, actor, project.enterprise_id);
    const member = await store.one("SELECT department_id FROM members WHERE enterprise_id=? AND user_id=?", project.enterprise_id, actor.id);
    const id = createHash("sha256").update(JSON.stringify([actor.id, project.id, input.sessionId, input.callId])).digest("hex");
    await store.run(`INSERT INTO enterprise_activity(id,enterprise_id,project_id,user_id,department_id,kind,name,succeeded,created_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, id, project.enterprise_id, project.id, actor.id,
      member?.department_id ?? null, input.kind, input.name, input.succeeded, Date.now());
    return c.json({ recorded: true });
  });
  app.post("/api/v1/enterprises/:id/analytics", async c => {
    const enterpriseId = c.req.param("id");
    await enterpriseAccess(store, c.get("actor"), enterpriseId, true);
    const query = querySchema.parse(await c.req.json());
    const to = Date.now(), from = to - query.days * 86400000;
    const dimensions = {
      member: ["c.user_id", "COALESCE(u.name,c.user_id)"],
      department: ["COALESCE(c.department_id,'')", "COALESCE(d.name,c.department_id,'')"],
      sku: ["c.service_id || ':' || COALESCE(c.model_id,'')", "s.title || CASE WHEN c.model_id IS NULL THEN '' ELSE ' / ' || c.model_id END"],
    } as const;
    const [key, label] = dimensions[query.groupBy];
    const aggregate = `COUNT(*) AS tasks, COUNT(*) FILTER (WHERE c.state='succeeded') AS succeeded,
      COUNT(*) FILTER (WHERE c.state='failed') AS failed,
      COUNT(*) FILTER (WHERE c.input_tokens IS NOT NULL AND c.output_tokens IS NOT NULL) AS measured,
      COALESCE(SUM(c.input_tokens),0) AS input_tokens, COALESCE(SUM(c.output_tokens),0) AS output_tokens,
      COALESCE(SUM(c.points) FILTER (WHERE c.state='succeeded'),0) AS points`;
    const base = `FROM service_calls c JOIN execution_services s ON s.id=c.service_id
      LEFT JOIN "user" u ON u.id=c.user_id LEFT JOIN departments d ON d.id=c.department_id AND d.enterprise_id=c.enterprise_id
      WHERE c.enterprise_id=? AND c.created_at>=? AND c.created_at<? AND NOT c.is_job_poll`;
    const [total, rows, groups, projects, assets] = await Promise.all([
      store.one(`SELECT ${aggregate} ${base}`, enterpriseId, from, to),
      store.all(`SELECT ${key} AS id, ${label} AS name, ${aggregate} ${base}
        GROUP BY 1,2 ORDER BY tasks DESC,id LIMIT ? OFFSET ?`, enterpriseId, from, to, pageSize, (query.page - 1) * pageSize),
      store.one(`SELECT COUNT(DISTINCT ${key}) AS count ${base}`, enterpriseId, from, to),
      store.one("SELECT COUNT(*) AS count FROM projects WHERE enterprise_id=? AND created_at>=? AND created_at<?", enterpriseId, from, to),
      store.one("SELECT COUNT(*) FILTER (WHERE kind='skill') AS skills, COUNT(*) FILTER (WHERE kind='plugin') AS plugins FROM resources WHERE enterprise_id=?", enterpriseId),
    ]);
    const metrics = (row: NonNullable<typeof total>) => ({
      tasks: Number(row.tasks), succeeded: Number(row.succeeded), failed: Number(row.failed),
      measured: Number(row.measured), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), points: Number(row.points),
    });
    const activityDimension = {
      member: ["a.user_id", "COALESCE(u.name,a.user_id)"],
      department: ["COALESCE(a.department_id,'')", "COALESCE(d.name,a.department_id,'')"],
      sku: ["a.name", "a.name"],
    } as const;
    const [activityKey, activityLabel] = activityDimension[query.groupBy];
    const activityBase = `FROM enterprise_activity a LEFT JOIN "user" u ON u.id=a.user_id
      LEFT JOIN departments d ON d.id=a.department_id AND d.enterprise_id=a.enterprise_id
      WHERE a.enterprise_id=? AND a.created_at>=? AND a.created_at<?`;
    const [activity, activityRows, activityGroups] = await Promise.all([
      store.one(`SELECT COUNT(*) FILTER (WHERE kind='skill') AS skills, COUNT(*) FILTER (WHERE kind='tool') AS tools ${activityBase}`, enterpriseId, from, to),
      store.all(`SELECT ${activityKey} AS id,${activityLabel} AS name,a.kind,COUNT(*) AS calls,COUNT(*) FILTER (WHERE a.succeeded) AS succeeded
        ${activityBase} GROUP BY 1,2,3 ORDER BY calls DESC,id,kind LIMIT ? OFFSET ?`, enterpriseId, from, to, pageSize, (query.activityPage-1)*pageSize),
      store.one(`SELECT COUNT(*) AS count FROM (SELECT ${activityKey},a.kind ${activityBase} GROUP BY 1,2) groups`, enterpriseId, from, to),
    ]);
    return c.json({ from, to, groupBy: query.groupBy, page: query.page, pageSize,
      totalRows: Number(groups?.count ?? 0), projects: Number(projects?.count ?? 0),
      totals: metrics(total!), rows: rows.map(row => ({ id: String(row.id), name: String(row.name), ...metrics(row) })),
      // Inventory is current; activity covers only reported calls in linked enterprise projects.
      skills: Number(assets?.skills ?? 0), plugins: Number(assets?.plugins ?? 0),
      skillInvocations: Number(activity?.skills ?? 0), pluginInvocations: Number(activity?.tools ?? 0),
      activityPage: query.activityPage, activityTotalRows: Number(activityGroups?.count ?? 0),
      activityRows: activityRows.map(row => ({ id: String(row.id), name: String(row.name), kind: String(row.kind), calls: Number(row.calls), succeeded: Number(row.succeeded) })),
    });
  });
}
