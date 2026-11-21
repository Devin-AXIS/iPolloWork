import { z } from "zod";
import type { Actor } from "./auth.js";
import type { Store } from "./database.js";
import { audit, enterpriseAccess } from "./domain.js";
import { ServiceError } from "./errors.js";
import type { App } from "./http.js";
import type { Settings } from "./settings.js";

const webUrl = z.string().trim().max(2048).refine(value => {
  const url = URL.parse(value);
  return url !== null && ["https:", "http:"].includes(url.protocol)
    && !url.username && !url.password && url.href.length <= 2048;
}).transform(value => new URL(value).href);
const entry = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(80),
  url: webUrl,
  departmentId: z.string().min(1).max(200).nullable(),
  role: z.enum(["owner", "admin", "member"]).nullable(),
}).strict();
const input = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(entry).max(50).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict();

export function mountOrganizationWebsites(app: App, store: Store, settings: Settings) {
  const route = "/api/v1/enterprises/:id/websites";
  const managementRoute = `${route}/manage` as const;
  const websiteRoute = `${route}/:website` as const;
  const key = (id: string) => "organization-websites/" + id;
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
    return (await read(id)).items.filter(item =>
      (item.departmentId === null || item.departmentId === member.department_id)
      && (item.role === null || item.role === member.role));
  }
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
      const existingDepartments = new Map(current.items.map(item => [item.id, item.departmentId]));
      const departmentIds = [...new Set(update.items.flatMap(({ id, departmentId }) =>
        departmentId && departmentId !== existingDepartments.get(id) ? [departmentId] : []))];
      if (departmentIds.length) {
        const placeholders = departmentIds.map(() => "?").join(",");
        const choices = await store.all(`SELECT id FROM departments WHERE enterprise_id=? AND id IN (${placeholders})`, id, ...departmentIds);
        if (choices.length !== departmentIds.length)
          throw new ServiceError("DEPARTMENT_MISMATCH", 400, "部门不属于该组织");
      }
      const value = { revision: current.revision + 1, items: update.items };
      await settings.set(key(id), { document: JSON.stringify(value) });
      await audit(store, actor, "organization.websites.update", id, id);
      return value;
    });
    return c.json(saved);
  });
  app.get(websiteRoute, async c => {
    const id = z.uuid().parse(c.req.param("website"));
    const found = (await visible(c.req.param("id"), c.get("actor"))).find(item => item.id === id);
    if (!found) throw new ServiceError("ORGANIZATION_WEBSITE_UNAVAILABLE", 404, "网页入口已移除或权限已变更");
    return c.json({ url: found.url });
  });
}
