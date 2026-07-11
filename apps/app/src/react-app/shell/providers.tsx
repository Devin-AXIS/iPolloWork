/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

import { isWebDeployment } from "@/app/lib/ipollowork-deployment";
import { hydrateiPolloWorkServerSettingsFromEnv } from "@/app/lib/ipollowork-server";
import { isDesktopRuntime } from "@/app/utils";
import { DenAuthProvider } from "@/react-app/domains/cloud/den-auth-provider";
import { BrandThemeProvider } from "@/react-app/domains/cloud/brand-theme";
import { DesktopConfigProvider } from "@/react-app/domains/cloud/desktop-config-provider";
import { RestrictionNoticeProvider } from "@/react-app/domains/cloud/restriction-notice-provider";
import { LocalProvider } from "@/react-app/kernel/local-provider";
import { ServerProvider } from "@/react-app/kernel/server-provider";
import { ArchitectureMismatchGate } from "./architecture-mismatch-gate";
import { BootStateProvider } from "./boot-state";
import { DesktopRuntimeBoot } from "./desktop-runtime-boot";
import { startDebugLogger, stopDebugLogger } from "./debug-logger";
import { resolveiPolloWorkConnection } from "./ipollowork-connection";
import { ReloadCoordinatorProvider } from "./reload-coordinator";

function resolveDefaultServerUrl(): string {
  if (isDesktopRuntime()) return "http://127.0.0.1:4096";

  const ipolloworkUrl =
    typeof import.meta.env?.VITE_IPOLLOWORK_URL === "string"
      ? import.meta.env.VITE_IPOLLOWORK_URL.trim()
      : "";
  if (ipolloworkUrl) {
    return `${ipolloworkUrl.replace(/\/+$/, "")}/opencode`;
  }

  if (isWebDeployment() && import.meta.env.PROD && typeof window !== "undefined") {
    return `${window.location.origin}/opencode`;
  }

  const envUrl =
    typeof import.meta.env?.VITE_OPENCODE_URL === "string"
      ? import.meta.env.VITE_OPENCODE_URL.trim()
      : "";
  return envUrl || "http://127.0.0.1:4096";
}

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  hydrateiPolloWorkServerSettingsFromEnv();

  useEffect(() => {
    // Start the dev observability forwarder. Reads the current ipollowork-server
    // URL on every flush so reconnects after port changes still work. In prod
    // builds `startDebugLogger` is a no-op.
    startDebugLogger({
      serverUrl: async () => (await resolveiPolloWorkConnection()).normalizedBaseUrl,
    });
    return () => {
      stopDebugLogger();
    };
  }, []);

  const defaultUrl = resolveDefaultServerUrl();
  return (
    <BootStateProvider>
      <ServerProvider defaultUrl={defaultUrl}>
        <ArchitectureMismatchGate>
          <DesktopRuntimeBoot />
          <DenAuthProvider>
            <DesktopConfigProvider>
              <BrandThemeProvider>
              <RestrictionNoticeProvider>
                <LocalProvider>
                  <ReloadCoordinatorProvider>{children}</ReloadCoordinatorProvider>
                  <Toaster />
                </LocalProvider>
              </RestrictionNoticeProvider>
              </BrandThemeProvider>
            </DesktopConfigProvider>
          </DenAuthProvider>
        </ArchitectureMismatchGate>
      </ServerProvider>
    </BootStateProvider>
  );
}
