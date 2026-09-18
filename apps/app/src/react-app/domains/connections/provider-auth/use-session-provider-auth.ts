// Session-route wiring for the provider-auth store: a stable store instance
// fed by a latest-values ref, lifecycle (start/dispose), Zen-restriction sync,
// workspace-change resync, the post-onboarding auto-open latch, and cloud
// provider auto-sync. Extracted verbatim from session-route.tsx.
import { useEffect, useMemo, useRef } from "react";

import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import type { ProviderListItem, WorkspaceDisplay } from "@/app/types";
import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useCloudProviderAutoSync } from "@/react-app/domains/cloud/use-cloud-provider-auto-sync";
import { useReloadCoordinator } from "@/react-app/shell/reload-coordinator";
import { type RouteWorkspace, workspaceLabel } from "@/react-app/shell/route-workspaces";
import { createProviderAuthStore, useProviderAuthStoreSnapshot } from "./store";

const emptyWorkspaceDisplay: WorkspaceDisplay = {
  id: "",
  name: "",
  path: "",
  preset: "default",
  workspaceType: "local",
};

export type UseSessionProviderAuthInput = {
  engineClient: unknown | null;
  providers: ProviderListItem[];
  providerDefaults: Record<string, string>;
  providerConnectedIds: string[];
  disabledProviderIds: string[];
  selectedWorkspace: RouteWorkspace | null | undefined;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  providerBaseUrl: string;
  selectedWorkspaceRoot: string;
  selectedWorkspaceId: string;
  setProviders: (value: ProviderListItem[]) => void;
  setProviderDefaults: (value: Record<string, string>) => void;
  setProviderConnectedIds: (value: string[]) => void;
  setDisabledProviderIds: (value: string[]) => void;
};

export function useSessionProviderAuth(input: UseSessionProviderAuthInput) {
  const {
    engineClient,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviderIds,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    providerBaseUrl,
    selectedWorkspaceRoot,
    selectedWorkspaceId,
    setProviders,
    setProviderDefaults,
    setProviderConnectedIds,
    setDisabledProviderIds,
  } = input;
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const reloadCoordinator = useReloadCoordinator();
  const { markReloadRequired } = reloadCoordinator;
  const onboardingProviderAuthPendingRef = useRef(false);

  const stateRef = useRef({
    engineClient,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviderIds,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    providerBaseUrl,
    selectedWorkspaceRoot,
  });
  stateRef.current = {
    engineClient,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviderIds,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    providerBaseUrl,
    selectedWorkspaceRoot,
  };

  // Depend on the stable callback, not the coordinator object: the context
  // value identity changes on every reload flip, and recreating this store
  // triggers a spurious cloud provider sync pass that amplified the
  // dispose/create loop.
  const store = useMemo(
    () =>
      createProviderAuthStore({
        client: () => stateRef.current.engineClient,
        providers: () => stateRef.current.providers,
        providerDefaults: () => stateRef.current.providerDefaults,
        providerConnectedIds: () => stateRef.current.providerConnectedIds,
        disabledProviders: () => stateRef.current.disabledProviderIds,
        checkDesktopAppRestriction: checkDesktopRestriction,
        selectedWorkspaceDisplay: () =>
          stateRef.current.selectedWorkspace
            ? ({
                ...stateRef.current.selectedWorkspace,
                name: workspaceLabel(stateRef.current.selectedWorkspace),
              } as WorkspaceDisplay)
            : emptyWorkspaceDisplay,
        providerBaseUrl: () => stateRef.current.providerBaseUrl,
        selectedWorkspaceRoot: () => stateRef.current.selectedWorkspaceRoot,
        allowCloudImports: () => (stateRef.current.selectedWorkspace?.engineId?.trim() || DEFAULT_ENGINE_ID) === DEFAULT_ENGINE_ID,
        deferSharedProviderImport: () => true,
        runtimeWorkspaceId: () => stateRef.current.selectedWorkspaceEndpoint?.workspaceId ?? null,
        ipolloworkServer: {
          getSnapshot: () => ({
            ipolloworkServerStatus: stateRef.current.selectedWorkspaceEndpoint ? "connected" : "disconnected",
            ipolloworkServerClient: stateRef.current.selectedWorkspaceEndpoint?.client ?? null,
            ipolloworkServerCapabilities: stateRef.current.selectedWorkspaceEndpoint
              ? {
                  config: { read: true, write: true },
                }
              : null,
          }),
        },
        setProviders,
        setProviderDefaults,
        setProviderConnectedIds,
        setDisabledProviders: setDisabledProviderIds,
        markEngineConfigReloadRequired: (configFileName) => {
          markReloadRequired("config", {
            type: "config",
            name: configFileName,
            action: "updated",
          });
        },
      }),
    [checkDesktopRestriction, markReloadRequired],
  );

  useEffect(() => {
    store.start();
    return () => {
      store.dispose();
    };
  }, [store]);

  useEffect(() => {
    if (!engineClient || !selectedWorkspaceId) return;
    if ((selectedWorkspace?.engineId?.trim() || DEFAULT_ENGINE_ID) !== DEFAULT_ENGINE_ID) return;

    void store
      .ensureProjectProviderDisabledState(
        "opencode",
        checkDesktopRestriction({ restriction: "allowZenModel" }),
      )
      .catch((error) => {
        console.warn("[desktop-app-restrictions] failed to sync Zen restriction", error);
      });
  }, [checkDesktopRestriction, disabledProviderIds, engineClient, selectedWorkspace?.engineId, selectedWorkspaceId, selectedWorkspaceRoot, store]);

  useEffect(() => {
    store.syncFromOptions();
  }, [
    engineClient,
    selectedWorkspace?.id,
    selectedWorkspace?.workspaceType,
    selectedWorkspaceEndpoint?.workspaceId,
    selectedWorkspaceRoot,
    store,
  ]);

  // After onboarding, only require provider setup when org policy disables
  // the built-in model capability.
  // The welcome route appends ?onboarding=1 to the session URL after workspace creation.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("onboarding=1")) return;
    // Strip the param so it doesn't re-trigger.
    window.location.hash = hash.replace(/[?&]onboarding=1/, "");
    onboardingProviderAuthPendingRef.current = true;
  }, []);

  useEffect(() => {
    if (!onboardingProviderAuthPendingRef.current) return;
    if (!selectedWorkspaceEndpoint) return;
    onboardingProviderAuthPendingRef.current = false;
    // The built-in OpenCode models are the default account capability. Do not
    // force a provider/key prompt merely because the new project's agent
    // engine is DSH; users can connect another provider when they choose one.
    if (!checkDesktopRestriction({ restriction: "allowZenModel" })) return;
    store.openProviderAuthModal({ returnFocusTarget: "composer" });
  }, [checkDesktopRestriction, selectedWorkspaceEndpoint, store]);

  // Session is where forced sign-in lands. Keep org-managed cloud providers in
  // sync here so sign-in applies engine-provider changes before Settings opens.
  useCloudProviderAutoSync(store.runCloudProviderSync);
  const snapshot = useProviderAuthStoreSnapshot(store);

  return { store, snapshot };
}
