// Isolated first-party authentication window. This is deliberately separate
// from the user-facing browser panel: remote identity pages never receive the
// app preload or the user's browser cookies, and they cannot replace the
// workspace renderer.

export const DESKTOP_AUTH_SESSION_PARTITION = "persist:ipollowork-auth";
const DESKTOP_AUTH_CLOSE_URL = "ipollowork-auth-window://close";
const DESKTOP_AUTH_CLOSE_CONTROL_ID = "ipollowork-desktop-auth-close";

function desktopAuthCloseControlScript() {
  return `(() => {
    const id = ${JSON.stringify(DESKTOP_AUTH_CLOSE_CONTROL_ID)};
    if (document.getElementById(id)) return;

    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.setAttribute("aria-label", "Close sign-in window");
    button.title = "Close";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    button.style.cssText = [
      "all: initial !important",
      "position: fixed !important",
      "top: 16px !important",
      "right: 16px !important",
      "z-index: 2147483647 !important",
      "display: grid !important",
      "width: 36px !important",
      "height: 36px !important",
      "place-items: center !important",
      "box-sizing: border-box !important",
      "border: 1px solid rgba(143, 151, 166, 0.35) !important",
      "border-radius: 9999px !important",
      "background: rgba(24, 31, 46, 0.72) !important",
      "color: rgba(255, 255, 255, 0.88) !important",
      "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18) !important",
      "backdrop-filter: blur(12px) !important",
      "cursor: pointer !important",
      "font-family: -apple-system, BlinkMacSystemFont, sans-serif !important",
    ].join(";");
    const icon = button.querySelector("svg");
    icon.style.cssText = "width: 18px !important; height: 18px !important; fill: none !important; stroke: currentColor !important; stroke-width: 1.8 !important; stroke-linecap: round !important";
    button.addEventListener("mouseenter", () => {
      button.style.setProperty("background", "rgba(45, 54, 72, 0.92)", "important");
      button.style.setProperty("color", "#ffffff", "important");
    });
    button.addEventListener("mouseleave", () => {
      button.style.setProperty("background", "rgba(24, 31, 46, 0.72)", "important");
      button.style.setProperty("color", "rgba(255, 255, 255, 0.88)", "important");
    });
    button.addEventListener("click", () => {
      window.location.href = ${JSON.stringify(DESKTOP_AUTH_CLOSE_URL)};
    });
    document.documentElement.append(button);
  })()`;
}

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
  if (url.startsWith("data:text/html;charset=utf-8,")) return { kind: "allow", url };
  if (url === DESKTOP_AUTH_CLOSE_URL || url === `${DESKTOP_AUTH_CLOSE_URL}/`) {
    return { kind: "cancel" };
  }
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

function runNavigationAction(event, targetUrl, { onComplete, onCancel, openExternal }) {
  const decision = classifyDesktopAuthNavigation(targetUrl);
  if (decision.kind === "allow") return decision;

  event?.preventDefault?.();
  if (decision.kind === "complete") {
    onComplete?.(decision.url);
  } else if (decision.kind === "cancel") {
    onCancel?.();
  } else if (decision.kind === "external") {
    void openExternal?.(decision.url);
  }
  return decision;
}

function installDesktopAuthNavigation(window, { onComplete, onCancel, openExternal }) {
  const inspectNavigation = (event, targetUrl) => {
    runNavigationAction(event, targetUrl, { onComplete, onCancel, openExternal });
  };

  window.webContents.on("will-navigate", inspectNavigation);
  window.webContents.on("will-redirect", inspectNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = runNavigationAction(null, url, { onComplete, onCancel, openExternal });
    if (decision.kind === "allow") {
      // Providers that use window.open stay in this isolated client window.
      // This avoids an application switch while keeping the page top-level
      // rather than embedding it in an iframe.
      void window.loadURL(decision.url).catch(() => undefined);
    }
    return { action: "deny" };
  });
}

function installDesktopAuthCloseControl(window) {
  window.webContents.on("dom-ready", () => {
    if (window.isDestroyed()) return;
    void window.webContents.executeJavaScript(desktopAuthCloseControlScript(), true).catch(() => undefined);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function desktopAuthLoadErrorHtml({ url, errorCode, errorDescription }) {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = String(url ?? "");
  }
  const safeHost = escapeHtml(host || "the sign-in server");
  const safeUrl = escapeHtml(url || "");
  const safeDescription = escapeHtml(errorDescription || "The sign-in page could not be loaded.");
  const safeCode = Number.isFinite(errorCode) ? String(errorCode) : "unknown";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iPollo Sign in</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; color: #18181b; }
    main { width: min(420px, calc(100vw - 48px)); }
    h1 { margin: 0 0 12px; font-size: 18px; font-weight: 650; letter-spacing: 0; }
    p { margin: 8px 0; color: #52525b; font-size: 13px; line-height: 1.5; }
    code { display: block; margin-top: 12px; padding: 10px 12px; overflow-wrap: anywhere; border: 1px solid #e4e4e7; border-radius: 6px; background: #fafafa; color: #27272a; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Unable to load ${safeHost}</h1>
    <p>${safeDescription}</p>
    <p>Error code: ${safeCode}</p>
    ${safeUrl ? `<code>${safeUrl}</code>` : ""}
  </main>
</body>
</html>`;
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
  installDesktopAuthNavigation(window, {
    onComplete,
    onCancel: () => {
      if (!window.isDestroyed()) window.close();
    },
    openExternal,
  });
  installDesktopAuthCloseControl(window);
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || window.isDestroyed()) return;
    if (errorCode === -3) return;
    const failedUrl = validatedUrl || url;
    window.show();
    void window.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(desktopAuthLoadErrorHtml({
        url: failedUrl,
        errorCode,
        errorDescription,
      }))}`,
    ).catch(() => undefined);
  });
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
  window.on("closed", () => onClosed?.(window));
  void window.loadURL(url).catch(() => {
    if (!window.isDestroyed()) window.show();
  });
  return window;
}
