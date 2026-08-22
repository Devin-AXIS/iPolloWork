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

function commandOnPath(command, env = process.env) {
  const pathValue = env.PATH?.trim();
  if (!pathValue) return null;
  const extensions = process.platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? `${command}${extension}` : command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function externalEngineSource(descriptor, executablePath, fallbackSource) {
  if (descriptor.id !== CODEX_ENGINE_ID) return fallbackSource;
  const resolvedPath = await realpath(executablePath).catch(() => executablePath);
  const normalizedPath = resolvedPath.replaceAll("\\", "/").toLowerCase();
  return /\/[^/]+\.app\/contents\/resources\/codex$/.test(normalizedPath)
    ? "desktop-client"
    : fallbackSource;
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
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      await handle.write(chunk);
      downloaded += chunk.byteLength;
      onProgress(downloaded, total);
    }
  } finally {
    await handle.close();
  }
  return { downloaded, total };
}

function engineDescriptor(id, versions) {
  if (id === DSH_ENGINE_ID) {
    return {
      id,
      name: "DeepSeek Harness",
      version: normalizeVersion(versions.deepseekHarness),
      command: "dsh",
      cliRelativePath: path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      environmentKey: "IPOLLOWORK_DSH_CLI",
      versionEnvironmentKey: "IPOLLOWORK_DSH_CLI_VERSION",
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
      cliRelativePath: process.platform === "win32"
        ? path.join(
            "node_modules",
            "@openai",
            process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64",
            "vendor",
            process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
            "bin",
            "codex.exe",
          )
        : path.join("node_modules", "@openai", "codex", "bin", "codex.js"),
      environmentKey: "IPOLLOWORK_CODEX_CLI",
      versionEnvironmentKey: "IPOLLOWORK_CODEX_CLI_VERSION",
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
  const versions = {
    opencode: normalizeVersion(options.versions?.opencode),
    deepseekHarness: normalizeVersion(options.versions?.deepseekHarness),
    codexHarness: normalizeVersion(options.versions?.codexHarness),
  };
  const root = path.join(options.app.getPath("userData"), "engine-packs");
  const operations = new Map();
  const inFlight = new Map();
  const externalOverrides = new Map();
  const externalDshHostPlugin = process.env.IPOLLOWORK_DSH_HOST_PLUGIN?.trim() || null;
  for (const id of OPTIONAL_ENGINE_IDS) {
    const descriptor = engineDescriptor(id, versions);
    const configured = process.env[descriptor.environmentKey]?.trim();
    if (configured) externalOverrides.set(id, configured);
  }

  function descriptorFor(engineId) {
    const descriptor = engineDescriptor(String(engineId ?? "").trim(), versions);
    if (!descriptor) throw new Error(`Unsupported optional engine: ${engineId}`);
    return descriptor;
  }

  function installedRoot(descriptor) {
    return path.join(root, descriptor.id, descriptor.version, `${process.platform}-${process.arch}`);
  }

  function metadataPath(descriptor) {
    return path.join(installedRoot(descriptor), ".installed.json");
  }

  function cliPath(descriptor) {
    return path.join(installedRoot(descriptor), descriptor.cliRelativePath);
  }

  function assetName(descriptor) {
    return `ipollowork-engine-${descriptor.id}-${platformAssetSegment(process.platform)}-${process.arch}-${descriptor.version}.tar.gz`;
  }

  function releaseBaseUrl() {
    const explicit = process.env.IPOLLOWORK_ENGINE_PACK_BASE_URL?.trim();
    if (explicit) return explicit.replace(/\/$/, "");
    const version = normalizeVersion(options.app.getVersion());
    return `https://github.com/Devin-AXIS/iPolloWork/releases/download/v${version}`;
  }

  function setOperation(id, patch) {
    operations.set(id, { ...(operations.get(id) ?? {}), ...patch });
  }

  function clearOperation(id) {
    operations.delete(id);
  }

  /** @returns {Promise<{ installed: boolean; source: import("@ipollowork/types/desktop-ipc").EnginePackageSource; installedBytes: number | null }>} */
  async function resolveInstalledState(descriptor) {
    const override = externalOverrides.get(descriptor.id);
    if (override && existsSync(override)) {
      return {
        installed: true,
        source: await externalEngineSource(descriptor, override, "custom"),
        installedBytes: null,
      };
    }
    const metadata = await readJson(metadataPath(descriptor));
    if (metadata && await pathExists(cliPath(descriptor))) {
      return {
        installed: true,
        source: "downloaded",
        installedBytes: Number.isFinite(metadata.installedBytes) ? metadata.installedBytes : null,
      };
    }
    const systemPath = commandOnPath(descriptor.command);
    if (systemPath) {
      return {
        installed: true,
        source: await externalEngineSource(descriptor, systemPath, "system"),
        installedBytes: null,
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

  function applyEnvironment(skipEngineId = null) {
    for (const id of OPTIONAL_ENGINE_IDS) {
      const descriptor = descriptorFor(id);
      const override = externalOverrides.get(id);
      const installedCli = cliPath(descriptor);
      const resolved = id !== skipEngineId && override && existsSync(override)
        ? override
        : id !== skipEngineId && existsSync(installedCli)
          ? installedCli
          : null;
      if (resolved) {
        process.env[descriptor.environmentKey] = resolved;
        process.env[descriptor.versionEnvironmentKey] = descriptor.version;
      } else {
        delete process.env[descriptor.environmentKey];
        delete process.env[descriptor.versionEnvironmentKey];
      }
      if (descriptor.hostPluginRelativePath) {
        const hostPlugin = path.join(installedRoot(descriptor), descriptor.hostPluginRelativePath);
        if (externalDshHostPlugin && existsSync(externalDshHostPlugin)) {
          process.env.IPOLLOWORK_DSH_HOST_PLUGIN = externalDshHostPlugin;
        } else if (id !== skipEngineId && existsSync(hostPlugin)) {
          process.env.IPOLLOWORK_DSH_HOST_PLUGIN = hostPlugin;
        } else {
          delete process.env.IPOLLOWORK_DSH_HOST_PLUGIN;
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
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    await cp(developmentRoot, stagingRoot, {
      recursive: true,
      filter: (source) => !source.endsWith(".install-stamp.json"),
    });
    return true;
  }

  async function installFromRelease(descriptor, stagingRoot, temporaryRoot) {
    const name = assetName(descriptor);
    const archivePath = path.join(temporaryRoot, name);
    const sourceDirectory = process.env.IPOLLOWORK_ENGINE_PACK_SOURCE_DIR?.trim();
    let expectedSha;
    if (sourceDirectory) {
      const sourceArchive = path.join(sourceDirectory, name);
      expectedSha = parseExpectedSha256(await readFile(`${sourceArchive}.sha256`, "utf8"));
      await cp(sourceArchive, archivePath);
      const archiveStat = await stat(archivePath);
      setOperation(descriptor.id, {
        status: "downloading",
        downloadedBytes: archiveStat.size,
        totalBytes: archiveStat.size,
      });
    } else {
      const url = `${releaseBaseUrl()}/${name}`;
      const checksumResponse = await options.fetch(`${url}.sha256`);
      if (!checksumResponse.ok) {
        throw new Error(`Engine package checksum download returned HTTP ${checksumResponse.status}.`);
      }
      expectedSha = parseExpectedSha256(await checksumResponse.text());
      const response = await options.fetch(url);
      await writeResponseBody(response, archivePath, (downloadedBytes, totalBytes) => {
        setOperation(descriptor.id, { status: "downloading", downloadedBytes, totalBytes });
      });
    }
    setOperation(descriptor.id, { status: "verifying" });
    const actualSha = await sha256File(archivePath);
    if (actualSha !== expectedSha) throw new Error("Engine package checksum verification failed.");
    await assertArchiveEntriesSafe(archivePath);
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
        platform: process.platform,
        arch: process.arch,
        installedAt: new Date().toISOString(),
        installedBytes,
      }, null, 2)}\n`);
      await mkdir(path.dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(stagingRoot, destination);
      clearOperation(descriptor.id);
      applyEnvironment();
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
    try {
      applyEnvironment(descriptor.id);
      await options.beforeUninstall?.(descriptor.id);
      const target = path.join(root, descriptor.id);
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Refusing to remove an unsafe engine package path.");
      }
      await rm(target, { recursive: true, force: true });
      clearOperation(descriptor.id);
      applyEnvironment();
      await options.afterChange?.(descriptor.id, "uninstall");
      return infoFor(descriptor);
    } catch (error) {
      applyEnvironment();
      setOperation(descriptor.id, { status: "failed", error: safeErrorMessage(error) });
      throw error;
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
