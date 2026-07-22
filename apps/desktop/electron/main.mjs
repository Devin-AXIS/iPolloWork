import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import { existsSync, readdirSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, net as electronNet, Notification as ElectronNotification, screen, session, shell, systemPreferences } from "electron";
import { configureFakeMediaForTests, installMediaPermissionHandlers } from "./media-permissions.mjs";
import { registerMigrationIpc } from "./migration.mjs";
import { createRuntimeManager } from "./runtime.mjs";
import { registerUpdaterIpc } from "./updater.mjs";
import {
  checkComputerUsePermissions,
  getComputerUseMcpCommand,
  listRunningApps,
  openComputerUseSetupApp,
} from "./computer-use.mjs";
import { createUiControlServer } from "./ui-control-server.mjs";
import { createApplicationMenu } from "./app-menu.mjs";
import { createBrowserPanel } from "./browser-panel.mjs";
import { createWorkspaceStore } from "./workspace-store.mjs";
import { openExternalUrl } from "./open-external.mjs";
import { protectOutputStreamFromBrokenPipe } from "./stdio-safety.mjs";
import { relaunchActionForMode } from "./relaunch-policy.mjs";
import {
  applyWindowsTaskbarIcon,
  windowsBrandAppUserModelId,
  windowsBrandShortcutDetails,
  windowsBrandShortcutFileName,
  windowsInstalledShortcutFileName,
  windowsInstalledExecutablePath,
  writeWindowsBrandShortcut,
  windowsIconFromNativeImage,
} from "./brand-icon-windows.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
protectOutputStreamFromBrokenPipe(process.stdout);
protectOutputStreamFromBrokenPipe(process.stderr);
const require = createRequire(import.meta.url);
const pty = require(["node", "pty"].join("-"));
const NATIVE_DEEP_LINK_EVENT = "ipollowork:deep-link-native";
const TAURI_APP_IDENTIFIER = "com.differentai.ipollowork";
const DEV_APP_IDENTIFIER = "com.differentai.ipollowork.dev";
const DESKTOP_PROTOCOL_SCHEME = "ipollowork";
const isDevMode = process.env.IPOLLOWORK_DEV_MODE === "1";
const APP_NAME =
  process.env.IPOLLOWORK_ELECTRON_APP_NAME?.trim() ||
  (isDevMode ? "iPollo - Dev" : "iPollo");
let currentDisplayAppName = APP_NAME;
const APP_IDENTIFIER =
  process.env.IPOLLOWORK_ELECTRON_APP_IDENTIFIER?.trim() ||
  (isDevMode ? DEV_APP_IDENTIFIER : TAURI_APP_IDENTIFIER);
const RELEASE_DOWNLOAD_BASE_URL = "https://github.com/Devin-AXIS/iPolloWork/releases/latest/download";
const RELEASE_PAGE_URL = "https://github.com/Devin-AXIS/iPolloWork/releases/latest";
const DOCS_PAGE_URL = "https://ipolloworklabs.com/docs";
const MAIN_WINDOW_DEFAULT_WIDTH = 1440;
const MAIN_WINDOW_DEFAULT_HEIGHT = 900;
const MAIN_WINDOW_MIN_WIDTH = 880;
const MAIN_WINDOW_MIN_HEIGHT = 768;
const MAIN_WINDOW_STATE_FILE = "main-window-state.json";
const applicationMenu = createApplicationMenu({
  appName: APP_NAME,
  docsUrl: DOCS_PAGE_URL,
  getWindow: () => createMainWindow(),
});

const uiControlServer = createUiControlServer({
  appName: APP_NAME,
  appIdentifier: APP_IDENTIFIER,
  getWindow: () => createMainWindow(),
});

const terminalProcesses = new Map();
const hyperframesProcesses = new Map();
let nextTerminalId = 1;
const HYPERFRAMES_START_TIMEOUT_MS = 90_000;
const HYPERFRAMES_PORT_BASE = 3_100;
const HYPERFRAMES_PORT_RANGE = 800;

function isHyperframesStudioUrl(url) {
  try {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const port = Number(parsed.port);
    return isLocal && port >= HYPERFRAMES_PORT_BASE && port < HYPERFRAMES_PORT_BASE + HYPERFRAMES_PORT_RANGE;
  } catch {
    return false;
  }
}

function defaultTerminalShell() {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
  return process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

async function resolveTerminalCwd(cwd) {
  const fallback = os.homedir();
  if (typeof cwd !== "string" || !cwd.trim()) return fallback;
  const candidate = path.resolve(cwd);
  const info = await stat(candidate).catch(() => null);
  return info?.isDirectory() ? candidate : fallback;
}

function terminalForSender(event, terminalId) {
  const terminal = terminalProcesses.get(String(terminalId ?? ""));
  if (!terminal || terminal.webContentsId !== event.sender.id) return null;
  return terminal;
}

function killTerminal(terminalId) {
  const terminal = terminalProcesses.get(terminalId);
  if (!terminal) return;
  terminalProcesses.delete(terminalId);
  // node-pty closes the shell but does not always terminate foreground child
  // processes. HyperFrames previews would then outlive their conversation and
  // keep serving an old project on its session port. End the POSIX process
  // group first so the panel cannot reconnect to stale video content.
  if (process.platform !== "win32" && Number.isInteger(terminal.process.pid) && terminal.process.pid > 0) {
    try { process.kill(-terminal.process.pid, "SIGTERM"); } catch { /* process group already gone */ }
  }
  try { terminal.process.kill(); } catch { /* already gone */ }
}

function killTerminalsForWebContents(webContentsId) {
  for (const [terminalId, terminal] of terminalProcesses.entries()) {
    if (terminal.webContentsId === webContentsId) killTerminal(terminalId);
  }
}

function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

function hyperframesKey(webContentsId, sessionId) {
  return `${webContentsId}:${String(sessionId ?? "").trim()}`;
}

function desktopRepoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function resolveLocalHyperframesCli() {
  const candidates = [
    path.resolve(desktopRepoRoot(), "vendor", "hyperframes", "packages", "cli", "bin", "hyperframes.mjs"),
    process.resourcesPath
      ? path.join(process.resourcesPath, "hyperframes", "packages", "cli", "bin", "hyperframes.mjs")
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Local HyperFrames Studio is missing. Run `bun install` and `bun run build:local-studio` in `vendor/hyperframes`.");
}

function localHyperframesVersion() {
  try {
    const packagePath = path.join(path.dirname(resolveLocalHyperframesCli()), "..", "package.json");
    return require(packagePath).version || "";
  } catch {
    return "";
  }
}

function resolveLocalHyperframesRoot() {
  return path.resolve(path.dirname(resolveLocalHyperframesCli()), "..", "..", "..");
}

function findFirstExistingPath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isRunnableBinary(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  try {
    execFileSync(candidate, ["-version"], {
      stdio: "ignore",
      timeout: 5_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function findFirstRunnablePath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (isRunnableBinary(candidate)) return candidate;
  }
  return null;
}

function asarUnpackedPath(candidate) {
  if (!candidate || !candidate.includes("app.asar")) return null;
  return candidate.replace(/app\.asar(?=([\\/]|$))/, "app.asar.unpacked");
}

function resolveBundledFfBinary(name) {
  const extension = process.platform === "win32" ? ".exe" : "";
  const executable = `${name}${extension}`;
  const hyperframesRoot = resolveLocalHyperframesRoot();
  const packageName = name === "ffprobe" ? "ffprobe-static" : "ffmpeg-static";
  const packageGlobPrefix = name === "ffprobe" ? "ffprobe-static@" : "ffmpeg-static@";
  const nodeModulesRoot = path.join(hyperframesRoot, "node_modules");
  const directPackage = path.join(nodeModulesRoot, packageName);
  const bunRoot = path.join(nodeModulesRoot, ".bun");
  const bunPackageRoot = existsSync(bunRoot)
    ? readdirSync(bunRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith(packageGlobPrefix))?.name
    : null;
  return findFirstRunnablePath([
    path.join(directPackage, executable),
    path.join(directPackage, "bin", process.platform, process.arch, executable),
    path.join(directPackage, "bin", executable),
    bunPackageRoot ? path.join(bunRoot, bunPackageRoot, "node_modules", packageName, executable) : null,
    bunPackageRoot ? path.join(bunRoot, bunPackageRoot, "node_modules", packageName, "bin", process.platform, process.arch, executable) : null,
    bunPackageRoot ? path.join(bunRoot, bunPackageRoot, "node_modules", packageName, "bin", executable) : null,
  ]);
}

function resolveInstallerFfBinary(name) {
  const packageName = name === "ffprobe" ? "@ffprobe-installer/ffprobe" : "@ffmpeg-installer/ffmpeg";
  const platformPackageName = name === "ffprobe" ? "@ffprobe-installer" : "@ffmpeg-installer";
  const platformPackageDir = process.platform === "win32" ? "win32-x64" : null;
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  try {
    const installer = require(packageName);
    const installerPath = typeof installer?.path === "string" ? installer.path : "";
    const unpackedInstallerPath = asarUnpackedPath(installerPath);
    const resourcesNodeModules = process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
      : null;
    return findFirstRunnablePath([
      unpackedInstallerPath,
      installerPath,
      resourcesNodeModules && platformPackageDir
        ? path.join(resourcesNodeModules, platformPackageName, platformPackageDir, executable)
        : null,
    ]);
  } catch {
    const resourcesNodeModules = process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
      : null;
    return findFirstRunnablePath([
      resourcesNodeModules && platformPackageDir
        ? path.join(resourcesNodeModules, platformPackageName, platformPackageDir, executable)
        : null,
    ]);
  }
}

function resolveSystemFfBinary(name) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    const output = execFileSync(command, [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
      windowsHide: true,
    });
    const resolved = findFirstRunnablePath(
      output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    );
    if (resolved) return resolved;
  } catch {
    /* fall through to local fallbacks */
  }
  if (process.platform !== "win32" || name !== "ffmpeg") return null;
  return findFirstRunnablePath(["C:\\LenovoSoftstore\\Install\\EVluping\\ffmpeg.exe"]);
}

function resolveFfBinary(name) {
  return resolveInstallerFfBinary(name) ?? resolveBundledFfBinary(name) ?? resolveSystemFfBinary(name);
}

function resolveSystemChromiumBinary() {
  if (process.platform === "win32") {
    return findFirstExistingPath([
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]);
  }
  if (process.platform === "darwin") {
    return findFirstExistingPath([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]);
  }
  return findFirstRunnablePath(["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]);
}

function inheritedPathEnv() {
  const currentPath = process.env.PATH || "";
  if (process.platform !== "darwin") return currentPath;
  const fallbackPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set([...currentPath.split(path.delimiter).filter(Boolean), ...fallbackPaths])].join(path.delimiter);
}

function spawnLocalHyperframes(args, cwd) {
  const isInit = args[0] === "init";
  const ffmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH || resolveFfBinary("ffmpeg");
  const ffprobePath = process.env.HYPERFRAMES_FFPROBE_PATH || resolveFfBinary("ffprobe");
  const browserPath =
    process.env.HYPERFRAMES_BROWSER_PATH ||
    process.env.PRODUCER_HEADLESS_SHELL_PATH ||
    resolveSystemChromiumBinary();
  return spawn(process.execPath, [resolveLocalHyperframesCli(), ...args], {
    cwd,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: inheritedPathEnv(),
      BROWSER: "none",
      ELECTRON_RUN_AS_NODE: "1",
      NO_COLOR: "1",
      ...(ffmpegPath ? { HYPERFRAMES_FFMPEG_PATH: ffmpegPath } : {}),
      ...(ffprobePath ? { HYPERFRAMES_FFPROBE_PATH: ffprobePath } : {}),
      ...(browserPath
        ? {
            HYPERFRAMES_BROWSER_PATH: browserPath,
            PRODUCER_HEADLESS_SHELL_PATH: browserPath,
          }
        : {}),
      ...(isInit ? { HYPERFRAMES_SKIP_SKILLS: "1" } : {}),
    },
  });
}

async function readHyperframesServerConfig(port) {
  return await new Promise((resolve) => {
    const request = createServerProbeRequest(port, (config) => resolve(config));
    request.on("error", () => resolve(null));
    request.setTimeout(1_500, () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

function createServerProbeRequest(port, onConfig) {
  const http = require("node:http");
  const request = http.request({
    host: "127.0.0.1",
    port,
    path: "/__hyperframes_config",
    method: "GET",
  }, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        onConfig(parsed?.isHyperframes ? parsed : null);
      } catch {
        onConfig(null);
      }
    });
  });
  return request;
}

async function waitForHyperframesServer(port, expectedProjectPath, timeoutMs = HYPERFRAMES_START_TIMEOUT_MS) {
  const startedAt = Date.now();
  const expectedProjectDir = path.resolve(expectedProjectPath);
  while (Date.now() - startedAt < timeoutMs) {
    const config = await readHyperframesServerConfig(port);
    if (config?.isHyperframes) {
      const runningProject = typeof config.projectDir === "string" ? path.resolve(config.projectDir) : "";
      if (runningProject === expectedProjectDir) return config;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  }
  throw new Error(`Timed out waiting for HyperFrames Studio on port ${port}.`);
}

async function stopStaleHyperframesPort(port, expectedProjectPath) {
  const config = await readHyperframesServerConfig(port);
  if (!config?.pid) return;
  const runningProject = typeof config.projectDir === "string" ? path.resolve(config.projectDir) : "";
  const runningVersion = typeof config.version === "string" ? config.version : "";
  const expectedVersion = localHyperframesVersion();
  if (runningProject === path.resolve(expectedProjectPath) && runningVersion === expectedVersion) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(config.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(Number(config.pid), "SIGTERM");
    }
  } catch {
    /* stale process may already be gone */
  }
}

function resolveWorkspaceChild(root, childPath) {
  const workspaceRoot = path.resolve(String(root ?? "").trim());
  const relative = String(childPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid HyperFrames project path.");
  }
  const resolved = path.resolve(workspaceRoot, relative);
  const relativeBack = path.relative(workspaceRoot, resolved);
  if (relativeBack.startsWith("..") || path.isAbsolute(relativeBack)) {
    throw new Error("HyperFrames project must stay inside the workspace.");
  }
  return { workspaceRoot, projectPath: resolved, projectDirectory: relative };
}

async function runHyperframesInit(workspaceRoot, projectDirectory, projectPath) {
  if (existsSync(path.join(projectPath, "index.html"))) {
    await ensureVisibleHyperframesStarter(projectPath);
    return;
  }
  await mkdir(path.dirname(projectPath), { recursive: true });
  const child = spawnLocalHyperframes(["init", projectDirectory, "--example", "blank", "--non-interactive"], workspaceRoot);
  let output = "";
  await new Promise((resolve, reject) => {
    child.stdout?.on("data", (data) => { output += String(data); });
    child.stderr?.on("data", (data) => { output += String(data); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(output.trim() || `HyperFrames init failed (${code ?? "unknown"}).`));
    });
  });
  await ensureVisibleHyperframesStarter(projectPath);
}

async function ensureVisibleHyperframesStarter(projectPath) {
  const indexPath = path.join(projectPath, "index.html");
  if (!existsSync(indexPath)) return;
  const html = await readFile(indexPath, "utf8");
  if (html.includes("ipollowork-video-placeholder")) return;
  if (!html.includes("Add your clips here")) return;

  const placeholder = `      <div id="ipollowork-video-placeholder" class="clip" data-start="0" data-duration="10" data-track-index="1" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:#111827; color:#f8fafc; font:600 56px Inter, sans-serif;">
        Ready
      </div>

`;
  const patched = html.replace(
    /(<div\b[^>]*\bdata-composition-id="main"[^>]*>\s*)(<!--\s*Add your clips here)/,
    `$1${placeholder}$2`,
  );
  if (patched !== html) {
    await writeFile(indexPath, patched, "utf8");
  }
}

function stopHyperframesForKey(key) {
  const running = hyperframesProcesses.get(key);
  if (!running) return;
  hyperframesProcesses.delete(key);
  clearTimeout(running.timeout);
  killProcessTree(running.process);
}

function stopHyperframesForWebContents(webContentsId) {
  for (const [key, running] of hyperframesProcesses.entries()) {
    if (running.webContentsId === webContentsId) stopHyperframesForKey(key);
  }
}

async function startHyperframesPreview(event, options = {}) {
  const sessionId = String(options.sessionId ?? "").trim();
  if (!sessionId) throw new Error("sessionId is required.");
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Valid HyperFrames port is required.");
  const { workspaceRoot, projectPath, projectDirectory } = resolveWorkspaceChild(options.workspaceRoot, options.projectDirectory);
  const key = hyperframesKey(event.sender.id, sessionId);
  const current = hyperframesProcesses.get(key);
  if (current?.process && current.process.exitCode === null && current.port === port) {
    return { ok: true, port, reused: true };
  }
  stopHyperframesForKey(key);
  await runHyperframesInit(workspaceRoot, projectDirectory, projectPath);
  await stopStaleHyperframesPort(port, projectPath);

  const child = spawnLocalHyperframes(["preview", "--port", String(port), "--no-open"], projectPath);
  let output = "";
  return await new Promise((resolve, reject) => {
    let ready = false;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const finishReady = () => {
      if (ready || settled) return;
      ready = true;
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      hyperframesProcesses.set(key, { process: child, webContentsId: event.sender.id, port, timeout: null });
      event.sender.once("destroyed", () => stopHyperframesForWebContents(event.sender.id));
      resolve({ ok: true, port, reused: false });
    };
    const failStart = (error) => {
      if (settled || ready) return;
      settled = true;
      cleanup();
      hyperframesProcesses.delete(key);
      reject(error);
    };
    const onData = (data) => {
      output += String(data);
    };
    const onError = (error) => {
      failStart(error);
    };
    const onExit = (code) => {
      if (ready) return;
      failStart(new Error(output.trim() || `HyperFrames stopped before Studio was ready (${code ?? "unknown"}).`));
    };
    const timeout = setTimeout(() => {
      killProcessTree(child);
      failStart(new Error(output.trim() || "Timed out starting HyperFrames Studio."));
    }, HYPERFRAMES_START_TIMEOUT_MS);
    hyperframesProcesses.set(key, { process: child, webContentsId: event.sender.id, port, timeout });
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    waitForHyperframesServer(port, projectPath).then(finishReady, (error) => {
      killProcessTree(child);
      failStart(error);
    });
  });
}

// Production Electron shares the same on-disk state folder as the Tauri shell
// so in-place migration is a no-op for almost every file. Dev mode uses the
// separate dev identifier so it can run beside the production app.
//
// Override via IPOLLOWORK_ELECTRON_USERDATA so dogfooders can isolate their
// Electron install from the real Tauri app.
app.setName(APP_NAME);
app.setAppUserModelId(APP_IDENTIFIER);
if (app.isPackaged) {
  app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL_SCHEME);
}
const userDataOverride = process.env.IPOLLOWORK_ELECTRON_USERDATA?.trim();
if (userDataOverride) {
  app.setPath("userData", userDataOverride);
} else {
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), APP_IDENTIFIER),
  );
}

// Resolve and cache the app icon (reused for BrowserWindow + mac dock).
// Packaged builds ship icons via electron-builder config, but for `dev:electron`
// the Electron default icon is shown without this.
function resolveAppIconPath() {
  if (process.platform === "darwin") {
    const candidates = [
      path.resolve(__dirname, "../resources/icons/mac/icon.icns"),
      path.join(process.resourcesPath ?? "", "icons", "mac", "icon.icns"),
      path.resolve(__dirname, "../resources/icons/icon.icns"),
    ];
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) return candidate;
    }
  }

  if (process.platform === "win32") {
    const candidates = [
      path.resolve(__dirname, "../resources/icons/windows/icon.ico"),
      path.join(process.resourcesPath ?? "", "icons", "windows", "icon.ico"),
      path.resolve(__dirname, "../resources/icons/icon.ico"),
      path.join(process.resourcesPath ?? "", "icons", "icon.ico"),
      path.resolve(__dirname, "../resources/icons/icon.png"),
      path.join(process.resourcesPath ?? "", "icons", "icon.png"),
    ];
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) return candidate;
    }
  }

  const candidates = [
    // Repo-relative path to the Electron resource icon set.
    path.resolve(__dirname, "../resources/icons/icon.png"),
    // Packaged: electron-builder copies extraResources but we fall back to this
    // if custom packaging ever exposes the icon here.
    path.join(process.resourcesPath ?? "", "icons", "icon.png"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function normalizeRuntimeArch(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["arm64", "aarch64", "arm64e"].includes(normalized)) return "arm64";
  if (["x64", "x86_64", "amd64"].includes(normalized)) return "x64";
  return normalized || "unknown";
}

function isMacRunningUnderRosetta() {
  if (process.platform !== "darwin" || process.arch !== "x64") return false;
  try {
    return execFileSync("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "1";
  } catch {
    return false;
  }
}

function resolveSystemArch() {
  if (process.platform === "darwin" && isMacRunningUnderRosetta()) return "arm64";
  if (process.platform === "win32") {
    return normalizeRuntimeArch(
      process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || os.arch(),
    );
  }
  if (typeof os.machine === "function") return normalizeRuntimeArch(os.machine());
  return normalizeRuntimeArch(os.arch());
}

function platformDownloadSlug() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "win";
  return "linux";
}

function downloadAssetArch(arch) {
  if (process.platform === "linux" && arch === "x64") return "x86_64";
  return arch;
}

function downloadAssetExtension() {
  if (process.platform === "darwin") return "dmg";
  if (process.platform === "win32") return "exe";
  return "AppImage";
}

function updaterManifestName(arch) {
  if (process.platform === "darwin") return "latest-mac.yml";
  if (process.platform === "win32") return "latest.yml";
  return arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
}

function archLabel(arch) {
  if (arch === "arm64") return "ARM";
  if (arch === "x64") return "Intel";
  return arch;
}

function parseUpdaterManifestFiles(raw) {
  const files = [];
  let current = null;
  for (const line of String(raw || "").split(/\r?\n/)) {
    const start = line.match(/^\s*-\s+url:\s*(.+?)\s*$/);
    if (start) {
      current = { url: start[1].trim().replace(/^['"]|['"]$/g, "") };
      files.push(current);
      continue;
    }
    const prop = line.match(/^\s{4}([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/);
    if (prop && current) {
      current[prop[1]] = prop[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return files.filter((file) => file.url);
}

function selectDownloadFile(files, arch) {
  const assetArch = downloadAssetArch(arch);
  const expected = `-${assetArch}-`;
  const extension = downloadAssetExtension();
  const matchingArch = files.filter((file) => file.url.includes(expected));
  return (
    matchingArch.find((file) => file.url.endsWith(`.${extension}`)) ||
    matchingArch.find((file) => file.url.endsWith(".zip")) ||
    matchingArch[0] ||
    null
  );
}

async function resolveCorrectArchitectureDownloadUrl(arch) {
  // The development shell must remain usable when GitHub is unavailable.
  // Architecture detection is local; the manifest is only needed to offer a
  // correct-build download in the packaged mismatch flow.
  if (isDevMode) return null;
  const manifestUrl = `${RELEASE_DOWNLOAD_BASE_URL}/${updaterManifestName(arch)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(manifestUrl, {
      headers: { Accept: "text/yaml, text/plain, */*" },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const selected = selectDownloadFile(parseUpdaterManifestFiles(await response.text()), arch);
    if (!selected?.url) return null;
    return /^https?:\/\//i.test(selected.url)
      ? selected.url
      : new URL(selected.url, `${RELEASE_DOWNLOAD_BASE_URL}/`).toString();
  } catch (error) {
    console.warn("[architecture] failed to resolve latest download URL", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveArchitectureInfo() {
  const appArch = normalizeRuntimeArch(process.arch);
  const systemArch = resolveSystemArch();
  const version = app.getVersion();
  const targetArch = systemArch === "arm64" || systemArch === "x64" ? systemArch : appArch;
  const assetName = `ipollowork-${platformDownloadSlug()}-${downloadAssetArch(targetArch)}-${version}.${downloadAssetExtension()}`;
  const latestDownloadUrl = await resolveCorrectArchitectureDownloadUrl(targetArch);
  const hasCorrectArchitectureDownload = Boolean(latestDownloadUrl);
  return {
    appArch,
    appArchLabel: archLabel(appArch),
    systemArch,
    systemArchLabel: archLabel(systemArch),
    mismatch: appArch !== systemArch && hasCorrectArchitectureDownload,
    platform: process.platform === "win32" ? "windows" : process.platform,
    version,
    downloadUrl: latestDownloadUrl || `${RELEASE_DOWNLOAD_BASE_URL}/${assetName}`,
    releaseUrl: RELEASE_PAGE_URL,
  };
}

const APP_ICON_PATH = resolveAppIconPath();
const APP_ICON_IMAGE = APP_ICON_PATH ? nativeImage.createFromPath(APP_ICON_PATH) : null;
const BRAND_ICON_MAX_BYTES = 2 * 1024 * 1024;
const BRAND_ICON_FETCH_TIMEOUT_MS = 10_000;
// Validate remote brand icons so logo CDNs
// that expect a browser request behave the same at save time and apply time.
const BRAND_ICON_FETCH_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
let brandIconApplySequence = 0;
let brandIconRuntimeState = { applied: false, sourceUrl: null, reason: null };

function brandIconCachePath() {
  return path.join(app.getPath("userData"), "brand-icon.png");
}

function brandIconSidecarPath() {
  return path.join(app.getPath("userData"), "brand-icon.json");
}

function brandIconWindowsPath() {
  return path.join(app.getPath("userData"), "brand-icon.ico");
}

function defaultAppWindowsIconPath() {
  // Keep the filename versioned. Windows Explorer caches taskbar icons by
  // shortcut/AppUserModelID and icon path, so overwriting the same ICO can
  // continue showing an older brand indefinitely during development.
  return path.join(app.getPath("userData"), "ipollowork-stock-v2.ico");
}

let cachedWindowsProgramsPath = null;
function windowsProgramsPath() {
  if (cachedWindowsProgramsPath) return cachedWindowsProgramsPath;
  const userProfile = app.getPath("userData").split(/[\\/]AppData[\\/]/i)[0];
  cachedWindowsProgramsPath = path.join(userProfile, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs");
  return cachedWindowsProgramsPath;
}

function windowsBrandShortcutPath() {
  return path.join(windowsProgramsPath(), windowsBrandShortcutFileName(currentDisplayAppName));
}

function windowsInstalledShortcutPath() {
  return path.join(windowsProgramsPath(), windowsInstalledShortcutFileName(APP_NAME));
}

function windowsBrandShortcutMarkerPath() {
  return path.join(app.getPath("userData"), "windows-brand-shortcut.txt");
}

function windowsExecutablePath() {
  return windowsInstalledExecutablePath({
    packaged: app.isPackaged,
    execPath: app.getPath("exe"),
    resourcesPath: process.resourcesPath,
    shortcutPath: windowsBrandShortcutPath(),
  });
}

async function readWindowsBrandShortcutMarker() {
  return (await readFile(windowsBrandShortcutMarkerPath(), "utf8").catch(() => "")).trim();
}

function repairWindowsShortcutTarget(shortcutPath, details) {
  const payload = Buffer.from(JSON.stringify({ shortcutPath, ...details }), "utf8").toString("base64");
  const script = [
    `$value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    "$shell = New-Object -ComObject WScript.Shell",
    "$link = $shell.CreateShortcut($value.shortcutPath)",
    "$link.TargetPath = $value.target",
    "$link.WorkingDirectory = $value.cwd",
    "$link.Description = $value.description",
    "$link.IconLocation = \"$($value.icon),$($value.iconIndex)\"",
    "$link.Save()",
  ].join("\n");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
}

async function registerWindowsBrandShortcut(appId, appIconPath) {
  if (process.platform !== "win32") return null;
  const shortcutPath = windowsBrandShortcutPath();
  const shortcutTempPath = `${shortcutPath}.${process.pid}.tmp.lnk`;
  await mkdir(path.dirname(shortcutPath), { recursive: true });
  // Recreate instead of replacing in place. Explorer can retain the old
  // target and search metadata when a prior installer owned this path.
  await rm(shortcutPath, { force: true });
  await rm(shortcutTempPath, { force: true });
  const details = windowsBrandShortcutDetails({
    target: windowsExecutablePath(),
    appId,
    appIconPath,
    appName: currentDisplayAppName,
  });
  const written = writeWindowsBrandShortcut(shell, shortcutTempPath, details, false);
  if (!written) throw new Error(`Windows rejected the organization shortcut: ${shortcutPath}`);
  await rename(shortcutTempPath, shortcutPath);
  if (shell.readShortcutLink(shortcutPath).target !== details.target) {
    repairWindowsShortcutTarget(shortcutPath, details);
  }
  const previousShortcutPath = await readWindowsBrandShortcutMarker();
  if (previousShortcutPath && previousShortcutPath !== shortcutPath) {
    await rm(previousShortcutPath, { force: true });
  }
  if (windowsInstalledShortcutPath() !== shortcutPath) {
    await rm(windowsInstalledShortcutPath(), { force: true });
  }
  await writeFile(windowsBrandShortcutMarkerPath(), shortcutPath, "utf8");
  return shortcutPath;
}

async function removeWindowsBrandShortcut() {
  if (process.platform !== "win32") return;
  const shortcutPath = await readWindowsBrandShortcutMarker();
  if (shortcutPath) await rm(shortcutPath, { force: true });
  await rm(windowsBrandShortcutMarkerPath(), { force: true });
}

function resolveBrandIconImage() {
  try {
    const cachePath = brandIconCachePath();
    if (!existsSync(cachePath)) return null;
    const image = nativeImage.createFromPath(cachePath);
    return image && !image.isEmpty() ? image : null;
  } catch {
    return null;
  }
}

function brandIconFailure(reason, error) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  console.warn(`[brand-icon] ${reason}${detail ? `: ${detail}` : ""}`);
  return { ok: false, reason };
}

function recordBrandIconResult(result, sourceUrl) {
  if (result.ok) {
    brandIconRuntimeState = {
      applied: typeof sourceUrl === "string",
      sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null,
      reason: null,
    };
  } else {
    brandIconRuntimeState = { ...brandIconRuntimeState, reason: result.reason ?? "apply-failed" };
  }
  return result;
}

async function applyAppIconImage(image, { taskbarIconPath = null, taskbarAppId = APP_IDENTIFIER } = {}) {
  if (!image || image.isEmpty()) return brandIconFailure("invalid-image");
  try {
    if (process.platform === "darwin") {
      if (!app.dock) return brandIconFailure("dock-unavailable");
      app.dock.setIcon(image);
      return { ok: true };
    }

    if (process.platform === "win32") {
      if (!taskbarIconPath || !existsSync(taskbarIconPath)) {
        return brandIconFailure("taskbar-icon-missing");
      }
      if (!mainWindow) return { ok: true };
      await applyWindowsTaskbarIcon(mainWindow, {
        image,
        appId: taskbarAppId,
        appIconPath: taskbarIconPath,
        relaunchCommand: windowsExecutablePath(),
        relaunchDisplayName: currentDisplayAppName,
      });
    } else {
      if (!mainWindow) return brandIconFailure("window-unavailable");
      mainWindow.setIcon(image);
    }
    return { ok: true };
  } catch (error) {
    return brandIconFailure("os-apply-failed", error);
  }
}

async function applyDefaultAppIconImage(expectedSequence = null) {
  let image = APP_ICON_IMAGE;
  let taskbarIconPath = null;
  if (process.platform === "win32") {
    try {
      await removeWindowsBrandShortcut();
      app.setAppUserModelId(APP_IDENTIFIER);
    } catch (error) {
      return brandIconFailure("shortcut-remove-failed", error);
    }
    if (image && !image.isEmpty()) {
      try {
        taskbarIconPath = defaultAppWindowsIconPath();
        await writeWindowsIconFile(image, taskbarIconPath);
      } catch (error) {
        return brandIconFailure("stock-icon-unavailable", error);
      }
    } else {
      try {
        const executableIcon = await app.getFileIcon(process.execPath, { size: "large" });
        if (executableIcon && !executableIcon.isEmpty()) image = executableIcon;
        taskbarIconPath = process.execPath;
      } catch (error) {
        return brandIconFailure("stock-icon-unavailable", error);
      }
    }
  }
  if (!image || image.isEmpty()) {
    // Preserve the pre-existing no-op fallback on platforms whose packaged
    // application icon is managed entirely by the bundle.
    return process.platform === "win32" ? brandIconFailure("stock-icon-unavailable") : { ok: true };
  }
  if (process.platform === "win32" && taskbarIconPath) {
    try {
      await registerWindowsBrandShortcut(APP_IDENTIFIER, taskbarIconPath);
    } catch (error) {
      return brandIconFailure("shortcut-write-failed", error);
    }
  }
  if (expectedSequence !== null && expectedSequence !== brandIconApplySequence) {
    return { ok: false, reason: "stale" };
  }
  return applyAppIconImage(image, {
    taskbarIconPath,
    taskbarAppId: APP_IDENTIFIER,
  });
}

async function focusMainWindowFromNotification() {
  const win = await createMainWindow();
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function enforceMainWindowMinimumSize(win) {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getSize();
  const nextWidth = Math.max(width, MAIN_WINDOW_MIN_WIDTH);
  const nextHeight = Math.max(height, MAIN_WINDOW_MIN_HEIGHT);
  if (nextWidth !== width || nextHeight !== height) {
    win.setSize(nextWidth, nextHeight);
  }
}

/**
 * @param {unknown} input
 * @returns {import("@ipollowork/types/desktop-ipc").DesktopNotificationResult}
 */
function showDesktopNotification(input) {
  if (!ElectronNotification.isSupported()) {
    return { ok: false, reason: "notifications unsupported" };
  }

  const record = input && typeof input === "object" ? input : {};
  const title = String(Reflect.get(record, "title") ?? "").trim();
  if (!title) {
    return { ok: false, reason: "missing title" };
  }

  const body = String(Reflect.get(record, "body") ?? "").trim();
  const icon = resolveBrandIconImage() ?? APP_ICON_IMAGE;
  const options = {
    title,
    ...(body ? { body } : {}),
    ...(Reflect.get(record, "silent") === true ? { silent: true } : {}),
    ...(icon && !icon.isEmpty() ? { icon } : {}),
  };

  try {
    const notification = new ElectronNotification(options);
    notification.on("click", () => {
      void focusMainWindowFromNotification();
    });
    notification.show();
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "failed to show notification";
    return { ok: false, reason };
  }
}

async function readBrandIconSidecar() {
  try {
    const parsed = JSON.parse(await readFile(brandIconSidecarPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function clearBrandIconCache() {
  await Promise.all([
    rm(brandIconCachePath(), { force: true }),
    rm(brandIconSidecarPath(), { force: true }),
    rm(brandIconWindowsPath(), { force: true }),
  ]);
}

function normalizeBrandIconSourceUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

async function fetchBrandIconBuffer(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRAND_ICON_FETCH_TIMEOUT_MS);
  try {
    const response = await electronNet.fetch(sourceUrl, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      headers: {
        "user-agent": BRAND_ICON_FETCH_USER_AGENT,
        accept: "image/*,*/*",
      },
    });
    if (!response.ok) return { ok: false, reason: "http-status" };

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > BRAND_ICON_MAX_BYTES) {
      return { ok: false, reason: "too-large" };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > BRAND_ICON_MAX_BYTES) {
      return { ok: false, reason: "too-large" };
    }
    return { ok: true, buffer };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "fetch-failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function brandIconImageRejectionReason(image) {
  if (!image || image.isEmpty()) return "invalid-image";
  const size = image.getSize();
  if (size.width < 64 || size.height < 64) return "too-small";
  const aspectRatio = size.width / size.height;
  if (aspectRatio < 1 / 1.5 || aspectRatio > 1.5) return "invalid-aspect";
  return null;
}

async function writeBrandIconCache(image, sourceUrl) {
  const cachePath = brandIconCachePath();
  const sidecarPath = brandIconSidecarPath();
  const windowsPath = brandIconWindowsPath();
  const suffix = `${process.pid}-${Date.now()}`;
  const cacheTempPath = `${cachePath}.${suffix}.tmp`;
  const sidecarTempPath = `${sidecarPath}.${suffix}.tmp`;
  const windowsTempPath = `${windowsPath}.${suffix}.tmp`;
  const windowsIcon = process.platform === "win32" ? windowsIconFromNativeImage(image) : null;
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cacheTempPath, image.toPNG());
    if (windowsIcon) await writeFile(windowsTempPath, windowsIcon);
    await writeFile(sidecarTempPath, JSON.stringify({
      sourceUrl,
      appliedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
    }, null, 2), "utf8");
    await rename(cacheTempPath, cachePath);
    if (windowsIcon) await rename(windowsTempPath, windowsPath);
    await rename(sidecarTempPath, sidecarPath);
  } catch (error) {
    await Promise.all([
      rm(cacheTempPath, { force: true }),
      rm(sidecarTempPath, { force: true }),
      rm(windowsTempPath, { force: true }),
    ]).catch(() => undefined);
    throw error;
  }
}

async function writeWindowsIconFile(image, destination) {
  const tempPath = `${destination}.${process.pid}-${Date.now()}.tmp`;
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(tempPath, windowsIconFromNativeImage(image));
    await rename(tempPath, destination);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensureWindowsBrandIcon(image) {
  if (process.platform !== "win32") return null;
  const windowsPath = brandIconWindowsPath();
  if (!existsSync(windowsPath)) await writeWindowsIconFile(image, windowsPath);
  return windowsPath;
}

async function registerWindowsDisplayShortcut() {
  if (process.platform !== "win32") return;
  const sidecar = await readBrandIconSidecar();
  const sourceUrl = typeof sidecar?.sourceUrl === "string" ? sidecar.sourceUrl : null;
  const brandedImage = sourceUrl ? resolveBrandIconImage() : null;
  if (brandedImage && sourceUrl) {
    const iconPath = await ensureWindowsBrandIcon(brandedImage);
    await registerWindowsBrandShortcut(windowsBrandAppUserModelId(APP_IDENTIFIER, sourceUrl), iconPath);
    return;
  }
  const stockImage = APP_ICON_IMAGE ?? await app.getFileIcon(windowsExecutablePath(), { size: "large" });
  const iconPath = defaultAppWindowsIconPath();
  await writeWindowsIconFile(stockImage, iconPath);
  await registerWindowsBrandShortcut(APP_IDENTIFIER, iconPath);
}

async function applyCachedBrandIcon(image, sourceUrl, expectedSequence = null) {
  let taskbarIconPath = null;
  let taskbarAppId = APP_IDENTIFIER;
  try {
    taskbarIconPath = await ensureWindowsBrandIcon(image);
    if (process.platform === "win32") {
      taskbarAppId = windowsBrandAppUserModelId(APP_IDENTIFIER, sourceUrl);
      await registerWindowsBrandShortcut(taskbarAppId, taskbarIconPath);
      app.setAppUserModelId(taskbarAppId);
    }
  } catch (error) {
    if (expectedSequence !== null && expectedSequence !== brandIconApplySequence) {
      return { ok: false, reason: "stale" };
    }
    return recordBrandIconResult(brandIconFailure("write-failed", error), sourceUrl);
  }
  if (expectedSequence !== null && expectedSequence !== brandIconApplySequence) {
    return { ok: false, reason: "stale" };
  }
  return recordBrandIconResult(await applyAppIconImage(image, {
    taskbarIconPath,
    taskbarAppId,
  }), sourceUrl);
}

async function applyBrandIconUrl(value) {
  const sequence = ++brandIconApplySequence;
  if (value === null) {
    const result = await applyDefaultAppIconImage(sequence);
    if (result.reason === "stale") return result;
    const applied = recordBrandIconResult(result, null);
    if (!applied.ok) return applied;
    try {
      await clearBrandIconCache();
      return applied;
    } catch (error) {
      return recordBrandIconResult(brandIconFailure("clear-failed", error), null);
    }
  }

  const sourceUrl = normalizeBrandIconSourceUrl(value);
  if (!sourceUrl) return recordBrandIconResult(brandIconFailure("invalid-url"), null);

  const sidecar = await readBrandIconSidecar();
  const cachedImage = resolveBrandIconImage();
  if (sidecar?.sourceUrl === sourceUrl && cachedImage) {
    return applyCachedBrandIcon(cachedImage, sourceUrl, sequence);
  }

  const fetched = await fetchBrandIconBuffer(sourceUrl);
  if (sequence !== brandIconApplySequence) return { ok: false, reason: "stale" };
  if (!fetched.ok) return recordBrandIconResult(brandIconFailure(fetched.reason), sourceUrl);

  const image = nativeImage.createFromBuffer(fetched.buffer);
  const rejectionReason = brandIconImageRejectionReason(image);
  if (rejectionReason) return recordBrandIconResult(brandIconFailure(rejectionReason), sourceUrl);

  try {
    await writeBrandIconCache(image, sourceUrl);
  } catch (error) {
    if (sequence !== brandIconApplySequence) return { ok: false, reason: "stale" };
    return recordBrandIconResult(brandIconFailure("write-failed", error), sourceUrl);
  }
  if (sequence !== brandIconApplySequence) {
    const latestSidecar = await readBrandIconSidecar();
    if (latestSidecar?.sourceUrl === sourceUrl) {
      await clearBrandIconCache().catch(() => undefined);
    }
    return { ok: false, reason: "stale" };
  }
  return applyCachedBrandIcon(image, sourceUrl, sequence);
}

async function getBrandIconState() {
  return { ...brandIconRuntimeState };
}

const INITIAL_APP_ICON_IMAGE = resolveBrandIconImage() ?? APP_ICON_IMAGE;
if (process.platform === "darwin" && INITIAL_APP_ICON_IMAGE && !INITIAL_APP_ICON_IMAGE.isEmpty() && app.dock) {
  app.dock.setIcon(INITIAL_APP_ICON_IMAGE);
}

// Expose Chrome DevTools Protocol so the opencode-chrome-devtools plugin can
// drive the built-in browser panel.  Use IPOLLOWORK_ELECTRON_REMOTE_DEBUG_PORT to
// pin a specific port; otherwise probe for a free one starting at 9223.
// Must resolve before app.commandLine.appendSwitch (before `ready`).
function probePort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findFreeCdpPort(candidates) {
  for (const port of candidates) {
    if (await probePort(port)) return port;
  }
  return 0;
}

const explicitCdpPort = Number.parseInt(
  process.env.IPOLLOWORK_ELECTRON_REMOTE_DEBUG_PORT?.trim() ?? "",
  10,
);
const remoteDebugPort = Number.isFinite(explicitCdpPort) && explicitCdpPort > 0
  ? explicitCdpPort
  : await findFreeCdpPort([9223, 9224, 9225, 9226, 9227]);
if (remoteDebugPort > 0) {
  app.commandLine.appendSwitch("remote-debugging-port", String(remoteDebugPort));
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}
// Make the resolved port available to the embedded server so it flows into
// agent instructions via ensureiPolloWorkAgent → resolveAgentTemplate.
process.env.IPOLLOWORK_ELECTRON_REMOTE_DEBUG_PORT = String(remoteDebugPort);

// Apply extra Chromium flags from ELECTRON_EXTRA_LAUNCH_ARGS.
// Used in headless/Daytona environments to pass e.g. --disable-gpu.
const extraLaunchArgs = (process.env.ELECTRON_EXTRA_LAUNCH_ARGS ?? "").trim();
if (extraLaunchArgs) {
  for (const arg of extraLaunchArgs.split(/\s+/)) {
    const cleaned = arg.replace(/^--/, "");
    if (!cleaned) continue;
    const eqIdx = cleaned.indexOf("=");
    if (eqIdx > 0) {
      app.commandLine.appendSwitch(cleaned.slice(0, eqIdx), cleaned.slice(eqIdx + 1));
    } else {
      app.commandLine.appendSwitch(cleaned);
    }
  }
}
configureFakeMediaForTests(app, envFlagEnabled("IPOLLOWORK_ELECTRON_FAKE_MEDIA"));
const DEFAULT_DEN_BASE_URL = "https://app.ipolloworklabs.com";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:4096";
const FORCE_DESKTOP_REQUIRE_SIGNIN = envFlagEnabled("IPOLLOWORK_FORCE_SIGNIN");
const DEFAULT_DESKTOP_REQUIRE_SIGNIN = FORCE_DESKTOP_REQUIRE_SIGNIN;

function envFlagEnabled(name) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

const IDLE_ENGINE_INFO = Object.freeze({
  running: false,
  runtime: "direct",
  baseUrl: null,
  projectDir: null,
  hostname: null,
  port: null,
  opencodeUsername: null,
  opencodePassword: null,
  opencodeBinPath: null,
  opencodeBinSource: null,
  pid: null,
  lastStdout: null,
  lastStderr: null,
});

const IDLE_IPOLLOWORK_SERVER_INFO = Object.freeze({
  running: false,
  remoteAccessEnabled: false,
  host: null,
  port: null,
  baseUrl: null,
  connectUrl: null,
  mdnsUrl: null,
  lanUrl: null,
  clientToken: null,
  ownerToken: null,
  hostToken: null,
  managedOpencodeBinPath: null,
  managedOpencodeBinSource: null,
  pid: null,
  lastStdout: null,
  lastStderr: null,
});

const IDLE_ROUTER_INFO = Object.freeze({
  running: false,
  version: null,
  workspacePath: null,
  opencodeUrl: null,
  healthPort: null,
  pid: null,
  lastStdout: null,
  lastStderr: null,
});

let mainWindow = null;
const pendingDeepLinks = [];

function mainWindowStatePath() {
  return path.join(app.getPath("userData"), MAIN_WINDOW_STATE_FILE);
}

function normalizeMainWindowBounds(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(Reflect.get(value, "x"));
  const y = Number(Reflect.get(value, "y"));
  const width = Number(Reflect.get(value, "width"));
  const height = Number(Reflect.get(value, "height"));
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(MAIN_WINDOW_MIN_WIDTH, Math.round(width)),
    height: Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.round(height)),
  };
}

function mainWindowBoundsAreVisible(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

async function readMainWindowState() {
  try {
    const raw = await readFile(mainWindowStatePath(), "utf8");
    const bounds = normalizeMainWindowBounds(JSON.parse(raw));
    if (!bounds || !mainWindowBoundsAreVisible(bounds)) return null;
    return bounds;
  } catch {
    return null;
  }
}

async function writeMainWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  const bounds = normalizeMainWindowBounds(win.getBounds());
  if (!bounds) return;
  try {
    await writeFile(mainWindowStatePath(), JSON.stringify(bounds), "utf8");
  } catch (error) {
    console.warn("[window-state] failed to persist main window bounds", error);
  }
}

const browserPanel = createBrowserPanel({
  remoteDebugPort,
  getWindow: () => mainWindow,
  onDeepLink: (urls) => queueDeepLinks(urls),
});

const workspaceStore = createWorkspaceStore({
  app,
  defaultDenBaseUrl: DEFAULT_DEN_BASE_URL,
  defaultRequireSignin: DEFAULT_DESKTOP_REQUIRE_SIGNIN,
  forceRequireSignin: FORCE_DESKTOP_REQUIRE_SIGNIN,
});

function normalizePlatform(value) {
  if (value === "darwin" || value === "linux") return value;
  if (value === "win32") return "windows";
  return "linux";
}

function forwardedDeepLinks(argv) {
  return argv
    .slice(1)
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.startsWith("ipollowork://") ||
        entry.startsWith("ipollowork-dev://") ||
        entry.startsWith("https://") ||
        entry.startsWith("http://"),
    );
}

function queueDeepLinks(urls) {
  const nextUrls = urls.filter(Boolean);
  if (nextUrls.length === 0) return;
  pendingDeepLinks.push(...nextUrls);
  if (mainWindow?.webContents) {
    mainWindow.webContents.send(NATIVE_DEEP_LINK_EVENT, nextUrls);
  }
}

function flushPendingDeepLinks() {
  if (!mainWindow?.webContents || pendingDeepLinks.length === 0) return;
  const urls = pendingDeepLinks.splice(0, pendingDeepLinks.length);
  mainWindow.webContents.send(NATIVE_DEEP_LINK_EVENT, urls);
}

function configHomePath() {
  if (process.env.XDG_CONFIG_HOME?.trim()) {
    return process.env.XDG_CONFIG_HOME.trim();
  }
  if (process.platform === "win32" && process.env.APPDATA?.trim()) {
    return process.env.APPDATA.trim();
  }
  return path.join(os.homedir(), ".config");
}

function globalOpencodeRoot() {
  return path.join(configHomePath(), "opencode");
}

function execResult(ok, stdout = "", stderr = "", status = ok ? 0 : 1) {
  return { ok, status, stdout, stderr };
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function sanitizeCommandName(raw) {
  const trimmed = String(raw ?? "").trim().replace(/^\/+/, "");
  if (!trimmed) return null;
  const safe = Array.from(trimmed)
    .filter((char) => /[A-Za-z0-9_-]/.test(char))
    .join("");
  return safe || null;
}

function escapeYamlScalar(value) {
  return JSON.stringify(String(value ?? ""));
}

function serializeCommandFrontmatter(command) {
  const template = String(command?.template ?? "").trim();
  if (!template) {
    throw new Error("command.template is required");
  }

  let output = "---\n";
  if (typeof command?.description === "string" && command.description.trim()) {
    output += `description: ${escapeYamlScalar(command.description.trim())}\n`;
  }
  if (typeof command?.agent === "string" && command.agent.trim()) {
    output += `agent: ${escapeYamlScalar(command.agent.trim())}\n`;
  }
  if (typeof command?.model === "string" && command.model.trim()) {
    output += `model: ${escapeYamlScalar(command.model.trim())}\n`;
  }
  if (command?.subtask === true) {
    output += "subtask: true\n";
  }
  output += `---\n\n${template}\n`;
  return output;
}

function validateSkillName(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw new Error("skill name must be kebab-case");
  }
  return trimmed;
}

const runtimeManager = createRuntimeManager({
  app,
  desktopRoot: path.resolve(__dirname, ".."),
  listLocalWorkspacePaths: () => workspaceStore.listLocalWorkspacePaths(),
});

let runtimeDisposedForQuit = false;
let runtimeDisposeInProgress = false;
let runtimeBootstrapPromise = null;

function showShutdownScreen() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  try {
    win.show();
    win.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { height: 100%; margin: 0; background: #0b0b0f; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { display: grid; place-items: center; }
      main { display: grid; gap: 10px; justify-items: center; }
      .spinner { width: 22px; height: 22px; border: 2px solid rgba(244,244,245,.25); border-top-color: #f4f4f5; border-radius: 50%; animation: spin .9s linear infinite; }
      .title { font-size: 15px; font-weight: 600; }
      .body { font-size: 13px; color: #a1a1aa; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <main>
      <div class="spinner" aria-hidden="true"></div>
      <div class="title">Stopping iPolloWork services</div>
      <div class="body">Closing local workers and background services...</div>
    </main>
  </body>
</html>`)}`);
  } catch {
    // Ignore renderer teardown races during quit.
  }
}

async function disposeRuntimeBeforeQuit() {
  if (runtimeDisposedForQuit || runtimeDisposeInProgress) return;
  runtimeDisposeInProgress = true;
  try {
    await runtimeManager.dispose().catch(() => undefined);
    runtimeDisposedForQuit = true;
  } finally {
    runtimeDisposeInProgress = false;
  }
}

function assertiPolloWorkServerReady(info) {
  if (!info?.running) {
    throw new Error("iPolloWork server did not stay running after startup.");
  }
  if (!info.baseUrl) {
    throw new Error("iPolloWork server did not report a base URL after startup.");
  }
  if (!info.ownerToken && !info.clientToken) {
    throw new Error("iPolloWork server did not report an access token after startup.");
  }
  return info;
}

async function bootRuntimeForSelectedWorkspace() {
  const list = await workspaceStore.readWorkspaceState();
  const selectedId = list.selectedId || list.activeId || list.workspaces[0]?.id || "";
  const workspace = selectedId
    ? list.workspaces.find((entry) => entry?.id === selectedId)
    : list.workspaces[0];
  const workspaceRoot = String(workspace?.path ?? "").trim();
  if (!workspaceRoot || workspace?.workspaceType === "remote") {
    return { ok: true, skipped: true, reason: "no-local-workspace" };
  }

  const workspacePaths = [];
  for (const entry of list.workspaces) {
    if (entry?.workspaceType === "remote") continue;
    const workspacePath = String(entry?.path ?? "").trim();
    if (workspacePath && !workspacePaths.includes(workspacePath)) workspacePaths.push(workspacePath);
  }
  if (!workspacePaths.includes(workspaceRoot)) workspacePaths.unshift(workspaceRoot);

  let bootWorkspace = workspace;
  let bootWorkspaceRoot = workspaceRoot;
  let engine;
  try {
    engine = await runtimeManager.engineStart(workspaceRoot, {
      runtime: "direct",
      workspacePaths,
    });
  } catch (error) {
    const fallback = list.workspaces.find((entry) => {
      const candidatePath = String(entry?.path ?? "").trim();
      return entry?.workspaceType !== "remote" && candidatePath && candidatePath !== workspaceRoot;
    });
    const fallbackRoot = String(fallback?.path ?? "").trim();
    if (!fallback || !fallbackRoot) throw error;
    console.warn("[runtime] selected workspace failed during boot; trying fallback workspace", {
      selectedWorkspaceId: workspace?.id ?? null,
      fallbackWorkspaceId: fallback.id ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallbackWorkspacePaths = [
      fallbackRoot,
      ...workspacePaths.filter((entry) => entry !== fallbackRoot && entry !== workspaceRoot),
    ];
    engine = await runtimeManager.engineStart(fallbackRoot, {
      runtime: "direct",
      workspacePaths: fallbackWorkspacePaths,
    });
    bootWorkspace = fallback;
    bootWorkspaceRoot = fallbackRoot;
    await workspaceStore.writeWorkspaceState({
      ...list,
      selectedId: String(fallback.id ?? ""),
      watchedId: String(fallback.id ?? ""),
    }).catch(() => undefined);
  }
  await runtimeManager.orchestratorWorkspaceActivate({
    workspacePath: bootWorkspaceRoot,
    name: bootWorkspace.name ?? bootWorkspace.displayName ?? null,
  }).catch(() => undefined);
  const ipolloworkServer = assertiPolloWorkServerReady(await runtimeManager.ipolloworkServerInfo());
  return { ok: true, skipped: false, engine, ipolloworkServer, workspaceId: bootWorkspace.id ?? null };
}

function ensureRuntimeBootstrap() {
  if (!runtimeBootstrapPromise) {
    runtimeBootstrapPromise = bootRuntimeForSelectedWorkspace().catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
  return runtimeBootstrapPromise;
}

function resolveOpencodeConfigPath(scope, projectDir) {
  let root;
  if (scope === "project") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    root = projectDir;
  } else if (scope === "global") {
    root = globalOpencodeRoot();
  } else {
    throw new Error("scope must be 'project' or 'global'");
  }

  const jsoncPath = path.join(root, "opencode.jsonc");
  const jsonPath = path.join(root, "opencode.json");
  return { jsoncPath, jsonPath };
}

async function readOpencodeConfig(scope, projectDir) {
  const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
  const chosenPath = (await pathExists(jsoncPath)) ? jsoncPath : (await pathExists(jsonPath)) ? jsonPath : jsoncPath;
  const exists = await pathExists(chosenPath);
  return {
    path: chosenPath,
    exists,
    content: exists ? await readFile(chosenPath, "utf8") : null,
  };
}

async function writeOpencodeConfig(scope, projectDir, content) {
  const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
  const targetPath = (await pathExists(jsoncPath)) ? jsoncPath : (await pathExists(jsonPath)) ? jsonPath : jsoncPath;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return execResult(true, `Wrote ${targetPath}`);
}

function resolveCommandsDir(scope, projectDir) {
  if (scope === "workspace") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    return path.join(projectDir, ".opencode", "commands");
  }
  if (scope === "global") {
    return path.join(globalOpencodeRoot(), "commands");
  }
  throw new Error("scope must be 'workspace' or 'global'");
}

async function listCommandNames(scope, projectDir) {
  const commandsDir = resolveCommandsDir(scope, projectDir);
  if (!(await isDirectory(commandsDir))) {
    return [];
  }
  const entries = await readdir(commandsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
}

async function writeCommandFile(scope, projectDir, command) {
  const safeName = sanitizeCommandName(command?.name);
  if (!safeName) {
    throw new Error("command.name is required");
  }
  const commandsDir = resolveCommandsDir(scope, projectDir);
  await mkdir(commandsDir, { recursive: true });
  const filePath = path.join(commandsDir, `${safeName}.md`);
  await writeFile(filePath, serializeCommandFrontmatter({ ...command, name: safeName }), "utf8");
  return execResult(true, `Wrote ${filePath}`);
}

async function deleteCommandFile(scope, projectDir, name) {
  const safeName = sanitizeCommandName(name);
  if (!safeName) {
    throw new Error("name is required");
  }
  const commandsDir = resolveCommandsDir(scope, projectDir);
  const filePath = path.join(commandsDir, `${safeName}.md`);
  if (await pathExists(filePath)) {
    await rm(filePath, { force: true });
  }
  return execResult(true, `Deleted ${filePath}`);
}

async function collectProjectSkillRoots(projectDir) {
  const roots = [];
  let current = path.resolve(projectDir);

  while (true) {
    const opencodeSkills = path.join(current, ".opencode", "skills");
    const legacySkills = path.join(current, ".opencode", "skill");
    const claudeSkills = path.join(current, ".claude", "skills");

    if (await isDirectory(opencodeSkills)) roots.push(opencodeSkills);
    if (await isDirectory(legacySkills)) roots.push(legacySkills);
    if (await isDirectory(claudeSkills)) roots.push(claudeSkills);

    if (await pathExists(path.join(current, ".git"))) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
}

async function collectGlobalSkillRoots() {
  const roots = [];
  const candidates = [
    path.join(globalOpencodeRoot(), "skills"),
    path.join(os.homedir(), ".claude", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".agent", "skills"),
  ];

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      roots.push(candidate);
    }
  }

  return roots;
}

async function collectSkillRoots(projectDir) {
  const roots = [...(await collectProjectSkillRoots(projectDir)), ...(await collectGlobalSkillRoots())];
  return roots.filter((value, index) => roots.indexOf(value) === index);
}

async function findSkillDirsInRoot(root) {
  const found = [];
  if (!(await isDirectory(root))) return found;

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const direct = path.join(root, entry.name);
    if (await pathExists(path.join(direct, "SKILL.md"))) {
      found.push(direct);
      continue;
    }

    const nestedEntries = await readdir(direct, { withFileTypes: true }).catch(() => []);
    for (const nested of nestedEntries) {
      if (!nested.isDirectory()) continue;
      const nestedDir = path.join(direct, nested.name);
      if (await pathExists(path.join(nestedDir, "SKILL.md"))) {
        found.push(nestedDir);
      }
    }
  }

  return found;
}

function extractFrontmatterValue(raw, keys) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!keys.includes(key)) continue;
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return null;
}

function extractTrigger(raw) {
  return extractFrontmatterValue(raw, ["trigger", "when"]);
}

function extractDescription(raw) {
  let inFrontmatter = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter || trimmed.startsWith("#")) continue;
    const cleaned = trimmed.replace(/`/g, "");
    return cleaned.length > 180 ? `${cleaned.slice(0, 180)}...` : cleaned;
  }
  return null;
}

async function listLocalSkills(projectDir) {
  if (!String(projectDir ?? "").trim()) {
    throw new Error("projectDir is required");
  }

  const seen = new Set();
  const out = [];
  for (const root of await collectSkillRoots(projectDir)) {
    for (const skillDir of await findSkillDirsInRoot(root)) {
      const name = path.basename(skillDir);
      if (seen.has(name)) continue;
      seen.add(name);
      let raw = "";
      try {
        raw = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
      } catch {
        raw = "";
      }
      out.push({
        name,
        path: skillDir,
        description: extractDescription(raw) ?? undefined,
        trigger: extractTrigger(raw) ?? undefined,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function findSkillFile(projectDir, name) {
  const safeName = validateSkillName(name);
  for (const root of await collectSkillRoots(projectDir)) {
    const direct = path.join(root, safeName, "SKILL.md");
    if (await pathExists(direct)) return direct;

    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(root, entry.name, safeName, "SKILL.md");
      if (await pathExists(nested)) return nested;
    }
  }
  return null;
}

async function ensureProjectSkillRoot(projectDir) {
  if (!String(projectDir ?? "").trim()) {
    throw new Error("projectDir is required");
  }
  const opencodeRoot = path.join(projectDir, ".opencode");
  const legacy = path.join(opencodeRoot, "skill");
  const modern = path.join(opencodeRoot, "skills");
  if ((await isDirectory(legacy)) && !(await pathExists(modern))) {
    await rename(legacy, modern);
  }
  await mkdir(modern, { recursive: true });
  return modern;
}

function engineDoctor(options = {}) {
  return runtimeManager.engineDoctor(options);
}

function activeWindowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
}

const LOCAL_IMAGE_DATA_URL_MAX_BYTES = 10 * 1024 * 1024;
const LOCAL_IMAGE_MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

async function readLocalImageAsDataUrl(target) {
  const imagePath = String(target ?? "").trim();
  if (!imagePath) return null;
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = LOCAL_IMAGE_MIME_TYPES.get(extension);
  if (!mimeType) return null;
  const stats = await stat(imagePath).catch(() => null);
  if (!stats?.isFile() || stats.size > LOCAL_IMAGE_DATA_URL_MAX_BYTES) return null;
  const bytes = await readFile(imagePath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function macosVibrancyForCurrentTheme() {
  return nativeTheme.shouldUseDarkColors ? "under-window" : "sidebar";
}

function applyNativeTheme(mode) {
  nativeTheme.themeSource = mode;

  if (process.platform !== "darwin") {
    return true;
  }

  mainWindow?.setVibrancy(macosVibrancyForCurrentTheme());
  mainWindow?.setBackgroundColor("#00000001");

  return true;
}

// Desktop IPC command registry. Every command invokable from the renderer's
// desktopBridge Proxy (apps/app/src/app/lib/desktop.ts) has exactly one
// entry here; handlers receive the ipcMain event followed by the renderer
// arguments. The @type below asserts this registry against the shared
// DesktopCommandMap contract (packages/types/src/desktop-ipc.ts): a missing,
// extra, or renamed command fails `pnpm --filter @ipollowork/desktop
// typecheck:electron`.
/** @type {import("@ipollowork/types/desktop-ipc").DesktopCommandHandlers<import("electron").IpcMainInvokeEvent>} */
const desktopCommandHandlers = {
  "workspaceBootstrap": async (event, ...args) => {
      return workspaceStore.readWorkspaceState();
  },
  "workspaceSetSelected": async (event, ...args) => {
      return workspaceStore.setSelectedWorkspace(typeof args[0] === "string" ? args[0] : "");
  },
  "workspaceSetRuntimeActive": async (event, ...args) => {
      return workspaceStore.setRuntimeActiveWorkspace(typeof args[0] === "string" && args[0].trim() ? args[0] : null);
  },
  "workspaceCreate": async (event, ...args) => {
      return workspaceStore.createWorkspace(args[0] ?? {});
  },
  "workspaceCreateRemote": async (event, ...args) => {
      return workspaceStore.createRemoteWorkspace(args[0] ?? {});
  },
  "workspaceUpdateRemote": async (event, ...args) => {
      return workspaceStore.updateRemoteWorkspace(args[0] ?? {});
  },
  "workspaceUpdateDisplayName": async (event, ...args) => {
      return workspaceStore.updateWorkspaceDisplayName(args[0] ?? {});
  },
  "workspaceForget": async (event, ...args) => {
      return workspaceStore.forgetWorkspace(String(args[0] ?? "").trim());
  },
  "workspaceAddAuthorizedRoot": async (event, ...args) => {
      return workspaceStore.addAuthorizedRoot(args[0] ?? {});
  },
  "workspaceiPolloWorkRead": async (event, ...args) => {
      return workspaceStore.readWorkspaceiPolloWorkConfig(String(args[0]?.workspacePath ?? "").trim());
  },
  "workspaceiPolloWorkWrite": async (event, ...args) => {
      return workspaceStore.writeWorkspaceiPolloWorkConfig(
        String(args[0]?.workspacePath ?? "").trim(),
        args[0]?.config ?? workspaceStore.defaultWorkspaceiPolloWorkConfig(""),
      );
  },
  "workspaceExportConfig": async (event, ...args) => {
      return workspaceStore.exportConfig(args[0] ?? {});
  },
  "workspaceImportConfig": async (event, ...args) => {
      return workspaceStore.importConfig(args[0] ?? {});
  },
  "opencodeCommandList": async (event, ...args) => {
      return listCommandNames(String(args[0]?.scope ?? "").trim(), String(args[0]?.projectDir ?? "").trim());
  },
  "opencodeCommandWrite": async (event, ...args) => {
      return writeCommandFile(
        String(args[0]?.scope ?? "").trim(),
        String(args[0]?.projectDir ?? "").trim(),
        args[0]?.command ?? {},
      );
  },
  "opencodeCommandDelete": async (event, ...args) => {
      return deleteCommandFile(
        String(args[0]?.scope ?? "").trim(),
        String(args[0]?.projectDir ?? "").trim(),
        String(args[0]?.name ?? "").trim(),
      );
  },
  "engineStart": async (event, ...args) => {
      const projectDir = String(args[0] ?? "").trim();
      const options = args[1] ?? {};
      return runtimeManager.engineStart(projectDir, options);
  },
  "prepareFreshRuntime": async (event, ...args) => {
      return runtimeManager.prepareFreshRuntime();
  },
  "runtimeBootstrap": async (event, ...args) => {
      return ensureRuntimeBootstrap();
  },
  "runtimeStatus": async (event, ...args) => {
      return runtimeManager.runtimeStatus();
  },
  "engineStop": async (event, ...args) => {
      return runtimeManager.engineStop();
  },
  "engineRestart": async (event, ...args) => {
      return runtimeManager.engineRestart(args[0] ?? {});
  },
  "engineInfo": async (event, ...args) => {
      return runtimeManager.engineInfo();
  },
  "engineDoctor": async (event, ...args) => {
      return engineDoctor(args[0]);
  },
  "engineInstall": async (event, ...args) => {
      return runtimeManager.engineInstall();
  },
  "orchestratorStatus": async (event, ...args) => {
      return runtimeManager.orchestratorStatus();
  },
  "orchestratorWorkspaceActivate": async (event, ...args) => {
      return runtimeManager.orchestratorWorkspaceActivate(args[0] ?? {});
  },
  "orchestratorInstanceDispose": async (event, ...args) => {
      return runtimeManager.orchestratorInstanceDispose(String(args[0] ?? "").trim());
  },
  "appBuildInfo": async (event, ...args) => {
      return {
        version: app.getVersion(),
        gitSha: process.env.IPOLLOWORK_GIT_SHA ?? null,
        buildEpoch: process.env.IPOLLOWORK_BUILD_EPOCH ?? null,
        ipolloworkDevMode: process.env.IPOLLOWORK_DEV_MODE === "1",
      };
  },
  "desktopNotificationShow": async (event, ...args) => {
      return showDesktopNotification(args[0] ?? {});
  },
  "getUiControlBridgeInfo": async (event, ...args) => {
      try {
        const raw = await readFile(path.join(app.getPath("userData"), "ipollowork-ui-control.json"), "utf8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
  },
  "getiPolloWorkUiMcpCommand": async (event, ...args) => {
      if (process.env.IPOLLOWORK_DEV_MODE === "1") {
        return ["node", path.resolve(__dirname, "../../..", "packages/ipollowork-ui-mcp/index.mjs")];
      }
      return ["npx", "-y", "ipollowork-ui-mcp"];
  },
  "getComputerUseMcpCommand": async (event, ...args) => {
      return getComputerUseMcpCommand();
  },
  "checkComputerUsePermissions": async (event, ...args) => {
      // Spawn --check → fresh TCC read → always accurate.
      return checkComputerUsePermissions();
  },
  "listRunningApps": async (event, ...args) => {
      // Running regular macOS apps for composer @App mentions.
      return listRunningApps();
  },
  "openComputerUsePermissionSetup": async (event, ...args) => {
      // Open the GUI app. Returns immediately — React shows "verify" CTA.
      await openComputerUseSetupApp();
      // Return a fresh check so the UI shows the current state.
      return checkComputerUsePermissions();
  },
  "openComputerUsePermissionSettings": async (event, ...args) => {
      // Legacy: open the setup app (same as above).
      await openComputerUseSetupApp();
      return checkComputerUsePermissions();
  },
  "getiPolloWorkUiMcpEnvironment": async (event, ...args) => {
      return {
        IPOLLOWORK_UI_CONTROL_DISCOVERY: path.join(app.getPath("userData"), "ipollowork-ui-control.json"),
      };
  },
  "getDesktopBootstrapConfig": async (event, ...args) => {
      return workspaceStore.getDesktopBootstrapConfig();
  },
  "debugDesktopBootstrapConfig": async (event, ...args) => {
      return workspaceStore.debugDesktopBootstrapConfig();
  },
  "clearDesktopBootstrapConfig": async (event, ...args) => {
      return workspaceStore.clearDesktopBootstrapConfig();
  },
  "setDesktopBootstrapConfig": async (event, ...args) => {
      return workspaceStore.setDesktopBootstrapConfig(args[0] ?? {});
  },
  "nukeiPolloWorkAndOpencodeConfigAndExit": async (event, ...args) => {
      await rm(app.getPath("userData"), { recursive: true, force: true });
      app.exit(0);
      return undefined;
  },
  "orchestratorStartDetached": async (event, ...args) => {
      return runtimeManager.orchestratorStartDetached(args[0] ?? {});
  },
  "sandboxDoctor": async (event, ...args) => {
      return runtimeManager.sandboxDoctor();
  },
  "sandboxStop": async (event, ...args) => {
      return runtimeManager.sandboxStop(String(args[0] ?? "").trim());
  },
  "sandboxCleanupiPolloWorkContainers": async (event, ...args) => {
      return runtimeManager.sandboxCleanupiPolloWorkContainers();
  },
  "sandboxDebugProbe": async (event, ...args) => {
      return runtimeManager.sandboxDebugProbe();
  },
  "ipolloworkServerInfo": async (event, ...args) => {
      return runtimeManager.ipolloworkServerInfo();
  },
  "ipolloworkServerRestart": async (event, ...args) => {
      return runtimeManager.ipolloworkServerRestart(args[0] ?? {});
  },
  "pickDirectory": async (event, ...args) => {
      const options = args[0] ?? {};
      /** @type {import("electron").OpenDialogOptions["properties"]} */
      const properties = options.multiple
        ? ["openDirectory", "createDirectory", "multiSelections"]
        : ["openDirectory", "createDirectory"];
      const result = await dialog.showOpenDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        properties,
      });
      if (result.canceled) return null;
      return options.multiple ? result.filePaths : (result.filePaths[0] ?? null);
  },
  "pickFile": async (event, ...args) => {
      const options = args[0] ?? {};
      /** @type {import("electron").OpenDialogOptions["properties"]} */
      const properties = options.multiple ? ["openFile", "multiSelections"] : ["openFile"];
      const result = await dialog.showOpenDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties,
      });
      if (result.canceled) return null;
      return options.multiple ? result.filePaths : (result.filePaths[0] ?? null);
  },
  "saveFile": async (event, ...args) => {
      const options = args[0] ?? {};
      const result = await dialog.showSaveDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return result.canceled ? null : (result.filePath ?? null);
  },
  "importSkill": async (event, ...args) => {
      const projectDir = String(args[0] ?? "").trim();
      const sourceDir = String(args[1] ?? "").trim();
      const overwrite = args[2]?.overwrite === true;
      if (!projectDir || !sourceDir) {
        throw new Error("projectDir and sourceDir are required");
      }
      const skillRoot = await ensureProjectSkillRoot(projectDir);
      const name = validateSkillName(path.basename(sourceDir));
      const destination = path.join(skillRoot, name);
      if (await pathExists(destination)) {
        if (!overwrite) {
          return execResult(false, "", `Skill already exists at ${destination}`);
        }
        await rm(destination, { recursive: true, force: true });
      }
      await cp(sourceDir, destination, { recursive: true });
      return execResult(true, `Imported skill to ${destination}`);
  },
  "installSkillTemplate": async (event, ...args) => {
      const projectDir = String(args[0] ?? "").trim();
      const name = validateSkillName(args[1]);
      const content = String(args[2] ?? "");
      const overwrite = args[3]?.overwrite === true;
      const skillRoot = await ensureProjectSkillRoot(projectDir);
      const destination = path.join(skillRoot, name);
      if (await pathExists(destination)) {
        if (!overwrite) {
          return execResult(false, "", `Skill already exists at ${destination}`);
        }
        await rm(destination, { recursive: true, force: true });
      }
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "SKILL.md"), content, "utf8");
      return execResult(true, `Installed skill to ${destination}`);
  },
  "listLocalSkills": async (event, ...args) => {
      return listLocalSkills(String(args[0] ?? "").trim());
  },
  "readLocalSkill": async (event, ...args) => {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        throw new Error("Skill not found");
      }
      return { path: skillPath, content: await readFile(skillPath, "utf8") };
  },
  "writeLocalSkill": async (event, ...args) => {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        return execResult(false, "", "Skill not found");
      }
      const content = String(args[2] ?? "");
      const next = content.endsWith("\n") ? content : `${content}\n`;
      await writeFile(skillPath, next, "utf8");
      return execResult(true, `Saved skill ${path.basename(path.dirname(skillPath))}`);
  },
  "uninstallSkill": async (event, ...args) => {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        return execResult(false, "", "Skill not found in .opencode/skills or .claude/skills");
      }
      await rm(path.dirname(skillPath), { recursive: true, force: true });
      return execResult(true, `Removed skill ${args[1]}`);
  },
  "updaterEnvironment": async (event, ...args) => {
      const executablePath = app.isPackaged ? app.getPath("exe") : process.execPath;
      return {
        supported: true,
        reason: null,
        executablePath,
        appBundlePath:
          process.platform === "darwin"
            ? path.resolve(executablePath, "../../..")
            : path.dirname(executablePath),
      };
  },
  "readOpencodeConfig": async (event, ...args) => {
      return readOpencodeConfig(String(args[0] ?? "").trim(), String(args[1] ?? "").trim());
  },
  "writeOpencodeConfig": async (event, ...args) => {
      return writeOpencodeConfig(
        String(args[0] ?? "").trim(),
        String(args[1] ?? "").trim(),
        String(args[2] ?? ""),
      );
  },
  "resetiPolloWorkState": async (event, ...args) => {
      return workspaceStore.resetiPolloWorkState();
  },
  "resetOpencodeCache": async (event, ...args) => {
      return { removed: [], missing: [], errors: [] };
  },
  "opencodeMcpAuth": async (event, ...args) => {
      return runtimeManager.opencodeMcpAuth(String(args[0] ?? "").trim(), String(args[1] ?? "").trim());
  },
  "setWindowDecorations": async (event, ...args) => {
      return undefined;
  },
  "__openPath": async (event, ...args) => {
      const target = String(args[0] ?? "").trim();
      if (!target) return "Path is required.";
      return shell.openPath(target);
  },
  "__revealItemInDir": async (event, ...args) => {
      const target = String(args[0] ?? "").trim();
      if (!target) return "Path is required.";
      if (existsSync(target)) {
        shell.showItemInFolder(target);
        return undefined;
      }
      // The exact file may not exist yet (or path is slightly off); fall back to
      // opening the containing directory so the user still lands in the right place.
      const parent = path.dirname(target);
      if (parent && parent !== target && existsSync(parent)) {
        const error = await shell.openPath(parent);
        return error && error.trim() ? error : undefined;
      }
      return `Could not find "${target}" on disk.`;
  },
  "__getFileIcon": async (event, ...args) => {
      const target = String(args[0] ?? "").trim();
      if (!target) return null;
      const requestedSize = args[1];
      /** @type {"small" | "normal" | "large"} */
      let validSize = "normal";
      if (requestedSize === "small" || requestedSize === "normal" || requestedSize === "large") {
        validSize = requestedSize;
      }
      try {
        const image = await app.getFileIcon(target, { size: validSize });
        return image.isEmpty() ? null : image.toDataURL();
      } catch {
        return null;
      }
  },
  "__readLocalImageAsDataUrl": async (event, ...args) => {
      return readLocalImageAsDataUrl(args[0]);
  },
  "__applyBrandAppName": async (event, ...args) => {
      const requested = args[0] === null ? "" : String(args[0] ?? "").trim();
      currentDisplayAppName = requested.slice(0, 64) || APP_NAME;
    applicationMenu.setAppName(currentDisplayAppName);
    mainWindow?.setTitle(currentDisplayAppName);
    if (process.platform === "win32") {
      await registerWindowsDisplayShortcut();
    }
    return { ok: true, appName: currentDisplayAppName };
  },
  "__applyBrandIcon": async (event, ...args) => {
      const value = args[0] === null ? null : String(args[0] ?? "");
      return applyBrandIconUrl(value);
  },
  "__getBrandIconState": async (event, ...args) => {
      return getBrandIconState();
  },
  "__getApplicationsForFile": async (event, ...args) => {
      const target = String(args[0] ?? "").trim();
      if (!target) return [];
      const platform = process.platform;
      const results = [];

      try {
        if (platform === "darwin") {
          // Scan /Applications and /System/Applications for .app bundles
          const appDirs = ["/Applications", "/System/Applications", "/Applications/Utilities", `${os.homedir()}/Applications`];
          const seen = new Set();
          for (const dir of appDirs) {
            let entries;
            try { entries = await readdir(dir); } catch { continue; }
            for (const entry of entries) {
              if (!entry.endsWith(".app")) continue;
              const appPath = path.join(dir, entry);
              if (seen.has(appPath)) continue;
              seen.add(appPath);
              const name = entry.replace(/\.app$/i, "");
              let icon = null;
              try {
                const img = await app.getFileIcon(appPath, { size: "small" });
                icon = img.isEmpty() ? null : img.toDataURL();
              } catch {}
              results.push({ name, appPath, icon });
            }
          }
        } else if (platform === "linux") {
          // Parse .desktop files in standard directories
          const desktopDirs = ["/usr/share/applications", "/usr/local/share/applications", `${os.homedir()}/.local/share/applications`];
          const seen = new Set();
          for (const dir of desktopDirs) {
            let entries;
            try { entries = await readdir(dir); } catch { continue; }
            for (const entry of entries) {
              if (!entry.endsWith(".desktop")) continue;
              const filePath = path.join(dir, entry);
              if (seen.has(filePath)) continue;
              seen.add(filePath);
              try {
                const content = await readFile(filePath, "utf-8");
                const nameMatch = content.match(/^Name=(.+)$/m);
                const execMatch = content.match(/^Exec=(.+)$/m);
                if (!nameMatch || !execMatch) continue;
                const name = nameMatch[1].trim();
                const appPath = execMatch[1].trim().replace(/%[fFuU]/g, "").trim();
                if (!appPath) continue;
                let icon = null;
                try {
                  const img = await app.getFileIcon(filePath, { size: "small" });
                  icon = img.isEmpty() ? null : img.toDataURL();
                } catch {}
                results.push({ name, appPath, icon });
              } catch {}
            }
          }
        }
      } catch {}

      return results;
  },
  "__openWithApp": async (event, ...args) => {
      const target = String(args[0] ?? "").trim();
      const appPath = String(args[1] ?? "").trim();
      if (!target || !appPath) return "Target and app path are required.";
      const platform = process.platform;
      try {
        if (platform === "darwin") {
          execFileSync("open", ["-a", appPath, target]);
        } else if (platform === "linux") {
          const child = spawn(appPath, [target], { detached: true, stdio: "ignore" });
          child.unref();
        } else {
          return `Open with app is not supported on ${platform}`;
        }
      } catch (err) {
        return String(err?.message ?? err);
      }
  },
  "__fetch": async (event, ...args) => {
      const url = String(args[0] ?? "").trim();
      const init = args[1] ?? {};
      if (!url) throw new Error("URL is required.");
      const timeoutMs = Number(init.timeoutMs);
      const response = await electronNet.fetch(url, {
        method: typeof init.method === "string" ? init.method : undefined,
        headers: init.headers && typeof init.headers === "object" ? init.headers : undefined,
        body: typeof init.body === "string" ? init.body : undefined,
        signal: Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
        credentials: "omit",
        cache: "no-store",
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        body: await response.text(),
      };
  },
  "__homeDir": async (event, ...args) => {
      return os.homedir();
  },
  "__joinPath": async (event, ...args) => {
      return path.join(...args.map((value) => String(value ?? "")));
  },
  "__setZoomFactor": async (event, ...args) => {
      const factor = Number(args[0]);
      const window = activeWindowFromEvent(event);
      if (!window || !Number.isFinite(factor) || factor <= 0) {
        return false;
      }
      window.webContents.setZoomFactor(factor);
      return true;
  },
  "__setNativeTheme": async (event, ...args) => {
      return applyNativeTheme(String(args[0]));
  },
  "__setApplicationMenuVisible": async (event, ...args) => {
      return applicationMenu.setVisible(args[0]);
  },
};

if (isDevMode) {
  desktopCommandHandlers.__evalRelaunch = async () => {
    const win = await createMainWindow();
    win.webContents.reloadIgnoringCache();
    return { ok: true };
  };
}

function desktopErrorMessageSegment(error, includeName = false) {
  try {
    if (error && (typeof error === "object" || typeof error === "function")) {
      const message = typeof error.message === "string" ? error.message.trim() : "";
      if (message) {
        const name = typeof error.name === "string" ? error.name.trim() : "";
        return includeName && name && name !== "Error" && !message.startsWith(`${name}:`)
          ? `${name}: ${message}`
          : message;
      }
    }
    return String(error);
  } catch {
    return "Unknown error";
  }
}

function desktopErrorCause(error) {
  try {
    return error && (typeof error === "object" || typeof error === "function") ? error.cause : undefined;
  } catch {
    return undefined;
  }
}

function desktopErrorMessageWithCauses(error) {
  try {
    const messages = [];
    const seenMessages = new Set();
    const seenErrors = new Set();
    let current = error;
    for (let depth = 0; current != null && depth < 8; depth += 1) {
      if (typeof current === "object" || typeof current === "function") {
        if (seenErrors.has(current)) break;
        seenErrors.add(current);
      }
      const message = desktopErrorMessageSegment(current, depth === 0).trim();
      if (message && !seenMessages.has(message)) {
        seenMessages.add(message);
        messages.push(message);
      }
      current = desktopErrorCause(current);
    }
    const combined = messages.join(": ") || "Unknown desktop command error";
    return combined.length > 2000 ? `${combined.slice(0, 1997)}...` : combined;
  } catch {
    return "Unknown desktop command error";
  }
}

async function handleDesktopInvoke(event, command, ...args) {
  const handler = desktopCommandHandlers[command];
  if (!handler) {
    throw new Error(`Electron desktop bridge method is not implemented yet: ${command}`);
  }
  try {
    return await handler(event, ...args);
  } catch (error) {
    throw new Error(desktopErrorMessageWithCauses(error), { cause: error });
  }
}


async function createMainWindow() {
  if (mainWindow) return mainWindow;

  const preloadPath = path.join(__dirname, "preload.mjs");
  const savedWindowBounds = await readMainWindowState();
  const windowAppearanceOptions = {};
  if (process.platform === "darwin") {
    Object.assign(windowAppearanceOptions, {
      backgroundColor: "#00000001",
      titleBarStyle: "hiddenInset",
      vibrancy: macosVibrancyForCurrentTheme(),
      visualEffectState: "active",
    });
  }

  const bootSidecar = await readBrandIconSidecar();
  const bootSourceUrl = typeof bootSidecar?.sourceUrl === "string" ? bootSidecar.sourceUrl : null;
  const cachedBrandImage = bootSourceUrl ? resolveBrandIconImage() : null;
  const windowIconImage = cachedBrandImage ?? APP_ICON_IMAGE;
  if (process.platform === "win32" && cachedBrandImage && bootSourceUrl) {
    try {
      const taskbarIconPath = await ensureWindowsBrandIcon(cachedBrandImage);
      const taskbarAppId = windowsBrandAppUserModelId(APP_IDENTIFIER, bootSourceUrl);
      await registerWindowsBrandShortcut(taskbarAppId, taskbarIconPath);
      app.setAppUserModelId(taskbarAppId);
    } catch (error) {
      console.warn("[brand-icon] failed to register cached Windows shortcut before window creation", error);
    }
  }
  if (process.platform === "darwin" && windowIconImage && !windowIconImage.isEmpty() && app.dock) {
    app.dock.setIcon(windowIconImage);
  }

  mainWindow = new BrowserWindow({
    width: savedWindowBounds?.width ?? MAIN_WINDOW_DEFAULT_WIDTH,
    height: savedWindowBounds?.height ?? MAIN_WINDOW_DEFAULT_HEIGHT,
    ...(savedWindowBounds ? { x: savedWindowBounds.x, y: savedWindowBounds.y } : {}),
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: currentDisplayAppName,
    show: false,
    ...(process.platform === "win32" ? { skipTaskbar: true } : {}),
    ...windowAppearanceOptions,
    ...(windowIconImage && !windowIconImage.isEmpty() ? { icon: windowIconImage } : {}),
    webPreferences: {
      // The renderer owns session dispatch + event streams; keep it running
      // while hidden/minimized so background tasks are not interrupted.
      backgroundThrottling: false,
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Enable Chromium's built-in PDF viewer so PDFs render inside the
      // artifact panel (<embed> pointed at a blob URL).
      plugins: true,
    },
  });
  mainWindow.setMinimumSize(MAIN_WINDOW_MIN_WIDTH, MAIN_WINDOW_MIN_HEIGHT);
  mainWindow.on("resize", () => enforceMainWindowMinimumSize(mainWindow));
  mainWindow.on("resize", () => {
    void writeMainWindowState(mainWindow);
  });
  mainWindow.on("move", () => {
    void writeMainWindowState(mainWindow);
  });
  mainWindow.on("close", () => {
    void writeMainWindowState(mainWindow);
  });
  if (cachedBrandImage && bootSourceUrl) {
    await applyCachedBrandIcon(cachedBrandImage, bootSourceUrl);
  }
  applicationMenu.applyVisibility(mainWindow);

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle(currentDisplayAppName);
  });
  mainWindow.setTitle(currentDisplayAppName);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.setTitle(currentDisplayAppName);
    if (process.platform === "win32") mainWindow?.setSkipTaskbar(false);
    mainWindow?.show();
    flushPendingDeepLinks();
  });

  mainWindow.on("closed", () => {
    browserPanel.destroy();
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // HyperFrames is rendered by the session-owned right-side iframe. Its
    // Studio may still call window.open in packaged Electron builds; allowing
    // that local URL would create a second standalone editor window.
    if (isHyperframesStudioUrl(url)) return { action: "deny" };

    if (url.startsWith("file://")) {
      try {
        void shell.openPath(fileURLToPath(url));
      } catch {
        void openExternalUrl(url);
      }

      return { action: "deny" };
    }

    const local =
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost");
    if (!local) {
      void openExternalUrl(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (browserPanel.isMainWindowAllowedNavigation(url)) return;
    event.preventDefault();
    browserPanel.routeBlockedMainWindowNavigation(url);
  });

  // `will-navigate` does NOT fire for CDP `Page.navigate` (it behaves like
  // loadURL), so agent automation that picks the wrong CDP target — the app
  // window itself is the first page target when no browser tab exists — used
  // to replace the entire workspace UI with the website, with no way back
  // (#2000). Catch those at `did-start-navigation`, cancel the load, and
  // reroute the URL into a built-in browser tab instead.
  mainWindow.webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    if (browserPanel.isMainWindowAllowedNavigation(url)) return;
    try {
      mainWindow?.webContents.stop();
    } catch {
      // best effort — routing below still gives the user a way back
    }
    browserPanel.routeBlockedMainWindowNavigation(url);
  });

  const startUrl = process.env.IPOLLOWORK_ELECTRON_START_URL?.trim() || process.env.ELECTRON_START_URL?.trim();
  if (startUrl) {
    await mainWindow.loadURL(startUrl);
  } else {
    const packagedIndexPath = path.join(process.resourcesPath, "app-dist", "index.html");
    const devIndexPath = path.resolve(__dirname, "../../app/dist/index.html");
    await mainWindow.loadFile(app.isPackaged ? packagedIndexPath : devIndexPath);
  }

  return mainWindow;
}

ipcMain.handle("ipollowork:desktop", handleDesktopInvoke);
ipcMain.handle("ipollowork:shell:openExternal", async (_event, url) => {
  if (typeof url !== "string" || url.trim().length === 0) {
    return { ok: false, error: "empty url" };
  }
  return openExternalUrl(url.trim());
});
ipcMain.handle("ipollowork:shell:relaunch", async () => {
  if (relaunchActionForMode(isDevMode) === "reload-window") {
    const win = await createMainWindow();
    win.webContents.reloadIgnoringCache();
    return;
  }
  app.relaunch();
  app.exit(0);
});
ipcMain.handle("ipollowork:system:architecture", async () => resolveArchitectureInfo());
ipcMain.handle("ipollowork:system:microphoneStatus", async () => {
  if (process.platform !== "darwin") return { platform: process.platform, status: "not-mac" };
  return { platform: process.platform, status: systemPreferences.getMediaAccessStatus("microphone") };
});
ipcMain.handle("ipollowork:system:askMicrophoneAccess", async () => {
  if (process.platform !== "darwin") return { platform: process.platform, granted: true, status: "not-mac" };
  const before = systemPreferences.getMediaAccessStatus("microphone");
  const granted = await systemPreferences.askForMediaAccess("microphone");
  const after = systemPreferences.getMediaAccessStatus("microphone");
  return { platform: process.platform, before, after, granted };
});

// ── Terminal IPC ────────────────────────────────────────────────────────
ipcMain.handle("ipollowork:terminal:create", async (event, options = {}) => {
  const cwd = await resolveTerminalCwd(options?.cwd);
  const cols = Number.isFinite(options?.cols) ? Math.max(20, Math.floor(options.cols)) : 80;
  const rows = Number.isFinite(options?.rows) ? Math.max(5, Math.floor(options.rows)) : 24;
  const terminalId = `term_${nextTerminalId++}`;
  const shellPath = defaultTerminalShell();
  const child = pty.spawn(shellPath, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      IPOLLOWORK_TERMINAL: "1",
    },
  });

  terminalProcesses.set(terminalId, { process: child, webContentsId: event.sender.id });
  event.sender.once("destroyed", () => killTerminalsForWebContents(event.sender.id));
  child.onData((data) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send("ipollowork:terminal:data", { terminalId, data });
  });
  child.onExit(({ exitCode, signal }) => {
    terminalProcesses.delete(terminalId);
    if (event.sender.isDestroyed()) return;
    event.sender.send("ipollowork:terminal:exit", { terminalId, exitCode, signal });
  });

  return { terminalId };
});
ipcMain.handle("ipollowork:terminal:write", (event, terminalId, data) => {
  const terminal = terminalForSender(event, terminalId);
  if (!terminal || typeof data !== "string") return;
  terminal.process.write(data);
});
ipcMain.handle("ipollowork:terminal:resize", (event, terminalId, cols, rows) => {
  const terminal = terminalForSender(event, terminalId);
  if (!terminal || !Number.isFinite(cols) || !Number.isFinite(rows)) return;
  terminal.process.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)));
});
ipcMain.handle("ipollowork:terminal:kill", (event, terminalId) => {
  const terminal = terminalForSender(event, terminalId);
  if (!terminal) return;
  killTerminal(String(terminalId));
});

ipcMain.handle("ipollowork:hyperframes:start", (event, options = {}) => startHyperframesPreview(event, options));
ipcMain.handle("ipollowork:hyperframes:stop", (event, sessionId) => {
  stopHyperframesForKey(hyperframesKey(event.sender.id, sessionId));
  return { ok: true };
});

ipcMain.handle("ipollowork:hyperframes:set-simple-mode", async (event, enabled) => {
  const collectFrames = (frame, matches = []) => {
    matches.push(frame);
    for (const child of frame.frames) collectFrames(child, matches);
    return matches;
  };
  const allFrames = collectFrames(event.sender.mainFrame);
  // HyperFrames 0.7 no longer keeps its canvas on the old
  // `/api/projects/:id` child URL. Identify the actual Studio document by its
  // own stable UI contract instead of inferring it from an implementation URL.
  // This keeps the integration scoped to the embedded Studio and avoids ever
  // running the cleanup against the iPolloWork app frame.
  const studioFrame = (await Promise.all(allFrames
    .filter((frame) => frame !== event.sender.mainFrame)
    .map(async (frame) => {
      try {
        const isStudio = await frame.executeJavaScript(`(() => {
          const title = (document.title || '').trim().toLowerCase();
          if (title.includes('hyperframes')) return true;
          const labels = [...document.querySelectorAll('button')].map((node) => (
            (node.getAttribute('aria-label') || node.textContent || '').trim().toLowerCase()
          ));
          return labels.includes('inspector')
            || labels.includes('storyboard')
            || labels.some((label) => label.startsWith('renders'));
        })()`);
        return isStudio ? frame : null;
      } catch {
        return null;
      }
    })))
    .find(Boolean);
  if (!studioFrame) return { ok: false, reason: "studio-frame-missing" };
  const frames = collectFrames(studioFrame, []);
  const result = await studioFrame.executeJavaScript(`(() => {
    const enabled = ${enabled ? "true" : "false"};
    const wasEnabled = document.documentElement.dataset.ipolloworkSimpleMode === 'true';
    const clearCanvasSelection = () => {
      const [path, query = ''] = location.hash.slice(1).split('?');
      const params = new URLSearchParams(query);
      let changed = false;
      for (const key of [...params.keys()]) {
        if (!key.startsWith('sel')) continue;
        params.delete(key);
        changed = true;
      }
      if (changed) location.hash = path + '?' + params.toString();
    };
    const applyCanvasSelection = (target) => {
      if (!target || (!target.id && !target.selector)) return false;
      const [path, query = ''] = location.hash.slice(1).split('?');
      const params = new URLSearchParams(query);
      for (const key of [...params.keys()]) if (key.startsWith('sel')) params.delete(key);
      if (target.file) params.set('selFile', target.file);
      if (target.id) params.set('selId', target.id);
      if (target.selector) params.set('selSelector', target.selector);
      if (Number.isFinite(target.selectorIndex)) params.set('selIndex', String(target.selectorIndex));
      location.hash = path + '?' + params.toString();
      return true;
    };
    const button = [...document.querySelectorAll('button')].find((node) =>
      node.getAttribute('title') === (enabled ? 'Hide sidebar' : 'Show sidebar') ||
      node.getAttribute('aria-label') === (enabled ? 'Hide sidebar' : 'Show sidebar')
    );
    button?.click();
    const inspector = document.querySelector('button[aria-label="Inspector"]');
    // iPolloWork supplies the panel title itself. Remove HyperFrames'
    // redundant project-identity group and non-essential Storyboard tab, but
    // leave the header container and editing controls intact. The Studio can
    // re-render its header after a composition change, so observe that small
    // piece of DOM rather than hiding its parent container once.
    const simplifyStudioHeader = () => {
      const compactText = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
      const isBrandText = (value) => /(?:heygen\s*)?hyperframes/i.test(value || '');
      const isSessionIdentity = (value) => /^ses_[a-z0-9_-]+$/i.test((value || '').trim());
      const hasStudioControl = (node) => [...node.querySelectorAll('button')].some((button) => {
        const label = (button.getAttribute('aria-label') || compactText(button)).replace(/\s+/g, '').toLowerCase();
        return label === 'storyboard' || label === 'inspector' || label === 'capture' || label.startsWith('renders');
      });
      const brandNodes = [...document.querySelectorAll('img,svg,[aria-label],[alt],[title],span,a,div')]
        .filter((node) => isBrandText([
          compactText(node),
          node.getAttribute('aria-label'),
          node.getAttribute('alt'),
          node.getAttribute('title'),
        ].filter(Boolean).join(' ')))
        .sort((left, right) => compactText(left).length - compactText(right).length);
      const headerFromBrand = brandNodes
        .flatMap((node) => {
          const parents = [];
          let current = node.parentElement;
          while (current) {
            parents.push(current);
            current = current.parentElement;
          }
          return parents;
        })
        .find((node) => hasStudioControl(node));
      const headerFromControls = [...document.querySelectorAll('button')]
        .filter((button) => {
          const label = (button.getAttribute('aria-label') || compactText(button)).replace(/\s+/g, '').toLowerCase();
          return button.getBoundingClientRect().top < 40 && (
            label === 'preview' || label === 'capture' || label === 'inspector' || label === 'export' || label === 'storyboard'
          );
        })
        .flatMap((button) => {
          const parents = [];
          let current = button.parentElement;
          while (current && current !== document.body) {
            parents.push(current);
            current = current.parentElement;
          }
          return parents;
        })
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top < 12 && rect.height <= 80 && [...node.querySelectorAll('button')]
            .filter((button) => button.getBoundingClientRect().top < 40).length >= 3;
        })
        .sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0];
      const header = headerFromBrand
        ?? headerFromControls
        ?? [...document.querySelectorAll('header,div')].find((node) => {
          const classes = typeof node.className === 'string' ? node.className : '';
          return /(?:^|\s)h-10(?:\s|$)|h-\[40px\]/.test(classes) && hasStudioControl(node);
        });
      if (!header) return false;

      // The current Studio header renders the HeyGen/HyperFrames mark as a
      // text-and-image group, not as the old labelled SVG. Remove its direct
      // header group, the generated session id and its separator structurally
      // so a later Studio re-render cannot surface them again.
      if (!document.querySelector('[data-ipollowork-studio-hide-style]')) {
        const style = document.createElement('style');
        style.dataset.ipolloworkStudioHideStyle = 'true';
        style.textContent = '[data-ipollowork-studio-hidden]{display:none!important}';
        document.head.appendChild(style);
      }
      const hideIdentityNode = (node) => {
        if (!node || !header.contains(node)) return;
        const rect = node.getBoundingClientRect();
        if (rect.width > 260 || rect.height > 56 || rect.top > 80) return;
        node.setAttribute('data-ipollowork-studio-hidden', 'true');
      };
      const identityRoots = new Set();
      for (const brand of brandNodes) {
        const root = [...header.children].find((child) => child.contains(brand));
        if (root) identityRoots.add(root);
      }
      for (const sessionNode of [...header.querySelectorAll('span,a,code,div')]) {
        if (!isSessionIdentity(compactText(sessionNode))) continue;
        const root = [...header.children].find((child) => child.contains(sessionNode));
        if (root) identityRoots.add(root);
      }
      for (const child of [...header.children]) {
        const text = compactText(child);
        if (isBrandText(text) || isSessionIdentity(text) || /^[|｜]$/.test(text)) identityRoots.add(child);
      }
      for (const identity of identityRoots) hideIdentityNode(identity);

      for (const button of [...header.querySelectorAll('button')]) {
        if (compactText(button) === 'Storyboard') button.remove();
      }

      // HyperFrames treats Renders, Inspector, and the optional sidebar as
      // independent views, but none gives the user a consistent way back to
      // the uncluttered editing canvas. Add one small dismissal control to
      // the native action group whenever one of those views is active.
      let dismiss = document.querySelector('[data-ipollowork-studio-dismiss]');
      if (!dismiss && header) {
        if (!document.querySelector('[data-ipollowork-studio-dismiss-style]')) {
          const style = document.createElement('style');
          style.dataset.ipolloworkStudioDismissStyle = 'true';
          style.textContent = '[data-ipollowork-studio-dismiss]{display:none;align-items:center;gap:5px;height:28px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:#a1a1aa;font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background-color .15s,color .15s}[data-ipollowork-studio-dismiss]:hover{background:#27272a;color:#f4f4f5}[data-ipollowork-studio-dismiss] svg{width:14px;height:14px}';
          document.head.appendChild(style);
        }
        dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.setAttribute('data-ipollowork-studio-dismiss', 'true');
        dismiss.setAttribute('aria-label', 'Collapse active studio panel');
        dismiss.setAttribute('title', 'Collapse active studio panel');
        dismiss.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span>收起</span>';
        dismiss.addEventListener('click', () => {
          const activeInspector = document.querySelector('button[aria-label="Inspector"]');
          if (activeInspector?.getAttribute('aria-pressed') === 'true') activeInspector.click();
          const hideSidebar = document.querySelector('button[aria-label="Hide sidebar"]');
          hideSidebar?.click();
          const textEditor = document.querySelector('[data-ipollowork-video-text-panel]');
          if (textEditor) textEditor.style.display = 'none';
          window.__ipolloworkVideoTextSource = null;
          const [path, query = ''] = location.hash.slice(1).split('?');
          const params = new URLSearchParams(query);
          params.set('tab', 'design');
          location.hash = path + '?' + params.toString();
        });
        header.querySelector(':scope > div:last-child')?.prepend(dismiss);
      }
      if (dismiss) {
        const [, query = ''] = location.hash.slice(1).split('?');
        const params = new URLSearchParams(query);
        const activeTab = params.get('tab');
        const inspectorOpen = document.querySelector('button[aria-label="Inspector"]')?.getAttribute('aria-pressed') === 'true';
        const sidebarOpen = Boolean(document.querySelector('button[aria-label="Hide sidebar"]'));
        const textEditorOpen = document.querySelector('[data-ipollowork-video-text-panel]')?.style.display === 'flex';
        const display = activeTab && activeTab !== 'design' || inspectorOpen || sidebarOpen || textEditorOpen ? 'inline-flex' : 'none';
        if (dismiss.style.display !== display) dismiss.style.display = display;
      }
      let fullscreen = document.querySelector('[data-ipollowork-studio-fullscreen]');
      if (!fullscreen && header) {
        if (!document.querySelector('[data-ipollowork-studio-fullscreen-style]')) {
          const style = document.createElement('style');
          style.dataset.ipolloworkStudioFullscreenStyle = 'true';
          style.textContent = '[data-ipollowork-studio-fullscreen]{display:inline-flex!important;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid rgba(20,184,166,.35);border-radius:7px;background:rgba(20,184,166,.12);color:#14b8a6;font:700 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background-color .15s,color .15s,border-color .15s}[data-ipollowork-studio-fullscreen]:hover{background:rgba(20,184,166,.2);border-color:rgba(20,184,166,.55);color:#2dd4bf}[data-ipollowork-studio-fullscreen] svg{width:14px;height:14px;flex:0 0 auto}';
          document.head.appendChild(style);
        }
        fullscreen = document.createElement('button');
        fullscreen.type = 'button';
        fullscreen.setAttribute('data-ipollowork-studio-fullscreen', 'true');
        fullscreen.setAttribute('aria-label', 'Enter fullscreen');
        fullscreen.setAttribute('title', 'Enter fullscreen');
        fullscreen.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg><span>Full</span>';
        fullscreen.addEventListener('click', () => {
          const target = document.querySelector('[data-studio-fullscreen-target]');
          target?.dispatchEvent(new CustomEvent('studio-toggle-fullscreen', { bubbles: true }));
        });
        const actionGroup = header.querySelector(':scope > div:last-child') || header;
        const exportButton = [...actionGroup.querySelectorAll('button')].find((node) => compactText(node) === 'Export');
        if (exportButton) actionGroup.insertBefore(fullscreen, exportButton);
        else actionGroup.appendChild(fullscreen);
      }
      return ![...header.children].some((child) => {
        const text = compactText(child);
        return isBrandText(text) || isSessionIdentity(text) || /^[|｜]$/.test(text);
      }) && ![...header.querySelectorAll('button')].some((node) => compactText(node) === 'Storyboard');
    };
    const studioChromeClean = simplifyStudioHeader();
    if (window.__ipolloworkHyperframesBrandObserver !== 2) {
      window.__ipolloworkHyperframesBrandObserver = 2;
      new MutationObserver(simplifyStudioHeader).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['aria-label', 'class', 'style'],
        childList: true,
        subtree: true,
      });
    }
    if (window.__ipolloworkStudioDismissRefresh !== 1) {
      window.__ipolloworkStudioDismissRefresh = 1;
      const refreshStudioChrome = () => {
        window.clearTimeout(window.__ipolloworkStudioDismissRefreshTimer);
        window.__ipolloworkStudioDismissRefreshTimer = window.setTimeout(simplifyStudioHeader, 0);
      };
      // Some native Studio views change without replacing their header. Run
      // the same small cleanup after each view-changing click and hash update
      // so every open panel receives the common dismissal affordance.
      window.addEventListener('hashchange', refreshStudioChrome);
      document.addEventListener('click', refreshStudioChrome, true);
    }
    if (enabled && !wasEnabled) clearCanvasSelection();
    if (enabled && !wasEnabled && inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
    for (const label of ['Layers', 'Renders', 'Slideshow', 'Variables']) {
      const tab = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === label);
      if (tab) tab.style.display = enabled ? 'none' : '';
    }
    const collectIframes = (root, output = []) => {
      for (const node of root.querySelectorAll('*')) {
        if (node.tagName === 'IFRAME') output.push(node);
        if (node.shadowRoot) collectIframes(node.shadowRoot, output);
      }
      return output;
    };
    const ensureTextPanel = () => {
      let panel = document.querySelector('[data-ipollowork-video-text-panel]');
      if (panel) return panel;
      const style = document.createElement('style');
      style.dataset.ipolloworkVideoTextPanel = 'true';
      style.textContent = '.ipw-video-text-panel{position:fixed;z-index:2147483646;right:0;top:40px;bottom:0;width:288px;display:none;flex-direction:column;border-left:1px solid rgba(255,255,255,.1);background:rgba(18,18,20,.96);box-shadow:-18px 0 48px rgba(0,0,0,.28);backdrop-filter:blur(22px);color:#f8fafc;font:500 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.ipw-video-text-panel *{box-sizing:border-box}.ipw-video-text-head{display:flex;align-items:center;gap:10px;height:52px;padding:0 14px;border-bottom:1px solid rgba(255,255,255,.08)}.ipw-video-text-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:rgba(60,230,172,.13);color:#3ce6ac;font-weight:700}.ipw-video-text-title{flex:1;min-width:0}.ipw-video-text-title strong{display:block;font-size:13px}.ipw-video-text-title span{display:block;overflow:hidden;color:#8b8b94;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.ipw-video-text-close{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#8b8b94;cursor:pointer;font-size:18px}.ipw-video-text-close:hover{background:rgba(255,255,255,.07);color:#fff}.ipw-video-text-body{display:flex;flex:1;flex-direction:column;gap:18px;overflow:auto;padding:14px}.ipw-video-field label{display:block;margin-bottom:7px;color:#a1a1aa;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.ipw-video-textarea{width:100%;min-height:110px;resize:vertical;border:1px solid rgba(255,255,255,.1);border-radius:12px;outline:0;background:rgba(255,255,255,.045);padding:10px 11px;color:#fff;font:500 13px/1.5 inherit}.ipw-video-textarea:focus{border-color:rgba(60,230,172,.55);box-shadow:0 0 0 3px rgba(60,230,172,.1)}.ipw-video-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ipw-video-control{display:flex;align-items:center;height:38px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.045);overflow:hidden}.ipw-video-number{min-width:0;flex:1;border:0;outline:0;background:transparent;padding:0 10px;color:#fff;font:600 12px inherit}.ipw-video-step{width:30px;height:100%;border:0;border-left:1px solid rgba(255,255,255,.08);background:transparent;color:#a1a1aa;cursor:pointer}.ipw-video-step:hover{background:rgba(255,255,255,.07);color:#fff}.ipw-video-color{width:100%;height:38px;cursor:pointer;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.045);padding:5px}';
      document.head.appendChild(style);
      panel = document.createElement('aside');
      panel.className = 'ipw-video-text-panel';
      panel.setAttribute('data-ipollowork-video-text-panel', 'true');
      panel.setAttribute('aria-label', 'Video text editor');
      panel.innerHTML = '<div class="ipw-video-text-head"><span class="ipw-video-text-icon">T</span><div class="ipw-video-text-title"><strong>Text</strong><span data-ipw-text-element>Selected text</span></div><button type="button" class="ipw-video-text-close" aria-label="Close text editor">×</button></div><div class="ipw-video-text-body"><div class="ipw-video-field"><label for="ipw-video-text-content">Content</label><textarea id="ipw-video-text-content" class="ipw-video-textarea" spellcheck="false"></textarea></div><div class="ipw-video-row"><div class="ipw-video-field"><label for="ipw-video-font-size">Size</label><div class="ipw-video-control"><input id="ipw-video-font-size" class="ipw-video-number" type="number" min="1" max="500" step="1"><button type="button" class="ipw-video-step" data-step="-1">−</button><button type="button" class="ipw-video-step" data-step="1">+</button></div></div><div class="ipw-video-field"><label for="ipw-video-text-color">Color</label><input id="ipw-video-text-color" class="ipw-video-color" type="color"></div></div></div>';
      document.body.appendChild(panel);
      const text = panel.querySelector('#ipw-video-text-content');
      const size = panel.querySelector('#ipw-video-font-size');
      const color = panel.querySelector('#ipw-video-text-color');
      panel.querySelector('.ipw-video-text-close').addEventListener('click', () => { panel.style.display = 'none'; });
      text.addEventListener('input', () => window.__ipolloworkVideoTextSource?.__ipolloworkSetSelectedText?.(text.value));
      size.addEventListener('change', () => window.__ipolloworkVideoTextSource?.__ipolloworkSetSelectedStyle?.('font-size', Math.max(1, Number(size.value) || 1) + 'px'));
      color.addEventListener('input', () => window.__ipolloworkVideoTextSource?.__ipolloworkSetSelectedStyle?.('color', color.value));
      for (const step of panel.querySelectorAll('[data-step]')) step.addEventListener('click', () => {
        size.value = String(Math.max(1, (Number(size.value) || 16) + Number(step.dataset.step)));
        size.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return panel;
    };
    const normalizePanelColor = (value) => {
      if (/^#[0-9a-f]{6}$/i.test(value || '')) return value;
      const rgb = String(value || '').match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
      return rgb ? '#' + rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')).join('') : '#111827';
    };
    const showTextPanel = (source, data) => {
      const panel = ensureTextPanel();
      window.__ipolloworkVideoTextSource = source;
      panel.querySelector('[data-ipw-text-element]').textContent = (data.tag || 'text').toUpperCase();
      panel.querySelector('#ipw-video-text-content').value = data.text || '';
      panel.querySelector('#ipw-video-font-size').value = String(Math.max(1, Math.round(Number.parseFloat(data.fontSize) || 16)));
      panel.querySelector('#ipw-video-text-color').value = normalizePanelColor(data.color);
      panel.style.display = 'flex';
    };
    const hideTextPanel = () => {
      const panel = document.querySelector('[data-ipollowork-video-text-panel]');
      if (panel) panel.style.display = 'none';
      window.__ipolloworkVideoTextSource = null;
    };
    const keepInspectorClosed = () => {
      for (const delay of [0, 50, 140, 260]) window.setTimeout(() => {
        const inspector = document.querySelector('button[aria-label="Inspector"]');
        if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
      }, delay);
    };
    if (enabled && !wasEnabled) {
      window.setTimeout(() => {
        const iframe = collectIframes(document)[0];
        const player = iframe?.getRootNode?.()?.host;
        if (player?.tagName === 'HYPERFRAMES-PLAYER') player.seek?.(0);
        iframe?.contentWindow?.__player?.seek?.(0);
      }, 120);
    }
    if (window.__ipolloworkSimpleVideoListener !== 13) {
      window.__ipolloworkSimpleVideoListener = 13;
      window.__ipolloworkVideoAdvancedExplicit = false;
      window.addEventListener('message', (event) => {
        const inspector = document.querySelector('button[aria-label="Inspector"]');
        if (event.data?.type === 'ipollowork:hyperframes:direct-text-edit') {
          clearCanvasSelection();
          if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
          hideTextPanel();
          return;
        }
        if (event.data?.type === 'ipollowork:hyperframes:close-side-panels') {
          hideTextPanel();
          window.__ipolloworkVideoAdvancedExplicit = false;
          keepInspectorClosed();
          return;
        }
        if (event.data?.type === 'ipollowork:hyperframes:open-text-panel') {
          clearCanvasSelection();
          if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
          showTextPanel(event.source, event.data);
          return;
        }
        if (event.data?.type === 'ipollowork:hyperframes:element-edit') {
          return;
        }
        if (event.data?.type === 'ipollowork:hyperframes:native-selection-compact') {
          hideTextPanel();
          window.__ipolloworkVideoAdvancedExplicit = false;
          applyCanvasSelection(event.data.target);
          if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
          return;
        }
        if (event.data?.type === 'ipollowork:hyperframes:open-advanced') {
          hideTextPanel();
          const iframe = collectIframes(document).find((candidate) => candidate.contentWindow === event.source);
          const x = Number(event.data.x);
          const y = Number(event.data.y);
          window.__ipolloworkVideoAdvancedExplicit = true;
          const target = event.data.target || (Number.isFinite(x) && Number.isFinite(y)
            ? iframe?.contentWindow?.__ipolloworkNativeTargetAtPoint?.(x, y)
            : null);
          if (!applyCanvasSelection(target)) {
            iframe?.contentWindow?.__HF_PICKER_API?.enable?.();
            if (Number.isFinite(x) && Number.isFinite(y)) iframe?.contentWindow?.__HF_PICKER_API?.pickAtPoint?.(x, y, 0);
          }
          window.setTimeout(() => {
            const current = document.querySelector('button[aria-label="Inspector"]');
            if (current?.getAttribute('aria-pressed') !== 'true') current?.click();
          }, 40);
        }
      });
      document.addEventListener('click', (event) => {
        const inspectorButton = event.target instanceof Element ? event.target.closest('button[aria-label="Inspector"]') : null;
        if (inspectorButton && inspectorButton.getAttribute('aria-pressed') === 'true') {
          window.__ipolloworkVideoAdvancedExplicit = false;
        }
      }, true);
      document.addEventListener('pointerdown', (event) => {
        if (document.documentElement.dataset.ipolloworkSimpleMode !== 'true') return;
        if (window.__ipolloworkVideoAdvancedExplicit) return;
        for (const iframe of collectIframes(document)) {
          const rect = iframe.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) continue;
          try {
            const scaleX = Number(iframe.contentWindow?.innerWidth || rect.width) / Math.max(1, rect.width);
            const scaleY = Number(iframe.contentWindow?.innerHeight || rect.height) / Math.max(1, rect.height);
            const localX = (event.clientX - rect.left) * scaleX;
            const localY = (event.clientY - rect.top) * scaleY;
            if (iframe.contentWindow?.__ipolloworkSelectAtPoint?.(localX, localY)) {
              clearCanvasSelection();
              const inspector = document.querySelector('button[aria-label="Inspector"]');
              if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
          } catch {}
        }
      }, true);
      document.addEventListener('click', (event) => {
        if (document.documentElement.dataset.ipolloworkSimpleMode !== 'true') return;
        if (window.__ipolloworkVideoAdvancedExplicit) return;
        for (const iframe of collectIframes(document)) {
          const rect = iframe.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) continue;
          try {
            const scaleX = Number(iframe.contentWindow?.innerWidth || rect.width) / Math.max(1, rect.width);
            const scaleY = Number(iframe.contentWindow?.innerHeight || rect.height) / Math.max(1, rect.height);
            const localX = (event.clientX - rect.left) * scaleX;
            const localY = (event.clientY - rect.top) * scaleY;
            const toolbarClick = iframe.contentWindow?.__ipolloworkToolbarClickAtPoint?.(localX, localY);
            if (toolbarClick) {
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            const directEdit = iframe.contentWindow?.__ipolloworkSelectAtPoint?.(localX, localY) ||
              iframe.contentWindow?.__ipolloworkDirectTextAtPoint?.(localX, localY);
            if (directEdit) {
              clearCanvasSelection();
              const inspector = document.querySelector('button[aria-label="Inspector"]');
              if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            const nativeTarget = iframe.contentWindow?.__ipolloworkNativeTargetAtPoint?.(localX, localY);
            if (applyCanvasSelection(nativeTarget)) {
              const inspector = document.querySelector('button[aria-label="Inspector"]');
              if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            const api = iframe.contentWindow?.__HF_PICKER_API;
            const picked = api?.pickAtPoint?.(localX, localY, 0);
            if (picked) window.setTimeout(() => {
              const inspector = document.querySelector('button[aria-label="Inspector"]');
              if (inspector?.getAttribute('aria-pressed') === 'true') inspector.click();
            }, 60);
          } catch {}
        }
      }, true);
    }
    document.documentElement.dataset.ipolloworkSimpleMode = enabled ? 'true' : 'false';
    return {
      ok: true,
      chromeClean: studioChromeClean,
      sidebarToggled: Boolean(button),
      inspectorEnabled: inspector?.getAttribute('aria-pressed') === 'true',
    };
  })()`);
  if (enabled) {
    await Promise.all(frames.filter((frame) => frame !== studioFrame).map((frame) => frame.executeJavaScript(`(() => {
      if (window.__ipolloworkSimpleVideoClickInstalled === 21) return;
      window.__ipolloworkSimpleVideoClickInstalled = 21;
      const encodedProjectId = location.pathname.match(/^\\/api\\/projects\\/([^/]+)/)?.[1];
      const projectId = encodedProjectId ? decodeURIComponent(encodedProjectId) : '';
      if (!projectId) return;
      for (const element of document.querySelectorAll('div')) {
        if (element.childElementCount === 0 && (element.textContent || '').trim()) {
          element.setAttribute('data-ipollowork-direct-text', 'true');
        }
        if (element.id && !element.hasAttribute('data-composition-id')) {
          element.setAttribute('data-ipollowork-direct-element', 'true');
        }
      }
      const textSelector = 'h1,h2,h3,h4,h5,h6,p,span,a,button,label,li,blockquote,[data-ipollowork-direct-text]';
      let editing = null;
      let selected = null;
      let selectedTarget = null;
      let selectedTextRange = null;
      let pendingPointer = null;
      let saveTimer = 0;
      const postEditorMessage = (payload) => {
        let target = window.parent;
        while (target && target !== window) {
          target.postMessage(payload, '*');
          if (target === target.parent) break;
          target = target.parent;
        }
      };

      const directEditStyle = document.createElement('style');
      directEditStyle.dataset.ipolloworkDirectText = 'true';
      directEditStyle.textContent = textSelector.split(',').map((selector) =>
        selector + ' { pointer-events: auto !important; }'
      ).join('\\n') + '\\n[data-ipollowork-direct-element] { pointer-events: auto !important; }';
      document.head.appendChild(directEditStyle);

      const toolbarStyle = document.createElement('style');
      toolbarStyle.dataset.ipolloworkVideoToolbar = 'true';
      toolbarStyle.textContent = '.ipollowork-video-toolbar{position:fixed;z-index:2147483647;display:none;align-items:center;gap:4px;padding:5px;border:1px solid rgba(15,23,42,.12);border-radius:14px;background:rgba(255,255,255,.94);box-shadow:0 14px 40px rgba(15,23,42,.2);backdrop-filter:blur(18px);font:500 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;transform-origin:bottom center}.ipollowork-video-toolbar button{appearance:none;border:0;background:transparent;color:inherit;height:28px;min-width:28px;padding:0 8px;border-radius:9px;font:inherit;cursor:pointer;display:grid;place-items:center}.ipollowork-video-toolbar button:hover{background:#f1f5f9}.ipollowork-video-toolbar .ow-tag{padding:0 7px;color:#64748b;font-size:10px;text-transform:uppercase}.ipollowork-video-toolbar .ow-size{min-width:34px;background:#f8fafc}.ipollowork-video-toolbar .ow-color{width:18px;height:18px;min-width:18px;padding:0;border:3px solid white;border-radius:999px;box-shadow:0 0 0 1px rgba(15,23,42,.16)}.ipollowork-video-toolbar .ow-sep{width:1px;height:18px;background:#e2e8f0}.ipollowork-video-colors{position:absolute;left:50%;bottom:38px;display:none;gap:6px;padding:7px;border:1px solid rgba(15,23,42,.1);border-radius:13px;background:rgba(255,255,255,.97);box-shadow:0 12px 32px rgba(15,23,42,.18);transform:translateX(-50%)}.ipollowork-video-colors button{width:22px;height:22px;min-width:22px;padding:0;border-radius:999px;border:2px solid white;box-shadow:0 0 0 1px rgba(15,23,42,.13)}';
      document.head.appendChild(toolbarStyle);

      const toolbar = document.createElement('div');
      toolbar.className = 'ipollowork-video-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Video element quick editor');
      toolbar.innerHTML = '<span class="ow-tag"></span><button type="button" data-action="text" title="Edit text">T</button><button type="button" data-action="smaller" title="Smaller">−</button><button type="button" class="ow-size" data-action="size" title="Font size">16</button><button type="button" data-action="larger" title="Larger">+</button><button type="button" class="ow-color" data-action="colors" title="Color"></button><span class="ow-sep"></span><button type="button" data-action="advanced" title="More properties">•••</button><div class="ipollowork-video-colors"></div>';
      const colors = toolbar.querySelector('.ipollowork-video-colors');
      for (const color of ['#111827','#475569','#ffffff','#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6']) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.dataset.color = color;
        swatch.title = color;
        swatch.style.backgroundColor = color;
        colors.appendChild(swatch);
      }
      document.body.appendChild(toolbar);

      const formatAnchor = toolbar.querySelector('[data-action="text"]');
      for (const [action, label, tag] of [['bold', 'B', 'strong'], ['italic', 'I', 'em'], ['strike', 'S', 'del'], ['code', '</>', 'code'], ['link', '↗', 'a']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = action;
        button.dataset.richTag = tag;
        button.title = action === 'link' ? 'Insert link' : label;
        button.textContent = label;
        if (action === 'bold') button.style.fontWeight = '700';
        if (action === 'italic') button.style.fontStyle = 'italic';
        formatAnchor?.after(button);
      }

      const sourceTargetFor = (element) => {
        const composition = element.closest('[data-composition-file]') || element.closest('[data-composition-id]');
        const file = composition?.getAttribute('data-composition-file') || 'index.html';
        if (!composition) return null;
        const tag = element.tagName.toLowerCase();
        const stableClasses = [...element.classList].filter((name) => !name.startsWith('__hf-'));
        const selector = stableClasses.length
          ? tag + stableClasses.map((name) => '.' + CSS.escape(name)).join('')
          : tag;
        const scope = composition.querySelector('[data-hf-inner-root]') || composition;
        const matches = [...scope.querySelectorAll(selector)];
        const selectorIndex = Math.max(0, matches.indexOf(element));
        return { file, selector, selectorIndex };
      };

      const saveTextTarget = (target, value, immediate = false) => {
        if (!target) return;
        window.clearTimeout(saveTimer);
        const run = async () => {
          try {
            await fetch('/api/projects/' + encodeURIComponent(projectId) + '/file-mutations/patch-element/' + encodeURI(target.file), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                target: { selector: target.selector, selectorIndex: target.selectorIndex },
                operations: [{ type: 'text-content', value: String(value ?? '') }],
              }),
            });
          } catch {}
        };
        if (immediate) void run();
        else saveTimer = window.setTimeout(run, 180);
      };
      const saveText = (element, immediate = false) => {
        saveTextTarget(sourceTargetFor(element), element.textContent || '', immediate);
      };

      const saveRichTextTarget = (target, html) => {
        if (!target) return;
        void fetch('/api/projects/' + encodeURIComponent(projectId) + '/file-mutations/patch-element/' + encodeURI(target.file), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            target: { selector: target.selector, selectorIndex: target.selectorIndex },
            operations: [{ type: 'inner-html', value: String(html ?? '') }],
          }),
        }).catch(() => {});
      };

      const applyRichTextFormat = (tag, href) => {
        if (!selected || !selectedTextRange || !selectedTextRange.toString().trim()) return;
        const selection = window.getSelection();
        if (!selection) return;
        selection.removeAllRanges();
        selection.addRange(selectedTextRange);
        const range = selection.getRangeAt(0);
        if (!selected.contains(range.commonAncestorContainer)) return;
        const wrapper = document.createElement(tag);
        if (tag === 'a') {
          const value = href || window.prompt('Link URL', 'https://');
          if (!value || !/^(https?:|mailto:)/i.test(value)) return;
          wrapper.setAttribute('href', value);
        }
        try {
          range.surroundContents(wrapper);
        } catch {
          const fragment = range.extractContents();
          wrapper.appendChild(fragment);
          range.insertNode(wrapper);
        }
        selectedTextRange = range.cloneRange();
        selectedTextRange.selectNodeContents(wrapper);
        saveRichTextTarget(sourceTargetFor(selected), selected.innerHTML);
        showToolbar(selected);
      };

      const saveStyleTarget = async (target, property, value) => {
        if (!target) return;
        try {
          await fetch('/api/projects/' + encodeURIComponent(projectId) + '/file-mutations/patch-element/' + encodeURI(target.file), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              target: { selector: target.selector, selectorIndex: target.selectorIndex },
              operations: [{ type: 'inline-style', property, value }],
            }),
          });
        } catch {}
      };
      const saveStyle = async (element, property, value) => {
        const target = sourceTargetFor(element);
        if (!target) return;
        element.style.setProperty(property, value);
        await saveStyleTarget(target, property, value);
      };

      const displayScale = () => {
        try {
          const find = (root) => {
            for (const node of root.querySelectorAll('*')) {
              if (node.tagName === 'IFRAME' && node.contentWindow === window) return node;
              if (node.shadowRoot) { const nested = find(node.shadowRoot); if (nested) return nested; }
            }
            return null;
          };
          const frame = find(window.parent.document);
          return frame ? Math.max(.05, frame.getBoundingClientRect().width / Math.max(1, innerWidth)) : 1;
        } catch { return 1; }
      };

      const hideToolbar = () => {
        toolbar.style.display = 'none';
        colors.style.display = 'none';
        selected = null;
        selectedTextRange = null;
      };

      const showToolbar = (element) => {
        selected = element;
        const rect = element.getBoundingClientRect();
        const scale = displayScale();
        const fontSize = Math.max(1, Math.round(parseFloat(getComputedStyle(element).fontSize) || 16));
        const canEditText = element.matches(textSelector) && Boolean((element.textContent || '').trim());
        toolbar.querySelector('.ow-tag').textContent = element.tagName;
        toolbar.querySelector('[data-action="text"]').style.display = canEditText ? '' : 'none';
        toolbar.querySelector('[data-action="smaller"]').style.display = canEditText ? '' : 'none';
        toolbar.querySelector('[data-action="size"]').style.display = canEditText ? '' : 'none';
        toolbar.querySelector('[data-action="larger"]').style.display = canEditText ? '' : 'none';
        toolbar.querySelector('[data-action="size"]').textContent = String(fontSize);
        toolbar.querySelector('.ow-color').style.backgroundColor = getComputedStyle(element).color;
        toolbar.style.left = Math.max(80 / scale, Math.min(innerWidth - 80 / scale, rect.left + rect.width / 2)) + 'px';
        const placeAbove = rect.top * scale > 48;
        toolbar.style.top = (placeAbove ? rect.top - 10 / scale : rect.bottom + 10 / scale) + 'px';
        toolbar.style.transform = 'translate(-50%, ' + (placeAbove ? '-100%' : '0') + ') scale(' + (1 / scale) + ')';
        toolbar.style.display = 'flex';
        postEditorMessage({ type: 'ipollowork:hyperframes:element-edit' });
      };

      const finishEditing = () => {
        if (!editing) return;
        saveText(editing, true);
        editing.removeAttribute('contenteditable');
        editing.style.removeProperty('pointer-events');
        editing.style.removeProperty('outline');
        editing.style.removeProperty('outline-offset');
        editing.style.removeProperty('cursor');
        editing = null;
      };

      const editableAtPoint = (x, y) => {
        const elements = document.elementsFromPoint(x, y).filter((element) => element instanceof Element && !toolbar.contains(element));
        const patchable = elements.find((element) => sourceTargetFor(element));
        const geometric = [...document.querySelectorAll('[id],[data-hf-id]')]
          .filter((element) => {
            if (toolbar.contains(element) || !sourceTargetFor(element)) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
              Number(style.opacity || 1) > .01 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return ar.width * ar.height - br.width * br.height;
          })[0];
        return textAtPoint(x, y) || geometric || patchable || null;
      };

      const isEffectivelyVisible = (element) => {
        let current = element;
        while (current && current !== document.documentElement) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= .01) return false;
          current = current.parentElement;
        }
        return true;
      };

      const textAtPoint = (x, y) => [...document.querySelectorAll(textSelector)]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && isEffectivelyVisible(element) &&
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom &&
            Boolean((element.textContent || '').trim()) && sourceTargetFor(element);
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return ar.width * ar.height - br.width * br.height;
        })[0] || null;

      const beginEditing = (element, event) => {
        if (!element) return false;
        // HyperFrames installs its picker on the click phase. Disable it before
        // that click is emitted so it cannot replace the text caret with a
        // geometry selection and open the native Inspector.
        window.__HF_PICKER_API?.disable?.();
        event.stopImmediatePropagation();
        if (editing && editing !== element) finishEditing();
        editing = element;
        selected = element;
        selectedTarget = sourceTargetFor(element);
        element.setAttribute('contenteditable', 'plaintext-only');
        element.style.setProperty('pointer-events', 'auto', 'important');
        element.style.setProperty('cursor', 'text', 'important');
        element.style.setProperty('outline', '3px solid #8b5cf6', 'important');
        element.style.setProperty('outline-offset', '5px', 'important');
        element.focus({ preventScroll: true });
        const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (range && element.contains(range.startContainer)) {
          const selection = getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        const target = selectedTarget;
        const computed = getComputedStyle(element);
        postEditorMessage({
          type: 'ipollowork:hyperframes:direct-text-edit',
          target: target ? { ...target, id: element.id || undefined } : null,
          tag: element.tagName.toLowerCase(),
          text: element.textContent || '',
          fontSize: computed.fontSize,
          color: computed.color,
        });
        showToolbar(element);
        return true;
      };

      const selectTextAtPoint = (x, y, event) => {
        const element = textAtPoint(x, y);
        if (!element) return false;
        return beginEditing(element, event || { clientX: x, clientY: y, stopImmediatePropagation() {} });
      };

      toolbar.addEventListener('pointerdown', (event) => event.stopImmediatePropagation(), true);
      document.addEventListener('selectionchange', () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return;
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
        const element = container?.closest?.(textSelector);
        if (!element || !sourceTargetFor(element) || !element.contains(range.commonAncestorContainer)) return;
        selected = element;
        selectedTarget = sourceTargetFor(element);
        selectedTextRange = range.cloneRange();
        showToolbar(element);
      }, true);
      toolbar.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (!button || !selected) return;
        const action = button.dataset.action;
        if (action !== 'advanced') postEditorMessage({ type: 'ipollowork:hyperframes:close-side-panels' });
        if (button.dataset.richTag) {
          applyRichTextFormat(button.dataset.richTag);
          return;
        }
        if (button.dataset.color) {
          void saveStyle(selected, 'color', button.dataset.color);
          toolbar.querySelector('.ow-color').style.backgroundColor = button.dataset.color;
          colors.style.display = 'none';
          return;
        }
        if (action === 'text') {
          beginEditing(selected, { clientX: selected.getBoundingClientRect().left + 4, clientY: selected.getBoundingClientRect().top + 4, stopImmediatePropagation() {} });
        } else if (action === 'smaller' || action === 'larger') {
          const current = parseFloat(getComputedStyle(selected).fontSize) || 16;
          const next = Math.max(1, Math.round(current + (action === 'larger' ? 1 : -1)));
          toolbar.querySelector('[data-action="size"]').textContent = String(next);
          void saveStyle(selected, 'font-size', next + 'px');
        } else if (action === 'colors') {
          colors.style.display = colors.style.display === 'flex' ? 'none' : 'flex';
        } else if (action === 'advanced') {
          const rect = selected.getBoundingClientRect();
          const canEditText = selected.matches(textSelector) && Boolean((selected.textContent || '').trim());
          const target = sourceTargetFor(selected) || selectedTarget;
          const computed = getComputedStyle(selected);
          finishEditing();
          toolbar.style.display = 'none';
          if (canEditText) {
            postEditorMessage({
              type: 'ipollowork:hyperframes:open-text-panel',
              target: target ? { ...target, id: selected.id || undefined } : null,
              tag: selected.tagName.toLowerCase(),
              text: selected.textContent || '',
              fontSize: computed.fontSize,
              color: computed.color,
            });
            return;
          }
          postEditorMessage({
            type: 'ipollowork:hyperframes:open-advanced',
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            target: target ? { ...target, id: selected.id || undefined } : null,
          });
        }
      }, true);

      document.addEventListener('pointerdown', (event) => {
        if (toolbar.contains(event.target)) return;
        finishEditing();
        const text = textAtPoint(event.clientX, event.clientY);
        if (text && beginEditing(text, event)) {
          pendingPointer = null;
          event.preventDefault();
          return;
        }
        pendingPointer = { x: event.clientX, y: event.clientY, text, moved: false };
        // Keep HyperFrames' original picker active during the gesture. A real
        // drag therefore still moves/resizes the native selection; only a
        // stationary click is converted into lightweight text editing below.
        window.__HF_PICKER_API?.enable?.();
      }, true);
      document.addEventListener('pointermove', (event) => {
        if (!pendingPointer) return;
        if (Math.hypot(event.clientX - pendingPointer.x, event.clientY - pendingPointer.y) > 4) {
          pendingPointer.moved = true;
          hideToolbar();
        }
      }, true);
      document.addEventListener('click', (event) => {
        if (toolbar.contains(event.target)) return;
        if (editing) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const gesture = pendingPointer;
        pendingPointer = null;
        if (gesture?.moved) {
          const element = editableAtPoint(event.clientX, event.clientY);
          const target = element ? sourceTargetFor(element) : null;
          window.setTimeout(() => postEditorMessage({
            type: 'ipollowork:hyperframes:native-selection-compact',
            target: target ? { ...target, id: element.id || undefined } : null,
          }), 60);
          return;
        }
        if (gesture?.text && selectTextAtPoint(event.clientX, event.clientY, event)) {
          event.preventDefault();
          return;
        }
        hideToolbar();
        const element = editableAtPoint(event.clientX, event.clientY);
        const target = element ? sourceTargetFor(element) : null;
        window.setTimeout(() => postEditorMessage({
          type: 'ipollowork:hyperframes:native-selection-compact',
          target: target ? { ...target, id: element.id || undefined } : null,
        }), 60);
      }, true);
      document.addEventListener('input', (event) => {
        if (editing && event.target === editing) saveText(editing);
      }, true);
      document.addEventListener('keydown', (event) => {
        if (!editing || event.target !== editing) return;
        if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) {
          event.preventDefault();
          editing.blur();
        }
      }, true);
      document.addEventListener('focusout', (event) => {
        if (editing && event.target === editing) finishEditing();
      }, true);
      window.__ipolloworkDirectTextAtPoint = (x, y) => {
        const element = textAtPoint(x, y);
        return element ? beginEditing(element, { clientX: x, clientY: y, stopImmediatePropagation() {} }) : false;
      };
      window.__ipolloworkSelectAtPoint = (x, y) => selectTextAtPoint(x, y, { clientX: x, clientY: y, stopImmediatePropagation() {} });
      window.__ipolloworkNativeTargetAtPoint = (x, y) => {
        const element = editableAtPoint(x, y);
        const target = element ? sourceTargetFor(element) : null;
        return target ? { ...target, id: element.id || undefined } : null;
      };
      window.__ipolloworkToolbarClickAtPoint = (x, y) => {
        const target = document.elementFromPoint(x, y);
        if (!(target instanceof Element) || !toolbar.contains(target)) return false;
        target.closest('button')?.click();
        return true;
      };
      window.__ipolloworkSetSelectedText = (value) => {
        const target = selected?.isConnected ? sourceTargetFor(selected) : selectedTarget;
        if (!target) return false;
        if (selected?.isConnected) selected.textContent = String(value ?? '');
        saveTextTarget(target, value);
        return true;
      };
      window.__ipolloworkSetSelectedStyle = (property, value) => {
        if (typeof property !== 'string' || typeof value !== 'string') return false;
        const target = selected?.isConnected ? sourceTargetFor(selected) : selectedTarget;
        if (!target) return false;
        if (selected?.isConnected) selected.style.setProperty(property, value);
        void saveStyleTarget(target, property, value);
        return true;
      };
      window.__HF_PICKER_API?.disable?.();
    })()`).catch(() => undefined)));
  }
  return result;
});

browserPanel.registerIpc(ipcMain);

registerMigrationIpc({ app, ipcMain });
const { ensureAutoUpdater } = registerUpdaterIpc({ app, ipcMain, getMainWindow: () => mainWindow });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("before-quit", (event) => {
    if (runtimeDisposedForQuit) return;
    event.preventDefault();
    if (runtimeDisposeInProgress) return;
    showShutdownScreen();
    void Promise.all([disposeRuntimeBeforeQuit(), uiControlServer.stop()]).finally(() => app.quit());
  });

  app.on("second-instance", async (_event, argv) => {
    const win = await createMainWindow();
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    queueDeepLinks(forwardedDeepLinks(argv));
  });

  app.on("open-url", async (event, url) => {
    event.preventDefault();
    await createMainWindow();
    queueDeepLinks([url]);
  });

  app.whenReady().then(async () => {
    installMediaPermissionHandlers(session, () => mainWindow);
    await workspaceStore.importBundledDesktopBootstrapConfigIfPreferred();
    const bootstrapConfig = await workspaceStore.getDesktopBootstrapConfig();
    currentDisplayAppName = bootstrapConfig.brandAppName?.slice(0, 64) || APP_NAME;
    app.setName(currentDisplayAppName);
    applicationMenu.setAppName(currentDisplayAppName);
    if (process.platform === "win32") {
      await registerWindowsDisplayShortcut();
    }
    if (process.platform === "win32" && bootstrapConfig.brandIconUrl) {
      await applyBrandIconUrl(bootstrapConfig.brandIconUrl);
    }
    applicationMenu.install();
    await runtimeManager.prepareFreshRuntime().catch(() => undefined);

    // Use Tauri's existing workspace state file as canonical so rollback and
    // Electron see the same workspace list. Import the short-lived
    // Electron-only filename only when the shared file is missing.
    await workspaceStore.migrateLegacyElectronWorkspaceStateIfNeeded();
    await uiControlServer.start().catch((error) => {
      console.warn("[ui-control] failed to start", error);
    });
    runtimeBootstrapPromise = bootRuntimeForSelectedWorkspace().catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));

    queueDeepLinks(forwardedDeepLinks(process.argv));
    const win = await createMainWindow();
    win.webContents.on("did-finish-load", () => {
      flushPendingDeepLinks();
    });

    // Initialize the packaged updater after the window is up so the user sees
    // a working app first. Renderer-owned checks pass the selected release
    // channel explicitly, avoiding stale stable-feed results for alpha users.
    void ensureAutoUpdater();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
      return;
    }
    const win = await createMainWindow();
    win.show();
    win.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
