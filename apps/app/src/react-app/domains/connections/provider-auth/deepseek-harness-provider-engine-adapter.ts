import {
  DEEPSEEK_HARNESS_ENGINE_ID,
  deepSeekHarnessRuntimeProviderRouteId,
} from "@ipollowork/types/workspace";
import { providerApiKeyCredentialRef } from "@ipollowork/types/provider-credentials";

import {
  deepSeekHarnessAccountProviderId,
  DeepSeekHarnessClient,
  isDeepSeekHarnessRpcClient,
} from "@/app/lib/deepseek-harness-client";
import type { ProviderListItem } from "@/app/types";
import type {
  ModelRuntimeAdapter,
  ModelRuntimeConnection,
} from "./provider-engine-adapter";

type DeepSeekHarnessModelList = {
  groups: Array<{
    id: string;
    name: string;
    models: Array<{
      id: string;
      name: string;
      contextWindow?: number;
      maxTokens?: number;
      reasoning?: {
        efforts?: Array<{ id: string; name?: string }>;
        defaultEffort?: string;
      };
    }>;
  }>;
};

type DeepSeekHarnessCredentialDescription = {
  credentials: Record<string, { configured?: boolean; writable?: boolean }>;
};

type DeepSeekHarnessProviderDirectory = {
  providers: Array<{
    provider: string;
    displayName: string;
    settingsNs: string;
    settingsPath: string[];
    active: boolean;
  }>;
};

type DeepSeekHarnessSettingsDescription = {
  namespaces: Array<{ ns: string; value?: unknown }>;
};

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function connection(client: unknown): ModelRuntimeConnection {
  if (!isDeepSeekHarnessRpcClient(client)) {
    throw new Error("DeepSeek Harness provider client is unavailable");
  }

  const listModels = () => client.call<DeepSeekHarnessModelList>("llm.models", {});
  const listProviderDirectory = () => client.call<DeepSeekHarnessProviderDirectory>("llm.providers", {});
  const describeSettings = () => client.call<DeepSeekHarnessSettingsDescription>("settings.describe", {});
  const describeCredentials = (refs: string[]): Promise<DeepSeekHarnessCredentialDescription> => refs.length
    ? client.call<DeepSeekHarnessCredentialDescription>("credentials.describe", { refs })
    : Promise.resolve({ credentials: {} });

  return {
    async listProviders() {
      const [models, directory, settings] = await Promise.all([
        listModels(),
        listProviderDirectory(),
        describeSettings(),
      ]);
      const namespaceValues = new Map(settings.namespaces.map((entry) => [entry.ns, entry.value]));
      const refsByProvider = new Map(directory.providers.flatMap((entry) => {
        const profile = readPath(namespaceValues.get(entry.settingsNs), entry.settingsPath);
        const ref = profile && typeof profile === "object" && !Array.isArray(profile)
          ? (profile as Record<string, unknown>).apiKeyEnv
          : undefined;
        return typeof ref === "string" && ref.trim()
          ? [[entry.provider, ref.trim()] as const]
          : [];
      }));
      refsByProvider.set("deepseek-official", providerApiKeyCredentialRef("deepseek-official"));
      // These routes are built into DSH, but their models are not public.
      // Require an iPolloWork-synced credential even when an older DSH
      // settings schema omits apiKeyEnv from settings.describe.
      refsByProvider.set("openai", providerApiKeyCredentialRef("openai"));
      refsByProvider.set("openai-codex", providerApiKeyCredentialRef("openai-codex"));
      refsByProvider.set("openai-codex-priority", providerApiKeyCredentialRef("openai-codex"));
      const refs = [...new Set(models.groups.flatMap((group) => refsByProvider.get(group.id) ?? []))];
      const credentialState = await describeCredentials(refs);
      const allById = new Map<string, ProviderListItem>();
      const connected = new Set<string>();
      const defaults: Record<string, string> = {};
      for (const group of models.groups) {
        const providerId = deepSeekHarnessAccountProviderId(group.id);
        const ref = refsByProvider.get(group.id) ?? null;
        const providerModels = Object.fromEntries(group.models.map((model) => {
          const efforts = model.reasoning?.efforts ?? [];
          return [model.id, {
            id: model.id,
            name: model.name,
            ...(typeof model.contextWindow === "number" && model.contextWindow > 0
              ? { contextWindow: model.contextWindow }
              : {}),
            ...(typeof model.maxTokens === "number" && model.maxTokens > 0
              ? { maxTokens: model.maxTokens }
              : {}),
            capabilities: {
              attachment: false,
              reasoning: efforts.length > 0,
              input: { image: false },
            },
            ...(efforts.length
              ? { variants: Object.fromEntries(efforts.map((effort) => [effort.id, { name: effort.name ?? effort.id }])) }
              : {}),
          }];
        }));
        const previous = allById.get(providerId);
        allById.set(providerId, {
          id: providerId,
          name: group.name,
          source: "config",
          env: [...new Set([...(previous?.env ?? []), ...(ref ? [ref] : [])])],
          models: { ...(previous?.models ?? {}), ...providerModels },
        });
        if (!ref || credentialState.credentials[ref]?.configured) connected.add(providerId);
        if (!(providerId in defaults) && group.models[0]) defaults[providerId] = group.models[0].id;
      }
      return {
        all: [...allById.values()],
        connected: [...connected],
        default: defaults,
      };
    },
    async listAuthMethods() {
      const directory = await listProviderDirectory();
      return Object.fromEntries(directory.providers.map((provider) => [
        deepSeekHarnessAccountProviderId(provider.provider),
        [{ type: "api" as const, label: "API key" }],
      ]));
    },
    async authorizeOAuth() {
      throw new Error("DeepSeek Harness does not expose OAuth for this provider");
    },
    async completeOAuth() {
      throw new Error("DeepSeek Harness does not expose OAuth for this provider");
    },
    async setApiKey(providerId, apiKey) {
      const resolvedProviderId = providerId.trim().toLowerCase();
      const runtimeProviderId = deepSeekHarnessRuntimeProviderRouteId(resolvedProviderId);
      const [directory, settings] = await Promise.all([
        listProviderDirectory(),
        describeSettings(),
      ]);
      const route = directory.providers.find((entry) => entry.provider === runtimeProviderId);
      if (!route) {
        throw new Error(`DeepSeek Harness does not support provider: ${providerId}`);
      }
      const ref = providerApiKeyCredentialRef(runtimeProviderId);
      // Persist the secret before touching settings. If another DSH process
      // owns the writer lock, an already-correct route still becomes usable.
      await client.call("credentials.set", { ref, value: apiKey });
      const namespace = settings.namespaces.find((entry) => entry.ns === route.settingsNs);
      const profile = readPath(namespace?.value, route.settingsPath);
      const currentRef = profile && typeof profile === "object" && !Array.isArray(profile)
        ? (profile as Record<string, unknown>).apiKeyEnv
        : undefined;
      if (currentRef !== ref) {
        await client.call("settings.mutate", {
          ns: route.settingsNs,
          ops: [{
            op: "set",
            path: [...route.settingsPath, "apiKeyEnv"],
            value: ref,
          }],
        });
      }
    },
    async removeCredentials(providerId) {
      const resolvedProviderId = providerId.trim().toLowerCase();
      const runtimeProviderId = deepSeekHarnessRuntimeProviderRouteId(resolvedProviderId);
      const refs = new Set([providerApiKeyCredentialRef(runtimeProviderId)]);
      if (resolvedProviderId === "openai") {
        // DSH can expose the same account provider through both the API-key
        // route and its Codex OAuth bridge. Both are engine-local caches of the
        // shared OpenAI account and must disappear in one disconnect action.
        refs.add(providerApiKeyCredentialRef("openai-codex"));
      }
      for (const ref of refs) {
        await client.call("credentials.unset", { ref });
      }
    },
    async readDisabledProviders() {
      return [];
    },
    async writeDisabledProviders(providerIds) {
      if (providerIds.length) {
        throw new Error("DeepSeek Harness does not expose disabled provider configuration");
      }
    },
    async dispose() {},
    async waitUntilHealthy() {
      await listModels();
    },
  };
}

function unsupportedProviderConfiguration(): never {
  throw new Error("DeepSeek Harness provider configuration is managed by its native runtime");
}

export const deepSeekHarnessProviderEngineAdapter: ModelRuntimeAdapter = {
  id: DEEPSEEK_HARNESS_ENGINE_ID,
  configFileName: "DeepSeek Harness",
  capabilities: {
    cloudProviderImports: false,
    customProviders: false,
    disabledProviders: false,
    authChangesRequireReload: false,
  },
  createClient({ endpoint }) {
    return new DeepSeekHarnessClient({
      serverBaseUrl: endpoint.baseUrl,
      workspaceId: endpoint.workspaceId,
      token: endpoint.token,
    });
  },
  connect: connection,
  emptyProjectConfig: () => "{}\n",
  async readProjectConfig() {
    return null;
  },
  async writeProjectConfig() {
    return false;
  },
  async patchRuntimeProviders() {
    unsupportedProviderConfiguration();
  },
  async runtimeProviderIds() {
    return [];
  },
  projectProviderIds: () => [],
  formatProjectProviderDisabledState: (raw) => raw,
  buildCloudProviderPatch: unsupportedProviderConfiguration,
  buildCompatibleProviderPatch: unsupportedProviderConfiguration,
};
