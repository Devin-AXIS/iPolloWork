import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      ".opencode/plugins/acme-research.ts",
      ".opencode/skills/acme-research/SKILL.md",
    ]);

    const installed = await lifecycle.installPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    const repeated = await lifecycle.installPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    expect(installed).toMatchObject({ status: "installed", pluginId: "acme-research", version: "1.0.0" });
    expect(repeated).toMatchObject({ status: "unchanged", pluginId: "acme-research", version: "1.0.0" });
    expect(await readFile(join(workspaceRoot, ".opencode", "skills", "acme-research", "SKILL.md"), "utf8")).toBe("# Acme Research\n");
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin).toEqual([
      `file://${join(workspaceRoot, ".opencode", "plugins", "acme-research.ts")}`,
    ]);

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
    const updated = await lifecycle.updatePluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot: packageV2, workspaceRoot });
    expect(updated).toMatchObject({ status: "updated", previousVersion: "1.0.0", version: "1.1.0" });
    expect(await readFile(join(workspaceRoot, ".opencode", "plugins", "acme-research.ts"), "utf8")).toContain("'v2'");

    const rolledBack = await lifecycle.rollbackPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot });
    expect(rolledBack).toMatchObject({ status: "rolled_back", previousVersion: "1.1.0", version: "1.0.0" });
    expect(await readFile(join(workspaceRoot, ".opencode", "plugins", "acme-research.ts"), "utf8")).toContain("'v1'");
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
    const target = join(workspaceRoot, ".opencode", "plugins", "acme-research.ts");
    await writeFile(target, "// user customization\n", "utf8");

    await expect(lifecycle.updatePluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, packageRoot: packageV2, workspaceRoot })).rejects.toMatchObject({
      code: "plugin_package_conflict",
    });
    expect(await readFile(target, "utf8")).toBe("// user customization\n");
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

  test("exposes validate, install, redacted authorization, and uninstall through the server API", async () => {
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
      expect(validation.status).toBe(200);
      const validationBody = await validation.json();
      expect(validationBody).toMatchObject({ preview: { manifest: { id: "acme-research" } } });
      expect(validationBody.preview.writes.map((entry: { path: string }) => entry.path)).toEqual([
        ".opencode/plugins/acme-research.ts",
        ".opencode/skills/acme-research/SKILL.md",
      ]);

      const installation = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ packageRoot: "packages/acme-research" }),
      });
      expect(installation.status).toBe(200);
      expect(await installation.json()).toMatchObject({ result: { status: "installed", pluginId: "acme-research" } });

      const saved = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research/authorization/api-key/credentials`, {
        method: "POST",
        headers,
        body: JSON.stringify({ accountId: "personal", values: { apiKey: "api-route-super-secret" } }),
      });
      expect(saved.status).toBe(200);
      expect(JSON.stringify(await saved.json())).not.toContain("api-route-super-secret");

      const authorization = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research/authorization`, { headers });
      expect(authorization.status).toBe(200);
      const authorizationBody = JSON.stringify(await authorization.json());
      expect(authorizationBody).toContain('"status":"connected"');
      expect(authorizationBody).not.toContain("api-route-super-secret");
      expect(await readFile(join(workspaceRoot, "plugin-authorization", `${WORKSPACE_ID}.vault`), "utf8")).not.toContain("api-route-super-secret");

      const removal = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages/acme-research`, { method: "DELETE", headers });
      expect(removal.status).toBe(200);
      const list = await fetch(`${base}/workspace/${WORKSPACE_ID}/plugin-packages`, { headers });
      expect(await list.json()).toEqual({ items: [] });
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

    await lifecycle.setPluginPackageEnabled({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot, enabled: false });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeUndefined();
    await lifecycle.setPluginPackageEnabled({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot, enabled: true });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeDefined();

    await lifecycle.uninstallPluginPackage({ serverConfig: config, workspaceId: WORKSPACE_ID, pluginId: "acme-research", workspaceRoot });
    expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.["acme-research"]).toBeUndefined();
  });
});
