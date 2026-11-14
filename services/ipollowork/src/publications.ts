/** Explicit publications keep staged files private until the complete set is committed. */
import { getMimeType } from "hono/utils/mime";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import type { Actor } from "./auth.js";
import { projectAccess, projectRole, uid, audit } from "./domain.js";
import { ServiceError } from "./errors.js";

const pathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.includes("\\") &&
      !path.includes("\0") &&
      path
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            part !== ".git" &&
            part !== ".ipollo" &&
            !part.startsWith(".env"),
        ),
    "Use a relative output path",
  );
interface Publication {
  id: string;
  owner_id: string;
  project_id: string | null;
  enterprise_id: string | null;
  entry_path: string;
  state: string;
}
const publicUrl = (origin: string, id: string, path: string) =>
  origin + "/p/" + id + "/" + path.split("/").map(encodeURIComponent).join("/");

export function mountPublications(
  app: App,
  store: Store,
  storage: Storage,
  config: Config,
): void {
  const authorize = async (actor: Actor, id: string): Promise<Publication> => {
    const row = await store.one<Publication & Record<string, string | null>>(
      "SELECT * FROM publications WHERE id=?",
      id,
    );
    if (!row || row.owner_id !== actor.id || row.state === "revoked")
      throw new ServiceError("PUBLICATION_NOT_FOUND", 404);
    if (row.project_id) {
      const project = await projectAccess(store, actor, row.project_id);
      if ((await projectRole(store, actor, project)) === "view")
        throw new ServiceError("PROJECT_PARTICIPATION_REQUIRED", 403);
    }
    return row;
  };
  app.get("/api/v1/publications/status", (c) =>
    c.json({ available: Boolean(config.publicationOrigin) }),
  );
  app.post("/api/v1/publications", async (c) => {
    if (!config.publicationOrigin)
      throw new ServiceError(
        "PUBLICATION_NOT_CONFIGURED",
        503,
        "网页发布服务尚未配置",
      );
    const input = z
      .object({
        requestId: z.uuid(),
        entry: pathSchema,
        projectId: z.string().optional(),
        files: z
          .array(
            z
              .object({
                path: pathSchema,
                bytes: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .min(1)
          .max(config.maxPublicationFiles),
      })
      .strict()
      .parse(await c.req.json());
    if (
      new Set(input.files.map((file) => file.path)).size !==
        input.files.length ||
      !input.files.some((file) => file.path === input.entry)
    )
      throw new ServiceError("INVALID_PUBLICATION_FILES", 400);
    if (
      input.files.reduce((sum, file) => sum + file.bytes, 0) >
      config.maxArtifactBytes
    )
      throw new ServiceError("UPLOAD_TOO_LARGE", 413);
    const actor = c.get("actor");
    const result = await store.transaction(async () => {
      const existing = await store.one(
        "SELECT id FROM publications WHERE owner_id=? AND request_id=?",
        actor.id,
        input.requestId,
      );
      if (existing) {
        const saved = await authorize(actor, String(existing.id));
        const files = await store.all(
          "SELECT path,bytes FROM publication_files WHERE publication_id=? ORDER BY path",
          saved.id,
        );
        const expected = new Map(
          input.files.map((file) => [file.path, file.bytes]),
        );
        if (
          saved.entry_path !== input.entry ||
          saved.project_id !== (input.projectId ?? null) ||
          files.length !== expected.size ||
          files.some(
            (file) => expected.get(String(file.path)) !== Number(file.bytes),
          )
        )
          throw new ServiceError("PUBLICATION_REQUEST_CONFLICT", 409);
        return { id: saved.id };
      }
      const project = input.projectId
        ? await projectAccess(store, actor, input.projectId)
        : undefined;
      if (project && (await projectRole(store, actor, project)) === "view")
        throw new ServiceError("PROJECT_PARTICIPATION_REQUIRED", 403);
      const id = uid();
      await store.run(
        "INSERT INTO publications VALUES(?,?,?,?,?,?,'draft',?,NULL)",
        id,
        actor.id,
        project?.id ?? null,
        project?.enterprise_id ?? null,
        input.requestId,
        input.entry,
        Date.now(),
      );
      for (const file of input.files)
        await store.run(
          "INSERT INTO publication_files(publication_id,path,bytes) VALUES(?,?,?)",
          id,
          file.path,
          file.bytes,
        );
      return { id };
    });
    return c.json(result, 201);
  });
  app.put("/api/v1/publications/:id/files/*", async (c) => {
    const actor = c.get("actor"),
      publication = await authorize(actor, c.req.param("id"));
    const path = pathSchema.parse(
      c.req.path
        .split("/files/")
        .slice(1)
        .join("/files/")
        .split("/")
        .map(decodeURIComponent)
        .join("/"),
    );
    const file = await store.one(
      "SELECT * FROM publication_files WHERE publication_id=? AND path=?",
      publication.id,
      path,
    );
    if (!file) throw new ServiceError("PUBLICATION_FILE_NOT_FOUND", 404);
    if (file.storage_key) return c.json({ ok: true });
    if (publication.state !== "draft" || !c.req.raw.body)
      throw new ServiceError("PUBLICATION_NOT_DRAFT", 409);
    const uploaded = await storage.putStream(
      uid(),
      { userId: actor.id, organizationId: publication.enterprise_id },
      getMimeType(path) ?? "application/octet-stream",
      c.req.raw.body,
      Number(file.bytes),
    );
    try {
      await store.transaction(async () => {
        const current = await authorize(actor, publication.id);
        if (current.state !== "draft")
          throw new ServiceError("PUBLICATION_NOT_DRAFT", 409);
        const result = await store.run(
          "UPDATE publication_files SET storage_key=?,sha256=? WHERE publication_id=? AND path=? AND storage_key IS NULL",
          uploaded.storageKey,
          uploaded.sha256,
          publication.id,
          path,
        );
        if (!result.changes)
          throw new ServiceError("PUBLICATION_FILE_CONFLICT", 409);
      });
    } catch (error) {
      if (!(
        error instanceof ServiceError &&
        error.code === "DATABASE_COMMIT_UNKNOWN"
      ))
        await storage.remove(uploaded.storageKey);
      throw error;
    }
    return c.json({ ok: true });
  });
  app.post("/api/v1/publications/:id/publish", async (c) => {
    if (!config.publicationOrigin)
      throw new ServiceError("PUBLICATION_NOT_CONFIGURED", 503);
    const actor = c.get("actor");
    const publication = await store.transaction(async () => {
      await store.one(
        "SELECT id FROM publications WHERE id=? FOR UPDATE",
        c.req.param("id"),
      );
      const current = await authorize(actor, c.req.param("id"));
      if (current.state === "published") return current;
      const files = await store.all(
        "SELECT storage_key FROM publication_files WHERE publication_id=?",
        current.id,
      );
      if (!files.length || files.some((file) => !file.storage_key))
        throw new ServiceError(
          "PUBLICATION_INCOMPLETE",
          409,
          "部分文件尚未上传完成，请重试发布",
        );
      for (const file of files) {
        await storage.retain(String(file.storage_key));
        await storage.publish(String(file.storage_key));
      }
      await store.run(
        "UPDATE publications SET state='published',published_at=? WHERE id=?",
        Date.now(),
        current.id,
      );
      await audit(store, actor, "publication.publish", current.id);
      return current;
    });
    return c.json({
      url: publicUrl(
        config.publicationOrigin,
        publication.id,
        publication.entry_path,
      ),
    });
  });
  app.on(["GET", "HEAD"], "/p/:id/*", async (c) => {
    const path = pathSchema.parse(
      c.req.path.split("/").slice(3).map(decodeURIComponent).join("/"),
    );
    const file = await store.one(
      "SELECT f.* FROM publication_files f JOIN publications p ON p.id=f.publication_id WHERE p.id=? AND p.state='published' AND f.path=?",
      c.req.param("id"),
      path,
    );
    if (!file?.storage_key)
      throw new ServiceError("PUBLICATION_FILE_NOT_FOUND", 404);
    const size = Number(file.bytes);
    let range: { start: number; end: number } | undefined;
    const requested = c.req.header("range");
    if (requested) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
      if (!match || !size || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": "bytes */" + size },
        });
      const start = match[1]
        ? Number(match[1])
        : Math.max(0, size - Number(match[2]));
      const end = match[1]
        ? Math.min(size - 1, match[2] ? Number(match[2]) : size - 1)
        : size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= size
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": "bytes */" + size },
        });
      range = { start, end };
    }
    return new Response(
      c.req.method === "HEAD"
        ? null
        : await storage.stream(String(file.storage_key), range),
      {
        status: range ? 206 : 200,
        headers: {
          "Content-Type": getMimeType(path) ?? "application/octet-stream",
          "Content-Disposition": "inline",
          "Content-Length": String(range ? range.end - range.start + 1 : size),
          "Cache-Control": "public, max-age=60",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          ...(range
            ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
            : {}),
        },
      },
    );
  });
}
