import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import afterPackModule from "../scripts/electron-after-pack.cjs";

const afterPack = afterPackModule.default ?? afterPackModule;

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
