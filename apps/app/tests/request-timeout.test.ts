import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createDenClient } from "../src/app/lib/den";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { createClient } from "../src/app/lib/opencode";
import { fetchWithTimeout } from "../src/app/lib/request-timeout";

const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const restorers: Array<() => void> = [];

afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function useFetch(fetchImpl: typeof fetch) {
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchImpl });
}

function recordTimeouts(expireImmediately = false) {
  const durations: Array<number | undefined> = [];
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((handler, ms, ...args) => {
    durations.push(ms);
    return originalTimeout(handler, expireImmediately ? 1 : ms, ...args);
  });
  restorers.push(() => timer.mockRestore());
  return durations;
}

const serverClient = () => createiPolloWorkServerClient({ baseUrl: "http://127.0.0.1:9876", token: "test-token" });
const denClient = () => createDenClient({ baseUrl: "https://den.test", token: "test-token" });

describe("shared request deadline", () => {
  test.each([0, -1, NaN, Infinity])("%p bypasses the deadline and preserves input and init", async (timeoutMs) => {
    const durations = recordTimeouts();
    const request = new Request("https://example.test", { method: "POST", body: "payload" });
    const init = { headers: { "X-Proof": "test" } };
    const response = new Response("ok");
    expect(await fetchWithTimeout(async (input, options) => {
      expect(input).toBe(request);
      expect(options).toBe(init);
      return response;
    }, request, init, timeoutMs)).toBe(response);
    expect(durations).toEqual([]);
  });

  test("success clears its timer and does not abort during later body reads", async () => {
    let signal: AbortSignal | null | undefined;
    const clear = spyOn(globalThis, "clearTimeout");
    restorers.push(() => clear.mockRestore());
    const response = await fetchWithTimeout(async (_, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream({ start(controller) {
        originalTimeout(() => { controller.enqueue(new TextEncoder().encode("late body")); controller.close(); }, 30);
      } }));
    }, new URL("https://example.test"), undefined, 5);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe("late body");
    expect(signal?.aborted).toBe(false);
  });

  test("sync and async failures keep their identity and clear timers", async () => {
    const error = new TypeError("network unavailable");
    const clear = spyOn(globalThis, "clearTimeout");
    restorers.push(() => clear.mockRestore());
    await expect(fetchWithTimeout(() => { throw error; }, "https://example.test", {}, 100)).rejects.toBe(error);
    await expect(fetchWithTimeout(async () => { throw error; }, "https://example.test", {}, 100)).rejects.toBe(error);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  test("deadline aborts cooperative fetch and still ends a transport that ignores signals", async () => {
    let signal: AbortSignal | null | undefined;
    await expect(fetchWithTimeout((_, init) => new Promise((_, reject) => {
      signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }), "https://example.test", {}, 5)).rejects.toMatchObject({ name: "AbortError" });
    expect(signal?.aborted).toBe(true);
    await expect(fetchWithTimeout(() => new Promise(() => {}), "https://example.test", {}, 5, "Deadline reached")).rejects.toThrow("Deadline reached");
  });

  test("an existing init signal is preserved and the deadline does not abort the caller's controller", async () => {
    const controller = new AbortController();
    const init = { signal: controller.signal };
    await expect(fetchWithTimeout((_, receivedInit) => {
      expect(receivedInit).toBe(init);
      return new Promise(() => {});
    }, "https://example.test", init, 5)).rejects.toThrow("Request timed out.");
    expect(controller.signal.aborted).toBe(false);
  });

  test("works without AbortController when an IPC-style transport only returns a promise", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "AbortController");
    Object.defineProperty(globalThis, "AbortController", { configurable: true, value: undefined });
    try {
      await expect(fetchWithTimeout(() => new Promise(() => {}), "https://example.test", {}, 5)).rejects.toThrow("Request timed out.");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "AbortController", descriptor);
    }
  });

  test("real loopback HTTP works through both clients and enforces a stalled response deadline", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/slow") {
          return new Promise<Response>((resolve) => originalTimeout(() => resolve(new Response("late")), 100));
        }
        expect(request.headers.get("authorization")).toBe("Bearer test-token");
        return Response.json({ ok: true, healthy: true });
      },
    });
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      expect(await createiPolloWorkServerClient({ baseUrl, token: "test-token" }).health()).toMatchObject({ ok: true });
      const result = await createClient(baseUrl, undefined, { mode: "ipollowork", token: "test-token" }).global.health();
      expect(result.data).toMatchObject({ healthy: true });
      await expect(fetchWithTimeout(originalFetch, `${baseUrl}/slow`, {}, 10)).rejects.toBeInstanceOf(Error);
    } finally {
      await server.stop(true);
    }
  });
});

describe("client timeout policies", () => {
  test("Den keeps credentials, organization scope and its 12 second deadline", async () => {
    const durations = recordTimeouts();
    useFetch(async (input, init) => {
      expect(String(input)).toContain("/api/den/v1/memory");
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
      expect(Object.values(init?.headers ?? {})).toContain("org-proof");
      return Response.json({ memories: [] });
    });
    expect(await denClient().listMemory("org-proof")).toEqual([]);
    expect(durations).toEqual([12_000]);
  });

  test("Server keeps health, image and video deadlines", async () => {
    const durations = recordTimeouts();
    useFetch(async () => Response.json({ ok: true }));
    const client = serverClient();
    await client.health();
    await client.callExtensionAction({ extensionId: "image-studio", action: "generate-image", args: {} });
    await client.callExtensionAction({ extensionId: "video-console", action: "submit", args: {} });
    expect(durations).toEqual([3_000, 420_000, 180_000]);
  });

  test("Server forwards multipart and binary files without JSON conversion", async () => {
    const durations = recordTimeouts();
    const file = new File([new Uint8Array([0, 255, 13, 10])], "proof.zip");
    const bodies: unknown[] = [];
    useFetch(async (_, init) => {
      bodies.push(init?.body);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
      return Response.json({ ok: true, item: {} });
    });
    await serverClient().uploadInbox("ws-proof", file);
    await serverClient().importTemplate("ws-proof", file);
    expect(bodies[0]).toBeInstanceOf(FormData);
    if (!(bodies[0] instanceof FormData)) throw new Error("Expected a multipart upload");
    const uploadedFile = bodies[0].get("file");
    if (!(uploadedFile instanceof File)) throw new Error("Expected a file in the form");
    expect(await uploadedFile.arrayBuffer()).toEqual(await file.arrayBuffer());
    expect(bodies[1]).toBe(file);
    expect(durations).toEqual([60_000, 30_000]);
  });

  test("Server preserves structured HTTP errors", async () => {
    useFetch(async () => Response.json({ code: "no_access", message: "Access denied", details: { role: "guest" } }, { status: 403 }));
    await expect(serverClient().health()).rejects.toMatchObject({ status: 403, code: "no_access", message: "Access denied", details: { role: "guest" } });
  });

  test("Den and Server retain their English and Chinese timeout messages even when fetch ignores abort", async () => {
    recordTimeouts(true);
    useFetch(() => new Promise(() => {}));
    await expect(denClient().listMemory("org-proof")).rejects.toThrow("Request timed out.");
    await expect(serverClient().health()).rejects.toThrow("请求超时，请稍后重试。");
  });

  test("each adapter preserves its handling of cooperative abort and network failure", async () => {
    const abort = new DOMException("Caller aborted", "AbortError");
    useFetch(async () => { throw abort; });
    await expect(denClient().listMemory("org-proof")).rejects.toBe(abort);
    await expect(serverClient().health()).rejects.toThrow("请求超时，请稍后重试。");
    await expect(createClient("http://127.0.0.1:9876").global.health({ throwOnError: true })).rejects.toThrow("Request timed out.");
    const error = new Error("unclassified-network-error");
    useFetch(async () => { throw error; });
    await expect(denClient().listMemory("org-proof")).rejects.toBe(error);
    await expect(createClient("http://127.0.0.1:9876").global.health({ throwOnError: true })).rejects.toBe(error);
  });

  test("OpenCode keeps auth, normal deadlines and long-session exemptions", async () => {
    const durations = recordTimeouts();
    const urls: string[] = [];
    useFetch(async (input) => {
      if (!(input instanceof Request)) throw new Error("SDK should supply a Request");
      expect(input.headers.get("authorization")).toBe("Bearer test-token");
      urls.push(input.url);
      return Response.json({});
    });
    const client = createClient("http://127.0.0.1:9876", undefined, { mode: "ipollowork", token: "test-token" });
    await client.global.health();
    await client.session.command({ sessionID: "ses-proof", command: "review", arguments: "" });
    await client.session.promptAsync({ sessionID: "ses-proof", parts: [] });
    await client.session.summarize({ sessionID: "ses-proof", providerID: "test", modelID: "test" });
    expect(urls.map((url) => new URL(url).pathname)).toEqual(["/global/health", "/session/ses-proof/command", "/session/ses-proof/prompt_async", "/session/ses-proof/summarize"]);
    expect(durations).toEqual([10_000]);
  });

  test("real SDK provider OAuth and MCP callback URLs receive their long deadlines", async () => {
    const durations = recordTimeouts();
    useFetch(async () => Response.json({}));
    const client = createClient("http://127.0.0.1:9876");
    await client.provider.oauth.authorize({ providerID: "test", method: 0 });
    await client.provider.oauth.callback({ providerID: "test", method: 0, code: "test" });
    await client.mcp.auth.start({ name: "test" });
    await client.mcp.auth.callback({ name: "test", code: "test" });
    expect(durations).toEqual([300_000, 300_000, 90_000, 300_000]);
  });

  test("desktop SSE uses native fetch and retains caller cancellation", async () => {
    const durations = recordTimeouts();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const nativeFetch: typeof fetch = async (input, init) => {
      receivedSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return Response.json({ healthy: true });
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { __IPOLLOWORK_ELECTRON__: {}, fetch: nativeFetch } });
    useFetch(async () => { throw new Error("Streaming must use window.fetch"); });
    const client = createClient("https://remote.test", undefined, { mode: "ipollowork", token: "test-token" });
    // Accept is enough to select SSE transport, independently of the route name.
    await client.global.health({ headers: { ACCEPT: "text/event-stream" }, signal: controller.signal });
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
    controller.abort();
    expect(receivedSignal?.aborted).toBe(true);
    expect(durations).toEqual([]);
  });
});
