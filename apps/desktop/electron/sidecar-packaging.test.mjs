import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createPackage, listPackage } from "@electron/asar";
import { parse as parseYaml } from "yaml";

import afterPackModule from "../scripts/electron-after-pack.cjs";
import {
  assertServerRuntimeDependencies,
  stageServerConstants,
  stageServerRuntime,
  stageServerRuntimeTypes,
} from "../scripts/server-packaging.mjs";

const afterPack = afterPackModule.default ?? afterPackModule;
const require = createRequire(import.meta.url);
const { FileMatcher, copyFiles } = createRequire(require.resolve("electron-builder"))("app-builder-lib/out/fileMatcher.js");

it("packages runtime modules without compiled tests, test support or stale staged files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-runtime-package-"));
  const serverDistDir = path.join(root, "server-dist");
  const applicationDir = path.join(root, "application");
  const packagedServerRoot = path.join(applicationDir, "server");
  const serverPackagePath = path.join(root, "server-package.json");
  const fixtures = {
    "server-dist/server.js": 'export { value } from "./routes/test-tools.js";\n',
    "server-dist/routes/test-tools.js": "export const value = 42;\n",
    "server-dist/routes/video.js": "export const render = true;\n",
    "server-dist/fixtures/runtime.json": "{}\n",
    "server-dist/server.e2e.test.js": "throw new Error('test');\n",
    "server-dist/routes/video.spec.js": "throw new Error('test');\n",
    "server-dist/routes/video.spec.js.map": "{}\n",
    "server-dist/tests/fixtures/helper.js": "export {};\n",
    "application/server/dist/obsolete.test.js": "export {};\n",
    "application/server/dist/obsolete.js": "export {};\n",
    "application/electron/main.mjs": "export {};\n",
    "application/electron/test-tools.mjs": "export {};\n",
    "application/electron/main.test.mjs": "throw new Error('test');\n",
    "application/electron/__tests__/support.mjs": "export {};\n",
    "application/package.json": '{"type":"module"}\n',
  };

  try {
    for (const [name, content] of Object.entries(fixtures)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), content);
    }
    await writeFile(serverPackagePath, '{"type":"module"}\n');
    stageServerRuntime({ serverDistDir, serverPackagePath, packagedServerRoot });
    assert.equal((await import(pathToFileURL(path.join(packagedServerRoot, "dist/server.js")).href)).value, 42);
    assert.equal(await readFile(path.join(serverDistDir, "server.e2e.test.js"), "utf8"), fixtures["server-dist/server.e2e.test.js"]);
    assert.deepEqual((await readdir(path.join(packagedServerRoot, "dist"))).sort(), ["fixtures", "routes", "server.js"]);

    const config = parseYaml(await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"));
    const matcher = new FileMatcher(applicationDir, path.join(root, "release"), (value) => value, config.files);
    await copyFiles([matcher]);
    const archive = path.join(root, "app.asar");
    await createPackage(matcher.to, archive);
    const entries = listPackage(archive, { isPack: false });
    for (const name of ["/electron/main.mjs", "/electron/test-tools.mjs", "/server/dist/server.js", "/server/dist/routes/video.js", "/server/dist/routes/test-tools.js", "/server/dist/fixtures/runtime.json"]) {
      assert.ok(entries.includes(name), `Runtime entry is preserved: ${name}`);
    }
    assert.ok(entries.every((name) => !/\.(?:test|spec)\.|\/(?:tests|__tests__|__fixtures__|__mocks__)(?:\/|$)|obsolete/.test(name)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("copies bundled plugin manifests, Skills and services while excluding test-only fixtures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-plugin-release-"));
  const config = parseYaml(await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"));
  const resources = config.extraResources.filter((resource) => resource.to.startsWith("plugin-packages/"));
  const runtimeFiles = ["ipollowork.plugin.json", "service/test-tools.mjs", "skills/worker/SKILL.md", "skills/worker/app/src/simulation.ts"];
  const testFiles = ["service/worker.test.mjs", "service/worker.spec.mjs", "skills/worker/app/tsconfig.test.json", "skills/worker/app/tests/fixtures/server.ts", "service/__tests__/helper.mjs"];
  try {
    const source = path.join(root, "source");
    for (const name of [...runtimeFiles, ...testFiles]) {
      await mkdir(path.dirname(path.join(source, name)), { recursive: true });
      await writeFile(path.join(source, name), "fixture\n");
    }
    for (const resource of resources) {
      const matcher = new FileMatcher(source, path.join(root, resource.to), (value) => value, resource.filter);
      await copyFiles([matcher]);
      for (const name of runtimeFiles) assert.equal(await readFile(path.join(matcher.to, name), "utf8"), "fixture\n", `${resource.to}: ${name}`);
      for (const name of testFiles) await assert.rejects(readFile(path.join(matcher.to, name)), { code: "ENOENT" }, `${resource.to}: ${name}`);
    }
    assert.equal(await readFile(path.join(source, "service/worker.test.mjs"), "utf8"), "fixture\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("ships the shared reference Skill independently of Video", async () => {
  const builderConfig = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(builderConfig, /from: \.\.\/\.\.\/examples\/plugin-packages\/reference-context\s+to: plugin-packages\/reference-context/);
  const packageRoot = new URL("../../../examples/plugin-packages/reference-context/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("ipollowork.plugin.json", packageRoot), "utf8"));
  assert.equal(manifest.defaultEnabled, true);
  const resource = manifest.resources.find((item) => item.id === "ipollowork-reference-analyzer");
  assert.ok(resource);
  assert.match(await readFile(new URL(resource.path, packageRoot), "utf8"), /^name: ipollowork-reference-analyzer$/m);
});

it("publishes Harness CLIs as verified cloud packages without bundling their archives", async () => {
  const [builderConfig, mainSource, managerSource, packageSource, windowsPackageSource, macPackageSource, releaseWorkflow, desktopBuildWorkflow, stdioRuntimeSource, buildSource, devSource, codexPrepareSource, codexRuntimeManifest, workspaceConfig, osxSignPatch] = await Promise.all([
    readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"),
    readFile(new URL("./main.mjs", import.meta.url), "utf8"),
    readFile(new URL("./engine-package-manager.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-engine-runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-windows.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-mac-release.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/release-macos-aarch64.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/build-electron-desktop.yml", import.meta.url), "utf8"),
    readFile(new URL("../../server/src/stdio-json-rpc-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/electron-build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/electron-dev.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/prepare-codex-runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../codex-runtime/package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../pnpm-workspace.yaml", import.meta.url), "utf8"),
    readFile(new URL("../../../patches/@electron__osx-sign@1.3.1.patch", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(builderConfig, /from: dsh-runtime\s+to: dsh-runtime/);
  assert.match(builderConfig, /from: \.\.\/\.\.\/examples\/plugin-packages\/deepseek-harness/);
  assert.match(builderConfig, /from: \.\.\/\.\.\/examples\/plugin-packages\/xiaohongshu-ops\s+to: plugin-packages\/xiaohongshu-ops/);
  assert.match(builderConfig, /from: \.\.\/\.\.\/examples\/plugin-packages\/douyin-ops\s+to: plugin-packages\/douyin-ops/);
  assert.match(builderConfig, /from: \.\.\/\.\.\/examples\/plugin-packages\/wechat-channels-ops\s+to: plugin-packages\/wechat-channels-ops/);
  assert.match(builderConfig, /from: \.\.\/\.\.\/examples\/plugin-packages\/operation-recorder\/dist\/package\s+to: plugin-packages\/operation-recorder/);
  assert.match(buildSource, /operation-recorder\/scripts\/build\.mjs/);
  assert.match(devSource, /operation-recorder\/scripts\/build\.mjs.*--host.*--if-stale/);
  assert.doesNotMatch(builderConfig, /from: codex-runtime\s+to: codex-runtime/);
  const macConfig = builderConfig.match(/\r?\nmac:\r?\n[\s\S]*?\r?\nlinux:\r?\n/)?.[0] ?? "";
  const linuxConfig = builderConfig.match(/\r?\nlinux:\r?\n[\s\S]*?\r?\nwin:\r?\n/)?.[0] ?? "";
  const windowsConfig = builderConfig.match(/\r?\nwin:\r?\n[\s\S]*$/)?.[0] ?? "";
  assert.doesNotMatch(macConfig, /from: dist-engine-packs\s+to: engine-packs/);
  assert.doesNotMatch(linuxConfig, /from: dist-engine-packs\s+to: engine-packs/);
  assert.doesNotMatch(windowsConfig, /from: dist-engine-packs\s+to: engine-packs/);
  assert.match(mainSource, /createEnginePackageManager/);
  assert.match(mainSource, /app\.getAppPath\(\).*server.*dist.*constants\.json/);
  assert.match(managerSource, /IPOLLOWORK_DSH_CLI/);
  assert.match(managerSource, /IPOLLOWORK_DSH_NODE_BIN/);
  assert.match(managerSource, /IPOLLOWORK_DSH_HOST_PLUGIN/);
  assert.match(managerSource, /IPOLLOWORK_CODEX_CLI/);
  assert.match(managerSource, /engine-packs/);
  assert.match(managerSource, /fetchDesktopResourceManifest/);
  assert.match(managerSource, /Cloud resource checksum verification failed/);
  assert.doesNotMatch(managerSource, /officialReleaseAssetUrl|gh-proxy\.com|api\.github\.com/);
  assert.doesNotMatch(buildSource, /prepare-dsh-runtime\.mjs/);
  assert.doesNotMatch(devSource, /prepare-dsh-runtime\.mjs/);
  assert.doesNotMatch(buildSource, /prepare-codex-runtime\.mjs/);
  assert.doesNotMatch(devSource, /prepare-codex-runtime\.mjs/);
  assert.match(packageSource, /prepare-dsh-runtime\.mjs/);
  assert.match(packageSource, /node-runtime/);
  assert.match(packageSource, /prepare-codex-runtime\.mjs/);
  assert.match(packageSource, /--clean/);
  assert.doesNotMatch(windowsPackageSource, /package-engine-runtime\.mjs/);
  assert.doesNotMatch(macPackageSource, /package-engine-runtime\.mjs/);
  assert.match(releaseWorkflow, /package-engine-runtime\.mjs --all --clean --outdir.*apps\/desktop\/dist-engine-packs/);
  assert.match(releaseWorkflow, /github\.event_name == 'workflow_dispatch' && github\.ref_name \|\| env\.RELEASE_TAG/);
  assert.match(releaseWorkflow, /git merge-base --is-ancestor "\$\{RELEASE_TAG\}\^\{\}" HEAD/);
  const afterSignSource = await readFile(new URL("../scripts/electron-after-sign.cjs", import.meta.url), "utf8");
  assert.match(afterSignSource, /notarytool[\s\S]*--output-format[\s\S]*json/);
  assert.match(afterSignSource, /notarytool", "log"/);
  assert.match(desktopBuildWorkflow, /package:engine-runtimes/);
  assert.match(stdioRuntimeSource, /windowsHide: true/);
  assert.match(codexPrepareSource, /Codex native Windows runtime was not installed/);
  assert.match(codexPrepareSource, /CI: process\.env\.CI \|\| "1"/);
  assert.match(codexRuntimeManifest, /"packageManager": "pnpm@11\.4\.0"/);
  assert.match(workspaceConfig, /@electron\/osx-sign@1\.3\.1.*@electron__osx-sign@1\.3\.1\.patch/);
  assert.match(osxSignPatch, /maxConcurrentFileOperations = 64/);
  assert.match(osxSignPatch, /withFileOperationLimit\(\(\) => getFilePathIfBinary\(filePath\)\)/);
});

it("packages the current DSH release without obsolete upstream patches", async () => {
  const [runtimeManifest, runtimeWorkspace, constants, prepareSource] = await Promise.all([
    readFile(new URL("../dsh-runtime/package.json", import.meta.url), "utf8"),
    readFile(new URL("../dsh-runtime/pnpm-workspace.yaml", import.meta.url), "utf8"),
    readFile(new URL("../../../constants.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/prepare-dsh-runtime.mjs", import.meta.url), "utf8"),
  ]);
  const dependencies = JSON.parse(runtimeManifest).dependencies;
  assert.equal(dependencies["@deepseek-ai/dsh"], JSON.parse(constants).deepseekHarnessVersion);
  assert.equal(dependencies["@deepseek-ai/dsh-llm-pi-ai"], dependencies["@deepseek-ai/dsh"]);
  assert.doesNotMatch(runtimeWorkspace, /patchedDependencies/);
  assert.match(runtimeManifest, /"packageManager": "pnpm@11\.4\.0"/);
  assert.match(prepareSource, /manifestPath, lockPath, workspacePath/);
  assert.doesNotMatch(prepareSource, /PatchPath/);
  assert.match(prepareSource, /CI: process\.env\.CI \|\| "1"/);
  assert.match(prepareSource, /stageNodeRuntime/);
  assert.doesNotMatch(prepareSource, /--ignore-workspace/);
});

it("stages constants beside every compiled server module that imports them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-server-package-"));
  const serverDistDir = path.join(root, "dist");
  const constantsSrc = path.join(root, "constants.json");
  await mkdir(serverDistDir, { recursive: true });
  await writeFile(constantsSrc, '{"opencodeVersion":"1.2.3"}\n');
  await writeFile(path.join(serverDistDir, "server.js"), 'import constants from "../../../constants.json" with { type: "json" };\n');
  await writeFile(path.join(serverDistDir, "plugin-package-lifecycle.js"), "import constants from '../../../constants.json' with { type: 'json' };\n");
  await writeFile(path.join(serverDistDir, "unrelated.js"), 'export const value = "../../../constants.json";\n');

  try {
    assert.deepEqual(stageServerConstants({ serverDistDir, constantsSrc }).sort(), [
      "plugin-package-lifecycle.js",
      "server.js",
    ]);
    assert.equal(await readFile(path.join(serverDistDir, "constants.json"), "utf8"), '{"opencodeVersion":"1.2.3"}\n');
    assert.match(await readFile(path.join(serverDistDir, "server.js"), "utf8"), /from "\.\/constants\.json"/);
    assert.match(await readFile(path.join(serverDistDir, "plugin-package-lifecycle.js"), "utf8"), /from "\.\/constants\.json"/);
    assert.match(await readFile(path.join(serverDistDir, "unrelated.js"), "utf8"), /\.\.\/\.\.\/\.\.\/constants\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires every external server dependency in the Electron runtime manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-server-dependencies-"));
  const serverPackagePath = path.join(root, "server-package.json");
  const desktopPackagePath = path.join(root, "desktop-package.json");
  await writeFile(serverPackagePath, JSON.stringify({
    dependencies: {
      "@ipollowork/types": "workspace:*",
      "oauth4webapi": "^3.8.7",
      zod: "^4.3.6",
    },
  }));
  await writeFile(desktopPackagePath, JSON.stringify({ dependencies: { zod: "^4.3.6" } }));

  try {
    assert.throws(
      () => assertServerRuntimeDependencies({ serverPackagePath, desktopPackagePath }),
      /oauth4webapi/,
    );
    await writeFile(desktopPackagePath, JSON.stringify({
      dependencies: { oauth4webapi: "^3.8.7", zod: "^4.3.6" },
    }));
    assert.doesNotThrow(
      () => assertServerRuntimeDependencies({ serverPackagePath, desktopPackagePath }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("stages all shared runtime types beside nested compiled server modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-runtime-types-stage-"));
  const serverDistDir = path.join(root, "server-dist");
  const runtimeTypesDistDir = path.join(root, "types-dist");
  await mkdir(path.join(serverDistDir, "routes"), { recursive: true });
  await mkdir(path.join(runtimeTypesDistDir, "den"), { recursive: true });
  await writeFile(path.join(serverDistDir, "hyperframes-catalog.js"), 'import { schema } from "@ipollowork/types/hyperframes";\n');
  await writeFile(path.join(serverDistDir, "server.js"), 'import { defaults } from "@ipollowork/types";\n');
  await writeFile(path.join(serverDistDir, "routes", "workspaces.js"), 'export { engine } from "@ipollowork/types/workspace";\n');
  await writeFile(path.join(runtimeTypesDistDir, "index.js"), "export const defaults = {};\n");
  await writeFile(path.join(runtimeTypesDistDir, "hyperframes.js"), "export const schema = {};\n");
  await writeFile(path.join(runtimeTypesDistDir, "workspace.js"), "export const engine = {};\n");
  await writeFile(path.join(runtimeTypesDistDir, "den", "inference.js"), "export const inference = {};\n");

  try {
    assert.deepEqual(stageServerRuntimeTypes({ serverDistDir, runtimeTypesDistDir }).sort(), [
      "hyperframes-catalog.js",
      "routes/workspaces.js",
      "server.js",
    ]);
    assert.match(await readFile(path.join(serverDistDir, "hyperframes-catalog.js"), "utf8"), /\.\/ipollowork-types\/hyperframes\.js/);
    assert.match(await readFile(path.join(serverDistDir, "server.js"), "utf8"), /\.\/ipollowork-types\/index\.js/);
    assert.match(await readFile(path.join(serverDistDir, "routes", "workspaces.js"), "utf8"), /\.\.\/ipollowork-types\/workspace\.js/);
    assert.equal(await readFile(path.join(serverDistDir, "ipollowork-types", "den", "inference.js"), "utf8"), "export const inference = {};\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const {
  assertPackagedNodePty,
  assertPackagedOpenCodeRuntime,
  assertPackagedRuntimeTypes,
} = afterPackModule;

async function createOpenCodeRuntimeFixture(appOutDir) {
  const runtimeDir = path.join(appOutDir, "resources", "opencode-runtime");
  const sdkDir = path.join(runtimeDir, "node_modules", "@opencode-ai", "plugin");
  await mkdir(path.join(sdkDir, "dist"), { recursive: true });
  await writeFile(path.join(runtimeDir, "package.json"), '{"dependencies":{}}\n');
  await writeFile(path.join(runtimeDir, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(path.join(sdkDir, "package.json"), '{"name":"@opencode-ai/plugin"}\n');
  await writeFile(path.join(sdkDir, "dist", "tool.js"), "export const tool = {};\n");
}

it("requires the shared runtime types in packaged Electron archives", async () => {
  const appOutDir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-runtime-types-"));
  const sourceDir = path.join(appOutDir, "source");
  const resourcesDir = path.join(appOutDir, "resources");
  const packageDir = path.join(sourceDir, "server", "dist", "ipollowork-types");
  await mkdir(packageDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });
  await writeFile(path.join(sourceDir, "server", "dist", "server.js"), 'import "./ipollowork-types/workspace.js";\n');
  await writeFile(path.join(packageDir, "workspace.js"), "export {};\n");

  try {
    await createPackage(sourceDir, path.join(resourcesDir, "app.asar"));
    assert.doesNotThrow(() => assertPackagedRuntimeTypes({
      electronPlatformName: "win32",
      appOutDir,
    }));

    await rm(path.join(packageDir, "workspace.js"));
    await createPackage(sourceDir, path.join(resourcesDir, "app.asar"));
    assert.throws(() => assertPackagedRuntimeTypes({
      electronPlatformName: "win32",
      appOutDir,
    }), /ipollowork-types\/workspace\.js/);

    await writeFile(path.join(sourceDir, "server", "dist", "server.js"), 'import "@ipollowork/types/workspace";\n');
    await createPackage(sourceDir, path.join(resourcesDir, "app.asar"));
    assert.throws(() => assertPackagedRuntimeTypes({
      electronPlatformName: "win32",
      appOutDir,
    }), /unresolved imports/);
  } finally {
    await rm(appOutDir, { recursive: true, force: true });
  }
});

it("requires the bundled OpenCode tool runtime in packaged Electron resources", async () => {
  const appOutDir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-opencode-runtime-"));
  try {
    assert.throws(() => assertPackagedOpenCodeRuntime({
      electronPlatformName: "win32",
      appOutDir,
    }), /OpenCode runtime/);

    await createOpenCodeRuntimeFixture(appOutDir);
    assert.doesNotThrow(() => assertPackagedOpenCodeRuntime({
      electronPlatformName: "win32",
      appOutDir,
    }));
  } finally {
    await rm(appOutDir, { recursive: true, force: true });
  }
});

async function createWindowsFixture(triple) {
  const appOutDir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-after-pack-"));
  const sidecarsDir = path.join(appOutDir, "resources", "sidecars");
  await mkdir(sidecarsDir, { recursive: true });
  const asarSource = path.join(appOutDir, "asar-source");
  const runtimeTypes = path.join(asarSource, "server", "dist", "ipollowork-types");
  await mkdir(runtimeTypes, { recursive: true });
  await writeFile(path.join(asarSource, "server", "dist", "server.js"), 'import "./ipollowork-types/workspace.js";\n');
  await writeFile(path.join(runtimeTypes, "workspace.js"), "export {};\n");
  await createPackage(asarSource, path.join(appOutDir, "resources", "app.asar"));
  await createOpenCodeRuntimeFixture(appOutDir);

  for (const name of [
    `opencode-${triple}.exe`,
    `ipollowork-orchestrator-${triple}.exe`,
    `versions.json-${triple}.exe`,
  ]) {
    await writeFile(path.join(sidecarsDir, name), "placeholder");
  }

  // The embedded server has no executable sidecar. The afterPack hook only
  // keeps the canonical engine binaries and their version metadata.
  await writeFile(path.join(sidecarsDir, "unrelated.txt"), "legacy");

  return { appOutDir, sidecarsDir };
}

for (const [arch, triple] of [
  ["x64", "x86_64-pc-windows-msvc"],
  [1, "x86_64-pc-windows-msvc"],
  ["arm64", "aarch64-pc-windows-msvc"],
  [3, "aarch64-pc-windows-msvc"],
]) {
  it(`normalizes the Windows ${arch} executable sidecars`, async () => {
    const { appOutDir, sidecarsDir } = await createWindowsFixture(triple);
    try {
      await afterPack({
        electronPlatformName: "win32",
        arch,
        appOutDir,
        packager: { appInfo: { productFilename: "iPollo" } },
      });

      assert.deepEqual((await readdir(sidecarsDir)).sort(), [
        "ipollowork-orchestrator.exe",
        "opencode.exe",
        "versions.json",
      ].sort());
    } finally {
      await rm(appOutDir, { recursive: true, force: true });
    }
  });
}

async function createMacNodePtyFixture(arch) {
  const appOutDir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-node-pty-"));
  const packageDir = path.join(
    appOutDir,
    "iPollo.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "@lydell",
    `node-pty-darwin-${arch}`,
    "prebuilds",
    `darwin-${arch}`,
  );
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, "pty.node"), "placeholder");
  return appOutDir;
}

it("accepts an Intel macOS app that includes the Intel node-pty binary", async () => {
  const appOutDir = await createMacNodePtyFixture("x64");
  try {
    assert.doesNotThrow(() => assertPackagedNodePty({
      electronPlatformName: "darwin",
      arch: "x64",
      appOutDir,
      packager: { appInfo: { productFilename: "iPollo" } },
    }));
  } finally {
    await rm(appOutDir, { recursive: true, force: true });
  }
});

it("rejects an Intel macOS app that only includes the Apple Silicon node-pty binary", async () => {
  const appOutDir = await createMacNodePtyFixture("arm64");
  try {
    assert.throws(() => assertPackagedNodePty({
      electronPlatformName: "darwin",
      arch: "x64",
      appOutDir,
      packager: { appInfo: { productFilename: "iPollo" } },
    }), /node-pty-darwin-x64/);
  } finally {
    await rm(appOutDir, { recursive: true, force: true });
  }
});
