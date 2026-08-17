type RpcValue<T> = { value: T };

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
  readonly #baseUrl: string;
  readonly #headers: HeadersInit;

  constructor(input: { serverBaseUrl: string; workspaceId: string; token?: string }) {
    const serverBaseUrl = input.serverBaseUrl.replace(/\/+$/, "");
    this.#baseUrl = `${serverBaseUrl}/workspace/${encodeURIComponent(input.workspaceId)}/engine/deepseek-harness`;
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
    });
    if (!response.ok) throw await responseError(response);
    return (await response.json() as RpcValue<T>).value;
  }

  async respond(rpcId: string, result: unknown): Promise<void> {
    const response = await fetch(`${this.#baseUrl}/respond`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify({ rpcId, result }),
    });
    if (!response.ok) throw await responseError(response);
  }

  async *events(stream: "mux" | "host", signal: AbortSignal): AsyncGenerator<DeepSeekHarnessServerRequest> {
    const response = await fetch(`${this.#baseUrl}/events/${stream}`, {
      headers: this.#headers,
      signal,
    });
    if (!response.ok || !response.body) throw await responseError(response);
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
          if (data) {
            const parsed = JSON.parse(data) as DeepSeekHarnessServerRequest;
            if (parsed?.type === "server-request" && typeof parsed.rpcId === "string") yield parsed;
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export function isDeepSeekHarnessRpcClient(value: unknown): value is DeepSeekHarnessRpcClient {
  return typeof value === "object"
    && value !== null
    && "call" in value
    && typeof value.call === "function";
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as { message?: string; error?: { message?: string } };
    return new Error(body.message || body.error?.message || `DeepSeek Harness request failed (${response.status})`);
  } catch {
    return new Error(`DeepSeek Harness request failed (${response.status})`);
  }
}
