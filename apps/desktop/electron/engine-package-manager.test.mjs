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
  const clientResources = path.join(temporaryRoot, "Codex.app", "Contents", "Resources");
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
  await mkdir(clientResources, { recursive: true });
  await writeFile(path.join(clientResources, process.platform === "win32" ? "codex.EXE" : "codex"), "client-runtime\n");
  await writeFile(path.join(fixtureRoot, codexCliRelativePath()), "fixture-runtime\n");
  await writeFile(path.join(fixtureRoot, "package.json"), '{"name":"fixture"}\n');
  await writeFile(sentinelPath, '{"kept":true}\n');
  const packed = spawnSync(tarPath, ["-czf", archivePath, "-C", fixtureRoot, "."], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  await writeFile(`${archivePath}.sha256`, `${checksum}  ${name}\n`);

  let beforeUninstallCalls = 0;
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
      fetch: async () => { throw new Error("fixture should not use the network"); },
      beforeUninstall: async () => {
        beforeUninstallCalls += 1;
        assert.equal(process.env.IPOLLOWORK_CODEX_CLI, undefined);
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
    assert.ok(process.env.IPOLLOWORK_CODEX_CLI?.includes(path.join("engine-packs", "codex-harness")));
    assert.equal(await readFile(sentinelPath, "utf8"), '{"kept":true}\n');

    process.env.PATH = `${clientResources}${path.delimiter}${path.dirname(tarPath)}`;
    const managedPreferred = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(managedPreferred?.source, "downloaded");
    assert.equal(managedPreferred?.canUninstall, true);

    const removed = await manager.uninstall("codex-harness");
    assert.equal(removed.installed, true);
    assert.equal(removed.source, "desktop-client");
    assert.equal(removed.canUninstall, false);
    assert.equal(beforeUninstallCalls, 1);
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

test("identifies Codex supplied by a desktop client and leaves it externally managed", async () => {
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
      fetch: async () => { throw new Error("fixture should not use the network"); },
    });

    const codex = (await manager.list()).find((engine) => engine.id === "codex-harness");
    assert.equal(codex?.installed, true);
    assert.equal(codex?.source, "desktop-client");
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
