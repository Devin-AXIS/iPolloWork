import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

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

test("development startup launches the app package without a nested workspace script", () => {
  assert.match(devScript, /\["--filter", "@ipollowork\/app", "dev"\]/);
  assert.doesNotMatch(devScript, /\["-w", "dev:ui"\]/);
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

test("main window ignores saved video deliveries while preserving desktop lifecycle", async () => {
  const start = main.indexOf("async function createMainWindow()");
  const end = main.indexOf('\nipcMain.handle("ipollowork:desktop"', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(main, /background-video-delivery|createBackgroundVideoDeliverySupervisor|host-video-deliveries|ipolloworkBackgroundDelivery/);
  for (const packaged of [false, true]) {
    const windows = [];
    const routed = [];
    const stored = new Map([["ipollowork:host-video-deliveries:v1", JSON.stringify([{
      workspaceId: "ws_saved", sessionId: "session-saved", intent: "export", storedAt: Date.now(),
    }])]]);
    const before = [...stored];
    let rendererReads = 0;
    let pollTimers = 0;
    let destroyedPanels = 0;
    let flushedDeepLinks = 0;
    class Window extends EventEmitter {
      constructor(options) {
        super();
        this.options = options;
        this.shown = 0;
        this.stopped = 0;
        this.webContents = Object.assign(new EventEmitter(), {
          setWindowOpenHandler: () => {},
          stop: () => { this.stopped += 1; },
          executeJavaScript: () => { rendererReads += 1; return Promise.resolve({
            href: "http://localhost:5173/#/workspace/ws_other/session/session-other",
            deliveries: stored.get("ipollowork:host-video-deliveries:v1"),
          }); },
        });
        windows.push(this);
      }
      setMinimumSize() {}
      setTitle() {}
      show() { this.shown += 1; }
      async loadURL(url) { this.loaded = ["url", url]; }
      async loadFile(file) { this.loaded = ["file", file]; }
    }
    const runtime = runInNewContext(main.slice(start, end) + "\n({ createMainWindow, getMainWindow: () => mainWindow })", {
      mainWindow: null, BrowserWindow: Window, path, __dirname: "/repo/apps/desktop/electron",
      process: { platform: "linux", resourcesPath: "/packaged-resources", env: packaged ? {} : { IPOLLOWORK_ELECTRON_START_URL: "http://localhost:5173/" } },
      app: { isPackaged: packaged }, APP_ICON_IMAGE: null, currentDisplayAppName: "iPolloWork",
      MAIN_WINDOW_DEFAULT_WIDTH: 1280, MAIN_WINDOW_DEFAULT_HEIGHT: 800,
      MAIN_WINDOW_MIN_WIDTH: 800, MAIN_WINDOW_MIN_HEIGHT: 600,
      readMainWindowState: async () => null, readBrandIconSidecar: async () => null,
      writeMainWindowState: async () => {}, enforceMainWindowMinimumSize: () => {},
      applicationMenu: { applyVisibility: () => {} },
      browserPanel: {
        destroy: () => { destroyedPanels += 1; },
        isMainWindowAllowedNavigation: (url) => url.startsWith("http://localhost:5173/"),
        routeBlockedMainWindowNavigation: (url) => { routed.push(url); },
      },
      flushPendingDeepLinks: () => { flushedDeepLinks += 1; },
      setInterval: () => { pollTimers += 1; return 1; },
      createBackgroundVideoDeliverySupervisor: () => { throw new Error("Retired video supervisor started"); },
      isHyperframesStudioUrl: () => false, console: { info: () => {} },
    });
    const window = await runtime.createMainWindow();
    assert.equal(await runtime.createMainWindow(), window, "reopening reuses the main window");
    assert.equal(windows.length, 1, "saved deliveries must not create a hidden worker");
    assert.deepEqual(window.loaded, packaged ? ["file", "/packaged-resources/app-dist/index.html"] : ["url", "http://localhost:5173/"]);
    assert.equal(window.options.webPreferences.backgroundThrottling, false);
    window.emit("ready-to-show");
    assert.equal(window.shown, 1);
    assert.equal(flushedDeepLinks, 1);
    let prevented = 0;
    window.webContents.emit("will-navigate", { preventDefault: () => { prevented += 1; } }, "https://external.example/");
    window.webContents.emit("did-start-navigation", {}, "https://cdp.example/", false, true);
    assert.equal(prevented, 1);
    assert.equal(window.stopped, 1);
    assert.deepEqual(routed, ["https://external.example/", "https://cdp.example/"]);
    window.emit("closed");
    assert.equal(destroyedPanels, 1);
    assert.equal(runtime.getMainWindow(), null);
    assert.equal(rendererReads, 0, "startup must not inspect the renderer's stale delivery queue");
    assert.equal(pollTimers, 0, "startup must not schedule delivery polling");
    assert.deepEqual([...stored], before, "retirement must preserve saved user data");
  }
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
