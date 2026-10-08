import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fetchDesktopResourceManifest } from "./desktop-resource-manifest.mjs";
import { DESKTOP_RESOURCE_APP_VERSION } from "./app-version.mjs";

const VIDEO_IDS = ["ffmpeg", "ffprobe"];
const VIDEO_ID = "video-codecs";
const BINARY_PROBE_TIMEOUT_MS = 10_000;
const DOWNLOAD_REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const DOWNLOAD_ATTEMPTS = 8;
const DOWNLOAD_PARTS = 4;
const DOWNLOAD_CONCURRENCY = 3;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function installError(error, { baseUrl, appVersion, platform, arch }) {
  const message = errorMessage(error);
  const targetPlatform = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform;
  const target = `${appVersion}/${targetPlatform}/${arch}`;
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|fetch failed/i.test(message)) {
    return new Error(`无法连接视频资源服务 ${baseUrl}。请检查服务地址，或由管理员发布 ${target} 的完整桌面资源。`, { cause: error });
  }
  if (/HTTP 404|RESOURCE_RELEASE_NOT_FOUND/i.test(message)) {
    return new Error(`视频资源版本 ${target} 尚未发布。请先发布包含 FFmpeg 和 FFprobe 的完整桌面资源，再重试。`, { cause: error });
  }
  return error instanceof Error ? error : new Error(message);
}

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

async function sha256File(targetPath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(targetPath)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadRange(resource, destination, start, end, fetch, onProgress) {
  const expectedBytes = end - start + 1;
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    let downloaded = (await stat(destination).catch(() => null))?.size ?? 0;
    if (downloaded > expectedBytes) {
      await rm(destination, { force: true });
      downloaded = 0;
    }
    if (downloaded === expectedBytes) return;
    const controller = new AbortController();
    let rejectRequestTimeout;
    const requestTimedOut = new Promise((_, reject) => { rejectRequestTimeout = reject; });
    const requestTimeout = setTimeout(() => {
      controller.abort();
      rejectRequestTimeout(new Error(`Cloud resource ${resource.id} request timed out.`));
    }, DOWNLOAD_REQUEST_TIMEOUT_MS);
    try {
      const requestStart = start + downloaded;
      const response = await Promise.race([
        fetch(resource.url, {
          headers: { Range: `bytes=${requestStart}-${end}` },
          signal: controller.signal,
        }),
        requestTimedOut,
      ]);
      clearTimeout(requestTimeout);
      const contentRange = response.headers.get("content-range") ?? "";
      if (response.status !== 206 || !response.body || !contentRange.startsWith(`bytes ${requestStart}-`)) {
        throw new Error(`Cloud resource ${resource.id} returned HTTP ${response.status}.`);
      }
      const handle = await open(destination, downloaded > 0 ? "a" : "w");
      const reader = response.body.getReader();
      let idleTimeout;
      let rejectIdle;
      const stalled = new Promise((_, reject) => { rejectIdle = reject; });
      const resetIdleTimeout = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          controller.abort();
          rejectIdle(new Error(`Cloud resource ${resource.id} download stalled.`));
        }, DOWNLOAD_IDLE_TIMEOUT_MS);
      };
      resetIdleTimeout();
      try {
        while (true) {
          const result = await Promise.race([reader.read(), stalled]);
          if (result.done) break;
          const chunk = Buffer.from(result.value);
          if (chunk.byteLength === 0) continue;
          if (downloaded + chunk.byteLength > expectedBytes) {
            throw new Error(`Cloud resource ${resource.id} is oversized.`);
          }
          await handle.write(chunk);
          downloaded += chunk.byteLength;
          onProgress(downloaded);
          resetIdleTimeout();
        }
      } finally {
        clearTimeout(idleTimeout);
        await handle.close();
      }
      if (downloaded === expectedBytes) return;
      throw new Error(`Cloud resource ${resource.id} download ended early.`);
    } catch (error) {
      if (attempt === DOWNLOAD_ATTEMPTS - 1) throw error;
    } finally {
      clearTimeout(requestTimeout);
    }
  }
}

async function downloadArchive(resource, destination, fetch, onProgress) {
  const partSize = Math.ceil(resource.sizeBytes / DOWNLOAD_PARTS);
  const ranges = Array.from({ length: DOWNLOAD_PARTS }, (_, index) => ({
    start: index * partSize,
    end: Math.min(resource.sizeBytes - 1, ((index + 1) * partSize) - 1),
    path: `${destination}.part-${index}`,
  })).filter((range) => range.start <= range.end);
  const progress = await Promise.all(ranges.map(async (range) => (
    (await stat(range.path).catch(() => null))?.size ?? 0
  )));
  const reportProgress = () => onProgress(progress.reduce((total, bytes) => total + bytes, 0));
  reportProgress();
  let nextRangeIndex = 0;
  const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, ranges.length) }, async () => {
    while (nextRangeIndex < ranges.length) {
      const index = nextRangeIndex;
      nextRangeIndex += 1;
      const range = ranges[index];
      await downloadRange(resource, range.path, range.start, range.end, fetch, (bytes) => {
        progress[index] = bytes;
        reportProgress();
      });
    }
  });
  await Promise.all(workers);
  const handle = await open(destination, "w");
  try {
    for (const range of ranges) {
      for await (const chunk of createReadStream(range.path)) await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  const bytes = (await stat(destination)).size;
  if (bytes !== resource.sizeBytes || await sha256File(destination) !== resource.sha256) {
    throw new Error(`Cloud resource ${resource.id} failed size or SHA-256 verification.`);
  }
  await assertSafeArchive(destination);
}

function probeBinary(binaryPath, resourceId) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ["-version"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(0, 4096); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(0, 4096); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${resourceId} verification timed out.`));
    }, BINARY_PROBE_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !output.toLowerCase().includes(resourceId)) {
        reject(new Error(`Downloaded ${resourceId} executable failed its version check.`));
        return;
      }
      resolve(output.split(/\r?\n/, 1)[0]);
    });
  });
}

export function createVideoResourceManager({
  app,
  fetch,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  developmentFallbackPaths = null,
  trustedKeys = undefined,
  probeBinary: verifyBinary = probeBinary,
}) {
  const appVersion = DESKTOP_RESOURCE_APP_VERSION;
  const root = path.join(app.getPath("userData"), "desktop-resources", "video", appVersion);
  const marker = path.join(root, "current.json");
  let operation = null;
  let inFlight = null;
  let fallbackRuntimePromise = null;

  async function downloadedPaths() {
    let record;
    try { record = JSON.parse(await readFile(marker, "utf8")); } catch { return null; }
    if (!/^[a-f0-9]{64}$/.test(record?.mediaSha256 ?? "")) return null;
    const directory = path.join(root, record.mediaSha256);
    const executable = platform === "win32" ? ".exe" : "";
    const paths = {
      ffmpeg: path.join(directory, "ffmpeg", `ffmpeg${executable}`),
      ffprobe: path.join(directory, "ffprobe", `ffprobe${executable}`),
    };
    if (!Object.values(paths).every(existsSync)) return null;
    return paths;
  }

  async function fallbackRuntime() {
    if (!developmentFallbackPaths) return null;
    if (!fallbackRuntimePromise) {
      fallbackRuntimePromise = (async () => {
        const candidates = Array.isArray(developmentFallbackPaths)
          ? developmentFallbackPaths
          : [developmentFallbackPaths];
        for (const candidate of candidates) {
          const ffmpeg = String(candidate?.ffmpeg ?? "").trim();
          const ffprobe = String(candidate?.ffprobe ?? "").trim();
          if (!ffmpeg || !ffprobe) continue;
          const paths = { ffmpeg: path.resolve(ffmpeg), ffprobe: path.resolve(ffprobe) };
          if (!Object.values(paths).every(existsSync)) continue;
          try {
            await Promise.all(VIDEO_IDS.map((id) => verifyBinary(paths[id], id)));
            return { paths, source: candidate.source === "system" ? "system" : "bundled" };
          } catch {
            // Development candidates are optional. Continue to the next
            // verified pair instead of trusting a partial or non-executable install.
          }
        }
        return null;
      })().then((runtime) => {
        if (!runtime) fallbackRuntimePromise = null;
        return runtime;
      });
    }
    return fallbackRuntimePromise;
  }

  async function currentRuntime() {
    const downloaded = await downloadedPaths();
    if (downloaded) return { paths: downloaded, source: "downloaded" };
    return fallbackRuntime();
  }

  async function currentPaths() {
    return (await currentRuntime())?.paths ?? null;
  }

  async function applyEnvironment() {
    const downloaded = await downloadedPaths();
    if (downloaded) {
      try {
        await Promise.all(VIDEO_IDS.map((id) => verifyBinary(downloaded[id], id)));
        env.HYPERFRAMES_FFMPEG_PATH = downloaded.ffmpeg;
        env.HYPERFRAMES_FFPROBE_PATH = downloaded.ffprobe;
        return downloaded;
      } catch (error) {
        await rm(marker, { force: true });
        operation = { status: "failed", error: errorMessage(error) };
      }
    }
    const fallback = await fallbackRuntime();
    if (fallback) {
      operation = null;
      env.HYPERFRAMES_FFMPEG_PATH = fallback.paths.ffmpeg;
      env.HYPERFRAMES_FFPROBE_PATH = fallback.paths.ffprobe;
      return fallback.paths;
    }
    delete env.HYPERFRAMES_FFMPEG_PATH;
    delete env.HYPERFRAMES_FFPROBE_PATH;
    return null;
  }

  /** @returns {Promise<import("@ipollowork/types/desktop-ipc").EnginePackageInfo>} */
  async function info() {
    const runtime = await currentRuntime();
    return {
      id: VIDEO_ID,
      name: "FFmpeg / FFprobe 视频编解码组件",
      version: appVersion,
      status: operation?.status ?? (runtime ? "ready" : "not-installed"),
      source: runtime?.source ?? "none",
      installed: Boolean(runtime),
      builtIn: runtime?.source === "bundled",
      canInstall: !runtime && (!operation || operation.status === "failed"),
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
        appVersion,
        platform,
        arch,
        fetch,
        trustedKeys,
      });
      const resources = VIDEO_IDS.map((id) => manifest.resources.find((item) => item.id === id));
      if (resources.some((item) => !item)) throw new Error("Cloud resource manifest is missing FFmpeg or FFprobe.");
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
        path.join(staging, "ffmpeg", `ffmpeg${executable}`),
        path.join(staging, "ffprobe", `ffprobe${executable}`),
      ]) {
        if (!(await stat(expected).catch(() => null))?.isFile()) throw new Error(`Cloud video resource is missing ${path.basename(expected)}.`);
        if (platform !== "win32") await chmod(expected, 0o755);
      }
      operation.status = "verifying";
      const stagedPaths = {
        ffmpeg: path.join(staging, "ffmpeg", `ffmpeg${executable}`),
        ffprobe: path.join(staging, "ffprobe", `ffprobe${executable}`),
      };
      await Promise.all(VIDEO_IDS.map((id) => verifyBinary(stagedPaths[id], id)));
      const mediaSha256 = createHash("sha256")
        .update(resources.map((item) => `${item.id}:${item.sha256}`).join("|"))
        .digest("hex");
      await mkdir(root, { recursive: true });
      const destination = path.join(root, mediaSha256);
      if (!existsSync(destination)) await rename(staging, destination);
      const nextMarker = path.join(root, `current-${process.pid}.json`);
      await writeFile(nextMarker, JSON.stringify({ mediaSha256, versions: Object.fromEntries(resources.map((item) => [item.id, item.version])) }));
      await rename(nextMarker, marker);
      operation = null;
      env.HYPERFRAMES_FFMPEG_PATH = path.join(destination, "ffmpeg", `ffmpeg${executable}`);
      env.HYPERFRAMES_FFPROBE_PATH = path.join(destination, "ffprobe", `ffprobe${executable}`);
      return info();
    } catch (error) {
      const failure = installError(error, { baseUrl, appVersion, platform, arch });
      operation = { status: "failed", error: failure.message };
      throw failure;
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
