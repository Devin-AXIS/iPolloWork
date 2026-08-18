import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { ApiError } from "../../../errors.js";
import type { RequestContext } from "../../../routes/registry.js";
import type { ServerConfig } from "../../../types.js";
import { ensureDir, exists } from "../../../utils.js";
import type { ApiModule, ApiModuleContext, ApiOperation, JsonSchema } from "../../module.js";
import {
  accessibleWorkspaces,
  describeTokenPolicy,
  evaluateWorkspaceAccess,
  isEmptyTokenPolicy,
  isTokenExpired,
  parseTokenPolicy,
  type ApiTokenPolicy,
} from "./policy.js";

/**
 * The `policy` module binds a token to a blast radius.
 *
 * The server already has three token scopes and one global approval mode. That pair is
 * too coarse for unattended callers: a CI token either auto-approves everything or waits
 * forever for a human. A per-token policy narrows the workspaces a token may touch and
 * says, per token, which effects may proceed without asking.
 *
 * Policy mutation is an owner-level action, so `getTokenPolicy` / `setTokenPolicy` use
 * `auth: "host"` - exactly how `/tokens` is protected in `routes/core.ts`. `whoami` is
 * the one client-facing operation: a caller may always read its own identity.
 */

export const POLICY_MODULE_ID = "policy";

const POLICY_STORE_FILENAME = "token-policies.json";

interface TokenPolicyStoreFile {
  schemaVersion: number;
  updatedAt: number;
  policies: Record<string, ApiTokenPolicy>;
}

/**
 * Where per-token policies live.
 *
 * `TokenService` owns `tokens.json` and its record shape has no room for a policy blob,
 * so policies go in a sibling file next to it, resolved with the same precedence:
 * an explicit env override first, then the token store's directory, then the config
 * directory, then `~/.config/ipollowork`.
 */
export function resolveTokenPolicyStorePath(config: ServerConfig): string {
  const override = (process.env.IPOLLOWORK_TOKEN_POLICY_STORE ?? "").trim();
  if (override) return resolve(override);

  const tokenStore = (process.env.IPOLLOWORK_TOKEN_STORE ?? "").trim();
  if (tokenStore) return join(dirname(resolve(tokenStore)), POLICY_STORE_FILENAME);

  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "ipollowork");
  return join(configDir, POLICY_STORE_FILENAME);
}

/** JSON-file store, mirroring `TokenService`'s load-once / write-through approach. */
export class TokenPolicyStore {
  private path: string;
  private loaded = false;
  private policies = new Map<string, ApiTokenPolicy>();

  constructor(config: ServerConfig, options?: { path?: string }) {
    const explicit = options?.path?.trim();
    this.path = explicit ? resolve(explicit) : resolveTokenPolicyStorePath(config);
  }

  get storePath(): string {
    return this.path;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.policies = await readPolicyStore(this.path);
    this.loaded = true;
  }

  async get(tokenId: string): Promise<ApiTokenPolicy> {
    await this.ensureLoaded();
    return this.policies.get(tokenId) ?? {};
  }

  async all(): Promise<Record<string, ApiTokenPolicy>> {
    await this.ensureLoaded();
    return Object.fromEntries(this.policies.entries());
  }

  async set(tokenId: string, policy: ApiTokenPolicy): Promise<ApiTokenPolicy> {
    await this.ensureLoaded();
    if (isEmptyTokenPolicy(policy)) {
      this.policies.delete(tokenId);
    } else {
      this.policies.set(tokenId, policy);
    }
    await this.flush();
    return policy;
  }

  async remove(tokenId: string): Promise<boolean> {
    await this.ensureLoaded();
    const removed = this.policies.delete(tokenId);
    if (removed) await this.flush();
    return removed;
  }

  private async flush(): Promise<void> {
    await ensureDir(dirname(this.path));
    const payload: TokenPolicyStoreFile = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      policies: Object.fromEntries(this.policies.entries()),
    };
    await writeFile(this.path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }
}

async function readPolicyStore(path: string): Promise<Map<string, ApiTokenPolicy>> {
  const out = new Map<string, ApiTokenPolicy>();
  if (!(await exists(path))) return out;
  let parsed: Partial<TokenPolicyStoreFile>;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as Partial<TokenPolicyStoreFile>;
  } catch {
    return out;
  }
  const policies = parsed.policies;
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) return out;
  for (const [tokenId, value] of Object.entries(policies)) {
    if (!tokenId) continue;
    try {
      // A hand-edited or corrupted entry is dropped rather than crashing startup;
      // dropping it falls back to "no policy", which the scope checks still gate.
      const policy = parseTokenPolicy(value);
      if (!isEmptyTokenPolicy(policy)) out.set(tokenId, policy);
    } catch {
      continue;
    }
  }
  return out;
}

const POLICY_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    workspaces: {
      description: "Workspace id allowlist. null means every workspace; [] means none.",
      anyOf: [{ type: "null" }, { type: "array", items: { type: "string" }, maxItems: 256 }],
    },
    approvals: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["inherit", "auto", "manual"],
          description: "inherit defers to IPOLLOWORK_APPROVAL_MODE; manual asks even when the server is in auto mode.",
        },
        autoApprove: {
          type: "array",
          maxItems: 128,
          items: { type: "string", maxLength: 200 },
          description: "Exact effect/action strings, or a single trailing-* prefix such as session.*.",
        },
        denyDestructive: {
          type: "boolean",
          description: "Denies destructive effects outright; overrides autoApprove and mode auto.",
        },
      },
    },
    expiresAt: {
      description: "Epoch milliseconds, or null for no expiry.",
      anyOf: [{ type: "null" }, { type: "number" }],
    },
  },
};

const RESOLVED_POLICY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    workspaces: { anyOf: [{ type: "null" }, { type: "array", items: { type: "string" } }] },
    approvals: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["inherit", "auto", "manual"] },
        autoApprove: { type: "array", items: { type: "string" } },
        denyDestructive: { type: "boolean" },
      },
    },
    expiresAt: { anyOf: [{ type: "null" }, { type: "number" }] },
    expired: { type: "boolean" },
  },
};

const TOKEN_POLICY_RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    tokenId: { type: "string" },
    scope: { type: "string", enum: ["owner", "collaborator", "viewer"] },
    label: { anyOf: [{ type: "null" }, { type: "string" }] },
    createdAt: { type: "number" },
    policy: RESOLVED_POLICY_SCHEMA,
  },
};

const IDENTITY_RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    actor: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["remote", "host"] },
        clientId: { anyOf: [{ type: "null" }, { type: "string" }] },
        scope: { anyOf: [{ type: "null" }, { type: "string", enum: ["owner", "collaborator", "viewer"] }] },
      },
    },
    token: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            id: { type: "string" },
            scope: { type: "string" },
            label: { anyOf: [{ type: "null" }, { type: "string" }] },
            createdAt: { type: "number" },
          },
        },
      ],
    },
    policy: RESOLVED_POLICY_SCHEMA,
    server: {
      type: "object",
      properties: {
        approvalMode: { type: "string", enum: ["manual", "auto"] },
        readOnly: { type: "boolean" },
      },
    },
    workspaces: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
    },
  },
};

const TOKEN_ID_PARAMS: JsonSchema = {
  type: "object",
  required: ["tokenId"],
  properties: { tokenId: { type: "string", description: "Token id as returned by POST /tokens." } },
};

const NOT_FOUND_RESPONSE = { description: "No token with that id." };

function requireTokenId(ctx: RequestContext): string {
  const tokenId = (ctx.params.tokenId ?? "").trim();
  if (!tokenId) {
    throw new ApiError(400, "invalid_token_id", "Token id is required");
  }
  return tokenId;
}

async function requireTokenRecord(ctx: RequestContext, tokenId: string) {
  const records = await ctx.tokens.list();
  const record = records.find((entry) => entry.id === tokenId);
  if (!record) {
    throw new ApiError(404, "token_not_found", "Token not found", { tokenId });
  }
  return record;
}

/**
 * Creates the module. The store is injectable through `services.tokenPolicies` so tests
 * (and any future in-memory deployment) do not have to touch the real config directory.
 */
export function createPolicyModule(): ApiModule {
  return {
    id: POLICY_MODULE_ID,
    title: "Token policy",
    description:
      "Per-token workspace binding, approval policy, and expiry, plus the caller's own resolved identity.",
    version: "1.0.0",
    stability: "preview",

    register(context: ApiModuleContext): ApiOperation[] {
      const store = (context.services.tokenPolicies as TokenPolicyStore | undefined)
        ?? new TokenPolicyStore(context.config);

      return [
        {
          operationId: "getTokenPolicy",
          method: "GET",
          path: "/api/v1/tokens/:tokenId/policy",
          summary: "Read the policy bound to a token",
          description:
            "Returns the stored policy with every default resolved. A token with no stored policy reports the unconstrained defaults.",
          effect: "read",
          auth: "host",
          pathParams: TOKEN_ID_PARAMS,
          responses: {
            200: { description: "The token's resolved policy.", schema: TOKEN_POLICY_RESPONSE_SCHEMA },
            404: NOT_FOUND_RESPONSE,
          },
          handler: async (ctx) => {
            const tokenId = requireTokenId(ctx);
            const record = await requireTokenRecord(ctx, tokenId);
            const policy = await store.get(tokenId);
            return context.jsonResponse({
              tokenId: record.id,
              scope: record.scope,
              label: record.label ?? null,
              createdAt: record.createdAt,
              policy: describeTokenPolicy(policy, Date.now()),
            });
          },
        },
        {
          operationId: "setTokenPolicy",
          method: "PUT",
          path: "/api/v1/tokens/:tokenId/policy",
          summary: "Replace the policy bound to a token",
          description:
            "Full replacement, not a merge. The body is the policy object itself, or `{ \"policy\": { ... } }`. An empty object clears the policy.",
          effect: "write",
          auth: "host",
          pathParams: TOKEN_ID_PARAMS,
          requestBody: POLICY_SCHEMA,
          responses: {
            200: { description: "The stored policy.", schema: TOKEN_POLICY_RESPONSE_SCHEMA },
            400: { description: "The policy failed validation." },
            404: NOT_FOUND_RESPONSE,
          },
          handler: async (ctx) => {
            const tokenId = requireTokenId(ctx);
            const record = await requireTokenRecord(ctx, tokenId);
            const body = await context.readJsonBody(ctx.request);
            const raw = Object.prototype.hasOwnProperty.call(body, "policy") ? body.policy : body;
            const policy = parseTokenPolicy(raw);
            await store.set(tokenId, policy);
            return context.jsonResponse({
              tokenId: record.id,
              scope: record.scope,
              label: record.label ?? null,
              createdAt: record.createdAt,
              policy: describeTokenPolicy(policy, Date.now()),
            });
          },
        },
        {
          operationId: "getCurrentIdentity",
          method: "GET",
          path: "/api/v1/whoami",
          summary: "Describe the calling token",
          description:
            "Returns the caller's scope, its resolved policy, and the workspaces that policy allows. Callers use this to discover their own blast radius before attempting work.",
          effect: "read",
          scope: "viewer",
          responses: {
            200: { description: "The caller's identity and effective policy.", schema: IDENTITY_RESPONSE_SCHEMA },
          },
          handler: async (ctx) => {
            const actor = ctx.actor;
            if (!actor) {
              throw new ApiError(401, "unauthorized", "Missing actor");
            }
            const record = actor.tokenHash ? await ctx.tokens.findByHash(actor.tokenHash) : null;
            const policy = record ? await store.get(record.id) : {};
            const now = Date.now();
            const allowedIds = new Set(
              accessibleWorkspaces(policy, ctx.config.workspaces.map((workspace) => workspace.id)),
            );

            return context.jsonResponse({
              actor: {
                type: actor.type,
                clientId: actor.clientId ?? null,
                scope: actor.scope ?? null,
              },
              token: record
                ? {
                  id: record.id,
                  scope: record.scope,
                  label: record.label ?? null,
                  createdAt: record.createdAt,
                }
                : null,
              policy: describeTokenPolicy(policy, now),
              server: {
                approvalMode: ctx.config.approval.mode,
                readOnly: ctx.config.readOnly,
              },
              workspaces: ctx.config.workspaces
                .filter((workspace) => allowedIds.has(workspace.id))
                .map((workspace) => ({ id: workspace.id, name: workspace.name })),
            });
          },
        },
      ];
    },
  };
}

export const policyModule: ApiModule = createPolicyModule();

/**
 * Convenience gate for other modules: throws when the caller's policy excludes the
 * workspace or the token has expired. Kept here so the enforcement wording lives with
 * the policy module rather than being retyped per call site.
 */
export function assertPolicyAllowsWorkspace(
  policy: ApiTokenPolicy | null | undefined,
  workspaceId: string,
  now: number = Date.now(),
  options: { skipWorkspaceCheck?: boolean } = {},
): void {
  if (isTokenExpired(policy, now)) {
    throw new ApiError(403, "token_expired", "This token has expired", { expiresAt: policy?.expiresAt ?? null });
  }
  // Expiry applies to every route; the workspace binding only means something on a route
  // that names one, and treating "no workspace in the path" as a denied workspace would
  // lock a bound token out of `/api/v1/whoami`.
  if (options.skipWorkspaceCheck) return;
  const access = evaluateWorkspaceAccess(policy, workspaceId);
  if (!access.allowed) {
    throw new ApiError(403, "workspace_forbidden", "This token may not access that workspace", {
      workspaceId,
      reason: access.reason,
    });
  }
}
