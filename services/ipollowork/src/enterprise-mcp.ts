import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Settings } from "./settings.js";
import { ServiceError } from "./errors.js";
import { audit, enterpriseAccess, isEnterpriseManager, now, requireEnterpriseManager, uid } from "./domain.js";
import { audienceOf, audienceSchema, grantedTo, replaceAudience, requireUse } from "./grants.js";
import { EnterpriseMcpOAuth, mcpMemberCredentials, mcpOAuthConfig, memberMcpToken, type McpOAuthConfig } from "./enterprise-mcp-oauth.js";

const maxRequest = 1024 * 1024;
const maxResponse = 16 * 1024 * 1024;
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(network, prefix);

export function isSharedMcpEndpoint(value: string): boolean {
  if (/\s|[{}]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password &&
      !url.hash && !url.search && url.hostname.includes(".") && !url.hostname.endsWith(".") &&
      !isIP(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(url.hostname);
  } catch {
    return false;
  }
}

const inputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  endpoint: z.string().trim().max(2048).refine(isSharedMcpEndpoint, "需要公开的 HTTPS MCP 地址"),
  key: z.string().max(8192).regex(/^[\x21-\x7e]*$/).optional(),
  audience: audienceSchema.optional(),
  oauth: mcpOAuthConfig.refine(value=>isSharedMcpEndpoint(value.authorizationUrl) && isSharedMcpEndpoint(value.tokenUrl)).optional(),
}).strict();
const rpcMessage = z.object({ jsonrpc: z.literal("2.0") }).passthrough();
const rpcBody = z.union([rpcMessage, z.array(rpcMessage).min(1).max(64)]);
const updateSchema = inputSchema.omit({ audience: true }).extend({
  key: inputSchema.shape.key.unwrap().nullable().optional(),
  oauth: inputSchema.shape.oauth.unwrap().nullable().optional(),
  enabled: z.boolean(),
});
type Row = { id: string; enterprise_id: string; title: string; description: string; endpoint: string; enabled: boolean; oauth_config:string|null };
const keyName = (id: string) => "enterprise-mcp/" + id;

/** Accept only DNS answers for public IPv4 and use that exact address for the TLS connection. */
function connect(endpoint: URL, method: string, headers: Record<string, string>, body: Buffer | undefined, signal: AbortSignal) {
  return new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const outgoing = request(endpoint, {
      method, headers, signal, agent: false, family: 4,
      lookup(hostname, _options, callback) {
        lookup(hostname, { all: true, family: 4 }, (error, addresses) => {
          if (error) { callback(error, "", 4); return; }
          const first = addresses[0];
          if (!first || addresses.some(({ address }) => blocked.check(address)))
            callback(new Error("MCP destination is not public"), "", 4);
          else callback(null, first.address, 4);
        });
      },
    }, resolve);
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

/** Bind the upstream session ID to the account and the configured MCP. */
function sessionTag(secret: string, member: string, row: Row, encoded: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(["enterprise-mcp", member, row.id, row.endpoint, encoded])).digest("base64url");
}
function readSession(secret: string, member: string, row: Row, value: string): string {
  const parts = /^([A-Za-z0-9_-]{1,1366})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (parts) {
    const encoded = parts[1]!, given = parts[2]!;
    if (timingSafeEqual(Buffer.from(given), Buffer.from(sessionTag(secret, member, row, encoded))))
      return Buffer.from(encoded, "base64url").toString();
  }
  throw new ServiceError("MCP_SESSION_INVALID", 400, "MCP 会话已失效，请重新连接");
}

export function mountEnterpriseMcp(app: App, store: Store, settings: Settings, secret: string, transport = connect, origin?:string): void {
  const oauth = origin ? new EnterpriseMcpOAuth(store,settings,origin,transport) : undefined;
  oauth?.mount(app);
  app.get("/api/v1/enterprises/:id/mcp", async (c) => {
    const enterprise = c.req.param("id"), actor = c.get("actor");
    await enterpriseAccess(store, actor, enterprise);
    const canManage = await isEnterpriseManager(store, actor, enterprise);
    const rows = canManage
      ? await store.all<Row>("SELECT * FROM enterprise_mcp WHERE enterprise_id=? ORDER BY created_at DESC,id LIMIT 100", enterprise)
      : await store.all<Row>(
        `SELECT r.* FROM enterprise_mcp r JOIN members m ON m.enterprise_id=r.enterprise_id
         WHERE r.enterprise_id=? AND r.enabled AND m.user_id=? AND m.status='active' AND ${grantedTo("r.id")} ORDER BY r.created_at DESC,r.id LIMIT 100`,
        enterprise, actor.id, "mcp",
      );
    return c.json({ canManage, items: await Promise.all(rows.map(async (r) => ({
      id: r.id, title: r.title, description: r.description, host: new URL(r.endpoint).hostname,
      enabled: r.enabled,
      oauthRequired:!!r.oauth_config,
      authorized:!r.oauth_config || Boolean(await store.one("SELECT 1 FROM settings WHERE key=?",memberMcpToken(r.id,actor.id))),
      ...(canManage ? {endpoint:r.endpoint, ...(r.oauth_config ? {oauth:JSON.parse(r.oauth_config) as McpOAuthConfig} : {})} : {}),
      audience: await audienceOf(store, "mcp", r.id),
    }))) });
  });
  app.post("/api/v1/enterprises/:id/mcp", async (c) => {
    const enterprise = c.req.param("id"), actor = c.get("actor");
    await requireEnterpriseManager(store, actor, enterprise);
    const input = inputSchema.parse(await c.req.json());
    if (input.oauth && (!oauth || input.key)) throw new ServiceError("MCP_AUTH_CONFIGURATION_INVALID",400,"请选择一种授权方式");
    const id = uid();
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO enterprise_mcp(id,enterprise_id,title,description,endpoint,created_at,oauth_config) VALUES(?,?,?,?,?,?,?)",
        id, enterprise, input.title, input.description, new URL(input.endpoint).href, now(),input.oauth ? JSON.stringify(input.oauth) : null,
      );
      if (input.key) await settings.set(keyName(id), { key: input.key });
      await replaceAudience(store, enterprise, "mcp", id, input.audience ?? { all: true, departments: [], members: [] });
      await audit(store, actor, "mcp.create", id, enterprise);
    });
    return c.json({ id }, 201);
  });
  app.patch("/api/v1/enterprises/:id/mcp/:mcpId", async c => {
    const enterprise = c.req.param("id"), id = c.req.param("mcpId"), actor = c.get("actor");
    const input = updateSchema.parse(await c.req.json());
    if (input.oauth && (!oauth || input.key)) throw new ServiceError("MCP_AUTH_CONFIGURATION_INVALID",400,"请选择一种授权方式");
    const endpoint = new URL(input.endpoint).href;
    await store.transaction(async () => {
      await requireEnterpriseManager(store, actor, enterprise);
      const previous = await store.one<Row>("SELECT * FROM enterprise_mcp WHERE id=? AND enterprise_id=? FOR UPDATE", id, enterprise);
      if (!previous) throw new ServiceError("MCP_NOT_FOUND", 404, "MCP 不存在");
      const nextOAuth = input.oauth === undefined ? previous.oauth_config : input.oauth ? JSON.stringify(input.oauth) : null;
      if (nextOAuth && input.key) throw new ServiceError("MCP_AUTH_CONFIGURATION_INVALID",400,"请选择一种授权方式");
      await store.run("UPDATE enterprise_mcp SET title=?,description=?,endpoint=?,enabled=?,oauth_config=? WHERE id=?", input.title, input.description, endpoint, input.enabled,nextOAuth,id);
      if (input.key) await settings.set(keyName(id), { key:input.key });
      else if (input.key === null || endpoint !== previous.endpoint || nextOAuth)
        await store.run("DELETE FROM settings WHERE key=?", keyName(id));
      if (nextOAuth !== previous.oauth_config || endpoint !== previous.endpoint) {
        await store.run("DELETE FROM enterprise_mcp_oauth_pending WHERE mcp_id=?",id);
        await store.run("DELETE FROM settings WHERE key LIKE ?",mcpMemberCredentials(id));
      }
      await audit(store, actor, "mcp.update", id, enterprise);
    });
    return c.json({ ok:true });
  });
  app.delete("/api/v1/enterprises/:id/mcp/:mcpId", async (c) => {
    const enterprise = c.req.param("id"), id = c.req.param("mcpId"), actor = c.get("actor");
    await requireEnterpriseManager(store, actor, enterprise);
    await store.transaction(async () => {
      const removed = await store.run("DELETE FROM enterprise_mcp WHERE id=? AND enterprise_id=?", id, enterprise);
      if (!removed.changes) throw new ServiceError("MCP_NOT_FOUND", 404, "MCP 不存在");
      await store.run("DELETE FROM enterprise_grants WHERE asset_kind='mcp' AND asset_id=?", id);
      await store.run("DELETE FROM settings WHERE key=?", keyName(id));
      await store.run("DELETE FROM settings WHERE key LIKE ?",mcpMemberCredentials(id));
      await audit(store, actor, "mcp.remove", id, enterprise);
    });
    return c.json({ ok: true });
  });
  app.get("/api/v1/me/enterprise-mcp", async (c) => {
    const items = await store.all<{ id: string; title: string; enterpriseName: string }>(
      `SELECT r.id,r.title,e.name AS "enterpriseName" FROM members m JOIN enterprise_mcp r ON r.enterprise_id=m.enterprise_id
       JOIN enterprises e ON e.id=r.enterprise_id WHERE m.user_id=? AND m.status='active' AND r.enabled AND (m.role IN('admin','owner') OR ${grantedTo("r.id")})
       AND (r.oauth_config IS NULL OR EXISTS(SELECT 1 FROM settings s WHERE s.key='enterprise-mcp-member/'||r.id||'/'||m.user_id))
       ORDER BY r.id LIMIT 100`, c.get("actor").id, "mcp",
    );
    return c.json({ items });
  });
  app.on(["GET", "POST", "DELETE"], "/api/v1/me/enterprise-mcp/:mcpId/connect", async (c) => {
    const actor = c.get("actor"), id = c.req.param("mcpId");
    const { row, key } = await store.transaction(async () => {
      const row = await store.one<Row>("SELECT * FROM enterprise_mcp WHERE id=? FOR SHARE", id);
      if (!row) throw new ServiceError("MCP_NOT_FOUND", 404, "MCP 不存在");
      await requireUse(store, actor, row.enterprise_id, "mcp", id);
      if (!row.enabled || !isSharedMcpEndpoint(row.endpoint)) throw new ServiceError("MCP_UNAVAILABLE", 503, "MCP 连接不可用");
      if (row.oauth_config && !oauth) throw new ServiceError("MCP_OAUTH_UNAVAILABLE",503);
      return { row, key:row.oauth_config ? await oauth!.token(row,actor) : (await settings.get(keyName(id))).key };
    });
    const body = c.req.method === "POST" ? Buffer.from(await c.req.arrayBuffer()) : undefined;
    if (body && body.length > maxRequest) throw new ServiceError("MCP_REQUEST_TOO_LARGE", 413, "MCP 请求过大");
    const headers: Record<string, string> = { accept: "application/json, text/event-stream" };
    if (body) {
      rpcBody.parse(JSON.parse(body.toString("utf8")));
      headers["content-type"] = "application/json";
    }
    const version = c.req.header("mcp-protocol-version");
    if (version && /^\d{4}-\d{2}-\d{2}$/.test(version)) headers["mcp-protocol-version"] = version;
    const session = c.req.header("mcp-session-id");
    if (session) {
      headers["mcp-session-id"] = readSession(secret, actor.id, row, session);
      const previousEvent = c.req.header("last-event-id");
      if (previousEvent && previousEvent.length <= 1024) headers["last-event-id"] = previousEvent;
    }
    if (key) headers.authorization = "Bearer " + key;
    if (body) headers["content-length"] = String(body.length);
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(120_000)]);
    const upstream = await transport(new URL(row.endpoint), c.req.method, headers, body, signal).catch(() => {
      throw new ServiceError("MCP_UNAVAILABLE", 503, "MCP 服务暂时无法连接");
    });
    const status = upstream.statusCode ?? 502;
    if (status < 200 || status >= 300) {
      upstream.destroy();
      if (status === 405 && c.req.method !== "POST") return new Response(null, { status });
      // Streamable HTTP uses a 404 to request a new MCP session.
      const code = status === 404 && session ? 404 : 503;
      throw new ServiceError("MCP_UNAVAILABLE", code, "MCP 服务暂时无法连接");
    }
    const result = new Headers({ "cache-control": "no-store" });
    const type = upstream.headers["content-type"];
    const remoteSession = upstream.headers["mcp-session-id"];
    if (typeof remoteSession === "string" && /^[\x21-\x7e]{1,1024}$/.test(remoteSession)) {
      const encoded = Buffer.from(remoteSession).toString("base64url");
      result.set("mcp-session-id", encoded + "." + sessionTag(secret, actor.id, row, encoded));
    }
    if (status === 202 || status === 204) {
      upstream.destroy();
      return new Response(null, { status, headers: result });
    }
    if (typeof type !== "string" || !/^(?:application\/json|text\/event-stream)(?:;|$)/i.test(type)) {
      upstream.destroy();
      throw new ServiceError("MCP_UNAVAILABLE", 503, "MCP 服务返回了不支持的内容");
    }
    result.set("content-type", type);
    let bytes = 0;
    const stream = Readable.toWeb(upstream) as ReadableStream<Uint8Array>;
    return new Response(stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxResponse) controller.error(new Error("MCP response too large"));
        else controller.enqueue(chunk);
      },
    })), { status, headers: result });
  });
}
