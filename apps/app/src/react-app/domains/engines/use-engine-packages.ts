/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  enginePackageInstall,
  enginePackageUninstall,
  enginePackagesList,
  type EnginePackageInfo,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";

const ACTIVE_STATUSES = new Set(["downloading", "verifying", "installing", "uninstalling"]);

export function useEnginePackages() {
  const supported = isDesktopRuntime();
  const [packages, setPackages] = useState<EnginePackageInfo[]>([]);
  const [loading, setLoading] = useState(supported);
  const [actionEngineId, setActionEngineId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) return [];
    const next = await enginePackagesList();
    setPackages(next);
    setLoading(false);
    return next;
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    let active = true;
    void refresh().catch(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refresh, supported]);

  const polling = actionEngineId != null || packages.some((item) => ACTIVE_STATUSES.has(item.status));
  useEffect(() => {
    if (!supported || !polling) return;
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 350);
    return () => window.clearInterval(interval);
  }, [polling, refresh, supported]);

  const install = useCallback(async (engineId: string) => {
    setActionEngineId(engineId);
    try {
      await Promise.all([
        enginePackageInstall(engineId),
        new Promise<void>((resolve) => window.setTimeout(resolve, 180)),
      ]);
    } finally {
      await refresh().catch(() => undefined);
      setActionEngineId(null);
    }
  }, [refresh]);

  const uninstall = useCallback(async (engineId: string) => {
    setActionEngineId(engineId);
    try {
      await enginePackageUninstall(engineId);
    } finally {
      await refresh().catch(() => undefined);
      setActionEngineId(null);
    }
  }, [refresh]);

  const byId = useMemo(
    () => new Map(packages.map((item) => [item.id, item])),
    [packages],
  );

  return {
    actionEngineId,
    byId,
    install,
    loading,
    packages,
    refresh,
    supported,
    uninstall,
  };
}
