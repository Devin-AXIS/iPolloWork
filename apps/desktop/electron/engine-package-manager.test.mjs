import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createEnginePackageManager, run } from "./engine-package-manager.mjs";

test("engine package commands drain stdout and stderr before settling", async () => {
  const delayedOutput = String.raw`setTimeout(() => {
    process.stdout.write("archive-entry\n");
    process.stderr.write("archive-diagnostic\n");
  }, 50);`;
  for (const code of [0, 7]) {
    const parent = `const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", ${JSON.stringify(delayedOutput)}], { stdio: ["ignore", 1, 2] });
      child.once("spawn", () => process.exit(${code}));`;
    // Windows pipes cannot be inherited by a grandchild like POSIX descriptors.
    const script = process.platform === "win32" ? `${delayedOutput}\nsetTimeout(() => process.exit(${code}), 100);` : parent;
    const result = run(process.execPath, ["-e", script]);
    if (code === 0) assert.deepEqual(await result, { stdout: "archive-entry\n", stderr: "archive-diagnostic\n" });
    else await assert.rejects(result, /failed \(7\): archive-diagnostic/);
  }
});

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
        app: { getPath: () => userData, getVersion: () => "0.50.14", isPackaged: true },
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
      assert.equal(new URL(requested[0]).searchParams.get("appVersion"), "0.50.13");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const isPackaged of [false, true]) {
  test(`Codex uses only the pinned managed runtime in ${isPackaged ? "packaged" : "development"} mode`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codex-isolation-"));
    const userData = path.join(root, "user-data");
    const cli = path.join(userData, "engine-packs", "codex-harness", "0.149.0", `${process.platform}-${process.arch}`, codexCliRelativePath());
    const personal = path.join(root, "ChatGPT.app", "Contents", "Resources", "codex");
    const env = { PATH: path.dirname(personal), IPOLLOWORK_CODEX_CLI: personal, IPOLLOWORK_CODEX_CLI_VERSION: "0.167.0" };
    const probes = [];
    try {
      await mkdir(path.dirname(personal), { recursive: true });
      await writeFile(personal, "personal-runtime-kept");
      const manager = createEnginePackageManager({
        app: { getPath: () => userData, getVersion: () => "1.0.0", isPackaged },
        versions: { codexHarness: "0.149.0" }, env, homeDir: path.join(root, "home"),
        probeRuntime: async ({ executablePath }) => { probes.push(executablePath); return "0.149.0"; },
        fetch: async () => { throw new Error("No implicit download"); },
      });
      let codex = (await manager.list()).find(e => e.id === "codex-harness");
      assert.equal(codex.installed, false);
      assert.equal(codex.canInstall, true);
      assert.match(codex.error, /0.149.0/);
      assert.equal(env.IPOLLOWORK_CODEX_CLI, undefined);
      assert.equal(probes.length, 0);
      await mkdir(path.dirname(cli), { recursive: true });
      await writeFile(cli, "managed-runtime");
      await manager.applyEnvironment();
      codex = (await manager.list()).find(e => e.id === "codex-harness");
      assert.equal(codex.source, "downloaded");
      assert.equal(codex.version, "0.149.0");
      assert.equal(codex.installed, true);
      assert.equal(codex.canUninstall, true);
      assert.equal(env.IPOLLOWORK_CODEX_CLI, cli);
      assert.equal(env.IPOLLOWORK_CODEX_CLI_VERSION, "0.149.0");
      assert.equal((await manager.install("codex-harness")).source, "downloaded");
      assert.ok(probes.every(p => p === cli));
      assert.equal(await readFile(personal, "utf8"), "personal-runtime-kept");
      assert.equal(existsSync(cli), true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const version of ["0.167.0", false, true]) {
  test(`Codex rejects an invalid managed version (${version}) and recovers after replacement`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codex-invalid-"));
    const cli = path.join(root, "engine-packs", "codex-harness", "0.149.0", `${process.platform}-${process.arch}`, codexCliRelativePath());
    const env = { PATH: "", IPOLLOWORK_CODEX_CLI: "/personal/codex" };
    let actualVersion = version;
    try {
      await mkdir(path.dirname(cli), { recursive: true });
      await writeFile(cli, "bad");
      const manager = createEnginePackageManager({
        app: { getPath: () => root, getVersion: () => "1.0.0" }, versions: { codexHarness: "0.149.0" }, env,
        probeRuntime: async () => actualVersion, fetch: async () => { throw new Error("No fallback download"); },
      });
      const invalid = (await manager.list()).find(e => e.id === "codex-harness");
      assert.equal(invalid.installed, false);
      assert.equal(invalid.canInstall, true);
      assert.match(invalid.error, /损坏或版本不符/);
      assert.equal(env.IPOLLOWORK_CODEX_CLI, undefined);
      actualVersion = "0.149.0";
      await writeFile(cli, "replaced-valid-runtime");
      assert.equal((await manager.list()).find(e => e.id === "codex-harness").installed, true);
      await rm(cli);
      assert.equal((await manager.list()).find(e => e.id === "codex-harness").installed, false);
      assert.equal(env.IPOLLOWORK_CODEX_CLI, undefined);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("missing optional engines never download on startup or availability refresh", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-optional-engine-test-"));
  const env = { PATH: path.join(root, "empty-bin") };
  let downloads = 0;
  try {
    const manager = createEnginePackageManager({
      app: { getPath: () => path.join(root, "user-data"), getVersion: () => "1.0.0", isPackaged: true },
      desktopRoot: path.join(root, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: "0.0.0-fixture", codexHarness: "7.8.9" },
      homeDir: path.join(root, "home"),
      env,
      probeRuntime: async () => false,
      fetch: async () => { downloads += 1; throw new Error("installation requires user action"); },
    });
    await manager.applyEnvironment();
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const engines = await manager.list();
      const opencode = engines.find((engine) => engine.id === "opencode");
      assert.equal(opencode?.status, "ready");
      assert.equal(opencode?.installed, true);
      for (const engine of engines.filter((item) => item.id !== "opencode")) {
        assert.equal(engine.status, "not-installed");
        assert.equal(engine.source, "none");
        assert.equal(engine.canInstall, true);
        assert.equal(engine.canUninstall, false);
      }
    }
    assert.equal(downloads, 0);
    assert.equal(env.IPOLLOWORK_CODEX_CLI, undefined);
    assert.equal(env.IPOLLOWORK_DSH_CLI, undefined);
    assert.equal(existsSync(path.join(root, "user-data", "engine-packs")), false);
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

test("discovers official DeepSeek resources but ignores personal Codex in macOS installation locations", async () => {
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
    assert.deepEqual(optionalEngines.map((engine) => engine.source), ["official", "none"]);
    assert.deepEqual(optionalEngines.map((engine) => engine.canUninstall), [false, false]);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, resolvedDshPath);
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, undefined);
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
