import { describe, expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "./serve-node.js";

describe("serve", () => {
  test("does not write an error response after a streaming response has ended", async () => {
    const uncaught: unknown[] = [];
    const onUncaughtException = (error: unknown) => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaughtException);

    const encoder = new TextEncoder();
    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname === "/health") {
          return Response.json({ ok: true });
        }

        let wroteChunk = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!wroteChunk) {
                wroteChunk = true;
                controller.enqueue(encoder.encode("partial"));
                return;
              }
              controller.error(new Error("stream failed after response started"));
            },
          }),
        );
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/stream`);
      await response.text().catch(() => undefined);
      await delay(25);

      expect(uncaught).toEqual([]);

      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      process.off("uncaughtException", onUncaughtException);
      await server.stop();
    }
  });

  test("awaits shutdown before resolving stop", async () => {
    const first = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true }),
    });
    const port = first.port;

    await first.stop();

    const second = await serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => Response.json({ ok: true }),
    });
    expect(second.port).toBe(port);
    await second.stop();
  });

  test("reuses the in-flight shutdown for repeated stop calls", async () => {
    const first = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true }),
    });
    const port = first.port;

    await Promise.all([first.stop(), first.stop()]);

    const second = await serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => Response.json({ ok: true }),
    });
    expect(second.port).toBe(port);
    await second.stop();
  });

  test("does not log expected connection aborts as unhandled errors", async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname === "/health") {
          return Response.json({ ok: true });
        }
        throw new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } });
      },
    });

    try {
      await fetch(`http://127.0.0.1:${server.port}/abort`).catch(() => undefined);
      await delay(25);
      expect(errors).toEqual([]);

      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      console.error = originalError;
      await server.stop();
    }
  });

  // A long-lived response has no other way to learn its reader is gone. Without these two
  // signals an SSE producer keeps streaming into a dead socket for the life of the process,
  // holding its upstream engine subscription open with it.
  test("aborts request.signal when the client hangs up mid-stream", async () => {
    const encoder = new TextEncoder();
    let aborted = false;
    let sawRequest = (): void => {};
    const requestSeen = new Promise<void>((resolve) => {
      sawRequest = resolve;
    });

    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("open\n"));
              sawRequest();
              request.signal.addEventListener("abort", () => {
                aborted = true;
                try {
                  controller.close();
                } catch {
                  // Already closed by the transport.
                }
              }, { once: true });
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });

    try {
      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${server.port}/stream`, { signal: controller.signal });
      await response.body!.getReader().read();
      await requestSeen;

      controller.abort();
      for (let attempt = 0; attempt < 50 && !aborted; attempt += 1) await delay(10);

      expect(aborted).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("cancels the response stream when the client hangs up mid-stream", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    let sawRequest = (): void => {};
    const requestSeen = new Promise<void>((resolve) => {
      sawRequest = resolve;
    });

    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("open\n"));
              sawRequest();
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });

    try {
      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${server.port}/stream`, { signal: controller.signal });
      await response.body!.getReader().read();
      await requestSeen;

      controller.abort();
      for (let attempt = 0; attempt < 50 && !cancelled; attempt += 1) await delay(10);

      expect(cancelled).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("a normal response still completes and does not report a disconnect", async () => {
    let aborted = false;
    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
        }, { once: true });
        return Response.json({ ok: true });
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(await response.json()).toEqual({ ok: true });
      await delay(50);
      expect(aborted).toBe(false);
    } finally {
      await server.stop();
    }
  });
});
