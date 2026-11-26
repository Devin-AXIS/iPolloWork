import { z } from "zod";
import type { Actor } from "./auth.js";
import type { Store } from "./database.js";
import { audit, enterpriseAccess } from "./domain.js";
import { ServiceError } from "./errors.js";
import type { App } from "./http.js";
import type { Settings } from "./settings.js";
import { connectPublicHttps, isSharedMcpEndpoint } from "./enterprise-mcp.js";
import { audienceSchema } from "./grants.js";

const webUrl = z.string().trim().max(2048).refine(value => {
  const url = URL.parse(value);
  return url !== null && ["https:", "http:"].includes(url.protocol)
    && !url.username && !url.password && url.href.length <= 2048;
}).transform(value => new URL(value).href);
const cookieNames = z.array(z.string().min(1).max(128).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)).max(12)
  .refine(items => new Set(items).size === items.length);
const entry = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(80),
  url: webUrl,
  departmentId: z.string().min(1).max(200).nullable(),
  role: z.enum(["owner", "admin", "member"]).nullable(),
  memberIds: z.array(z.string().min(1).max(200)).min(1).max(500).optional(),
  audience: audienceSchema.optional(),
  cookieNames: cookieNames.optional(),
}).strict().refine(item => !item.audience || (!item.departmentId && !item.role && !item.memberIds));
const input = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(entry).max(50).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict();

const ticketInput = z.object({
  endpoint: z.string().max(2048).refine(isSharedMcpEndpoint),
  credential: z.string().max(8192).regex(/^[!-~]*$/).optional(),
}).strict();
const ticketResponse = z.object({
  ticket: z.string().min(1).max(4096).regex(/^[!-~]+$/),
  expiresIn: z.number().int().min(1).max(120),
});

export function mountOrganizationWebsites(app: App, store: Store, settings: Settings, transport = connectPublicHttps) {
  const route = "/api/v1/enterprises/:id/websites";
  const managementRoute = `${route}/manage` as const;
  const websiteRoute = `${route}/:website` as const;
  const key = (id: string) => "organization-websites/" + id;
  const ticketKey = (enterprise: string, website: string) => `organization-website-ticket/${enterprise}/${website}`;
  const read = async (id: string) => {
    const { document } = await settings.get(key(id));
    return document ? input.parse(JSON.parse(document)) : { revision: 0, items: [] };
  };
  async function visible(id: string, actor: Actor) {
    await enterpriseAccess(store, actor, id);
    const member = await store.one<{ role: string; department_id: string | null }>(
      "SELECT role,department_id FROM members WHERE enterprise_id=? AND user_id=? AND status='active'", id, actor.id,
    );
    if (!member) return [];
    const { items } = await read(id);
    const manager = member.role === "owner" || member.role === "admin";
    const ancestors = !manager && member.department_id && items.some(item => item.audience?.includeSubdepartments)
      ? await store.all<{id:string}>(`WITH RECURSIVE parents(id,parent_id) AS (
          SELECT id,parent_id FROM departments WHERE enterprise_id=? AND id=?
          UNION SELECT d.id,d.parent_id FROM departments d JOIN parents p ON d.id=p.parent_id WHERE d.enterprise_id=?
        ) SELECT id FROM parents`, id, member.department_id, id) : [];
    return items.filter(item => {
      const audience = item.audience;
      if (audience) return manager || audience.all || audience.members.includes(actor.id) ||
        (member.department_id !== null && audience.departments.includes(member.department_id)) ||
        (audience.includeSubdepartments === true && ancestors.some(department => audience.departments.includes(department.id)));
      return (item.departmentId === null || item.departmentId === member.department_id)
        && (item.role === null || item.role === member.role)
        && (item.memberIds === undefined || item.memberIds.includes(actor.id));
    });
  }
  async function accessible(id: string, website: string, actor: Actor) {
    const found = (await visible(id, actor)).find(item => item.id === website);
    if (!found) throw new ServiceError("ORGANIZATION_WEBSITE_UNAVAILABLE", 404, "网页入口已移除或权限已变更");
    return found;
  }
  app.get("/api/v1/me/organizations", async c => {
    const organizations = await store.all(
      "SELECT e.id,e.name,m.role FROM members m JOIN enterprises e ON e.id=m.enterprise_id WHERE m.user_id=? AND m.status='active' ORDER BY e.name,e.id",
      c.get("actor").id,
    );
    return c.json({ organizations });
  });
  app.get(route, async c => {
    const items = await visible(c.req.param("id"), c.get("actor"));
    return c.json({ items: items.map(({ id, label }) => ({ id, label })) });
  });
  app.get(managementRoute, async c => {
    const id = c.req.param("id");
    await enterpriseAccess(store, c.get("actor"), id, true);
    return c.json(await read(id));
  });
  app.put(managementRoute, async c => {
    const id = c.req.param("id"), actor = c.get("actor");
    // Reject unauthorized callers before validating the configuration.
    await enterpriseAccess(store, actor, id, true);
    const update = input.parse(await c.req.json());
    if (update.items.some(item => item.cookieNames?.length && !item.url.startsWith("https:")))
      throw new ServiceError("ORGANIZATION_WEBSITE_HTTPS_REQUIRED", 400, "保留登录需要 HTTPS 网页");
    const saved = await store.transaction(async () => {
      await store.one("SELECT id FROM enterprises WHERE id=? FOR UPDATE", id);
      if (actor.role !== "admin") {
        const membership = await store.one<{ role: string }>(
          "SELECT role FROM members WHERE enterprise_id=? AND user_id=? AND status='active' FOR SHARE", id, actor.id,
        );
        if (membership?.role !== "owner" && membership?.role !== "admin")
          throw new ServiceError("ENTERPRISE_FORBIDDEN", 403, "没有组织管理权限");
      }
      const current = await read(id);
      if (current.revision !== update.revision)
        throw new ServiceError("ORGANIZATION_WEBSITES_CONFLICT", 409, "网页入口已经更新，请重新加载");
      const departmentTargets = (item: z.infer<typeof entry>) =>
        item.audience?.departments ?? (item.departmentId ? [item.departmentId] : []);
      const existingDepartments = new Map(current.items.map(item => [item.id, new Set(departmentTargets(item))]));
      const departmentIds = [...new Set(update.items.flatMap(item =>
        departmentTargets(item).filter(departmentId => !existingDepartments.get(item.id)?.has(departmentId))))];
      if (departmentIds.length) {
        const placeholders = departmentIds.map(() => "?").join(",");
        const choices = await store.all(`SELECT id FROM departments WHERE enterprise_id=? AND id IN (${placeholders})`, id, ...departmentIds);
        if (choices.length !== departmentIds.length)
          throw new ServiceError("DEPARTMENT_MISMATCH", 400, "部门不属于该组织");
      }
      const memberTargets = (item: z.infer<typeof entry>) => item.audience?.members ?? item.memberIds ?? [];
      const existingMembers = new Map(current.items.map(item => [item.id, new Set(memberTargets(item))]));
      const memberIds = [...new Set(update.items.flatMap(item =>
        memberTargets(item).filter(memberId => !existingMembers.get(item.id)?.has(memberId))))];
      if (memberIds.length) {
        const choices = await store.all(
          "SELECT user_id FROM members WHERE enterprise_id=? AND status='active' AND user_id=ANY(?::text[])",
          id, memberIds,
        );
        if (choices.length !== memberIds.length)
          throw new ServiceError("MEMBER_NOT_FOUND", 400, "成员不属于该组织或已停用");
      }
      const value = { revision: current.revision + 1, items: update.items };
      for (const item of current.items) {
        // A new destination requires the administrator to review and reconfigure ticket exchange.
        if (!update.items.some(next => next.id === item.id && new URL(next.url).origin === new URL(item.url).origin))
          await store.run("DELETE FROM settings WHERE key=?", ticketKey(id, item.id));
      }
      await settings.set(key(id), { document: JSON.stringify(value) });
      await audit(store, actor, "organization.websites.update", id, id);
      return value;
    });
    return c.json(saved);
  });
  app.get(websiteRoute, async c => {
    const found = await accessible(c.req.param("id"), z.uuid().parse(c.req.param("website")), c.get("actor"));
    return c.json({ url: found.url });
  });
  app.get(`${websiteRoute}/desktop`, async c => {
    const actor = c.get("actor"), enterpriseId = c.req.param("id");
    const site = await accessible(enterpriseId, z.uuid().parse(c.req.param("website")), actor);
    c.header("Cache-Control", "no-store");
    return c.json({ userId: actor.id, enterpriseId, siteId: site.id, label: site.label, url: site.url, cookieNames: site.cookieNames ?? [] });
  });
  const ticketConfigRoute = `${websiteRoute}/ticket-config` as const;
  app.get(ticketConfigRoute, async c => {
    const id = c.req.param("id"), site = z.uuid().parse(c.req.param("website"));
    await enterpriseAccess(store, c.get("actor"), id, true);
    const { endpoint, credential } = await settings.get(ticketKey(id, site));
    c.header("Cache-Control", "no-store");
    return c.json({ endpoint: endpoint ?? "", configured: Boolean(credential) });
  });
  app.put(ticketConfigRoute, async c => {
    const id = c.req.param("id"), site = z.uuid().parse(c.req.param("website")), actor = c.get("actor");
    await enterpriseAccess(store, actor, id, true);
    const update = z.union([ticketInput, z.null()]).parse(await c.req.json());
    await store.transaction(async () => {
      await store.one("SELECT id FROM enterprises WHERE id=? FOR UPDATE", id);
      await enterpriseAccess(store, actor, id, true);
      if (!(await read(id)).items.some(item => item.id === site))
        throw new ServiceError("ORGANIZATION_WEBSITE_UNAVAILABLE", 404, "网页入口已移除");
      const key = ticketKey(id, site);
      if (update === null) {
        await store.run("DELETE FROM settings WHERE key=?", key);
      } else {
        const existing = await settings.get(key);
        const endpoint = new URL(update.endpoint).href;
        if (!update.credential && (endpoint !== existing.endpoint || !existing.credential))
          throw new ServiceError("ORGANIZATION_TICKET_CREDENTIAL_REQUIRED", 400, "新增或变更换票地址需要输入凭证");
        await settings.set(key, { endpoint, credential: update.credential ?? "" });
      }
      await audit(store, actor, "organization.website.ticket.update", site, id);
    });
    return c.json({ configured: update !== null });
  });
  app.post(`${websiteRoute}/ticket`, async c => {
    const id = c.req.param("id"), actor = c.get("actor");
    const site = await accessible(id, z.uuid().parse(c.req.param("website")), actor);
    const { endpoint, credential } = await settings.get(ticketKey(id, site.id));
    if (!endpoint || !credential || !isSharedMcpEndpoint(endpoint))
      throw new ServiceError("ORGANIZATION_TICKET_UNAVAILABLE", 404, "此网页未启用组织换票");
    const body = Buffer.from(JSON.stringify({ organizationId: id, websiteId: site.id, userId: actor.id }));
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(8000)]);
    try {
      const result = await transport(new URL(endpoint), "POST", {
        authorization: `Bearer ${credential}`,
        accept: "application/json", "content-type": "application/json", "content-length": String(body.length),
      }, body, signal);
      try {
        if (result.statusCode !== 200) throw new Error("Ticket request failed");
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of result as AsyncIterable<Buffer>) {
          length += chunk.length;
          if (length > 8192) throw new Error("Ticket response too large");
          chunks.push(chunk);
        }
        const value = ticketResponse.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (value.ticket === credential) throw new Error("Ticket matches credential");
        c.header("Cache-Control", "no-store");
        return c.json(value);
      } finally {
        result.destroy();
      }
    } catch {
      throw new ServiceError("ORGANIZATION_TICKET_FAILED", 503, "业务系统换票失败");
    }
  });
}
