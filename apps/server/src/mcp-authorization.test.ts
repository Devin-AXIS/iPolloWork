import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeMcpAuthorization,
  mcpAuthorizationStatus,
  migrateLegacyMcpAuthorization,
  migrateRuntimeMcpAuthorization,
  proxyMcpRequest,
  publicMcpConfig,
  secureMcpAuthorizationConfig,
  startMcpAuthorization,
} from "./mcp-authorization.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function testConfig(): Promise<ServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-mcp-authorization-"));
  roots.push(root);
  return {
    host: "127.0.0.1",
    port: 3210,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: "workspace", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

describe("MCP authorization", () => {
  test("keeps upstream OAuth configuration in iPolloWork and gives the engine only a scoped proxy", async () => {
    const config = await testConfig();
    const secured = await secureMcpAuthorizationConfig(config, "workspace", "github", {
      type: "remote",
      url: "https://mcp.example/rpc",
      enabled: true,
      oauth: { clientId: "public-client", clientSecret: "private-client-secret", scope: "mcp.read" },
    });

    expect(secured).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:3210/mcp-proxy/workspace/github",
      enabled: true,
      oauth: false,
    });
    expect((secured.headers as Record<string, unknown>).Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(secured)).not.toContain("private-client-secret");
    expect(secured.connectionId).toBeUndefined();

    await writeRuntimeOpencodeConfig(config, "workspace", (current) => ({
      ...current,
      mcp: { github: secured },
    }));
    expect(await publicMcpConfig(config, "workspace", "github", secured)).toEqual({
      type: "remote",
      url: "https://mcp.example/rpc",
      enabled: true,
      oauth: { clientId: "public-client", scope: "mcp.read" },
    });
  });

  test("completes discovery and PKCE, stores the token, and proxies MCP traffic", async () => {
    const config = await testConfig();
    let forwardedAuthorization = "";
    let forwardedBody = "";
    const fetcher = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname.includes("oauth-protected-resource")) {
        return json({
          resource: "https://mcp.example/rpc",
          authorization_servers: ["https://auth.example"],
          scopes_supported: ["mcp.read"],
        });
      }
      if (url.pathname.includes("oauth-authorization-server")) {
        return json({
          issuer: "https://auth.example",
          authorization_endpoint: "https://auth.example/authorize",
          token_endpoint: "https://auth.example/token",
          registration_endpoint: "https://auth.example/register",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url.pathname === "/register") {
        return json({
          client_id: "dynamic-client",
          redirect_uris: ["http://127.0.0.1:3210/mcp/oauth/callback"],
          token_endpoint_auth_method: "none",
        }, 201);
      }
      if (url.pathname === "/token") {
        return json({ access_token: "upstream-access-token", token_type: "Bearer", expires_in: 3600, refresh_token: "upstream-refresh-token" });
      }
      if (url.href === "https://mcp.example/rpc") {
        forwardedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
        forwardedBody = typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body as ArrayBuffer);
        return new Response("event: message\ndata: ok\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const callbackUrl = "http://127.0.0.1:3210/mcp/oauth/callback";
    const started = await startMcpAuthorization({
      config,
      workspaceId: "workspace",
      name: "github",
      source: { type: "remote", url: "https://mcp.example/rpc", enabled: true, oauth: {} },
      callbackUrl,
      fetcher,
    });
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://auth.example");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("dynamic-client");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("resource")).toBe("https://mcp.example/rpc");

    const callback = new URL(callbackUrl);
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "");
    expect(await completeMcpAuthorization(config, callback, fetcher)).toEqual({ workspaceId: "workspace", name: "github" });
    expect(await mcpAuthorizationStatus(config, "workspace", "github")).toEqual({ connected: true });

    const runtime = await readRuntimeOpencodeConfig(config, "workspace");
    const engineConfig = runtime.mcp?.github;
    const capability = (engineConfig?.headers as Record<string, string> | undefined)?.Authorization;
    const proxied = await proxyMcpRequest(config, "workspace", "github", new Request(
      "http://127.0.0.1:3210/mcp-proxy/workspace/github",
      { method: "POST", headers: { authorization: capability ?? "", "content-type": "application/json" }, body: "{\"jsonrpc\":\"2.0\"}" },
    ), fetcher);
    expect(proxied.status).toBe(200);
    expect(await proxied.text()).toContain("data: ok");
    expect(forwardedAuthorization).toMatch(/^bearer upstream-access-token$/i);
    expect(forwardedBody).toBe("{\"jsonrpc\":\"2.0\"}");
  });

  test("migrates OAuth MCP entries to the proxy without retaining engine-owned secrets", async () => {
    const config = await testConfig();
    await writeRuntimeOpencodeConfig(config, "workspace", (current) => ({
      ...current,
      mcp: {
        github: {
          type: "remote",
          url: "https://mcp.example/rpc",
          oauth: { clientId: "client", clientSecret: "secret" },
          enabled: true,
        },
      },
    }));

    expect(await migrateRuntimeMcpAuthorization(config)).toBe(1);
    const migrated = (await readRuntimeOpencodeConfig(config, "workspace")).mcp?.github;
    expect(migrated).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:3210/mcp-proxy/workspace/github",
      oauth: false,
      enabled: true,
    });
    expect(JSON.stringify(migrated)).not.toContain("secret");
    expect(migrated?.connectionId).toBeUndefined();
  });

  test("leaves unauthenticated and header-authenticated MCP entries unchanged", async () => {
    const config = await testConfig();
    await writeRuntimeOpencodeConfig(config, "workspace", (current) => ({
      ...current,
      mcp: {
        public: { type: "remote", url: "https://public.example/mcp", enabled: true },
        private: {
          type: "remote",
          url: "https://private.example/mcp",
          enabled: true,
          headers: { Authorization: "Bearer static-token" },
        },
      },
    }));

    expect(await migrateRuntimeMcpAuthorization(config)).toBe(0);
    expect((await readRuntimeOpencodeConfig(config, "workspace")).mcp).toEqual({
      public: { type: "remote", url: "https://public.example/mcp", enabled: true },
      private: {
        type: "remote",
        url: "https://private.example/mcp",
        enabled: true,
        headers: { Authorization: "Bearer static-token" },
      },
    });
  });

  test("moves existing OpenCode MCP credentials into the shared vault and deletes the old file", async () => {
    const config = await testConfig();
    const legacyPath = join(config.workspaces[0]!.path, "mcp-auth.json");
    await writeRuntimeOpencodeConfig(config, "workspace", (current) => ({
      ...current,
      mcp: { notion: { type: "remote", url: "https://mcp.example/rpc", oauth: {}, enabled: true } },
    }));
    await writeFile(legacyPath, JSON.stringify({
      notion: {
        serverUrl: "https://mcp.example/rpc",
        clientInfo: { clientId: "legacy-public-client" },
        tokens: {
          accessToken: "legacy-access-token",
          refreshToken: "legacy-refresh-token",
          expiresAt: Date.now() / 1_000 + 3_600,
          scope: "mcp.read",
        },
      },
    }));

    expect(await migrateLegacyMcpAuthorization(config, [legacyPath])).toBe(1);
    await expect(access(legacyPath)).rejects.toThrow();
    expect(await mcpAuthorizationStatus(config, "workspace", "notion")).toEqual({ connected: true });
    const migrated = (await readRuntimeOpencodeConfig(config, "workspace")).mcp?.notion;
    expect(migrated).toMatchObject({
      url: "http://127.0.0.1:3210/mcp-proxy/workspace/notion",
      oauth: false,
    });
    expect(JSON.stringify(migrated)).not.toContain("legacy-access-token");
  });

  test("preserves standalone OpenCode credentials that are not owned by iPolloWork", async () => {
    const config = await testConfig();
    const legacyPath = join(config.workspaces[0]!.path, "mcp-auth.json");
    await writeFile(legacyPath, JSON.stringify({
      standalone: {
        serverUrl: "https://standalone.example/mcp",
        clientInfo: { clientId: "standalone-client" },
        tokens: { accessToken: "standalone-token" },
      },
    }));

    expect(await migrateLegacyMcpAuthorization(config, [legacyPath])).toBe(0);
    expect(JSON.parse(await Bun.file(legacyPath).text())).toEqual({
      standalone: {
        serverUrl: "https://standalone.example/mcp",
        clientInfo: { clientId: "standalone-client" },
        tokens: { accessToken: "standalone-token" },
      },
    });
  });
});
