import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  isDeepSeekHarnessRpcClient,
} from "@/app/lib/deepseek-harness-client";
import type { ProviderListItem } from "@/app/types";
import type {
  ProviderEngineAdapter,
  ProviderEngineConnection,
} from "./provider-engine-adapter";

type DeepSeekHarnessModelList = {
  groups: Array<{
    id: string;
    name: string;
    models: Array<{
      id: string;
      name: string;
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

const PROVIDER_CREDENTIALS: Record<string, string> = {
  "deepseek-official": "DEEPSEEK_API_KEY",
};

function credentialRef(providerId: string) {
  return PROVIDER_CREDENTIALS[providerId] ?? null;
}

function connection(client: unknown): ProviderEngineConnection {
  if (!isDeepSeekHarnessRpcClient(client)) {
    throw new Error("DeepSeek Harness provider client is unavailable");
  }

  const listModels = () => client.call<DeepSeekHarnessModelList>("llm.models", {});
  const describeCredentials = (refs: string[]): Promise<DeepSeekHarnessCredentialDescription> => refs.length
    ? client.call<DeepSeekHarnessCredentialDescription>("credentials.describe", { refs })
    : Promise.resolve({ credentials: {} });

  return {
    async listProviders() {
      const models = await listModels();
      const refs = [...new Set(models.groups.flatMap((group) => credentialRef(group.id) ?? []))];
      const credentialState = await describeCredentials(refs);
      const all: ProviderListItem[] = models.groups.map((group) => {
        const ref = credentialRef(group.id);
        return {
          id: group.id,
          name: group.name,
          source: "config",
          env: ref ? [ref] : [],
          models: Object.fromEntries(group.models.map((model) => {
            const efforts = model.reasoning?.efforts ?? [];
            return [model.id, {
              id: model.id,
              name: model.name,
              capabilities: {
                attachment: false,
                reasoning: efforts.length > 0,
                input: { image: false },
              },
              ...(efforts.length
                ? { variants: Object.fromEntries(efforts.map((effort) => [effort.id, { name: effort.name ?? effort.id }])) }
                : {}),
            }];
          })),
        };
      });
      return {
        all,
        connected: all.flatMap((provider) => {
          const ref = credentialRef(provider.id);
          return !ref || credentialState.credentials[ref]?.configured ? [provider.id] : [];
        }),
        default: Object.fromEntries(
          models.groups.flatMap((group) => group.models[0] ? [[group.id, group.models[0].id]] : []),
        ),
      };
    },
    async listAuthMethods() {
      const models = await listModels();
      return Object.fromEntries(
        models.groups.flatMap((group) => credentialRef(group.id)
          ? [[group.id, [{ type: "api" as const, label: "API key" }]]]
          : []),
      );
    },
    async authorizeOAuth() {
      throw new Error("DeepSeek Harness does not expose OAuth for this provider");
    },
    async completeOAuth() {
      throw new Error("DeepSeek Harness does not expose OAuth for this provider");
    },
    async setApiKey(providerId, apiKey) {
      const ref = credentialRef(providerId);
      if (!ref) throw new Error(`DeepSeek Harness provider credentials are unavailable: ${providerId}`);
      await client.call("credentials.set", { ref, value: apiKey });
    },
    async removeCredentials(providerId) {
      const ref = credentialRef(providerId);
      if (!ref) throw new Error(`DeepSeek Harness provider credentials are unavailable: ${providerId}`);
      await client.call("credentials.unset", { ref });
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

export const deepSeekHarnessProviderEngineAdapter: ProviderEngineAdapter = {
  id: DEEPSEEK_HARNESS_ENGINE_ID,
  configFileName: "DeepSeek Harness",
  capabilities: {
    cloudProviderImports: false,
    customProviders: false,
    disabledProviders: false,
    authChangesRequireReload: false,
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
  formatProjectWithoutProvider: (raw) => raw,
  buildCloudProviderPatch: unsupportedProviderConfiguration,
  buildCompatibleProviderPatch: unsupportedProviderConfiguration,
};
