// Isolated first-party authentication window. This is deliberately separate
// from the user-facing browser panel: remote identity pages never receive the
// app preload or the user's browser cookies, and they cannot replace the
// workspace renderer.

export const DESKTOP_AUTH_SESSION_PARTITION = "persist:ipollowork-auth";

function isDenAuthCallbackUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "ipollowork:" && url.protocol !== "ipollowork-dev:") {
      return false;
    }

    const routeHost = url.hostname.toLowerCase();
    const routePath = url.pathname.replace(/^\/+/, "").toLowerCase();
    const routeSegments = routePath.split("/").filter(Boolean);
    const routeTail = routeSegments[routeSegments.length - 1] ?? "";
    return routeHost === "den-auth" || routePath === "den-auth" || routeTail === "den-auth";
  } catch {
    return false;
  }
}

/**
 * Authentication may redirect through a first-party or third-party HTTPS
 * provider, but the only custom protocol we consume is the one-time Den
 * handoff. Every other non-web protocol is delegated to the operating system.
 */
export function classifyDesktopAuthNavigation(value) {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) return { kind: "block" };
  if (url === "about:blank") return { kind: "allow", url };
  if (isDenAuthCallbackUrl(url)) return { kind: "complete", url };

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return { kind: "allow", url: parsed.toString() };
    }
    return { kind: "external", url: parsed.toString() };
  } catch {
    return { kind: "block" };
  }
}

function runNavigationAction(event, targetUrl, { onComplete, openExternal }) {
  const decision = classifyDesktopAuthNavigation(targetUrl);
  if (decision.kind === "allow") return decision;

  event?.preventDefault?.();
  if (decision.kind === "complete") {
    onComplete?.(decision.url);
  } else if (decision.kind === "external") {
    void openExternal?.(decision.url);
  }
  return decision;
}

function installDesktopAuthNavigation(window, { onComplete, openExternal }) {
  const inspectNavigation = (event, targetUrl) => {
    runNavigationAction(event, targetUrl, { onComplete, openExternal });
  };

  window.webContents.on("will-navigate", inspectNavigation);
  window.webContents.on("will-redirect", inspectNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = runNavigationAction(null, url, { onComplete, openExternal });
    if (decision.kind === "allow") {
      // Providers that use window.open stay in this isolated client window.
      // This avoids an application switch while keeping the page top-level
      // rather than embedding it in an iframe.
      void window.loadURL(decision.url).catch(() => undefined);
    }
    return { action: "deny" };
  });
}

export function createDesktopAuthWindow({
  BrowserWindow,
  parent,
  title,
  url,
  icon,
  onComplete,
  onClosed,
  openExternal,
}) {
  const window = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 420,
    minHeight: 560,
    parent,
    modal: true,
    show: false,
    title,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    ...(icon ? { icon } : {}),
    webPreferences: {
      partition: DESKTOP_AUTH_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  window.setMenuBarVisibility?.(false);
  installDesktopAuthNavigation(window, { onComplete, openExternal });
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
  window.on("closed", () => onClosed?.(window));
  void window.loadURL(url).catch(() => {
    if (!window.isDestroyed()) window.show();
  });
  return window;
}
