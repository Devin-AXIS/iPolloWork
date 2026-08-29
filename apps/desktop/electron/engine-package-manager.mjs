import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OPENCODE_ENGINE_ID = "opencode";
const DSH_ENGINE_ID = "deepseek-harness";
const CODEX_ENGINE_ID = "codex-harness";
const OPTIONAL_ENGINE_IDS = new Set([DSH_ENGINE_ID, CODEX_ENGINE_ID]);
const ENGINE_PACK_REQUEST_TIMEOUT_MS = 15_000;
const ENGINE_PACK_IDLE_TIMEOUT_MS = 30_000;
const ENGINE_PACK_GITHUB_MIRRORS = [
  "https://gh-proxy.com/",
  "https://ghfast.top/",
];

function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/, "") || "unknown";
}

function platformAssetSegment(platform) {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return platform;
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(targetPath) {
  try {
    return JSON.parse(await readFile(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function uniqueDirectories(directories, platform) {
  const seen = new Set();
  return directories.filter((directory) => {
    if (!directory) return false;
    const key = platform === "win32" ? directory.toLowerCase() : directory;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function commandOnPath(command, { env = process.env, platform = process.platform, additionalDirectories = [] } = {}) {
  const pathValue = env.PATH?.trim();
  const extensions = platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  const directories = uniqueDirectories([
    ...(pathValue ? pathValue.split(path.delimiter).filter(Boolean) : []),
    ...additionalDirectories,
  ], platform);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, platform === "win32" ? `${command}${extension}` : command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function officialCommandDirectories(platform, env, homeDir) {
  if (platform === "win32") {
    return uniqueDirectories([
      env.APPDATA && path.join(env.APPDATA, "npm"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "pnpm"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps"),
      homeDir && path.join(homeDir, ".local", "bin"),
    ], platform);
  }
  return uniqueDirectories([
    homeDir && path.join(homeDir, ".local", "bin"),
    homeDir && path.join(homeDir, "Library", "pnpm"),
    homeDir && path.join(homeDir, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ], platform);
}

function officialPackageRelativePath(descriptor) {
  return descriptor.id === DSH_ENGINE_ID
    ? path.join("@deepseek-ai", "dsh", "lib", "bin.js")
    : path.join("@openai", "codex", "bin", "codex.js");
}

function officialPackageEntrypoints(descriptor, commandPath, platform) {
  const commandDirectory = path.dirname(commandPath);
  const moduleRoots = [path.join(commandDirectory, "node_modules")];
  if (platform !== "win32") {
    moduleRoots.push(path.resolve(commandDirectory, "..", "lib", "node_modules"));
  }
  return moduleRoots.map((root) => path.join(root, officialPackageRelativePath(descriptor)));
}

async function normalizeOfficialRuntimePath(descriptor, executablePath, platform) {
  const resolvedPath = await realpath(executablePath).catch(() => executablePath);
  const wrapperExtension = path.extname(resolvedPath).toLowerCase();
  const requiresPackageEntrypoint = platform === "win32"
    && [".cmd", ".bat", ".ps1"].includes(wrapperExtension);
  if (requiresPackageEntrypoint) {
    for (const candidate of [
      ...officialPackageEntrypoints(descriptor, executablePath, platform),
      ...officialPackageEntrypoints(descriptor, resolvedPath, platform),
    ]) {
      if (await pathExists(candidate)) return realpath(candidate).catch(() => candidate);
    }
    return null;
  }
  return await pathExists(resolvedPath) ? resolvedPath : null;
}

function looksLikeOfficialRuntime(descriptor, executablePath) {
  const normalizedPath = executablePath.replaceAll("\\", "/").toLowerCase();
  if (descriptor.id === DSH_ENGINE_ID) {
    return normalizedPath.includes("/node_modules/@deepseek-ai/dsh/");
  }
  return normalizedPath.includes("/node_modules/@openai/codex/")
    || /\/[^/]+\.app\/contents\/resources\/codex(?:\.exe)?$/.test(normalizedPath)
    || normalizedPath.includes("/windowsapps/openai.codex_")
    || /\/appdata\/local\/openai\/codex\/bin\/[^/]+\/codex\.exe$/.test(normalizedPath)
    || normalizedPath.includes("/.local/share/codex/");
}

async function externalEngineSource(descriptor, executablePath, fallbackSource) {
  const resolvedPath = await realpath(executablePath).catch(() => executablePath);
  return looksLikeOfficialRuntime(descriptor, resolvedPath) ? "official" : fallbackSource;
}

async function directoryEntries(root) {
  if (!root) return [];
  try {
    return await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function officialGlobalPackageEntrypoints(descriptor, platform, env, homeDir) {
  const explicitPrefix = env.NPM_CONFIG_PREFIX?.trim();
  const moduleRoots = platform === "win32"
    ? [
        env.APPDATA && path.join(env.APPDATA, "npm", "node_modules"),
        explicitPrefix && path.join(explicitPrefix, "node_modules"),
      ]
    : [
        explicitPrefix && path.join(explicitPrefix, "lib", "node_modules"),
        homeDir && path.join(homeDir, ".npm-global", "lib", "node_modules"),
        homeDir && path.join(homeDir, ".local", "lib", "node_modules"),
        "/opt/homebrew/lib/node_modules",
        "/usr/local/lib/node_modules",
      ];
  const pnpmGlobalRoots = uniqueDirectories([
    env.PNPM_HOME && path.join(env.PNPM_HOME, "global"),
    platform === "win32"
      ? env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "pnpm", "global")
      : homeDir && path.join(homeDir, "Library", "pnpm", "global"),
  ], platform);
  for (const globalRoot of pnpmGlobalRoots) {
    for (const entry of await directoryEntries(globalRoot)) {
      if (entry.isDirectory()) moduleRoots.push(path.join(globalRoot, entry.name, "node_modules"));
    }
  }
  const relativePath = officialPackageRelativePath(descriptor);
  return uniqueDirectories(moduleRoots, platform).map((root) => path.join(root, relativePath));
}

async function codexClientCandidates(platform, env, homeDir) {
  if (platform === "darwin") {
    return [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      path.join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex"),
      path.join(homeDir, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
    ];
  }
  if (platform !== "win32") return [];

  const candidates = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "codex.exe"),
    homeDir && path.join(homeDir, ".local", "bin", "codex.exe"),
  ].filter(Boolean);
  const programFiles = env.ProgramFiles || env.PROGRAMFILES;
  const windowsApps = programFiles && path.join(programFiles, "WindowsApps");
  const appEntries = (await directoryEntries(windowsApps))
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("openai.codex_"))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
  for (const entry of appEntries) {
    candidates.push(path.join(windowsApps, entry.name, "app", "resources", "codex.exe"));
  }
  const localCodexBin = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  for (const entry of await directoryEntries(localCodexBin)) {
    if (entry.isDirectory()) candidates.push(path.join(localCodexBin, entry.name, "codex.exe"));
  }
  return candidates;
}

function probeRuntimeExecutable(executablePath, env) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(executablePath, ["--version"], {
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, 5_000);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}

async function resolveOfficialRuntime(descriptor, { platform, env, homeDir, canLaunch }) {
  const resolveCandidate = async (candidate) => {
    const normalized = await normalizeOfficialRuntimePath(descriptor, candidate, platform);
    if (!normalized || !looksLikeOfficialRuntime(descriptor, normalized)) return null;
    return await canLaunch(normalized) ? normalized : null;
  };
  const commandPath = commandOnPath(descriptor.command, {
    env,
    platform,
    additionalDirectories: officialCommandDirectories(platform, env, homeDir),
  });
  if (commandPath) {
    const resolved = await resolveCandidate(commandPath);
    if (resolved) return resolved;
  }
  for (const candidate of await officialGlobalPackageEntrypoints(descriptor, platform, env, homeDir)) {
    if (!await pathExists(candidate)) continue;
    const resolved = await resolveCandidate(candidate);
    if (resolved) return resolved;
  }
  if (descriptor.id !== CODEX_ENGINE_ID) return null;
  for (const candidate of await codexClientCandidates(platform, env, homeDir)) {
    if (!await pathExists(candidate)) continue;
    const resolved = await resolveCandidate(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        `${path.basename(command)} failed (${code ?? signal ?? "unknown"})${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      ));
    });
  });
}

async function sha256File(targetPath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(targetPath)) hash.update(chunk);
  return hash.digest("hex");
}

async function directorySize(root) {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) total += (await stat(entryPath)).size;
    }
  }
  return total;
}

function parseExpectedSha256(value) {
  const match = String(value ?? "").match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) throw new Error("Engine package checksum is missing or invalid.");
  return match[0].toLowerCase();
}

async function assertArchiveEntriesSafe(archivePath) {
  const { stdout } = await run("tar", ["-tzf", archivePath]);
  const entries = stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("Engine package archive is empty.");
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      normalized.startsWith("/")
      || /^[A-Za-z]:\//.test(normalized)
      || normalized.split("/").includes("..")
    ) {
      throw new Error(`Engine package contains an unsafe path: ${entry}`);
    }
  }
}

async function writeResponseBody(response, targetPath, onProgress) {
  if (!response.ok) throw new Error(`Engine package download returned HTTP ${response.status}.`);
  if (!response.body) throw new Error("Engine package download returned an empty body.");
  const totalHeader = Number(response.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  const handle = await open(targetPath, "w");
  const reader = response.body.getReader();
  let downloaded = 0;
  let idleTimeout;
  let rejectIdle;
  const stalled = new Promise((_, reject) => { rejectIdle = reject; });
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(
      () => rejectIdle(new Error(`Engine package download stalled for ${ENGINE_PACK_IDLE_TIMEOUT_MS / 1_000} seconds.`)),
      ENGINE_PACK_IDLE_TIMEOUT_MS,
    );
  };
  resetIdleTimeout();
  try {
    while (true) {
      const result = await Promise.race([reader.read(), stalled]);
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      if (chunk.byteLength === 0) continue;
      await handle.write(chunk);
      downloaded += chunk.byteLength;
      onProgress(downloaded, total);
      resetIdleTimeout();
    }
  } finally {
    clearTimeout(idleTimeout);
    await handle.close();
  }
  return { downloaded, total };
}

async function copyFileWithProgress(sourcePath, targetPath, onProgress) {
  const totalBytes = (await stat(sourcePath)).size;
  const handle = await open(targetPath, "w");
  let copiedBytes = 0;
  try {
    for await (const chunk of createReadStream(sourcePath)) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
        if (bytesWritten <= 0) throw new Error("Engine package copy stopped before completion.");
        offset += bytesWritten;
        copiedBytes += bytesWritten;
        onProgress(copiedBytes, totalBytes);
      }
    }
  } finally {
    await handle.close();
  }
}

function engineDescriptor(id, versions, platform, architecture) {
  if (id === DSH_ENGINE_ID) {
    return {
      id,
      name: "DeepSeek Harness",
      version: normalizeVersion(versions.deepseekHarness),
      command: "dsh",
      cliRelativePath: path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      environmentKey: "IPOLLOWORK_DSH_CLI",
      versionEnvironmentKey: "IPOLLOWORK_DSH_CLI_VERSION",
      nodeRelativePath: path.join("node-runtime", platform === "win32" ? "node.exe" : "node"),
      nodeEnvironmentKey: "IPOLLOWORK_DSH_NODE_BIN",
      hostPluginRelativePath: "ipollowork-host-tools.mjs",
      prepareScript: "prepare-dsh-runtime.mjs",
      developmentDirectory: "dsh-runtime",
    };
  }
  if (id === CODEX_ENGINE_ID) {
    return {
      id,
      name: "Codex Harness",
      version: normalizeVersion(versions.codexHarness),
      command: "codex",
      cliRelativePath: platform === "win32"
        ? path.join(
            "node_modules",
            "@openai",
            architecture === "arm64" ? "codex-win32-arm64" : "codex-win32-x64",
            "vendor",
            architecture === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
            "bin",
            "codex.exe",
          )
        : path.join("node_modules", "@openai", "codex", "bin", "codex.js"),
      environmentKey: "IPOLLOWORK_CODEX_CLI",
      versionEnvironmentKey: "IPOLLOWORK_CODEX_CLI_VERSION",
      nodeRelativePath: null,
      nodeEnvironmentKey: null,
      hostPluginRelativePath: null,
      prepareScript: "prepare-codex-runtime.mjs",
      developmentDirectory: "codex-runtime",
    };
  }
  return null;
}

/**
 * Owns machine-global optional Agent engine programs only. Workspace/session
 * data remains in the server's existing Work-owned storage and is never
 * touched by install or uninstall.
 */
export function createEnginePackageManager(options) {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const environment = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const versions = {
    opencode: normalizeVersion(options.versions?.opencode),
    deepseekHarness: normalizeVersion(options.versions?.deepseekHarness),
    codexHarness: normalizeVersion(options.versions?.codexHarness),
  };
  const root = path.join(options.app.getPath("userData"), "engine-packs");
  const operations = new Map();
  const inFlight = new Map();
  const runtimeProbeCache = new Map();
  const externalOverrides = new Map();
  const externalDshHostPlugin = environment.IPOLLOWORK_DSH_HOST_PLUGIN?.trim() || null;
  for (const id of OPTIONAL_ENGINE_IDS) {
    const descriptor = engineDescriptor(id, versions, platform, architecture);
    const configured = environment[descriptor.environmentKey]?.trim();
    if (configured) externalOverrides.set(id, configured);
  }

  function descriptorFor(engineId) {
    const descriptor = engineDescriptor(String(engineId ?? "").trim(), versions, platform, architecture);
    if (!descriptor) throw new Error(`Unsupported optional engine: ${engineId}`);
    return descriptor;
  }

  function installedRoot(descriptor) {
    return path.join(root, descriptor.id, descriptor.version, `${platform}-${architecture}`);
  }

  function managedPackageRoot(descriptor) {
    return path.join(root, descriptor.id);
  }

  function metadataPath(descriptor) {
    return path.join(installedRoot(descriptor), ".installed.json");
  }

  function cliPath(descriptor) {
    return path.join(installedRoot(descriptor), descriptor.cliRelativePath);
  }

  function managedNodePath(descriptor) {
    return descriptor.nodeRelativePath
      ? path.join(installedRoot(descriptor), descriptor.nodeRelativePath)
      : null;
  }

  function externalNodePath(descriptor) {
    if (!descriptor.nodeEnvironmentKey) return null;
    const candidates = [
      environment[descriptor.nodeEnvironmentKey]?.trim(),
      environment.IPOLLOWORK_NODE_BIN?.trim(),
      environment.npm_node_execpath?.trim(),
      commandOnPath("node", {
        env: environment,
        platform,
        additionalDirectories: officialCommandDirectories(platform, environment, homeDir),
      }),
    ].filter(Boolean);
    return candidates.find((candidate) => (
      existsSync(candidate)
      && !/electron(?:\.exe)?$/i.test(candidate)
      && !isWithinManagedPackage(descriptor, candidate)
    )) ?? null;
  }

  function isWithinManagedPackage(descriptor, targetPath) {
    const relative = path.relative(managedPackageRoot(descriptor), targetPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  async function canLaunchRuntime(descriptor, executablePath) {
    if (descriptor.id !== CODEX_ENGINE_ID) return true;
    const key = platform === "win32" ? executablePath.toLowerCase() : executablePath;
    let pending = runtimeProbeCache.get(key);
    if (!pending) {
      pending = Promise.resolve(options.probeRuntime
        ? options.probeRuntime({ engineId: descriptor.id, executablePath })
        : probeRuntimeExecutable(executablePath, environment))
        .then(Boolean)
        .catch(() => false);
      runtimeProbeCache.set(key, pending);
    }
    return pending;
  }

  async function removeManagedPackage(descriptor) {
    const target = managedPackageRoot(descriptor);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Refusing to remove an unsafe engine package path.");
    }
    await rm(target, { recursive: true, force: true });
    if (await pathExists(target)) {
      throw new Error(`${descriptor.name} files are still present after uninstall.`);
    }
  }

  function assetName(descriptor) {
    return `ipollowork-engine-${descriptor.id}-${platformAssetSegment(platform)}-${architecture}-${descriptor.version}.tar.gz`;
  }

  function officialReleaseAssetUrl(name) {
    const version = encodeURIComponent(normalizeVersion(options.app.getVersion()));
    return `https://github.com/Devin-AXIS/iPolloWork/releases/download/v${version}/${name}`;
  }

  async function fetchEnginePackage(url, init = {}, consume = null) {
    const controller = new AbortController();
    let requestTimedOut = false;
    const timeout = setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, ENGINE_PACK_REQUEST_TIMEOUT_MS);
    try {
      const response = await options.fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (typeof consume !== "function") return response;
      try {
        return await consume(response);
      } finally {
        controller.abort();
      }
    } catch (error) {
      if (requestTimedOut) {
        throw new Error(`Engine package request timed out after ${ENGINE_PACK_REQUEST_TIMEOUT_MS / 1_000} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolveOfficialReleaseAsset(name) {
    const version = encodeURIComponent(normalizeVersion(options.app.getVersion()));
    const metadataUrls = [
      `https://api.github.com/repos/Devin-AXIS/iPolloWork/releases/tags/v${version}`,
      "https://api.github.com/repos/Devin-AXIS/iPolloWork/releases/latest",
    ];
    const failures = [];
    for (const metadataUrl of metadataUrls) {
      try {
        const response = await fetchEnginePackage(metadataUrl, {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!response.ok) throw new Error(`metadata returned HTTP ${response.status}`);
        const metadata = await response.json();
        const asset = Array.isArray(metadata?.assets)
          ? metadata.assets.find((candidate) => candidate?.name === name)
          : null;
        const digest = String(asset?.digest ?? "").match(/^sha256:([a-fA-F0-9]{64})$/);
        const url = String(asset?.browser_download_url ?? "");
        if (!digest || !url.startsWith("https://github.com/Devin-AXIS/iPolloWork/releases/download/")) {
          throw new Error(`release does not contain a verified ${name} asset`);
        }
        return { expectedSha: digest[1].toLowerCase(), url };
      } catch (error) {
        failures.push(`${metadataUrl}: ${safeErrorMessage(error)}`);
      }
    }
    throw new Error(`Engine package release metadata could not resolve ${name}. ${failures.join(" | ")}`);
  }

  function setOperation(id, patch) {
    operations.set(id, { ...(operations.get(id) ?? {}), ...patch });
  }

  function clearOperation(id) {
    operations.delete(id);
  }

  /** @returns {Promise<{ path: string; source: import("@ipollowork/types/desktop-ipc").EnginePackageSource; nodePath: string | null } | null>} */
  async function resolveRuntimeSource(descriptor) {
    const override = externalOverrides.get(descriptor.id);
    if (override && existsSync(override) && await canLaunchRuntime(descriptor, override)) {
      return {
        path: override,
        source: await externalEngineSource(descriptor, override, "custom"),
        nodePath: externalNodePath(descriptor),
      };
    }

    // Official desktop/CLI Harnesses own their own lifecycle. Prefer them over
    // iPolloWork's optional package so an existing local engine is never
    // shadowed by, or offered, a duplicate download.
    const officialRuntime = await resolveOfficialRuntime(descriptor, {
      platform,
      env: environment,
      homeDir,
      canLaunch: (candidate) => canLaunchRuntime(descriptor, candidate),
    });
    if (officialRuntime && !isWithinManagedPackage(descriptor, officialRuntime)) {
      return { path: officialRuntime, source: "official", nodePath: externalNodePath(descriptor) };
    }

    const managedCli = cliPath(descriptor);
    if (await pathExists(managedCli)) {
      const nodePath = managedNodePath(descriptor);
      return {
        path: managedCli,
        source: "downloaded",
        nodePath: nodePath && await pathExists(nodePath) ? nodePath : externalNodePath(descriptor),
      };
    }

    return null;
  }

  /** @returns {Promise<{ installed: boolean; source: import("@ipollowork/types/desktop-ipc").EnginePackageSource; installedBytes: number | null }>} */
  async function resolveInstalledState(descriptor) {
    const runtime = await resolveRuntimeSource(descriptor);
    if (runtime) {
      const metadata = runtime.source === "downloaded" ? await readJson(metadataPath(descriptor)) : null;
      return {
        installed: true,
        source: runtime.source,
        installedBytes: Number.isFinite(metadata?.installedBytes) ? metadata.installedBytes : null,
      };
    }
    return {
      installed: false,
      source: "none",
      installedBytes: null,
    };
  }

  /** @returns {Promise<import("@ipollowork/types/desktop-ipc").EnginePackageInfo>} */
  async function infoFor(descriptor) {
    const installedState = await resolveInstalledState(descriptor);
    const operation = operations.get(descriptor.id);
    /** @type {import("@ipollowork/types/desktop-ipc").EnginePackageInfo} */
    const info = {
      id: descriptor.id,
      name: descriptor.name,
      version: descriptor.version,
      status: operation?.status ?? (installedState.installed ? "ready" : "not-installed"),
      source: installedState.source,
      installed: installedState.installed,
      builtIn: false,
      canInstall: !installedState.installed && (!operation || operation.status === "failed"),
      canUninstall: installedState.source === "downloaded" && (!operation || operation.status === "failed"),
      installedBytes: installedState.installedBytes,
      downloadedBytes: operation?.downloadedBytes ?? null,
      totalBytes: operation?.totalBytes ?? null,
      error: operation?.error ?? null,
    };
    return info;
  }

  /** @returns {Promise<import("@ipollowork/types/desktop-ipc").EnginePackageInfo[]>} */
  async function list() {
    const optional = await Promise.all([...OPTIONAL_ENGINE_IDS].map((id) => infoFor(descriptorFor(id))));
    /** @type {import("@ipollowork/types/desktop-ipc").EnginePackageInfo} */
    const opencode = {
        id: OPENCODE_ENGINE_ID,
        name: "OpenCode",
        version: versions.opencode,
        status: "ready",
        source: "bundled",
        installed: true,
        builtIn: true,
        canInstall: false,
        canUninstall: false,
        installedBytes: null,
        downloadedBytes: null,
        totalBytes: null,
        error: null,
      };
    return [opencode, ...optional];
  }

  async function applyEnvironment(skipEngineId = null) {
    for (const id of OPTIONAL_ENGINE_IDS) {
      const descriptor = descriptorFor(id);
      const runtime = id === skipEngineId ? null : await resolveRuntimeSource(descriptor);
      const resolved = runtime?.path ?? null;
      if (
        runtime?.source === "official"
        && !externalOverrides.has(id)
        && await pathExists(managedPackageRoot(descriptor))
      ) {
        try {
          await removeManagedPackage(descriptor);
        } catch (error) {
          console.warn(`[engine-package] Could not remove redundant ${descriptor.name} package: ${safeErrorMessage(error)}`);
        }
      }
      if (resolved) {
        environment[descriptor.environmentKey] = resolved;
        environment[descriptor.versionEnvironmentKey] = descriptor.version;
      } else {
        delete environment[descriptor.environmentKey];
        delete environment[descriptor.versionEnvironmentKey];
      }
      if (descriptor.nodeEnvironmentKey) {
        if (runtime?.nodePath) environment[descriptor.nodeEnvironmentKey] = runtime.nodePath;
        else delete environment[descriptor.nodeEnvironmentKey];
      }
      if (descriptor.hostPluginRelativePath) {
        const hostPlugin = path.join(installedRoot(descriptor), descriptor.hostPluginRelativePath);
        if (externalDshHostPlugin && existsSync(externalDshHostPlugin)) {
          environment.IPOLLOWORK_DSH_HOST_PLUGIN = externalDshHostPlugin;
        } else if (id !== skipEngineId && existsSync(hostPlugin)) {
          environment.IPOLLOWORK_DSH_HOST_PLUGIN = hostPlugin;
        } else {
          delete environment.IPOLLOWORK_DSH_HOST_PLUGIN;
        }
      }
    }
  }

  async function installFromDevelopmentSource(descriptor, stagingRoot) {
    const developmentRoot = path.join(options.desktopRoot, descriptor.developmentDirectory);
    const prepareScript = path.join(options.desktopRoot, "scripts", descriptor.prepareScript);
    if (!await pathExists(developmentRoot) || !await pathExists(prepareScript)) return false;
    setOperation(descriptor.id, { status: "installing", downloadedBytes: null, totalBytes: null });
    await run(process.execPath, [prepareScript], {
      cwd: options.desktopRoot,
      env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
    });
    await cp(developmentRoot, stagingRoot, {
      recursive: true,
      filter: (source) => !source.endsWith(".install-stamp.json"),
    });
    return true;
  }

  async function downloadVerifiedReleaseArchive(descriptor, name, archivePath, trustedExpectedSha = null) {
    const explicitBaseUrl = environment.IPOLLOWORK_ENGINE_PACK_BASE_URL?.trim().replace(/\/$/, "");
    let expectedSha;
    let sourceUrls;
    if (explicitBaseUrl) {
      const url = `${explicitBaseUrl}/${name}`;
      if (trustedExpectedSha) {
        expectedSha = trustedExpectedSha;
      } else {
        const checksumResponse = await fetchEnginePackage(`${url}.sha256`);
        if (!checksumResponse.ok) {
          throw new Error(`Engine package checksum download returned HTTP ${checksumResponse.status}.`);
        }
        expectedSha = parseExpectedSha256(await checksumResponse.text());
      }
      sourceUrls = [url];
    } else if (trustedExpectedSha) {
      const url = officialReleaseAssetUrl(name);
      expectedSha = trustedExpectedSha;
      sourceUrls = [
        url,
        ...ENGINE_PACK_GITHUB_MIRRORS.map((mirror) => `${mirror}${url}`),
      ];
    } else {
      const releaseAsset = await resolveOfficialReleaseAsset(name);
      expectedSha = releaseAsset.expectedSha;
      sourceUrls = [
        releaseAsset.url,
        ...ENGINE_PACK_GITHUB_MIRRORS.map((mirror) => `${mirror}${releaseAsset.url}`),
      ];
    }
    const failures = [];
    for (const url of sourceUrls) {
      setOperation(descriptor.id, {
        status: "downloading",
        downloadedBytes: null,
        totalBytes: null,
      });
      try {
        await fetchEnginePackage(url, {}, async (response) => {
          await writeResponseBody(response, archivePath, (downloadedBytes, totalBytes) => {
            setOperation(descriptor.id, { status: "downloading", downloadedBytes, totalBytes });
          });
        });
        setOperation(descriptor.id, { status: "verifying" });
        const actualSha = await sha256File(archivePath);
        if (actualSha !== expectedSha) throw new Error("checksum verification failed");
        await assertArchiveEntriesSafe(archivePath);
        return;
      } catch (error) {
        failures.push(`${url}: ${safeErrorMessage(error)}`);
        await rm(archivePath, { force: true });
      }
    }
    throw new Error(`Engine package download failed from all sources. ${failures.join(" | ")}`);
  }

  async function installFromRelease(descriptor, stagingRoot, temporaryRoot) {
    const name = assetName(descriptor);
    const archivePath = path.join(temporaryRoot, name);
    const configuredSourceDirectory = environment.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR?.trim();
    const bundledSourceDirectory = options.app.isPackaged
      ? path.join(options.resourcesPath ?? path.dirname(options.desktopRoot), "engine-packs")
      : null;
    const bundledChecksumPath = bundledSourceDirectory
      ? path.join(bundledSourceDirectory, `${name}.sha256`)
      : null;
    const bundledExpectedSha = bundledChecksumPath && await pathExists(bundledChecksumPath)
      ? parseExpectedSha256(await readFile(bundledChecksumPath, "utf8"))
      : null;
    const hasBundledPackage = Boolean(bundledSourceDirectory
      && await pathExists(path.join(bundledSourceDirectory, name))
      && bundledExpectedSha);
    const sourceDirectory = configuredSourceDirectory || (hasBundledPackage ? bundledSourceDirectory : null);
    if (sourceDirectory) {
      const sourceArchive = path.join(sourceDirectory, name);
      const expectedSha = parseExpectedSha256(await readFile(`${sourceArchive}.sha256`, "utf8"));
      await copyFileWithProgress(sourceArchive, archivePath, (downloadedBytes, totalBytes) => {
        setOperation(descriptor.id, { status: "downloading", downloadedBytes, totalBytes });
      });
      setOperation(descriptor.id, { status: "verifying" });
      const actualSha = await sha256File(archivePath);
      if (actualSha !== expectedSha) throw new Error("Engine package checksum verification failed.");
      await assertArchiveEntriesSafe(archivePath);
    } else {
      await downloadVerifiedReleaseArchive(descriptor, name, archivePath, bundledExpectedSha);
    }
    setOperation(descriptor.id, { status: "installing" });
    await mkdir(stagingRoot, { recursive: true });
    await run("tar", ["-xzf", archivePath, "-C", stagingRoot]);
  }

  async function performInstall(engineId) {
    const descriptor = descriptorFor(engineId);
    const operation = operations.get(descriptor.id);
    if (operation && operation.status !== "failed") return infoFor(descriptor);
    if (operation?.status === "failed") clearOperation(descriptor.id);
    const current = await infoFor(descriptor);
    if (current.installed) return current;

    setOperation(descriptor.id, {
      status: "downloading",
      downloadedBytes: null,
      totalBytes: null,
      error: null,
    });
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `ipollowork-${descriptor.id}-`));
    const stagingRoot = path.join(temporaryRoot, "runtime");
    const destination = installedRoot(descriptor);
    try {
      const usedDevelopmentSource = !options.app.isPackaged
        ? await installFromDevelopmentSource(descriptor, stagingRoot)
        : false;
      if (!usedDevelopmentSource) await installFromRelease(descriptor, stagingRoot, temporaryRoot);
      const stagedCli = path.join(stagingRoot, descriptor.cliRelativePath);
      if (!await pathExists(stagedCli)) throw new Error("Engine package does not contain the expected runtime executable.");
      const installedBytes = await directorySize(stagingRoot);
      await writeFile(path.join(stagingRoot, ".installed.json"), `${JSON.stringify({
        engineId: descriptor.id,
        version: descriptor.version,
        platform,
        arch: architecture,
        installedAt: new Date().toISOString(),
        installedBytes,
      }, null, 2)}\n`);
      await mkdir(path.dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(stagingRoot, destination);
      clearOperation(descriptor.id);
      await applyEnvironment();
      await options.afterChange?.(descriptor.id, "install");
      return infoFor(descriptor);
    } catch (error) {
      setOperation(descriptor.id, {
        status: "failed",
        error: safeErrorMessage(error),
      });
      throw error;
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  function install(engineId) {
    const descriptor = descriptorFor(engineId);
    const existing = inFlight.get(descriptor.id);
    if (existing) return existing;
    const pending = performInstall(descriptor.id).finally(() => inFlight.delete(descriptor.id));
    inFlight.set(descriptor.id, pending);
    return pending;
  }

  async function performUninstall(engineId) {
    const descriptor = descriptorFor(engineId);
    const operation = operations.get(descriptor.id);
    if (operation && operation.status !== "failed") throw new Error(`${descriptor.name} is busy.`);
    if (operation?.status === "failed") clearOperation(descriptor.id);
    const current = await infoFor(descriptor);
    if (!current.installed) return current;
    if (!current.canUninstall) {
      throw new Error(`${descriptor.name} is managed outside iPolloWork and cannot be removed here.`);
    }
    setOperation(descriptor.id, { status: "uninstalling", error: null });
    let resumeRuntime = null;
    let uninstallError = null;
    try {
      await applyEnvironment(descriptor.id);
      resumeRuntime = await options.beforeUninstall?.(descriptor.id) ?? null;
      await removeManagedPackage(descriptor);
      clearOperation(descriptor.id);
      await applyEnvironment();
      await options.afterChange?.(descriptor.id, "uninstall");
      return infoFor(descriptor);
    } catch (error) {
      uninstallError = error;
      await applyEnvironment();
      setOperation(descriptor.id, { status: "failed", error: safeErrorMessage(error) });
      throw error;
    } finally {
      if (typeof resumeRuntime === "function") {
        try {
          await resumeRuntime();
        } catch (error) {
          if (!uninstallError) throw error;
        }
      }
    }
  }

  function uninstall(engineId) {
    const descriptor = descriptorFor(engineId);
    const existing = inFlight.get(descriptor.id);
    if (existing) return existing;
    const pending = performUninstall(descriptor.id).finally(() => inFlight.delete(descriptor.id));
    inFlight.set(descriptor.id, pending);
    return pending;
  }

  return {
    applyEnvironment,
    install,
    list,
    uninstall,
  };
}
