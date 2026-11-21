import { mountOrganizationWebsites } from "./organization-websites.js";
import { mountProjectBoard } from "./project-board.js";
import { mountMarket } from './market.js';
import { Admission } from './admission.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { StageService, validateStageSettings } from './stage.js';
import { OrganizationMembers } from "./organization-members.js";
import { InvitationRosterError } from "./organization-invitation-csv.js";
import { AppDataFiles } from './app-data-files.js';
import { CloudProjects, cloudGrantAllows, mountCloudProjects, validateCloudSettings } from './cloud-projects.js';
import { ExecutionService, mountExecution } from "./execution.js";
import { Capabilities, mountCapabilities } from "./capabilities.js";
import { authenticateCapabilityKey, mountAccessKeys } from "./access-keys.js";
import { createHash, randomUUID } from "node:crypto";
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
import { mountOrganizationPublications } from "./organization-publications.js";
import { mountOrganizationConversations } from "./organization-conversations.js";
import { mountPayments } from "./payments.js";
import { mountEnterpriseAssets } from "./enterprise-assets.js";
import { mountEnterpriseMcp } from "./enterprise-mcp.js";
import { mountResources } from "./resources.js";
import { LiveshareRelay } from "./liveshare.js";
import { mountLiveshare } from "./liveshare-http.js";
import { mountPublications } from "./publications.js";
import { AppData, migrateAppData } from "./app-data.js";
import { mountEnterpriseAnalytics } from "./enterprise-analytics.js";
import { mountAppData } from "./app-data-http.js";

export const settingFields: Record<string, readonly string[]> = {
  stage: ["enabled", "origin", "rates"],
  cloud: ["enabled", "gatewayOrigin", "gatewayKey", "ttlSeconds", "grantTtlSeconds", "leaseGraceSeconds"],
  stripe: ["secretKey", "webhookSecret"],
  alipay: ["appId", "sellerId", "privateKey", "publicKey", "sandbox"],
  wechat: ["appId", "merchantId", "merchantSerial", "privateKey", "apiV3Key", "platformKeyId", "platformPublicKey"],
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
  "gatewayKey",
  "secretKey",
  "webhookSecret",
  "accessKeyId",
  "accessKeySecret",
  "privateKey",
  "apiV3Key",
]);

/** Create the standalone HTTP service and its local persistence owner. */
export async function createService(config: Config) {
  const store = new Store(config);
  const dataStore = config.appData
    ? new Store({ ...config.appData })
    : undefined;
  try {
    const auth = await createAuth(config, store);
    await migrate(store, config);
    await seedOfficialServices(store);
    if (dataStore) await migrateAppData(dataStore);
    const appData =
      dataStore && config.appData
        ? new AppData(dataStore, store, config.appData, config.origin, { secret: config.secret, publicationOrigin: config.publicationOrigin })
        : undefined;
    const settings = new Settings(store, config.secret);
    const organizationMembers = new OrganizationMembers(store, settings, config.origin);
    const cloud = new CloudProjects(store, settings, config);
    const storage = new Storage(store, settings, config);
    const appFiles=appData?new AppDataFiles(store,appData,storage,config.storageCleanupIntervalMs):undefined;
    const app: App = new Hono();
    app.use('*', async (c, next) => {
      const requestId = randomUUID();
      c.set('requestId', requestId);
      c.header('X-Request-Id', requestId);
      await next();
    });
    const admission = new Admission(config.admission);
    const eventLoop = monitorEventLoopDelay({ resolution: 20 });
    const stage = new StageService(store, settings, config.origin);
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
    const viewerHeaders = secureHeaders({
      crossOriginResourcePolicy: "cross-origin",
    });
    const publicationHeaders = secureHeaders({
      contentSecurityPolicy: { sandbox: ["allow-scripts", "allow-same-origin", "allow-forms", "allow-popups", "allow-downloads"] },
      referrerPolicy: "no-referrer",
    });
    app.use("*", async (c, next) => {
      const publicationHost = config.publicationOrigin && new URL(c.req.url).host === new URL(config.publicationOrigin).host;
      if (publicationHost) {
        if (!c.req.path.startsWith("/p/")) return c.notFound();
        return publicationHeaders(c, next);
      }
      if (c.req.path.startsWith("/p/")) return c.notFound();
      return c.req.path.startsWith("/__liveshare/assets/") || c.req.path.startsWith("/api/data/")
        ? viewerHeaders(c, next)
        : accountHeaders(c, next);
    });
    admission.mount(app);
    const regularBody = bodyLimit({
      maxSize: 25 * 1024 * 1024,
      onError: (c) => c.json({ error: "文件不能超过 24 MB" }, 413),
    });
    const credentialBody = bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ error: '登录请求过大', code: 'REQUEST_TOO_LARGE' }, 413) });
    app.use("*", (c, next) =>
      ['/api/auth/sign-in/email', '/api/auth/sign-up/email'].includes(c.req.path) ? credentialBody(c, next) :
      /^\/api\/v1\/projects\/[^/]+\/artifacts\/upload$/.test(c.req.path) || /^\/api\/v1\/publications\/[^/]+\/files\//.test(c.req.path)
        ? next()
        : regularBody(c, next),
    );
    app.onError((error, c) => {
      if (error instanceof ServiceError) {
        if (error.status === 503 || error.status === 429) c.header('Retry-After', '2');
        return c.json({
          error: error.message, code: error.code,
          ...(error instanceof InvitationRosterError && error.row !== undefined ? { row: error.row } : {}),
        }, error.status);
      }
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
      if ('code' in error && ['57014', '55P03', '53300', '57P01', '57P03', '08006', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(String(error.code))) {
        c.header('Retry-After', '2');
        return c.json({ error: '数据库暂时繁忙或不可用，请稍后重试', code: 'DATABASE_UNAVAILABLE' }, 503);
      }
      if (/timeout exceeded when trying to connect|Connection terminated unexpectedly|Connection terminated due to connection timeout/.test(error.message)) {
        c.header('Retry-After', '2');
        return c.json({ error: '数据库连接暂时不可用，请稍后重试', code: 'DATABASE_UNAVAILABLE' }, 503);
      }
      console.error(JSON.stringify({ event: 'request_failed', requestId: c.get('requestId'),
        errorType: error.name, code: 'code' in error && /^[A-Z0-9_]{1,40}$/.test(String(error.code)) ? error.code : undefined }));
      return c.json(
        { error: "服务暂时无法完成请求", code: "INTERNAL_ERROR", requestId: c.get('requestId') },
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
    app.get('/api/ready', async c => {
      if (admission.isDraining) return c.json({ ok: false }, 503);
      try { await Promise.all([store.one('SELECT 1 AS ready'), dataStore?.one('SELECT 1 AS ready')]); return c.json({ ok: true }); }
      catch { return c.json({ ok: false }, 503); }
    });
    stage.mountPublic(app);
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
          ...(appData ? ["app-data"] : []),
        ],
      }),
    );
    app.on(["GET", "POST"], "/api/auth/*", async (c) => {
      const token=c.req.header('authorization')?.replace(/^Bearer /,'');
      if(token?.startsWith('ipwc.')){
        if(c.req.method!=='GET'||c.req.path!=='/api/auth/get-session')throw new ServiceError('CLOUD_GRANT_SCOPE',403);
        const {actor,grant}=await cloud.authenticate(token);
        if(grant.kind!=='runtime')throw new ServiceError('CLOUD_GRANT_SCOPE',403);
        return c.json({user:actor});
      }
      // Native Work sends JSON credentials without cookies or a browser Origin.
      // Cookie-bearing and explicit cross-origin requests still use Better Auth's checks.
      if (
        ["/api/auth/sign-in/email", "/api/auth/sign-up/email", "/api/auth/request-password-reset"].includes(
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
    app.get("/api/invitations/:token", async (c) => {
      c.header("Cache-Control", "no-store");
      const token = c.req.param("token");
      if (!/^(?:ipw_)?[A-Za-z0-9_-]{43}$/.test(token)) throw new ServiceError("INVITATION_EXPIRED", 404, "邀请不存在或已失效");
      const invitation = await store.one(
        "SELECT e.name,i.expires_at,i.email IS NOT NULL AS email_bound,p.title AS project_title FROM invitations i JOIN enterprises e ON e.id=i.enterprise_id LEFT JOIN projects p ON p.id=i.project_id WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.accepted_by IS NULL AND (i.expires_at IS NULL OR i.expires_at>?)",
        createHash("sha256").update(token).digest("hex"), now(),
      );
      if (!invitation) throw new ServiceError("INVITATION_EXPIRED", 404, "邀请不存在或已失效");
      return c.json({ organization: invitation.name, space: invitation.project_title, expiresAt: invitation.expires_at, emailBound: invitation.email_bound });
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
      const cloudToken=c.req.header('authorization')?.replace(/^Bearer /,'');
      if (cloudToken?.startsWith('ipwc.')) {
        const {actor,grant}=await cloud.authenticate(cloudToken);
        if(!cloudGrantAllows(grant,c.req.path,c.req.method))throw new ServiceError('CLOUD_GRANT_SCOPE',403);
        c.set('actor',actor);c.set('cloudGrant',grant);await next();return;
      }
      const keyActor = await authenticateCapabilityKey(auth, store, c.req.raw.headers, c.req.path, c.req.method);
      if (keyActor) {
        c.set("actor", keyActor);
        await next();
        return;
      }
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
    mountMarket(app, store, settings);
    app.get('/api/v1/admin/runtime', c => {
      requireAdmin(c.get('actor'));
      const pool = (db: Store['db']) => ({ total: db.totalCount, idle: db.idleCount, waiting: db.waitingCount });
      return c.json({ uptimeSeconds: Math.floor(process.uptime()), draining: admission.isDraining,
        memory: process.memoryUsage(), eventLoopP99Ms: Number.isFinite(eventLoop.percentile(99)) ? eventLoop.percentile(99) / 1e6 : 0,
        admission: admission.snapshot(), database: pool(store.db), ...(dataStore ? { appDataDatabase: pool(dataStore.db) } : {}) });
    });
    stage.mount(app);
    const summary = async (userId: string) => ({
      points: await wallet(store, userId),
      entitlements: await store.all(
        "SELECT e.*,p.name FROM entitlements e JOIN plans p ON p.id=e.plan_id WHERE e.user_id=? AND e.revoked_at IS NULL AND e.expires_at>? ORDER BY e.expires_at DESC LIMIT 100",
        userId,
        now(),
      ),
      enterprises: await store.all(
        "SELECT e.id,e.name,m.role FROM enterprises e JOIN members m ON m.enterprise_id=e.id WHERE m.user_id=? AND m.status='active' LIMIT 200",
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
    app.get("/api/v1/me/orgs", async c=>{
      const items=(await summary(c.get('actor').id)).enterprises;
      const grant=c.get('cloudGrant');
      if(!grant)return c.json({items});
      const project=await store.one('SELECT enterprise_id FROM projects WHERE id=?',grant.projectId);
      return c.json({items:items.filter(item=>item.id===project?.enterprise_id)});
    });
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
        Object.entries(input).filter(([, v]) => v !== "••••••••" && v !== ''),
      );
      await store.transaction(async () => {
        if(group==='stage')validateStageSettings({...await settings.get(group),...values});
        if(group==='cloud')validateCloudSettings({...await settings.get(group),...values});
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
      config.usageUtcOffsetMinutes,
      config.usageLimitsEnabled,
    );
    await execution.recover();
    mountExecution(app, execution);
    mountCapabilities(app, new Capabilities(execution, store));
    mountAccessKeys(app, auth);
    mountEnterpriseAssets(app, store, storage, config);
    mountEnterpriseMcp(app, store, settings, config.secret, undefined, config.origin);
    mountEnterprise(app, store, config, cloud, organizationMembers);
    mountOrganizationWebsites(app, store, settings);
    mountOrganizationPublications(app, store);
    mountOrganizationConversations(app, store);
    organizationMembers.mount(app);
    organizationMembers.start();
    mountCloudProjects(app, cloud);
    mountEnterpriseAnalytics(app, store);
    mountProjectSpace(app, store, storage, config);
    mountProjectArchive(app, store, storage, config);
    mountPublications(app, store, storage, config);
    mountCollaboration(app, store);
    mountProjectBoard(app, store);
    mountPayments(app, store, settings, config);
    mountResources(app, store, storage, config);
    mountStorage(app, store, storage);
    mountLiveshare(app, relay, auth);
    mountAppData(app, appData, config.appData, auth, store, appFiles, cloud);
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
    appFiles?.start();
    storage.start();
    stage.start();
    appData?.start();
    eventLoop.enable();
    let closing: Promise<void> | undefined;
    return {
      app,
      store,
      auth,
      settings,
      storage,
      relay,
      appData,
      appFiles,
      admission,
      beginDrain: () => admission.close(),
      close: () => closing ??= (async () => {
        admission.close();
        eventLoop.disable();
        await stage.close();
        await organizationMembers.close();
        await appFiles?.close();
        await storage.close();
        await relay.close();
        await appData?.close();
        await store.close();
      })(),
    };
  } catch (error) {
    await dataStore?.close();
    await store.close();
    throw error;
  }
}
