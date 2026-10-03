import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVideoResourceManager } from "./video-resource-manager.mjs";

test("packaged codecs work offline without a cloud manifest or user cache", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-video-resource-test-"));
  try {
    for (const id of ["ffmpeg", "ffprobe"]) {
      const directory = path.join(root, "video-codecs", id);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, id), `#!/bin/sh\necho '${id} version fixture'\n`);
      await chmod(path.join(directory, id), 0o755);
    }
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    const manager = createVideoResourceManager({ app: { isPackaged: true }, resourcesPath: root, env });
    const info = await manager.info();
    assert.equal(info.status, "ready");
    assert.equal(info.builtIn, true);
    assert.equal(info.canInstall, false);
    assert.equal(info.source, "bundled");
    assert.equal(env.HYPERFRAMES_FFMPEG_PATH, path.join(root, "video-codecs", "ffmpeg", "ffmpeg"));
    assert.equal((await manager.info()).status, "ready");
    await rm(path.join(root, "video-codecs", "ffprobe", "ffprobe"));
    assert.equal((await manager.info()).installed, false);
    assert.equal(env.HYPERFRAMES_FFMPEG_PATH, undefined);
    assert.match((await manager.info()).error, /完整打包/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a broken bundled executable cannot be reported ready", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-video-resource-test-"));
  try {
    for (const id of ["ffmpeg", "ffprobe"]) {
      const directory = path.join(root, "video-codecs", id);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, id), "invalid executable");
    }
    const env = { HYPERFRAMES_FFMPEG_PATH: "stale" };
    const manager = createVideoResourceManager({ app: { isPackaged: true }, resourcesPath: root, env });
    assert.equal((await manager.info()).status, "failed");
    assert.equal(env.HYPERFRAMES_FFMPEG_PATH, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
