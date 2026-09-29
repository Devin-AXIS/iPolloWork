import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

import { fetchDesktopResourceManifest } from "./desktop-resource-manifest.mjs";

const VIDEO_IDS = ["hyperframes-runtime", "hyperframes-registry", "ffmpeg", "ffprobe"];
const VIDEO_ID = "hyperframes-runtime";

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(output) : reject(new Error(error || `tar exited ${code}`)));
  });
}

async function assertSafeArchive(archivePath) {
  const safeName = (entry) => {
    const name = entry.replaceAll("\\", "/");
    return !name.startsWith("/") && !/^[A-Za-z]:\//.test(name) && !name.split("/").includes("..");
  };
  const entries = (await runTar(["-tzf", archivePath])).split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) throw new Error("Cloud resource archive is empty.");
  for (const entry of entries) {
    if (!safeName(entry)) {
      throw new Error(`Cloud resource archive contains an unsafe path: ${entry}`);
    }
  }
  const verbose = (await runTar(["-tvzf", archivePath])).split(/\r?\n/).filter(Boolean);
  if (verbose.some((entry) => {
    if (["-", "d"].includes(entry[0])) return false;
    const target = entry[0] === "h" ? entry.match(/ link to (.+)$/)?.[1] : null;
    return !target || !safeName(target);
  })) {
    throw new Error("Cloud resource archive contains a link or special file.");
  }
}

async function downloadArchive(resource, destination, fetch, onProgress) {
  const response = await fetch(resource.url);
  if (!response.ok || !response.body) throw new Error(`Cloud resource ${resource.id} returned HTTP ${response.status}.`);
  let bytes = 0;
  const hash = createHash("sha256");
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > resource.sizeBytes) return callback(new Error(`Cloud resource ${resource.id} is oversized.`));
      hash.update(chunk);
      onProgress(bytes);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(destination, { flags: "wx" }));
  if (bytes !== resource.sizeBytes || hash.digest("hex") !== resource.sha256) {
    throw new Error(`Cloud resource ${resource.id} failed size or SHA-256 verification.`);
  }
  await assertSafeArchive(destination);
}

export function createVideoResourceManager({ app, fetch, env = process.env, platform = process.platform, arch = process.arch, trustedKeys = undefined }) {
  const root = path.join(app.getPath("userData"), "desktop-resources", "video", app.getVersion());
  const marker = path.join(root, "current.json");
  let operation = null;
  let inFlight = null;

  async function currentPaths() {
    let record;
    try { record = JSON.parse(await readFile(marker, "utf8")); } catch { return null; }
    if (!/^[a-f0-9]{64}$/.test(record?.runtimeSha256 ?? "")) return null;
    const directory = path.join(root, record.runtimeSha256);
    const executable = platform === "win32" ? ".exe" : "";
    const paths = {
      cli: path.join(directory, VIDEO_ID, "packages", "cli", "bin", "hyperframes.mjs"),
      registry: path.join(directory, "hyperframes-registry"),
      ffmpeg: path.join(directory, "ffmpeg", `ffmpeg${executable}`),
      ffprobe: path.join(directory, "ffprobe", `ffprobe${executable}`),
    };
    if (!Object.values(paths).every(existsSync)
      || !existsSync(path.join(paths.registry, "registry.json"))) return null;
    return paths;
  }

  async function applyEnvironment() {
    const paths = await currentPaths();
    if (!paths) return null;
    env.HYPERFRAMES_CLI_PATH = paths.cli;
    env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = path.join(paths.registry, "blocks");
    env.IPOLLOWORK_HYPERFRAMES_CATALOG_ROOT = paths.registry;
    env.HYPERFRAMES_FFMPEG_PATH = paths.ffmpeg;
    env.HYPERFRAMES_FFPROBE_PATH = paths.ffprobe;
    return paths;
  }

  /** @returns {Promise<import("@ipollowork/types/desktop-ipc").EnginePackageInfo>} */
  async function info() {
    const paths = await currentPaths();
    return {
      id: VIDEO_ID,
      name: "HyperFrames 视频组件",
      version: app.getVersion(),
      status: operation?.status ?? (paths ? "ready" : "not-installed"),
      source: paths ? "downloaded" : "none",
      installed: Boolean(paths),
      builtIn: false,
      canInstall: !paths && (!operation || operation.status === "failed"),
      canUninstall: false,
      installedBytes: null,
      downloadedBytes: operation?.downloadedBytes ?? null,
      totalBytes: operation?.totalBytes ?? null,
      error: operation?.error ?? null,
    };
  }

  async function performInstall(baseUrl) {
    if (await currentPaths()) return info();
    operation = { status: "downloading", downloadedBytes: 0, totalBytes: null, error: null };
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ipollowork-video-resources-"));
    try {
      const manifest = await fetchDesktopResourceManifest({
        baseUrl,
        appVersion: app.getVersion(),
        platform,
        arch,
        fetch,
        trustedKeys,
      });
      const resources = VIDEO_IDS.map((id) => manifest.resources.find((item) => item.id === id));
      if (resources.some((item) => !item)) throw new Error("Cloud resource manifest is missing video components.");
      const totalBytes = resources.reduce((sum, item) => sum + item.sizeBytes, 0);
      let completedBytes = 0;
      operation.totalBytes = totalBytes;
      const staging = path.join(temporary, "runtime");
      await mkdir(staging);
      for (const resource of resources) {
        const archivePath = path.join(temporary, resource.fileName);
        await downloadArchive(resource, archivePath, fetch, (bytes) => {
          operation.downloadedBytes = completedBytes + bytes;
        });
        completedBytes += resource.sizeBytes;
        operation.status = "installing";
        const directory = path.join(staging, resource.id);
        await mkdir(directory);
        await runTar(["-xzf", archivePath, "-C", directory]);
        operation.status = "downloading";
      }
      const executable = platform === "win32" ? ".exe" : "";
      for (const expected of [
        path.join(staging, VIDEO_ID, "packages", "cli", "bin", "hyperframes.mjs"),
        path.join(staging, "hyperframes-registry", "registry.json"),
        path.join(staging, "ffmpeg", `ffmpeg${executable}`),
        path.join(staging, "ffprobe", `ffprobe${executable}`),
      ]) {
        if (!(await stat(expected).catch(() => null))?.isFile()) throw new Error(`Cloud video resource is missing ${path.basename(expected)}.`);
      }
      const runtimeSha256 = resources[0].sha256;
      await mkdir(root, { recursive: true });
      const destination = path.join(root, runtimeSha256);
      if (!existsSync(destination)) await rename(staging, destination);
      const nextMarker = path.join(root, `current-${process.pid}.json`);
      await writeFile(nextMarker, JSON.stringify({ runtimeSha256, versions: Object.fromEntries(resources.map((item) => [item.id, item.version])) }));
      await rename(nextMarker, marker);
      operation = null;
      await applyEnvironment();
      return info();
    } catch (error) {
      operation = { status: "failed", error: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  function install(baseUrl) {
    if (inFlight) return inFlight;
    inFlight = performInstall(baseUrl).finally(() => { inFlight = null; });
    return inFlight;
  }

  return { applyEnvironment, currentPaths, info, install };
}
