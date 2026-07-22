import { describe, expect, test } from "bun:test";

import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";

const manifest = {
  schemaVersion: 1,
  id: "acme-research",
  name: "Acme Research",
  description: "Self-contained research plugin.",
  source: { format: "ipollowork-extension-manifest", origin: "den", trusted: false },
  package: {
    version: "1.2.3",
    publisher: { id: "acme", name: "Acme" },
    updateId: "acme/research",
    entrypoints: { opencode: ".opencode/plugins/acme-research.ts" },
  },
  permissions: [{ id: "network", reason: "Connect to Acme." }],
  authorization: {
    required: true,
    methods: [
      { id: "api-key", kind: "secret-form", label: "API key", fields: [{ id: "apiKey", label: "API key", secret: true, required: true }] },
      { id: "browser", kind: "hosted-browser", label: "Connect in browser", startUrl: "https://plugins.acme.example/connect", callbackOrigin: "https://plugins.acme.example", exchangeUrl: "https://plugins.acme.example/token" },
    ],
  },
  resources: [
    { type: "opencode-plugin", id: "acme-runtime", label: "Acme runtime", path: ".opencode/plugins/acme-research.ts", required: true },
    { type: "skill", id: "acme-search", label: "Acme Search", path: ".opencode/skills/acme-search/SKILL.md", required: true },
  ],
};

describe("plugin developer and user flow", () => {
  test("derives exactly one simple primary action from package state", async () => {
    const { derivePluginPrimaryAction } = await import("../src/react-app/domains/settings/plugin-platform-state.js");

    expect(derivePluginPrimaryAction({ installed: false, authorizationRequired: true, connected: false, updateAvailable: false, broken: false }).kind).toBe("install");
    expect(derivePluginPrimaryAction({ installed: true, authorizationRequired: true, connected: false, updateAvailable: false, broken: false }).kind).toBe("connect");
    expect(derivePluginPrimaryAction({ installed: true, authorizationRequired: true, connected: true, updateAvailable: true, broken: false }).kind).toBe("update");
    expect(derivePluginPrimaryAction({ installed: true, authorizationRequired: true, connected: true, updateAvailable: false, broken: false }).kind).toBe("open");
    expect(derivePluginPrimaryAction({ installed: true, authorizationRequired: false, connected: false, updateAvailable: false, broken: true }).kind).toBe("repair");
  });

  test("projects developer metadata into safe user-facing details", async () => {
    const { projectPluginPackageDetails } = await import("../src/react-app/domains/settings/plugin-platform-state.js");

    const details = projectPluginPackageDetails(manifest);

    expect(details).toMatchObject({
      version: "1.2.3",
      publisher: "Acme",
      permissions: [{ id: "network", reason: "Connect to Acme." }],
      authorizationRequired: true,
    });
    expect(details.resources.map((resource) => ({ type: resource.type, label: resource.label }))).toEqual([
      { type: "opencode-plugin", label: "Acme runtime" },
      { type: "skill", label: "Acme Search" },
    ]);
    expect(details.authorizationMethods.map((method) => ({ id: method.id, kind: method.kind, label: method.label }))).toEqual([
      { id: "api-key", kind: "secret-form", label: "API key" },
      { id: "browser", kind: "hosted-browser", label: "Connect in browser" },
    ]);
    expect(projectPluginPackageDetails({
      ...manifest,
      authorization: { ...manifest.authorization, required: false },
      resources: [{ ...manifest.resources[1], requires: ["authorization:api-key"] }],
    }).authorizationRequired).toBe(true);
    expect(JSON.stringify(details)).not.toContain("apiKey\":");
  });

  test("ships the primary plugin-platform states in English and Chinese", () => {
    const keys = [
      "plugin_platform.action.install",
      "plugin_platform.action.connect",
      "plugin_platform.action.open",
      "plugin_platform.action.update",
      "plugin_platform.action.repair",
      "plugin_platform.status.pending",
      "plugin_platform.status.connected",
      "plugin_platform.status.expired",
      "plugin_platform.status.failed",
      "plugin_platform.status.revoked",
      "plugin_platform.status.installed",
      "plugin_platform.official_bundle",
      "plugin_platform.bundle_contents",
      "plugin_platform.mcp_authorization_hint",
      "plugin_platform.connect_figma",
      "mcp.quick_connect_figma_title",
      "mcp.quick_connect_figma_desc",
    ];

    for (const key of keys) {
      expect(Object.hasOwn(en, key)).toBe(true);
      expect(Object.hasOwn(zh, key)).toBe(true);
    }
  });

  test("ships a one-click Figma OAuth connection matching the bundled package", async () => {
    const { FIGMA_MCP_QUICK_CONNECT } = await import("../src/app/constants");

    expect(FIGMA_MCP_QUICK_CONNECT).toMatchObject({
      serverName: "figma",
      url: "https://mcp.figma.com/mcp",
      type: "remote",
      oauth: true,
      iconSlug: "figma",
    });
  });

  test("uses the independent package and authorization API without environment routes", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string }> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" });
        if (url.endsWith("/plugin-packages")) {
          return new Response(JSON.stringify({ items: [{ pluginId: "acme-research", name: "Acme Research", version: "1.0.0", enabled: true, previousVersion: null, manifest }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: { accountId: "default", methodId: "api-key", status: "connected", fields: { apiKey: true }, updatedAt: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const client = createiPolloWorkServerClient({ baseUrl: "https://worker.example", token: "client-token" });
      expect((await client.listPluginPackages("ws_1")).items[0]?.pluginId).toBe("acme-research");
      const saved = await client.savePluginAuthorization("ws_1", "acme-research", "api-key", { apiKey: "plugin-only-secret" });
      expect(saved.status.fields).toEqual({ apiKey: true });
      expect(calls.map((call) => call.url)).toEqual([
        "https://worker.example/workspace/ws_1/plugin-packages",
        "https://worker.example/workspace/ws_1/plugin-packages/acme-research/authorization/api-key/credentials",
      ]);
      expect(calls.some((call) => call.url.includes("environment") || call.url.includes("authorization-services"))).toBe(false);
      expect(calls[1]?.body).toContain("plugin-only-secret");
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    }
  });

  test("captures authorization input before React releases the change event", async () => {
    const { enqueuePluginFieldValue } = await import("../src/react-app/domains/settings/plugin-platform-state");
    let queued: ((current: Record<string, string>) => Record<string, string>) | null = null;

    enqueuePluginFieldValue((update) => { queued = update; }, "acme\u0000api-key\u0000apiKey", "e2e-secret");

    expect(queued).not.toBeNull();
    expect(queued?.({ untouched: "keep" })).toEqual({ untouched: "keep", "acme\u0000api-key\u0000apiKey": "e2e-secret" });
  });

  test("keeps operation errors localized while preserving developer diagnostics", async () => {
    const { formatPluginPlatformError } = await import("../src/react-app/domains/settings/plugin-platform-state");

    expect(formatPluginPlatformError(new Error("authorization.methods.0: unsupported kind"), "插件操作失败。")).toBe(
      "插件操作失败。 authorization.methods.0: unsupported kind",
    );
    expect(formatPluginPlatformError("unknown", "The plugin operation failed.")).toBe("The plugin operation failed.");
  });
});
