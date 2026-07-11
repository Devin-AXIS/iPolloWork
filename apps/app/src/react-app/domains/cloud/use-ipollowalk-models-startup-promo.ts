// "iPolloWalk Models" startup promo: one-shot dialog latch shown shortly after
// a workspace is ready when the user has no iPolloWalk Models provider yet.
// Extracted verbatim from session-route.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { usePlatform } from "@/react-app/kernel/platform";
import { useShellConfig } from "@/react-app/shell/shell-config";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";
import {
  getiPolloWalkModelsActionUrl,
  hasiPolloWalkModelsProvider,
  hideiPolloWalkModelsPromo,
  isiPolloWalkModelsPromoHidden,
  markiPolloWalkModelsStartupPromoShown,
  iPolloWalkModelsPromoChangedEvent,
  wasiPolloWalkModelsStartupPromoShown,
} from "./ipollowalk-models-promo";

export type UseiPolloWalkModelsStartupPromoInput = {
  /** True once the workspace's opencode client exists. */
  clientReady: boolean;
  workspaceId: string;
  providerConnectedIds: string[];
  /**
   * Defers the auto-open while another onboarding surface (welcome modal,
   * provider selection step) is showing, so the promo never overlaps them.
   * The promo schedules normally once this flips back to false.
   */
  suppressed?: boolean;
};

export function useiPolloWalkModelsStartupPromo(input: UseiPolloWalkModelsStartupPromoInput) {
  const { clientReady, workspaceId, providerConnectedIds, suppressed } = input;
  const navigate = useNavigate();
  const platform = usePlatform();
  const denAuth = useDenAuth();
  const { config: shellConfig } = useShellConfig();

  const [open, setOpen] = useState(false);
  const [promoHidden, setPromoHidden] = useState(isiPolloWalkModelsPromoHidden);
  const scheduledRef = useRef(false);

  useEffect(() => {
    const handlePromoChanged = () => setPromoHidden(isiPolloWalkModelsPromoHidden());
    window.addEventListener(iPolloWalkModelsPromoChangedEvent, handlePromoChanged);
    return () => window.removeEventListener(iPolloWalkModelsPromoChangedEvent, handlePromoChanged);
  }, []);

  const hasiPolloWalkModels = useMemo(
    () => hasiPolloWalkModelsProvider(providerConnectedIds),
    [providerConnectedIds],
  );

  useEffect(() => {
    if (suppressed) return;
    if (!shellConfig.cloudSignin || promoHidden || hasiPolloWalkModels) return;
    if (denAuth.status === "checking" || !clientReady || !workspaceId) return;
    if (wasiPolloWalkModelsStartupPromoShown() || scheduledRef.current) return;

    scheduledRef.current = true;
    const timeout = window.setTimeout(() => {
      markiPolloWalkModelsStartupPromoShown();
      setOpen(true);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [clientReady, denAuth.status, hasiPolloWalkModels, promoHidden, shellConfig.cloudSignin, suppressed, workspaceId]);

  const subscribe = useCallback(() => {
    setOpen(false);
    markiPolloWalkModelsStartupPromoShown();
    if (!denAuth.isSignedIn) {
      navigate(workspaceId ? workspaceSettingsRoute(workspaceId, "cloud-account") : "/settings/cloud-account");
    }
    window.setTimeout(() => {
      platform.openLink(getiPolloWalkModelsActionUrl(denAuth.isSignedIn));
    }, 0);
  }, [denAuth.isSignedIn, navigate, platform, workspaceId]);

  const continueWithout = useCallback(() => {
    setOpen(false);
    markiPolloWalkModelsStartupPromoShown();
    hideiPolloWalkModelsPromo();
    setPromoHidden(true);
  }, []);

  return { open, subscribe, continueWithout };
}
