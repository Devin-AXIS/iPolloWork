import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeMcpAuthorization,
  mcpAuthorizationStatus,
  proxyMcpRequest,
  publicMcpConfig,
  secureMcpAuthorizationConfig,
  startMcpAuthorization,
} from "./mcp-authorization.js";
import { listMcp, listRuntimeMcp } from "./mcp.js";
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

    expect(secured).toMatchObject({ type: "remote", enabled: true, oauth: false });
    expect(secured.url).toMatch(/^http:\/\/127\.0\.0\.1:3210\/mcp-proxy\/workspace\/github\?connection=mcp%3A/);
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
    const engineItem = (await listRuntimeMcp(config, "workspace")).find((item) => item.name === "github");
    expect(engineItem?.config).toEqual(secured);
    expect((engineItem?.config.headers as Record<string, unknown>).Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{32,}$/);

    const publicItem = (await listMcp(config, "workspace", config.workspaces[0]!.path))
      .find((item) => item.name === "github");
    expect(publicItem?.config).toEqual({
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

    const secondWorkspaceId = "workspace-two";
    config.workspaces.push({
      ...config.workspaces[0]!,
      id: secondWorkspaceId,
      name: "Workspace Two",
    });
    const secondEngineConfig = await secureMcpAuthorizationConfig(config, secondWorkspaceId, "github-shared", {
      type: "remote",
      url: "https://mcp.example/rpc",
      enabled: true,
      oauth: {},
    });
    await writeRuntimeOpencodeConfig(config, secondWorkspaceId, (current) => ({
      ...current,
      mcp: { "github-shared": secondEngineConfig },
    }));
    expect(await mcpAuthorizationStatus(config, secondWorkspaceId, "github-shared")).toEqual({ connected: true });
    expect(new URL(String(secondEngineConfig.url)).searchParams.get("connection"))
      .toBe(new URL(String((await readRuntimeOpencodeConfig(config, "workspace")).mcp?.github?.url)).searchParams.get("connection"));

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

});
