import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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

test("installs and removes a bundled optional engine package without touching Work data", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-package-test-"));
  const userData = path.join(temporaryRoot, "user-data");
  const resourcesPath = path.join(temporaryRoot, "resources");
  const sourceDirectory = path.join(resourcesPath, "engine-packs");
  const workDataRoot = path.join(userData, "runtime-data");
  const sentinelPath = path.join(workDataRoot, "conversation.json");
  const version = "9.8.7";
  const { name, archive, checksum } = await createDshArchiveFixture(temporaryRoot, {
    platform: process.platform, architecture: process.arch, version,
  });
  const archivePath = path.join(sourceDirectory, name);
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(workDataRoot, { recursive: true });
  await writeFile(sentinelPath, '{"kept":true}\n');
  await writeFile(archivePath, archive);
  await writeFile(archivePath + ".sha256", checksum + "  " + name + "\n");
  let beforeUninstallCalls = 0;
  let resumeRuntimeCalls = 0;
  const env = { PATH: path.join(temporaryRoot, "empty-bin") };
  try {
    const manager = createEnginePackageManager({
      app: { getPath: () => userData, getVersion: () => "1.0.0", isPackaged: true },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      resourcesPath,
      versions: { opencode: "1.2.3", deepseekHarness: version },
      env,
      homeDir: path.join(temporaryRoot, "home"),
      fetch: async () => { throw new Error("fixture should not use the network"); },
      beforeUninstall: async () => {
        beforeUninstallCalls += 1;
        assert.equal(env.IPOLLOWORK_DSH_CLI, undefined);
        await manager.list();
        assert.equal(env.IPOLLOWORK_DSH_CLI, undefined, "settings polling must not reactivate an uninstalling engine");
        if (beforeUninstallCalls === 1) throw new Error("runtime is busy");
        return () => { resumeRuntimeCalls += 1; };
      },
    });
    assert.deepEqual((await manager.list()).map((engine) => [engine.id, engine.installed, engine.builtIn]), [
      ["opencode", true, true], ["deepseek-harness", false, false],
    ]);
    const installed = await manager.install("deepseek-harness");
    assert.equal(installed.status, "ready");
    assert.equal(installed.source, "downloaded");
    assert.equal(installed.canUninstall, true);
    assert.ok(installed.installedBytes > 0);
    assert.ok(env.IPOLLOWORK_DSH_CLI?.includes(path.join("engine-packs", "deepseek-harness")));
    assert.equal(await readFile(sentinelPath, "utf8"), '{"kept":true}\n');
    await rm(path.join(userData, "engine-packs", "deepseek-harness", version, process.platform + "-" + process.arch, ".installed.json"));
    const managedFallback = (await manager.list()).find((engine) => engine.id === "deepseek-harness");
    assert.equal(managedFallback?.source, "downloaded");
    assert.equal(managedFallback?.canUninstall, true);
    assert.equal(managedFallback?.installedBytes, null);
    await assert.rejects(manager.uninstall("deepseek-harness"), /runtime is busy/);
    assert.ok(env.IPOLLOWORK_DSH_CLI?.includes(path.join("engine-packs", "deepseek-harness")), "an interrupted uninstall restores the launch environment");
    const removed = await manager.uninstall("deepseek-harness");
    assert.equal(removed.installed, false);
    assert.equal(removed.source, "none");
    assert.equal(removed.canUninstall, false);
    assert.equal(beforeUninstallCalls, 2);
    assert.equal(resumeRuntimeCalls, 1);
    assert.equal(await readFile(sentinelPath, "utf8"), '{"kept":true}\n');
    assert.equal(existsSync(path.join(userData, "engine-packs", "deepseek-harness")), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("falls back to the latest mirrored release and rejects a corrupted mirror response", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-mirror-test-"));
  const version = "9.8.7";
  const name = `ipollowork-engine-deepseek-harness-${platformAssetSegment()}-${process.arch}-${version}.tar.gz`;
  const requestedUrls = [];

  try {
    const { archive, checksum } = await createDshArchiveFixture(temporaryRoot, {
      platform: process.platform, architecture: process.arch, version,
    });
    const officialArchive = `https://github.com/Devin-AXIS/iPolloWork/releases/download/v1.0.0/${name}`;
    const firstMirror = `https://gh-proxy.com/${officialArchive}`;
    const secondMirror = `https://ghfast.top/${officialArchive}`;
    const tagMetadata = "https://api.github.com/repos/Devin-AXIS/iPolloWork/releases/tags/v1.0.1-local";
    const latestMetadata = "https://api.github.com/repos/Devin-AXIS/iPolloWork/releases/latest";
    /** @type {NodeJS.ProcessEnv} */
    const environment = {
      ...process.env,
      PATH: path.join(temporaryRoot, "empty-bin"),
      APPDATA: path.join(temporaryRoot, "app-data"),
      LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
      ProgramFiles: path.join(temporaryRoot, "program-files"),
    };
    delete environment.IPOLLOWORK_DSH_CLI;
    delete environment.IPOLLOWORK_ENGINE_PACK_BASE_URL;
    delete environment.NPM_CONFIG_PREFIX;
    delete environment.PNPM_HOME;

    const manager = createEnginePackageManager({
      app: {
        getPath(name) {
          assert.equal(name, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.1-local"; },
        isPackaged: true,
      },
      desktopRoot: path.join(temporaryRoot, "desktop"),
      versions: { opencode: "1.2.3", deepseekHarness: version },
      env: environment,
      homeDir: path.join(temporaryRoot, "home"),
      fetch: async (url, init) => {
        requestedUrls.push(String(url));
        assert.ok(init?.signal);
        if (url === tagMetadata) return new Response("missing", { status: 404 });
        if (url === latestMetadata) return Response.json({
          assets: [{ name, digest: `sha256:${checksum}`, browser_download_url: officialArchive }],
        });
        if (url === officialArchive) throw new Error("net::ERR_CONNECTION_TIMED_OUT");
        if (url === firstMirror) return new Response("corrupted archive");
        if (url === secondMirror) return new Response(archive);
        return new Response("missing", { status: 404 });
      },
    });

    const installed = await manager.install("deepseek-harness");

    assert.equal(installed.status, "ready");
    assert.equal(installed.source, "downloaded");
    assert.ok(requestedUrls.includes(tagMetadata));
    assert.ok(requestedUrls.includes(latestMetadata));
    assert.ok(requestedUrls.includes(firstMirror));
    assert.ok(requestedUrls.includes(secondMirror));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("reports real streamed byte progress for DeepSeek engine downloads", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-progress-test-"));
  const baseUrl = "https://engine-packages.example.test";
  const version = "9.8.7";
  const fixtures = [
    {
      id: "deepseek-harness",
      cliRelativePath: path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    },
  ];
  const archives = new Map();
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: path.join(temporaryRoot, "empty-bin"),
    APPDATA: path.join(temporaryRoot, "app-data"),
    LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
    ProgramFiles: path.join(temporaryRoot, "program-files"),
    IPOLLOWORK_ENGINE_PACK_BASE_URL: baseUrl,
  };
  delete environment.IPOLLOWORK_CODEX_CLI;
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.NPM_CONFIG_PREFIX;
  delete environment.PNPM_HOME;

  try {
    for (const fixture of fixtures) {
      const fixtureRoot = path.join(temporaryRoot, `${fixture.id}-fixture`);
      const archivePath = path.join(temporaryRoot, `${fixture.id}.tar.gz`);
      const name = `ipollowork-engine-${fixture.id}-${platformAssetSegment()}-${process.arch}-${version}.tar.gz`;
      await mkdir(path.join(fixtureRoot, path.dirname(fixture.cliRelativePath)), { recursive: true });
      await writeFile(path.join(fixtureRoot, fixture.cliRelativePath), `${fixture.id}-runtime\n`);
      await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: fixture.id }));
      const packed = spawnSync(commandPath("tar"), ["-czf", archivePath, "-C", fixtureRoot, "."], { encoding: "utf8" });
      assert.equal(packed.status, 0, packed.stderr);
      const archive = await readFile(archivePath);
      archives.set(name, {
        archive,
        checksum: createHash("sha256").update(archive).digest("hex"),
      });
    }

    /** @type {{ current: null | { controller: ReadableStreamDefaultController<Uint8Array>; firstChunkSize: number; ready: Promise<unknown>; remainder: Uint8Array } }} */
    const activeDownload = { current: null };
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
      versions: { opencode: "1.2.3", deepseekHarness: version },
      env: environment,
      homeDir: path.join(temporaryRoot, "home"),
      fetch: async (url) => {
        const requestUrl = String(url);
        const name = requestUrl.slice(baseUrl.length + 1).replace(/\.sha256$/, "");
        const fixture = archives.get(name);
        if (!fixture) return new Response("missing", { status: 404 });
        if (requestUrl.endsWith(".sha256")) return new Response(`${fixture.checksum}  ${name}\n`);

        const firstChunkSize = Math.max(1, Math.floor(fixture.archive.byteLength / 2));
        let ready;
        const readyPromise = new Promise((resolve) => { ready = resolve; });
        const body = new ReadableStream({
          start(streamController) {
            streamController.enqueue(fixture.archive.subarray(0, firstChunkSize));
            activeDownload.current = {
              controller: streamController,
              firstChunkSize,
              ready: readyPromise,
              remainder: fixture.archive.subarray(firstChunkSize),
            };
            ready();
          },
        });
        return new Response(body, {
          headers: { "content-length": String(fixture.archive.byteLength) },
        });
      },
    });

    for (const fixture of fixtures) {
      activeDownload.current = null;
      const installPromise = manager.install(fixture.id);
      void installPromise.catch(() => undefined);
      for (let attempt = 0; attempt < 1_000 && !activeDownload.current; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const download = activeDownload.current;
      assert.ok(download, `${fixture.id} download did not start.`);
      await download.ready;

      let progress = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        progress = (await manager.list()).find((engine) => engine.id === fixture.id) ?? null;
        if (progress?.downloadedBytes === download.firstChunkSize) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(progress?.status, "downloading");
      assert.equal(progress?.downloadedBytes, download.firstChunkSize);
      assert.ok(progress.totalBytes > progress.downloadedBytes);

      download.controller.enqueue(download.remainder);
      download.controller.close();
      const installed = await installPromise;
      assert.equal(installed.status, "ready");
      assert.equal(installed.source, "downloaded");
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("installs a checksum-pinned DeepSeek Harness for Apple Silicon without GitHub metadata", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-macos-download-test-"));
  const resourcesPath = path.join(temporaryRoot, "resources");
  const sourceDirectory = path.join(resourcesPath, "engine-packs");
  const version = "9.8.7";
  const fixture = await createDshArchiveFixture(temporaryRoot, {
    platform: "darwin",
    architecture: "arm64",
    version,
  });
  const officialArchive = `https://github.com/Devin-AXIS/iPolloWork/releases/download/v1.0.0/${fixture.name}`;
  const requestedUrls = [];
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env, PATH: "" };
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR;

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, `${fixture.name}.sha256`), `${fixture.checksum}  ${fixture.name}\n`);
    const manager = createEnginePackageManager({
      app: {
        getPath(pathName) {
          assert.equal(pathName, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(resourcesPath, "app.asar"),
      resourcesPath,
      platform: "darwin",
      architecture: "arm64",
      versions: { opencode: "1.2.3", deepseekHarness: version },
      env: environment,
      homeDir: path.join(temporaryRoot, "empty-home"),
      fetch: async (url) => {
        requestedUrls.push(String(url));
        if (String(url).startsWith("https://api.github.com/")) {
          throw new Error("trusted packaged checksum must bypass GitHub metadata");
        }
        if (url === officialArchive) throw new Error("net::ERR_CONNECTION_TIMED_OUT");
        if (url === `https://gh-proxy.com/${officialArchive}`) return new Response("corrupted archive");
        if (url === `https://ghfast.top/${officialArchive}`) return new Response(fixture.archive);
        return new Response("missing", { status: 404 });
      },
    });

    const installed = await manager.install("deepseek-harness");
    assert.equal(installed.status, "ready");
    assert.equal(installed.source, "downloaded");
    assert.match(environment.IPOLLOWORK_DSH_CLI ?? "", /engine-packs[\\/]deepseek-harness/);
    assert.match(environment.IPOLLOWORK_DSH_NODE_BIN ?? "", /node-runtime[\\/]node$/);
    assert.ok(requestedUrls.includes(officialArchive));
    assert.ok(requestedUrls.includes(`https://gh-proxy.com/${officialArchive}`));
    assert.ok(requestedUrls.includes(`https://ghfast.top/${officialArchive}`));
    assert.equal(requestedUrls.some((url) => url.startsWith("https://api.github.com/")), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("installs a bundled DeepSeek Harness for Windows without using the network", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-windows-bundle-test-"));
  const resourcesPath = path.join(temporaryRoot, "resources");
  const sourceDirectory = path.join(resourcesPath, "engine-packs");
  const version = "9.8.7";
  const fixture = await createDshArchiveFixture(temporaryRoot, {
    platform: "win32",
    architecture: "x64",
    version,
  });
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env, PATH: "" };
  delete environment.IPOLLOWORK_DSH_CLI;
  delete environment.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR;

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, fixture.name), fixture.archive);
    await writeFile(path.join(sourceDirectory, `${fixture.name}.sha256`), `${fixture.checksum}  ${fixture.name}\n`);
    const manager = createEnginePackageManager({
      app: {
        getPath(pathName) {
          assert.equal(pathName, "userData");
          return path.join(temporaryRoot, "user-data");
        },
        getVersion() { return "1.0.0"; },
        isPackaged: true,
      },
      desktopRoot: path.join(resourcesPath, "app.asar"),
      resourcesPath,
      platform: "win32",
      architecture: "x64",
      versions: { opencode: "1.2.3", deepseekHarness: version },
      env: environment,
      homeDir: path.join(temporaryRoot, "empty-home"),
      fetch: async () => { throw new Error("bundled Windows install must not use the network"); },
    });

    const installed = await manager.install("deepseek-harness");
    assert.equal(installed.status, "ready");
    assert.equal(installed.source, "downloaded");
    assert.match(environment.IPOLLOWORK_DSH_CLI ?? "", /engine-packs[\\/]deepseek-harness/);
    assert.match(environment.IPOLLOWORK_DSH_NODE_BIN ?? "", /node-runtime[\\/]node\.exe$/);
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
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6" },
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
      versions: { opencode: "1.2.3", deepseekHarness: version },
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

test("discovers official DeepSeek resources in macOS installation locations", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-macos-engine-discovery-test-"));
  const homeDir = path.join(temporaryRoot, "home");
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
    await mkdir(path.dirname(dshPath), { recursive: true });
    await writeFile(dshPath, "#!/usr/bin/env node\n");
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
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6" },
      platform: "darwin",
      architecture: "arm64",
      env: environment,
      homeDir,
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const optionalEngines = (await manager.list()).filter((engine) => engine.id !== "opencode");
    assert.deepEqual(optionalEngines.map((engine) => engine.source), ["official"]);
    assert.deepEqual(optionalEngines.map((engine) => engine.canUninstall), [false]);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, resolvedDshPath);
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
      versions: { opencode: "1.2.3", deepseekHarness: "4.5.6" },
      env: environment,
      homeDir: path.join(temporaryRoot, "home"),
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    await manager.applyEnvironment();
    const optionalEngines = (await manager.list()).filter((engine) => engine.id !== "opencode");
    assert.deepEqual(optionalEngines.map((engine) => engine.source), ["none"]);
    assert.deepEqual(optionalEngines.map((engine) => engine.canInstall), [true]);
    assert.equal(environment.IPOLLOWORK_DSH_CLI, undefined);
    assert.equal(environment.IPOLLOWORK_CODEX_CLI, undefined);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("does not list, install, or activate Codex even when a previous runtime exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-retired-engine-"));
  const cli = path.join(root, "codex.exe");
  await writeFile(cli, "existing user installation");
  const env = { PATH: "", IPOLLOWORK_CODEX_CLI: cli };
  try {
    const manager = createEnginePackageManager({
      app: { getPath: () => root, getVersion: () => "1.0.0", isPackaged: true },
      desktopRoot: root,
      homeDir: root,
      env,
      fetch: async () => { throw new Error("Must not download Codex"); },
    });
    await manager.applyEnvironment();
    assert.deepEqual((await manager.list()).map((engine) => engine.id), ["opencode", "deepseek-harness"]);
    assert.throws(() => manager.install("codex-harness"), /Unsupported optional engine/);
    assert.throws(() => manager.uninstall("codex-harness"), /Unsupported optional engine/);
    assert.equal(await readFile(cli, "utf8"), "existing user installation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
