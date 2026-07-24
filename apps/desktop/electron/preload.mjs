import { contextBridge, ipcRenderer } from "electron";

const NATIVE_DEEP_LINK_EVENT = "ipollowork:deep-link-native";
const NATIVE_MENU_OPEN_SETTINGS_EVENT = "ipollowork:native-menu:open-settings";
const NATIVE_MENU_TOGGLE_SIDEBAR_EVENT = "ipollowork:native-menu:toggle-sidebar";
const NATIVE_MENU_CHECK_UPDATES_EVENT = "ipollowork:native-menu:check-updates";
const NATIVE_MENU_ZOOM_EVENT = "ipollowork:native-menu:zoom";

function normalizePlatform(value) {
  if (value === "darwin" || value === "linux") return value;
  if (value === "win32") return "windows";
  return "linux";
}

function applyShellDocumentMarkers() {
  try {
    const root = document?.documentElement;
    if (!root) return false;

    root.dataset.ipolloworkShell = "electron";
    root.classList.add("ipollowork-electron");
    if (process.platform === "darwin") {
      root.classList.add("ipollowork-platform-mac");
    } else if (process.platform === "win32") {
      root.classList.add("ipollowork-platform-windows");
    } else if (process.platform === "linux") {
      root.classList.add("ipollowork-platform-linux");
    }
    return true;
  } catch {
    return false;
  }
}

function notifyMenuOverlayDismiss() {
  ipcRenderer.send("ipollowork:menu-overlay:dismiss");
}

function installMenuOverlayDismissListeners() {
  try {
    const target = window;
    target.addEventListener("pointerdown", notifyMenuOverlayDismiss, { capture: true });
    target.addEventListener("wheel", notifyMenuOverlayDismiss, { capture: true, passive: true });
    target.addEventListener("keydown", notifyMenuOverlayDismiss, { capture: true });
    return true;
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld("__IPOLLOWORK_ELECTRON__", {
  invokeDesktop(command, ...args) {
    return ipcRenderer.invoke("ipollowork:desktop", command, ...args);
  },
  shell: {
    openExternal(url) {
      return ipcRenderer.invoke("ipollowork:shell:openExternal", url);
    },
    relaunch() {
      return ipcRenderer.invoke("ipollowork:shell:relaunch");
    },
  },
  system: {
    getArchitectureInfo() {
      return ipcRenderer.invoke("ipollowork:system:architecture");
    },
    getMicrophoneStatus() {
      return ipcRenderer.invoke("ipollowork:system:microphoneStatus");
    },
    askMicrophoneAccess() {
      return ipcRenderer.invoke("ipollowork:system:askMicrophoneAccess");
    },
  },
  migration: {
    readSnapshot() {
      return ipcRenderer.invoke("ipollowork:migration:read");
    },
    ackSnapshot() {
      return ipcRenderer.invoke("ipollowork:migration:ack");
    },
  },
  brandIcon: {
    apply(url) {
      return ipcRenderer.invoke("ipollowork:desktop", "__applyBrandIcon", url ?? null);
    },
    getState() {
      return ipcRenderer.invoke("ipollowork:desktop", "__getBrandIconState");
    },
  },
  dev: {
    evalRelaunch() {
      return ipcRenderer.invoke("ipollowork:desktop", "__evalRelaunch");
    },
  },
  updater: {
    getState() {
      return ipcRenderer.invoke("ipollowork:updater:getState");
    },
    check() {
      return ipcRenderer.invoke("ipollowork:updater:check");
    },
    download() {
      return ipcRenderer.invoke("ipollowork:updater:download");
    },
    installAndRestart() {
      return ipcRenderer.invoke("ipollowork:updater:installAndRestart");
    },
    /** Subscribe to incremental download progress from electron-updater. */
    onDownloadProgress(callback) {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("ipollowork:updater:download-progress", handler);
      return () => {
        ipcRenderer.removeListener("ipollowork:updater:download-progress", handler);
      };
    },
  },
  browser: {
    show(bounds) { return ipcRenderer.invoke("ipollowork:browser:show", bounds); },
    hide() { return ipcRenderer.invoke("ipollowork:browser:hide"); },
    openUrl(url, provider) { return ipcRenderer.invoke("ipollowork:browser:openUrl", url, provider); },
    navigate(url) { return ipcRenderer.invoke("ipollowork:browser:navigate", url); },
    back() { return ipcRenderer.invoke("ipollowork:browser:back"); },
    forward() { return ipcRenderer.invoke("ipollowork:browser:forward"); },
    reload() { return ipcRenderer.invoke("ipollowork:browser:reload"); },
    setBounds(bounds) { return ipcRenderer.invoke("ipollowork:browser:bounds", bounds); },
    getState() { return ipcRenderer.invoke("ipollowork:browser:state"); },
    createTab(url) { return ipcRenderer.invoke("ipollowork:browser:createTab", url); },
    closeTab(tabId) { return ipcRenderer.invoke("ipollowork:browser:closeTab", tabId); },
    closeAllTabs() { return ipcRenderer.invoke("ipollowork:browser:closeAllTabs"); },
    selectTab(tabId) { return ipcRenderer.invoke("ipollowork:browser:selectTab", tabId); },
    reorderTabs(tabIds) { return ipcRenderer.invoke("ipollowork:browser:reorderTabs", tabIds); },
    listTabs() { return ipcRenderer.invoke("ipollowork:browser:listTabs"); },
    setProxy(proxy) { return ipcRenderer.invoke("ipollowork:browser:setProxy", proxy); },
    getProxy() { return ipcRenderer.invoke("ipollowork:browser:getProxy"); },
    showTabContextMenu(tabId, point) { return ipcRenderer.invoke("ipollowork:browser:tabContextMenu", tabId, point); },
    destroy() { return ipcRenderer.invoke("ipollowork:browser:destroy"); },
    onStateChange(callback) {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("ipollowork:browser:state", handler);
      return () => ipcRenderer.removeListener("ipollowork:browser:state", handler);
    },
    onPanelOpened(callback) {
      const handler = () => callback();
      ipcRenderer.on("ipollowork:browser:panel-opened", handler);
      return () => ipcRenderer.removeListener("ipollowork:browser:panel-opened", handler);
    },
    onPanelClosed(callback) {
      const handler = () => callback();
      ipcRenderer.on("ipollowork:browser:panel-closed", handler);
      return () => ipcRenderer.removeListener("ipollowork:browser:panel-closed", handler);
    },
  },
  terminal: {
    create(options) { return ipcRenderer.invoke("ipollowork:terminal:create", options); },
    write(terminalId, data) { return ipcRenderer.invoke("ipollowork:terminal:write", terminalId, data); },
    resize(terminalId, cols, rows) { return ipcRenderer.invoke("ipollowork:terminal:resize", terminalId, cols, rows); },
    kill(terminalId) { return ipcRenderer.invoke("ipollowork:terminal:kill", terminalId); },
    onData(callback) {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("ipollowork:terminal:data", handler);
      return () => ipcRenderer.removeListener("ipollowork:terminal:data", handler);
    },
    onExit(callback) {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("ipollowork:terminal:exit", handler);
      return () => ipcRenderer.removeListener("ipollowork:terminal:exit", handler);
    },
  },
  hyperframes: {
    start(options) { return ipcRenderer.invoke("ipollowork:hyperframes:start", options); },
    stop(sessionId) { return ipcRenderer.invoke("ipollowork:hyperframes:stop", sessionId); },
    setSimpleMode(enabled) { return ipcRenderer.invoke("ipollowork:hyperframes:set-simple-mode", Boolean(enabled)); },
  },
  meta: {
    initialDeepLinks: [],
    platform: normalizePlatform(process.platform),
    version: process.versions.electron,
    // Mirror the main-process workspace-recovery flag so the renderer's
    // first-run detection (which reads localStorage, not the desktop state
    // file) stays consistent when recovery is deliberately disabled.
    disableWorkspaceRecovery: process.env.IPOLLOWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY === "1",
  },
});

ipcRenderer.on(NATIVE_DEEP_LINK_EVENT, (_event, urls) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NATIVE_DEEP_LINK_EVENT, { detail: urls }));
});

ipcRenderer.on(NATIVE_MENU_OPEN_SETTINGS_EVENT, () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NATIVE_MENU_OPEN_SETTINGS_EVENT));
});

ipcRenderer.on(NATIVE_MENU_TOGGLE_SIDEBAR_EVENT, () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NATIVE_MENU_TOGGLE_SIDEBAR_EVENT));
});

ipcRenderer.on(NATIVE_MENU_CHECK_UPDATES_EVENT, () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NATIVE_MENU_CHECK_UPDATES_EVENT));
});

ipcRenderer.on(NATIVE_MENU_ZOOM_EVENT, (_event, action) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NATIVE_MENU_ZOOM_EVENT, { detail: action }));
});

if (!applyShellDocumentMarkers() && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", applyShellDocumentMarkers, { once: true });
}

if (!installMenuOverlayDismissListeners() && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", installMenuOverlayDismissListeners, { once: true });
}
