/** Account and organization capacity; changing a limit never removes a native workspace file. */
import { z } from "zod";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Storage } from "./storage.js";
import {
  audit,
  enterpriseAccess,
  projectAccess,
  requireAdmin,
  now,
} from "./domain.js";
import { ServiceError } from "./errors.js";

export function mountStorage(app: App, store: Store, storage: Storage): void {
  app.get("/api/v1/me/storage", async (c) =>
    c.json(await storage.quota("personal", c.get("actor").id)),
  );
  app.get("/api/v1/enterprises/:id/storage", async (c) => {
    await enterpriseAccess(store, c.get("actor"), c.req.param("id"));
    return c.json(await storage.quota("organization", c.req.param("id")));
  });
  app.get("/api/v1/projects/:id/storage", async (c) => {
    const project = await projectAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    return c.json(
      await storage.quota(
        project.enterprise_id ? "organization" : "personal",
        project.enterprise_id ?? project.owner_id,
      ),
    );
  });
  app.get("/api/v1/admin/storage/:scope/:owner", async (c) => {
    requireAdmin(c.get("actor"));
    const scope = z
      .enum(["personal", "organization"])
      .parse(c.req.param("scope"));
    if (
      !(await store.one(
        scope === "personal"
          ? 'SELECT id FROM "user" WHERE id=?'
          : "SELECT id FROM enterprises WHERE id=?",
        c.req.param("owner"),
      ))
    )
      throw new ServiceError("STORAGE_OWNER_NOT_FOUND", 404);
    return c.json(await storage.quota(scope, c.req.param("owner")));
  });
  app.put("/api/v1/admin/storage/:scope/:owner", async (c) => {
    const actor = c.get("actor");
    requireAdmin(actor);
    const scope = z
        .enum(["personal", "organization"])
        .parse(c.req.param("scope")),
      owner = c.req.param("owner");
    const input = z
      .object({ bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
      .strict()
      .parse(await c.req.json());
    if (
      !(await store.one(
        scope === "personal"
          ? 'SELECT id FROM "user" WHERE id=?'
          : "SELECT id FROM enterprises WHERE id=?",
        owner,
      ))
    )
      throw new ServiceError("STORAGE_OWNER_NOT_FOUND", 404);
    await storage.setQuota(scope, owner, input.bytes);
    await audit(store, actor, "storage.quota", scope + "/" + owner);
    return c.json(await storage.quota(scope, owner));
  });
  app.post("/api/v1/projects/:id/publish", async (c) => {
    const actor = c.get("actor");
    await store.transaction(async () => {
      const project = await projectAccess(
        store,
        actor,
        c.req.param("id"),
        true,
      );
      await storage.publishProject(project.id);
      await store.run(
        "UPDATE projects SET published_at=COALESCE(published_at,?) WHERE id=?",
        now(),
        project.id,
      );
      await audit(store, actor, "project.publish", project.id);
    });
    return c.json({ ok: true });
  });
}
