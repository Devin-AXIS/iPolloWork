import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
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
import { compareVersions } from "./updater.mjs";
import { fetchDesktopResourceManifest } from "./desktop-resource-manifest.mjs";
import { DESKTOP_RESOURCE_APP_VERSION } from "./app-version.mjs";

const OPENCODE_ENGINE_ID = "opencode";
const DSH_ENGINE_ID = "deepseek-harness";
const CODEX_ENGINE_ID = "codex-harness";
const OPTIONAL_ENGINE_IDS = new Set([DSH_ENGINE_ID, CODEX_ENGINE_ID]);
const RUNTIME_PROBE_TIMEOUT_MS = 10_000;
const FAILED_RUNTIME_PROBE_TTL_MS = 30_000;
const ENGINE_PACK_REQUEST_TIMEOUT_MS = 15_000;
const ENGINE_PACK_IDLE_TIMEOUT_MS = 30_000;

function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/, "") || "unknown";
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
    || /\/(?:codex|chatgpt)\.app\/contents\/resources\/codex-cli\/bin\/codex$/.test(normalizedPath)
    || /\/(?:codex|chatgpt)\.app\/contents\/resources\/codex-cli\/codexcli\.app\/contents\/macos\/codex$/.test(normalizedPath)
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
      ...["/Applications", path.join(homeDir, "Applications")].flatMap(root =>
        ["Codex.app", "ChatGPT.app"].flatMap(app => [
          path.join(root, app, "Contents", "Resources", "codex-cli", "bin", "codex"),
          path.join(root, app, "Contents", "Resources", "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
        ])),
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
    let stdout = "";
    const child = spawn(executablePath, ["--version"], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(0, 1024); });
    const finish = (result, reason = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!result) console.warn(`[engine-package] Codex version probe failed (${reason}): ${executablePath}`);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(false, "timeout");
    }, RUNTIME_PROBE_TIMEOUT_MS);
    child.once("error", (error) => finish(false, error.message));
    child.once("close", (code) => finish(code === 0
      ? stdout.trim().match(/^codex-cli\s+(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)/)?.[1] || false
      : false, `exit ${code}`));
  });
}

async function resolveLocalRuntime(descriptor, { platform, env, homeDir, probeRuntime }) {
  const resolveCandidate = async (candidate) => {
    const normalized = await normalizeOfficialRuntimePath(descriptor, candidate, platform);
    if (!normalized) return null;
    const official = looksLikeOfficialRuntime(descriptor, normalized);
    if (!official && descriptor.id !== CODEX_ENGINE_ID) return null;
    if (descriptor.id === DSH_ENGINE_ID) {
      const manifest = await readJson(path.resolve(path.dirname(normalized), "..", "package.json"));
      const installedVersion = normalizeVersion(manifest?.version);
      if (installedVersion !== descriptor.version) {
        console.warn(
          `[engine-package] Ignoring incompatible DeepSeek Harness ${installedVersion}; iPolloWork requires ${descriptor.version}.`,
        );
        return null;
      }
    }
    const version = await probeRuntime(normalized);
    // A local CLI outside known installers must identify itself as codex-cli.
    return version && (official || typeof version === "string")
      ? { path: normalized, version: typeof version === "string" ? version : null }
      : null;
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
  const clients = [];
  for (const candidate of await codexClientCandidates(platform, env, homeDir)) {
    if (!await pathExists(candidate)) continue;
    const resolved = await resolveCandidate(candidate);
    if (resolved) clients.push(resolved);
  }
  // Desktop updates leave multiple hash-named builds behind. Directory order
  // (and copy time) does not identify the newest compatible CLI. Probes are cached.
  clients.sort((left, right) => {
    const leftKnown = typeof left.version === "string";
    const rightKnown = typeof right.version === "string";
    if (leftKnown && rightKnown) return compareVersions(right.version, left.version) ?? 0;
    return Number(rightKnown) - Number(leftKnown);
  });
  return clients[0] ?? null;
}

export function run(command, args, options = {}) {
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
    // Exit can precede the final pipe data; close waits for both output streams.
    child.once("close", (code, signal) => {
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

async function assertArchiveEntriesSafe(archivePath) {
  const safeName = (entry) => {
    const name = entry.replaceAll("\\", "/");
    return !name.startsWith("/") && !/^[A-Za-z]:\//.test(name) && !name.split("/").includes("..");
  };
  const { stdout } = await run("tar", ["-tzf", archivePath]);
  const entries = stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("Engine package archive is empty.");
  for (const entry of entries) {
    if (!safeName(entry)) {
      throw new Error(`Engine package contains an unsafe path: ${entry}`);
    }
  }
  const { stdout: verbose } = await run("tar", ["-tvzf", archivePath]);
  if (verbose.split(/\r?\n/).filter(Boolean).some((entry) => {
    if (["-", "d"].includes(entry[0])) return false;
    const target = entry[0] === "h" ? entry.match(/ link to (.+)$/)?.[1] : null;
    return !target || !safeName(target);
  })) throw new Error("Engine package contains a link or special file.");
}

async function writeResponseBody(response, targetPath, onProgress, expectedBytes = null) {
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
      if (expectedBytes != null && downloaded + chunk.byteLength > expectedBytes) {
        throw new Error("Cloud resource download exceeded its signed size.");
      }
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

  async function probeRuntime(descriptor, executablePath) {
    if (descriptor.id !== CODEX_ENGINE_ID) return true;
    const key = platform === "win32" ? executablePath.toLowerCase() : executablePath;
    const cached = runtimeProbeCache.get(key);
    if (cached && Date.now() < cached.retryAt) return cached.pending;
    // Share in-flight work and successful probes, but let transient startup
    // failures recover. A short negative cache bounds settings polling cost.
    const entry = { pending: null, retryAt: Infinity };
    entry.pending = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await (options.probeRuntime
            ? options.probeRuntime({ engineId: descriptor.id, executablePath })
            : probeRuntimeExecutable(executablePath, environment));
          if (result) return result;
        } catch {
          // A failed spawn or a rejected probe gets the same bounded retry.
        }
      }
      entry.retryAt = Date.now() + FAILED_RUNTIME_PROBE_TTL_MS;
      return false;
    })();
    runtimeProbeCache.set(key, entry);
    return entry.pending;
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

  async function fetchEnginePackage(url, init = {}, consume = null) {
    const controller = new AbortController();
    let requestTimedOut = false;
    let rejectRequestTimeout;
    const requestTimeout = new Promise((_, reject) => { rejectRequestTimeout = reject; });
    const timeout = setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
      rejectRequestTimeout(new Error(`Engine package request timed out after ${ENGINE_PACK_REQUEST_TIMEOUT_MS / 1_000} seconds.`));
    }, ENGINE_PACK_REQUEST_TIMEOUT_MS);
    try {
      const response = await Promise.race([
        options.fetch(url, { ...init, signal: controller.signal }),
        requestTimeout,
      ]);
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

  function setOperation(id, patch) {
    operations.set(id, { ...(operations.get(id) ?? {}), ...patch });
  }

  function clearOperation(id) {
    operations.delete(id);
  }

  /** @returns {Promise<{ path: string; version: string | null; source: import("@ipollowork/types/desktop-ipc").EnginePackageSource; nodePath: string | null } | null>} */
  async function resolveRuntimeSource(descriptor) {
    const override = externalOverrides.get(descriptor.id);
    const overrideVersion = override && existsSync(override) ? await probeRuntime(descriptor, override) : false;
    if (override && overrideVersion) {
      return {
        path: override,
        version: typeof overrideVersion === "string" ? overrideVersion : null,
        source: await externalEngineSource(descriptor, override, "custom"),
        nodePath: externalNodePath(descriptor),
      };
    }

    // Local desktop/CLI Harnesses own their own lifecycle. Prefer them over
    // iPolloWork's optional package so an existing local engine is never
    // shadowed by, or offered, a duplicate download.
    const localRuntime = await resolveLocalRuntime(descriptor, {
      platform,
      env: environment,
      homeDir,
      probeRuntime: (candidate) => probeRuntime(descriptor, candidate),
    });
    if (localRuntime && !isWithinManagedPackage(descriptor, localRuntime.path)) {
      return {
        ...localRuntime,
        source: await externalEngineSource(descriptor, localRuntime.path, "system"),
        nodePath: externalNodePath(descriptor),
      };
    }

    const managedCli = cliPath(descriptor);
    if (await pathExists(managedCli)) {
      const nodePath = managedNodePath(descriptor);
      return {
        path: managedCli,
        version: descriptor.version,
        source: "downloaded",
        nodePath: nodePath && await pathExists(nodePath) ? nodePath : externalNodePath(descriptor),
      };
    }

    return null;
  }

  /** @returns {Promise<{ installed: boolean; version: string; source: import("@ipollowork/types/desktop-ipc").EnginePackageSource; installedBytes: number | null }>} */
  async function resolveInstalledState(descriptor) {
    const runtime = await resolveRuntimeSource(descriptor);
    if (runtime) {
      const metadata = runtime.source === "downloaded" ? await readJson(metadataPath(descriptor)) : null;
      return {
        installed: true,
        version: runtime.version ?? descriptor.version,
        source: runtime.source,
        installedBytes: Number.isFinite(metadata?.installedBytes) ? metadata.installedBytes : null,
      };
    }
    return {
      installed: false,
      version: descriptor.version,
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
      version: installedState.version,
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
    // Refresh the launch environment as well as the displayed availability.
    // Keep managed files intact: an existing session may still be using them.
    await applyEnvironment(null, false);
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

  async function applyEnvironment(skipEngineId = null, cleanupRedundantPackages = true) {
    for (const id of OPTIONAL_ENGINE_IDS) {
      const descriptor = descriptorFor(id);
      const skipped = id === skipEngineId || operations.get(id)?.status === "uninstalling";
      const runtime = skipped ? null : await resolveRuntimeSource(descriptor);
      if (
        cleanupRedundantPackages
        && runtime?.source === "official"
        && !externalOverrides.has(id)
        && await pathExists(managedPackageRoot(descriptor))
      ) {
        try {
          await removeManagedPackage(descriptor);
        } catch (error) {
          console.warn(`[engine-package] Could not remove redundant ${descriptor.name} package: ${safeErrorMessage(error)}`);
        }
      }
      if (runtime) {
        environment[descriptor.environmentKey] = runtime.path;
        environment[descriptor.versionEnvironmentKey] = runtime.version ?? descriptor.version;
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
        } else if (!skipped && existsSync(hostPlugin)) {
          environment.IPOLLOWORK_DSH_HOST_PLUGIN = hostPlugin;
        } else {
          delete environment.IPOLLOWORK_DSH_HOST_PLUGIN;
        }
      }
    }
  }

  async function installFromRelease(descriptor, stagingRoot, temporaryRoot, cloudBaseUrl) {
    const manifest = await fetchDesktopResourceManifest({
      baseUrl: cloudBaseUrl || options.cloudBaseUrl || "http://i.ipollo.ai",
      appVersion: DESKTOP_RESOURCE_APP_VERSION,
      platform,
      arch: architecture,
      fetch: (url, init) => fetchEnginePackage(url, init),
      trustedKeys: options.trustedResourceKeys,
    });
    const resource = manifest.resources.find((item) => item.id === descriptor.id);
    if (!resource || resource.version !== descriptor.version) {
      throw new Error(`Cloud resource ${descriptor.id} does not match the required engine version ${descriptor.version}.`);
    }
    const archivePath = path.join(temporaryRoot, resource.fileName);
    setOperation(descriptor.id, { status: "downloading", downloadedBytes: 0, totalBytes: resource.sizeBytes });
    await fetchEnginePackage(resource.url, {}, async (response) => {
      const { downloaded } = await writeResponseBody(response, archivePath, (downloadedBytes) => {
        setOperation(descriptor.id, { status: "downloading", downloadedBytes, totalBytes: resource.sizeBytes });
      }, resource.sizeBytes);
      if (downloaded !== resource.sizeBytes) throw new Error("Cloud resource download size mismatch.");
    });
    setOperation(descriptor.id, { status: "verifying" });
    if (await sha256File(archivePath) !== resource.sha256) throw new Error("Cloud resource checksum verification failed.");
    await assertArchiveEntriesSafe(archivePath);
    setOperation(descriptor.id, { status: "installing" });
    await mkdir(stagingRoot, { recursive: true });
    await run("tar", ["-xzf", archivePath, "-C", stagingRoot]);
  }

  async function performInstall(engineId, cloudBaseUrl) {
    const descriptor = descriptorFor(engineId);
    const operation = operations.get(descriptor.id);
    if (operation && operation.status !== "failed") return infoFor(descriptor);
    if (operation?.status === "failed") clearOperation(descriptor.id);
    if (descriptor.id === CODEX_ENGINE_ID) {
      // Recheck failed local candidates before spending bandwidth on a download.
      for (const [key, probe] of runtimeProbeCache) {
        if (probe.retryAt !== Infinity) runtimeProbeCache.delete(key);
      }
    }
    const current = await infoFor(descriptor);
    if (current.installed) {
      await applyEnvironment(null, false);
      return current;
    }

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
      await installFromRelease(descriptor, stagingRoot, temporaryRoot, cloudBaseUrl);
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

  function install(engineId, cloudBaseUrl) {
    const descriptor = descriptorFor(engineId);
    const existing = inFlight.get(descriptor.id);
    if (existing) return existing;
    const pending = performInstall(descriptor.id, cloudBaseUrl).finally(() => inFlight.delete(descriptor.id));
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
      setOperation(descriptor.id, { status: "failed", error: safeErrorMessage(error) });
      await applyEnvironment();
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
