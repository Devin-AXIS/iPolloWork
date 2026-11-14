import { ExecutionService, mountExecution } from "./execution.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { Store, migrate } from "./database.js";
import { createAuth } from "./auth.js";
import type { App } from "./http.js";
import { Settings } from "./settings.js";
import { Storage } from "./storage.js";
import { mountStorage } from "./storage-http.js";
import { seedOfficialServices } from "./official-services.js";
import { audit, now, requireAdmin, wallet } from "./domain.js";
import { ServiceError } from "./errors.js";
import { mountProjectSpace } from "./project-space.js";
import { mountProjectArchive } from "./project-archive.js";
import { mountCollaboration } from "./collaboration.js";
import { mountEnterprise } from "./enterprise.js";
import { mountPayments } from "./payments.js";
import { mountEnterpriseAssets } from "./enterprise-assets.js";
import { mountResources } from "./resources.js";
import { LiveshareRelay } from "./liveshare.js";
import { mountLiveshare } from "./liveshare-http.js";

export const settingFields: Record<string, readonly string[]> = {
  stripe: ["secretKey", "webhookSecret"],
  oss: ["region", "bucket", "accessKeyId", "accessKeySecret"],
  app_store: [
    "bundleId",
    "issuerId",
    "keyId",
    "privateKey",
    "rootPaths",
    "environment",
    "appAppleId",
  ],
};
const secrets = new Set([
  "secretKey",
  "webhookSecret",
  "accessKeyId",
  "accessKeySecret",
  "privateKey",
]);

/** Create the standalone HTTP service and its local persistence owner. */
export async function createService(config: Config) {
  const store = new Store(config);
  try {
    const auth = await createAuth(config, store);
    await migrate(store, config);
    await seedOfficialServices(store);
    const settings = new Settings(store, config.secret);
    const storage = new Storage(store, settings, config);
    const app: App = new Hono();
    const relay = new LiveshareRelay(store, config);
    const accountHeaders = secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    });
    const viewerHeaders = secureHeaders();
    app.use("*", async (c, next) =>
      c.req.path.startsWith("/__liveshare/assets/")
        ? await viewerHeaders(c, next)
        : await accountHeaders(c, next),
    );
    const regularBody = bodyLimit({
      maxSize: 25 * 1024 * 1024,
      onError: (c) => c.json({ error: "文件不能超过 24 MB" }, 413),
    });
    app.use("*", (c, next) =>
      /^\/api\/v1\/projects\/[^/]+\/artifacts\/upload$/.test(c.req.path)
        ? next()
        : regularBody(c, next),
    );
    app.onError((error, c) => {
      if (error instanceof ServiceError)
        return c.json({ error: error.message, code: error.code }, error.status);
      if (error instanceof z.ZodError)
        return c.json(
          {
            error: error.issues
              .map((i) => i.path.join(".") + ": " + i.message)
              .join("; "),
            code: "INVALID_INPUT",
          },
          400,
        );
      if (error instanceof SyntaxError)
        return c.json(
          { error: "请求内容不是有效 JSON", code: "INVALID_JSON" },
          400,
        );
      if ("code" in error && error.code === "23505")
        return c.json({ error: "记录已存在", code: "CONFLICT" }, 409);
      console.error("request failed", error.name, error.message);
      return c.json(
        { error: "服务暂时无法完成请求", code: "INTERNAL_ERROR" },
        500,
      );
    });
    app.get("/api/health", (c) =>
      c.json({
        ok: true,
        service: "ipollowork-services",
        database: "postgresql",
      }),
    );
    app.get("/.well-known/ipollowork", (c) =>
      c.json({
        service: "ipollowork-services",
        version: 1,
        api: "/api/v1",
        auth: "/api/auth",
        features: [
          "accounts",
          "points",
          "plans",
          "enterprises",
          "sharing",
          "resources",
        ],
      }),
    );
    app.on(["GET", "POST"], "/api/auth/*", async (c) => {
      // Native Work sends JSON credentials without cookies or a browser Origin.
      // Cookie-bearing and explicit cross-origin requests still use Better Auth's checks.
      if (
        ["/api/auth/sign-in/email", "/api/auth/sign-up/email"].includes(
          c.req.path,
        ) &&
        c.req.method === "POST" &&
        !c.req.header("origin") &&
        !c.req.header("cookie") &&
        c.req.header("content-type")?.startsWith("application/json")
      ) {
        const headers = new Headers(c.req.raw.headers);
        headers.set("origin", config.origin);
        return await auth.handler(new Request(c.req.raw, { headers }));
      }
      return await auth.handler(c.req.raw);
    });
    app.use("/api/v1/*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      const origin = c.req.header("origin");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
        origin &&
        origin !== config.origin
      )
        throw new ServiceError("ORIGIN_FORBIDDEN", 403);
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session || session.user.banned)
        throw new ServiceError("SIGN_IN_REQUIRED", 401, "请先登录");
      c.set("actor", {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role ?? "user",
        emailVerified: session.user.emailVerified,
      });
      try {
        await next();
      } finally {
        if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method))
          await relay.refresh();
      }
    });
    const summary = async (userId: string) => ({
      points: await wallet(store, userId),
      entitlements: await store.all(
        "SELECT e.*,p.name FROM entitlements e JOIN plans p ON p.id=e.plan_id WHERE e.user_id=? AND e.revoked_at IS NULL AND e.expires_at>? ORDER BY e.expires_at DESC LIMIT 100",
        userId,
        now(),
      ),
      enterprises: await store.all(
        "SELECT e.id,e.name,m.role FROM enterprises e JOIN members m ON m.enterprise_id=e.id WHERE m.user_id=? LIMIT 200",
        userId,
      ),
    });
    app.get("/api/v1/me/summary", async (c) =>
      c.json({ user: c.get("actor"), ...(await summary(c.get("actor").id)) }),
    );
    app.get("/api/v1/me/points", async (c) =>
      c.json({
        ...(await wallet(store, c.get("actor").id)),
        items: await store.all(
          "SELECT id,amount,balance_after,reason,created_at FROM ledger WHERE user_id=? ORDER BY created_at DESC,sequence DESC LIMIT 100",
          c.get("actor").id,
        ),
      }),
    );
    app.get("/api/v1/me/orgs", async (c) =>
      c.json({ items: (await summary(c.get("actor").id)).enterprises }),
    );
    app.get("/api/v1/admin/overview", async (c) => {
      requireAdmin(c.get("actor"));
      return c.json({
        users: (await store.one('SELECT COUNT(*) AS value FROM "user"'))?.value,
        enterprises: (
          await store.one("SELECT COUNT(*) AS value FROM enterprises")
        )?.value,
        paidOrders: (
          await store.one(
            "SELECT COUNT(*) AS value FROM orders WHERE status='paid'",
          )
        )?.value,
        points: (
          await store.one("SELECT COALESCE(SUM(amount),0) AS value FROM ledger")
        )?.value,
        revenue: await store.all(
          "SELECT currency,SUM(amount) AS amount FROM orders WHERE status='paid' AND provider<>'points' GROUP BY currency",
        ),
        audit: await store.all(
          'SELECT a.*,u.name FROM audit a LEFT JOIN "user" u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 12',
        ),
      });
    });
    app.get("/api/v1/admin/users", async (c) => {
      requireAdmin(c.get("actor"));
      const q = (c.req.query("q") ?? "").slice(0, 120);
      return c.json({
        items: await store.all(
          'SELECT id,name,email,role,banned,"createdAt" FROM "user" WHERE position(lower(?) in lower(name||email))>0 ORDER BY "createdAt" DESC LIMIT 200',
          q,
        ),
      });
    });
    app.get("/api/v1/admin/users/:id", async (c) => {
      requireAdmin(c.get("actor"));
      const user = await store.one(
        'SELECT id,name,email,role,banned,"createdAt" FROM "user" WHERE id=?',
        c.req.param("id"),
      );
      if (!user) throw new ServiceError("USER_NOT_FOUND", 404);
      return c.json({ user, ...(await summary(String(user.id))) });
    });
    app.patch("/api/v1/admin/users/:id", async (c) => {
      const actor = c.get("actor");
      requireAdmin(actor);
      const input = z
        .object({ banned: z.boolean(), role: z.enum(["admin", "user"]) })
        .parse(await c.req.json());
      const id = c.req.param("id");
      await store.transaction(async () => {
        const current = await store.one(
          'SELECT role FROM "user" WHERE id=?',
          id,
        );
        if (!current) throw new ServiceError("USER_NOT_FOUND", 404);
        if (actor.id === id && (input.banned || input.role !== "admin"))
          throw new ServiceError(
            "SELF_LOCKOUT",
            409,
            "不能停用或降级自己的管理员账号",
          );
        await store.run(
          'UPDATE "user" SET banned=?,role=?,"updatedAt"=? WHERE id=?',
          input.banned,
          input.role,
          new Date(),
          id,
        );
        if (input.banned || input.role !== current.role)
          await store.run('DELETE FROM session WHERE "userId"=?', id);
        await audit(store, actor, "user.update", id);
      });
      return c.json({ ok: true });
    });
    app.get("/api/v1/admin/settings", async (c) => {
      requireAdmin(c.get("actor"));
      return c.json(
        Object.fromEntries(
          await Promise.all(
            Object.entries(settingFields).map(async ([group, fields]) => {
              const values = await settings.get(group);
              return [
                group,
                Object.fromEntries(
                  fields.map((field) => [
                    field,
                    secrets.has(field)
                      ? values[field]
                        ? "••••••••"
                        : ""
                      : (values[field] ?? ""),
                  ]),
                ),
              ];
            }),
          ),
        ),
      );
    });
    app.put("/api/v1/admin/settings/:group", async (c) => {
      const actor = c.get("actor");
      requireAdmin(actor);
      const group = c.req.param("group"),
        fields = settingFields[group];
      if (!fields) throw new ServiceError("UNKNOWN_SETTING", 400);
      const input = z
        .record(z.string(), z.string().max(20000))
        .parse(await c.req.json());
      if (Object.keys(input).some((key) => !fields.includes(key)))
        throw new ServiceError("UNKNOWN_SETTING_FIELD", 400);
      const values = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== "••••••••"),
      );
      await store.transaction(async () => {
        await settings.set(group, values);
        await audit(store, actor, "settings.update", group);
      });
      return c.json({ ok: true });
    });
    const execution = new ExecutionService(
      store,
      settings,
      fetch,
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(config.origin).hostname,
      ),
    );
    await execution.recover();
    mountExecution(app, execution);
    mountEnterpriseAssets(app, store, storage, config);
    mountEnterprise(app, store, config);
    mountProjectSpace(app, store, storage, config);
    mountProjectArchive(app, store, storage, config);
    mountCollaboration(app, store);
    mountPayments(app, store, settings, config);
    mountResources(app, store, storage, config);
    mountStorage(app, store, storage);
    mountLiveshare(app, relay, auth);
    app.notFound((c) => c.json({ error: "接口不存在" }, 404));
    app.get("/api/*", (c) => c.json({ error: "接口不存在" }, 404));
    const webRoot = fileURLToPath(
      new URL(
        import.meta.url.includes("/dist/") ? "../web/" : "../dist/web/",
        import.meta.url,
      ),
    );
    app.use("/assets/*", serveStatic({ root: webRoot }));
    app.get("/mark.svg", serveStatic({ root: webRoot, path: "mark.svg" }));
    app.get("*", serveStatic({ root: webRoot, path: "index.html" }));
    storage.start();
    return {
      app,
      store,
      auth,
      settings,
      storage,
      relay,
      close: async () => {
        await storage.close();
        await relay.close();
        await store.close();
      },
    };
  } catch (error) {
    await store.close();
    throw error;
  }
}
