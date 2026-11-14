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

const createInput = z
  .object({
    name: z.string().trim().min(1).max(80),
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
 */
export function mountAppData(app: App, data: AppData | undefined, limits: AppDataConfig | undefined, auth: Auth): void {
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
    const key = c.req.header("x-data-key");
    if (key) return { kind: "anonymous", key, ip: c.req.header("x-ipollo-peer-ip") ?? "" };
    throw new ServiceError("SIGN_IN_REQUIRED", 401, "需要登录令牌或应用的公开 key");
  };
  const member = async (c: Context): Promise<DataCaller & { kind: "member" }> => {
    const result = await caller(c);
    if (result.kind !== "member") throw new ServiceError("SIGN_IN_REQUIRED", 401, "需要登录令牌");
    return result;
  };
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
