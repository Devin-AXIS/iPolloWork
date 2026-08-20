import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";

import afterPackModule from "../scripts/electron-after-pack.cjs";
import { stageServerConstants, stageServerRuntimeTypes } from "../scripts/server-packaging.mjs";

const afterPack = afterPackModule.default ?? afterPackModule;

it("prepares and packages the DSH CLI outside app.asar", async () => {
  const [builderConfig, mainSource, buildSource, devSource, workspaceConfig, osxSignPatch] = await Promise.all([
    readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"),
    readFile(new URL("./main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/electron-build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/electron-dev.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../pnpm-workspace.yaml", import.meta.url), "utf8"),
    readFile(new URL("../../../patches/@electron__osx-sign@1.3.1.patch", import.meta.url), "utf8"),
  ]);
  assert.match(builderConfig, /from: dsh-runtime\s+to: dsh-runtime/);
  assert.match(builderConfig, /from: \.\.\/\.\.\/examples\/plugin-packages\/deepseek-harness/);
  assert.match(mainSource, /process\.resourcesPath, "dsh-runtime"/);
  assert.match(mainSource, /IPOLLOWORK_DSH_CLI/);
  assert.match(mainSource, /IPOLLOWORK_DSH_HOST_PLUGIN/);
  assert.match(builderConfig, /ipollowork-host-tools\.mjs/);
  assert.match(buildSource, /prepare-dsh-runtime\.mjs/);
  assert.match(devSource, /prepare-dsh-runtime\.mjs/);
  assert.match(workspaceConfig, /@electron\/osx-sign@1\.3\.1.*@electron__osx-sign@1\.3\.1\.patch/);
  assert.match(osxSignPatch, /maxConcurrentFileOperations = 64/);
  assert.match(osxSignPatch, /withFileOperationLimit\(\(\) => getFilePathIfBinary\(filePath\)\)/);
});

it("hides consoles opened by packaged DSH tool subprocesses on Windows", async () => {
  const [runtimeWorkspace, patch, prepareSource] = await Promise.all([
    readFile(new URL("../dsh-runtime/pnpm-workspace.yaml", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../dsh-runtime/@deepseek-ai__dsh-subprocess-local@0.1.0-rc.6.patch",
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
  assert.match(patch, /windowsHide: platform === "win32"/);
  assert.match(patch, /stdio: "ignore",\n\+\s+windowsHide: true/);
  assert.match(prepareSource, /workspacePath, subprocessPatchPath/);
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

it("stages shared runtime types beside compiled server modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-runtime-types-stage-"));
  const serverDistDir = path.join(root, "server-dist");
  const runtimeTypesDistDir = path.join(root, "types-dist");
  await mkdir(serverDistDir, { recursive: true });
  await mkdir(runtimeTypesDistDir, { recursive: true });
  await writeFile(path.join(serverDistDir, "hyperframes-catalog.js"), 'import { schema } from "@ipollowork/types/hyperframes";\n');
  await writeFile(path.join(runtimeTypesDistDir, "hyperframes.js"), "export const schema = {};\n");
  await writeFile(path.join(runtimeTypesDistDir, "templates.js"), "export const templates = {};\n");

  try {
    assert.deepEqual(stageServerRuntimeTypes({ serverDistDir, runtimeTypesDistDir }), ["hyperframes-catalog.js"]);
    assert.match(await readFile(path.join(serverDistDir, "hyperframes-catalog.js"), "utf8"), /\.\/ipollowork-types\/hyperframes\.js/);
    assert.equal(await readFile(path.join(serverDistDir, "ipollowork-types", "templates.js"), "utf8"), "export const templates = {};\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const {
  assertPackagedNodePty,
  assertPackagedOpenCodePlugins,
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
  await writeFile(path.join(packageDir, "hyperframes.js"), "export {};\n");
  await writeFile(path.join(packageDir, "templates.js"), "export {};\n");

  try {
    await createPackage(sourceDir, path.join(resourcesDir, "app.asar"));
    assert.doesNotThrow(() => assertPackagedRuntimeTypes({
      electronPlatformName: "win32",
      appOutDir,
    }));

    await rm(path.join(packageDir, "templates.js"));
    await createPackage(sourceDir, path.join(resourcesDir, "app.asar"));
    assert.throws(() => assertPackagedRuntimeTypes({
      electronPlatformName: "win32",
      appOutDir,
    }), /ipollowork-types\/templates\.js/);
  } finally {
    await rm(appOutDir, { recursive: true, force: true });
  }
});

it("requires the bundled Chrome DevTools plugin in packaged Electron resources", async () => {
  const appOutDir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-opencode-plugin-"));
  const pluginRoot = path.join(appOutDir, "resources", "opencode-plugins", "opencode-chrome-devtools");
  const pluginDir = path.join(pluginRoot, "dist");
  await mkdir(pluginDir, { recursive: true });

  try {
    assert.throws(() => assertPackagedOpenCodePlugins({
      electronPlatformName: "win32",
      appOutDir,
    }), /opencode-chrome-devtools/);

    await writeFile(path.join(pluginDir, "plugin.js"), "export default {};");
    assert.throws(() => assertPackagedOpenCodePlugins({
      electronPlatformName: "win32",
      appOutDir,
    }), /package\.json/);

    await writeFile(path.join(pluginRoot, "package.json"), '{"name":"opencode-chrome-devtools"}\n');
    await createOpenCodeRuntimeFixture(appOutDir);
    assert.doesNotThrow(() => assertPackagedOpenCodePlugins({
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
  await writeFile(path.join(runtimeTypes, "hyperframes.js"), "export {};\n");
  await writeFile(path.join(runtimeTypes, "templates.js"), "export {};\n");
  await createPackage(asarSource, path.join(appOutDir, "resources", "app.asar"));
  const pluginRoot = path.join(appOutDir, "resources", "opencode-plugins", "opencode-chrome-devtools");
  const pluginDir = path.join(pluginRoot, "dist");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(path.join(pluginDir, "plugin.js"), "export default {};\n");
  await writeFile(path.join(pluginRoot, "package.json"), '{"name":"opencode-chrome-devtools"}\n');
  await createOpenCodeRuntimeFixture(appOutDir);

  for (const name of [
    `opencode-${triple}.exe`,
    `ipollowork-orchestrator-${triple}.exe`,
    `versions.json-${triple}.exe`,
  ]) {
    await writeFile(path.join(sidecarsDir, name), "placeholder");
  }

  // ipollowork-server and chrome-devtools-mcp are intentionally absent. The
  // afterPack hook must not require their obsolete executable sidecars.
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
