/**
 * App data HTTP routes under `/api/data/v1`. Any site may call them: signed-in callers send a bearer token, published
 * code sends an app's public key in `X-Data-Key`. Cookies are ignored, so the routes cannot act on an ambient session.
 */
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { z } from "zod";
import type { App } from "./http.js";
import type { Auth } from "./auth.js";
import type { AppDataConfig } from "./config.js";
import { appDataBodyLimit, type AppData, type DataCaller } from "./app-data.js";
import { ServiceError } from "./errors.js";
import { audit, requireAdmin } from "./domain.js";
import type { Store } from "./database.js";

const createInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["plugin", "site"]),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,47}$/)
      .optional(),
    enterpriseId: z.string().min(1).max(100).optional(),
    workspace: z.string().max(200).optional(),
  })
  .strict();
const updateInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    workspace: z.string().max(200).optional(),
    rotateKey: z.literal(true).optional(),
  })
  .strict();

/**
 * Mount the routes. Without an app data database every route reports `APP_DATA_NOT_CONFIGURED`.
 * @param app - the service router.
 * @param data - the app data owner, absent when `APP_DATA_DATABASE_URL` is unset.
 * @param limits - app data limits, used for the request body bound.
 * @param auth - Better Auth, used to resolve bearer tokens.
 * @param accounts - the account database, which records the operator's actions.
 */
export function mountAppData(app: App, data: AppData | undefined, limits: AppDataConfig | undefined, auth: Auth, accounts: Store): void {
  app.use(
    "/api/data/v1/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Data-Key"],
      maxAge: 600,
    }),
  );
  if (limits)
    app.use(
      "/api/data/v1/*",
      bodyLimit({
        maxSize: appDataBodyLimit(limits),
        onError: (c) => c.json({ error: "请求内容太大", code: "DATA_REQUEST_TOO_LARGE" }, 413),
      }),
    );
  const ready = (): AppData => {
    if (!data) throw new ServiceError("APP_DATA_NOT_CONFIGURED", 503, "应用数据库尚未配置");
    return data;
  };
  const caller = async (c: Context): Promise<DataCaller> => {
    c.header("Cache-Control", "no-store");
    const authorization = c.req.header("authorization");
    const key = c.req.header("x-data-key");
    // A visitor signed in to one app sends that app's key with the token the sign-in returned.
    if (key && authorization?.startsWith("Bearer ipd_"))
      return { kind: "anonymous", key, ip: c.req.header("x-ipollo-peer-ip") ?? "", token: authorization.slice(7) };
    if (authorization?.startsWith("Bearer ")) {
      const session = await auth.api.getSession({ headers: new Headers({ authorization }) });
      if (!session || session.user.banned) throw new ServiceError("SIGN_IN_REQUIRED", 401, "登录已失效，请重新登录");
      return {
        kind: "member",
        actor: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          role: session.user.role ?? "user",
          emailVerified: session.user.emailVerified,
        },
      };
    }
    if (key) return { kind: "anonymous", key, ip: c.req.header("x-ipollo-peer-ip") ?? "" };
    throw new ServiceError("SIGN_IN_REQUIRED", 401, "需要登录令牌或应用的公开 key");
  };
  const member = async (c: Context): Promise<DataCaller & { kind: "member" }> => {
    const result = await caller(c);
    if (result.kind !== "member") throw new ServiceError("SIGN_IN_REQUIRED", 401, "需要登录令牌");
    return result;
  };
  // Session routes below `/api/v1` carry the service's own page session and origin check.
  const signin = z.object({ app: z.string().max(100), key: z.string().max(100), return: z.url().max(2000) }).strict();
  app.get("/api/v1/data-signin", async (c) =>
    c.json(await ready().signin(c.get("actor"), signin.parse({ app: c.req.query("app"), key: c.req.query("key"), return: c.req.query("return") }), false)),
  );
  app.post("/api/v1/data-signin", async (c) => c.json(await ready().signin(c.get("actor"), signin.parse(await c.req.json()), true)));
  app.get("/api/v1/admin/data-apps", async (c) => {
    requireAdmin(c.get("actor"));
    return c.json(
      await ready().overview({
        q: z.string().trim().max(100).default("").parse(c.req.query("q")),
        sort: z.enum(["bytes", "updated"]).default("bytes").parse(c.req.query("sort")),
        offset: z.coerce.number().int().min(0).default(0).parse(c.req.query("offset")),
        limit: z.coerce.number().int().min(1).max(100).default(50).parse(c.req.query("limit")),
      }),
    );
  });
  app.post("/api/v1/admin/data-apps/:app/suspend", async (c) => {
    const actor = c.get("actor");
    requireAdmin(actor);
    const input = z.object({ suspended: z.boolean() }).strict().parse(await c.req.json());
    await ready().suspend(c.req.param("app"), input.suspended);
    await audit(accounts, actor, input.suspended ? "data-app.suspend" : "data-app.resume", c.req.param("app"));
    return c.json({ ok: true });
  });
  app.delete("/api/v1/admin/data-apps/:app", async (c) => {
    const actor = c.get("actor");
    requireAdmin(actor);
    await ready().discard(c.req.param("app"));
    await audit(accounts, actor, "data-app.delete", c.req.param("app"));
    return c.json({ ok: true });
  });
  app.get("/api/data/v1/apps", async (c) => {
    const who = await member(c);
    return c.json(await ready().apps(who.actor));
  });
  app.post("/api/data/v1/apps", async (c) => {
    const who = await member(c);
    const input = createInput.parse(await c.req.json());
    const result = await ready().ensure(who.actor, input);
    return c.json(result, result.created ? 201 : 200);
  });
  app.get("/api/data/v1/apps/:app", async (c) =>
    c.json({ app: await ready().detail(await member(c), c.req.param("app")) }),
  );
  app.patch("/api/data/v1/apps/:app", async (c) => {
    const who = await member(c);
    const input = updateInput.parse(await c.req.json());
    return c.json({ app: await ready().update(who, c.req.param("app"), input) });
  });
  app.delete("/api/data/v1/apps/:app", async (c) => {
    await ready().remove(await member(c), c.req.param("app"));
    return c.json({ deleted: true });
  });
  app.post("/api/data/v1/apps/:app/run", async (c) => {
    const who = await caller(c);
    return c.json(await ready().run(who, c.req.param("app"), await c.req.json()));
  });
  app.get("/api/data/v1/apps/:app/changes", async (c) => {
    const who = await member(c);
    const after = z.coerce.number().int().min(0).default(0).parse(c.req.query("after"));
    const limit = z.coerce.number().int().min(1).max(500).default(500).parse(c.req.query("limit"));
    return c.json(await ready().changes(who, c.req.param("app"), after, limit));
  });
}
