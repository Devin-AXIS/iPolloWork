import { afterEach, describe, expect, test } from "bun:test";

import { createDenClient, DEFAULT_DEN_BASE_URL } from "../src/app/lib/den";

const originalFetch = globalThis.fetch;
const manifest = {
  schemaVersion: 2 as const,
  id: "plugin_test",
  name: "Image Tools",
  description: "Adds image capabilities.",
  source: { format: "ipollowork-extension-manifest" as const, origin: "den" as const, trusted: true },
  resources: [{ type: "skill" as const, id: "image_skill", label: "Image Skill", required: true }],
  package: { version: "1.0.0", updateId: "plugin_test", publisher: { id: "ipollowork", name: "iPolloWork" } },
};

describe("iPolloWork Cloud plugin-package source", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  });

  test("uses the hosted marketplace service by default", () => {
    expect(DEFAULT_DEN_BASE_URL).toBe("http://i.ipollo.ai");
  });

  test("lists, acquires, and downloads complete V2 packages", async () => {
    const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
    const artifact = new Uint8Array([1, 2, 3]);
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("Authorization") });
      if (url.endsWith("/acquire")) {
        return Response.json({ acquired: true, spentPoints: 20, balance: 80 });
      }
      if (url.endsWith("/download")) {
        return new Response(artifact, { headers: {
          "Content-Disposition": "attachment; filename=\"plugin-test-1.0.0.ipollowork-plugin\"",
          "X-iPollo-Artifact-SHA256": "abc123",
        } });
      }
      return Response.json({ items: [{
        pluginId: "plugin_test",
        name: manifest.name,
        description: manifest.description,
        category: "design",
        publisher: "iPolloWork",
        icon: null,
        version: "1.0.0",
        manifest,
        pointsCost: 20,
        acquired: false,
        featured: true,
        digest: "abc123",
        size: artifact.byteLength,
        updatedAt: "2026-08-15T00:00:00.000Z",
      }] });
    };
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });

    const client = createDenClient({ baseUrl: "https://cloud.example", token: "token" });
    const items = await client.listMarketplacePlugins();
    const acquired = await client.acquireMarketplacePlugin("plugin_test");
    const download = await client.downloadMarketplacePlugin("plugin_test");

    expect(items[0]?.manifest.schemaVersion).toBe(2);
    expect(items[0]?.manifest.resources).toHaveLength(1);
    expect(acquired).toEqual({ acquired: true, spentPoints: 20, balance: 80 });
    expect([...download.bytes]).toEqual([...artifact]);
    expect(download.fileName).toBe("plugin-test-1.0.0.ipollowork-plugin");
    expect(calls).toEqual([
      { url: "https://cloud.example/api/v1/marketplace/plugins", method: "GET", authorization: "Bearer token" },
      { url: "https://cloud.example/api/v1/marketplace/plugins/plugin_test/acquire", method: "POST", authorization: "Bearer token" },
      { url: "https://cloud.example/api/v1/marketplace/plugins/plugin_test/download", method: "GET", authorization: "Bearer token" },
    ]);
  });

  test("rejects non-V2 marketplace manifests", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => Response.json({ items: [{ pluginId: "broken", manifest: { schemaVersion: 1 } }] }),
    });
    const client = createDenClient({ baseUrl: "https://cloud.example", token: "token" });
    await expect(client.listMarketplacePlugins()).rejects.toMatchObject({ code: "invalid_marketplace_payload" });
  });
});
