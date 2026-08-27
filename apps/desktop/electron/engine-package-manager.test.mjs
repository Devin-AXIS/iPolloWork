import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createEnginePackageManager } from "./engine-package-manager.mjs";

function platformAssetSegment() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return process.platform;
}

function commandPath(command) {
  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8" });
  if (lookup.status !== 0) throw new Error(`${command} is required for this test.`);
  return lookup.stdout.split(/\r?\n/).find(Boolean);
}

function codexCliRelativePath() {
  if (process.platform !== "win32") {
    return path.join("node_modules", "@openai", "codex", "bin", "codex.js");
  }
  const arm64 = process.arch === "arm64";
  return path.join(
    "node_modules",
    "@openai",
    arm64 ? "codex-win32-arm64" : "codex-win32-x64",
    "vendor",
    arm64 ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
    "bin",
    "codex.exe",
  );
}

test("installs and removes an optional engine package without touching Work data", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-package-test-"));
  const userData = path.join(temporaryRoot, "user-data");
  const sourceDirectory = path.join(temporaryRoot, "source");
  const fixtureRoot = path.join(temporaryRoot, "fixture");
  const workDataRoot = path.join(userData, "runtime-data");
  const sentinelPath = path.join(workDataRoot, "conversation.json");
  const version = "9.8.7";
  const name = `ipollowork-engine-codex-harness-${platformAssetSegment()}-${process.arch}-${version}.tar.gz`;
  const archivePath = path.join(sourceDirectory, name);
  const tarPath = commandPath("tar");
  const previousEnvironment = {
    path: process.env.PATH,
    source: process.env.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR,
    codexCli: process.env.IPOLLOWORK_CODEX_CLI,
    codexVersion: process.env.IPOLLOWORK_CODEX_CLI_VERSION,
  };

  await mkdir(path.join(fixtureRoot, path.dirname(codexCliRelativePath())), { recursive: true });
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(workDataRoot, { recursive: true });
  await writeFile(path.join(fixtureRoot, codexCliRelativePath()), "fixture-runtime\n");
  await writeFile(path.join(fixtureRoot, "package.json"), '{"name":"fixture"}\n');
  await writeFile(sentinelPath, '{"kept":true}\n');
  const packed = spawnSync(tarPath, ["-czf", archivePath, "-C", fixtureRoot, "."], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  await writeFile(`${archivePath}.sha256`, `${checksum}  ${name}\n`);

  let beforeUninstallCalls = 0;
  let resumeRuntimeCalls = 0;
  /** @type {NodeJS.ProcessEnv} */
  const managerEnvironment = {
    ...process.env,
    PATH: path.dirname(tarPath),
    APPDATA: path.join(temporaryRoot, "app-data"),
    LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
    IPOLLOWORK_ENGINE_PACK_SOURCE_DIR: sourceDirectory,
  };
  delete managerEnvironment.IPOLLOWORK_CODEX_CLI;
  delete managerEnvironment.IPOLLOWORK_CODEX_CLI_VERSION;
  try {
    process.env.PATH = path.dirname(tarPath);
    process.env.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR = sourceDirectory;
    delete process.env.IPOLLOWORK_CODEX_CLI;
    delete process.env.IPOLLOWORK_CODEX_CLI_VERSION;
    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return userData;
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: version },
      env: managerEnvironment,
      homeDir: path.join(temporaryRoot, "home"),
      fetch: async () => { throw new Error("fixture should not use the network"); },
      beforeUninstall: async () => {
        beforeUninstallCalls += 1;
        assert.equal(managerEnvironment.IPOLLOWORK_CODEX_CLI, undefined);
        return () => {
          resumeRuntimeCalls += 1;
        };
      },
    });

    const initial = await manager.list();
    assert.deepEqual(
      initial.map((engine) => [engine.id, engine.installed, engine.builtIn]),
      [
        ["opencode", true, true],
        ["deepseek-harness", false, false],
        ["codex-harness", false, false],
      ],
    );

    const installed = await manager.install("codex-harness");
    assert.equal(installed.status, "ready");
    assert.equal(installed.source, "downloaded");
    assert.equal(installed.canUninstall, true);
    assert.ok(installed.installedBytes > 0);
    assert.ok(managerEnvironment.IPOLLOWORK_CODEX_CLI?.includes(path.join("engine-packs", "codex-harness")));
    assert.equal(await readFile(sentinelPath, "utf8"), '{"kept":true}\n');

    await rm(path.join(
      userData,
      "engine-packs",
      "codex-harness",
      version,
      `${process.platform}-${process.arch}`,
      ".installed.json",
    ));
    const managedFallback = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(managedFallback?.source, "downloaded");
    assert.equal(managedFallback?.canUninstall, true);
    assert.equal(managedFallback?.installedBytes, null);

    const removed = await manager.uninstall("codex-harness");
    assert.equal(removed.installed, false);
    assert.equal(removed.source, "none");
    assert.equal(removed.canUninstall, false);
    assert.equal(beforeUninstallCalls, 1);
    assert.equal(resumeRuntimeCalls, 1);
    assert.equal(await readFile(sentinelPath, "utf8"), '{"kept":true}\n');
    assert.equal(existsSync(path.join(userData, "engine-packs", "codex-harness")), false);
  } finally {
    if (previousEnvironment.path === undefined) delete process.env.PATH;
    else process.env.PATH = previousEnvironment.path;
    if (previousEnvironment.source === undefined) delete process.env.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR;
    else process.env.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR = previousEnvironment.source;
    if (previousEnvironment.codexCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
    else process.env.IPOLLOWORK_CODEX_CLI = previousEnvironment.codexCli;
    if (previousEnvironment.codexVersion === undefined) delete process.env.IPOLLOWORK_CODEX_CLI_VERSION;
    else process.env.IPOLLOWORK_CODEX_CLI_VERSION = previousEnvironment.codexVersion;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("prefers an official Codex Harness and removes a redundant downloaded copy", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codex-precedence-test-"));
  const userData = path.join(temporaryRoot, "user-data");
  const clientResources = path.join(temporaryRoot, "Codex.app", "Contents", "Resources");
  const officialCli = path.join(clientResources, process.platform === "win32" ? "codex.EXE" : "codex");
  const managedRoot = path.join(userData, "engine-packs", "codex-harness");
  const managedCli = path.join(managedRoot, "7.8.9", `${process.platform}-${process.arch}`, codexCliRelativePath());
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: clientResources,
    APPDATA: path.join(temporaryRoot, "app-data"),
    LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
  };
  delete environment.IPOLLOWORK_CODEX_CLI;
  delete environment.IPOLLOWORK_CODEX_CLI_VERSION;

  try {
    await mkdir(path.dirname(managedCli), { recursive: true });
    await mkdir(clientResources, { recursive: true });
    await writeFile(managedCli, "redundant-runtime\n");
    await writeFile(officialCli, "official-runtime\n");
    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return userData;
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: "7.8.9" },
      env: environment,
      homeDir: path.join(temporaryRoot, "home"),
      probeRuntime: async ({ executablePath }) => executablePath === officialCli,
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    const beforeStartup = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(beforeStartup?.source, "official");
    assert.equal(beforeStartup?.canInstall, false);
    assert.equal(beforeStartup?.canUninstall, false);

    await manager.applyEnvironment();
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, officialCli);
    assert.equal(existsSync(managedRoot), false);
    const afterStartup = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(afterStartup?.source, "official");
    assert.equal(afterStartup?.canInstall, false);
    assert.equal(afterStartup?.canUninstall, false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("identifies an official Codex client resource and leaves it externally managed", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codex-client-test-"));
  const clientResources = path.join(temporaryRoot, "ChatGPT.app", "Contents", "Resources");
  const previousPath = process.env.PATH;
  const previousCodexCli = process.env.IPOLLOWORK_CODEX_CLI;

  try {
    await mkdir(clientResources, { recursive: true });
    await writeFile(path.join(clientResources, process.platform === "win32" ? "codex.EXE" : "codex"), "client-runtime\n");
    process.env.PATH = clientResources;
    delete process.env.IPOLLOWORK_CODEX_CLI;

    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: "7.8.9" },
      probeRuntime: async () => true,
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    const codex = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(codex?.installed, true);
    assert.equal(codex?.source, "official");
    assert.equal(codex?.canInstall, false);
    assert.equal(codex?.canUninstall, false);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCodexCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
    else process.env.IPOLLOWORK_CODEX_CLI = previousCodexCli;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("discovers an official Codex client outside the inherited PATH", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codex-discovery-test-"));
  const homeDir = path.join(temporaryRoot, "home");
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: path.join(temporaryRoot, "empty-bin"),
    APPDATA: path.join(temporaryRoot, "app-data"),
    LOCALAPPDATA: path.join(temporaryRoot, "AppData", "Local"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
  };
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.IPOLLOWORK_CODEX_CLI;
  const blockedCodexPath = process.platform === "win32"
    ? path.join(environment.ProgramFiles, "WindowsApps", "OpenAI.Codex_1.2.3.0_x64__official", "app", "resources", "codex.exe")
    : null;
  const codexPath = process.platform === "win32"
    ? path.join(environment.LOCALAPPDATA, "OpenAI", "Codex", "bin", "stable", "codex.exe")
    : process.platform === "darwin"
      ? path.join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex")
      : path.join(homeDir, ".local", "bin", "codex");
  const probedPaths = [];

  try {
    if (blockedCodexPath) {
      await mkdir(path.dirname(blockedCodexPath), { recursive: true });
      await writeFile(blockedCodexPath, "blocked-store-runtime\n");
    }
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, "official-runtime\n");
    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: "7.8.9" },
      env: environment,
      homeDir,
      probeRuntime: async ({ executablePath }) => {
        probedPaths.push(executablePath);
        return executablePath !== blockedCodexPath;
      },
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const codex = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(codex?.source, "official");
    assert.equal(codex?.canInstall, false);
    assert.equal(codex?.canUninstall, false);
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, codexPath);
    if (blockedCodexPath) assert.ok(probedPaths.includes(blockedCodexPath));
    assert.ok(probedPaths.includes(codexPath));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("uses an official DeepSeek Harness installation without offering another download", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-dsh-official-test-"));
  const homeDir = path.join(temporaryRoot, "home");
  const appData = path.join(temporaryRoot, "app-data");
  const binDirectory = process.platform === "win32"
    ? path.join(appData, "npm")
    : path.join(homeDir, ".local", "bin");
  const dshCommand = path.join(binDirectory, process.platform === "win32" ? "dsh.cmd" : "dsh");
  const dshEntrypoint = path.join(binDirectory, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: path.join(temporaryRoot, "empty-bin"),
    APPDATA: appData,
    LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
  };
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.IPOLLOWORK_CODEX_CLI;

  try {
    await mkdir(path.dirname(dshEntrypoint), { recursive: true });
    await writeFile(dshCommand, process.platform === "win32" ? "@echo off\r\n" : "#!/usr/bin/env node\n");
    await writeFile(dshEntrypoint, "#!/usr/bin/env node\n");
    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: "7.8.9" },
      env: environment,
      homeDir,
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const dsh = (await manager.list()).find((engine) => engine.id === "deepseek-harness");
    assert.equal(dsh?.installed, true);
    assert.equal(dsh?.source, "official");
    assert.equal(dsh?.canInstall, false);
    assert.equal(dsh?.canUninstall, false);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, process.platform === "win32" ? dshEntrypoint : dshCommand);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("projects the bundled Node runtime for a downloaded DeepSeek Harness package", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-dsh-node-runtime-test-"));
  const userData = path.join(temporaryRoot, "user-data");
  const version = "4.5.6";
  const installedRoot = path.join(
    userData,
    "engine-packs",
    "deepseek-harness",
    version,
    `${process.platform}-${process.arch}`,
  );
  const dshPath = path.join(installedRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const nodePath = path.join(installedRoot, "node-runtime", process.platform === "win32" ? "node.exe" : "node");
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: path.join(temporaryRoot, "empty-bin"),
    APPDATA: path.join(temporaryRoot, "app-data"),
    LOCALAPPDATA: path.join(temporaryRoot, "AppData", "Local"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
  };
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.IPOLLOWORK_DSH_NODE_BIN;
  delete environment.IPOLLOWORK_NODE_BIN;
  delete environment.npm_node_execpath;

  try {
    await mkdir(path.dirname(dshPath), { recursive: true });
    await mkdir(path.dirname(nodePath), { recursive: true });
    await writeFile(dshPath, "#!/usr/bin/env node\n");
    await writeFile(nodePath, "bundled-node\n");
    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return userData;
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: version, codexHarness: "7.8.9" },
      env: environment,
      homeDir: path.join(temporaryRoot, "home"),
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    assert.equal(environment.IPOLLOWORK_DSH_CLI, dshPath);
    assert.equal(environment.IPOLLOWORK_DSH_NODE_BIN, nodePath);
    assert.equal((await manager.list()).find((engine) => engine.id === "deepseek-harness")?.source, "downloaded");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("discovers official Codex and DeepSeek resources in macOS installation locations", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-macos-engine-discovery-test-"));
  const homeDir = path.join(temporaryRoot, "home");
  const codexPath = path.join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex");
  const dshPath = path.join(
    homeDir,
    ".npm-global",
    "lib",
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: path.join(temporaryRoot, "empty-bin"),
    APPDATA: path.join(temporaryRoot, "app-data"),
    LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
  };
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.IPOLLOWORK_CODEX_CLI;

  try {
    await mkdir(path.dirname(codexPath), { recursive: true });
    await mkdir(path.dirname(dshPath), { recursive: true });
    await writeFile(codexPath, "official-codex-runtime\n");
    await writeFile(dshPath, "#!/usr/bin/env node\n");
    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: "7.8.9" },
      platform: "darwin",
      architecture: "arm64",
      env: environment,
      homeDir,
      probeRuntime: async () => true,
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const optionalEngines = (await manager.list()).filter((engine) => engine.id !== "opencode");
    assert.deepEqual(optionalEngines.map((engine) => engine.source), ["official", "official"]);
    assert.deepEqual(optionalEngines.map((engine) => engine.canUninstall), [false, false]);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, dshPath);
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, codexPath);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("does not treat unrelated commands with official engine names as official resources", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-impostor-test-"));
  const binDirectory = path.join(temporaryRoot, "unrelated-tools");
  const commandExtension = process.platform === "win32" ? ".exe" : "";
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: binDirectory,
    APPDATA: path.join(temporaryRoot, "app-data"),
    LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
  };
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.IPOLLOWORK_CODEX_CLI;

  try {
    await mkdir(binDirectory, { recursive: true });
    await writeFile(path.join(binDirectory, `codex${commandExtension}`), "unrelated-runtime\n");
    await writeFile(path.join(binDirectory, `dsh${commandExtension}`), "unrelated-runtime\n");
    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: "7.8.9" },
      env: environment,
      homeDir: path.join(temporaryRoot, "home"),
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const optionalEngines = (await manager.list()).filter((engine) => engine.id !== "opencode");
    assert.deepEqual(optionalEngines.map((engine) => engine.source), ["none", "none"]);
    assert.deepEqual(optionalEngines.map((engine) => engine.canInstall), [true, true]);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, undefined);
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, undefined);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
