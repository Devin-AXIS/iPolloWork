import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPluginPackage, prepareDevelopmentPluginPackage, listInstalledPluginPackages, readInstalledPluginUiResource, setPluginPackageResourceEnabled, setPluginPackageEnabled, uninstallPluginPackage } from "./plugin-package-lifecycle.js";
import { runtimeCatalogPluginPackageIds, withPluginPackageCatalogRoot } from "./plugin-package-catalog.js";
import { callPluginServiceAction, disposePluginServices, pluginServiceDataDirectory } from "./plugin-service-runtime.js";
import { disposeRuntimeOpencodeConfigStore } from "./runtime-opencode-config-store.js";
import { disposeiPolloWorkWorkspaceConfigStore } from "./ipollowork-workspace-config-store.js";
import { startServer } from "./server.js";
import { fileURLToPath } from "node:url";
import { catalogPluginPackageIds } from "./plugin-package-catalog.js";
import type { ServerConfig } from "./types.js";

const original = { ...process.env };
const roots: string[] = [];
afterEach(async () => {
  for (const key of ["IPOLLOWORK_DEV_MODE", "IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR", "IPOLLOWORK_RUNTIME_DB", "IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR"]) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
  for (const root of roots.splice(0)) {
    try { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) {
      // Bun's Windows module loader can hold imported service files until exit.
      if (process.platform !== "win32" || !error || typeof error !== "object" || !("code" in error) || !["EBUSY", "EPERM"].includes(String(error.code))) throw error;
    }
  }
});

test("development refreshes same-version local service, UI and skills while preserving switches and data", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-plugin-dev-")); roots.push(root);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "token", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [{ id: "ws_dev", name: "Dev", path: join(root, "workspace"), preset: "starter", workspaceType: "local", engineId: "opencode" }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.IPOLLOWORK_DEV_MODE = "1";
  process.env.IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR = join(root, "packages");
  const source = join(root, "packages/figma");
  for (const dir of ["service", "ui", "skills/dev"]) await mkdir(join(source, dir), { recursive: true });
  await mkdir(config.workspaces[0].path, { recursive: true });
  const manifest = { schemaVersion: 2, id: "figma", name: "Dev fixture", description: "Local development test", source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false }, package: { version: "1.0.0", publisher: { id: "fixture", name: "Fixture" }, updateId: "fixture/figma" }, resources: [{ id: "service", type: "local-service", path: "service/main.mjs", actions: [{ id: "ping", title: "Ping", description: "Read revision", effect: "read" }] }, { id: "ui", type: "ui", path: "ui/main.html", ui: { uri: "ui://figma/main", mimeType: "text/html;profile=mcp-app" } }, { id: "dev-skill", type: "skill", path: "skills/dev/SKILL.md" }] };
  await writeFile(join(source, "ipollowork.plugin.json"), JSON.stringify(manifest));
  const writeRevision = async (revision: number) => {
    await writeFile(join(source, "service/main.mjs"), `export default () => ({ actions: { ping: () => ${revision} } });`);
    await writeFile(join(source, "ui/main.html"), `<html>revision ${revision}</html>`);
    await writeFile(join(source, "skills/dev/SKILL.md"), `---\nname: dev\ndescription: Local test\n---\nRevision ${revision}\n`);
  };
  const ping = () => callPluginServiceAction({ config, workspaceId: "ws_dev", pluginId: "figma", action: "ping", args: {}, context: {} });
  try {
    await writeRevision(1);
    await prepareDevelopmentPluginPackage(config, "figma");
    const initial = (await listInstalledPluginPackages({ serverConfig: config }))[0];
    expect(initial.version).toStartWith("1.0.0+dev."); expect((await ping()).result).toBe(1);
    const data = pluginServiceDataDirectory(config, "ws_dev", "figma"); await mkdir(data, { recursive: true }); await writeFile(join(data, "user-data"), "retained");
    await setPluginPackageResourceEnabled({ serverConfig: config, pluginId: "figma", resourceId: "dev-skill", enabled: false });
    await setPluginPackageEnabled({ serverConfig: config, pluginId: "figma", enabled: false });
    await writeRevision(2);
    await prepareDevelopmentPluginPackage(config, "figma");
    const updated = (await listInstalledPluginPackages({ serverConfig: config }))[0];
    expect(updated.version).not.toBe(initial.version); expect(updated.enabled).toBe(false);
    expect(updated.disabledResourceIds).toEqual(["dev-skill"]);
    await setPluginPackageResourceEnabled({ serverConfig: config, pluginId: "figma", resourceId: "dev-skill", enabled: true });
    await setPluginPackageEnabled({ serverConfig: config, pluginId: "figma", enabled: true });
    expect((await ping()).result).toBe(2);
    expect((await readInstalledPluginUiResource({ serverConfig: config, pluginId: "figma", resourceId: "ui" })).html).toContain("revision 2");
    expect(await readFile(join(config.workspaces[0].path, ".opencode/skills/dev/SKILL.md"), "utf8")).toContain("Revision 2");
    expect(await readFile(join(data, "user-data"), "utf8")).toBe("retained");
    process.env.IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR = join(root, "packages");
    const cloudRoot = join(root, "cloud-import");
    await cp(source, cloudRoot, { recursive: true });
    await expect(installPluginPackage({ serverConfig: config, packageRoot: cloudRoot })).rejects.toMatchObject({ code: "plugin_development_source_owned" });
    // Production ignores the checkout even if the configured source path leaks.
    delete process.env.IPOLLOWORK_DEV_MODE;
    await writeRevision(3);
    expect(runtimeCatalogPluginPackageIds()).toEqual(catalogPluginPackageIds);
    expect(runtimeCatalogPluginPackageIds()).toContain("plugin-workshop");
    expect(runtimeCatalogPluginPackageIds()).not.toContain("labelu-data-annotation");
    expect(await withPluginPackageCatalogRoot("figma", async () => true)).toBe(true);
    await expect(prepareDevelopmentPluginPackage(config, "figma")).rejects.toMatchObject({ code: "plugin_development_only" });
    expect((await ping()).result).toBe(2);
    process.env.IPOLLOWORK_DEV_MODE = "1";
    await disposePluginServices(config, "ws_dev", "figma");
    await uninstallPluginPackage({ serverConfig: config, pluginId: "figma" });
    await prepareDevelopmentPluginPackage(config, "figma");
    expect(await listInstalledPluginPackages({ serverConfig: config })).toHaveLength(0);
  } finally {
    await disposePluginServices(config, "ws_dev", "figma");
    await disposeRuntimeOpencodeConfigStore(config);
    await disposeiPolloWorkWorkspaceConfigStore(config);
  }
});


test("real server startup keeps local development inventory separate from a fresh production host", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-plugin-profiles-")); roots.push(root);
  delete process.env.IPOLLOWORK_RUNTIME_DB;
  delete process.env.IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR;
  for (const mode of ["development", "production"]) {
    const profile = join(root, mode);
    await mkdir(profile, { recursive: true });
    const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "token", hostToken: "host", configPath: join(profile, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [{ id: "ws_profiles", name: mode, path: profile, preset: "starter", workspaceType: "local", engineId: "opencode" }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
    if (mode === "development") process.env.IPOLLOWORK_DEV_MODE = "1";
    else delete process.env.IPOLLOWORK_DEV_MODE;
    // Even a leaked local source path cannot enable production source loading.
    process.env.IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR = fileURLToPath(new URL("../../../examples/plugin-packages", import.meta.url));
    const server = await startServer(config);
    try {
      const base = `http://127.0.0.1:${server.port}/workspace/ws_profiles/plugin-packages`;
      const headers = { authorization: "Bearer token" };
      const response = await fetch(base, { headers });
      expect(response.status).toBe(200);
      const inventory = await response.json();
      if (mode === "development") {
        expect(inventory.items.map((item: {pluginId: string}) => item.pluginId).sort()).toEqual([...catalogPluginPackageIds].sort());
        expect(inventory.items.every((item: {version: string}) => item.version.includes("+dev."))).toBe(true);
      } else {
        expect(inventory.items).toEqual([]);
        const catalog = await fetch(base + "/catalog", { headers });
        expect(await catalog.json()).toEqual({ items: [], errors: [] });
        const localInstall = await fetch(base + "/catalog/figma/install", { method: "POST", headers });
        expect(localInstall.status).toBe(404);
      }
    } finally { await server.stop(); }
  }
}, 60000);

test("production local catalog installs, updates and uninstalls independently of online plugins", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-local-catalog-")); roots.push(root);
  delete process.env.IPOLLOWORK_DEV_MODE;
  delete process.env.IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR;
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR = join(root, "packages");
  const packageRoot = join(root, "packages/figma");
  await mkdir(join(packageRoot, "skills/local"), { recursive: true });
  const manifest = { schemaVersion: 2, id: "figma", name: "Local fixture", description: "Local collection test",
    source: { format: "ipollowork-extension-manifest", origin: "builtin", trusted: true },
    package: { version: "1.0.0", updateId: "fixture/local-figma" }, resources: [{ id: "local", type: "skill", path: "skills/local/SKILL.md" }] };
  const writeVersion = async (version: string) => {
    await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({ ...manifest, package: { ...manifest.package, version } }));
    await writeFile(join(packageRoot, "skills/local/SKILL.md"), "# Local\n" + version + "\n");
  };
  await writeVersion("1.0.0");
  // A package left on disk by another checkout must not join this branch's catalog.
  const branchPackageRoot = join(root, "packages/labelu-data-annotation");
  await cp(packageRoot, branchPackageRoot, { recursive: true });
  await writeFile(join(branchPackageRoot, "ipollowork.plugin.json"), JSON.stringify({
    ...manifest, id: "labelu-data-annotation", name: "Data-label workbenches", package: { version: "1.0.0" },
  }));
  const workspace = join(root, "workspace"); await mkdir(workspace);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "token", hostToken: "host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [{ id: "ws_local", name: "Local", path: workspace, preset: "starter", workspaceType: "local", engineId: "opencode" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  const base = `http://127.0.0.1:${server.port}/workspace/ws_local/plugin-packages`;
  const headers = { authorization: "Bearer token" };
  try {
    const catalog = await (await fetch(base + "/catalog", { headers })).json();
    expect(catalog.errors).toEqual([]);
    expect(catalog.items).toEqual([expect.objectContaining({ pluginId: "figma", installedVersion: "1.0.0" })]);
    const branchInstall = await fetch(base + "/catalog/labelu-data-annotation/install", { method: "POST", headers });
    expect(branchInstall.status).toBe(404);
    expect(await branchInstall.json()).toMatchObject({ code: "plugin_package_catalog_not_found" });
    expect((await fetch(base + "/catalog/figma/install", { method: "POST", headers })).status).toBe(200);
    await writeVersion("1.1.0");
    const projection = join(workspace, ".opencode/skills/local/SKILL.md");
    const originalSkill = await readFile(projection, "utf8");
    await writeFile(projection, "# User-owned customization\n");
    const conflictedInventory = await fetch(base, { headers });
    expect(conflictedInventory.status).toBe(200);
    expect((await conflictedInventory.json()).items).toEqual([expect.objectContaining({ pluginId: "figma", version: "1.0.0" })]);
    const conflictedCatalog = await fetch(base + "/catalog", { headers });
    expect(conflictedCatalog.status).toBe(200);
    expect((await conflictedCatalog.json()).items[0].pluginId).toBe("figma");
    const conflictedUpdate = await fetch(base + "/catalog/figma/install", { method: "POST", headers });
    expect(conflictedUpdate.status).toBe(409);
    expect((await conflictedUpdate.json()).code).toBe("plugin_package_conflict");
    expect(await readFile(projection, "utf8")).toBe("# User-owned customization\n");
    await writeFile(projection, originalSkill);
    expect((await (await fetch(base + "/catalog", { headers })).json()).items[0].updateAvailable).toBe(true);
    expect((await fetch(base + "/catalog/figma/install", { method: "POST", headers })).status).toBe(200);
    expect((await (await fetch(base, { headers })).json()).items[0].version).toBe("1.1.0");
    expect((await fetch(base + "/figma", { method: "DELETE", headers })).status).toBe(200);
    expect((await (await fetch(base, { headers })).json()).items).toEqual([]);
    expect((await (await fetch(base + "/catalog", { headers })).json()).items[0].installedVersion).toBeNull();
  } finally { await server.stop(); }
});
