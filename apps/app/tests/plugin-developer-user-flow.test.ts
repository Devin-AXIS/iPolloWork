import { describe, expect, test } from "bun:test";
import JSZip from "jszip";

import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";
import type { iPolloWorkExtensionManifest } from "../src/app/extensions";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";

const manifest = {
  schemaVersion: 2,
  id: "acme-research",
  name: "Acme Research",
  description: "Self-contained research plugin.",
  category: "Research",
  source: { format: "ipollowork-extension-manifest", origin: "den", trusted: false },
  package: {
    version: "1.2.3",
    publisher: { id: "acme", name: "Acme" },
    engines: ["opencode"],
    updateId: "acme/research",
  },
  engineBindings: [{ engine: "opencode", capabilities: [
    { id: "acme-runtime", kind: "plugin", label: "Acme runtime", path: "engines/opencode/plugins/acme-research.ts", required: true },
  ] }],
  permissions: [{ id: "network", reason: "Connect to Acme." }],
  authorization: {
    required: true,
    methods: [
      { id: "api-key", kind: "secret-form", label: "API key", fields: [{ id: "apiKey", label: "API key", secret: true, required: true }] },
      { id: "browser", kind: "hosted-browser", label: "Connect in browser", startUrl: "https://plugins.acme.example/connect", callbackOrigin: "https://plugins.acme.example", exchangeUrl: "https://plugins.acme.example/token" },
    ],
  },
  resources: [
    { type: "skill", id: "acme-search", label: "Acme Search", path: "skills/acme-search/SKILL.md", required: true },
  ],
};

describe("plugin developer and user flow", () => {
  test("asks before replacing an installed plugin with an older version", async () => {
    const source = await Bun.file(new URL("../src/react-app/domains/settings/plugin-package-import-modal.tsx", import.meta.url)).text();

    expect(source).toContain('preview?.versionChange === "downgrade"');
    expect(source).toContain("setDowngradeConfirmationOpen(true)");
    expect(source).toContain("void install(true)");
    expect(source).toContain("<ConfirmModal");
    expect(source).toContain('confirmLabel={t("plugin_platform.import_downgrade_confirm")}');
    expect(source).toContain('cancelLabel={t("plugin_platform.import_downgrade_cancel")}');
  });

  test("localizes plugin display metadata without changing runtime identity", async () => {
    const { localizePluginPackageManifest } = await import("../src/react-app/domains/settings/plugin-platform-state.js");
    const localizedManifest: iPolloWorkExtensionManifest = {
      schemaVersion: 2,
      id: "localized-plugin",
      name: "本地化插件",
      description: "中文描述",
      category: "开发者工具",
      source: { format: "ipollowork-extension-manifest", origin: "builtin", trusted: true },
      composer: { prompt: "使用插件" },
      setup: { instructions: "连接插件", primaryCta: "连接", secondaryCta: "帮助" },
      resources: [{ type: "skill", id: "localized-skill", label: "本地化技能", description: "技能描述", path: "skills/localized-skill/SKILL.md" }],
      permissions: [{ id: "network", reason: "访问网络" }],
      authorization: {
        required: true,
        methods: [{
          id: "api-key",
          kind: "secret-form",
          label: "连接插件",
          description: "填写密钥",
          fields: [{ id: "apiKey", label: "密钥", placeholder: "请输入密钥" }],
        }],
      },
      localization: {
        defaultLocale: "zh",
        translations: {
          en: {
            name: "Localized Plugin",
            description: "English description",
            category: "Developer Tools",
            composer: { prompt: "Use the plugin" },
            setup: { instructions: "Connect the plugin", primaryCta: "Connect", secondaryCta: "Help" },
            resources: { "localized-skill": { label: "Localized Skill", description: "Skill description" } },
            permissions: { network: { reason: "Access the network" } },
            authorizationMethods: {
              "api-key": {
                label: "Connect plugin",
                description: "Enter a key",
                fields: { apiKey: { label: "Key", placeholder: "Enter a key" } },
              },
            },
          },
          fr: {
            name: "Extension localisée",
            resources: { "localized-skill": { label: "Compétence localisée" } },
          },
        },
      },
    };

    expect(localizePluginPackageManifest(localizedManifest, "zh")).toBe(localizedManifest);
    const english = localizePluginPackageManifest(localizedManifest, "en");
    expect(english).toMatchObject({
      id: "localized-plugin",
      name: "Localized Plugin",
      description: "English description",
      category: "Developer Tools",
      composer: { prompt: "Use the plugin" },
      setup: { instructions: "Connect the plugin", primaryCta: "Connect", secondaryCta: "Help" },
      resources: [{ id: "localized-skill", label: "Localized Skill", description: "Skill description", path: "skills/localized-skill/SKILL.md" }],
      permissions: [{ id: "network", reason: "Access the network" }],
      authorization: { methods: [{ id: "api-key", label: "Connect plugin", fields: [{ id: "apiKey", label: "Key", placeholder: "Enter a key" }] }] },
    });
    expect(localizePluginPackageManifest(localizedManifest, "fr")).toMatchObject({
      name: "Extension localisée",
      description: "English description",
      setup: { instructions: "Connect the plugin" },
      resources: [{ label: "Compétence localisée", description: "Skill description" }],
      permissions: [{ reason: "Access the network" }],
      authorization: { methods: [{ fields: [{ label: "Key" }] }] },
    });

    const installedOlderManifest: iPolloWorkExtensionManifest = { ...localizedManifest, localization: undefined };
    const catalogBacked = localizePluginPackageManifest(installedOlderManifest, "en", localizedManifest.localization);
    expect(catalogBacked.description).toBe("English description");
    expect(catalogBacked.resources[0]?.path).toBe("skills/localized-skill/SKILL.md");
  });

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
      category: "Research",
      permissions: [{ id: "network", reason: "Connect to Acme." }],
      authorizationRequired: true,
    });
    expect(details.resources.map((resource) => ({ type: resource.type, label: resource.label }))).toEqual([
      { type: "skill", label: "Acme Search" },
      { type: "opencode/plugin", label: "Acme runtime" },
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

  test("derives package-owned, related, and installed MCP relationships without merging their lifecycles", async () => {
    const { collectPluginPackageRelationships } = await import("../src/react-app/domains/settings/plugin-platform-state.js");
    const installed = [{
      pluginId: "video-agent",
      manifest: {
        ...manifest,
        id: "video-agent",
        resources: [
          { type: "skill", id: "ipollowork-video-studio" },
          { type: "mcp", id: "video-mcp", mcpServerName: "video" },
        ],
        relatedSkills: ["hyperframes-cli", "media-use"],
      },
    }];
    const catalog = [{
      pluginId: "figma",
      manifest: {
        ...manifest,
        id: "figma",
        resources: [
          { type: "skill", id: "figma-use" },
          { type: "mcp", id: "figma-mcp", mcpServerName: "figma" },
        ],
      },
    }];

    expect(collectPluginPackageRelationships(installed, catalog)).toEqual({
      skillNames: ["figma-use", "hyperframes-cli", "ipollowork-video-studio", "media-use"],
      mcpServerNames: ["figma", "video"],
    });
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
      "plugin_platform.status.desktop_mcp_unavailable",
      "plugin_platform.official_bundle",
      "plugin_platform.bundle_contents",
      "plugin_platform.related_skills",
      "plugin_platform.related_skills_description",
      "plugin_platform.mcp_authorization_hint",
      "plugin_platform.connect_figma",
      "plugin_platform.connect_mcp",
      "plugin_platform.connecting",
      "plugin_platform.mcp_connected_detail",
      "plugin_platform.desktop_mcp_unavailable",
      "plugin_platform.info",
      "plugin_platform.author",
      "plugin_platform.category",
      "plugin_platform.version",
      "plugin_platform.capabilities",
      "plugin_platform.import_button",
      "plugin_platform.import_title",
      "plugin_platform.import_safety",
      "plugin_platform.import_error",
      "plugin_platform.import_invalid_extension",
      "plugin_platform.import_downgrade_title",
      "plugin_platform.import_downgrade_description",
      "plugin_platform.import_downgrade_confirm",
      "plugin_platform.import_downgrade_cancel",
      "mcp.quick_connect_figma_title",
      "mcp.quick_connect_figma_desc",
    ];

    for (const key of keys) {
      expect(Object.hasOwn(en, key)).toBe(true);
      expect(Object.hasOwn(zh, key)).toBe(true);
    }
  });

  test("reads a wrapped complete plugin archive into a bounded upload payload", async () => {
    const { readPluginPackageArchive } = await import("../src/app/lib/plugin-package-archive");
    const zip = new JSZip();
    zip.file("acme-research/ipollowork.plugin.json", JSON.stringify({ schemaVersion: 1 }));
    zip.file("acme-research/skills/acme-research/SKILL.md", "# Acme Research\n");
    zip.file("__MACOSX/acme-research/._SKILL.md", "ignored");
    const archive = await zip.generateAsync({ type: "uint8array" });

    const upload = await readPluginPackageArchive(
      new File([archive], "acme-research-source.zip", { type: "application/zip" }),
      "source",
    );

    expect(upload.archiveName).toBe("acme-research-source.zip");
    expect(upload.files.map((file) => file.path)).toEqual([
      "ipollowork.plugin.json",
      "skills/acme-research/SKILL.md",
    ]);
    expect(upload.files.every((file) => !file.path.startsWith("acme-research/"))).toBe(true);
  });

  test("separates install packages from Plugin Workshop source archives", async () => {
    const { readPluginPackageArchive } = await import("../src/app/lib/plugin-package-archive");
    const zip = new JSZip();
    zip.file("ipollowork.plugin.json", JSON.stringify({ schemaVersion: 2 }));
    const archive = await zip.generateAsync({ type: "uint8array" });

    await expect(readPluginPackageArchive(
      new File([archive], "acme-research.zip", { type: "application/zip" }),
      "install",
    )).rejects.toThrow(".ipollowork-plugin");
    await expect(readPluginPackageArchive(
      new File([archive], "acme-research.ipollowork-plugin", { type: "application/zip" }),
      "source",
    )).rejects.toThrow(".zip");
    await expect(readPluginPackageArchive(
      new File([archive], "acme-research.ipollowork-plugin", { type: "application/zip" }),
      "install",
    )).resolves.toMatchObject({ archiveName: "acme-research.ipollowork-plugin" });
  });

  test("routes migrated services through the existing MCP directory", async () => {
    const { FIGMA_MCP_QUICK_CONNECT, MCP_QUICK_CONNECT } = await import("../src/app/constants");
    const migrated = MCP_QUICK_CONNECT.filter((entry) => entry.pluginPackageId);

    expect(migrated.map((entry) => ({ id: entry.pluginPackageId, serverName: entry.serverName, oauth: entry.oauth }))).toEqual([
      { id: "figma", serverName: "figma", oauth: false },
      { id: "notion", serverName: "notion", oauth: true },
      { id: "linear", serverName: "linear", oauth: true },
      { id: "sentry", serverName: "sentry", oauth: true },
      { id: "stripe", serverName: "stripe", oauth: true },
      { id: "context7", serverName: "context7", oauth: false },
    ]);
    expect(FIGMA_MCP_QUICK_CONNECT).toMatchObject({
      serverName: "figma",
      type: "remote",
      url: "http://127.0.0.1:3845/mcp",
      oauth: false,
      pluginPackageId: "figma",
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
          return new Response(JSON.stringify({ items: [{ pluginId: "acme-research", name: "Acme Research", version: "1.0.0", enabled: true, disabledResourceIds: [], previousVersion: null, manifest }] }), {
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
      await client.setPluginPackageResourceEnabled("ws_1", "acme-research", "acme-skill", false);
      expect(calls.map((call) => call.url)).toEqual([
        "https://worker.example/workspace/ws_1/plugin-packages",
        "https://worker.example/workspace/ws_1/plugin-packages/acme-research/authorization/api-key/credentials",
        "https://worker.example/workspace/ws_1/plugin-packages/acme-research/resources/acme-skill",
      ]);
      expect(calls.some((call) => call.url.includes("environment") || call.url.includes("authorization-services"))).toBe(false);
      expect(calls[1]?.body).toContain("plugin-only-secret");
      expect(calls[2]).toMatchObject({ method: "PATCH", body: JSON.stringify({ enabled: false }) });
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
    const conflict = Object.assign(new Error("Install target already exists"), {
      code: "plugin_package_conflict",
      details: { paths: [".opencode/agents/design-parity-review-agent.md"] },
    });
    expect(formatPluginPlatformError(conflict, "插件操作失败。", "以下文件已存在且内容不同：")).toBe(
      "以下文件已存在且内容不同： .opencode/agents/design-parity-review-agent.md",
    );
    expect(formatPluginPlatformError("unknown", "The plugin operation failed.")).toBe("The plugin operation failed.");
  });
});
