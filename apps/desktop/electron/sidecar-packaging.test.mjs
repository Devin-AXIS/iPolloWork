import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";

import afterPackModule from "../scripts/electron-after-pack.cjs";
import {
  assertServerRuntimeDependencies,
  stageServerConstants,
  stageServerRuntimeTypes,
} from "../scripts/server-packaging.mjs";

const afterPack = afterPackModule.default ?? afterPackModule;

it("ships Harness CLIs as verified optional engine packages instead of app resources", async () => {
  const [builderConfig, mainSource, managerSource, packageSource, releaseWorkflow, stdioRuntimeSource, buildSource, devSource, codexPrepareSource, codexRuntimeManifest, workspaceConfig, osxSignPatch] = await Promise.all([
    readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"),
    readFile(new URL("./main.mjs", import.meta.url), "utf8"),
    readFile(new URL("./engine-package-manager.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-engine-runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/release-macos-aarch64.yml", import.meta.url), "utf8"),
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
  assert.doesNotMatch(builderConfig, /from: codex-runtime\s+to: codex-runtime/);
  assert.match(mainSource, /createEnginePackageManager/);
  assert.match(managerSource, /IPOLLOWORK_DSH_CLI/);
  assert.match(managerSource, /IPOLLOWORK_DSH_HOST_PLUGIN/);
  assert.match(managerSource, /IPOLLOWORK_CODEX_CLI/);
  assert.match(managerSource, /engine-packs/);
  assert.match(managerSource, /checksum verification failed/);
  assert.doesNotMatch(buildSource, /prepare-dsh-runtime\.mjs/);
  assert.doesNotMatch(devSource, /prepare-dsh-runtime\.mjs/);
  assert.doesNotMatch(buildSource, /prepare-codex-runtime\.mjs/);
  assert.doesNotMatch(devSource, /prepare-codex-runtime\.mjs/);
  assert.match(packageSource, /prepare-dsh-runtime\.mjs/);
  assert.match(packageSource, /prepare-codex-runtime\.mjs/);
  assert.match(releaseWorkflow, /package-engine-runtime\.mjs --all/);
  assert.match(stdioRuntimeSource, /windowsHide: true/);
  assert.match(codexPrepareSource, /Codex native Windows runtime was not installed/);
  assert.match(codexPrepareSource, /CI: process\.env\.CI \|\| "1"/);
  assert.match(codexRuntimeManifest, /"packageManager": "pnpm@11\.4\.0"/);
  assert.match(workspaceConfig, /@electron\/osx-sign@1\.3\.1.*@electron__osx-sign@1\.3\.1\.patch/);
  assert.match(osxSignPatch, /maxConcurrentFileOperations = 64/);
  assert.match(osxSignPatch, /withFileOperationLimit\(\(\) => getFilePathIfBinary\(filePath\)\)/);
});

it("hides consoles opened by packaged DSH tool subprocesses on Windows", async () => {
  const [runtimeManifest, runtimeWorkspace, subprocessPatch, windowsSandboxPatch, prepareSource] = await Promise.all([
    readFile(new URL("../dsh-runtime/package.json", import.meta.url), "utf8"),
    readFile(new URL("../dsh-runtime/pnpm-workspace.yaml", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../dsh-runtime/@deepseek-ai__dsh-subprocess-local@0.1.0-rc.6.patch",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../dsh-runtime/@deepseek-ai__dsh-sandbox-windows-acl@0.1.0-rc.6.patch",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../scripts/prepare-dsh-runtime.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(
    runtimeWorkspace,
    /@deepseek-ai\/dsh-subprocess-local@0\.1\.0-rc\.6.*"@deepseek-ai__dsh-subprocess-local@0\.1\.0-rc\.6\.patch"/,
  );
  assert.match(
    runtimeWorkspace,
    /@deepseek-ai\/dsh-sandbox-windows-acl@0\.1\.0-rc\.6.*"@deepseek-ai__dsh-sandbox-windows-acl@0\.1\.0-rc\.6\.patch"/,
  );
  assert.match(subprocessPatch, /windowsHide: platform === "win32"/);
  assert.match(subprocessPatch, /stdio: "ignore",\r?\n\+\s+windowsHide: true/);
  assert.match(windowsSandboxPatch, /dwFlags: 257/);
  assert.match(windowsSandboxPatch, /wShowWindow: 0/);
  assert.match(runtimeManifest, /"packageManager": "pnpm@11\.4\.0"/);
  assert.match(prepareSource, /workspacePath, subprocessPatchPath, windowsSandboxPatchPath/);
  assert.match(prepareSource, /CI: process\.env\.CI \|\| "1"/);
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
