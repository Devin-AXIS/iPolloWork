import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_plugin_package";
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
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local" }],
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
  const pluginPath = ".opencode/plugins/acme-research.ts";
  const skillPath = ".opencode/skills/acme-research/SKILL.md";
  const mcpPath = ".opencode/mcps/acme-research.json";
  await mkdir(join(packageRoot, ".opencode", "plugins"), { recursive: true });
  await mkdir(join(packageRoot, ".opencode", "skills", "acme-research"), { recursive: true });
  await writeFile(join(packageRoot, pluginPath), runtimeText, "utf8");
  await writeFile(join(packageRoot, skillPath), skillText, "utf8");
  if (options.mcp) {
    await mkdir(join(packageRoot, ".opencode", "mcps"), { recursive: true });
    await writeFile(join(packageRoot, mcpPath), JSON.stringify({ type: "remote", url: "https://mcp.acme.example/mcp" }), "utf8");
  }
  const resources: Array<Record<string, unknown>> = [
    { type: "opencode-plugin", id: "acme-runtime", path: pluginPath, required: true },
    { type: "skill", id: "acme-skill", path: skillPath, required: true },
  ];
  if (options.mcp) resources.push({ type: "mcp", id: "acme-mcp", mcpServerName: "acme-research", path: mcpPath, required: true });
  await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({
    schemaVersion: 1,
    id: "acme-research",
    name: "Acme Research",
    description: "Self-contained research plugin.",
    source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: {
      version,
      updateId: "acme/research",
      entrypoints: { opencode: pluginPath },
    },
    authorization: {
      required: true,
      methods: [{
        id: "api-key",
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
  manifest.package.entrypoints = {};
  delete manifest.authorization;
  manifest.resources = manifest.resources.filter((resource: { type?: string }) => resource.type === "skill");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function expectMissing(path: string) {
  await expect(stat(path)).rejects.toThrow();
}

afterEach(async () => {
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("plugin package lifecycle", () => {
  test("previews the complete Figma package and every bundled workflow file", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-figma-preview-workspace-");
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/figma", import.meta.url));

    const preview = await lifecycle.previewPluginPackage({ packageRoot, workspaceRoot });

    expect(preview.manifest.id).toBe("figma");
    expect(preview.files.length).toBeGreaterThan(100);
    expect(preview.files.some((entry) => entry.path === ".opencode/mcps/figma.json")).toBe(true);
    expect(preview.writes.some((entry) => entry.path === ".opencode/skills/figma-use/references/plugin-api-standalone.d.ts")).toBe(true);
    expect(preview.writes.some((entry) => entry.path === "README.md")).toBe(false);
    expect(preview.writes.some((entry) => entry.path === ".opencode/mcps/figma.json")).toBe(false);
  });

  test("expands directory resources into owned files without duplicates", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-directory-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-directory-package-");
    const skillRoot = join(packageRoot, ".opencode", "skills", "figma");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "# Figma\n", "utf8");
    await writeFile(join(skillRoot, "references", "api.md"), "# API\n", "utf8");
    await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({
      schemaVersion: 1,
      id: "figma",
      name: "Figma",
      description: "Figma workflows.",
      source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
      package: { version: "1.0.0", updateId: "figma/workflows", entrypoints: {} },
      resources: [
        { type: "skill", id: "figma-skill", path: ".opencode/skills/figma/SKILL.md", required: true },
        { type: "file", id: "figma-skill-files", path: ".opencode/skills/figma", required: true },
      ],
    }), "utf8");

    const preview = await lifecycle.previewPluginPackage({ packageRoot, workspaceRoot });

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

    const preview = await lifecycle.previewPluginPackage({ packageRoot, workspaceRoot });
    expect(preview.writes.map((entry) => entry.path).sort()).toEqual([
      ".opencode/skills/acme-research/SKILL.md",
    ]);
    expect(preview.files.map((entry) => entry.path).sort()).toEqual([
      ".opencode/plugins/acme-research.ts",
      ".opencode/skills/acme-research/SKILL.md",
    ]);

    const installed = await lifecycle.installPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    const repeated = await lifecycle.installPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    expect(installed).toMatchObject({ status: "installed", pluginId: "acme-research", version: "1.0.0" });
    expect(repeated).toMatchObject({ status: "unchanged", pluginId: "acme-research", version: "1.0.0" });
    expect(await readFile(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"), "utf8")).toBe("# Acme Research\n");
    const installedSpec = (await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin?.[0] ?? "";
    expect(installedSpec).toContain("/plugin-packages/ws_plugin_package/artifacts/acme-research/1.0.0/");
    expect(installedSpec).not.toContain(`${workspaceRoot}/.opencode/plugins`);

    await lifecycle.uninstallPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot });
    await expectMissing(join(workspaceRoot, ".opencode", "plugins", "acme-research.ts"));
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    expect(await readFile(join(workspaceRoot, "unrelated.txt"), "utf8")).toBe("keep me");
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin).toEqual([]);
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

    await lifecycle.installPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot: packageV1, workspaceRoot });
    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      workspaceId: WORKSPACE_ID,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      workspaceRoot,
      enabled: false,
    });
    const updated = await lifecycle.updatePluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot: packageV2, workspaceRoot });
    expect(updated).toMatchObject({ status: "updated", previousVersion: "1.0.0", version: "1.1.0" });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin?.[0]).toContain("/1.1.0/");
    await expectMissing(join(workspaceRoot, ".opencode", "plugins", "acme-research.ts"));
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));

    const rolledBack = await lifecycle.rollbackPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot });
    expect(rolledBack).toMatchObject({ status: "rolled_back", previousVersion: "1.1.0", version: "1.0.0" });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin?.[0]).toContain("/1.0.0/");
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));

    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      workspaceId: WORKSPACE_ID,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      workspaceRoot,
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

    await lifecycle.installPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot: packageV1, workspaceRoot });
    const target = join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md");
    await writeFile(target, "# User customization\n", "utf8");

    await expect(lifecycle.updatePluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot: packageV2, workspaceRoot })).rejects.toMatchObject({
      code: "plugin_package_conflict",
    });
    expect(await readFile(target, "utf8")).toBe("# User customization\n");
  });

  test("reports unsigned packages and rejects a declared checksum mismatch", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-integrity-");
    const packageRoot = await createRoot("ipollowork-plugin-integrity-package-");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n");

    const unsigned = await lifecycle.previewPluginPackage({ packageRoot, workspaceRoot });
    expect(unsigned.integrity.status).toBe("unsigned");
    expect(unsigned.integrity.sha256).toMatch(/^[a-f0-9]{64}$/);

    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.description = "Changed package metadata";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const changed = await lifecycle.previewPluginPackage({ packageRoot, workspaceRoot });
    expect(changed.integrity.sha256).not.toBe(unsigned.integrity.sha256);

    manifest.package.checksum = { algorithm: "sha256", value: "0".repeat(64) };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await expect(lifecycle.previewPluginPackage({ packageRoot, workspaceRoot })).rejects.toMatchObject({
      code: "plugin_package_checksum_mismatch",
    });

    delete manifest.package.checksum;
    manifest.package.compatibility = { ipollowork: ">=99.0.0" };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await expect(lifecycle.previewPluginPackage({ packageRoot, workspaceRoot })).rejects.toMatchObject({
      code: "plugin_package_incompatible",
    });
  });

  test("allows remote HTTPS MCP imports but blocks local MCP commands", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-safe-mcp-workspace-");
    const packageRoot = await createRoot("ipollowork-plugin-safe-mcp-package-");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n", { mcp: true });
    const manifestPath = join(packageRoot, "ipollowork.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.package.entrypoints = {};
    delete manifest.authorization;
    manifest.resources = manifest.resources.filter((resource: { type?: string }) => resource.type !== "opencode-plugin");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const remotePreview = await lifecycle.previewPluginPackage({ packageRoot, workspaceRoot });
    expect(await lifecycle.assertPluginPackageSafeForImport({ packageRoot, preview: remotePreview }))
      .toMatchObject({ level: "declarative", localCode: false });

    await writeFile(
      join(packageRoot, ".opencode", "mcps", "acme-research.json"),
      JSON.stringify({ type: "local", command: ["node", "malicious.mjs"] }),
      "utf8",
    );
    const localPreview = await lifecycle.previewPluginPackage({ packageRoot, workspaceRoot });
    await expect(lifecycle.assertPluginPackageSafeForImport({ packageRoot, preview: localPreview })).rejects.toMatchObject({
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
        details: { reasons: expect.arrayContaining([expect.stringContaining("executable entrypoints")]) },
      });
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
    const skill = await readFile(join(packageRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    const upload = {
      archiveName: "acme-research.zip",
      files: [
        { path: "ipollowork.plugin.json", contentBase64: manifest.toString("base64") },
        { path: ".opencode/skills/acme-research/SKILL.md", contentBase64: skill.toString("base64") },
      ],
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
          manifest: { id: "acme-research" },
          safety: { level: "declarative", localCode: false },
          writes: [{ path: ".opencode/skills/acme-research/SKILL.md" }],
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

      const removal = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research`, { method: "DELETE", headers });
      expect(removal.status).toBe(200);
      expect(await (await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages`, { headers })).json()).toEqual({ items: [] });
    } finally {
      await server.stop();
    }
  });

  test("lists and installs the bundled Figma, GitHub, and WeChat Official Account packages through the user catalog API", async () => {
    const workspaceRoot = await createRoot("ipollowork-figma-catalog-api-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    const config = serverConfig(workspaceRoot);
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    try {
      const catalog = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog`, { headers });
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toMatchObject({
        items: [
          { pluginId: "figma", version: "2.0.13", installedVersion: null, updateAvailable: false },
          { pluginId: "github", version: "0.1.0", installedVersion: null, updateAvailable: false },
          { pluginId: "wechat-official", version: "0.1.0", installedVersion: null, updateAvailable: false },
        ],
      });

      const installation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/figma/install`, {
        method: "POST",
        headers,
      });
      expect(installation.status).toBe(200);
      expect(await installation.json()).toMatchObject({ result: { status: "installed", pluginId: "figma", version: "2.0.13" } });
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.figma).toEqual({
        type: "remote",
        url: "https://mcp.figma.com/mcp",
        enabled: true,
        oauth: {},
      });
      expect(await readFile(join(workspaceRoot, ".opencode", "skills", "figma-design-to-code", "SKILL.md"), "utf8"))
        .toContain("Implement a Figma Design as Code");
      await expectMissing(join(workspaceRoot, "README.md"));
      await expectMissing(join(workspaceRoot, "assets"));
      await expectMissing(join(workspaceRoot, ".opencode", "mcps", "figma.json"));

      const githubInstallation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/catalog/github/install`, {
        method: "POST",
        headers,
      });
      expect(githubInstallation.status).toBe(200);
      expect(await githubInstallation.json()).toMatchObject({
        result: { status: "installed", pluginId: "github", version: "0.1.0" },
        item: {
          pluginId: "github",
          manifest: {
            category: "开发者工具",
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
        result: { status: "installed", pluginId: "wechat-official", version: "0.1.0" },
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

  test("registers bundled MCP resources and follows enable and uninstall lifecycle", async () => {
    const lifecycle = await import("./plugin-package-lifecycle.js");
    const workspaceRoot = await createRoot("ipollowork-plugin-mcp-");
    const packageRoot = await createRoot("ipollowork-plugin-mcp-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePackage(packageRoot, "1.0.0", "export default async () => ({})\n", "# Acme Research\n", { mcp: true });
    const config = serverConfig(workspaceRoot);

    await lifecycle.installPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toEqual({
      type: "remote",
      url: "https://mcp.acme.example/mcp",
    });

    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      workspaceId: WORKSPACE_ID,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      workspaceRoot,
      enabled: false,
    });
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));
    expect((await lifecycle.listInstalledPluginPackages({ serverConfig: config, workspaceId: WORKSPACE_ID }))[0]?.disabledResourceIds)
      .toEqual(["acme-skill"]);

    await lifecycle.setPluginPackageEnabled({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot, enabled: false });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeUndefined();
    await lifecycle.setPluginPackageEnabled({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot, enabled: true });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeDefined();
    await expectMissing(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"));

    await lifecycle.setPluginPackageResourceEnabled({
      serverConfig: config,
      workspaceId: WORKSPACE_ID,
      pluginId: "acme-research",
      resourceId: "acme-skill",
      workspaceRoot,
      enabled: true,
    });
    expect(await readFile(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"), "utf8")).toBe("# Acme Research\n");

    await lifecycle.uninstallPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeUndefined();
  });
});
