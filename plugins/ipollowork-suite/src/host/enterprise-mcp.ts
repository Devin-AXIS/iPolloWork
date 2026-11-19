import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
import { SuiteError } from "./errors.ts";
import type { AccountService } from "./account.ts";
import type { ModelWebServer } from "./service-models.ts";

export interface EnterpriseMcpScope extends Pick<Context, "effect"> {
  mcpManager: { register(name: string, entry: {
    transport: "streamable-http"; url: string; headers: Record<string, string>;
  }): () => void;
    list(): { name: string; status: { state: string } }[];
    restart(name: string): Promise<void>;
  };
}
export interface EnterpriseMcpConnection { id: string; title: string; serverName: string; state: string }
export interface EnterpriseMcpRefresh {
  (): Promise<void>;
  connections(): EnterpriseMcpConnection[];
  restart(id: string): Promise<void>;
}

const catalog = z.object({ items: z.array(z.object({ id: z.uuid(), title: z.string().max(120) })).max(100) });
const path = "/ipollo-enterprise-mcp";
const requestHeaders = ["accept", "content-type", "mcp-protocol-version", "mcp-session-id", "last-event-id"];
const responseHeaders = ["content-type", "mcp-session-id"];
const maxRequest = 1024 * 1024;

/** Register the account's grants with DSH while the suite and membership are active. */
export function mountEnterpriseMcp(ctx: EnterpriseMcpScope, web: ModelWebServer, account: AccountService): EnterpriseMcpRefresh {
  const lifetime = new AbortController();
  const registrations = new Map<string, { title: string; name: string; dispose(): void; signal: AbortSignal }>();
  const auth = "Bearer " + randomBytes(32).toString("base64url");
  let generation = -1;
  let pending: Promise<void> | undefined;
  const release = () => {
    for (const active of registrations.values()) active.dispose();
    registrations.clear();
  };

  ctx.effect(() => web.register({
    kind: "prefix", path, auth: "anonymous",
    async handler(req, res) {
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      try {
        const id = req.url?.slice(path.length + 1);
        const active = id ? registrations.get(id) : undefined;
        if (req.headers.authorization !== auth || !id || !active || generation !== account.generation)
          throw new SuiteError("IPW_MCP_FORBIDDEN", 403);
        const method = req.method;
        if (method !== "GET" && method !== "POST" && method !== "DELETE")
          throw new SuiteError("IPW_INVALID_INPUT", 405);
        const headers = new Headers();
        for (const name of requestHeaders) {
          const value = req.headers[name];
          if (typeof value === "string") headers.set(name, value);
        }
        let body: Uint8Array<ArrayBuffer> | undefined;
        if (method === "POST") {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            const bytes = Buffer.from(chunk);
            size += bytes.length;
            if (size > maxRequest) {
              res.setHeader("connection", "close");
              throw new SuiteError("IPW_MCP_REQUEST_TOO_LARGE", 413);
            }
            chunks.push(bytes);
          }
          body = Buffer.concat(chunks);
        }
        const signal = AbortSignal.any([controller.signal, active.signal, lifetime.signal]);
        signal.throwIfAborted();
        const response = await account.connectEnterpriseMcp(id, method, headers, body, signal);
        for (const name of responseHeaders) {
          const value = response.headers.get(name);
          if (value) res.setHeader(name, value);
        }
        res.setHeader("cache-control", "no-store");
        res.writeHead(response.status);
        if (response.body) {
          const reader = response.body.getReader();
          await pipeline(Readable.from((async function* () {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) return;
                yield value;
              }
            } finally {
              reader.releaseLock();
            }
          })()), res);
        } else res.end();
      } catch (error) {
        if (res.headersSent) res.destroy();
        else {
          res.writeHead(error instanceof SuiteError ? error.status : 502, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: error instanceof SuiteError ? error.code : "IPW_MCP_UNAVAILABLE" }));
        }
      }
    },
  }));

  const refresh = () => {
    const next = account.generation;
    if (generation !== next) {
      release();
      generation = next;
    }
    if (pending) return pending;
    const load = async () => {
      try {
        const state = await account.state();
        const items = state.status === "signed-in"
          ? catalog.parse(await account.request("/api/v1/me/enterprise-mcp", undefined, "GET", lifetime.signal)).items
          : [];
        if (lifetime.signal.aborted || account.generation !== next) return;
        const ids = new Set(items.map(item => item.id));
        for (const [id, active] of registrations) {
          if (ids.has(id)) continue;
          active.dispose();
          registrations.delete(id);
        }
        for (const { id, title } of items) {
          const existing = registrations.get(id);
          if (existing) { existing.title = title; continue; }
          const label = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 15) || "team-mcp";
          const name = label + "-" + id.replaceAll("-", "").slice(0, 16);
          const server = new AbortController();
          const unregister = ctx.mcpManager.register(name, {
            transport: "streamable-http",
            url: web.getOrigin() + path + "/" + id,
            headers: { authorization: auth },
          });
          registrations.set(id, { title, name, signal: server.signal, dispose() { server.abort(); unregister(); } });
        }
      } catch (error) {
        if (account.generation === next) release();
        throw new SuiteError('IPW_MCP_SYNC_FAILED', 503, { cause: error });
      }
    };
    const task = pending = load().finally(() => {
      pending = undefined;
      if (!lifetime.signal.aborted && account.generation !== next) void refresh().catch(() => {});
    });
    return task;
  };
  ctx.effect(() => {
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 60_000);
    timer.unref();
    return async () => {
      clearInterval(timer);
      lifetime.abort();
      release();
      await pending?.catch(() => {});
    };
  });
  return Object.assign(refresh, {
    connections() {
      const states = new Map(ctx.mcpManager.list().map(item => [item.name, item.status.state]));
      return Array.from(registrations, ([id, item]) => ({ id, title: item.title, serverName: item.name, state: states.get(item.name) ?? 'connecting' }));
    },
    async restart(id: string) {
      await refresh();
      const current = registrations.get(id);
      if (!current) throw new SuiteError('IPW_MCP_FORBIDDEN', 403);
      await ctx.mcpManager.restart(current.name);
    },
  });
}
