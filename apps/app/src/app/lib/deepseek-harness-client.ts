import type {
  EnginePluginPromptSelection,
  PluginPromptCapabilitySummary,
} from "@ipollowork/types/plugins";
import { WorkspaceEngineRpcClient } from "./workspace-engine-rpc-client";

export { deepSeekHarnessAccountProviderId } from "@ipollowork/types/workspace";

export type DeepSeekHarnessServerRequest = {
  type: "server-request";
  rpcId: string;
  method?: string;
  payload: Record<string, unknown>;
};

export type DeepSeekHarnessRpcClient = {
  call<T>(method: string, payload?: unknown): Promise<T>;
};

export class DeepSeekHarnessClient implements DeepSeekHarnessRpcClient {
  readonly #client: WorkspaceEngineRpcClient;

  constructor(input: { serverBaseUrl: string; workspaceId: string; token?: string }) {
    this.#client = new WorkspaceEngineRpcClient({
      ...input,
      name: "DeepSeek Harness",
      engineId: "deepseek-harness",
    });
  }

  async call<T>(method: string, payload: unknown = {}): Promise<T> {
    return this.#client.call(method, payload);
  }

  async respond(rpcId: string, result: unknown): Promise<void> {
    await this.#client.respond(rpcId, result);
  }

  async pluginCapabilities(): Promise<PluginPromptCapabilitySummary[]> {
    return this.#client.pluginCapabilities();
  }

  async prompt(payload: Record<string, unknown>, plugins?: EnginePluginPromptSelection): Promise<void> {
    await this.#client.prompt(payload, plugins);
  }

  async *events(stream: "mux" | "host", signal: AbortSignal): AsyncGenerator<DeepSeekHarnessServerRequest> {
    for await (const parsed of this.#client.events(stream, signal)) {
      if (parsed?.type === "server-request" && typeof parsed.rpcId === "string") {
        yield parsed as DeepSeekHarnessServerRequest;
      }
    }
  }
}

export function isDeepSeekHarnessRpcClient(value: unknown): value is DeepSeekHarnessRpcClient {
  return typeof value === "object"
    && value !== null
    && "call" in value
    && typeof value.call === "function";
}
