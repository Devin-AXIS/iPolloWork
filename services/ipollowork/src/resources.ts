import { createHash } from "node:crypto";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Config } from "./config.js";
import {
  enterpriseAccess,
  now,
  requireAdmin,
  resourceAccess,
  uid,
} from "./domain.js";
import type { Storage } from "./storage.js";
import { ServiceError } from "./errors.js";

/** OSS stores private bodies; PostgreSQL owns searchable metadata and authorization. */
export function mountResources(
  app: App,
  store: Store,
  storage: Storage,
  config: Config,
) {
  app.get("/api/v1/resources", async (c) => {
    const actor = c.get("actor"),
      q = (c.req.query("q") ?? "").slice(0, 200),
      kind = c.req.query("kind") ?? "skill",
      enterprise = c.req.query("enterpriseId") ?? "";
    const items = await store.all(
      "SELECT id,title,description,kind,version,visibility,enterprise_id,bytes,created_at FROM resources r WHERE kind=? AND (?='' OR enterprise_id=?) AND position(lower(?) in lower(title||' '||description))>0 AND (owner_id=? OR visibility='public' OR ?='admin' OR (visibility='enterprise' AND EXISTS(SELECT 1 FROM members m WHERE m.enterprise_id=r.enterprise_id AND m.user_id=?))) ORDER BY created_at DESC LIMIT 200",
      kind,
      enterprise,
      enterprise,
      q,
      actor.id,
      actor.role,
      actor.id,
    );
    return c.json({ items });
  });
  app.post("/api/v1/resources", async (c) => {
    const actor = c.get("actor");
    let uploaded: Buffer | undefined;
    let payload: unknown;
    if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form = await c.req.formData(),
        file = form.get("file"),
        metadata = form.get("metadata");
      if (!(file instanceof File) || typeof metadata !== "string")
        throw new ServiceError("INVALID_UPLOAD", 400, "请选择文件");
      if (file.size > 24 * 1024 * 1024)
        throw new ServiceError("UPLOAD_TOO_LARGE", 413);
      uploaded = Buffer.from(await file.arrayBuffer());
      payload = JSON.parse(metadata);
    } else payload = await c.req.json();
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(3000).default(""),
        kind: z.enum(["skill", "plugin", "attachment"]),
        version: z.string().max(60).default("1.0.0"),
        visibility: z
          .enum(["public", "enterprise", "private"])
          .default("private"),
        enterpriseId: z.string().nullable().default(null),
        content: z.string().max(2_000_000).default(""),
        mime: z.string().max(100).default("text/markdown"),
      })
      .parse(payload);
    if (input.visibility === "public") requireAdmin(actor);
    if (input.visibility === "enterprise" && !input.enterpriseId)
      throw new ServiceError("ENTERPRISE_REQUIRED", 400);
    if (input.enterpriseId)
      await enterpriseAccess(
        store,
        actor,
        input.enterpriseId,
        input.visibility === "enterprise",
      );
    const id = uid(),
      body = uploaded ?? Buffer.from(input.content, "utf8");
    const storageKey = await storage.put(
      id,
      { userId: actor.id, organizationId: input.enterpriseId },
      input.mime,
      body,
      {
        permanent: input.kind !== "attachment" || input.visibility === "public",
      },
    );
    await storage.persist(storageKey, async () => {
      if (input.enterpriseId)
        await enterpriseAccess(
          store,
          actor,
          input.enterpriseId,
          input.visibility === "enterprise",
        );
      await store.run(
        "INSERT INTO resources(id,owner_id,enterprise_id,kind,visibility,title,description,version,storage_key,mime,bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        actor.id,
        input.enterpriseId,
        input.kind,
        input.visibility,
        input.title,
        input.description,
        input.version,
        storageKey,
        input.mime,
        body.length,
        createHash("sha256").update(body).digest("hex"),
        now(),
      );
    });
    return c.json({ id }, 201);
  });
  app.get("/api/v1/resources/:id/download", async (c) => {
    const resource = await resourceAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    return await storage.download(resource.storage_key, resource.title + "");
  });
  app.get("/api/v1/resources/:id/content", async (c) => {
    const resource = await resourceAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    if (resource.kind !== "skill") throw new ServiceError("NOT_A_SKILL", 400);
    return c.json({
      id: resource.id,
      content: (await storage.read(resource.storage_key)).toString("utf8"),
    });
  });
}
