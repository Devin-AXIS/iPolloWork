import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVideoResourceManager } from "./video-resource-manager.mjs";

test("bundled models resolve beside codecs and respect an explicit offline model directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-video-model-path-"));
  try {
    for (const id of ["ffmpeg", "ffprobe"]) {
      const directory = path.join(root, "video-codecs", id);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, process.platform === "win32" ? `${id}.exe` : id), "test executable");
    }
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    const options = { app: { isPackaged: true, getVersion: () => "0.50.16" }, resourcesPath: root, env, probeBinary: async () => "fixture" };
    assert.equal((await createVideoResourceManager(options).info()).status, "ready");
    assert.equal(env.IPOLLOWORK_VIDEO_MODELS_PATH, path.join(root, "video-models"));
    env.IPOLLOWORK_VIDEO_MODELS_PATH = path.join(root, "offline-models");
    await createVideoResourceManager(options).info();
    assert.equal(env.IPOLLOWORK_VIDEO_MODELS_PATH, path.join(root, "offline-models"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
    const manager = createVideoResourceManager({ app: { isPackaged: true, getVersion: () => "0.50.16" }, resourcesPath: root, env });
    const info = await manager.info();
    assert.equal(info.status, "ready");
    assert.equal(info.version, "0.50.16");
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
    const manager = createVideoResourceManager({ app: { isPackaged: true, getVersion: () => "0.50.16" }, resourcesPath: root, env });
    assert.equal((await manager.info()).status, "failed");
    assert.equal(env.HYPERFRAMES_FFMPEG_PATH, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("development repairs previously downloaded codecs without replacing packages", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-video-resource-test-"));
  try {
    for (const id of ["ffmpeg", "ffprobe"]) {
      await writeFile(path.join(root, id), `#!/bin/sh\necho '${id} version fixture'\n`, { mode: 0o644 });
    }
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    const manager = createVideoResourceManager({
      app: { isPackaged: false, getVersion: () => "35.7.5" }, env,
      resolveDevelopmentBinary: (id) => path.join(root, id),
    });
    const info = await manager.info();
    assert.equal(info.status, "ready");
    const desktopPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(info.version, desktopPackage.version);
    for (const id of ["ffmpeg", "ffprobe"]) {
      assert.equal((await stat(path.join(root, id))).mode & 0o777, 0o744);
    }
    // An invalid executable must still fail its real version check after repair.
    await writeFile(path.join(root, "ffprobe"), "#!/bin/sh\necho unrelated\n");
    const broken = createVideoResourceManager({
      app: { isPackaged: false, getVersion: () => "35.7.5" }, env,
      resolveDevelopmentBinary: (id) => path.join(root, id),
    });
    assert.equal((await broken.info()).status, "failed");
    assert.equal(env.HYPERFRAMES_FFMPEG_PATH, undefined);
    assert.equal(env.HYPERFRAMES_FFPROBE_PATH, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
