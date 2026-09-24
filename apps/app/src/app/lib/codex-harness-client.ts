import { CODEX_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  WorkspaceEngineRpcClient,
  type WorkspaceEngineEvent,
} from "./workspace-engine-rpc-client";

export type CodexHarnessRpcClient = {
  call<T>(method: string, payload?: unknown): Promise<T>;
};

export class CodexHarnessClient implements CodexHarnessRpcClient {
  readonly #client: WorkspaceEngineRpcClient;

  constructor(input: { serverBaseUrl: string; workspaceId: string; token?: string }) {
    this.#client = new WorkspaceEngineRpcClient({
      ...input,
      name: "Codex Harness",
      engineId: CODEX_HARNESS_ENGINE_ID,
    });
  }

  call<T>(method: string, payload: unknown = {}): Promise<T> {
    return this.#client.call(method, payload);
  }

  respond(rpcId: string | number, result: unknown): Promise<void> {
    return this.#client.respond(rpcId, result);
  }

  pluginCapabilities() {
    return this.#client.pluginCapabilities();
  }

  prompt(payload: Record<string, unknown>, plugins?: Parameters<WorkspaceEngineRpcClient["prompt"]>[1]) {
    return this.#client.prompt(payload, plugins);
  }

  events(signal: AbortSignal): AsyncGenerator<WorkspaceEngineEvent> {
    return this.#client.events("", signal);
  }
}

export function isCodexHarnessRpcClient(value: unknown): value is CodexHarnessRpcClient {
  return typeof value === "object"
    && value !== null
    && "call" in value
    && typeof value.call === "function";
}
