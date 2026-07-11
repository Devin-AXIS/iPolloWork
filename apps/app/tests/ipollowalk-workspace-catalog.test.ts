import { afterEach, describe, expect, test } from "bun:test";

import { createiPolloWalkServerClient } from "../src/app/lib/ipollowalk-server";

const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
});

describe("iPolloWalk workspace file catalog", () => {
  test("lists every catalog page and closes its read-only file session", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method, body });

      if (url.endsWith("/workspace/ws_1/files/sessions")) {
        return Response.json({ session: { id: "files_1" } });
      }
      if (url.includes("catalog/snapshot") && url.includes("after=pages%2Findex.html")) {
        return Response.json({
          items: [{ path: "readme.md", kind: "file", size: 2, mtimeMs: 3, revision: "3:2" }],
          truncated: false,
        });
      }
      if (url.includes("catalog/snapshot")) {
        return Response.json({
          items: [{ path: "pages/index.html", kind: "file", size: 1, mtimeMs: 2, revision: "2:1" }],
          truncated: true,
          nextAfter: "pages/index.html",
        });
      }
      if (url.endsWith("/files/sessions/files_1") && method === "DELETE") {
        return Response.json({ ok: true });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    };
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });

    const client = createiPolloWalkServerClient({ baseUrl: "https://ipollowalk.test", token: "token" });
    const items = await client.listWorkspaceFiles("ws_1");

    expect(items.map((item) => item.path)).toEqual(["pages/index.html", "readme.md"]);
    expect(calls[0]).toMatchObject({ method: "POST", body: JSON.stringify({ write: false }) });
    expect(calls.filter((call) => call.url.includes("catalog/snapshot"))).toHaveLength(2);
    expect(calls.at(-1)?.method).toBe("DELETE");
  });
});
