import { applyEdits, modify, parse } from "jsonc-parser";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  readOpencodeConfig,
  writeOpencodeConfig,
} from "../../../../app/lib/desktop";
import type { DenOrgLlmProviderConnection } from "../../../../app/lib/den";
import { unwrap, waitForHealthy } from "../../../../app/lib/opencode";
import type { Client } from "../../../../app/types";
import { isDesktopRuntime } from "../../../../app/utils";
import { getCloudProviderEnv } from "./cloud-provider-config";
import type {
  ProviderEngineAdapter,
  ProviderEngineConnection,
} from "./provider-engine-adapter";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMethod(value: unknown, name: string) {
  return isRecord(value) && typeof value[name] === "function";
}

function isOpenCodeClient(value: unknown): value is Client {
  if (!isRecord(value)) return false;
  return (
    hasMethod(value.provider, "list") &&
    hasMethod(value.provider, "auth") &&
    isRecord(value.provider) &&
    isRecord(value.provider.oauth) &&
    hasMethod(value.provider.oauth, "authorize") &&
    hasMethod(value.provider.oauth, "callback") &&
    hasMethod(value.auth, "set") &&
    hasMethod(value.auth, "remove") &&
    hasMethod(value.config, "get") &&
    hasMethod(value.config, "update") &&
    hasMethod(value.instance, "dispose")
  );
}

function openCodeConnection(client: unknown): ProviderEngineConnection {
  if (!isOpenCodeClient(client)) {
    throw new Error("OpenCode provider client is unavailable");
  }

  return {
    async listProviders(directory) {
      return unwrap(await client.provider.list({ directory: directory?.trim() || undefined }));
    },
    async listAuthMethods() {
      const methods = unwrap(await client.provider.auth());
      return Object.fromEntries(
        Object.entries(methods).map(([providerId, entries]) => [
          providerId,
          entries.map(({ type, label }) => ({ type, label })),
        ]),
      );
    },
    async authorizeOAuth(providerId, methodIndex) {
      return unwrap(
        await client.provider.oauth.authorize({
          providerID: providerId,
          method: methodIndex,
        }),
      );
    },
    async completeOAuth(providerId, methodIndex, code) {
      unwrap(
        await client.provider.oauth.callback({
          providerID: providerId,
          method: methodIndex,
          code: code?.trim() || undefined,
        }),
      );
    },
    async setApiKey(providerId, apiKey) {
      unwrap(
        await client.auth.set({
          providerID: providerId,
          auth: { type: "api", key: apiKey },
        }),
      );
    },
    async removeCredentials(providerId) {
      unwrap(await client.auth.remove({ providerID: providerId }));
    },
    async readDisabledProviders() {
      const config = unwrap(await client.config.get());
      return Array.isArray(config.disabled_providers) ? config.disabled_providers : [];
    },
    async writeDisabledProviders(providerIds) {
      const config = unwrap(await client.config.get());
      const next = { ...config };
      if (providerIds.length) {
        next.disabled_providers = providerIds;
      } else {
        delete next.disabled_providers;
      }
      unwrap(await client.config.update({ config: next }));
    },
    async dispose() {
      unwrap(await client.instance.dispose());
    },
    async waitUntilHealthy() {
      await waitForHealthy(client, { timeoutMs: 8000, pollMs: 250 });
    },
  };
}

function normalizeDisabledProviders(value: unknown) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function projectProviderIds(raw: string) {
  const config: unknown = parse(raw);
  if (!isRecord(config) || !isRecord(config.provider)) return [];
  return Object.keys(config.provider);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatOpenCodeConfigWithoutProvider(
  raw: string,
  providerId: string,
  disabledProviders: string[],
) {
  const commentPattern = new RegExp(
    `(^[ \\t]*)// iPolloWork Cloud import:.*\\n\\1(?="${escapeRegExp(providerId)}":)`,
    "m",
  );
  let updated = raw.replace(commentPattern, "$1");
  updated = applyEdits(
    updated,
    modify(updated, ["provider", providerId], undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
  updated = applyEdits(
    updated,
    modify(
      updated,
      ["disabled_providers"],
      disabledProviders.filter((id) => id !== providerId),
      { formattingOptions: { insertSpaces: true, tabSize: 2 } },
    ),
  );
  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

function buildOpenCodeCloudProviderPatch(
  provider: DenOrgLlmProviderConnection,
  localProviderId: string,
  previousProviderId?: string | null,
) {
  const modelFields = [
    "family",
    "release_date",
    "attachment",
    "reasoning",
    "temperature",
    "tool_call",
    "interleaved",
    "cost",
    "limit",
    "modalities",
    "status",
    "options",
    "headers",
    "provider",
    "variants",
  ] as const;
  const models = Object.fromEntries(
    provider.models.map((model) => [
      model.id,
      {
        id: model.id,
        name: model.name,
        ...Object.fromEntries(
          modelFields.flatMap((key) =>
            model.config[key] === undefined ? [] : [[key, model.config[key]]],
          ),
        ),
      },
    ]),
  );
  const config: Record<string, unknown> = {
    id: provider.providerId,
    name: provider.name,
    env: getCloudProviderEnv(provider.providerConfig),
    models,
  };
  const npm = provider.providerConfig.npm;
  const api = provider.providerConfig.api;
  if (typeof npm === "string" && npm.trim()) config.npm = npm;
  if (typeof api === "string" && api.trim()) config.api = api;
  if (isRecord(provider.providerConfig.options)) config.options = provider.providerConfig.options;
  if (Array.isArray(provider.providerConfig.whitelist)) {
    config.whitelist = provider.providerConfig.whitelist.filter(
      (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
    );
  }
  if (Array.isArray(provider.providerConfig.blacklist)) {
    config.blacklist = provider.providerConfig.blacklist.filter(
      (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
    );
  }
  return {
    ...(previousProviderId && previousProviderId !== localProviderId
      ? { [previousProviderId]: null }
      : {}),
    [localProviderId]: config,
  };
}

export const openCodeProviderEngineAdapter: ProviderEngineAdapter = {
  id: DEFAULT_ENGINE_ID,
  configFileName: "opencode.json",
  connect: openCodeConnection,
  emptyProjectConfig: () => '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
  async readProjectConfig(target) {
    if (target.canUseiPolloWorkServer && target.ipolloworkClient && target.workspaceId) {
      return target.ipolloworkClient.readOpencodeConfigFile(target.workspaceId, "project");
    }
    if (target.hasiPolloWorkTarget) {
      throw new Error("iPolloWork server config API is unavailable for this workspace.");
    }
    if (target.isLocalWorkspace && isDesktopRuntime() && target.root) {
      return readOpencodeConfig("project", target.root);
    }
    return null;
  },
  async writeProjectConfig(target, content) {
    if (target.canUseiPolloWorkServer && target.ipolloworkClient && target.workspaceId) {
      const result = await target.ipolloworkClient.writeOpencodeConfigFile(
        target.workspaceId,
        "project",
        content,
      );
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "Failed to write opencode.jsonc");
      }
      return true;
    }
    if (target.hasiPolloWorkTarget) {
      throw new Error("iPolloWork server config API is unavailable for this workspace.");
    }
    if (target.isLocalWorkspace && isDesktopRuntime() && target.root) {
      const result = await writeOpencodeConfig("project", target.root, content);
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "Failed to write opencode.jsonc");
      }
      return true;
    }
    return false;
  },
  async patchRuntimeProviders(target, update) {
    if (!target.canUseiPolloWorkServer || !target.ipolloworkClient || !target.workspaceId) {
      throw new Error("iPolloWork server unavailable. Connect to manage cloud providers.");
    }
    await target.ipolloworkClient.patchConfig(target.workspaceId, {
      opencode: { provider: update },
    });
  },
  async runtimeProviderIds(target) {
    if (!target.canUseiPolloWorkServer || !target.ipolloworkClient || !target.workspaceId) return [];
    const config = await target.ipolloworkClient.getConfig(target.workspaceId);
    return isRecord(config.opencode) && isRecord(config.opencode.provider)
      ? Object.keys(config.opencode.provider)
      : [];
  },
  projectProviderIds,
  formatProjectProviderDisabledState(raw, providerId, disabled) {
    const resolvedProviderId = providerId.trim();
    const config: unknown = parse(raw);
    const currentDisabled = normalizeDisabledProviders(
      isRecord(config) ? config.disabled_providers : undefined,
    );
    const nextDisabled = disabled
      ? [...currentDisabled.filter((entry) => entry !== resolvedProviderId), resolvedProviderId]
      : currentDisabled.filter((entry) => entry !== resolvedProviderId);
    const edits = modify(raw, ["disabled_providers"], nextDisabled.length ? nextDisabled : undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    const updated = applyEdits(raw, edits);
    return updated.endsWith("\n") ? updated : `${updated}\n`;
  },
  formatProjectWithoutProvider: formatOpenCodeConfigWithoutProvider,
  buildCloudProviderPatch: buildOpenCodeCloudProviderPatch,
  buildCompatibleProviderPatch(profile) {
    const api = profile.api?.trim();
    const baseURL = profile.baseURL?.trim();
    if (!api && !baseURL) {
      throw new Error("Compatible provider API URL is required");
    }
    return {
      [profile.id]: {
        npm: profile.npm ?? "@ai-sdk/openai-compatible",
        name: profile.name,
        ...(api ? { api } : { options: { baseURL } }),
        models: profile.models,
      },
    };
  },
};
