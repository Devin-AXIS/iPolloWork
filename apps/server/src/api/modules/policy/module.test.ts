import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { isApiError } from "../../../errors.js";
import type { RequestContext, Route } from "../../../routes/registry.js";
import { matchRoute } from "../../../routes/registry.js";
import type { TokenService } from "../../../tokens.js";
import type { Actor, ServerConfig } from "../../../types.js";
import { registerApiModules, type ApiModuleContext, type ApiOperation } from "../../module.js";
import {
  TokenPolicyStore,
  assertPolicyAllowsWorkspace,
  createPolicyModule,
  policyModule,
  resolveTokenPolicyStorePath,
} from "./module.js";

type StoredToken = { id: string; scope: "owner" | "collaborator" | "viewer"; createdAt: number; label?: string; hash?: string };

const TOKENS: StoredToken[] = [
  { id: "tok_ci", scope: "collaborator", createdAt: 1_000, label: "ci", hash: "hash-ci" },
  { id: "tok_view", scope: "viewer", createdAt: 2_000, hash: "hash-view" },
];

function fakeTokenService(records: StoredToken[] = TOKENS): TokenService {
  return {
    list: async () => records.map(({ hash: _hash, ...rest }) => rest),
    findByHash: async (hash: string) => {
      const found = records.find((record) => record.hash === hash);
      if (!found) return null;
      const { hash: _hash, ...rest } = found;
      return rest;
    },
  } as unknown as TokenService;
}

function serverConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    workspaces: [
      { id: "w1", name: "Alpha" },
      { id: "w2", name: "Beta" },
    ],
    approval: { mode: "manual", timeoutMs: 1_000 },
    readOnly: false,
    ...overrides,
  } as unknown as ServerConfig;
}

let storeDir: string;
let store: TokenPolicyStore;
let config: ServerConfig;

function moduleContext(overrides: Partial<ApiModuleContext> = {}): ApiModuleContext {
  return {
    config,
    ensureWritable: () => {},
    requireClientScope: () => {},
    jsonResponse: (data, status = 200) => Response.json(data as never, { status }),
    readJsonBody: async (request) => {
      try {
        return (await request.json()) as Record<string, unknown>;
      } catch {
        return {};
      }
    },
    resolveWorkspace: async () => ({ id: "w1" }),
    services: { tokenPolicies: store },
    ...overrides,
  };
}

function operations(context: ApiModuleContext = moduleContext()): ApiOperation[] {
  return createPolicyModule().register(context);
}

function operation(operationId: string, context: ApiModuleContext = moduleContext()): ApiOperation {
  const found = operations(context).find((op) => op.operationId === operationId);
  if (!found) throw new Error(`missing operation ${operationId}`);
  return found;
}

function requestContext(
  request: Request,
  params: Record<string, string> = {},
  extra: { actor?: Actor; tokens?: TokenService; config?: ServerConfig } = {},
): RequestContext {
  return {
    request,
    url: new URL(request.url),
    params,
    config: extra.config ?? config,
    approvals: {} as never,
    reloadEvents: {} as never,
    tokens: extra.tokens ?? fakeTokenService(),
    actor: extra.actor,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "ipollowork-policy-"));
  store = new TokenPolicyStore(serverConfig(), { path: join(storeDir, "token-policies.json") });
  config = serverConfig();
});

afterEach(() => {
  delete process.env.IPOLLOWORK_TOKEN_POLICY_STORE;
  delete process.env.IPOLLOWORK_TOKEN_STORE;
});

describe("module declaration", () => {
  test("identifies itself", () => {
    expect(policyModule.id).toBe("policy");
    expect(policyModule.version).toBe("1.0.0");
    expect(policyModule.stability).toBe("preview");
  });

  test("declares exactly the three phase-1 operations", () => {
    expect(operations().map((op) => `${op.method} ${op.path}`)).toEqual([
      "GET /api/v1/tokens/:tokenId/policy",
      "PUT /api/v1/tokens/:tokenId/policy",
      "GET /api/v1/whoami",
    ]);
    expect(operations().map((op) => op.operationId)).toEqual([
      "getTokenPolicy",
      "setTokenPolicy",
      "getCurrentIdentity",
    ]);
  });

  test("policy mutation is host-authenticated, matching how /tokens is protected", () => {
    expect(operation("getTokenPolicy").auth).toBe("host");
    expect(operation("setTokenPolicy").auth).toBe("host");
  });

  test("whoami is a client-scoped read any token may call", () => {
    const whoami = operation("getCurrentIdentity");
    expect(whoami.auth ?? "client").toBe("client");
    expect(whoami.effect).toBe("read");
    expect(whoami.scope).toBe("viewer");
  });

  test("effects match the read/write split", () => {
    expect(operation("getTokenPolicy").effect).toBe("read");
    expect(operation("setTokenPolicy").effect).toBe("write");
  });

  test("every operation documents its request and response shapes", () => {
    for (const op of operations()) {
      expect(op.summary.length).toBeGreaterThan(0);
      expect(op.responses?.[200]).toBeDefined();
    }
    expect(operation("setTokenPolicy").requestBody).toBeDefined();
    expect(operation("getTokenPolicy").pathParams).toBeDefined();
  });

  test("registers onto the shared route table", () => {
    const routes: Route[] = [];
    const result = registerApiModules(routes, [createPolicyModule()], moduleContext());
    expect(result.operations).toHaveLength(3);
    expect(matchRoute(routes, "GET", "/api/v1/whoami")).not.toBeNull();
    expect(matchRoute(routes, "PUT", "/api/v1/tokens/tok_ci/policy")?.params).toEqual({ tokenId: "tok_ci" });
    expect(routes.filter((route) => route.auth === "host")).toHaveLength(2);
  });
});

describe("getTokenPolicy", () => {
  test("returns resolved defaults for a token with no stored policy", async () => {
    const response = await operation("getTokenPolicy").handler(
      requestContext(new Request("http://localhost/api/v1/tokens/tok_ci/policy"), { tokenId: "tok_ci" }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      tokenId: "tok_ci",
      scope: "collaborator",
      label: "ci",
      createdAt: 1_000,
      policy: {
        workspaces: null,
        approvals: { mode: "inherit", autoApprove: [], denyDestructive: false },
        expiresAt: null,
        expired: false,
      },
    });
  });

  test("404s for an unknown token", async () => {
    try {
      await operation("getTokenPolicy").handler(
        requestContext(new Request("http://localhost/api/v1/tokens/nope/policy"), { tokenId: "nope" }),
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as { status: number }).status).toBe(404);
      expect((error as { code: string }).code).toBe("token_not_found");
    }
  });

  test("400s when the path param is blank", async () => {
    try {
      await operation("getTokenPolicy").handler(
        requestContext(new Request("http://localhost/api/v1/tokens/%20/policy"), { tokenId: " " }),
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code: string }).code).toBe("invalid_token_id");
    }
  });
});

describe("setTokenPolicy", () => {
  function putRequest(body: unknown): Request {
    return new Request("http://localhost/api/v1/tokens/tok_ci/policy", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  test("stores a normalized policy and reads it back", async () => {
    const written = await operation("setTokenPolicy").handler(
      requestContext(
        putRequest({
          workspaces: [" w1 ", "w1"],
          approvals: { mode: "manual", autoApprove: ["session.*"], denyDestructive: true },
          expiresAt: 4_000_000_000_000,
        }),
        { tokenId: "tok_ci" },
      ),
    );
    expect((await json(written)).policy).toEqual({
      workspaces: ["w1"],
      approvals: { mode: "manual", autoApprove: ["session.*"], denyDestructive: true },
      expiresAt: 4_000_000_000_000,
      expired: false,
    });

    const read = await operation("getTokenPolicy").handler(
      requestContext(new Request("http://localhost/api/v1/tokens/tok_ci/policy"), { tokenId: "tok_ci" }),
    );
    expect((await json(read)).policy).toEqual({
      workspaces: ["w1"],
      approvals: { mode: "manual", autoApprove: ["session.*"], denyDestructive: true },
      expiresAt: 4_000_000_000_000,
      expired: false,
    });
  });

  test("accepts the policy wrapped in a policy key", async () => {
    await operation("setTokenPolicy").handler(
      requestContext(putRequest({ policy: { workspaces: ["w2"] } }), { tokenId: "tok_ci" }),
    );
    expect(await store.get("tok_ci")).toEqual({ workspaces: ["w2"] });
  });

  test("an empty body clears the policy", async () => {
    await store.set("tok_ci", { workspaces: ["w1"] });
    await operation("setTokenPolicy").handler(requestContext(putRequest({}), { tokenId: "tok_ci" }));
    expect(await store.get("tok_ci")).toEqual({});
  });

  test("replaces rather than merges", async () => {
    await operation("setTokenPolicy").handler(
      requestContext(putRequest({ workspaces: ["w1"], approvals: { mode: "auto" } }), { tokenId: "tok_ci" }),
    );
    await operation("setTokenPolicy").handler(
      requestContext(putRequest({ approvals: { mode: "manual" } }), { tokenId: "tok_ci" }),
    );
    expect(await store.get("tok_ci")).toEqual({ approvals: { mode: "manual" } });
  });

  test("rejects an invalid policy with a field-scoped 400", async () => {
    try {
      await operation("setTokenPolicy").handler(
        requestContext(putRequest({ approvals: { mode: "always" } }), { tokenId: "tok_ci" }),
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { status: number }).status).toBe(400);
      expect((error as { code: string }).code).toBe("invalid_token_policy");
      expect((error as { details: { field: string } }).details.field).toBe("approvals.mode");
    }
  });

  test("rejects an unknown field instead of silently dropping it", async () => {
    try {
      await operation("setTokenPolicy").handler(
        requestContext(putRequest({ workspace: ["w1"] }), { tokenId: "tok_ci" }),
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { details: { field: string } }).details.field).toBe("workspace");
    }
  });

  test("does not write a policy for an unknown token", async () => {
    await expect(
      operation("setTokenPolicy").handler(
        requestContext(
          new Request("http://localhost/api/v1/tokens/nope/policy", {
            method: "PUT",
            body: JSON.stringify({ workspaces: ["w1"] }),
          }),
          { tokenId: "nope" },
        ),
      ),
    ).rejects.toThrow(/Token not found/);
    expect(await store.all()).toEqual({});
  });
});

describe("getCurrentIdentity", () => {
  const actor: Actor = { type: "remote", clientId: "cli-1", tokenHash: "hash-ci", scope: "collaborator" };

  test("reports scope, token, policy, server mode and every workspace when unconstrained", async () => {
    const response = await operation("getCurrentIdentity").handler(
      requestContext(new Request("http://localhost/api/v1/whoami"), {}, { actor }),
    );
    expect(await json(response)).toEqual({
      actor: { type: "remote", clientId: "cli-1", scope: "collaborator" },
      token: { id: "tok_ci", scope: "collaborator", label: "ci", createdAt: 1_000 },
      policy: {
        workspaces: null,
        approvals: { mode: "inherit", autoApprove: [], denyDestructive: false },
        expiresAt: null,
        expired: false,
      },
      server: { approvalMode: "manual", readOnly: false },
      workspaces: [{ id: "w1", name: "Alpha" }, { id: "w2", name: "Beta" }],
    });
  });

  test("narrows the workspace list to the policy allowlist", async () => {
    await store.set("tok_ci", { workspaces: ["w2"] });
    const response = await operation("getCurrentIdentity").handler(
      requestContext(new Request("http://localhost/api/v1/whoami"), {}, { actor }),
    );
    const body = await json(response);
    expect(body.workspaces).toEqual([{ id: "w2", name: "Beta" }]);
    expect((body.policy as { workspaces: string[] }).workspaces).toEqual(["w2"]);
  });

  test("reports an expired token as expired", async () => {
    await store.set("tok_ci", { expiresAt: 1 });
    const response = await operation("getCurrentIdentity").handler(
      requestContext(new Request("http://localhost/api/v1/whoami"), {}, { actor }),
    );
    expect((await json(response)).policy).toMatchObject({ expired: true, expiresAt: 1 });
  });

  test("handles the shared config token, which has no stored record", async () => {
    const response = await operation("getCurrentIdentity").handler(
      requestContext(
        new Request("http://localhost/api/v1/whoami"),
        {},
        { actor: { type: "remote", tokenHash: "unknown-hash", scope: "collaborator" } },
      ),
    );
    const body = await json(response);
    expect(body.token).toBeNull();
    expect(body.actor).toEqual({ type: "remote", clientId: null, scope: "collaborator" });
    expect(body.workspaces).toHaveLength(2);
  });

  test("401s when there is no actor on the request", async () => {
    try {
      await operation("getCurrentIdentity").handler(requestContext(new Request("http://localhost/api/v1/whoami")));
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { status: number }).status).toBe(401);
    }
  });
});

describe("TokenPolicyStore", () => {
  test("persists to disk and reloads from it", async () => {
    const path = join(storeDir, "roundtrip.json");
    const first = new TokenPolicyStore(config, { path });
    await first.set("tok_ci", { workspaces: ["w1"], approvals: { mode: "manual" } });

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(1);
    expect(raw.policies).toEqual({ tok_ci: { workspaces: ["w1"], approvals: { mode: "manual" } } });

    const second = new TokenPolicyStore(config, { path });
    expect(await second.get("tok_ci")).toEqual({ workspaces: ["w1"], approvals: { mode: "manual" } });
    expect(await second.get("tok_view")).toEqual({});
  });

  test("an empty policy removes the entry instead of storing noise", async () => {
    await store.set("tok_ci", { workspaces: ["w1"] });
    await store.set("tok_ci", {});
    expect(await store.all()).toEqual({});
  });

  test("remove reports whether anything was there", async () => {
    await store.set("tok_ci", { workspaces: ["w1"] });
    expect(await store.remove("tok_ci")).toBe(true);
    expect(await store.remove("tok_ci")).toBe(false);
  });

  test("a missing file reads as no policies", async () => {
    const fresh = new TokenPolicyStore(config, { path: join(storeDir, "absent.json") });
    expect(await fresh.all()).toEqual({});
  });

  test("a corrupt file degrades to no policies rather than crashing", async () => {
    const path = join(storeDir, "corrupt.json");
    await Bun.write(path, "{not json");
    expect(await new TokenPolicyStore(config, { path }).all()).toEqual({});
  });

  test("an invalid entry is dropped while valid siblings survive", async () => {
    const path = join(storeDir, "mixed.json");
    await Bun.write(
      path,
      JSON.stringify({
        schemaVersion: 1,
        policies: { tok_ci: { workspaces: ["w1"] }, tok_bad: { approvals: { mode: "always" } } },
      }),
    );
    expect(await new TokenPolicyStore(config, { path }).all()).toEqual({ tok_ci: { workspaces: ["w1"] } });
  });
});

describe("resolveTokenPolicyStorePath", () => {
  test("honours the explicit override", () => {
    process.env.IPOLLOWORK_TOKEN_POLICY_STORE = "/tmp/custom-policies.json";
    expect(resolveTokenPolicyStorePath(config)).toBe("/tmp/custom-policies.json");
  });

  test("sits next to the token store when that is overridden", () => {
    process.env.IPOLLOWORK_TOKEN_STORE = "/tmp/store/tokens.json";
    expect(resolveTokenPolicyStorePath(config)).toBe("/tmp/store/token-policies.json");
  });

  test("sits next to the config file otherwise", () => {
    expect(resolveTokenPolicyStorePath(serverConfig({ configPath: "/tmp/cfg/ipollowork.json" })))
      .toBe("/tmp/cfg/token-policies.json");
  });
});

describe("assertPolicyAllowsWorkspace", () => {
  test("passes for an unconstrained policy", () => {
    expect(() => assertPolicyAllowsWorkspace({}, "w1", 1_000)).not.toThrow();
  });

  test("403s on a workspace outside the allowlist", () => {
    try {
      assertPolicyAllowsWorkspace({ workspaces: ["w2"] }, "w1", 1_000);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { status: number }).status).toBe(403);
      expect((error as { code: string }).code).toBe("workspace_forbidden");
      expect((error as { details: { reason: string } }).details.reason).toBe("workspace_not_allowed");
    }
  });

  test("403s on an expired token before checking the workspace", () => {
    try {
      assertPolicyAllowsWorkspace({ expiresAt: 500, workspaces: ["w1"] }, "w1", 1_000);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code: string }).code).toBe("token_expired");
    }
  });
});
