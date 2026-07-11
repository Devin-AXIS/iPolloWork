import { contextBridge, ipcRenderer } from "electron";

const NATIVE_DEEP_LINK_EVENT = "ipollowalk:deep-link-native";
const NATIVE_MENU_OPEN_SETTINGS_EVENT = "ipollowalk:native-menu:open-settings";
const NATIVE_MENU_TOGGLE_SIDEBAR_EVENT = "ipollowalk:native-menu:toggle-sidebar";
const NATIVE_MENU_CHECK_UPDATES_EVENT = "ipollowalk:native-menu:check-updates";
const NATIVE_MENU_ZOOM_EVENT = "ipollowalk:native-menu:zoom";

function normalizePlatform(value) {
  if (value === "darwin" || value === "linux") return value;
  if (value === "win32") return "windows";
  return "linux";
}

function applyShellDocumentMarkers() {
  try {
    const root = document?.documentElement;
    if (!root) return false;

    root.dataset.ipollowalkShell = "electron";
    root.classList.add("ipollowalk-electron");
    if (process.platform === "darwin") {
      root.classList.add("ipollowalk-platform-mac");
    } else if (process.platform === "win32") {
      root.classList.add("ipollowalk-platform-windows");
    } else if (process.platform === "linux") {
      root.classList.add("ipollowalk-platform-linux");
    }
    return true;
  } catch {
    return false;
  }
}

function notifyMenuOverlayDismiss() {
  ipcRenderer.send("ipollowalk:menu-overlay:dismiss");
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

contextBridge.exposeInMainWorld("__IPOLLOWALK_ELECTRON__", {
  invokeDesktop(command, ...args) {
    return ipcRenderer.invoke("ipollowalk:desktop", command, ...args);
  },
  shell: {
    openExternal(url) {
      return ipcRenderer.invoke("ipollowalk:shell:openExternal", url);
    },
    relaunch() {
      return ipcRenderer.invoke("ipollowalk:shell:relaunch");
    },
  },
  system: {
    getArchitectureInfo() {
      return ipcRenderer.invoke("ipollowalk:system:architecture");
    },
    getMicrophoneStatus() {
      return ipcRenderer.invoke("ipollowalk:system:microphoneStatus");
    },
    askMicrophoneAccess() {
      return ipcRenderer.invoke("ipollowalk:system:askMicrophoneAccess");
    },
  },
  migration: {
    readSnapshot() {
      return ipcRenderer.invoke("ipollowalk:migration:read");
    },
    ackSnapshot() {
      return ipcRenderer.invoke("ipollowalk:migration:ack");
    },
  },
  brandIcon: {
    apply(url) {
      return ipcRenderer.invoke("ipollowalk:desktop", "__applyBrandIcon", url ?? null);
    },
    getState() {
      return ipcRenderer.invoke("ipollowalk:desktop", "__getBrandIconState");
    },
  },
  dev: {
    evalRelaunch() {
      return ipcRenderer.invoke("ipollowalk:desktop", "__evalRelaunch");
    },
  },
  updater: {
    getChannel() {
      return ipcRenderer.invoke("ipollowalk:updater:getChannel");
    },
    setChannel(channel) {
      return ipcRenderer.invoke("ipollowalk:updater:setChannel", channel);
    },
    check(channel) {
      return ipcRenderer.invoke("ipollowalk:updater:check", channel);
    },
    download() {
      return ipcRenderer.invoke("ipollowalk:updater:download");
    },
    installAndRestart() {
      return ipcRenderer.invoke("ipollowalk:updater:installAndRestart");
    },
    /** Subscribe to incremental download progress from electron-updater. */
    onDownloadProgress(callback) {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("ipollowalk:updater:download-progress", handler);
      return () => {
        ipcRenderer.removeListener("ipollowalk:updater:download-progress", handler);
      };
    },
  },
  browser: {
    show(bounds) { return ipcRenderer.invoke("ipollowalk:browser:show", bounds); },
    hide() { return ipcRenderer.invoke("ipollowalk:browser:hide"); },
    openUrl(url, provider) { return ipcRenderer.invoke("ipollowalk:browser:openUrl", url, provider); },
    navigate(url) { return ipcRenderer.invoke("ipollowalk:browser:navigate", url); },
    back() { return ipcRenderer.invoke("ipollowalk:browser:back"); },
    forward() { return ipcRenderer.invoke("ipollowalk:browser:forward"); },
    reload() { return ipcRenderer.invoke("ipollowalk:browser:reload"); },
    setBounds(bounds) { return ipcRenderer.invoke("ipollowalk:browser:bounds", bounds); },
    getState() { return ipcRenderer.invoke("ipollowalk:browser:state"); },
    createTab(url) { return ipcRenderer.invoke("ipollowalk:browser:createTab", url); },
    closeTab(tabId) { return ipcRenderer.invoke("ipollowalk:browser:closeTab", tabId); },
    closeAllTabs() { return ipcRenderer.invoke("ipollowalk:browser:closeAllTabs"); },
    selectTab(tabId) { return ipcRenderer.invoke("ipollowalk:browser:selectTab", tabId); },
    reorderTabs(tabIds) { return ipcRenderer.invoke("ipollowalk:browser:reorderTabs", tabIds); },
    listTabs() { return ipcRenderer.invoke("ipollowalk:browser:listTabs"); },
    setProxy(proxy) { return ipcRenderer.invoke("ipollowalk:browser:setProxy", proxy); },
    getProxy() { return ipcRenderer.invoke("ipollowalk:browser:getProxy"); },
    showTabContextMenu(tabId, point) { return ipcRenderer.invoke("ipollowalk:browser:tabContextMenu", tabId, point); },
    destroy() { return ipcRenderer.invoke("ipollowalk:browser:destroy"); },
    onStateChange(callback) {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("ipollowalk:browser:state", handler);
      return () => ipcRenderer.removeListener("ipollowalk:browser:state", handler);
    },
    onPanelOpened(callback) {
      const handler = () => callback();
      ipcRenderer.on("ipollowalk:browser:panel-opened", handler);
      return () => ipcRenderer.removeListener("ipollowalk:browser:panel-opened", handler);
    },
    onPanelClosed(callback) {
      const handler = () => callback();
      ipcRenderer.on("ipollowalk:browser:panel-closed", handler);
      return () => ipcRenderer.removeListener("ipollowalk:browser:panel-closed", handler);
    },
  },
  terminal: {
    create(options) { return ipcRenderer.invoke("ipollowalk:terminal:create", options); },
    write(terminalId, data) { return ipcRenderer.invoke("ipollowalk:terminal:write", terminalId, data); },
    resize(terminalId, cols, rows) { return ipcRenderer.invoke("ipollowalk:terminal:resize", terminalId, cols, rows); },
    kill(terminalId) { return ipcRenderer.invoke("ipollowalk:terminal:kill", terminalId); },
    onData(callback) {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("ipollowalk:terminal:data", handler);
      return () => ipcRenderer.removeListener("ipollowalk:terminal:data", handler);
    },
    onExit(callback) {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("ipollowalk:terminal:exit", handler);
      return () => ipcRenderer.removeListener("ipollowalk:terminal:exit", handler);
    },
  },
  hyperframes: {
    setSimpleMode(enabled) { return ipcRenderer.invoke("ipollowalk:hyperframes:set-simple-mode", Boolean(enabled)); },
  },
  meta: {
    initialDeepLinks: [],
    platform: normalizePlatform(process.platform),
    version: process.versions.electron,
    // Mirror the main-process workspace-recovery flag so the renderer's
    // first-run detection (which reads localStorage, not the desktop state
    // file) stays consistent when recovery is deliberately disabled.
    disableWorkspaceRecovery: process.env.IPOLLOWALK_DESKTOP_DISABLE_WORKSPACE_RECOVERY === "1",
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
