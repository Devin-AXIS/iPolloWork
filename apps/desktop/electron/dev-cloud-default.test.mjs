import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const devScript = readFileSync(fileURLToPath(new URL("../scripts/electron-dev.mjs", import.meta.url)), "utf8");
const iconScript = readFileSync(fileURLToPath(new URL("../scripts/generate-icons.mjs", import.meta.url)), "utf8");
const main = readFileSync(fileURLToPath(new URL("./main.mjs", import.meta.url)), "utf8");
const preload = readFileSync(fileURLToPath(new URL("./preload.mjs", import.meta.url)), "utf8");
const desktopPackage = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
const electronBuilderConfig = readFileSync(
  fileURLToPath(new URL("../electron-builder.yml", import.meta.url)),
  "utf8",
);
const workspacePackage = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"));

test("Electron development defaults to the configured iPolloCloud URL", () => {
  assert.match(devScript, /process\.env\.VITE_DEN_BASE_URL\?\.trim\(\) \|\| "http:\/\/i\.ipollo\.ai"/);
  assert.match(devScript, /VITE_DEN_BASE_URL: developmentCloudUrl/);
  assert.match(main, /process\.env\.VITE_DEN_BASE_URL\?\.trim\(\) \|\| "http:\/\/i\.ipollo\.ai"/);
});

test("development startup does not auto-install dependencies when the registry is unavailable", () => {
  assert.match(workspacePackage.scripts.dev, /pnpm_config_verify_deps_before_run=warn/);
  assert.match(workspacePackage.scripts["dev:electron"], /pnpm_config_verify_deps_before_run=warn/);
});

test("embedded server requests use Electron's system-proxy-aware network stack", () => {
  assert.match(main, /Symbol\.for\("ipollowork\.mediaProviderFetch"\), electronNet\.fetch\.bind\(electronNet\)/);
  assert.doesNotMatch(main, /globalThis\.fetch\s*=/);
});

test("desktop sleep cancels stale requests and resume restores the runtime before notifying React", () => {
  assert.match(main, /powerMonitor\.on\("suspend"/);
  assert.match(main, /abortSuspendedDesktopFetches\(\)/);
  assert.match(main, /session\.defaultSession\.closeAllConnections\(\)/);
  assert.match(main, /powerMonitor\.on\("resume"/);
  assert.match(main, /bootRuntimeForSelectedWorkspace\(\)\.catch/);
  assert.match(main, /recoverDesktopNetworkAfterResume\(\)/);
  assert.match(main, /defaultSession\.clearHostResolverCache\(\)/);
  assert.match(main, /defaultSession\.forceReloadProxyConfig\(\)/);
  assert.match(main, /win\.webContents\.send\(DESKTOP_RESUMED_EVENT, result\)/);
  assert.match(main, /activeDesktopFetchControllers\.add\(suspendController\)/);
  assert.match(main, /activeDesktopFetchControllers\.delete\(suspendController\)/);
  assert.match(main, /DESKTOP_FETCH_DEFAULT_TIMEOUT_MS/);
  assert.match(main, /DESKTOP_NETWORK_RESET_STEP_TIMEOUT_MS/);
  assert.match(main, /isRetryableDesktopFetch\(error, method, attempt\)/);
  assert.match(preload, /ipcRenderer\.on\(DESKTOP_RESUMED_EVENT/);
  assert.match(preload, /window\.dispatchEvent\(new CustomEvent\(DESKTOP_RESUMED_EVENT/);
});

test("renderer load timing is measured per navigation instead of across computer sleep", () => {
  assert.match(main, /webContents\.on\("did-start-loading"/);
  assert.match(main, /renderer finished loading in/);
  assert.doesNotMatch(main, /renderer finished loading after/);
});

test("packaged Windows builds use the tested desktop recovery entrypoint", () => {
  assert.equal(desktopPackage.main, "electron/main.mjs");
  assert.match(electronBuilderConfig, /^\s*- electron\/\*\*\/\*\s*$/m);
});

test("desktop child processes have one owner and are stopped as process trees", () => {
  assert.match(main, /if \(process\.platform === "win32"\) \{\s*killProcessTree\(terminal\.process\)/);
  assert.match(main, /function ensureProcessCleanupForWebContents\(webContents\)/);
  assert.match(main, /killTerminalsForWebContents\(webContentsId\);\s*stopHyperframesForWebContents\(webContentsId\)/);
  assert.match(main, /showShutdownScreen\(\);\s*stopAllDesktopChildProcesses\(\);/);
  assert.doesNotMatch(main, /event\.sender\.once\("destroyed"/);
});

test("macOS development shell embeds the iPollo application icon", () => {
  assert.match(devScript, /copyFileSync\(macAppIcon, macDevElectronIcon\)/);
  assert.match(devScript, /"CFBundleIconFile",\s+"-string",\s+"ipollowork\.icns"/);
});

test("macOS icon keeps native safe-area breathing room", () => {
  assert.match(iconScript, /const MAC_ICON_CANVAS_RATIO = 0\.92/);
  assert.match(iconScript, /background: \{ r: 0, g: 0, b: 0, alpha: 0 \}/);
});
