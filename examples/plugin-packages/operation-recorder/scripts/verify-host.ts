import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, realpath, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ServerConfig } from "../../../../apps/server/src/types.ts";
import type { PluginPackageUpload } from "../../../../apps/server/src/plugin-package-upload.ts";

// Host modules and JSZip are read from the selected checkout. Every mutable
// host config, credential vault, package snapshot and workspace lives in temp.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selectedHostRoot = process.env.IPOLLOWORK_PLUGIN_HOST_ROOT;
assert.ok(selectedHostRoot, "Set IPOLLOWORK_PLUGIN_HOST_ROOT to an existing iPolloWork checkout");
const hostRoot = resolve(selectedHostRoot);
const sourceManifest = object(JSON.parse(await readFile(join(pluginRoot, "ipollowork.plugin.json"), "utf8")), "Source manifest");
const sourcePackageMetadata = object(sourceManifest.package, "Source package metadata");
const archivePath = resolve(process.env.IPOLLOWORK_PLUGIN_ARCHIVE ?? join(pluginRoot, `dist/${string(sourceManifest.id, "Plugin ID")}-${string(sourcePackageMetadata.version, "Plugin version")}.ipollowork-plugin`));
const sourcePackage = join(pluginRoot, "dist/package");
const isolatedRoot = await realpath(await mkdtemp(join(tmpdir(), "ipollowork-operation-recorder-host-")));
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;
process.env.IPOLLOWORK_RUNTIME_DB = join(isolatedRoot, "runtime.sqlite");

type ZipEntry = { dir: boolean; async(format: "nodebuffer"): Promise<Buffer> };
type ZipLibrary = { loadAsync(content: Buffer, options: { checkCRC32: boolean }): Promise<{ files: Record<string, ZipEntry> }> };
const hostRequire = createRequire(join(hostRoot, "apps/app/package.json"));
const zip: ZipLibrary = hostRequire("jszip");
const moduleUrl = (name: string) => pathToFileURL(join(hostRoot, "apps/server/src", `${name}.ts`)).href;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${label} must be an object`);
  return value;
}

function string(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} must be text`);
  assert.ok(typeof value === "string");
  return value;
}

async function archiveUpload(path: string): Promise<PluginPackageUpload> {
  const archive = await zip.loadAsync(await readFile(path), { checkCRC32: true });
  const files = await Promise.all(Object.entries(archive.files).filter(([, entry]) => !entry.dir).map(async ([path, entry]) => ({
    path, contentBase64: (await entry.async("nodebuffer")).toString("base64"),
  })));
  return { archiveName: basename(path), files };
}

async function missing(path: string): Promise<void> {
  await assert.rejects(access(path), { code: "ENOENT" });
}

const engineTargets = [
  { id: "opencode", directory: ".opencode" },
  { id: "deepseek-harness", directory: ".dsh" },
  { id: "codex-harness", directory: ".agents" },
];
const config: ServerConfig = {
  host: "127.0.0.1", port: 0, token: randomUUID(), hostToken: randomUUID(),
  configPath: join(isolatedRoot, "server.json"), approval: { mode: "auto", timeoutMs: 0 },
  corsOrigins: [], workspaces: engineTargets.map((engine) => ({
    id: `ws_verify_${engine.id.replaceAll("-", "_")}`, name: engine.id,
    path: join(isolatedRoot, "workspaces", engine.id), preset: "starter", workspaceType: "local", engineId: engine.id,
  })), authorizedRoots: [isolatedRoot], readOnly: false, startedAt: Date.now(),
  tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
};

const evidence: Record<string, unknown> = {
  schemaVersion: 1, hostRoot, archivePath, isolated: true,
  evidenceLevel: "host-package-lifecycle-and-loopback-http", desktopCaptureTested: false,
};
let dispose: (() => Promise<void>) | undefined;
try {
  const lifecycle: typeof import("../../../../apps/server/src/plugin-package-lifecycle.ts") = await import(moduleUrl("plugin-package-lifecycle"));
  const manifestModule: typeof import("../../../../apps/server/src/plugin-package-manifest.ts") = await import(moduleUrl("plugin-package-manifest"));
  const adapterModule: typeof import("../../../../apps/server/src/plugin-engine-adapter.ts") = await import(moduleUrl("plugin-engine-adapter"));
  const uploadModule: typeof import("../../../../apps/server/src/plugin-package-upload.ts") = await import(moduleUrl("plugin-package-upload"));
  const services: typeof import("../../../../apps/server/src/plugin-service-runtime.ts") = await import(moduleUrl("plugin-service-runtime"));
  const configStore: typeof import("../../../../apps/server/src/ipollowork-workspace-config-store.ts") = await import(moduleUrl("ipollowork-workspace-config-store"));
  const opencodeStore: typeof import("../../../../apps/server/src/runtime-opencode-config-store.ts") = await import(moduleUrl("runtime-opencode-config-store"));
  dispose = async () => {
    await services.disposeAllPluginServices(config);
    await configStore.disposeiPolloWorkWorkspaceConfigStore(config);
    await opencodeStore.disposeRuntimeOpencodeConfigStore(config);
  };
  await Promise.all(config.workspaces.map((workspace) => mkdir(workspace.path, { recursive: true })));
  const manifestValue: unknown = JSON.parse(await readFile(join(sourcePackage, "ipollowork.plugin.json"), "utf8"));
  const validation = manifestModule.validatePluginPackageManifest(manifestValue);
  assert.ok(validation.success, "Built manifest must satisfy the host's complete package schema");
  const manifest = validation.manifest;
  assert.equal(manifest.id, "operation-recorder");
  assert.equal(manifest.package?.engines, undefined, "Recorder must remain portable");
  assert.equal(manifest.engineBindings, undefined, "Recorder must not require native engine bindings");
  const sourcePreview = await lifecycle.previewPluginPackage({ packageRoot: sourcePackage });
  evidence.sourceResources = sourcePreview.files.map((file) => file.path);
  const signedUpload = uploadModule.parsePluginPackageUpload(await archiveUpload(archivePath));
  await uploadModule.withMaterializedPluginPackageUpload(signedUpload, "install", async ({ packageRoot }) => {
    const signedPreview = await lifecycle.previewPluginPackage({ packageRoot });
    const signedSafety = await lifecycle.assertPluginPackageSafeForImport({ packageRoot, preview: signedPreview, purpose: "install" });
    assert.equal(signedSafety.level, "signed");
    assert.equal(signedSafety.localCode, true);
    assert.equal(signedPreview.integrity.status, "verified");
    assert.deepEqual(signedPreview.files, sourcePreview.files, "Signed archive must contain exactly the built resources");
    evidence.signedPackage = { pluginId: manifest.id, version: signedPreview.manifest.package?.version,
      checksum: signedPreview.integrity, signature: signedSafety.signature, publisher: signedSafety.publisher };
    const compatibility = engineTargets.map((engine) => adapterModule.pluginEngineCompatibility(adapterModule.pluginEngineAdapters.get(engine.id), signedPreview.manifest));
    for (const engine of compatibility) assert.equal(engine.status, "ready", `${engine.engineId} must support every required recorder resource`);
    evidence.engineCompatibility = compatibility;
    const install = await lifecycle.installPluginPackage({ serverConfig: config, packageRoot });
    assert.equal(install.status, "installed");
    const recorderSkill = await readFile(join(packageRoot, "skills/record-operations/SKILL.md"), "utf8");
    for (const [index, engine] of engineTargets.entries()) {
      const workspace = config.workspaces[index];
      assert.ok(workspace);
      assert.equal(await readFile(join(workspace.path, engine.directory, "skills/record-operations/SKILL.md"), "utf8"), recorderSkill);
    }
    const workspace = config.workspaces[0];
    assert.ok(workspace);
    const call = async (action: string, args: Record<string, unknown> = {}) => (await services.callPluginServiceAction({
      config, workspaceId: workspace.id, pluginId: manifest.id, action, args,
      context: { workspaceId: workspace.id, directory: workspace.path, sessionId: "ses_recorder_host_verification" },
    })).result;
    const workbench = object(await call("open-workbench"), "Workbench result");
    const launchUrl = new URL(string(workbench.url, "Workbench URL"));
    assert.equal(launchUrl.hostname, "127.0.0.1");
    const token = new URLSearchParams(launchUrl.hash.slice(1)).get("token");
    assert.ok(token, "Workbench launch must include its private access token");
    launchUrl.hash = "";
    const htmlResponse = await fetch(launchUrl, { signal: AbortSignal.timeout(10_000) });
    assert.equal(htmlResponse.status, 200);
    assert.match(htmlResponse.headers.get("content-type") ?? "", /^text\/html/);
    assert.ok(!(htmlResponse.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), "Workbench must allow the host iframe");
    const html = await htmlResponse.text();
    assert.ok(html.includes("app.js"), "Workbench must serve its runnable UI");
    const unauthorized = await fetch(new URL("/api/status", launchUrl), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    const authorized = await fetch(new URL("/api/status", launchUrl), { method: "POST", headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json",
    }, body: "{}" });
    assert.equal(authorized.status, 200);
    await authorized.arrayBuffer();
    const capabilities = object(await call("capabilities"), "Capabilities");
    assert.equal(capabilities.chromeImport, true);
    evidence.capabilities = capabilities;
    if (process.platform === "darwin") {
      const installedService = await lifecycle.resolveInstalledPluginService({ serverConfig: config, pluginId: manifest.id });
      const snapshotHelper = join(dirname(dirname(installedService.modulePath)), "native/recorder");
      assert.equal((await stat(snapshotHelper)).mode & 0o777, 0o600, "Imported immutable helper must retain the host's non-executable mode");
      const binaryRoot = join(services.pluginServiceDataDirectory(config, workspace.id, manifest.id), "binaries");
      const copied = await readdir(binaryRoot);
      assert.equal(copied.length, 1, "Native capabilities check must stage exactly one helper");
      const executable = join(binaryRoot, copied[0] ?? "");
      assert.equal((await stat(executable)).mode & 0o777, 0o700);
      assert.ok((await readFile(executable)).equals(await readFile(snapshotHelper)), "Staged helper must match the immutable snapshot");
      evidence.nativeStaging = { importedMode: "0600", executableMode: "0700", bytesEqual: true };
    }
    const imported = object(await call("import-chrome", { flow: { title: "Host verification search", steps: [
      { type: "navigate", url: "https://example.com/search?token=do-not-persist-query" },
      { type: "change", selectors: [["aria/Search[role=searchbox]"]], value: "do-not-persist-captured-input" },
      { type: "click", selectors: [["aria/Search[role=button]"]] },
      { type: "waitForElement", selectors: [["aria/Results[role=heading]"]] },
    ] } }), "Imported flow");
    const session = object(imported.session, "Imported session");
    const sessionId = string(session.id, "Imported session ID");
    await call("review", { sessionId, approved: true });
    const compiled = object(await call("compile", { sessionId, skillName: "host-verified-search", description: "Run the reviewed search workflow." }), "Compiled skill");
    const generatedDirectory = string(compiled.directory, "Generated package directory");
    assert.ok(generatedDirectory.startsWith(isolatedRoot), "Generated artifacts must stay in isolated runtime storage");
    const generatedArchive = string(compiled.archivePath, "Generated archive");
    const generatedUpload = uploadModule.parsePluginPackageUpload(await archiveUpload(generatedArchive));
    await uploadModule.withMaterializedPluginPackageUpload(generatedUpload, "install", async ({ packageRoot: generatedRoot }) => {
      const generatedPreview = await lifecycle.previewPluginPackage({ packageRoot: generatedRoot });
      const safety = await lifecycle.assertPluginPackageSafeForImport({ packageRoot: generatedRoot, preview: generatedPreview, purpose: "install" });
      assert.equal(safety.localCode, false);
      assert.equal(generatedPreview.manifest.package?.signature, undefined);
      const name = generatedPreview.manifest.id;
      const expectedFiles = ["skills/host-verified-search/SKILL.md", "skills/host-verified-search/references/workflow.json"];
      assert.deepEqual(generatedPreview.files.map((file) => file.path), expectedFiles);
      for (const file of generatedPreview.files) {
        const content = await readFile(join(generatedRoot, file.path), "utf8");
        assert.ok(!content.includes("do-not-persist"), "Export must omit captured input and URL query secrets");
      }
      await lifecycle.installPluginPackage({ serverConfig: config, packageRoot: generatedRoot });
      for (const [index, engine] of engineTargets.entries()) {
        const target = config.workspaces[index];
        assert.ok(target);
        const compatibility = adapterModule.pluginEngineCompatibility(adapterModule.pluginEngineAdapters.get(engine.id), generatedPreview.manifest);
        assert.equal(compatibility.status, "ready");
        for (const file of expectedFiles) assert.equal(await readFile(join(target.path, engine.directory, file), "utf8"), await readFile(join(generatedRoot, file), "utf8"));
      }
      await lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: name });
      for (const [index, engine] of engineTargets.entries()) {
        const target = config.workspaces[index];
        assert.ok(target);
        await missing(join(target.path, engine.directory, "skills", name, "SKILL.md"));
      }
      evidence.generatedSkill = { pluginId: name, unsignedImportAllowed: true, resources: expectedFiles,
        enginesProjected: engineTargets.map((engine) => engine.id), capturedValuesRedacted: true, fixtureFlow: true };
    });
    await lifecycle.setPluginPackageEnabled({ serverConfig: config, pluginId: manifest.id, enabled: false });
    await services.disposeAllPluginServices(config);
    await assert.rejects(call("open-workbench"), { code: "plugin_package_disabled" });
    await assert.rejects(fetch(launchUrl, { signal: AbortSignal.timeout(2_000) }));
    for (const [index, engine] of engineTargets.entries()) {
      const target = config.workspaces[index];
      assert.ok(target);
      await missing(join(target.path, engine.directory, "skills/record-operations/SKILL.md"));
    }
    await lifecycle.setPluginPackageEnabled({ serverConfig: config, pluginId: manifest.id, enabled: true });
    const reopened = object(await call("open-workbench"), "Reopened workbench");
    const reopenedUrl = new URL(string(reopened.url, "Reopened URL"));
    reopenedUrl.hash = "";
    const reopenedPage = await fetch(reopenedUrl, { signal: AbortSignal.timeout(10_000) });
    assert.equal(reopenedPage.status, 200);
    await reopenedPage.arrayBuffer();
    const persisted = object(await call("status", { sessionId }), "Persisted session");
    assert.equal(object(persisted.session, "Persisted reviewed session").status, "reviewed");
    await lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: manifest.id });
    await services.disposeAllPluginServices(config);
    await Promise.all(config.workspaces.map((target) => services.deletePluginServiceData(config, target.id, manifest.id)));
    assert.equal((await lifecycle.listInstalledPluginPackages({ serverConfig: config })).length, 0);
    await assert.rejects(fetch(reopenedUrl, { signal: AbortSignal.timeout(2_000) }));
    for (const [index, engine] of engineTargets.entries()) {
      const target = config.workspaces[index];
      assert.ok(target);
      await missing(join(target.path, engine.directory, "skills/record-operations/SKILL.md"));
      await missing(services.pluginServiceDataDirectory(config, target.id, manifest.id));
    }
    evidence.lifecycle = { install: true, workbenchHttp: true, authentication: true, disable: true,
      disabledActionRejected: true, disposeClosesServer: true, enable: true, reviewedSessionPersists: true, uninstall: true };
  });
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = error instanceof Error ? error.message : String(error);
  if (error && typeof error === "object" && "code" in error) evidence.errorCode = error.code;
  process.exitCode = 1;
} finally {
  await dispose?.();
  await rm(isolatedRoot, { recursive: true, force: true });
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
