import type {
  EnginePluginPromptSelection,
  PluginPromptCapabilitySummary,
} from "@ipollowork/types/plugins";

type RpcValue<T> = { value: T };

export type WorkspaceEngineEvent = {
  type: string;
  [key: string]: unknown;
};

export type WorkspaceEnginePromptResult = {
  ok: boolean;
  sessionId?: string;
  turnId?: string;
};

export class WorkspaceEngineRpcClient {
  readonly #name: string;
  readonly #baseUrl: string;
  readonly #headers: HeadersInit;

  constructor(input: {
    name: string;
    serverBaseUrl: string;
    workspaceId: string;
    engineId: string;
    token?: string;
  }) {
    this.#name = input.name;
    this.#baseUrl = `${input.serverBaseUrl.replace(/\/+$/, "")}/workspace/${encodeURIComponent(input.workspaceId)}/engine/${encodeURIComponent(input.engineId)}`;
    this.#headers = {
      "content-type": "application/json",
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    };
  }

  async call<T>(method: string, payload: unknown = {}): Promise<T> {
    const response = await fetch(`${this.#baseUrl}/rpc`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify({ method, payload }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await this.#responseError(response);
    return (await response.json() as RpcValue<T>).value;
  }

  async respond(rpcId: string | number, result: unknown): Promise<void> {
    const response = await fetch(`${this.#baseUrl}/respond`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify({ rpcId, result }),
    });
    if (!response.ok) throw await this.#responseError(response);
  }

  async pluginCapabilities(): Promise<PluginPromptCapabilitySummary[]> {
    const response = await fetch(`${this.#baseUrl}/plugin-capabilities`, { headers: this.#headers });
    if (!response.ok) throw await this.#responseError(response);
    const payload = await response.json() as { items?: PluginPromptCapabilitySummary[] };
    return Array.isArray(payload.items) ? payload.items : [];
  }

  async prompt(
    payload: Record<string, unknown>,
    plugins?: EnginePluginPromptSelection,
  ): Promise<WorkspaceEnginePromptResult> {
    const response = await fetch(`${this.#baseUrl}/prompt`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify({ payload, ...(plugins ? { plugins } : {}) }),
    });
    if (!response.ok) throw await this.#responseError(response);
    return await response.json() as WorkspaceEnginePromptResult;
  }

  async *events(path: string, signal: AbortSignal): AsyncGenerator<WorkspaceEngineEvent> {
    const suffix = path ? `/${path.replace(/^\/+/, "")}` : "";
    const response = await fetch(`${this.#baseUrl}/events${suffix}`, {
      headers: this.#headers,
      signal,
    });
    if (!response.ok || !response.body) throw await this.#responseError(response);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = chunk
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("");
          if (data) yield JSON.parse(data) as WorkspaceEngineEvent;
          boundary = buffer.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async #responseError(response: Response): Promise<Error> {
    try {
      const body = await response.json() as { message?: string; error?: { message?: string } };
      return new Error(body.message || body.error?.message || `${this.#name} request failed (${response.status})`);
    } catch {
      return new Error(`${this.#name} request failed (${response.status})`);
    }
  }
}
