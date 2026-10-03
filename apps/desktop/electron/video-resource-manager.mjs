import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveDesktopAppVersion } from "./app-version.mjs";

const require = createRequire(import.meta.url);
const VIDEO_IDS = ["ffmpeg", "ffprobe"];
const BINARY_PROBE_TIMEOUT_MS = 10_000;

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
        reject(new Error(`Bundled ${resourceId} executable failed its version check.`));
        return;
      }
      resolve(output.split(/\r?\n/, 1)[0]);
    });
  });
}

export function createVideoResourceManager({
  app,
  resourcesPath = process.resourcesPath,
  env = process.env,
  platform = process.platform,
  probeBinary: verifyBinary = probeBinary,
  resolveDevelopmentBinary = (id) => require(id === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe").path,
}) {
  let error = null;
  let verified = null;

  async function currentPaths() {
    const paths = Object.fromEntries(VIDEO_IDS.map((id) => [id, app.isPackaged
      ? path.join(resourcesPath, "video-codecs", id, platform === "win32" ? `${id}.exe` : id)
      : resolveDevelopmentBinary(id)]));
    return Object.values(paths).every(existsSync) ? paths : null;
  }

  async function applyEnvironment() {
    const paths = await currentPaths();
    delete env.HYPERFRAMES_FFMPEG_PATH;
    delete env.HYPERFRAMES_FFPROBE_PATH;
    if (!paths) {
      error = "视频组件未完整打包，请重新安装完整的 iPolloWork 安装包。";
      return null;
    }
    try {
      verified ??= Promise.all(VIDEO_IDS.map(async (id) => {
        // Existing pnpm stores may predate the installer chmod build approval.
        // Repair only the resolved development package; packaged files stay immutable.
        if (!app.isPackaged && platform !== "win32") {
          const file = await stat(paths[id]);
          if (file.isFile() && !(file.mode & 0o100)) await chmod(paths[id], file.mode | 0o100);
        }
        return verifyBinary(paths[id], id);
      }));
      await verified;
      error = null;
      env.HYPERFRAMES_FFMPEG_PATH = paths.ffmpeg;
      env.HYPERFRAMES_FFPROBE_PATH = paths.ffprobe;
      return paths;
    } catch (cause) {
      verified = null;
      error = cause instanceof Error ? cause.message : String(cause);
      return null;
    }
  }

  /** @returns {Promise<import("@ipollowork/types/desktop-ipc").EnginePackageInfo>} */
  async function info() {
    const paths = await applyEnvironment();
    return {
      id: "video-codecs",
      name: "FFmpeg / FFprobe 视频编解码组件",
      version: resolveDesktopAppVersion(app),
      status: paths ? "ready" : "failed",
      source: paths ? "bundled" : "none",
      installed: Boolean(paths),
      builtIn: true,
      canInstall: false,
      canUninstall: false,
      installedBytes: null,
      downloadedBytes: null,
      totalBytes: null,
      error,
    };
  }

  return { applyEnvironment, currentPaths, info };
}
