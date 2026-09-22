/** @jsxImportSource react */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { XIcon } from "lucide-react";

import { captureAnalyticsEvent, initAnalytics } from "../../app/lib/analytics";
import {
  createDenClient,
  readDenBootstrapConfig,
  readDenSettings,
  setDenBootstrapConfig,
} from "../../app/lib/den";
import { exchangeHandoffAndSignIn } from "../../app/lib/den-handoff";
import {
  denSettingsChangedEvent,
} from "../../app/lib/den-session-events";
import { isElectronRuntime } from "../../app/utils";
import { evalRelaunchDesktopApp } from "../../app/lib/desktop";
import { Button } from "../../components/ui/button";
import { localeChangedEvent, t } from "../../i18n";
import { useDenAuth } from "../domains/cloud/den-auth-provider";
import { ForcedSigninPage } from "../domains/cloud/forced-signin-page";
import { HelpRoute } from "../domains/help/help-route";
import { NewProvidersListener } from "./new-providers-listener";
import { useDesktopFontZoomBehavior } from "./font-zoom";
import { LoadingOverlay } from "./loading-overlay";
import { DevProfiler, DevProfilerOverlay } from "./dev-profiler";
import { ReactRenderWatchdogOverlay } from "./react-render-watchdog-overlay";
import { AppMenuProvider } from "./app-menu";
import {
  IPolloWorkControlProvider,
  IPolloWorkRouteControlActions,
  useControlAction,
  type iPolloWorkControlAction,
} from "./control/control-provider";
import { SessionRoute } from "./session-route";
import { SettingsRoute } from "./settings-route";
import { ShellConfigProvider } from "./shell-config";


function BrowserControlActions() {
  function controlObjectArg(args: unknown) { return args && typeof args === "object" && !Array.isArray(args) ? args : null; }
  function controlStringArg(args: unknown, key: string) { const object = controlObjectArg(args); const value = object ? Reflect.get(object, key) : null; return typeof value === "string" ? value.trim() : ""; }
  const openBrowserUrlControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.open_url",
    label: "Open URL in built-in browser",
    description: "Open a website in a new iPolloWork built-in browser tab and return its host-owned tab ID.",
    sideEffect: "navigation",
    requiresArgs: true,
    args: [
      { name: "url", type: "string", required: true, description: "The website URL to open." },
      { name: "profileId", type: "string", required: false, description: "Persistent browser profile returned by the account plugin." },
    ],
    previewArgs: { url: "https://example.com" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const url = controlStringArg(args, "url");
      if (!url) return { ok: false, error: "Missing URL." };
      const profileId = controlStringArg(args, "profileId");
      const result = await window.__IPOLLOWORK_ELECTRON__?.browser?.openUrl?.(url, profileId ? { profileId } : undefined);
      return result;
    },
  }), []);
  useControlAction(openBrowserUrlControlAction);
  const snapshotBrowserControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.snapshot",
    label: "Read built-in browser page",
    description: "Return a bounded semantic accessibility tree with stable refs, optional scope, and compact change output.",
    sideEffect: "none",
    requiresArgs: true,
    args: [
      { name: "tabId", type: "string", required: true, description: "Built-in browser tab ID returned by browser.open_url." },
      { name: "mode", type: "string", description: "mixed, interactive, or content." },
      { name: "scopeRef", type: "string", description: "Optional ref from the previous snapshot whose subtree should be read." },
      { name: "delta", type: "boolean", description: "Return only the compact change when useful." },
    ],
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const tabId = controlStringArg(args, "tabId");
      if (!tabId) return { ok: false, error: "Missing tabId." };
      const snapshot = window.__IPOLLOWORK_ELECTRON__?.browser?.snapshot;
      if (!snapshot) return { ok: false, error: "Built-in browser runtime is not available." };
      const object = controlObjectArg(args);
      const mode = controlStringArg(args, "mode");
      const scopeRef = controlStringArg(args, "scopeRef");
      if (mode !== "" && mode !== "content" && mode !== "interactive" && mode !== "mixed") return { ok: false, error: "Invalid snapshot mode." };
      return snapshot({
        tabId,
        mode: mode || undefined,
        ...(scopeRef ? { scopeRef } : {}),
        ...(object && Reflect.get(object, "delta") === true ? { delta: true } : {}),
      });
    },
  }), []);
  useControlAction(snapshotBrowserControlAction);
  const readBrowserControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.read",
    label: "Read compact browser content",
    description: "Read headings, paragraphs, links, tables, or forms without returning the full accessibility tree.",
    sideEffect: "none",
    requiresArgs: true,
    args: [
      { name: "tabId", type: "string", required: true, description: "Built-in browser tab ID." },
      { name: "mode", type: "string", description: "page, article, links, tables, or forms." },
      { name: "maxChars", type: "number", description: "Maximum returned content characters." },
    ],
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const object = controlObjectArg(args);
      const tabId = controlStringArg(args, "tabId");
      if (!tabId) return { ok: false, error: "Missing tabId." };
      const read = window.__IPOLLOWORK_ELECTRON__?.browser?.read;
      if (!read) return { ok: false, error: "Built-in browser runtime is not available." };
      const mode = controlStringArg(args, "mode");
      const rawMaxChars = object ? Reflect.get(object, "maxChars") : undefined;
      if (mode !== "" && mode !== "article" && mode !== "forms" && mode !== "links" && mode !== "page" && mode !== "tables") return { ok: false, error: "Invalid read mode." };
      if (rawMaxChars !== undefined && (typeof rawMaxChars !== "number" || !Number.isFinite(rawMaxChars) || rawMaxChars <= 0)) return { ok: false, error: "Invalid maxChars." };
      return read({
        tabId,
        mode: mode || undefined,
        ...(typeof rawMaxChars === "number" ? { maxChars: rawMaxChars } : {}),
      });
    },
  }), []);
  useControlAction(readBrowserControlAction);
  const screenshotBrowserControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.screenshot",
    label: "Capture built-in browser view",
    description: "Capture the viewport, a bounded region, or one semantic ref, with optional ref annotations and unchanged-image suppression.",
    sideEffect: "none",
    requiresArgs: true,
    args: [
      { name: "tabId", type: "string", required: true, description: "Built-in browser tab ID." },
      { name: "snapshotId", type: "string", description: "Latest snapshot ID, required for ref or annotated captures." },
      { name: "target", type: "string", description: "viewport, region, or ref." },
      { name: "ref", type: "string", description: "Stable element ref when target is ref." },
      { name: "region", type: "object", description: "Viewport-relative x, y, width, and height." },
      { name: "mode", type: "string", description: "plain, annotated, or auto." },
      { name: "ifChanged", type: "boolean", description: "Do not resend an unchanged image." },
    ],
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const object = controlObjectArg(args);
      const tabId = controlStringArg(args, "tabId");
      if (!tabId || !object) return { ok: false, error: "Missing tabId." };
      const screenshot = window.__IPOLLOWORK_ELECTRON__?.browser?.screenshot;
      if (!screenshot) return { ok: false, error: "Built-in browser runtime is not available." };
      const mode = controlStringArg(args, "mode");
      const target = controlStringArg(args, "target");
      if (mode !== "" && mode !== "annotated" && mode !== "auto" && mode !== "plain") return { ok: false, error: "Invalid screenshot mode." };
      if (target !== "" && target !== "ref" && target !== "region" && target !== "viewport") return { ok: false, error: "Invalid screenshot target." };
      const rawRegion = Reflect.get(object, "region");
      let region: { x: number; y: number; width: number; height: number } | undefined;
      if (rawRegion !== undefined) {
        const value = controlObjectArg(rawRegion);
        if (!value) return { ok: false, error: "Invalid screenshot region." };
        const x: unknown = Reflect.get(value, "x");
        const y: unknown = Reflect.get(value, "y");
        const width: unknown = Reflect.get(value, "width");
        const height: unknown = Reflect.get(value, "height");
        if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number"
          || ![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return { ok: false, error: "Invalid screenshot region." };
        region = { x, y, width, height };
      }
      if (target === "region" && !region) return { ok: false, error: "Missing screenshot region." };
      return screenshot({
        tabId,
        ...(controlStringArg(args, "snapshotId") ? { snapshotId: controlStringArg(args, "snapshotId") } : {}),
        target: target || undefined,
        ...(controlStringArg(args, "ref") ? { ref: controlStringArg(args, "ref") } : {}),
        ...(region ? { region } : {}),
        mode: mode || undefined,
        ...(Reflect.get(object, "ifChanged") === true ? { ifChanged: true } : {}),
      });
    },
  }), []);
  useControlAction(screenshotBrowserControlAction);
  const actInBrowserControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.act",
    label: "Act in built-in browser",
    description: "Execute a bounded ref-based browser action batch through real keyboard and pointer input.",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "tabId", type: "string", required: true, description: "Built-in browser tab ID." },
      { name: "snapshotId", type: "string", required: true, description: "Latest semantic snapshot ID." },
      { name: "workspaceRoot", type: "string", description: "Server-injected local workspace root used only to validate uploads." },
      { name: "actions", type: "array", required: true, description: "One to eight ref-based browser actions." },
      { name: "observe", type: "object", description: "Optional compact semantic observation returned after the action batch." },
    ],
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const object = controlObjectArg(args);
      const tabId = controlStringArg(args, "tabId");
      const snapshotId = controlStringArg(args, "snapshotId");
      const actions = object ? Reflect.get(object, "actions") : null;
      const observe = object ? Reflect.get(object, "observe") : null;
      if (!tabId || !snapshotId || !Array.isArray(actions)) {
        return { ok: false, error: "tabId, snapshotId, and actions are required." };
      }
      const act = window.__IPOLLOWORK_ELECTRON__?.browser?.act;
      if (!act) return { ok: false, error: "Built-in browser runtime is not available." };
      return act({
        tabId,
        snapshotId,
        workspaceRoot: controlStringArg(args, "workspaceRoot") || undefined,
        actions: actions.filter((action): action is Record<string, unknown> => (
          Boolean(action) && typeof action === "object" && !Array.isArray(action)
        )),
        ...(observe && typeof observe === "object" && !Array.isArray(observe) ? { observe } : {}),
      });
    },
  }), []);
  useControlAction(actInBrowserControlAction);
  const setBrowserProxyControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.set_proxy",
    label: "Set built-in browser proxy",
    description: "Route all built-in browser traffic through an HTTP/SOCKS proxy (e.g. to browse from another location). Applies to every built-in browser tab until cleared. Pass an empty proxy to restore system network settings.",
    sideEffect: "mutation",
    args: [
      { name: "proxy", type: "string", description: "Proxy URL like http://user:pass@host:8080 or socks5://host:1080, env:NAME to use the IPOLLOWORK_BROWSER_PROXY_NAME environment variable, or empty to clear." },
    ],
    previewArgs: { proxy: "env:DE" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const proxy = controlStringArg(args, "proxy") || "";
      const setProxy = window.__IPOLLOWORK_ELECTRON__?.browser?.setProxy;
      if (!setProxy) return { ok: false, error: "Built-in browser is not available." };
      return setProxy(proxy);
    },
  }), []);
  useControlAction(setBrowserProxyControlAction);
  return null;
}

type DenSigninGateProps = {
  children: ReactNode;
};

const readRequireSigninSnapshot = () => readDenBootstrapConfig().requireSignin;

const subscribeToRequireSignin = (onStoreChange: () => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(denSettingsChangedEvent, onStoreChange);
  return () => {
    window.removeEventListener(denSettingsChangedEvent, onStoreChange);
  };
};

/**
 * Forced-signin gate ported from the Solid shell.
 *
 * When the desktop bootstrap config has `requireSignin: true` (persisted by
 * the Tauri shell via `desktop-bootstrap.json`), the UI is held at `/signin`
 * until the user authenticates with Den. When sign-in is NOT required, we
 * never let users land on `/signin` — redirect them to `/session` instead.
 *
 * While we're still checking the Den session AND sign-in is required, we
 * render nothing so the transcript/settings never flash behind the gate.
 */
function DenSigninGate({ children }: DenSigninGateProps) {
  const denAuth = useDenAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [cloudUnavailableDismissed, setCloudUnavailableDismissed] = useState(false);
  const requireSignin = useSyncExternalStore(
    subscribeToRequireSignin,
    readRequireSigninSnapshot,
    readRequireSigninSnapshot,
  );

  useEffect(() => {
    // Wait for the first auth check so we don't bounce the user between
    // `/session` and `/signin` every navigation while we figure out if
    // their cached token is still valid.
    if (denAuth.status === "checking") return;

    const path = location.pathname.toLowerCase();
    const onSignin = path === "/signin" || path.startsWith("/signin/");

    const onOnboarding = path === "/onboarding" || path.startsWith("/onboarding/");
    const hasPreparedBootstrap = Boolean(readDenBootstrapConfig().prepared);

    if (requireSignin) {
      if (!denAuth.isSignedIn && !onSignin) {
        navigate("/signin", { replace: true });
      } else if (denAuth.isSignedIn && onSignin) {
        navigate("/session", { replace: true });
      }
    } else if (onSignin) {
      navigate("/session", { replace: true });
    } else if (!denAuth.isSignedIn && hasPreparedBootstrap && !onOnboarding) {
      navigate("/onboarding", { replace: true });
    }

    // If on /onboarding but not signed in, bounce to signin or session
    if (onOnboarding && !denAuth.isSignedIn && !hasPreparedBootstrap) {
      navigate(requireSignin ? "/signin" : "/session", { replace: true });
    }
  }, [
    denAuth.isSignedIn,
    denAuth.status,
    location,
    navigate,
    requireSignin,
  ]);

  useEffect(() => {
    if (denAuth.status !== "unavailable") {
      setCloudUnavailableDismissed(false);
    }
  }, [denAuth.status]);

  if (requireSignin && denAuth.status === "checking") {
    return <ForcedSigninPage developerMode={false} />;
  }

  return (
    <>
      {denAuth.status === "unavailable" && !cloudUnavailableDismissed ? (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center px-4">
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-2xl border border-amber-7/50 bg-popover/95 px-4 py-3 text-popover-foreground shadow-md backdrop-blur-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("den.cloud_unavailable_title")}</p>
              <p className="text-xs text-muted-foreground">{t("den.cloud_unavailable_body")}</p>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void denAuth.refresh()}
            >
              {t("den.refresh")}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={t("common.close")}
              onClick={() => setCloudUnavailableDismissed(true)}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
      {children}
    </>
  );
}

/**
 * Control actions for cloud auth. Placed inside IPolloWorkControlProvider so
 * the actions are available on every route (including /signin).
 */
function DenAuthControlActions() {
  const denAuth = useDenAuth();

  const exchangeGrantAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "auth.exchange-grant",
    label: "Sign in with a handoff grant",
    description: "Exchange a desktop handoff grant string to sign in without the browser flow.",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "grant", type: "string", required: true, description: "The raw handoff grant string." },
      { name: "baseUrl", type: "string", required: false, description: "Optional Den base URL." },
    ],
    execute: async (args) => {
      const { grant, baseUrl: argBaseUrl } = (args ?? {}) as { grant?: string; baseUrl?: string };
      if (!grant?.trim()) return { ok: false, error: "grant is required" };
      const settings = readDenSettings();
      const targetBaseUrl = argBaseUrl?.trim() || settings.baseUrl;
      const client = createDenClient({ baseUrl: targetBaseUrl });
      const result = await exchangeHandoffAndSignIn(grant.trim(), {
        baseUrl: targetBaseUrl,
        client,
        fallbackErrorMessage: "No token returned",
      });
      if (!result.ok) return { ok: false, error: result.error };
      return { email: result.exchange.user?.email };
    },
  }), []);
  useControlAction(exchangeGrantAction);

  const authStatusAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "auth.status",
    label: "Get auth status",
    description: "Return the current cloud sign-in status and user.",
    sideEffect: "none",
    execute: () => ({
      status: denAuth.status,
      user: denAuth.user ? { email: denAuth.user.email, name: denAuth.user.name } : null,
    }),
  }), [denAuth.status, denAuth.user]);
  useControlAction(authStatusAction);

  const setEvalBaseUrlAction = useMemo<iPolloWorkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;
    return {
      id: "eval.auth.set-base-url",
      label: "Set the eval Cloud URL",
      description: "Point the live auth provider at an eval control plane and refresh its session state.",
      sideEffect: "mutation",
      requiresArgs: true,
      args: [
        { name: "baseUrl", type: "string", required: true, description: "Temporary Den base URL." },
      ],
      execute: async (args) => {
        if (
          !args ||
          typeof args !== "object" ||
          !("baseUrl" in args) ||
          typeof args.baseUrl !== "string" ||
          !args.baseUrl.trim()
        ) {
          return { ok: false, error: "baseUrl is required" };
        }
        const current = readDenBootstrapConfig();
        await setDenBootstrapConfig({
          baseUrl: args.baseUrl.trim(),
          requireSignin: current.requireSignin,
        });
        await denAuth.refresh();
        return { baseUrl: readDenBootstrapConfig().baseUrl };
      },
    };
  }, [denAuth.refresh]);
  useControlAction(setEvalBaseUrlAction);

  return null;
}

/**
 * Control action for eval automation: inject brand theme (logo, icon, accent color)
 * via the dev-only desktop config bridge. Placed inside IPolloWorkControlProvider.
 */
function BrandThemeControlActions() {
  const applyAction = useMemo<iPolloWorkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;
    return {
      id: "eval.brand_theme.apply",
      label: "Apply brand theme override",
      description: "Inject brand theme (logo, icon, accent color) via desktop config for eval testing.",
      sideEffect: "mutation",
      args: [
        { name: "brandLogoUrl", type: "string", description: "Logo URL" },
        { name: "brandIconUrl", type: "string", description: "Icon URL" },
        { name: "brandAccentColor", type: "string", description: "Radix color family" },
      ],
      execute: (args) => {
        const bridge = (window as unknown as Record<string, unknown>).__ipolloworkApplyDesktopConfig;
        if (typeof bridge !== "function") {
          return { ok: false, error: "Desktop config bridge not available (dev mode only)." };
        }
        bridge(args);
        return { applied: args };
      },
    };
  }, []);
  useControlAction(applyAction);

  const relaunchAction = useMemo<iPolloWorkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;
    return {
      id: "eval.app.relaunch",
      label: "Relaunch app for eval",
      description: "Dev-only eval hook that relaunches the Electron app.",
      sideEffect: "mutation",
      execute: () => evalRelaunchDesktopApp(),
    };
  }, []);
  useControlAction(relaunchAction);

  return null;
}

let appOpenedCaptured = false;

export function AppRoot() {
  useDesktopFontZoomBehavior();
  const [, setLocaleVersion] = useState(0);

  // Module-level dedupe keeps StrictMode double-mounts from double-counting.
  useEffect(() => {
    if (appOpenedCaptured) return;
    appOpenedCaptured = true;
    initAnalytics();
    captureAnalyticsEvent("app_opened", {});
  }, []);

  useEffect(() => {
    const refreshLocale = () => setLocaleVersion((version) => version + 1);
    window.addEventListener(localeChangedEvent, refreshLocale);
    return () => window.removeEventListener(localeChangedEvent, refreshLocale);
  }, []);

  return (
    <>
      <DevProfiler id="AppRoot">
        <ShellConfigProvider>
        <AppMenuProvider>
        <IPolloWorkControlProvider>
          <IPolloWorkRouteControlActions />
          <BrowserControlActions />
          <DenAuthControlActions />
          <BrandThemeControlActions />
          <DenSigninGate>
            <Routes>
              <Route
                path="/signin"
                element={
                  <DevProfiler id="SigninRoute">
                    <ForcedSigninPage developerMode={false} />
                  </DevProfiler>
                }
              />
              <Route
                path="/welcome"
                element={<Navigate to="/session" replace />}
              />
              <Route
                path="/help"
                element={
                  <DevProfiler id="HelpRoute">
                    <HelpRoute />
                  </DevProfiler>
                }
              />

              <Route
                path="/session/:sessionId?"
                element={
                  <DevProfiler id="SessionRoute">
                    <SessionRoute />
                  </DevProfiler>
                }
              />
              <Route
                path="/workspace/:workspaceId/session/:sessionId?"
                element={
                  <DevProfiler id="SessionRoute">
                    <SessionRoute />
                  </DevProfiler>
                }
              />
              <Route
                path="/workspace/:workspaceId/settings/*"
                element={
                  <DevProfiler id="SettingsRoute">
                    <SettingsRoute />
                  </DevProfiler>
                }
              />
              <Route
                path="/settings/*"
                element={
                  <DevProfiler id="SettingsRoute">
                    <SettingsRoute />
                  </DevProfiler>
                }
              />
              {/* Default + fallback: land on the session view. Users open
                  settings deliberately via the sidebar or command palette. */}
              <Route path="/" element={<Navigate to="/session" replace />} />
              <Route path="*" element={<Navigate to="/session" replace />} />
            </Routes>
          </DenSigninGate>
        </IPolloWorkControlProvider>
        </AppMenuProvider>
        </ShellConfigProvider>
        <LoadingOverlay />
      </DevProfiler>
      {/*
        DevProfilerOverlay sits OUTSIDE the AppRoot <Profiler> zone on
        purpose. The overlay re-renders on every emit() to refresh its
        table, and any commit inside a <Profiler> is recorded as a
        commit on that zone. Mounting the overlay inside AppRoot would
        inflate AppRoot's commit count by hundreds of overlay
        self-renders for every real user-visible commit, masking the
        true app-level signal.
      */}
      <NewProvidersListener />
      <DevProfilerOverlay />
      <ReactRenderWatchdogOverlay />
    </>
  );
}
