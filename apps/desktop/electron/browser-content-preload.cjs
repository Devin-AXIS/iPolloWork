const { ipcRenderer } = require("electron");

let actionCursor = null;
let cursorHideTimer = null;

function hideActionCursor() {
  clearTimeout(cursorHideTimer);
  actionCursor?.remove();
  actionCursor = null;
}

ipcRenderer.on("ipollowork:browser:cursor", (_event, point) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    hideActionCursor();
    return;
  }
  if (!document.documentElement) return;
  if (!actionCursor?.isConnected) {
    actionCursor = document.createElement("div");
    actionCursor.id = "__ipollowork_browser_cursor__";
    actionCursor.setAttribute("aria-hidden", "true");
    actionCursor.style.cssText = "all:initial;position:fixed;z-index:2147483647;pointer-events:none;width:30px;height:34px;filter:drop-shadow(0 1px 3px #0006)";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "30");
    svg.setAttribute("height", "34");
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // Same arrow as Computer Use's AgentCursorOverlay, with a top-left origin.
    arrow.setAttribute("d", "M4 4 L4 30 L12 23 L17 33 L22 30 L17 20 L27 20 Z");
    arrow.setAttribute("fill", "white");
    arrow.setAttribute("stroke", "#007aff");
    arrow.setAttribute("stroke-width", "2");
    svg.appendChild(arrow);
    actionCursor.attachShadow({ mode: "closed" }).appendChild(svg);
    document.documentElement.appendChild(actionCursor);
  }
  actionCursor.style.left = `${point.x - 4}px`;
  actionCursor.style.top = `${point.y - 4}px`;
  clearTimeout(cursorHideTimer);
  cursorHideTimer = setTimeout(hideActionCursor, 1500);
});

window.addEventListener("pagehide", hideActionCursor);

function dismissMenuOverlay() {
  ipcRenderer.send("ipollowork:menu-overlay:dismiss");
}

function installDismissListeners() {
  window.addEventListener("pointerdown", dismissMenuOverlay, { capture: true });
  window.addEventListener("wheel", dismissMenuOverlay, { capture: true, passive: true });
  window.addEventListener("keydown", dismissMenuOverlay, { capture: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installDismissListeners, { once: true });
} else {
  installDismissListeners();
}
