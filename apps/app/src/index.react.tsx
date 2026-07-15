/** @jsxImportSource react */
import * as React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { initializeDenBootstrapConfig } from "./app/lib/den";
import { getiPolloWorkDeployment } from "./app/lib/ipollowork-deployment";
import { bootstrapTheme } from "./app/theme";
import { isDesktopRuntime, isDesktopWorkspaceRecoveryDisabled } from "./app/utils";
import { resetFirstRunClientState } from "./react-app/shell/session-memory";
import { initLocale } from "./i18n";
import { getReactQueryClient } from "./react-app/infra/query-client";
import {
  createDefaultPlatform,
  PlatformProvider,
} from "./react-app/kernel/platform";
import { AppProviders } from "./react-app/shell/providers";
import { AppRoot } from "./react-app/shell/app-root";
import { startDeepLinkBridge } from "./react-app/shell/startup-deep-links";
import "./app/index.css";

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

function AppRecoveryScreen({ error }: { error: Error }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-dls-surface px-6 text-dls-text">
      <section className="w-full max-w-md rounded-3xl border border-dls-border bg-dls-surface p-6 shadow-[var(--dls-card-shadow)]">
        <p className="text-sm font-semibold">iPolloWork needs a quick reload</p>
        <p className="mt-2 text-sm leading-6 text-dls-secondary">
          This task and its template are still saved. Reload the client to reopen the workspace.
        </p>
        <button
          type="button"
          className="mt-5 inline-flex h-9 items-center rounded-xl bg-dls-text px-4 text-sm font-medium text-dls-surface transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-text focus-visible:ring-offset-2"
          onClick={() => window.location.reload()}
        >
          Reload iPolloWork
        </button>
        {import.meta.env.DEV && error.message ? (
          <p className="mt-4 break-words text-xs leading-5 text-dls-secondary">{error.message}</p>
        ) : null}
      </section>
    </main>
  );
}

class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[app-root] render failed", error, info);
  }

  render() {
    return this.state.error ? <AppRecoveryScreen error={this.state.error} /> : this.props.children;
  }
}

function renderRecovery(root: HTMLElement, error: unknown) {
  const normalized = error instanceof Error ? error : new Error("iPolloWork could not start.");
  console.error("[app-root] startup failed", normalized);
  ReactDOM.createRoot(root).render(<AppRecoveryScreen error={normalized} />);
}

async function startApp() {
  // IPOLLOWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY resets backend workspace state
  // but not the renderer's localStorage; wipe the renderer's first-run memory
  // here (before any provider/component reads it) so the flag actually produces a
  // fresh first run — loader, auto session, provider step — on every launch.
  if (isDesktopWorkspaceRecoveryDisabled()) {
    resetFirstRunClientState();
  }

  bootstrapTheme();
  initLocale();
  startDeepLinkBridge();
  await initializeDenBootstrapConfig();

  const root = document.getElementById("root");
  if (!root) throw new Error("Root element not found");

  root.dataset.ipolloworkDeployment = getiPolloWorkDeployment();

  const platform = createDefaultPlatform();
  const queryClient = getReactQueryClient();
  const Router = isDesktopRuntime() ? HashRouter : BrowserRouter;

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <PlatformProvider value={platform}>
              <AppProviders>
                <Router>
                  <AppRoot />
                </Router>
              </AppProviders>
            </PlatformProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

void startApp().catch((error) => {
  const root = document.getElementById("root");
  if (root) renderRecovery(root, error);
  else console.error("[app-root] startup failed before the root was available", error);
});
