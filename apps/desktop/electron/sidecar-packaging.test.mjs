import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import afterPackModule from "../scripts/electron-after-pack.cjs";
import { stageServerConstants } from "../scripts/server-packaging.mjs";

const afterPack = afterPackModule.default ?? afterPackModule;

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
const { assertPackagedNodePty } = afterPackModule;

async function createWindowsFixture(triple) {
  const appOutDir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-after-pack-"));
  const sidecarsDir = path.join(appOutDir, "resources", "sidecars");
  await mkdir(sidecarsDir, { recursive: true });

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
  ["arm64", "aarch64-pc-windows-msvc"],
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
        `ipollowork-orchestrator-${triple}.exe`,
        "opencode.exe",
        `opencode-${triple}.exe`,
        "versions.json",
        `versions.json-${triple}.exe`,
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
