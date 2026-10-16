import { CODEX_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  CodexHarnessClient,
  isCodexHarnessRpcClient,
} from "@/app/lib/codex-harness-client";
import type {
  ModelRuntimeAdapter,
  ModelRuntimeConnection,
} from "./provider-engine-adapter";

function connection(client: unknown): ModelRuntimeConnection {
  if (!isCodexHarnessRpcClient(client)) {
    throw new Error("Codex Harness provider client is unavailable");
  }
  return {
    listProviders() {
      return client.call("ipollowork/providerList", {});
    },
    async listAuthMethods() {
      return {};
    },
    async authorizeOAuth() {
      throw new Error("Configure provider accounts in the shared iPolloWork authorization center");
    },
    async completeOAuth() {
      throw new Error("Configure provider accounts in the shared iPolloWork authorization center");
    },
    async setApiKey() {
      throw new Error("Configure provider keys in the shared iPolloWork authorization center");
    },
    async removeCredentials() {
      // Codex Harness reads the shared account provider store directly and has
      // no engine-local credential cache to clear.
    },
    async readDisabledProviders() {
      return [];
    },
    async writeDisabledProviders(providerIds) {
      if (providerIds.length) throw new Error("Codex Harness does not own provider disable state");
    },
    async dispose() {},
    async waitUntilHealthy() {
      await client.call("ipollowork/providerList", {});
    },
  };
}

function unsupportedProviderConfiguration(): never {
  throw new Error("Codex Harness provider configuration is managed by the shared provider catalog");
}

export const codexHarnessProviderEngineAdapter: ModelRuntimeAdapter = {
  id: CODEX_HARNESS_ENGINE_ID,
  configFileName: "Codex Harness",
  capabilities: {
    cloudProviderImports: false,
    customProviders: false,
    disabledProviders: false,
    authChangesRequireReload: false,
  },
  createClient({ endpoint }) {
    return new CodexHarnessClient({
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
