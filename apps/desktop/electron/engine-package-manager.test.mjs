import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createEnginePackageManager } from "./engine-package-manager.mjs";

function platformAssetSegment(platform = process.platform) {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return platform;
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

async function createDshArchiveFixture(temporaryRoot, { platform, architecture, version }) {
  const fixtureRoot = path.join(temporaryRoot, `${platform}-${architecture}-fixture`);
  const name = `ipollowork-engine-deepseek-harness-${platformAssetSegment(platform)}-${architecture}-${version}.tar.gz`;
  const archivePath = path.join(temporaryRoot, name);
  const cliRelativePath = path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const nodeRelativePath = path.join("node-runtime", platform === "win32" ? "node.exe" : "node");
  await mkdir(path.join(fixtureRoot, path.dirname(cliRelativePath)), { recursive: true });
  await mkdir(path.join(fixtureRoot, path.dirname(nodeRelativePath)), { recursive: true });
  await writeFile(path.join(fixtureRoot, cliRelativePath), "fixture-runtime\n");
  await writeFile(path.join(fixtureRoot, nodeRelativePath), "fixture-node\n");
  await writeFile(path.join(fixtureRoot, "ipollowork-host-tools.mjs"), "export {};\n");
  await writeFile(path.join(fixtureRoot, "package.json"), '{"name":"fixture"}\n');
  const packed = spawnSync(commandPath("tar"), ["-czf", archivePath, "-C", fixtureRoot, "."], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const archive = await readFile(archivePath);
  return {
    archive,
    checksum: createHash("sha256").update(archive).digest("hex"),
    name,
  };
}

function signedCloudResponse(origin, archive, name, checksum, privateKey) {
  const ids = ["codex-harness", "deepseek-harness", "ffmpeg", "ffprobe"];
  const manifest = {
    schemaVersion: 1,
    appVersion: "0.50.13",
    platform: platformAssetSegment(),
    arch: process.arch,
    resources: ids.map((id) => ({
      id,
      version: id === "deepseek-harness" ? "4.5.6" : "1.0.0",
      fileName: id === "deepseek-harness" ? name : `ipollowork-${id}-1.0.0.tar.gz`,
      format: "tar.gz",
      sizeBytes: archive.length,
      sha256: checksum,
      url: `${origin}/${id}.tar.gz`,
    })),
  };
  const payload = Buffer.from(JSON.stringify(manifest));
  return {
    ...manifest,
    signature: {
      algorithm: "Ed25519",
      keyId: "test",
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
      payload: payload.toString("base64url"),
      value: sign(null, payload, privateKey).toString("base64url"),
    },
  };
}

for (const corrupted of [false, true]) {
  test(`installs a signed cloud DeepSeek package and rejects corrupted bytes (${corrupted ? "corrupt" : "valid"})`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-cloud-engine-test-"));
    const userData = path.join(root, "user-data");
    const workFile = path.join(userData, "runtime-data", "conversation.json");
    const { archive, checksum, name } = await createDshArchiveFixture(root, {
      platform: process.platform,
      architecture: process.arch,
      version: "4.5.6",
    });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const origin = "http://127.0.0.1:3000";
    const manifest = signedCloudResponse(origin, archive, name, checksum, privateKey);
    const env = { PATH: path.join(root, "bin"), APPDATA: path.join(root, "app-data"), LOCALAPPDATA: path.join(root, "local-app-data") };
    const requested = [];
    await mkdir(path.dirname(workFile), { recursive: true });
    await writeFile(workFile, "kept");
    try {
      const manager = createEnginePackageManager({
        app: { getPath: () => userData, getVersion: () => "0.50.13", isPackaged: true },
        desktopRoot: path.join(root, "desktop"),
        versions: { opencode: "1.0.0", deepseekHarness: "4.5.6", codexHarness: "1.0.0" },
        env,
        homeDir: path.join(root, "home"),
        trustedResourceKeys: { test: publicKey.export({ type: "spki", format: "pem" }).toString() },
        fetch: async (url) => {
          requested.push(url);
          if (url.includes("/api/v1/desktop/resources?")) {
            return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });
          }
          assert.equal(url, `${origin}/deepseek-harness.tar.gz`);
          return new Response(corrupted ? Buffer.from("bad archive") : archive);
        },
      });
      if (corrupted) {
        await assert.rejects(manager.install("deepseek-harness", origin), /size mismatch|checksum/i);
        assert.equal((await manager.list()).find((item) => item.id === "deepseek-harness").installed, false);
      } else {
        const installed = await manager.install("deepseek-harness", origin);
        assert.equal(installed.source, "downloaded");
        assert.equal(installed.status, "ready");
        assert.ok(existsSync(env.IPOLLOWORK_DSH_CLI));
      }
      assert.equal(await readFile(workFile, "utf8"), "kept");
      assert.equal(requested.length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

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
    const resolvedOfficialCli = await realpath(officialCli);
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
      probeRuntime: async ({ executablePath }) => executablePath === resolvedOfficialCli,
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    const beforeStartup = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(beforeStartup?.source, "official");
    assert.equal(beforeStartup?.canInstall, false);
    assert.equal(beforeStartup?.canUninstall, false);

    await manager.applyEnvironment();
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, resolvedOfficialCli);
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
  delete environment.NPM_CONFIG_PREFIX;
  delete environment.PNPM_HOME;
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
    const resolvedBlockedCodexPath = blockedCodexPath ? await realpath(blockedCodexPath) : null;
    const resolvedCodexPath = await realpath(codexPath);
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
        return executablePath === resolvedCodexPath;
      },
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const codex = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(codex?.source, "official");
    assert.equal(codex?.canInstall, false);
    assert.equal(codex?.canUninstall, false);
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, resolvedCodexPath);
    if (resolvedBlockedCodexPath) assert.ok(probedPaths.includes(resolvedBlockedCodexPath));
    assert.ok(probedPaths.includes(resolvedCodexPath));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("selects the newest runnable cached Codex version, keeps explicit overrides, and bounds failed probes", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codex-cache-version-test-"));
  const environment = {
    PATH: path.join(root, "empty-bin"),
    APPDATA: path.join(root, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(root, "AppData", "Local"),
    ProgramFiles: path.join(root, "program-files"),
  };
  const builds = [
    ["000-old", "0.148.0-alpha.15"],
    ["111-alpha", "0.153.0-alpha.15"],
    ["222-stable", "0.153.0"],
    ["333-unknown", true],
    ["444-broken", false],
  ];
  const versions = new Map();
  try {
    for (const [hash, version] of builds) {
      const cli = path.join(environment.LOCALAPPDATA, "OpenAI", "Codex", "bin", String(hash), "codex.exe");
      await mkdir(path.dirname(cli), { recursive: true });
      await writeFile(cli, "fixture\n");
      versions.set(await realpath(cli), version);
    }
    const probes = new Map();
    const options = {
      app: { getPath: () => path.join(root, "user-data"), getVersion: () => "1.0.0", isPackaged: true },
      desktopRoot: path.join(root, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6", codexHarness: "7.8.9" },
      env: environment,
      homeDir: path.join(root, "home"),
      probeRuntime: async ({ executablePath }) => {
        probes.set(executablePath, (probes.get(executablePath) ?? 0) + 1);
        return versions.get(executablePath) ?? false;
      },
      fetch: async () => { throw new Error("fixture must not use the network"); },
    };
    const manager = createEnginePackageManager(options);
    await manager.applyEnvironment();
    await manager.list();
    assert.match(environment.IPOLLOWORK_CODEX_CLI, /222-stable[\\/]codex\.exe$/);
    assert.deepEqual([...probes.values()], [1, 1, 1, 1, 2]);
    const explicit = [...versions.keys()][0];
    const overrideEnv = { ...environment, IPOLLOWORK_CODEX_CLI: explicit };
    await createEnginePackageManager({ ...options, env: overrideEnv }).applyEnvironment();
    assert.equal(overrideEnv.IPOLLOWORK_CODEX_CLI, explicit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers local Codex discovery after transient failures without redundant downloads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codex-probe-recovery-"));
  const bin = path.join(root, "Codex.app", "Contents", "Resources");
  const officialCli = path.join(bin, process.platform === "win32" ? "codex.exe" : "codex");
  await mkdir(bin, { recursive: true });
  await writeFile(officialCli, "official-runtime\n");
  const resolvedCli = await realpath(officialCli);
  try {
    for (const recovery of ["retry", "exception", "refresh", "install"]) {
      await t.test(recovery, async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
        const userData = path.join(root, recovery);
        const environment = { PATH: bin, APPDATA: path.join(root, "app-data"), LOCALAPPDATA: path.join(root, "local-app-data") };
        const managedCli = path.join(userData, "engine-packs", "codex-harness", "7.8.9", `${process.platform}-${process.arch}`, codexCliRelativePath());
        if (recovery === "refresh") {
          await mkdir(path.dirname(managedCli), { recursive: true });
          await writeFile(managedCli, "running-managed-runtime\n");
        }
        let probes = 0;
        let available = false;
        let downloads = 0;
        const manager = createEnginePackageManager({
          app: { getPath: () => userData, getVersion: () => "1.0.0", isPackaged: true },
          desktopRoot: path.join(root, "desktop"),
          versions: { codexHarness: "7.8.9" },
          env: environment,
          homeDir: path.join(root, "home"),
          probeRuntime: async ({ executablePath }) => {
            assert.equal(executablePath, resolvedCli);
            probes += 1;
            if (recovery === "exception" && probes === 1) throw new Error("temporary spawn failure");
            return available || ((recovery === "retry" || recovery === "exception") && probes > 1)
              ? "0.154.0-alpha.6.2" : false;
          },
          fetch: async () => { downloads += 1; throw new Error("must reuse the local Codex"); },
        });
        await Promise.all([manager.applyEnvironment(), manager.list(), manager.list()]);
        assert.equal(probes, 2, "concurrent discovery shares a single bounded retry");
        if (recovery === "retry" || recovery === "exception") {
          assert.equal(environment.IPOLLOWORK_CODEX_CLI, resolvedCli);
        } else {
          assert.equal(environment.IPOLLOWORK_CODEX_CLI, recovery === "refresh" ? managedCli : undefined);
          available = true;
          context.mock.timers.tick(29_999);
          const cached = (await manager.list()).find((engine) => engine.id === "codex-harness");
          assert.equal(cached.source, recovery === "refresh" ? "downloaded" : "none");
          assert.equal(probes, 2, "polling does not repeatedly spawn an unavailable executable");
          if (recovery === "refresh") {
            context.mock.timers.tick(1);
          } else {
            const installed = await manager.install("codex-harness");
            assert.equal(installed.source, "official", "install rechecks before the failure cache expires");
          }
        }
        const recovered = (await manager.list()).find((engine) => engine.id === "codex-harness");
        assert.equal(recovered.source, "official");
        assert.equal(recovered.canInstall, false);
        assert.equal(environment.IPOLLOWORK_CODEX_CLI, resolvedCli, "the next launch uses the discovered system runtime");
        assert.equal(downloads, 0);
        assert.equal(probes, recovery === "retry" || recovery === "exception" ? 2 : 3);
        if (recovery === "refresh") assert.equal(await readFile(managedCli, "utf8"), "running-managed-runtime\n");
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses only a compatible official DeepSeek Harness installation", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-dsh-official-test-"));
  const homeDir = path.join(temporaryRoot, "home");
  const appData = path.join(temporaryRoot, "app-data");
  const binDirectory = process.platform === "win32"
    ? path.join(appData, "npm")
    : path.join(homeDir, ".local", "bin");
  const dshCommand = path.join(binDirectory, process.platform === "win32" ? "dsh.cmd" : "dsh");
  const dshEntrypoint = process.platform === "win32"
    ? path.join(binDirectory, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
    : path.join(homeDir, ".local", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
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
  delete environment.NPM_CONFIG_PREFIX;
  delete environment.PNPM_HOME;

  try {
    await mkdir(binDirectory, { recursive: true });
    await mkdir(path.dirname(dshEntrypoint), { recursive: true });
    await writeFile(dshCommand, process.platform === "win32" ? "@echo off\r\n" : "#!/usr/bin/env node\n");
    await writeFile(dshEntrypoint, "#!/usr/bin/env node\n");
    const dshManifest = path.resolve(path.dirname(dshEntrypoint), "..", "package.json");
    await writeFile(dshManifest, JSON.stringify({ version: "4.5.5" }));
    const resolvedDshEntrypoint = await realpath(dshEntrypoint);
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
    assert.equal((await manager.list()).find((engine) => engine.id === "deepseek-harness")?.installed, false);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, undefined);

    await writeFile(dshManifest, JSON.stringify({ version: "4.5.6" }));
    await manager.applyEnvironment();
    const dsh = (await manager.list()).find((engine) => engine.id === "deepseek-harness");
    assert.equal(dsh?.installed, true);
    assert.equal(dsh?.source, "official");
    assert.equal(dsh?.canInstall, false);
    assert.equal(dsh?.canUninstall, false);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, resolvedDshEntrypoint);
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
  delete environment.NPM_CONFIG_PREFIX;
  delete environment.PNPM_HOME;

  try {
    await mkdir(path.dirname(codexPath), { recursive: true });
    await mkdir(path.dirname(dshPath), { recursive: true });
    await writeFile(codexPath, "official-codex-runtime\n");
    await writeFile(dshPath, "#!/usr/bin/env node\n");
    await writeFile(
      path.resolve(path.dirname(dshPath), "..", "package.json"),
      JSON.stringify({ version: "4.5.6" }),
    );
    const resolvedCodexPath = await realpath(codexPath);
    const resolvedDshPath = await realpath(dshPath);
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
      probeRuntime: async ({ executablePath }) => executablePath === resolvedCodexPath,
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const optionalEngines = (await manager.list()).filter((engine) => engine.id !== "opencode");
    assert.deepEqual(optionalEngines.map((engine) => engine.source), ["official", "official"]);
    assert.deepEqual(optionalEngines.map((engine) => engine.canUninstall), [false, false]);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, resolvedDshPath);
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, resolvedCodexPath);
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
  delete environment.NPM_CONFIG_PREFIX;
  delete environment.PNPM_HOME;

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
      probeRuntime: async () => false,
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
