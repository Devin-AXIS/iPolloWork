import { contextBridge, ipcRenderer } from "electron";

let latestRequest = null;
let showCallback = null;

ipcRenderer.on("ipollowork:menu-overlay:show", (_event, request) => {
  latestRequest = request;
  showCallback?.(request);
});

contextBridge.exposeInMainWorld("__IPOLLOWORK_MENU_OVERLAY__", {
  ready() {
    ipcRenderer.send("ipollowork:menu-overlay:ready");
  },
  onShow(callback) {
    showCallback = callback;
    if (latestRequest) {
      callback(latestRequest);
    }
    return () => {
      if (showCallback === callback) {
        showCallback = null;
      }
    };
  },
  choose(requestId, itemId) {
    ipcRenderer.send("ipollowork:menu-overlay:choose", { requestId, itemId });
  },
  close(requestId) {
    ipcRenderer.send("ipollowork:menu-overlay:close", { requestId });
  },
});
