import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deepSeekHarnessPluginEngineAdapter,
  openCodePluginEngineAdapter,
  pluginEngineAdapters,
  pluginEngineCompatibility,
  PluginEngineAdapterRegistry,
  type PluginEngineAdapter,
} from "./plugin-engine-adapter.js";
import { bundledPluginPackageIds } from "./plugin-package-catalog.js";
import { disposeiPolloWorkWorkspaceConfigStore } from "./ipollowork-workspace-config-store.js";
import {
  disposeRuntimeOpencodeConfigStore,
  readRuntimeOpencodeConfig,
} from "./runtime-opencode-config-store.js";
import { pluginServiceDataDirectory } from "./plugin-service-runtime.js";
import { startServer } from "./server.js";
import { disposeTemplateStore } from "./templates.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_plugin_package";
const ENGINE_ID = "opencode";
const roots: string[] = [];
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local", engineId: ENGINE_ID }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

async function createRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function writePackage(packageRoot: string, version: string, runtimeText: string, skillText: string, options: { mcp?: boolean } = {}) {
  const pluginPath = "engines/opencode/plugins/acme-research.ts";
  const skillPath = "skills/acme-research/SKILL.md";
  const mcpPath = "mcp/acme-research.json";
  await mkdir(join(packageRoot, dirname(pluginPath)), { recursive: true });
  await mkdir(join(packageRoot, dirname(skillPath)), { recursive: true });
  await writeFile(join(packageRoot, pluginPath), runtimeText, "utf8");
  await writeFile(join(packageRoot, skillPath), skillText, "utf8");
  if (options.mcp) {
    await mkdir(join(packageRoot, dirname(mcpPath)), { recursive: true });
    await writeFile(join(packageRoot, mcpPath), JSON.stringify({ type: "remote", url: "https://mcp.acme.example/mcp" }), "utf8");
  }
  const resources: Array<Record<string, unknown>> = [
    { type: "skill", id: "acme-skill", path: skillPath, required: true },
  ];
  if (options.mcp) resources.push({ type: "mcp", id: "acme-mcp", mcpServerName: "acme-research", path: mcpPath, required: true });
  await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({
    schemaVersion: 2,
    id: "acme-research",
    name: "Acme Research",
    description: "Self-contained research plugin.",
    source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: {
      version,
      engines: ["opencode"],
      updateId: "acme/research",
    },
    engineBindings: [{
      engine: "opencode",
      capabilities: [{ id: "acme-runtime", kind: "plugin", path: pluginPath, required: true }],
    }],
    authorization: {
      required: true,
      methods: [{
        id: "api-key",
        connectionId: "acme-research",
        kind: "secret-form",
        label: "API key",
        fields: [{ id: "apiKey", label: "API key", secret: true, required: true }],
      }],
    },
    resources,
  }, null, 2), "utf8");
}

async function writeDeclarativePackage(packageRoot: string, version = "1.0.0") {
  await writePackage(packageRoot, version, "export default async () => ({})\n", "# Acme Research\n");
  const manifestPath = join(packageRoot, "ipollowork.plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  delete manifest.engineBindings;
  delete manifest.package.engines;
  delete manifest.authorization;
  manifest.resources = manifest.resources.filter((resource: { type?: string }) => resource.type === "skill");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function writeSignedExecutablePackage(packageRoot: string) {
  const skillPath = "skills/signed-research/SKILL.md";
  const servicePath = "service/signed-research.mjs";
  await mkdir(join(packageRoot, dirname(skillPath)), { recursive: true });
  await mkdir(join(packageRoot, dirname(servicePath)), { recursive: true });
  await writeFile(join(packageRoot, servicePath), "export default async () => ({ actions: { ping: async () => ({ pong: true }) } });\n", "utf8");
  await writeFile(join(packageRoot, skillPath), "# Signed Research\n", "utf8");
  await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({
    schemaVersion: 2,
    id: "signed-research",
    name: "Signed Research",
    description: "Signed executable test package.",
    source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: {
      version: "1.0.0",
      publisher: { id: "smart-future-school", name: "智慧未来学校" },
      updateId: "smart-future-school/signed-research",
      checksum: { algorithm: "sha256", value: "96043f0fff207f9cb89dc07efe09ddb66f40a0f37f78138d37852e7263cf98aa" },
      signature: {
        algorithm: "ed25519",
        keyId: "smart-future-school-2026",
        value: "8ovn8bYOQwHeLdo/lrx/rIYZnw7fJCxVQ4IKKA6WDCFsnsX8mvQ9XMtjnYydnSlML+5dalES/p0iqDV9jGyOCQ==",
      },
    },
    permissions: [{ id: "network", reason: "Run the signed local service." }],
    resources: [
      {
        type: "local-service",
        id: "signed-research-service",
        path: servicePath,
        actions: [{
          id: "ping",
          title: "Ping",
          description: "Return a test response.",
          effect: "read",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        }],
        required: true,
      },
      {
        type: "skill",
        id: "signed-research-skill",
        path: skillPath,
        requires: ["service:signed-research-service"],
        required: true,
      },
    ],
  }, null, 2), "utf8");
}

async function expectMissing(path: string) {
  await expect(stat(path)).rejects.toThrow();
}

async function removeTestRoot(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (process.platform === "win32" && (code === "EBUSY" || code === "EPERM")) return;
    throw error;
  }
}

afterEach(async () => {
  for (const root of roots) {
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const config = serverConfig(root);
    await Promise.all([
      disposeRuntimeOpencodeConfigStore(config),
      disposeiPolloWorkWorkspaceConfigStore(config),
      disposeTemplateStore(config),
    ]);
  }
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  while (roots.length) {
    const root = roots.pop();
    if (root) await removeTestRoot(root);
  }
});

describe("plugin package lifecycle", () => {
  test("classifies upgrades and downgrades using semantic version precedence", async () => {
    const { pluginPackageVersionChange } = await import("./plugin-package-lifecycle.js");

    expect(pluginPackageVersionChange(null, "1.0.0")).toBe("install");
    expect(pluginPackageVersionChange("1.0.0", "1.0.0+build.2")).toBe("same");
    expect(pluginPackageVersionChange("1.0.0-beta.2", "1.0.0-beta.11")).toBe("upgrade");
    expect(pluginPackageVersionChange("2.0.0", "1.9.9")).toBe("downgrade");
    expect(pluginPackageVersionChange("1.0.0", "1.0.0-rc.1")).toBe("downgrade");
  });

  test("registers unique engine adapters and rejects duplicate IDs", () => {
    const alternateAdapter: PluginEngineAdapter = {
      id: "deepseek-harness",
      portableResourceTypes: new Set(["skill"]),
      nativeCapabilityKinds: new Set(),
      compatibility: () => [],
      workspaceFiles: () => [],
      skillTargetPath: () => null,
      syncRuntime: async () => undefined,
    };
    const registry = new PluginEngineAdapterRegistry([openCodePluginEngineAdapter, alternateAdapter]);

    expect(registry.ids()).toEqual([ENGINE_ID, "deepseek-harness"]);
    expect(registry.get(ENGINE_ID)).toBe(openCodePluginEngineAdapter);
    expect(registry.get("deepseek-harness")).toBe(alternateAdapter);
    expect(pluginEngineAdapters.ids()).toEqual([ENGINE_ID, "deepseek-harness"]);
    expect(pluginEngineAdapters.get("deepseek-harness")).toBe(deepSeekHarnessPluginEngineAdapter);
    expect(() => new PluginEngineAdapterRegistry([
      openCodePluginEngineAdapter,
      openCodePluginEngineAdapter,
    ])).toThrow("Duplicate plugin engine adapter: opencode");
  });

  test("reports complete, partial, and unsupported engine compatibility without hiding portable resources", async () => {
    const packageRoot = await createRoot("ipollowork-plugin-compatibility-");
    await writeDeclarativePackage(packageRoot);
    const manifest = JSON.parse(await readFile(join(packageRoot, "ipollowork.plugin.json"), "utf8"));

    expect(pluginEngineCompatibility(openCodePluginEngineAdapter, manifest)).toMatchObject({
      engineId: "opencode",
      status: "ready",
      supportedResourceIds: ["acme-skill"],
    });

    manifest.resources.push({
      type: "mcp",
      id: "private-mcp",
      mcpServerName: "private",
      path: "mcp/private.json",
      oauth: true,
      required: true,
    });
    expect(pluginEngineCompatibility(deepSeekHarnessPluginEngineAdapter, manifest)).toMatchObject({
      engineId: "deepseek-harness",
      status: "partial",
      unsupportedRequiredResourceIds: ["private-mcp"],
    });

    manifest.resources = [{ type: "command", id: "command-only", path: "commands/only.md", required: true }];
    expect(pluginEngineCompatibility(deepSeekHarnessPluginEngineAdapter, manifest).status).toBe("unsupported");
  });

  test("previews the complete Figma package and every bundled workflow file", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-figma-preview-workspace-");
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/figma", import.meta.url));

    const preview = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });

    expect(preview.manifest.id).toBe("figma");
    expect(preview.files.length).toBeGreaterThan(100);
    expect(preview.files.some((entry) => entry.path === "mcp/figma.json")).toBe(true);
    expect(preview.writes.some((entry) => entry.path === ".opencode/skills/figma-use/references/plugin-api-standalone.d.ts")).toBe(true);
    expect(preview.writes.some((entry) => entry.path === "README.md")).toBe(false);
    expect(preview.writes.some((entry) => entry.path === ".opencode/mcps/figma.json")).toBe(false);
  });

  test("rejects pre-release plugin manifest formats instead of converting them", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-current-format-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-current-format-package-");
    await writeDeclarativePackage(packageRoot);
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.schemaVersion = 1;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await expect(lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID }))
      .rejects.toThrow();

    manifest.schemaVersion = 2;
    manifest.resources[0].path = ".opencode/skills/acme-research/SKILL.md";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await expect(lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID }))
      .rejects.toThrow();
  });

  test("installs and serves an enabled Workspace App from immutable package artifacts", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-workspace-app-");
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/workspace-canvas", import.meta.url));
    const config = serverConfig(workspaceRoot);
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");

    await lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    });
    const resource = await lifecycle.readInstalledPluginUiResource({
      serverConfig: config,
      pluginId: "workspace-canvas",
      resourceId: "canvas",
    });

    expect(resource.resource.ui.uri).toBe("ui://workspace-canvas/canvas");
    expect(resource.html).toContain("Workspace Canvas");
    await lifecycle.setPluginPackageEnabled({
      serverConfig: config,
      pluginId: "workspace-canvas",
      enabled: false,
    });
    await expect(lifecycle.readInstalledPluginUiResource({
      serverConfig: config,
      pluginId: "workspace-canvas",
      resourceId: "canvas",
    })).rejects.toMatchObject({ code: "plugin_package_disabled" });
  });

  test("expands directory resources into owned files without duplicates", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-directory-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-directory-package-");
    const skillRoot = join(packageRoot, "skills", "figma");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "# Figma\n", "utf8");
    await writeFile(join(skillRoot, "references", "api.md"), "# API\n", "utf8");
    await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({
      schemaVersion: 2,
      id: "figma",
      name: "Figma",
      description: "Figma workflows.",
      source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
      package: { version: "1.0.0", updateId: "figma/workflows" },
      resources: [
        { type: "skill", id: "figma-skill", path: "skills/figma/SKILL.md", required: true },
        { type: "file", id: "figma-skill-files", path: "skills/figma", required: true },
      ],
    }), "utf8");

    const preview = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });

    expect(preview.writes.map((entry) => entry.path)).toEqual([
      ".opencode/skills/figma/SKILL.md",
      ".opencode/skills/figma/references/api.md",
    ]);
  });

  test("previews, installs idempotently, registers OpenCode, and uninstalls owned files", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n");
    await writeFile(join(workspaceRoot, "unrelated.txt"), "keep me", "utf8");
    const config = serverConfig(workspaceRoot);

    const preview = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });
    expect(preview.writes.map((entry) => entry.path).sort()).toEqual([
      ".opencode/skills/acme-research/SKILL.md",
    ]);
    expect(preview.files.map((entry) => entry.path).sort()).toEqual([
      "engines/opencode/plugins/acme-research.ts",
      "skills/acme-research/SKILL.md",
    ]);

    const installed = await lifecycle.installPluginPackage({ serverConfig: config, packageRoot });
    const repeated = await lifecycle.installPluginPackage({ serverConfig: config, packageRoot });
    expect(installed).toMatchObject({ status: "installed", pluginId: "acme-research", version: "1.0.0" });
    expect(repeated).toMatchObject({ status: "unchanged", pluginId: "acme-research", version: "1.0.0" });
    expect(await readFile(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"), "utf8")).toBe("# Acme Research\n");
    const installedSpec = (await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin?.[0] ?? "";
    expect(installedSpec).toContain("/plugin-packages/artifacts/acme-research/1.0.0/");
    expect(installedSpec).not.toContain(`${workspaceRoot}/.opencode/plugins`);

    await lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: "acme-research" });
    await expectMissing(join(workspaceRoot, ".opencode", "plugins", "acme-research.ts"));
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    expect(await readFile(join(workspaceRoot, "unrelated.txt"), "utf8")).toBe("keep me");
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin).toEqual([]);
  });

  test("adopts identical activation files but preserves different user content", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const packageRoot = await createRoot("ipollowork-plugin-adoption-package-");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n");

    const matchingWorkspace = await createRoot("ipollowork-plugin-adoption-workspace-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(matchingWorkspace, "runtime.sqlite");
    const matchingTarget = join(matchingWorkspace, ".opencode", "skills", "acme-research", "SKILL.md");
    await mkdir(join(matchingWorkspace, ".opencode", "skills", "acme-research"), { recursive: true });
    await writeFile(matchingTarget, "# Acme Research\n", "utf8");

    const installed = await lifecycle.installPluginPackage({
      serverConfig: serverConfig(matchingWorkspace),
      packageRoot,
    });
    expect(installed).toMatchObject({ status: "installed", pluginId: "acme-research" });
    expect(await readFile(matchingTarget, "utf8")).toBe("# Acme Research\n");

    const conflictingWorkspace = await createRoot("ipollowork-plugin-conflict-workspace-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(conflictingWorkspace, "runtime.sqlite");
    const conflictingTarget = join(conflictingWorkspace, ".opencode", "skills", "acme-research", "SKILL.md");
    await mkdir(join(conflictingWorkspace, ".opencode", "skills", "acme-research"), { recursive: true });
    await writeFile(conflictingTarget, "# User customization\n", "utf8");

    await expect(lifecycle.installPluginPackage({
      serverConfig: serverConfig(conflictingWorkspace),
      packageRoot,
    })).rejects.toMatchObject({
      code: "plugin_package_conflict",
      details: { paths: [".opencode/skills/acme-research/SKILL.md"] },
    });
    expect(await readFile(conflictingTarget, "utf8")).toBe("# User customization\n");
  });

  test("updates owned files and rolls back to the previous immutable version", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-workspace-");
    const packageV1 = await createRoot("ipollowork-plugin-v1-");
    const packageV2 = await createRoot("ipollowork-plugin-v2-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePackage(packageV1, "1.0.0", "export const version = 'v1'\n", "# Version one\n");
    await writePackage(packageV2, "1.1.0", "export const version = 'v2'\n", "# Version two\n");
    const config = serverConfig(workspaceRoot);

    await lifecycle.installPluginPackage({ serverConfig: config, packageRoot: packageV1 });
    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      enabled: false,
    });
    const updated = await lifecycle.updatePluginPackage({ serverConfig: config, packageRoot: packageV2 });
    expect(updated).toMatchObject({ status: "updated", previousVersion: "1.0.0", version: "1.1.0" });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin?.[0]).toContain("/1.1.0/");
    await expectMissing(join(workspaceRoot, ".opencode", "plugins", "acme-research.ts"));
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));

    const rolledBack = await lifecycle.rollbackPluginPackage({ serverConfig: config, pluginId: "acme-research" });
    expect(rolledBack).toMatchObject({ status: "rolled_back", previousVersion: "1.1.0", version: "1.0.0" });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin?.[0]).toContain("/1.0.0/");
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));

    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      enabled: true,
    });
    expect(await readFile(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"), "utf8")).toBe("# Version one\n");
  });

  test("stops an update when an owned file was modified by the user", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-workspace-");
    const packageV1 = await createRoot("ipollowork-plugin-v1-");
    const packageV2 = await createRoot("ipollowork-plugin-v2-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePackage(packageV1, "1.0.0", "export const version = 'v1'\n", "# Version one\n");
    await writePackage(packageV2, "1.1.0", "export const version = 'v2'\n", "# Version two\n");
    const config = serverConfig(workspaceRoot);

    await lifecycle.installPluginPackage({ serverConfig: config, packageRoot: packageV1 });
    const target = join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md");
    await writeFile(target, "# User customization\n", "utf8");

    await expect(lifecycle.updatePluginPackage({ serverConfig: config, packageRoot: packageV2 })).rejects.toMatchObject({
      code: "plugin_package_conflict",
    });
    expect(await readFile(target, "utf8")).toBe("# User customization\n");
  });

  test("reports unsigned packages and rejects a declared checksum mismatch", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-integrity-");
    const packageRoot = await createRoot("ipollowork-plugin-integrity-package-");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n");

    const unsigned = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });
    expect(unsigned.integrity.status).toBe("unsigned");
    expect(unsigned.integrity.sha256).toMatch(/^[a-f0-9]{64}$/);

    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.description = "Changed package metadata";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const changed = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });
    expect(changed.integrity.sha256).not.toBe(unsigned.integrity.sha256);

    manifest.package.checksum = { algorithm: "sha256", value: "0".repeat(64) };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await expect(lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID })).rejects.toMatchObject({
      code: "plugin_package_checksum_mismatch",
    });

    delete manifest.package.checksum;
    manifest.package.compatibility = { ipollowork: ">=99.0.0" };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await expect(lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID })).rejects.toMatchObject({
      code: "plugin_package_incompatible",
    });
  });

  test("keeps portable resources available outside a package's native engine list", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-engine-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-engine-package-");
    await writeDeclarativePackage(packageRoot);
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.package.engines = ["deepseek-harness"];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const preview = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });
    expect(preview.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ".opencode/skills/acme-research/SKILL.md" }),
    ]));
  });

  test("validates every compatible local engine before a global install", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const openCodeRoot = await createRoot("ipollowork-plugin-compat-opencode-");
    const deepSeekRoot = await createRoot("ipollowork-plugin-compat-dsh-");
    const packageRoot = await createRoot("ipollowork-plugin-compat-package-");
    await writeDeclarativePackage(packageRoot);
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.package.engines = ["opencode", "deepseek-harness"];
    manifest.engineBindings = [{
      engine: "deepseek-harness",
      compatibility: ">=99.0.0",
      capabilities: [],
    }];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const config = serverConfig(openCodeRoot);
    config.workspaces.push({
      id: "ws_deepseek_harness",
      name: "DeepSeek Harness",
      path: deepSeekRoot,
      preset: "starter",
      workspaceType: "local",
      engineId: "deepseek-harness",
    });

    await expect(lifecycle.installPluginPackage({ serverConfig: config, packageRoot }))
      .rejects.toMatchObject({ code: "plugin_package_incompatible" });
    await expectMissing(join(openCodeRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    await expectMissing(join(deepSeekRoot, ".dsh", "skills", "acme-research", "SKILL.md"));
  });

  test("installs portable skills through the DeepSeek Harness adapter", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-engine-selection-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-engine-selection-package-");
    await writeDeclarativePackage(packageRoot);
    const skill = "---\nname: acme-research\ndescription: Research with Acme.\n---\n\n# Acme Research\n";
    await writeFile(join(packageRoot, "skills", "acme-research", "SKILL.md"), skill, "utf8");
    const config = serverConfig(workspaceRoot);
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Test workspace is missing");
    workspace.engineId = "deepseek-harness";

    const installed = await lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    });

    expect(installed).toMatchObject({ status: "installed", pluginId: "acme-research" });
    expect(await readFile(join(workspaceRoot, ".dsh", "skills", "acme-research", "SKILL.md"), "utf8")).toBe(skill);
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));

    await lifecycle.uninstallPluginPackage({
      serverConfig: config,
      pluginId: "acme-research",
    });
    await expectMissing(join(workspaceRoot, ".dsh", "skills", "acme-research", "SKILL.md"));
  });

  test("projects bundled Design and Video packages into DeepSeek Harness skills", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-dsh-creative-workspace-");
    const config = serverConfig(workspaceRoot);
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Test workspace is missing");
    workspace.engineId = "deepseek-harness";
    const packages = [
      {
        id: "design-agent",
        root: fileURLToPath(new URL("../../../examples/plugin-packages/design-agent", import.meta.url)),
        skill: "ipollowork-design-studio",
        heading: "# iPolloWork Design Studio",
      },
      {
        id: "video-agent",
        root: fileURLToPath(new URL("../../../examples/plugin-packages/video-agent", import.meta.url)),
        skill: "ipollowork-video-studio",
        heading: "# iPolloWork Video Studio",
      },
    ];

    for (const item of packages) {
      await lifecycle.installPluginPackage({
        serverConfig: config,
        packageRoot: item.root,
      });
      expect(await readFile(join(workspaceRoot, ".dsh", "skills", item.skill, "SKILL.md"), "utf8"))
        .toContain(item.heading);
    }
  });

  test("shares one installed package inventory across OpenCode and DeepSeek Harness projects", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const openCodeRoot = await createRoot("ipollowork-plugin-shared-opencode-");
    const deepSeekRoot = await createRoot("ipollowork-plugin-shared-dsh-");
    const packageRoot = await createRoot("ipollowork-plugin-shared-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(openCodeRoot, "runtime.sqlite");
    await writeDeclarativePackage(packageRoot);
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.package.engines = ["opencode"];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const config = serverConfig(openCodeRoot);
    config.workspaces.push({
      id: "ws_deepseek_harness",
      name: "DeepSeek Harness",
      path: deepSeekRoot,
      preset: "starter",
      workspaceType: "local",
      engineId: "deepseek-harness",
    });
    config.authorizedRoots.push(deepSeekRoot);

    await lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    });
    const server = await startServer(config);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/workspace/ws_deepseek_harness/plugin-packages`, {
        headers: { authorization: `Bearer ${config.token}` },
      });
      expect(response.status).toBe(200);
      expect((await response.json()).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ pluginId: "acme-research", version: "1.0.0" }),
      ]));
      const openCodeSkill = join(openCodeRoot, ".opencode", "skills", "acme-research", "SKILL.md");
      const deepSeekSkill = join(deepSeekRoot, ".dsh", "skills", "acme-research", "SKILL.md");
      expect(await readFile(join(deepSeekRoot, ".dsh", "skills", "acme-research", "SKILL.md"), "utf8"))
        .toBe("# Acme Research\n");
      await lifecycle.setPluginPackageResourceEnabled({
        serverConfig: config,
        pluginId: "acme-research",
        resourceId: "acme-skill",
        enabled: false,
      });
      await expectMissing(openCodeSkill);
      await expectMissing(deepSeekSkill);
      await lifecycle.setPluginPackageResourceEnabled({
        serverConfig: config,
        pluginId: "acme-research",
        resourceId: "acme-skill",
        enabled: true,
      });
      expect(await readFile(openCodeSkill, "utf8")).toBe("# Acme Research\n");
      expect(await readFile(deepSeekSkill, "utf8")).toBe("# Acme Research\n");
      await lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: "acme-research" });
      await expectMissing(openCodeSkill);
      await expectMissing(deepSeekSkill);
      expect((await lifecycle.listInstalledPluginPackages({ serverConfig: config })).map((item) => item.pluginId))
        .not.toContain("acme-research");
    } finally {
      await server.stop();
    }
  });

  test("serializes workspace reconciliation with uninstall artifact cleanup", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-reconcile-uninstall-");
    const packageRoot = await createRoot("ipollowork-plugin-reconcile-uninstall-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writeDeclarativePackage(packageRoot);
    const config = serverConfig(workspaceRoot);

    await lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    });

    await Promise.all([
      lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: "acme-research" }),
      lifecycle.reconcilePluginPackagesForWorkspace({
        serverConfig: config,
        workspaceId: WORKSPACE_ID,
        workspaceRoot,
      }),
    ]);

    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    expect(await lifecycle.listInstalledPluginPackages({ serverConfig: config })).toEqual([]);
  });

  test("preflights every workspace before a global install mutates any project", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const openCodeRoot = await createRoot("ipollowork-plugin-atomic-install-opencode-");
    const deepSeekRoot = await createRoot("ipollowork-plugin-atomic-install-dsh-");
    const packageRoot = await createRoot("ipollowork-plugin-atomic-install-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(openCodeRoot, "runtime.sqlite");
    await writeDeclarativePackage(packageRoot);
    const config = serverConfig(openCodeRoot);
    config.workspaces.push({
      id: "ws_deepseek_harness",
      name: "DeepSeek Harness",
      path: deepSeekRoot,
      preset: "starter",
      workspaceType: "local",
      engineId: "deepseek-harness",
    });
    config.authorizedRoots.push(deepSeekRoot);
    const conflictingTarget = join(deepSeekRoot, ".dsh", "skills", "acme-research", "SKILL.md");
    await mkdir(dirname(conflictingTarget), { recursive: true });
    await writeFile(conflictingTarget, "# School-owned content\n", "utf8");

    await expect(lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    })).rejects.toMatchObject({ code: "plugin_package_conflict" });

    await expectMissing(join(openCodeRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    expect(await readFile(conflictingTarget, "utf8")).toBe("# School-owned content\n");
    expect(await lifecycle.listInstalledPluginPackages({ serverConfig: config })).toEqual([]);
  });

  test("keeps every workspace and global state intact when uninstall preflight fails", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const openCodeRoot = await createRoot("ipollowork-plugin-atomic-uninstall-opencode-");
    const deepSeekRoot = await createRoot("ipollowork-plugin-atomic-uninstall-dsh-");
    const packageRoot = await createRoot("ipollowork-plugin-atomic-uninstall-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(openCodeRoot, "runtime.sqlite");
    await writeDeclarativePackage(packageRoot);
    const config = serverConfig(openCodeRoot);
    config.workspaces.push({
      id: "ws_deepseek_harness",
      name: "DeepSeek Harness",
      path: deepSeekRoot,
      preset: "starter",
      workspaceType: "local",
      engineId: "deepseek-harness",
    });
    config.authorizedRoots.push(deepSeekRoot);
    await lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    });
    const openCodeTarget = join(openCodeRoot, ".opencode", "skills", "acme-research", "SKILL.md");
    const deepSeekTarget = join(deepSeekRoot, ".dsh", "skills", "acme-research", "SKILL.md");
    await writeFile(deepSeekTarget, "# Teacher customization\n", "utf8");

    await expect(lifecycle.uninstallPluginPackage({
      serverConfig: config,
      pluginId: "acme-research",
    })).rejects.toMatchObject({ code: "plugin_package_conflict" });

    expect(await readFile(openCodeTarget, "utf8")).toBe("# Acme Research\n");
    expect(await readFile(deepSeekTarget, "utf8")).toBe("# Teacher customization\n");
    expect(await lifecycle.listInstalledPluginPackages({ serverConfig: config })).toEqual([
      expect.objectContaining({ pluginId: "acme-research", enabled: true }),
    ]);
  });

  test("does not half-enable a plugin when a later workspace has a conflict", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const openCodeRoot = await createRoot("ipollowork-plugin-atomic-enable-opencode-");
    const deepSeekRoot = await createRoot("ipollowork-plugin-atomic-enable-dsh-");
    const packageRoot = await createRoot("ipollowork-plugin-atomic-enable-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(openCodeRoot, "runtime.sqlite");
    await writeDeclarativePackage(packageRoot);
    const config = serverConfig(openCodeRoot);
    config.workspaces.push({
      id: "ws_deepseek_harness",
      name: "DeepSeek Harness",
      path: deepSeekRoot,
      preset: "starter",
      workspaceType: "local",
      engineId: "deepseek-harness",
    });
    config.authorizedRoots.push(deepSeekRoot);
    await lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    });
    await lifecycle.setPluginPackageEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      enabled: false,
    });
    const deepSeekTarget = join(deepSeekRoot, ".dsh", "skills", "acme-research", "SKILL.md");
    await mkdir(dirname(deepSeekTarget), { recursive: true });
    await writeFile(deepSeekTarget, "# Independent project skill\n", "utf8");

    await expect(lifecycle.setPluginPackageEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      enabled: true,
    })).rejects.toMatchObject({ code: "plugin_package_conflict" });

    await expectMissing(join(openCodeRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    expect(await readFile(deepSeekTarget, "utf8")).toBe("# Independent project skill\n");
    expect(await lifecycle.listInstalledPluginPackages({ serverConfig: config })).toEqual([
      expect.objectContaining({ pluginId: "acme-research", enabled: false }),
    ]);
  });

  test("lists the same bundled packages for the DeepSeek Harness engine", async () => {
    const workspaceRoot = await createRoot("ipollowork-plugin-dsh-catalog-workspace-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    const config = serverConfig(workspaceRoot);
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Test workspace is missing");
    workspace.engineId = "deepseek-harness";
    const server = await startServer(config);

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/plugin-packages/catalog`, {
        headers: { authorization: "Bearer token" },
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      const pluginIds = payload.items.map((item: { pluginId: string }) => item.pluginId);
      expect(pluginIds).toEqual([...bundledPluginPackageIds]);

      const parallelEnginePluginApi = await fetch(
        `http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/plugins`,
        { headers: { authorization: "Bearer token" } },
      );
      expect(parallelEnginePluginApi.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  test("keeps Work-layer resources while projecting DeepSeek Harness skills", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-dsh-unsupported-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-dsh-unsupported-package-");
    await writeDeclarativePackage(packageRoot);
    const mcpPath = join(packageRoot, "mcp", "acme.json");
    await mkdir(dirname(mcpPath), { recursive: true });
    await writeFile(mcpPath, JSON.stringify({ type: "remote", url: "https://mcp.acme.example/mcp" }), "utf8");
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.resources.push({ type: "mcp", id: "acme-mcp", path: "mcp/acme.json", required: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const preview = await lifecycle.previewPluginPackage({
      packageRoot,
      engineId: "deepseek-harness",
    });
    expect(preview.files.map((file) => file.path)).toContain("mcp/acme.json");
    expect(preview.writes.map((file) => file.path)).toEqual([".dsh/skills/acme-research/SKILL.md"]);
  });

  test("exposes portable plugin commands and agents to DeepSeek Harness and removes them with the global lifecycle", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-dsh-prompts-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-dsh-prompts-package-");
    await writeDeclarativePackage(packageRoot);
    await mkdir(join(packageRoot, "commands"), { recursive: true });
    await mkdir(join(packageRoot, "agents"), { recursive: true });
    await writeFile(join(packageRoot, "commands", "research-topic.md"), "# Research topic\n\nInvestigate the requested topic.\n", "utf8");
    await writeFile(join(packageRoot, "agents", "research-reviewer.md"), "Review research claims and require sources.\n", "utf8");
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.resources.push(
      { type: "command", id: "research-command", path: "commands/research-topic.md", label: "Research a topic" },
      { type: "agent", id: "research-reviewer", path: "agents/research-reviewer.md", description: "Review research claims" },
    );
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const config = serverConfig(workspaceRoot);
    config.workspaces[0]!.engineId = "deepseek-harness";

    await lifecycle.installPluginPackage({ serverConfig: config, packageRoot });
    expect(await lifecycle.listPortablePluginPromptCapabilities({
      serverConfig: config,
      engineId: "deepseek-harness",
    })).toEqual([
      expect.objectContaining({ type: "agent", name: "research-reviewer", description: "Review research claims" }),
      expect.objectContaining({ type: "command", name: "research-topic", description: "Research a topic" }),
    ]);

    await lifecycle.setPluginPackageEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      enabled: false,
    });
    expect(await lifecycle.listPortablePluginPromptCapabilities({
      serverConfig: config,
      engineId: "deepseek-harness",
    })).toEqual([]);

    await lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: "acme-research" });
    expect(await lifecycle.listPortablePluginPromptCapabilities({
      serverConfig: config,
      engineId: "deepseek-harness",
    })).toEqual([]);
  });

  test("registers plugin MCP resources for DeepSeek Harness and removes them on disable", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-dsh-mcp-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-dsh-mcp-package-");
    await writeDeclarativePackage(packageRoot);
    await mkdir(join(packageRoot, "mcp"), { recursive: true });
    await writeFile(join(packageRoot, "mcp", "acme.json"), JSON.stringify({
      type: "remote",
      url: "https://mcp.acme.example/mcp",
    }), "utf8");
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.resources.push({ type: "mcp", id: "acme-mcp", path: "mcp/acme.json", mcpServerName: "acme" });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const config = serverConfig(workspaceRoot);
    config.workspaces[0]!.engineId = "deepseek-harness";

    await lifecycle.installPluginPackage({ serverConfig: config, packageRoot });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.acme).toEqual({
      type: "remote",
      url: "https://mcp.acme.example/mcp",
    });

    await lifecycle.setPluginPackageEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      enabled: false,
    });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.acme).toBeUndefined();

  });

  test("allows remote HTTPS MCP imports but blocks local MCP commands", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-safe-mcp-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-safe-mcp-package-");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n", { mcp: true });
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.engineBindings;
    delete manifest.package.engines;
    delete manifest.authorization;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const remotePreview = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });
    expect(await lifecycle.assertPluginPackageSafeForImport({ packageRoot, preview: remotePreview, purpose: "install" }))

      .toMatchObject({ level: "declarative", localCode: false });

    await writeFile(
      join(packageRoot, "mcp", "acme-research.json"),
      JSON.stringify({ type: "local", command: ["node", "malicious.mjs"] }),
      "utf8",
    );
    const localPreview = await lifecycle.previewPluginPackage({ packageRoot, engineId: ENGINE_ID });
    await expect(lifecycle.assertPluginPackageSafeForImport({ packageRoot, preview: localPreview, purpose: "install" })).rejects.toMatchObject({

      code: "plugin_package_import_unsafe",
    });
  });

  test("rejects executable packages from the public developer import API", async () => {
    const workspaceRoot = await createRoot("ipollowork-plugin-api-");
    const packageRoot = join(workspaceRoot, "packages", "acme-research");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n");
    const config = serverConfig(workspaceRoot);
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    try {
      const validation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ packageRoot: "packages/acme-research" }),
      });
      expect(validation.status).toBe(400);
      expect(await validation.json()).toMatchObject({
        code: "plugin_package_import_unsafe",
        details: { reasons: expect.arrayContaining([expect.stringContaining("executable capabilities")]) },
      });
    } finally {
      await server.stop();
    }
  });

  test("discovers, imports, previews, refreshes, and exports Plugin Workshop projects", async () => {
    const workspaceRoot = await createRoot("ipollowork-plugin-workshop-api-");
    const projectRoot = join(workspaceRoot, "plugins", "focus-board");
    const uiPath = join(projectRoot, "ui", "studio.html");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await mkdir(dirname(uiPath), { recursive: true });
    await writeFile(uiPath, "<!doctype html><main>Focus Board v1</main>\n", "utf8");
    await writeFile(join(projectRoot, "ipollowork.plugin.json"), JSON.stringify({
      schemaVersion: 2,
      id: "focus-board",
      name: "Focus Board",
      description: "A Plugin Workshop test package.",
      source: { format: "ipollowork-extension-manifest", origin: "workspace", trusted: false },
      package: { version: "1.0.0", updateId: "personal/focus-board" },
      resources: [{
        type: "ui",
        id: "studio",
        label: "Focus Board",
        path: "ui/studio.html",
        required: true,
        ui: { uri: "ui://focus-board/studio", mimeType: "text/html;profile=mcp-app" },
      }],
      contributions: [{ type: "workspace-app", ref: "studio", label: "Focus Board" }],
    }, null, 2), "utf8");

    const config = serverConfig(workspaceRoot);
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/plugin-workshop/projects`;
    const headers = { authorization: "Bearer token" };
    try {
      const listing = await fetch(base, { headers });
      expect(listing.status).toBe(200);
      expect(await listing.json()).toMatchObject({
        items: [{ directoryId: "focus-board", packageRoot: "plugins/focus-board", manifest: { id: "focus-board" }, error: null }],
      });

      const firstSnapshot = await fetch(`${base}/focus-board`, { headers });
      expect(firstSnapshot.status).toBe(200);
      const firstPayload = await firstSnapshot.json();
      expect(firstPayload).toMatchObject({
        project: { manifest: { id: "focus-board" } },
        ui: { resource: { id: "studio", path: "ui/studio.html" }, html: expect.stringContaining("Focus Board v1") },
      });

      await writeFile(uiPath, "<!doctype html><main>Focus Board v2 is live</main>\n", "utf8");
      const secondPayload = await (await fetch(`${base}/focus-board`, { headers })).json();
      expect(secondPayload.revision).not.toBe(firstPayload.revision);
      expect(secondPayload.ui.html).toContain("Focus Board v2 is live");

      const exported = await fetch(`${base}/focus-board/export`, { headers });
      expect(exported.status).toBe(200);
      const bundle = await exported.json();
      expect(bundle).toMatchObject({ pluginId: "focus-board", version: "1.0.0" });
      expect(bundle.files.map((file: { path: string }) => file.path)).toEqual([
        "ipollowork.plugin.json",
        "ui/studio.html",
      ]);
      expect(Buffer.from(bundle.files[1].contentBase64, "base64").toString("utf8")).toContain("Focus Board v2 is live");

      const sourceExported = await fetch(`${base}/focus-board/export?format=source`, { headers });
      expect(sourceExported.status).toBe(200);
      expect(await sourceExported.json()).toMatchObject({
        pluginId: "focus-board",
        version: "1.0.0",
        preparation: { localizedUrls: [], removedNetworkPermission: false },
      });
      const invalidExport = await fetch(`${base}/focus-board/export?format=archive`, { headers });
      expect(invalidExport.status).toBe(400);
      expect(await invalidExport.json()).toMatchObject({ code: "plugin_workshop_export_format_invalid" });

      const importedManifest = {
        schemaVersion: 2,
        id: "imported-board",
        name: "Imported Board",
        description: "An imported Plugin Workshop project.",
        source: { format: "ipollowork-extension-manifest", origin: "workspace", trusted: false },
        package: { version: "1.0.0", updateId: "personal/imported-board" },
        resources: [{
          type: "ui",
          id: "studio",
          label: "Imported Board",
          path: "ui/studio.html",
          required: true,
          ui: {
            uri: "ui://imported-board/studio",
            mimeType: "text/html;profile=mcp-app",
            csp: { resourceDomains: ["https://cdn.jsdelivr.net"] },
          },
        }],
        contributions: [{ type: "workspace-app", ref: "studio", label: "Imported Board" }],
        permissions: [{ id: "network", reason: "Load the declared browser library." }],
      };
      const upload = {
        archiveName: "imported-board-source.zip",
        files: [
          { path: "ipollowork.plugin.json", contentBase64: Buffer.from(JSON.stringify(importedManifest, null, 2)).toString("base64") },
          { path: "ui/studio.html", contentBase64: Buffer.from("<!doctype html><main>Editable import</main>\n").toString("base64") },
        ],
      };
      const imported = await fetch(base.replace("/projects", "/import"), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(upload),
      });
      expect(imported.status).toBe(201);
      expect(await imported.json()).toMatchObject({ project: { directoryId: "imported-board", manifest: { id: "imported-board" } } });
      expect(await readFile(join(workspaceRoot, "plugins", "imported-board", "ui", "studio.html"), "utf8")).toContain("Editable import");

      const installValidation = await fetch(base.replace("/plugin-workshop/projects", "/plugin-packages/import/validate"), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...upload, archiveName: "imported-board.ipollowork-plugin" }),
      });
      expect(installValidation.status).toBe(400);
      expect(await installValidation.json()).toMatchObject({
        code: "plugin_package_import_unsafe",
        details: { reasons: expect.arrayContaining([expect.stringContaining("network")]) },
      });

      const privilegedManifest = {
        ...importedManifest,
        id: "privileged-board",
        package: { ...importedManifest.package, updateId: "personal/privileged-board" },
        permissions: [...importedManifest.permissions, { id: "process", reason: "Run a local process." }],
      };
      const privilegedSource = await fetch(base.replace("/projects", "/import"), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          ...upload,
          archiveName: "privileged-board-source.zip",
          files: upload.files.map((file) => file.path === "ipollowork.plugin.json"
            ? { ...file, contentBase64: Buffer.from(JSON.stringify(privilegedManifest, null, 2)).toString("base64") }
            : file),
        }),
      });
      expect(privilegedSource.status).toBe(400);
      expect(await privilegedSource.json()).toMatchObject({
        code: "plugin_package_import_unsafe",
        details: { reasons: expect.arrayContaining([expect.stringContaining("process")]) },
      });

      const installPackageRejectedByWorkshop = await fetch(base.replace("/projects", "/import"), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...upload, archiveName: "another-board.ipollowork-plugin" }),
      });
      expect(installPackageRejectedByWorkshop.status).toBe(400);
      expect(await installPackageRejectedByWorkshop.json()).toMatchObject({
        code: "plugin_package_archive_format_invalid",
        details: { format: "source", expectedExtension: ".zip" },
      });

      const duplicate = await fetch(base.replace("/projects", "/import"), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(upload),
      });
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({
        code: "plugin_workshop_project_exists",
        details: { directoryId: "imported-board", packageRoot: "plugins/imported-board" },
      });
      expect(await readFile(join(workspaceRoot, "plugins", "imported-board", "ui", "studio.html"), "utf8")).toContain("Editable import");

      const legacyPath = join(workspaceRoot, "plugins", "imported-board", "legacy.txt");
      await writeFile(legacyPath, "remove me", "utf8");
      const overwriteUpload = {
        ...upload,
        files: upload.files.map((file) => file.path === "ui/studio.html"
          ? { ...file, contentBase64: Buffer.from("<!doctype html><main>Overwritten import</main>\n").toString("base64") }
          : file),
      };
      const overwritten = await fetch(`${base.replace("/projects", "/import")}?overwrite=true`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(overwriteUpload),
      });
      expect(overwritten.status).toBe(201);
      expect(await overwritten.json()).toMatchObject({ project: { directoryId: "imported-board" } });
      expect(await readFile(join(workspaceRoot, "plugins", "imported-board", "ui", "studio.html"), "utf8")).toContain("Overwritten import");
      await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await server.stop();
    }
  });
  test("uninstall removes plugin-owned authorization without leaving an orphaned credential", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-authorization-cleanup-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-authorization-cleanup-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n");
    const config = serverConfig(workspaceRoot);
    await lifecycle.installPluginPackage({
      serverConfig: config,
      packageRoot,
    });
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    try {
      const authorization = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research/authorization/api-key/credentials`, {
        method: "POST",
        headers,
        body: JSON.stringify({ accountId: "school", values: { apiKey: "school-secret" } }),
      });
      expect(authorization.status).toBe(200);
      expect(await authorization.json()).toMatchObject({ status: { accountId: "school", status: "connected" } });

      const removal = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research`, { method: "DELETE", headers });
      expect(removal.status).toBe(200);

      await lifecycle.installPluginPackage({
        serverConfig: config,
        packageRoot,
      });
      const reinstalledAuthorization = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research/authorization`, { headers });
      expect(reinstalledAuthorization.status).toBe(200);
      expect(await reinstalledAuthorization.json()).toMatchObject({ connections: [], flows: [] });

    } finally {
      await server.stop();
    }
  });

  test("uploads, previews, installs, and uninstalls a complete declarative plugin archive", async () => {
    const workspaceRoot = await createRoot("ipollowork-plugin-upload-api-");
    const packageRoot = await createRoot("ipollowork-plugin-upload-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writeDeclarativePackage(packageRoot);
    const manifest = await readFile(join(packageRoot, "ipollowork.plugin.json"));
    const skill = await readFile(join(packageRoot, "skills", "acme-research", "SKILL.md"));
    const upload = {
      archiveName: "acme-research.ipollowork-plugin",
      files: [
        { path: "ipollowork.plugin.json", contentBase64: manifest.toString("base64") },
        { path: "skills/acme-research/SKILL.md", contentBase64: skill.toString("base64") },
      ],
    };
    const config = serverConfig(workspaceRoot);
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    try {
      const sourceArchiveRejectedByInstaller = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...upload, archiveName: "acme-research-source.zip" }),
      });
      expect(sourceArchiveRejectedByInstaller.status).toBe(400);
      expect(await sourceArchiveRejectedByInstaller.json()).toMatchObject({
        code: "plugin_package_archive_format_invalid",
        details: { format: "install", expectedExtension: ".ipollowork-plugin" },
      });

      const validation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify(upload),
      });
      expect(validation.status).toBe(200);
      expect(await validation.json()).toMatchObject({
        preview: {
          manifest: { id: "acme-research" },
          safety: { level: "declarative", localCode: false },
          writes: [{ path: ".opencode/skills/acme-research/SKILL.md" }],
          installedVersion: null,
          versionChange: "install",
        },
      });

      const installation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import`, {
        method: "POST",
        headers,
        body: JSON.stringify(upload),
      });
      expect(installation.status).toBe(200);
      expect(await installation.json()).toMatchObject({
        result: { status: "installed", pluginId: "acme-research" },
        safety: { level: "declarative", localCode: false },
      });
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"), "utf8"))
        .toBe("# Acme Research\n");
      await expectMissing(join(workspaceRoot, ".opencode", "plugins", "acme-research.ts"));

      const downgradedManifest = JSON.parse(manifest.toString("utf8"));
      downgradedManifest.package.version = "0.9.0";
      const downgradedUpload = {
        ...upload,
        files: upload.files.map((file) => file.path === "ipollowork.plugin.json"
          ? { ...file, contentBase64: Buffer.from(JSON.stringify(downgradedManifest, null, 2)).toString("base64") }
          : file),
      };
      const downgradeValidation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify(downgradedUpload),
      });
      expect(downgradeValidation.status).toBe(200);
      expect(await downgradeValidation.json()).toMatchObject({
        preview: { installedVersion: "1.0.0", versionChange: "downgrade" },
      });

      const unconfirmedDowngrade = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import`, {
        method: "POST",
        headers,
        body: JSON.stringify(downgradedUpload),
      });
      expect(unconfirmedDowngrade.status).toBe(409);
      expect(await unconfirmedDowngrade.json()).toMatchObject({
        code: "plugin_package_downgrade_confirmation_required",
        details: { installedVersion: "1.0.0", incomingVersion: "0.9.0" },
      });

      const downgradeInstallation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import?allowDowngrade=true`, {
        method: "POST",
        headers,
        body: JSON.stringify(downgradedUpload),
      });
      expect(downgradeInstallation.status).toBe(200);
      expect(await downgradeInstallation.json()).toMatchObject({
        result: { status: "updated", pluginId: "acme-research", previousVersion: "1.0.0", version: "0.9.0" },
      });

      const removal = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research`, { method: "DELETE", headers });
      expect(removal.status).toBe(200);
      const remaining = await (await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages`, { headers })).json();
      expect(remaining.items.map((item: { pluginId: string }) => item.pluginId)).not.toContain("acme-research");
    } finally {
      await server.stop();
    }
  });


  test("imports, runs, and uninstalls a trusted publisher-signed executable archive", async () => {
    const workspaceRoot = await createRoot("ipollowork-signed-plugin-workspace-");
    const packageRoot = await createRoot("ipollowork-signed-plugin-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writeSignedExecutablePackage(packageRoot);
    const upload = {
      archiveName: "signed-research.ipollowork-plugin",
      files: await Promise.all([
        "ipollowork.plugin.json",
        "service/signed-research.mjs",
        "skills/signed-research/SKILL.md",
      ].map(async (path) => ({ path, contentBase64: (await readFile(join(packageRoot, path))).toString("base64") }))),
    };
    const config = serverConfig(workspaceRoot);
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    try {
      const validation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify(upload),
      });
      expect(validation.status).toBe(200);
      expect(await validation.json()).toMatchObject({
        preview: {
          manifest: { id: "signed-research", source: { trusted: false } },
          integrity: { status: "verified" },
          safety: {
            level: "signed",
            localCode: true,
            publisher: { id: "smart-future-school", name: "智慧未来学校" },
            signature: { algorithm: "ed25519", keyId: "smart-future-school-2026", status: "verified" },
          },
        },
      });

      const installation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import`, {
        method: "POST",
        headers,
        body: JSON.stringify(upload),
      });
      expect(installation.status).toBe(200);
      expect(await installation.json()).toMatchObject({
        result: { status: "installed", pluginId: "signed-research", version: "1.0.0" },
        safety: { level: "signed", localCode: true },
      });
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "signed-research", "SKILL.md"), "utf8"))
        .toBe("# Signed Research\n");

      const call = await fetch(`${base}/experimental/extensions/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          extensionId: "signed-research",
          action: "ping",
          args: {},
          context: { directory: workspaceRoot },
        }),
      });
      expect(call.status).toBe(200);
      expect(await call.json()).toMatchObject({ result: { pong: true } });

      const removal = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/signed-research`, { method: "DELETE", headers });
      expect(removal.status).toBe(200);
      await expectMissing(join(workspaceRoot, ".opencode", "skills", "signed-research", "SKILL.md"));

      const tamperedManifest = JSON.parse(Buffer.from(upload.files[0]?.contentBase64 ?? "", "base64").toString("utf8"));
      tamperedManifest.package.signature.value = `${"A".repeat(86)}==`;
      const tamperedUpload = {
        ...upload,
        files: upload.files.map((file) => file.path === "ipollowork.plugin.json"
          ? { ...file, contentBase64: Buffer.from(JSON.stringify(tamperedManifest)).toString("base64") }
          : file),
      };
      const rejected = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/import/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify(tamperedUpload),
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ code: "plugin_package_signature_invalid" });
    } finally {
      await server.stop();
    }
  });

  test("lists and installs every bundled service plugin through the user catalog API", async () => {
    const workspaceRoot = await createRoot("ipollowork-figma-catalog-api-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    const figmaPackageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/figma", import.meta.url));
    const existingFigmaAgent = ".opencode/agents/design-parity-review-agent.md";
    const packagedFigmaAgent = "agents/design-parity-review-agent.md";
    await mkdir(join(workspaceRoot, ".opencode", "agents"), { recursive: true });
    await copyFile(join(figmaPackageRoot, packagedFigmaAgent), join(workspaceRoot, existingFigmaAgent));
    const config = serverConfig(workspaceRoot);
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    try {
      const catalog = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog`, { headers });
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toMatchObject({
        items: [
          { pluginId: "figma", version: "2.0.18", installedVersion: null, updateAvailable: false },
          { pluginId: "notion", version: "1.0.2", installedVersion: null, updateAvailable: false },
          { pluginId: "linear", version: "1.0.2", installedVersion: null, updateAvailable: false },
          { pluginId: "sentry", version: "1.0.2", installedVersion: null, updateAvailable: false },
          { pluginId: "stripe", version: "1.0.2", installedVersion: null, updateAvailable: false },
          { pluginId: "context7", version: "1.0.2", installedVersion: null, updateAvailable: false },
          { pluginId: "github", version: "0.1.3", installedVersion: null, updateAvailable: false },
          { pluginId: "wechat-official", version: "0.1.3", installedVersion: null, updateAvailable: false },
          { pluginId: "design-agent", version: "0.3.0", installedVersion: "0.3.0", updateAvailable: false },
          { pluginId: "video-agent", version: "0.3.0", installedVersion: "0.3.0", updateAvailable: false },
          { pluginId: "deepseek-harness", version: "0.3.7", installedVersion: null, updateAvailable: false },
        ],
      });

      const dshInstallation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/deepseek-harness/install`, {
        method: "POST",
        headers,
      });
      expect(dshInstallation.status).toBe(200);
      expect(await dshInstallation.json()).toMatchObject({
        result: { status: "installed", pluginId: "deepseek-harness", version: "0.3.7" },
      });
      const dshCapabilities = await fetch(`${base}/experimental/extensions/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          extensionId: "deepseek-harness",
          action: "capabilities",
          args: {},
          context: { directory: workspaceRoot },
        }),
      });
      expect(dshCapabilities.status).toBe(200);
      const dshDataDir = pluginServiceDataDirectory(config, WORKSPACE_ID, "deepseek-harness");
      expect(await stat(dshDataDir).then(() => true)).toBe(true);
      const dshRemoval = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/deepseek-harness`, {
        method: "DELETE",
        headers,
      });
      expect(dshRemoval.status).toBe(200);
      await expectMissing(dshDataDir);
      await expectMissing(join(workspaceRoot, ".opencode", "skills", "deepseek-harness", "SKILL.md"));

      const installation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/figma/install`, {
        method: "POST",
        headers,
      });
      expect(installation.status).toBe(200);
      expect(await installation.json()).toMatchObject({ result: { status: "installed", pluginId: "figma", version: "2.0.18" } });
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.figma).toEqual({
        type: "remote",
        url: "http://127.0.0.1:3845/mcp",
        enabled: true,
        oauth: false,
      });
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "figma-design-to-code", "SKILL.md"), "utf8"))
        .toContain("Implement a Figma Design as Code");
      await expectMissing(join(workspaceRoot, "README.md"));
      await expectMissing(join(workspaceRoot, "assets"));
      await expectMissing(join(workspaceRoot, ".opencode", "mcps", "figma.json"));

      const mcpServices = [
        { id: "notion", url: "https://mcp.notion.com/mcp", oauth: {}, skill: "notion-knowledge", heading: "# Notion Knowledge" },
        { id: "linear", url: "https://mcp.linear.app/mcp", oauth: {}, skill: "linear-triage", heading: "# Linear Triage" },
        { id: "sentry", url: "https://mcp.sentry.dev/mcp", oauth: {}, skill: "sentry-issue-investigation", heading: "# Sentry Issue Investigation" },
        { id: "stripe", url: "https://mcp.stripe.com", oauth: {}, skill: "stripe-payment-investigation", heading: "# Stripe Payment Investigation" },
        { id: "context7", url: "https://mcp.context7.com/mcp", oauth: false, skill: "context7-docs-research", heading: "# Context7 Documentation Research" },
      ];
      for (const service of mcpServices) {
        const serviceInstallation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/${service.id}/install`, {
          method: "POST",
          headers,
        });
        expect(serviceInstallation.status).toBe(200);
        expect(await serviceInstallation.json()).toMatchObject({
          result: { status: "installed", pluginId: service.id, version: "1.0.2" },
          item: { pluginId: service.id, manifest: { source: { trusted: true } } },
        });
        const runtimeMcp = (await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.[service.id];
        if (service.oauth === false) {
          expect(runtimeMcp).toEqual({ type: "remote", url: service.url, enabled: true, oauth: false });
        } else {
          expect(runtimeMcp).toMatchObject({
            type: "remote",
            enabled: true,
            oauth: false,
          });
          expect(runtimeMcp?.url).toMatch(new RegExp(`^${base}/mcp-proxy/${WORKSPACE_ID}/${service.id}\\?connection=mcp%3A`));
          expect((runtimeMcp?.headers as Record<string, unknown> | undefined)?.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{32,}$/);
          expect(runtimeMcp?.connectionId).toBeUndefined();
        }
        expect(await readFile(join(workspaceRoot, ".opencode", "skills", service.skill, "SKILL.md"), "utf8"))
          .toContain(service.heading);
        await expectMissing(join(workspaceRoot, ".opencode", "mcps", `${service.id}.json`));
      }

      const githubInstallation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/github/install`, {
        method: "POST",
        headers,
      });
      expect(githubInstallation.status).toBe(200);
      expect(await githubInstallation.json()).toMatchObject({
        result: { status: "installed", pluginId: "github", version: "0.1.3" },
        item: {
          pluginId: "github",
          manifest: {
            category: "开发与运维",
            authorization: { required: true },
          },
        },
      });
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "github", "SKILL.md"), "utf8"))
        .toContain("# GitHub");
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "github-publish-changes", "SKILL.md"), "utf8"))
        .toContain("# GitHub Publish Changes");
      const githubActions = await fetch(
        `${base}/experimental/extensions/actions?extensionId=github&directory=${encodeURIComponent(workspaceRoot)}`,
        { headers },
      );
      expect(githubActions.status).toBe(200);
      const githubActionsBody = await githubActions.json();
      expect(githubActionsBody.actions.find((action: { action: string }) => action.action === "repository-context"))
        .toMatchObject({ extensionId: "github", action: "repository-context", effect: "read" });
      expect(githubActionsBody.actions.find((action: { action: string }) => action.action === "create-pull-request"))
        .toMatchObject({ extensionId: "github", action: "create-pull-request", effect: "write" });

      const wechatInstallation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/wechat-official/install`, {
        method: "POST",
        headers,
      });
      expect(wechatInstallation.status).toBe(200);
      expect(await wechatInstallation.json()).toMatchObject({
        result: { status: "installed", pluginId: "wechat-official", version: "0.1.3" },
        item: {
          pluginId: "wechat-official",
          manifest: {
            name: "微信公众号",
            authorization: { required: true },
          },
        },
      });
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "wechat-official-comments", "SKILL.md"), "utf8"))
        .toContain("# 公众号评论运营");
      const wechatActions = await fetch(
        `${base}/experimental/extensions/actions?extensionId=wechat-official&directory=${encodeURIComponent(workspaceRoot)}`,
        { headers },
      );
      expect(wechatActions.status).toBe(200);
      const wechatActionsBody = await wechatActions.json();
      expect(wechatActionsBody.actions.find((action: { action: string }) => action.action === "reply-comment"))
        .toMatchObject({ extensionId: "wechat-official", action: "reply-comment", effect: "write" });
      expect(wechatActionsBody.actions.find((action: { action: string }) => action.action === "delete-comment"))
        .toMatchObject({ extensionId: "wechat-official", action: "delete-comment", effect: "destructive" });

      const disabled = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/figma/resources/figma-design-to-code`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: false }),
      });
      expect(disabled.status).toBe(200);
      expect(await disabled.json()).toMatchObject({
        result: { pluginId: "figma", resourceId: "figma-design-to-code", enabled: false, changed: true },
      });
      await expectMissing(join(workspaceRoot, ".opencode", "skills", "figma-design-to-code", "SKILL.md"));

      const enabled = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/figma/resources/figma-design-to-code`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: true }),
      });
      expect(enabled.status).toBe(200);
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "figma-design-to-code", "SKILL.md"), "utf8"))
        .toContain("Implement a Figma Design as Code");
    } finally {
      await server.stop();
    }
  });

  test("installs, toggles, removes, and restores complete creative workspace packages", async () => {
    const workspaceRoot = await createRoot("ipollowork-creative-agent-catalog-api-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    const designDirectory = join(workspaceRoot, "design", "existing-session");
    const videoDirectory = join(workspaceRoot, "video", "existing-session");
    const designEntry = join(designDirectory, "entry.html");
    const videoEntry = join(videoDirectory, "index.html");
    const videoSupportSkill = join(workspaceRoot, ".opencode", "skills", "hyperframes-cli", "SKILL.md");
    await mkdir(designDirectory, { recursive: true });
    await mkdir(videoDirectory, { recursive: true });
    await writeFile(designEntry, "<main>Existing design</main>\n", "utf8");
    await writeFile(videoEntry, "<div data-composition>Existing video</div>\n", "utf8");

    const config = serverConfig(workspaceRoot);
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    const packages = [
      {
        pluginId: "design-agent",
        version: "0.3.0",
        skillPath: join(workspaceRoot, ".opencode", "skills", "ipollowork-design-studio", "SKILL.md"),
        heading: "# iPolloWork Design Studio",
      },
      {
        pluginId: "video-agent",
        version: "0.3.0",
        skillPath: join(workspaceRoot, ".opencode", "skills", "ipollowork-video-studio", "SKILL.md"),
        heading: "# iPolloWork Video Studio",
      },
    ];

    try {
      const defaults = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages`, { headers });
      expect(defaults.status).toBe(200);
      expect((await defaults.json()).items).toEqual(expect.arrayContaining(
        packages.map((item) => expect.objectContaining({
          pluginId: item.pluginId,
          version: item.version,
          enabled: true,
        })),
      ));
      for (const item of packages) {
        expect(await readFile(item.skillPath, "utf8")).toContain(item.heading);
      }
      expect(await readFile(videoSupportSkill, "utf8")).toContain("# HyperFrames CLI");

      const disabled = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/design-agent/resources/ipollowork-design-studio`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: false }),
      });
      expect(disabled.status).toBe(200);
      await expectMissing(packages[0].skillPath);

      const enabled = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/design-agent/resources/ipollowork-design-studio`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: true }),
      });
      expect(enabled.status).toBe(200);
      expect(await readFile(packages[0].skillPath, "utf8")).toContain(packages[0].heading);

      const videoSkillDisabled = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/video-agent/resources/hyperframes-cli`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: false }),
      });
      expect(videoSkillDisabled.status).toBe(200);
      await expectMissing(videoSupportSkill);

      const videoSkillEnabled = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/video-agent/resources/hyperframes-cli`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: true }),
      });
      expect(videoSkillEnabled.status).toBe(200);
      expect(await readFile(videoSupportSkill, "utf8")).toContain("# HyperFrames CLI");

      for (const item of packages) {
        const removal = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/${item.pluginId}`, {
          method: "DELETE",
          headers,
        });
        expect(removal.status).toBe(200);
        await expectMissing(item.skillPath);
      }
      await expectMissing(videoSupportSkill);

      const afterRemoval = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages`, { headers });
      expect(afterRemoval.status).toBe(200);
      expect((await afterRemoval.json()).items.map((item: { pluginId: string }) => item.pluginId))
        .not.toEqual(expect.arrayContaining(packages.map((item) => item.pluginId)));

      for (const item of packages) {
        const installation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/${item.pluginId}/install`, {
          method: "POST",
          headers,
        });
        expect(installation.status).toBe(200);
        expect(await installation.json()).toMatchObject({
          result: { status: "installed", pluginId: item.pluginId, version: item.version },
        });
        expect(await readFile(item.skillPath, "utf8")).toContain(item.heading);
      }
      expect(await readFile(videoSupportSkill, "utf8")).toContain("# HyperFrames CLI");

      expect(await readFile(designEntry, "utf8")).toBe("<main>Existing design</main>\n");
      expect(await readFile(videoEntry, "utf8")).toBe("<div data-composition>Existing video</div>\n");
    } finally {
      await server.stop();
    }
  });

  test("registers bundled MCP resources and follows enable and uninstall lifecycle", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-mcp-");
    const packageRoot = await createRoot("ipollowork-plugin-mcp-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n", { mcp: true });
    const config = serverConfig(workspaceRoot);

    await lifecycle.installPluginPackage({ serverConfig: config, packageRoot });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toEqual({
      type: "remote",
      url: "https://mcp.acme.example/mcp",
    });

    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      enabled: false,
    });
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    expect((await lifecycle.listInstalledPluginPackages({ serverConfig: config }))[0]?.disabledResourceIds)
      .toEqual(["acme-skill"]);

    await lifecycle.setPluginPackageEnabled({ serverConfig: config, pluginId: "acme-research", enabled: false });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeUndefined();
    await lifecycle.setPluginPackageEnabled({ serverConfig: config, pluginId: "acme-research", enabled: true });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeDefined();
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));

    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      enabled: true,
    });
    expect(await readFile(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"), "utf8")).toBe("# Acme Research\n");

    await lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: "acme-research" });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeUndefined();
  });
});
